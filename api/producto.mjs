// ═══════════════════════════════════════════════════════════════
// api/producto.mjs — Función serverless (Vercel). Módulo Cotizaciones y EETT.
//   GET /api/producto?url=<enlace del proveedor>  → propuesta de ficha + precio (el usuario la revisa)
//   GET /api/producto?imagen=<url de imagen>      → imagen como data URL (para la ficha y el PDF)
// Exige sesión BFK (Authorization: Bearer <token>), igual que /api/oc. No escribe datos.
// Seguridad: solo http(s) públicos (se bloquean direcciones internas, también tras redirecciones),
// tiempo y tamaño máximos, límite de consultas por usuario.
// ═══════════════════════════════════════════════════════════════
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extraerProducto } from "../src/lib/extraerProducto.js";

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend y en /api/oc.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";

// Dependencias de red (reemplazables solo en las pruebas locales).
export const dep = { lookup: (h, o) => lookup(h, o), fetch: (...a) => fetch(...a) };

const VENTANA_MS = 60_000; const MAX = { pagina: 30, imagen: 120 };
const usos = new Map();
function limitado(uid, tipo) {
  const ahora = Date.now(); const k = `${uid}:${tipo}`;
  const arr = (usos.get(k) || []).filter((t) => ahora - t < VENTANA_MS);
  if (arr.length >= MAX[tipo]) { usos.set(k, arr); return true; }
  arr.push(ahora); usos.set(k, arr); return false;
}

