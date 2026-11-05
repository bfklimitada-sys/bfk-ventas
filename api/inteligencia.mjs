// ═══════════════════════════════════════════════════════════════
// api/inteligencia.mjs — Función serverless (Vercel). Inteligencia Comercial de Compra Ágil (04/11/2026).
// Sincroniza el RESULTADO oficial de las Compras Ágiles en que BFK presentó cotización:
//   1) Pide a la base (ic_pendientes_sincronizar) SOLO los códigos BFK por consultar (nunca todo ChileCompra).
//   2) Por cada código: LISTADO oficial filtrado por id (estado, n.º de ofertas, motivos, fecha del último cambio) y,
//      solo si hay proveedor seleccionado, el DETALLE (cotizaciones recibidas: RUT, razón social, montos, seleccionada).
//      GET https://api2.mercadopublico.cl/v2/compra-agil?id=<código>  ·  GET .../v2/compra-agil/<código>  (cabecera ticket)
//   3) Guarda con ic_registrar_resultado (solo administradores). Nunca modifica cotizaciones, OCs ni finanzas.
// Protecciones (corrección 05/11/2026): ChileCompra responde 429 («límite de tasa», AWS API Gateway, sin Retry-After)
// cuando las consultas llegan muy seguidas; es una restricción TEMPORAL (en el diagnóstico volvió a responder 200 en
// segundos). Por eso un 429 ya NO detiene la sincronización: se espera y se reintenta la MISMA consulta (2, 5 y 10 s),
// se baja el ritmo (separación ×2, hasta 8 s) y, si ChileCompra insiste, la llamada termina con una pausa sugerida para
// que el navegador continúe después. El ritmo inicial (2 consultas simultáneas, una nueva cada 1,2 s ≈ 50/min) es un
// punto de partida prudente, NO un límite oficial garantizado: se ajusta solo según las respuestas.
// Además: plazo total por llamada, máximo de códigos por llamada, un reintento ante fallas transitorias, ticket rechazado
// detiene todo, espera por código en la base y una sola sincronización a la vez por instancia.
// Credenciales: MP_TICKET_COMPRA_AGIL o MP_TICKET (las mismas de /api/compra-agil), solo en el servidor.
// No simula resultados: lo que ChileCompra no entrega queda vacío y se informa como no disponible.
// Uso: POST /api/inteligencia  { origen: "manual"|"automatica", forzar?: bool, codigos?: [..] }  (Authorization: Bearer)
// ═══════════════════════════════════════════════════════════════
import { normalizarResultadoMP, esCodigoCompraAgil, codigoNorm } from "../src/lib/inteligenciaComercial.js";

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend y en api/compra-agil.mjs.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
const API = "https://api2.mercadopublico.cl/v2/compra-agil";
export const LIMITES = {
  maxCodigos: 40, concurrencia: 2, presupuestoMs: 48_000,
  pausaMs: 1_200, pausaMinMs: 1_200, pausaMaxMs: 8_000,      // separación entre inicios de consulta (adaptativa: ×2 con cada 429, ×0,8 cada 4 respuestas seguidas sin 429)
  esperas429: [2_000, 5_000, 10_000], max429Llamada: 6, pausaSugeridaMs: 30_000, maxRetryAfterMs: 60_000,
  listadoMs: 20_000, detalleMs: 25_000, minDetalleMs: 14_000, llamadasPorMinuto: 6,
};

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
// Una consulta a ChileCompra con plazo propio. Devuelve { http, cuerpo, retryAfterMs } o { falla }.
async function pedirMP(f, url, ticket, ms) {
  try {
    const r = await f(url, { headers: { ticket, Accept: "application/json" }, signal: AbortSignal.timeout(Math.max(1000, ms)) });
    const cuerpo = await r.json().catch(() => null);
    const ra = Number(r.headers?.get?.("retry-after"));
    return { http: r.status, cuerpo, retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : null };
  } catch (e) { return { falla: e?.name === "TimeoutError" || e?.name === "AbortError" ? "demora" : "conexion" }; }
}
const transitorio = (x) => x.falla || x.http >= 500;
const acotar = (v, min, max) => Math.min(max, Math.max(min, Number(v) || min));
const motivoDetalle = (D) => (D.http === 429 ? "limite" : D.falla === "demora" ? "demora" : "error");

