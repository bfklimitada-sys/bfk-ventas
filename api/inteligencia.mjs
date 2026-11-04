// ═══════════════════════════════════════════════════════════════
// api/inteligencia.mjs — Función serverless (Vercel). Inteligencia Comercial de Compra Ágil (04/11/2026).
// Sincroniza el RESULTADO oficial de las Compras Ágiles en que BFK presentó cotización:
//   1) Pide a la base (ic_pendientes_sincronizar) SOLO los códigos BFK por consultar (nunca todo ChileCompra).
//   2) Por cada código: LISTADO oficial filtrado por id (estado, n.º de ofertas, motivos, fecha del último cambio) y,
//      solo si hay proveedor seleccionado, el DETALLE (cotizaciones recibidas: RUT, razón social, montos, seleccionada).
//      GET https://api2.mercadopublico.cl/v2/compra-agil?id=<código>  ·  GET .../v2/compra-agil/<código>  (cabecera ticket)
//   3) Guarda con ic_registrar_resultado (solo administradores). Nunca modifica cotizaciones, OCs ni finanzas.
// Protecciones: hasta 3 consultas externas simultáneas, cada una iniciada al menos 350 ms después de la anterior (< 3 por
// segundo; la guía observa 429 sobre 4 por segundo), plazo total por llamada, máximo
// de códigos por llamada, un reintento ante fallas transitorias, detención inmediata ante 429 (cuota) o ticket rechazado,
// espera creciente por código en la base, y una sola sincronización a la vez por instancia.
// Credenciales: MP_TICKET_COMPRA_AGIL o MP_TICKET (las mismas de /api/compra-agil), solo en el servidor.
// No simula resultados: lo que ChileCompra no entrega queda vacío y se informa como no disponible.
// Uso: POST /api/inteligencia  { origen: "manual"|"automatica", forzar?: bool, codigos?: [..] }  (Authorization: Bearer)
// ═══════════════════════════════════════════════════════════════
import { normalizarResultadoMP, esCodigoCompraAgil, codigoNorm } from "../src/lib/inteligenciaComercial.js";

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend y en api/compra-agil.mjs.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
const API = "https://api2.mercadopublico.cl/v2/compra-agil";
export const LIMITES = { maxCodigos: 40, concurrencia: 3, presupuestoMs: 48_000, pausaMs: 350, listadoMs: 20_000, detalleMs: 25_000, minDetalleMs: 14_000, llamadasPorMinuto: 6 };