async function validarSesion(req) {
  const m = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "Sesión requerida. Inicie sesión en BFK Datos.", status: 401 };
  const token = m[1].trim();
  try {
    const r = await dep.fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    if (!r.ok) return { error: "Sesión inválida o vencida. Vuelva a iniciar sesión.", status: 401 };
    const u = await r.json(); if (!u?.id) return { error: "Sesión inválida.", status: 401 };
    const p = await dep.fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(u.id)}&select=id`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
    const filas = p.ok ? await p.json() : [];
    if (!Array.isArray(filas) || !filas.length) return { error: "Usuario sin perfil autorizado en BFK.", status: 403 };
    return { uid: u.id };
  } catch { return { error: "No se pudo validar la sesión. Intente de nuevo.", status: 503 }; }
}

// ── Direcciones permitidas: solo públicas ──
export function ipPrivada(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith("::ffff:")) return ipPrivada(x.slice(7));
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb") || x.startsWith("ff");
}
export async function urlPermitida(texto) {
  let u; try { u = new URL(String(texto || "").trim()); } catch { return { error: "El enlace no es válido." }; }
  if (!/^https?:$/.test(u.protocol)) return { error: "Solo se aceptan enlaces http(s)." };
  if (u.username || u.password) return { error: "El enlace no puede incluir usuario o contraseña." };
  if (u.port && !["80", "443"].includes(u.port)) return { error: "El enlace usa un puerto no permitido." };
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) || /(^|\.)(localhost|local|internal|lan)$/i.test(host) || !host.includes(".")) return { error: "El enlace debe ser de un sitio público." };
  try {
    const ips = await dep.lookup(host, { all: true });
    if (!ips.length || ips.some((d) => ipPrivada(d.address))) return { error: "El enlace apunta a una dirección no permitida." };
  } catch { return { error: "No se encontró el sitio del enlace (dirección inexistente o caída)." }; }
  return { url: u };
}

// Páginas de verificación antibots / inicio de sesión: nunca se interpretan como producto.
export const MURO_ANTIBOTS = /account-verification|captcha|challenge|\/gz\/|\/login|\/signin|cdn-cgi|px-captcha|validate\.perfdrive/i;
const MSG_BLOQUEO = "Esta tienda no permite la lectura automática. Sube capturas de pantalla de la publicación (se leerán para completar la ficha) o ingresa los datos manualmente; el enlace se conserva.";

const CABECERAS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  "Accept-Language": "es-CL,es;q=0.9", Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};
// Descarga con redirecciones manuales (cada destino se vuelve a validar), tiempo y tamaño máximos.
async function descargar(url, { maxBytes, tiempo = 15_000 }) {
  let actual = url;
  for (let salto = 0; salto < 5; salto++) {
    const ok = await urlPermitida(actual); if (ok.error) return { error: ok.error };
    let r;
    try { r = await dep.fetch(ok.url.href, { headers: CABECERAS, redirect: "manual", signal: AbortSignal.timeout(tiempo) }); }
    catch (e) { return { error: e?.name === "TimeoutError" ? "El sitio del proveedor tardó demasiado en responder." : "No se pudo conectar con el sitio del proveedor." }; }
    if ([301, 302, 303, 307, 308].includes(r.status)) { const loc = r.headers.get("location"); if (!loc) return { error: "Redirección inválida del proveedor." }; actual = new URL(loc, ok.url).href; if (MURO_ANTIBOTS.test(new URL(actual).pathname + new URL(actual).hostname)) return { error: MSG_BLOQUEO, status: r.status, bloqueo: true }; continue; }
    if (r.status === 404 || r.status === 410) return { error: "El enlace ya no existe en el sitio del proveedor (página no encontrada).", status: r.status };
    if (r.status === 403 || r.status === 429 || r.status === 503 && /cloudflare/i.test(r.headers.get("server") || "")) return { error: MSG_BLOQUEO, status: r.status, bloqueo: true };
    if (!r.ok) return { error: `El proveedor respondió con error (${r.status}).`, status: r.status };
    const largo = Number(r.headers.get("content-length") || 0); if (largo > maxBytes) return { error: "El contenido es demasiado grande." };
    const lector = r.body.getReader(); const partes = []; let total = 0;
    for (;;) { const { done, value } = await lector.read(); if (done) break; total += value.length; if (total > maxBytes) { try { await lector.cancel(); } catch { /* */ } return { error: "El contenido es demasiado grande." }; } partes.push(value); }
    return { buffer: Buffer.concat(partes), tipo: r.headers.get("content-type") || "", final: actual };
  }
  return { error: "Demasiadas redirecciones." };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Método no permitido" });
  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });
  const q = req.query || {};
  if (q.imagen) {
    if (limitado(ses.uid, "imagen")) return res.status(429).json({ ok: false, error: "Demasiadas imágenes por minuto. Espere un momento." });
    const d = await descargar(String(q.imagen), { maxBytes: 5 * 1024 * 1024, tiempo: 12_000 });
    if (d.error) return res.status(422).json({ ok: false, error: d.error });
    const tipo = d.tipo.split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(tipo)) return res.status(422).json({ ok: false, error: "El enlace no es una imagen compatible." });
    return res.status(200).json({ ok: true, dataUrl: `data:${tipo};base64,${d.buffer.toString("base64")}` });
  }
  if (!q.url) return res.status(400).json({ ok: false, error: "Falta el enlace del producto." });
  if (limitado(ses.uid, "pagina")) return res.status(429).json({ ok: false, error: "Demasiadas consultas por minuto. Espere un momento." });
  const d = await descargar(String(q.url), { maxBytes: 6 * 1024 * 1024 });
  if (d.error) return res.status(422).json({ ok: false, error: d.error, status: d.status || null, bloqueo: !!d.bloqueo });
  if (!/html|xml/i.test(d.tipo)) return res.status(422).json({ ok: false, error: "El enlace no corresponde a una página de producto." });
  const html = d.buffer.toString("utf8");
  if (MURO_ANTIBOTS.test(new URL(d.final).pathname) || /<title>\s*(just a moment|attention required|cloudflare|verifica|security check)/i.test(html))
    return res.status(422).json({ ok: false, error: MSG_BLOQUEO, bloqueo: true });
  const datos = extraerProducto(html, d.final);
  // Sin ninguna señal de producto (precio, especificaciones, imágenes ni datos estructurados): no se propone una ficha vacía.
  if (!datos.precio_origen && !datos.ficha.especificaciones.length && !datos.ficha.imagenes.length && !datos.metodos.includes("json-ld"))
    return res.status(422).json({ ok: false, error: "La página no entregó datos del producto (puede ser una verificación antibots o una página que no es de producto). Sube capturas de pantalla de la publicación o ingresa los datos manualmente.", bloqueo: true });
  return res.status(200).json({ ok: true, enlace: d.final, ...datos });
}