// Núcleo de la sincronización (sin dependencias de Vercel: se prueba con fetch y RPC simulados).
// pendientes: [{ codigo, detalle_consultado }] (la base entrega primero los «por verificar»). Hasta lim.concurrencia
// códigos en paralelo; las consultas se inician de a una, separadas por el ritmo vigente (ritmoMs, adaptativo).
export async function sincronizar({ pendientes, ticket, rpc, f = fetch, ahora = Date.now, lim = LIMITES, forzar = false, ritmoMs }) {
  const t0 = ahora(); const queda = () => lim.presupuestoMs - (ahora() - t0);
  const out = { procesados: 0, actualizados: 0, errores: 0, limite_alcanzado: false, ticket_rechazado: false, restantes: 0, resultados: [], consultas_externas: 0,
    respuestas_429: 0, reintentos_429: 0, aplazados: 0, pausa_ms: 0, ritmo_ms: 0, conteo: {}, ganadas_nuevas: [] };
  let ritmo = acotar(ritmoMs ?? lim.pausaMs, lim.pausaMinMs ?? lim.pausaMs, lim.pausaMaxMs ?? lim.pausaMs);
  let seguidos = 0; let ultima = null; let turno = Promise.resolve();
  const detener = () => out.ticket_rechazado || out.pausa_ms > 0;
  const iniciar = () => {   // la próxima consulta empieza al menos «ritmo» ms después de la anterior (de a una)
    const inicio = turno.then(async () => { const falta = ritmo - (ahora() - (ultima ?? -1e12)); if (falta > 0) await espera(falta); ultima = ahora(); });
    turno = inicio; return inicio;
  };
  // Consulta con manejo del 429: esperar, bajar el ritmo y reintentar la MISMA consulta; si insiste, pausa sugerida.
  const externo = async (url, msMax) => {
    for (let i = 0; ; i++) {
      await iniciar(); out.consultas_externas++;
      const R = await pedirMP(f, url, ticket, Math.min(msMax, queda()));
      if (R.http !== 429) { if (R.http === 200 && ++seguidos >= 4) { ritmo = Math.max(lim.pausaMinMs ?? lim.pausaMs, Math.round(ritmo * 0.8)); seguidos = 0; } return R; }
      out.respuestas_429++; out.limite_alcanzado = true; seguidos = 0;
      ritmo = Math.min(lim.pausaMaxMs ?? lim.pausaMs, ritmo * 2);
      const esperaMs = Math.min(lim.maxRetryAfterMs ?? 60_000, R.retryAfterMs ?? (lim.esperas429[i] ?? Infinity));
      const insiste = i >= lim.esperas429.length || out.respuestas_429 >= lim.max429Llamada;
      if (insiste || queda() < esperaMs + msMax / 2 || detener()) {   // no se detiene: se sugiere una pausa y se continúa después
        if (!out.ticket_rechazado) out.pausa_ms = Math.max(out.pausa_ms, R.retryAfterMs ?? (insiste ? lim.pausaSugeridaMs : Math.max(esperaMs, 5_000)));
        return R;
      }
      out.reintentos_429++; await espera(esperaMs);
    }
  };
  const registrar = async (p) => {
    try {
      const r = await rpc("ic_registrar_resultado", { p }); if (r?.cambio) out.actualizados++;
      const k = r?.resultado === "sin_informacion" && p.estado_proceso && ["proveedor_seleccionado", "oc_emitida"].includes(p.estado_proceso) ? "por_verificar" : p.consulta_estado !== "ok" ? "sin_respuesta" : r?.resultado || "sin_informacion";
      out.conteo[k] = (out.conteo[k] || 0) + 1;
      if (r?.resultado === "ganada" && r?.cambio) out.ganadas_nuevas.push(p.codigo);
      out.resultados.push({ codigo: p.codigo, resultado: r?.resultado, consulta_estado: p.consulta_estado });
    } catch (e) { out.errores++; out.resultados.push({ codigo: p.codigo, consulta_estado: "error_base", error: String(e.message).slice(0, 160) }); }
  };
  const uno = async ({ codigo, detalle_consultado }) => {
    let L = await externo(`${API}?id=${encodeURIComponent(codigo)}`, lim.listadoMs);
    if (transitorio(L) && queda() > lim.listadoMs / 2 && !detener()) { await espera(1000); L = await externo(`${API}?id=${encodeURIComponent(codigo)}`, lim.listadoMs); }
    if (L.http === 401 || L.http === 403) { out.ticket_rechazado = true; out.aplazados++; return; }   // nada se marca: el problema es el ticket
    if (L.http === 429) { out.aplazados++; return; }   // no se registra nada: el código sigue pendiente y se consulta al reanudar
    out.procesados++;
    if (transitorio(L) || (L.http !== 200 && L.http !== 404)) { out.errores++; return registrar({ codigo, consulta_estado: "error", consulta_error: L.falla ? `Sin respuesta (${L.falla})` : `HTTP ${L.http}` }); }
    const item = L.http === 200 && Array.isArray(L.cuerpo?.payload?.items) ? L.cuerpo.payload.items.find((x) => codigoNorm(x?.codigo) === codigo) : null;
    if (!item) return registrar({ codigo, consulta_estado: "no_encontrada", consulta_error: "ChileCompra no encontró el código" });
    let detalle = null, detalleError = "", reintento = null;
    const ep = normalizarResultadoMP(codigo, item).estado_proceso;
    if (["proveedor_seleccionado", "oc_emitida"].includes(ep) && (forzar || !detalle_consultado)) {
      if (queda() >= lim.minDetalleMs && !detener()) {
        const D = await externo(`${API}/${encodeURIComponent(codigo)}`, Math.min(lim.detalleMs, queda() - 2000));
        if (D.http === 200 && D.cuerpo?.payload && typeof D.cuerpo.payload === "object") detalle = D.cuerpo.payload;
        else { detalleError = D.falla ? `sin respuesta (${D.falla})` : `HTTP ${D.http}`; reintento = motivoDetalle(D); }
      } else { detalleError = "sin tiempo en esta llamada"; reintento = "sin_tiempo"; }
    }
    return registrar({ ...normalizarResultadoMP(codigo, item, detalle, { detalleError }), ...(reintento ? { reintento_detalle: reintento } : {}) });
  };
  const lista = pendientes.slice(0, lim.maxCodigos); let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < lista.length && !detener() && queda() >= lim.listadoMs / 2) await uno(lista[siguiente++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lim.concurrencia || 1, lista.length)) }, trabajador));
  out.restantes = lista.length - siguiente + out.aplazados;
  out.ritmo_ms = ritmo; out.duracion_ms = ahora() - t0;
  return out;
}

