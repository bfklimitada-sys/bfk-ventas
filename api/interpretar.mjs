// ═══════════════════════════════════════════════════════════════
// api/interpretar.mjs — Interpretación de capturas de pantalla con IA (Claude). OPCIONAL.
//   GET  /api/interpretar  → { configurado }   (la app decide si usar IA u OCR en el dispositivo)
//   POST /api/interpretar  { imagenes: [dataURL…≤4], enlace? } → { resultado } (propuesta de ficha)
// Solo funciona si en Vercel existe ANTHROPIC_API_KEY (variable de entorno; nunca se envía al navegador).
// Sin esa variable responde "no configurado" y no llama a ningún servicio externo.
// Exige sesión BFK. No guarda nada. Instrucción a la IA: solo lo visible; nunca inventar.
// ═══════════════════════════════════════════════════════════════
import { resultadoDesdeLectura } from "../src/lib/capturaImagen.js";

const SUPABASE_URL = "https://gypywxaugwuxbgmcqntp.supabase.co";
// Clave pública (anon) del proyecto: es pública por diseño, igual que en el frontend.
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5cHl3eGF1Z3d1eGJnbWNxbnRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2MjA4MjksImV4cCI6MjA5NzE5NjgyOX0.ujdKtdhFklJEPHy1vWlm8RLgPAQlo7sNNBGd_MbmibQ";
export const dep = { fetch: (...a) => fetch(...a), env: () => process.env };

const usos = new Map();
function limitado(uid, max = 10) {
  const ahora = Date.now(); const arr = (usos.get(uid) || []).filter((t) => ahora - t < 60_000);
  if (arr.length >= max) { usos.set(uid, arr); return true; } arr.push(ahora); usos.set(uid, arr); return false;
}
async function validarSesion(req) {
  const m = String(req.headers?.authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!m) return { error: "Sesión requerida. Inicie sesión en BFK Datos.", status: 401 };
  try {
    const h = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1].trim()}` };
    const r = await dep.fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: h }); if (!r.ok) return { error: "Sesión inválida o vencida.", status: 401 };
    const u = await r.json(); if (!u?.id) return { error: "Sesión inválida.", status: 401 };
    const p = await dep.fetch(`${SUPABASE_URL}/rest/v1/perfiles?id=eq.${encodeURIComponent(u.id)}&select=id`, { headers: h });
    const f = p.ok ? await p.json() : []; if (!Array.isArray(f) || !f.length) return { error: "Usuario sin perfil autorizado en BFK.", status: 403 };
    return { uid: u.id };
  } catch { return { error: "No se pudo validar la sesión.", status: 503 }; }
}

export const INSTRUCCION = `Eres un asistente que transcribe datos de capturas de pantalla de publicaciones de productos (tiendas chilenas).
Devuelve SOLO un objeto JSON, sin texto adicional, con esta forma:
{"nombre": string|null, "marca": string|null, "modelo": string|null, "color": string|null, "descripcion": string|null,
 "especificaciones": [{"etiqueta": string, "valor": string}], "precios_visibles": [number]}
Reglas estrictas:
- Transcribe únicamente lo que se lee en las imágenes. Si un dato no aparece, usa null o una lista vacía. Nunca deduzcas, completes ni inventes.
- "nombre": el título exacto del producto tal como aparece.
- "especificaciones": solo características técnicas visibles (no precios, envíos, cuotas, vendedor, stock, garantía comercial, opiniones).
- "precios_visibles": todos los montos en pesos que aparezcan como precio del producto (sin cuotas ni descuentos porcentuales), como números enteros sin separadores.
- No incluyas disponibilidad ni costos de envío.`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const ses = await validarSesion(req);
  if (ses.error) return res.status(ses.status).json({ ok: false, error: ses.error });
  const env = dep.env(); const clave = String(env.ANTHROPIC_API_KEY || "").trim();
  if (req.method === "GET") return res.status(200).json({ ok: true, configurado: !!clave });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Método no permitido" });
  if (!clave) return res.status(503).json({ ok: false, configurado: false, error: "La interpretación con IA no está habilitada. Se usará la lectura en el dispositivo." });
  if (limitado(ses.uid)) return res.status(429).json({ ok: false, error: "Demasiadas interpretaciones por minuto. Espere un momento." });
  const b = typeof req.body === "string" ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const imgs = (Array.isArray(b.imagenes) ? b.imagenes : []).slice(0, 4).map((d) => String(d).match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)).filter(Boolean);
  if (!imgs.length) return res.status(400).json({ ok: false, error: "Envíe entre 1 y 4 imágenes (JPEG, PNG o WebP)." });
  if (imgs.some((m) => m[2].length > 3_500_000)) return res.status(413).json({ ok: false, error: "Una imagen es demasiado grande." });
  let r;
  try {
    r = await dep.fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: AbortSignal.timeout(45_000),
      headers: { "x-api-key": clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2000, temperature: 0, system: INSTRUCCION,
        messages: [{ role: "user", content: [...imgs.map((m) => ({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } })), { type: "text", text: "Transcribe los datos del producto según las reglas." }] }] }),
    });
  } catch { return res.status(502).json({ ok: false, error: "No se pudo contactar el servicio de IA." }); }
  const c = await r.json().catch(() => null);
  if (!r.ok) return res.status(502).json({ ok: false, error: `El servicio de IA respondió con error (${r.status}).` });
  const texto = (c?.content || []).filter((x) => x.type === "text").map((x) => x.text).join("");
  let d; try { d = JSON.parse(texto.replace(/^```(?:json)?\s*|\s*```$/g, "").trim()); } catch { return res.status(502).json({ ok: false, error: "La IA no devolvió datos legibles." }); }
  const s = (v) => (typeof v === "string" ? v.trim() : "");
  const lectura = { nombre: s(d.nombre), marca: s(d.marca), modelo: s(d.modelo), color: s(d.color), descripcion: s(d.descripcion),
    pares: (Array.isArray(d.especificaciones) ? d.especificaciones : []).map((p) => ({ etiqueta: s(p?.etiqueta), valor: s(p?.valor) })).filter((p) => p.etiqueta && p.valor),
    precios: [...new Set((Array.isArray(d.precios_visibles) ? d.precios_visibles : []).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 100))] };
  return res.status(200).json({ ok: true, resultado: resultadoDesdeLectura(lectura, { metodo: "ia", enlace: s(b.enlace) }) });
}
