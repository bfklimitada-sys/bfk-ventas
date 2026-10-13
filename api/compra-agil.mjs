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

// Diagnóstico mínimo SIN sesión: ¿el ticket configurado en el servidor es aceptado por la API de Compra Ágil?
// Solo devuelve el código HTTP de ChileCompra (nunca el ticket ni datos de la compra). Máximo 3 consultas por minuto.
let diagnosticos = [];
async function diagnosticar(req, res) {
  const ahora = Date.now(); diagnosticos = diagnosticos.filter((t) => ahora - t < VENTANA_MS);
  if (diagnosticos.length >= 3) return res.status(429).json({ ok: false, error: "Espera un minuto." });
  diagnosticos.push(ahora);
  const origen = (process.env.MP_TICKET_COMPRA_AGIL || "").trim() ? "MP_TICKET_COMPRA_AGIL" : (process.env.MP_TICKET || "").trim() ? "MP_TICKET" : null;
  if (!origen) return res.status(200).json({ ok: true, ticket_configurado: false });
  const codigo = codigoCompraAgil(req.query?.diagnostico) || "3390-246-COT26";
  let estado = null, falla = null;
  try { const r = await fetch(`${API}/${encodeURIComponent(codigo)}`, { headers: { ticket: (process.env.MP_TICKET_COMPRA_AGIL || process.env.MP_TICKET).trim(), Accept: "application/json" }, signal: AbortSignal.timeout(25_000) }); estado = r.status; }
  // Solo el tipo de error (nunca el mensaje, que podría incluir el valor de la cabecera).
  catch (e) { estado = "sin_conexion"; falla = [e?.name, e?.cause?.code || e?.cause?.name].filter(Boolean).join(":") || "desconocida"; }
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, ticket_configurado: true, origen, codigo, http_chilecompra: estado, ...(falla ? { falla } : {}), ticket_aceptado: estado === 200 || estado === 404 });
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
  catch (e) { return res.status(502).json({ ok: false, codigo: "SIN_CONEXION", error: e?.name === "TimeoutError" ? "La API de ChileCompra no respondió a tiempo. Intenta más tarde o ingresa los datos manualmente." : "No se pudo conectar con la API de ChileCompra. Ingresa los datos manualmente." }); }
  const cuerpo = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) return res.status(502).json({ ok: false, codigo: "TICKET_INVALIDO", error: `ChileCompra rechazó el ticket configurado para la API de Compra Ágil (HTTP ${r.status}). ${COMO_OBTENER}` });
  if (r.status === 429) return res.status(429).json({ ok: false, codigo: "CUOTA", error: "Se agotó la cuota diaria del ticket de ChileCompra. Se restablece al comenzar el próximo día. Ingresa los datos manualmente." });
  if (r.status === 404) return res.status(404).json({ ok: false, codigo: "NO_ENCONTRADA", error: `ChileCompra no encontró la Compra Ágil ${codigo}. Revisa el código.` });
  if (!r.ok || !cuerpo?.payload) return res.status(502).json({ ok: false, codigo: "ERROR_API", error: `La API de ChileCompra respondió con un error (HTTP ${r.status}${(cuerpo?.errors || cuerpo?.errores)?.[0]?.mensaje ? `: ${(cuerpo.errors || cuerpo.errores)[0].mensaje}` : ""}). Ingresa los datos manualmente.` });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ ok: true, fuente: "API oficial de Compra Ágil (ChileCompra)", consultado_en: new Date().toISOString(), datos: normalizarCompraAgil(cuerpo.payload) });
}
