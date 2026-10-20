// Acceso a la base para la clasificación tributaria (funciones trib_* y depósito «trib-respaldos»). Ver clasificacionTributaria.js.
import { SUPABASE_URL, hdrs } from "./supabase.jsx";

// ── Acceso a la base ──
async function rpc(t, fn, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: hdrs(t), body: JSON.stringify(body) });
  const c = await r.json().catch(() => null);
  if (!r.ok) throw new Error(String(c?.message || `HTTP ${r.status}`).replace(/^TRIB(423|409)?:\s*/, ""));
  return c;
}
// null = la migración aún no está instalada (la sección se muestra como «pendiente de habilitar»).
export async function cargarClasificaciones(t) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/trib_clasificaciones?select=*&order=solicitado_en.desc&limit=2000`, { headers: hdrs(t) });
  if (!r.ok) return null;
  const j = await r.json().catch(() => null);
  return Array.isArray(j) ? j : null;
}
export const solicitarClasificacion = (t, p) => rpc(t, "trib_solicitar_clasificacion", { p });
export const resolverClasificacion = (t, id, decision, observacion) => rpc(t, "trib_resolver_clasificacion", { p_id: id, p_decision: decision, p_observacion: observacion || null });
export const anularSolicitud = (t, id) => rpc(t, "trib_anular_solicitud", { p_id: id });
export const heredarDeCotizacion = (t, ocId, procedimiento) => rpc(t, "trib_heredar_de_cotizacion", { p_oc_id: ocId, p_procedimiento: procedimiento || null });

// Documento de respaldo al depósito privado «trib-respaldos» (ruta = huella SHA-256; no se reemplaza ni se borra).
export const TIPOS_RESPALDO = ["application/pdf", "image/png", "image/jpeg"];
export async function subirRespaldo(t, ambito, id, archivo) {
  if (!archivo) throw new Error("Elige el archivo de respaldo.");
  if (!TIPOS_RESPALDO.includes(archivo.type)) throw new Error("El respaldo debe ser PDF, PNG o JPG.");
  if (archivo.size > 10 * 1024 * 1024) throw new Error("El respaldo no puede superar 10 MB.");
  const buf = await archivo.arrayBuffer();
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((x) => x.toString(16).padStart(2, "0")).join("");
  const ext = archivo.type === "application/pdf" ? "pdf" : archivo.type === "image/png" ? "png" : "jpg";
  const ruta = `${ambito}/${encodeURIComponent(String(id))}/${sha256}.${ext}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/trib-respaldos/${ruta}`, { method: "POST", headers: { ...hdrs(t), "Content-Type": archivo.type }, body: buf });
  if (!r.ok && r.status !== 409 && !(r.status === 400 && /exist|duplicate/i.test(await r.clone().text()))) throw new Error("No se pudo subir el respaldo");
  return { ruta: `trib-respaldos/${ruta}`, sha256, nombre: archivo.name };
}
export async function abrirRespaldo(t, ruta) {
  const p = String(ruta || "").replace(/^trib-respaldos\//, "");
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/trib-respaldos/${p}`, { headers: hdrs(t) });
  if (!r.ok) throw new Error("No se pudo abrir el respaldo");
  return URL.createObjectURL(await r.blob());
}
