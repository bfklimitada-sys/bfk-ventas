// ═══════════════════════════════════════════════════════════════
// api/compra-agil.mjs — Función serverless (Vercel). Módulo Cotizaciones y EETT.
// Consulta el DETALLE de una Compra Ágil en la API OFICIAL de ChileCompra (Beta):
//   GET https://api2.mercadopublico.cl/v2/compra-agil/{codigo}   · cabecera  ticket: <TICKET>
// y devuelve solo los campos que usa la pestaña Datos (requerimientos del comprador; nunca precios de BFK).
//
// Uso desde el frontend:  fetch("/api/compra-agil?codigo=3390-246-COT26", { headers: { Authorization: "Bearer <sesión>" } })
// También acepta ?q=<enlace completo de Mercado Público> y extrae el código.
//
// Credenciales: el ticket se lee SOLO del servidor (nunca llega al navegador):
//   MP_TICKET_COMPRA_AGIL (ticket específico, si ChileCompra entrega uno para la API v2) o, en su defecto, MP_TICKET.
// Sin ticket responde { ok:false, codigo:"SIN_TICKET" } y la app mantiene el ingreso manual.
// No simula respuestas: si la API no responde, se informa el error tal cual.
// Cómo obtener el ticket: https://www.chilecompra.cl/api/ → «Pide tu ticket» (Clave Única) → llega por correo.
// Exige una sesión válida de BFK (cabecera Authorization: Bearer <token>).
// ═══════════════════════════════════════════════════════════════

import { lookup } from "node:dns/promises";
import { connect as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { codigoCompraAgil } from "../src/lib/cotizaciones.js";

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
const API = "https://api2.mercadopublico.cl/v2/compra-agil";

// Límite por usuario (en memoria): protege la cuota diaria del ticket.
const VENTANA_MS = 60_000, MAX_POR_MINUTO = 10;
const usos = new Map();
function limitado(uid) {
  const ahora = Date.now(); const arr = (usos.get(uid) || []).filter((t) => ahora - t < VENTANA_MS);
  if (arr.length >= MAX_POR_MINUTO) { usos.set(uid, arr); return true; }
  arr.push(ahora); usos.set(uid, arr); return false;
}

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
    return { uid: u.id, admin: filas[0]?.rol === "admin" };
  } catch { return { error: "No se pudo validar la sesión. Intente de nuevo.", status: 503 }; }
}

const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
const numONull = (v) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Normaliza el payload oficial a los campos de la cotización. Lo que no viene, queda vacío (no se inventa).
export function normalizarCompraAgil(p) {
  const inst = p?.institucion || {}; const ent = p?.entrega || {}; const fec = p?.fechas || {}; const pres = p?.presupuesto || {};
  return {
    codigo: txt(p?.codigo), nombre: txt(p?.nombre), descripcion: txt(p?.descripcion),
    estado: txt(p?.estado?.glosa || p?.estado?.codigo),
    institucion: txt(inst.organismo_comprador), unidad_compra: txt(inst.unidad_compra), rut: txt(inst.rut),
    region: txt(inst.nombre_region), direccion_entrega: txt(ent.direccion_entrega),
    plazo_dias: numONull(ent.plazo_entrega_dias),
    // Presupuesto DEL COMPRADOR (referencial). Nunca es el precio ofertado por BFK.
    presupuesto: { tipo: txt(pres.tipo_presupuesto), moneda: txt(pres.moneda), estimado: numONull(pres.presupuesto_estimado), disponible: numONull(pres.monto_disponible_clp ?? pres.monto_disponible) },
    fecha_publicacion: txt(fec.fecha_publicacion), fecha_cierre: txt(fec.fecha_cierre),
    productos: (Array.isArray(p?.productos_solicitados) ? p.productos_solicitados : []).map((x) => ({
      codigo_producto: txt(x?.codigo_producto), nombre: txt(x?.nombre), descripcion: txt(x?.descripcion), cantidad: numONull(x?.cantidad), unidad: txt(x?.unidad_medida),
    })),
    documentos: (Array.isArray(p?.documentos) ? p.documentos : []).map((d) => ({ id: txt(d?.id), nombre: txt(d?.nombre) })).filter((d) => d.nombre || d.id),
    // Un código COT no es una OC: solo se informa si ChileCompra indica que se emitió una.
    oc_emitida: p?.orden_compra?.id_orden_compra != null,
  };
}