// Misma validación de sesión que api/compra-agil.mjs (perfil BFK obligatorio); aquí además se informa si es administrador.
async function validarSesion(req) {
  const m = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "Sesión requerida. Inicie sesión en BFK Datos.", status: 401 };
  const token = m[1].trim();
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: "Sesión inválida o vencida. Vuelva a iniciar sesión.", status: 401 };
    const u = await r.json();
    if (!u?.id) return { error: "Sesión inválida.", status: 401 };
    const p = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(u.id)}&select=id,rol`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const filas = p.ok ? await p.json() : [];
    if (!Array.isArray(filas) || !filas.length) return { error: "Usuario sin perfil autorizado en BFK.", status: 403 };
    return { uid: u.id, token, admin: filas[0]?.rol === "admin" };
  } catch { return { error: "No se pudo validar la sesión. Intente de nuevo.", status: 503 }; }
}

// RPC de Supabase con la sesión del usuario (rigen RLS y las validaciones de la base).
export function rpcCon(token, f = fetch) {
  return async (fn, body) => {
    const r = await f(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const c = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(c?.message || `HTTP ${r.status}`), { status: r.status, codigo: c?.code });
    return c;
  };
}

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Una consulta a ChileCompra con plazo propio. Devuelve { http, cuerpo } o { falla }.
async function pedirMP(f, url, ticket, ms) {
  try {
    const r = await f(url, { headers: { ticket, Accept: "application/json" }, signal: AbortSignal.timeout(Math.max(1000, ms)) });
    const cuerpo = await r.json().catch(() => null);
    return { http: r.status, cuerpo };
  } catch (e) { return { falla: e?.name === "TimeoutError" || e?.name === "AbortError" ? "demora" : "conexion" }; }
}
const transitorio = (x) => x.falla || x.http >= 500;

// Núcleo de la sincronización (sin dependencias de Vercel: se prueba con fetch y RPC simulados).
// pendientes: [{ codigo, detalle_consultado }]. Hasta lim.concurrencia códigos en paralelo (la API v2 tarda varios
// segundos por respuesta) y nunca más de una consulta nueva cada lim.pausaMs (< 3 por segundo en total).
export async function sincronizar({ pendientes, ticket, rpc, f = fetch, ahora = Date.now, lim = LIMITES, forzar = false }) {
  const t0 = ahora(); const queda = () => lim.presupuestoMs - (ahora() - t0);
  const out = { procesados: 0, actualizados: 0, errores: 0, limite_alcanzado: false, ticket_rechazado: false, restantes: 0, resultados: [], consultas_externas: 0 };
  let ultima = null; let turno = Promise.resolve();
  const externo = (url, ms) => {   // las consultas se inician de a una, separadas por la pausa mínima
    const inicio = turno.then(async () => { const falta = lim.pausaMs - (ahora() - (ultima ?? -1e12)); if (falta > 0) await espera(falta); ultima = ahora(); });
    turno = inicio; return inicio.then(() => { out.consultas_externas++; return pedirMP(f, url, ticket, ms); });
  };
  const registrar = async (p) => {
    try { const r = await rpc("ic_registrar_resultado", { p }); if (r?.cambio) out.actualizados++; out.resultados.push({ codigo: p.codigo, resultado: r?.resultado, consulta_estado: p.consulta_estado }); }
    catch (e) { out.errores++; out.resultados.push({ codigo: p.codigo, consulta_estado: "error_base", error: String(e.message).slice(0, 160) }); }
  };
  const detener = () => out.limite_alcanzado || out.ticket_rechazado;
  const uno = async ({ codigo, detalle_consultado }) => {
    let L = await externo(`${API}?id=${encodeURIComponent(codigo)}`, Math.min(lim.listadoMs, queda()));
    if (transitorio(L) && queda() > lim.listadoMs / 2 && !detener()) { await espera(1000); L = await externo(`${API}?id=${encodeURIComponent(codigo)}`, Math.min(lim.listadoMs, queda())); }
    out.procesados++;
    if (L.http === 401 || L.http === 403) { out.ticket_rechazado = true; return; }   // nada se marca: el problema es el ticket
    if (L.http === 429) { out.limite_alcanzado = true; return registrar({ codigo, consulta_estado: "limite", consulta_error: "ChileCompra respondió 429 (cuota o ráfaga)" }); }
    if (transitorio(L) || (L.http !== 200 && L.http !== 404)) { out.errores++; return registrar({ codigo, consulta_estado: "error", consulta_error: L.falla ? `Sin respuesta (${L.falla})` : `HTTP ${L.http}` }); }
    const item = L.http === 200 && Array.isArray(L.cuerpo?.payload?.items) ? L.cuerpo.payload.items.find((x) => codigoNorm(x?.codigo) === codigo) : null;
    if (!item) return registrar({ codigo, consulta_estado: "no_encontrada", consulta_error: "ChileCompra no encontró el código" });
    let detalle = null, detalleError = "";
    const ep = normalizarResultadoMP(codigo, item).estado_proceso;
    if (["proveedor_seleccionado", "oc_emitida"].includes(ep) && (forzar || !detalle_consultado)) {
      if (queda() >= lim.minDetalleMs && !detener()) {
        const D = await externo(`${API}/${encodeURIComponent(codigo)}`, Math.min(lim.detalleMs, queda() - 2000));
        if (D.http === 429) out.limite_alcanzado = true;
        if (D.http === 200 && D.cuerpo?.payload && typeof D.cuerpo.payload === "object") detalle = D.cuerpo.payload;
        else detalleError = D.falla ? `sin respuesta (${D.falla})` : `HTTP ${D.http}`;
      } else detalleError = "sin tiempo en esta llamada";
    }
    return registrar(normalizarResultadoMP(codigo, item, detalle, { detalleError }));
  };
  const lista = pendientes.slice(0, lim.maxCodigos); let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < lista.length && !detener() && queda() >= lim.listadoMs / 2) await uno(lista[siguiente++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lim.concurrencia || 1, lista.length)) }, trabajador));
  out.restantes = lista.length - siguiente;
  out.duracion_ms = ahora() - t0;
  return out;
}

let enCurso = false; const usos = new Map();
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST." });
  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });
  if (!ses.admin) return res.status(403).json({ ok: false, codigo: "SOLO_ADMIN", error: "Solo un administrador de BFK puede sincronizar con ChileCompra. Los resultados ya guardados se pueden consultar." });
  const ahora = Date.now(); const u = (usos.get(ses.uid) || []).filter((t) => ahora - t < 60_000);
  if (u.length >= LIMITES.llamadasPorMinuto) return res.status(429).json({ ok: false, codigo: "LIMITE_BFK", error: "Demasiadas sincronizaciones seguidas. Espera un minuto." });
  u.push(ahora); usos.set(ses.uid, u);
  if (enCurso) return res.status(409).json({ ok: false, codigo: "EN_CURSO", error: "Ya hay una sincronización en curso. Espera a que termine." });
  const ticket = (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET || "").trim();
  if (!ticket) return res.status(503).json({ ok: false, codigo: "SIN_TICKET", error: "La consulta oficial de Compra Ágil requiere el ticket de ChileCompra configurado en el servidor (MP_TICKET)." });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const origen = body?.origen === "automatica" ? "automatica" : "manual"; const forzar = !!body?.forzar;
  const rpc = rpcCon(ses.token); const iniciado = new Date().toISOString();
  enCurso = true;
  try {
    let pendientes;
    if (Array.isArray(body?.codigos) && body.codigos.length) {
      const cods = [...new Set(body.codigos.map(codigoNorm).filter(esCodigoCompraAgil))].slice(0, LIMITES.maxCodigos);
      if (!cods.length) return res.status(400).json({ ok: false, codigo: "CODIGO_INVALIDO", error: "Ningún código de Compra Ágil válido." });
      pendientes = cods.map((codigo) => ({ codigo, detalle_consultado: false }));
    } else {
      try { pendientes = await rpc("ic_pendientes_sincronizar", { p_limite: LIMITES.maxCodigos, p_forzar: forzar }); }
      catch (e) {
        if (e.status === 404 || e.codigo === "PGRST202" || e.codigo === "42883") return res.status(503).json({ ok: false, codigo: "SIN_MIGRACION", error: "El módulo Inteligencia Comercial aún no está instalado en la base de datos (migración pendiente de autorización)." });
        return res.status(e.status === 403 ? 403 : 502).json({ ok: false, codigo: "ERROR_BASE", error: `No se pudo leer qué consultar: ${e.message}` });
      }
    }
    if (!pendientes.length) return res.status(200).json({ ok: true, procesados: 0, actualizados: 0, errores: 0, restantes: 0, resultados: [], mensaje: "Todo al día: no hay resultados por consultar." });
    const r = await sincronizar({ pendientes, ticket, rpc, forzar });
    // Quedan más por consultar si esta llamada no alcanzó a revisar todos (o la base tiene más de los que se pidieron).
    const mas = r.restantes > 0 || (!body?.codigos && pendientes.length >= LIMITES.maxCodigos && !r.limite_alcanzado && !r.ticket_rechazado);
    await rpc("ic_registrar_sincronizacion", { p: { iniciado_en: iniciado, origen, solicitados: pendientes.length, consultados: r.procesados, actualizados: r.actualizados, errores: r.errores,
      limite_alcanzado: r.limite_alcanzado, detalle: r.ticket_rechazado ? "Ticket rechazado por ChileCompra" : r.limite_alcanzado ? "Límite de ChileCompra alcanzado (429)" : null } }).catch(() => null);
    if (r.ticket_rechazado) return res.status(502).json({ ok: false, codigo: "TICKET_INVALIDO", error: "ChileCompra rechazó el ticket configurado (HTTP 401/403). No se modificó ningún resultado.", ...r });
    return res.status(200).json({ ok: true, ...r, hay_mas: mas, fuente: "API Compra Ágil v2 (ChileCompra)", consultado_en: new Date().toISOString() });
  } finally { enCurso = false; }
}
