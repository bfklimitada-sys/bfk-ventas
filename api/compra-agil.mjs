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
    const p = await fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(u.id)}&select=id`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const filas = p.ok ? await p.json() : [];
    if (!Array.isArray(filas) || !filas.length) return { error: "Usuario sin perfil autorizado en BFK.", status: 403 };
    return { uid: u.id };
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

const COMO_OBTENER = "Solicítalo en https://www.chilecompra.cl/api/ («Pide tu ticket», con Clave Única; llega por correo) y configúralo en Vercel como MP_TICKET_COMPRA_AGIL.";

// Diagnóstico por etapas SIN sesión (sin datos ni credenciales en la respuesta). Máximo 3 por minuto.
// Distingue: DNS → conexión TCP → TLS → API sin ticket (espera 400) → ticket inválido de control (espera 401)
// → ticket configurado (200/404 = aceptado; 401/403 = rechazado). Informa la región real de ejecución.
// Los tiempos de espera NO se amplían (ticket real: 20 s, igual que la consulta normal); si una etapa falla, las siguientes se omiten.
// Peor caso total < 30 s (maxDuration).
const HOST = "api2.mercadopublico.cl";
const TICKET_CONTROL = "00000000-0000-0000-0000-000000000000"; // ticket inexistente: solo para comprobar la respuesta 401
const conLimite = (ms, fn) => new Promise((ok) => {
  const t0 = Date.now(); const fin = setTimeout(() => ok({ ok: false, ms: Date.now() - t0, falla: "demora" }), ms);
  fn().then((r) => { clearTimeout(fin); ok({ ok: true, ms: Date.now() - t0, ...r }); }, (e) => { clearTimeout(fin); ok({ ok: false, ms: Date.now() - t0, falla: [e?.name, e?.code || e?.cause?.code].filter(Boolean).join(":") || "error" }); });
});
const socket = (seguro) => new Promise((ok, mal) => {
  const o = { host: HOST, port: 443, servername: HOST };
  const s = seguro ? tlsConnect(o, () => { s.end(); ok({}); }) : netConnect(o, () => { s.end(); ok({}); });
  s.setTimeout(5_200, () => s.destroy(new Error("demora")));
  s.on("error", mal);
});
const pedir = (ticket, ms) => async () => {
  const r = await fetch(`${API}/3390-246-COT26`, { headers: { ...(ticket ? { ticket } : {}), Accept: "application/json" }, signal: AbortSignal.timeout(ms + 200) });
  const c = await r.json().catch(() => null);
  return { http: r.status, codigo_api: (c?.errors || c?.errores)?.[0]?.codigo ?? null }; // nunca el contenido
};
let diagnosticos = [];
async function diagnosticar(req, res) {
  const ahora = Date.now(); diagnosticos = diagnosticos.filter((t) => ahora - t < VENTANA_MS);
  if (diagnosticos.length >= 3) return res.status(429).json({ ok: false, error: "Espera un minuto." });
  diagnosticos.push(ahora);
  const ticket = (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET || "").trim();
  const origen = (process.env.MP_TICKET_COMPRA_AGIL || "").trim() ? "MP_TICKET_COMPRA_AGIL" : ticket ? "MP_TICKET" : null;
  const e = {};
  e.dns = await conLimite(3_000, async () => ({ direcciones: (await lookup(HOST, { all: true })).length }));
  e.tcp = e.dns.ok ? await conLimite(5_000, () => socket(false)) : { ok: false, falla: "omitido" };
  e.tls = e.tcp.ok ? await conLimite(5_000, () => socket(true)) : { ok: false, falla: "omitido" };
  e.api_sin_ticket = e.tls.ok ? await conLimite(6_000, pedir(null, 6_000)) : { ok: false, falla: "omitido" };
  e.ticket_control = e.api_sin_ticket.ok ? await conLimite(6_000, pedir(TICKET_CONTROL, 6_000)) : { ok: false, falla: "omitido" };
  e.ticket_configurado = !ticket ? { ok: false, falla: "sin_ticket" } : e.ticket_control.ok ? await conLimite(20_000, pedir(ticket, 20_000)) : { ok: false, falla: "omitido" };
  const h = e.ticket_configurado.http;
  const conclusion = !e.dns.ok ? "falla_dns" : !e.tcp.ok ? "conexion_bloqueada_o_sin_ruta" : !e.tls.ok ? "falla_tls"
    : !e.api_sin_ticket.ok ? "la_api_no_responde_a_esta_region"
    : !ticket ? "ticket_no_configurado"
    : !e.ticket_control.ok ? "la_api_no_responde_con_ticket"
    : !e.ticket_configurado.ok ? "demora_solo_con_ticket_real"
    : h === 200 || h === 404 ? "ticket_aceptado" : h === 401 || h === 403 ? "ticket_rechazado" : h === 429 ? "cuota_agotada" : "error_api";
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, region: process.env.VERCEL_REGION || null, ticket_configurado: !!ticket, origen, etapas: e, conclusion });
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

  let r;
  try { r = await fetch(`${API}/${encodeURIComponent(codigo)}`, { headers: { ticket, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) }); }
  catch (e) { return res.status(502).json({ ok: false, codigo: e?.name === "TimeoutError" ? "DEMORA_API" : "SIN_CONEXION", error: e?.name === "TimeoutError" ? "La API de ChileCompra no respondió a tiempo. Intenta más tarde o ingresa los datos manualmente." : "No se pudo conectar con la API de ChileCompra. Ingresa los datos manualmente." }); }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) return res.status(502).json({ ok: false, codigo: "TICKET_INVALIDO", error: `ChileCompra rechazó el ticket configurado para la API de Compra Ágil (HTTP ${r.status}). ${COMO_OBTENER}` });
  if (r.status === 429) return res.status(429).json({ ok: false, codigo: "CUOTA", error: "Se agotó la cuota diaria del ticket de ChileCompra. Se restablece al comenzar el próximo día. Ingresa los datos manualmente." });
  if (r.status === 404) return res.status(404).json({ ok: false, codigo: "NO_ENCONTRADA", error: `ChileCompra no encontró la Compra Ágil ${codigo}. Revisa el código.` });
  if (!r.ok || !cuerpo?.payload) return res.status(502).json({ ok: false, codigo: "ERROR_API", error: `La API de ChileCompra respondió con un error (HTTP ${r.status}${(cuerpo?.errors || cuerpo?.errores)?.[0]?.mensaje ? `: ${(cuerpo.errors || cuerpo.errores)[0].mensaje}` : ""}). Ingresa los datos manualmente.` });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, fuente: "API oficial de Compra Ágil (ChileCompra)", consultado_en: new Date().toISOString(), datos: normalizarCompraAgil(cuerpo.payload) });
}