// Normaliza un elemento del LISTADO oficial (payload.items[], guía v2 §6.1). Solo cabecera del proceso:
// el listado no trae dirección de entrega, plazo ni productos solicitados; esos datos y los documentos
// quedan para ingreso manual. Lo que no viene queda vacío (no se inventa).
export function normalizarListadoCompraAgil(it) {
  const inst = it?.institucion || {}; const fec = it?.fechas || {}; const mon = it?.montos || {};
  return {
    codigo: txt(it?.codigo), nombre: txt(it?.nombre), descripcion: "",
    estado: txt(it?.estado?.glosa || it?.estado?.codigo),
    institucion: txt(inst.organismo_comprador), unidad_compra: txt(inst.unidad_compra), rut: txt(inst.rut),
    region: txt(inst.nombre_region), direccion_entrega: "", plazo_dias: null,
    // Presupuesto DISPONIBLE informado por el comprador (referencial). Nunca es el precio ofertado por BFK.
    presupuesto: { tipo: "Disponible", moneda: txt(mon.moneda), estimado: null, disponible: numONull(mon.monto_disponible_clp ?? mon.monto_disponible) },
    fecha_publicacion: txt(fec.fecha_publicacion), fecha_cierre: txt(fec.fecha_cierre),
    productos: [], documentos: [], oc_emitida: false,
    origen: "listado", completar_manual: ["direccion_entrega", "plazo", "productos", "documentos"],
  };
}

const COMO_OBTENER = "Solicítalo en https://www.chilecompra.cl/api/ («Pide tu ticket», con Clave Única; llega por correo) y configúralo en Vercel como MP_TICKET_COMPRA_AGIL.";

