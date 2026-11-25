// Datos de la «Documentación de la oferta» (25/11/2026): condiciones comerciales y matriz de cumplimiento por cotización
// (oferta_condiciones) e historial inalterable de documentos emitidos (oferta_documentos). Escritura solo por RPC.
// Si la migración BORRADOR-2026-11-25-documentos-oferta.sql aún no está instalada, la app lo detecta (tabla inexistente)
// y permite vista previa y descarga, pero no emitir ni guardar condiciones (lo informa: nunca pierde datos en silencio).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";
import { serializarModelo, huellaTexto, GENERADOR } from "./documentosOferta.js";

const cab = (t, extra = {}) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });
export class ErrorOferta extends Error { constructor(mensaje, codigo, estado) { super(mensaje); this.codigo = codigo; this.estado = estado; } }
const NO_INSTALADA = ["PGRST205", "42P01", "PGRST202", "42883"];

async function pedir(t, ruta, opciones = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { ...opciones, headers: cab(t, { "Content-Type": "application/json", ...(opciones.headers || {}) }) });
  const texto = await r.text(); let cuerpo = null; try { cuerpo = texto ? JSON.parse(texto) : null; } catch { cuerpo = texto; }
  if (!r.ok) {
    const codigo = cuerpo?.code || ""; const msg = String(cuerpo?.message || cuerpo || `HTTP ${r.status}`);
    if (NO_INSTALADA.includes(codigo) || r.status === 404) throw new ErrorOferta("La actualización de documentos de la oferta aún no está instalada.", "NO_INSTALADA", r.status);
    const corto = msg.replace(/^OFERTA_[A-Z]+:\s*/, "");
    throw new ErrorOferta(corto, (msg.match(/^OFERTA_[A-Z]+/) || [codigo])[0], r.status);
  }
  return cuerpo;
}

// canal: "mp" | "vp"
export async function leerCondicionesOferta(t, canal, cotizacionId) {
  const filas = await pedir(t, `oferta_condiciones?select=condiciones,matriz,actualizado_en&canal=eq.${canal}&cotizacion_id=eq.${encodeURIComponent(cotizacionId)}`);
  return filas?.[0] || { condiciones: {}, matriz: [], actualizado_en: null };
}
export const guardarCondicionesOferta = (t, canal, cotizacionId, condiciones, matriz) =>
  pedir(t, "rpc/oferta_guardar_condiciones", { method: "POST", body: JSON.stringify({ p_canal: canal, p_cotizacion: cotizacionId, p_condiciones: condiciones || {}, p_matriz: matriz || [] }) });
export async function listarDocumentosOferta(t, canal, cotizacionId) {
  return (await pedir(t, `oferta_documentos?select=id,tipo,version,generador,huella_contenido,huella_modelo,huella_pdf,paginas,nombre_archivo,emitido_por_nombre,emitido_en&canal=eq.${canal}&cotizacion_id=eq.${encodeURIComponent(cotizacionId)}&order=emitido_en.desc`)) || [];
}
export async function leerModeloEmitido(t, id) {
  const filas = await pedir(t, `oferta_documentos?select=id,tipo,version,modelo,generador,huella_modelo,huella_pdf,nombre_archivo&id=eq.${encodeURIComponent(id)}`);
  if (!filas?.[0]) throw new ErrorOferta("No se encontró el documento emitido.", "NO_ENCONTRADO", 404);
  return filas[0];
}
export const emitirDocumentoOferta = (t, canal, cotizacionId, { tipo, modelo, huellaContenido, huellaModelo, huellaPdf, paginas, nombre }) =>
  pedir(t, "rpc/oferta_emitir_documento", { method: "POST", body: JSON.stringify({ p_canal: canal, p_cotizacion: cotizacionId, p_tipo: tipo, p_version: modelo.version,
    p_modelo: modelo, p_generador: GENERADOR, p_huella_contenido: huellaContenido, p_huella_modelo: huellaModelo, p_huella_pdf: huellaPdf, p_paginas: paginas, p_nombre: nombre }) });

// Huella del CONTENIDO (el modelo sin número de versión): la misma información conserva su versión en los tres documentos.
export const huellaContenido = (modelo) => huellaTexto(serializarModelo({ ...modelo, version: 0 }));
// Versión que corresponde a un modelo según el historial: la de una emisión con la misma información o la siguiente.
export function versionPara(historial, huella) {
  const misma = (historial || []).filter((d) => d.huella_contenido === huella).map((d) => d.version);
  if (misma.length) return Math.max(...misma);
  return (historial || []).reduce((m, d) => Math.max(m, d.version || 0), 0) + 1;
}
