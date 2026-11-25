// Generación y nueva descarga de los documentos de la oferta (25/11/2026), compartida por la cotización (Mercado Público y
// Ventas privadas) y por la orden de venta. Carga perezosa de jsPDF, fuentes, logo e imágenes.
import { importarModulo } from "./cargaModulos";
import { logoBFK, imagenesDocumento } from "./cotizacionesDatos";
import { descargarBlob } from "./eettPdf";
import { cargarFuentes } from "./fuentesDocumento";
import { generarDocumentoOferta, GENERADOR } from "./documentosOferta";
import { leerModeloEmitido } from "./documentosOfertaDatos";
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