// Diagnóstico por etapas. SOLO administradores de BFK con sesión válida; a cualquier otro se le responde 401/403
// sin ninguna información. Nunca devuelve el ticket ni datos de una compra.
// Etapas: DNS → conexión TCP → TLS → API sin ticket (espera 400) → ticket inválido de control (espera 401).
// El ticket configurado SOLO se prueba si se pide expresamente (&ticket=1), si la red respondió, y como máximo
// 1 vez cada 10 minutos por instancia (cuida la cuota diaria de ChileCompra).
// Plazo total: 25 s, siempre bajo maxDuration (30 s); cada etapa usa como máximo el tiempo que queda.
const HOST = "api2.mercadopublico.cl";
const TICKET_CONTROL = "00000000-0000-0000-0000-000000000000"; // ticket inexistente: solo para comprobar la respuesta 401
const PLAZO_TOTAL_MS = 25_000;
const conLimite = (ms, fn) => new Promise((ok) => {
  if (ms < 500) return ok({ ok: false, ms: 0, falla: "sin_tiempo" });
  const t0 = Date.now(); const fin = setTimeout(() => ok({ ok: false, ms: Date.now() - t0, falla: "demora" }), ms);
  fn(ms).then((r) => { clearTimeout(fin); ok({ ok: true, ms: Date.now() - t0, ...r }); }, (e) => { clearTimeout(fin); ok({ ok: false, ms: Date.now() - t0, falla: [e?.name, e?.code || e?.cause?.code].filter(Boolean).join(":") || "error" }); });
});
const socket = (seguro) => (ms) => new Promise((ok, mal) => {
  const o = { host: HOST, port: 443, servername: HOST };
  const s = seguro ? tlsConnect(o, () => { s.end(); ok({}); }) : netConnect(o, () => { s.end(); ok({}); });
  s.setTimeout(ms, () => s.destroy(new Error("demora")));
  s.on("error", mal);
});
const pedir = (ticket) => async (ms) => {
  const r = await fetch(`${API}/3390-246-COT26`, { headers: { ...(ticket ? { ticket } : {}), Accept: "application/json" }, signal: AbortSignal.timeout(ms) });
  const c = await r.json().catch(() => null);
  return { http: r.status, codigo_api: (c?.errors || c?.errores)?.[0]?.codigo ?? null }; // nunca el contenido
};
// Consulta real medida por partes: tiempo hasta las cabeceras y hasta el cuerpo completo. Solo devuelve
// códigos, tiempos, tamaño y conteos; nunca el contenido ni el ticket.
async function medir(url, ticket, ms) {
  const t0 = Date.now(); const out = { url_tipo: url.includes("?") ? "listado" : "detalle" };
  if (ms < 500) return { ...out, ok: false, falla: "sin_tiempo" };
  const ctrl = new AbortController(); const fin = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { ticket, Accept: "application/json" }, signal: ctrl.signal });
    out.http = r.status; out.ms_cabeceras = Date.now() - t0;
    const texto = await r.text(); out.ms_total = Date.now() - t0; out.bytes = texto.length;
    let c = null; try { c = JSON.parse(texto); } catch { /* no JSON */ }
    out.codigo_api = (c?.errors || c?.errores)?.[0]?.codigo ?? null;
    // Éxito solo con HTTP 200 y un payload válido (listado: payload.items es un arreglo; detalle: payload es un objeto).
    if (out.url_tipo === "listado") {
      out.total_resultados = c?.payload?.paginacion?.total_resultados ?? null; out.items = Array.isArray(c?.payload?.items) ? c.payload.items.length : null;
      out.payload_valido = r.status === 200 && Array.isArray(c?.payload?.items);
    } else out.payload_valido = r.status === 200 && !!c?.payload && typeof c.payload === "object";
    out.ok = true;
  } catch (e) {
    out.ok = false; out.ms_total = Date.now() - t0;
    out.falla = e?.name === "AbortError" ? (out.http ? "cuerpo_demora" : "sin_cabeceras_demora") : [e?.name, e?.cause?.code].filter(Boolean).join(":") || "error";
  } finally { clearTimeout(fin); }
  return out;
}
// Latencia desde la región donde corre la función hacia los servicios que usan las funciones de BFK
// (sin ticket, sin datos, sin consumir cuota): 3 muestras por destino, se informa la mediana en ms.
async function medirLatencias(queda) {
  const destinos = {
    supabase_auth: [`${SUPABASE_URL}/auth/v1/health`, { apikey: SUPABASE_ANON_KEY }],   // validación de sesión (todas las funciones)
    mercado_publico_oc: ["https://api.mercadopublico.cl/servicios/v1/publico/ordenesdecompra.json", {}], // /api/oc (sin ticket: error inmediato)
    compra_agil: [API, {}],                                                                // /api/compra-agil (sin ticket: 400)
    tienda_falabella: ["https://www.falabella.com/falabella-cl", {}],                      // /api/producto
    anthropic: ["https://api.anthropic.com/v1/messages", {}],                              // /api/interpretar (inactiva; sin clave: 401)
  };
  const out = {};
  for (const [k, [url, h]] of Object.entries(destinos)) {
    const ms = [];
    for (let i = 0; i < 3; i++) {
      const t = queda(4_000); if (t < 500) break;
      const t0 = Date.now();
      try { const r = await fetch(url, { method: "GET", headers: h, redirect: "manual", signal: AbortSignal.timeout(t) }); await r.arrayBuffer().catch(() => {}); ms.push(Date.now() - t0); out[k + "_http"] = r.status; }
      catch (e) { out[k + "_falla"] = e?.name || "error"; break; }
    }
    ms.sort((x, y) => x - y); out[k] = ms.length ? ms[Math.floor(ms.length / 2)] : null;
  }
  return out;
}
let diagnosticos = []; let ultimaPruebaTicket = 0;
async function diagnosticar(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false });
  if (!ses.admin) return res.status(403).json({ ok: false });
  const ahora = Date.now(); diagnosticos = diagnosticos.filter((t) => ahora - t < VENTANA_MS);
  if (diagnosticos.length >= 3) return res.status(429).json({ ok: false, error: "Espera un minuto." });
  diagnosticos.push(ahora);
  const limite = ahora + PLAZO_TOTAL_MS; const queda = (max) => Math.min(max, limite - Date.now());
  if (req.query?.latencias === "1") return res.status(200).json({ ok: true, region: process.env.VERCEL_REGION || null, latencias: await medirLatencias(queda), duracion_ms: Date.now() - ahora });
  const ticket = (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET || "").trim();
  const omitido = { ok: false, falla: "omitido" };
  const e = {};
  e.dns = await conLimite(queda(3_000), async () => ({ direcciones: (await lookup(HOST, { all: true })).length }));
  e.tcp = e.dns.ok ? await conLimite(queda(5_000), socket(false)) : omitido;
  e.tls = e.tcp.ok ? await conLimite(queda(5_000), socket(true)) : omitido;
  e.api_sin_ticket = e.tls.ok ? await conLimite(queda(6_000), pedir(null)) : omitido;
  e.ticket_control = e.api_sin_ticket.ok ? await conLimite(queda(6_000), pedir(TICKET_CONTROL)) : omitido;
  const comparar = req.query?.ticket === "comparar";
  const soloListado = req.query?.ticket === "listado";
  const pedido = req.query?.ticket === "1" || comparar || soloListado;
  const permitido = Date.now() - ultimaPruebaTicket > 10 * 60_000;
  if (!pedido) e.ticket_configurado = { ok: false, falla: "no_solicitado" };
  else if (!ticket) e.ticket_configurado = { ok: false, falla: "no_disponible_en_este_entorno" };
  else if (!e.ticket_control.ok) e.ticket_configurado = omitido;
  else if (!permitido) e.ticket_configurado = { ok: false, falla: "espera_10_minutos" };
  else if (soloListado) {
    // Solo el listado oficial filtrado por id (paginación predeterminada), 1 consulta de la cuota, sin llamar al detalle.
    ultimaPruebaTicket = Date.now();
    e.ticket_configurado = { solo_listado: true, listado: await medir(`${API}?id=3390-246-COT26`, ticket, queda(20_000)) };
  }
  else if (comparar) {
    // Misma Compra Ágil por las dos vías oficiales, en paralelo (2 consultas de la cuota): listado filtrado por id
    // (1 resultado) y detalle. Ambas con el mismo plazo, dentro del límite total.
    ultimaPruebaTicket = Date.now(); const ms = queda(20_000);
    const [listado, detalle] = await Promise.all([medir(`${API}?id=3390-246-COT26`, ticket, ms), medir(`${API}/3390-246-COT26`, ticket, ms)]);
    e.ticket_configurado = { comparacion: true, listado, detalle };
  }
  else { ultimaPruebaTicket = Date.now(); e.ticket_configurado = await conLimite(queda(20_000), pedir(ticket)); }
  const h = e.ticket_configurado.http;
  const L = e.ticket_configurado.listado, D = e.ticket_configurado.detalle;
  const rech = (x) => x?.http === 401 || x?.http === 403;
  const conclusionListado = !e.ticket_configurado.solo_listado ? null
    : L.http === 429 ? "cuota_agotada" : rech(L) ? "ticket_rechazado"
    : L.ok && L.payload_valido ? "listado_ok_ticket_aceptado"
    : L.ok && L.http === 200 ? "listado_200_sin_payload_valido"
    : L.ok ? "listado_error_api"
    : "listado_espera";
  const conclusionComparar = conclusionListado ? null : !L ? null
    : L.http === 429 || D.http === 429 ? "cuota_agotada"
    : rech(L) || rech(D) ? "ticket_rechazado"
    : L.payload_valido && D.payload_valido ? "ticket_aceptado_listado_y_detalle"
    : L.payload_valido && !D.ok ? "listado_ok_detalle_espera"
    : !L.ok && D.ok ? "detalle_ok_listado_espera"
    : !L.ok && !D.ok ? "ambas_consultas_esperan_sin_aislar"
    : "error_api";
  const conclusion = !e.dns.ok ? "falla_dns" : !e.tcp.ok ? "conexion_bloqueada_o_sin_ruta" : !e.tls.ok ? "falla_tls"
    : !e.api_sin_ticket.ok ? "la_api_no_responde_a_esta_region"
    : !e.ticket_control.ok ? "la_api_no_responde_con_ticket"
    : !pedido ? "red_ok_ticket_no_probado"
    : !ticket ? "red_ok_ticket_no_disponible_en_este_entorno"
    : !permitido ? "red_ok_espera_10_minutos_para_probar_el_ticket"
    : conclusionListado ? conclusionListado
    : conclusionComparar ? conclusionComparar
    : !e.ticket_configurado.ok ? "demora_solo_con_ticket_real"
    : h === 200 || h === 404 ? "ticket_aceptado" : h === 401 || h === 403 ? "ticket_rechazado" : h === 429 ? "cuota_agotada" : "error_api";
  return res.status(200).json({ ok: true, region: process.env.VERCEL_REGION || null, entorno: process.env.VERCEL_ENV || null, etapas: e, conclusion, duracion_ms: Date.now() - ahora });
}