// Manejador HTTP. Las dependencias se pueden reemplazar en las pruebas (sesión, base, ticket, ChileCompra, límites).
export function crearManejador({ validar = validarSesion, rpcDe = rpcCon, ticketDe = () => (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET || "").trim(), f = fetch, lim = LIMITES } = {}) {
  let enCurso = false; const usos = new Map();
  return async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST." });
    const ses = await validar(req);
    if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });
    if (!ses.admin) return res.status(403).json({ ok: false, codigo: "SOLO_ADMIN", error: "Solo un administrador de BFK puede sincronizar con ChileCompra. Los resultados ya guardados se pueden consultar." });
    const ahora = Date.now(); const u = (usos.get(ses.uid) || []).filter((t) => ahora - t < 60_000);
    if (u.length >= lim.llamadasPorMinuto) return res.status(429).json({ ok: false, codigo: "LIMITE_BFK", reintentar_ms: 60_000 - (ahora - u[0]), error: "Demasiadas sincronizaciones seguidas. Espera un minuto." });
    u.push(ahora); usos.set(ses.uid, u);
    if (enCurso) return res.status(409).json({ ok: false, codigo: "EN_CURSO", error: "Ya hay una sincronización en curso. Espera a que termine." });
    const ticket = ticketDe();
    if (!ticket) return res.status(503).json({ ok: false, codigo: "SIN_TICKET", error: "La consulta oficial de Compra Ágil requiere el ticket de ChileCompra configurado en el servidor (MP_TICKET)." });
    let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const origen = body?.origen === "automatica" ? "automatica" : "manual"; const forzar = !!body?.forzar;
    const ritmoMs = Number.isFinite(Number(body?.ritmo_ms)) ? Number(body.ritmo_ms) : undefined;
    const rpc = rpcDe(ses.token); const iniciado = new Date().toISOString();
    // Estado de la cola (opcional: si la migración del 05/11 aún no está, se informa sin estos conteos).
    const estadoCola = () => rpc("ic_estado_sincronizacion", {}).catch(() => null);
    enCurso = true;
    try {
      let pendientes;
      if (Array.isArray(body?.codigos) && body.codigos.length) {
        const cods = [...new Set(body.codigos.map(codigoNorm).filter(esCodigoCompraAgil))].slice(0, lim.maxCodigos);
        if (!cods.length) return res.status(400).json({ ok: false, codigo: "CODIGO_INVALIDO", error: "Ningún código de Compra Ágil válido." });
        pendientes = cods.map((codigo) => ({ codigo, detalle_consultado: false }));
      } else {
        try { pendientes = await rpc("ic_pendientes_sincronizar", { p_limite: lim.maxCodigos, p_forzar: forzar }); }
        catch (e) {
          if (e.status === 404 || e.codigo === "PGRST202" || e.codigo === "42883") return res.status(503).json({ ok: false, codigo: "SIN_MIGRACION", error: "El módulo Inteligencia Comercial aún no está instalado en la base de datos (migración pendiente de autorización)." });
          return res.status(e.status === 403 ? 403 : 502).json({ ok: false, codigo: "ERROR_BASE", error: `No se pudo leer qué consultar: ${e.message}` });
        }
      }
      if (!pendientes.length) return res.status(200).json({ ok: true, procesados: 0, actualizados: 0, errores: 0, restantes: 0, resultados: [], conteo: {}, hay_mas: false, cola: await estadoCola(), mensaje: "Todo al día: no hay resultados por consultar." });
      const r = await sincronizar({ pendientes, ticket, rpc, forzar, ritmoMs, f, lim });
      const cola = body?.codigos ? null : await estadoCola();
      // Quedan más si esta llamada no alcanzó a revisar todos, si la base tiene más listos para consultar ahora, o si
      // ChileCompra pidió una pausa (se continúa después). Con un ticket rechazado no se sigue.
      const mas = !r.ticket_rechazado && (r.restantes > 0 || r.pausa_ms > 0 || (cola ? cola.elegibles_ahora > 0 : !body?.codigos && pendientes.length >= lim.maxCodigos));
      await rpc("ic_registrar_sincronizacion", { p: { iniciado_en: iniciado, origen, solicitados: pendientes.length, consultados: r.procesados, actualizados: r.actualizados, errores: r.errores,
        limite_alcanzado: r.respuestas_429 > 0, detalle: r.ticket_rechazado ? "Ticket rechazado por ChileCompra"
          : r.respuestas_429 ? `ChileCompra pidió bajar la velocidad (429 × ${r.respuestas_429}; ${r.reintentos_429} reintentos${r.pausa_ms ? `; pausa de ${Math.round(r.pausa_ms / 1000)} s` : ""})` : null } }).catch(() => null);
      if (r.ticket_rechazado) return res.status(502).json({ ok: false, codigo: "TICKET_INVALIDO", error: "ChileCompra rechazó el ticket configurado (HTTP 401/403). No se modificó ningún resultado.", ...r });
      return res.status(200).json({ ok: true, ...r, hay_mas: mas, cola, fuente: "API Compra Ágil v2 (ChileCompra)", consultado_en: new Date().toISOString() });
    } finally { enCurso = false; }
  };
}
export default crearManejador();
