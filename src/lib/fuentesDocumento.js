// Fuente de los documentos de la oferta (25/11/2026): Liberation Sans 2.1, de libre uso (SIL OFL 1.1) y con métricas
// idénticas a Arial (mismo ancho de cada carácter: los textos ocupan exactamente lo mismo que en Arial). Arial no puede
// incluirse dentro de una aplicación web por su licencia. Los archivos se sirven sin modificar desde /fuentes/ (con su
// licencia) y se cargan solo al generar un PDF. jsPDF incorpora al PDF únicamente los caracteres usados.
export const FAMILIA = "LiberationSans";
const ARCHIVOS = { normal: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf" };

let cache = null;
const base64 = (buf) => {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
// Navegador: descarga (una vez por sesión) los dos archivos desde el propio dominio de BFK Datos.
export async function cargarFuentes(base = "/fuentes/") {
  if (cache) return cache;
  const leer = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(`No se pudo cargar la fuente ${f} (HTTP ${r.status})`); return base64(await r.arrayBuffer()); };
  const [normal, bold] = await Promise.all([leer(ARCHIVOS.normal), leer(ARCHIVOS.bold)]);
  cache = { normal, bold };
  return cache;
}
// Registra la fuente en un documento jsPDF. fuentes = { normal, bold } en base64.
export function registrarFuentes(doc, fuentes) {
  if (!fuentes?.normal || !fuentes?.bold) return false;
  doc.addFileToVFS(ARCHIVOS.normal, fuentes.normal); doc.addFont(ARCHIVOS.normal, FAMILIA, "normal");
  doc.addFileToVFS(ARCHIVOS.bold, fuentes.bold); doc.addFont(ARCHIVOS.bold, FAMILIA, "bold");
  return true;
}