export default async function handler(req, res) {
  if (req.query?.diagnostico !== undefined) return diagnosticar(req, res);
  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });
  const codigo = codigoCompraAgil(req.query?.codigo || req.query?.q);
  if (!codigo) return res.status(400).json({ ok: false, codigo: "CODIGO_INVALIDO", error: "No se reconoce un código de Compra Ágil (formato 3390-246-COT26) en lo ingresado." });
  const ticket = (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET || "").trim();
  if (!ticket) return res.status(503).json({ ok: false, codigo: "SIN_TICKET", error: `La consulta oficial de Compra Ágil requiere un ticket de ChileCompra que aún no está configurado en el servidor. ${COMO_OBTENER} Mientras tanto, ingresa los datos manualmente.` });
  if (limitado(ses.uid)) return res.status(429).json({ ok: false, codigo: "LIMITE", error: "Demasiadas consultas. Espera un minuto e intenta de nuevo." });

  // Consulta normal: LISTADO oficial filtrado por código (paginación predeterminada). El detalle
  // (/v2/compra-agil/{codigo}) hoy no responde a tiempo, por eso no se usa.
  let r;
  try { r = await fetch(`${API}?id=${encodeURIComponent(codigo)}`, { headers: { ticket, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
  catch (e) { return res.status(502).json({ ok: false, codigo: e?.name === "TimeoutError" ? "DEMORA_API" : "SIN_CONEXION", error: e?.name === "TimeoutError" ? "La API de ChileCompra no respondió a tiempo. Intenta más tarde o ingresa los datos manualmente." : "No se pudo conectar con la API de ChileCompra. Ingresa los datos manualmente." }); }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) return res.status(502).json({ ok: false, codigo: "TICKET_INVALIDO", error: `ChileCompra rechazó el ticket configurado para la API de Compra Ágil (HTTP ${r.status}). ${COMO_OBTENER}` });
  if (r.status === 429) return res.status(429).json({ ok: false, codigo: "CUOTA", error: "Se agotó la cuota diaria del ticket de ChileCompra. Se restablece al comenzar el próximo día. Ingresa los datos manualmente." });
  if (r.status === 404) return res.status(404).json({ ok: false, codigo: "NO_ENCONTRADA", error: `ChileCompra no encontró la Compra Ágil ${codigo}. Revisa el código.` });
  if (!r.ok || !Array.isArray(cuerpo?.payload?.items)) return res.status(502).json({ ok: false, codigo: "ERROR_API", error: `La API de ChileCompra respondió con un error (HTTP ${r.status}${(cuerpo?.errors || cuerpo?.errores)?.[0]?.mensaje ? `: ${(cuerpo.errors || cuerpo.errores)[0].mensaje}` : ""}). Ingresa los datos manualmente.` });

  const item = cuerpo.payload.items.find((x) => txt(x?.codigo).toUpperCase() === codigo);
  if (!item) return res.status(404).json({ ok: false, codigo: "NO_ENCONTRADA", error: `ChileCompra no encontró la Compra Ágil ${codigo}. Revisa el código o ingresa los datos manualmente.` });
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, fuente: "API oficial de Compra Ágil (ChileCompra) · listado", consultado_en: new Date().toISOString(), datos: normalizarListadoCompraAgil(item) });
}
