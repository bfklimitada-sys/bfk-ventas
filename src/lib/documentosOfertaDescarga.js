// Generación y nueva descarga de los documentos de la oferta (25/11/2026), compartida por la cotización (Mercado Público y
// Ventas privadas) y por la orden de venta. Carga perezosa de jsPDF, fuentes, logo e imágenes.
import { importarModulo } from "./cargaModulos";
import { logoBFK, imagenesDocumento } from "./cotizacionesDatos";
import { descargarBlob } from "./eettPdf";
import { cargarFuentes } from "./fuentesDocumento";
import { generarDocumentoOferta, GENERADOR, revisarModeloOferta } from "./documentosOferta";
import { leerModeloEmitido, leerCondicionesOferta, listarDocumentosOferta, huellaContenido, versionPara } from "./documentosOfertaDatos";
import logoUrl from "../assets/bfk-logo.jpg";

export async function generarDocumento(token, tipo, modelo) {
  const { jsPDF } = await importarModulo(() => import("jspdf"));
  const refs = (modelo.items || []).flatMap((it) => it.ficha?.imagenes || []);
  const [fuentes, logo, imagenes] = await Promise.all([cargarFuentes(), logoBFK(logoUrl), imagenesDocumento(token, refs)]);
  return generarDocumentoOferta(tipo, modelo, { jsPDF, fuentes, logo, imagenes });
}

// Vuelve a generar un documento emitido desde su modelo congelado y lo descarga con su nombre original. Devuelve
// { identico } (si la huella del PDF coincide con la registrada al emitir).
export async function descargarDocumentoEmitido(token, id) {
  const e = await leerModeloEmitido(token, id);
  if (e.generador !== GENERADOR) throw new Error(`Este documento se emitió con el generador «${e.generador}», que ya no está disponible.`);
  const r = await generarDocumento(token, e.tipo, e.modelo);
  descargarBlob(r.blob, e.nombre_archivo);
  return { identico: r.huellaPdf === e.huella_pdf, nombre: e.nombre_archivo };
}

// Cotización económica fuera de la sección «Documentos» (Ventas privadas, 25/11/2026): botón «PDF de la cotización» de la
// pestaña Precios y «PDF cotización aprobada» de la orden de venta. Mismo generador, condiciones y versión que la sección
// «Documentos»; NO emite ni registra nada. Si ese mismo contenido ya se emitió como cotización, el PDF es idéntico al emitido
// (mismo nombre). El nombre no indica si está emitido (25/11/2026: nombre simple).
// construir({ version, condiciones, matriz }) → Promise<modelo público>.
export async function cotizacionEconomica(token, canal, cotizacionId, construir) {
  let condiciones = {}, matriz = [], historial = [];
  if (cotizacionId) {
    try {
      const [c, h] = await Promise.all([leerCondicionesOferta(token, canal, cotizacionId), listarDocumentosOferta(token, canal, cotizacionId)]);
      condiciones = c?.condiciones || {}; matriz = c?.matriz || []; historial = h || [];
    } catch (e) { if (e?.codigo !== "NO_INSTALADA") throw e; }   // sin la migración: sin condiciones guardadas ni historial
  }
  const m0 = await construir({ version: 1, condiciones, matriz });
  const hc = await huellaContenido(m0);
  const modelo = { ...m0, version: versionPara(historial, hc) };
  const r = await generarDocumento(token, "cotizacion", modelo);
  const emitida = historial.some((d) => d.tipo === "cotizacion" && d.huella_contenido === hc && d.version === modelo.version);
  return { ...r, emitida, modelo, avisos: revisarModeloOferta(modelo, "cotizacion") };
}
