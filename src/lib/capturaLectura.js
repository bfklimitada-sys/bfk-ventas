import { importarModulo } from "./cargaModulos.js";
// Lectura de capturas de pantalla en el navegador (iPhone, Android o PC).
// 1) Si el servidor tiene la IA habilitada (clave autorizada), se interpreta con IA.
// 2) Si no, o si la IA falla, se lee el texto con OCR en el mismo dispositivo (Tesseract.js, gratuito; las
//    imágenes no salen del equipo; el lector y el modelo de idioma se sirven desde el propio dominio de BFK Datos).
// En ambos casos el resultado es una PROPUESTA de ficha que el usuario revisa antes de guardar.
import { normalizarImagen } from "./cotizacionesDatos.js";
import { lecturaDesdeTexto, resultadoDesdeLectura } from "./capturaImagen.js";

let iaCache = null;
export async function iaDisponible(token) {
  if (iaCache !== null) return iaCache;
  try { const r = await fetch("/api/interpretar", { headers: { Authorization: `Bearer ${token}` } }); const c = await r.json().catch(() => null); iaCache = !!(r.ok && c?.configurado); }
  catch { iaCache = false; }
  return iaCache;
}

async function conIA(token, imagenes, enlace) {
  const r = await fetch("/api/interpretar", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ imagenes, enlace }) });
  const c = await r.json().catch(() => null);
  if (!r.ok || !c?.ok) throw new Error(c?.error || `La IA no respondió (HTTP ${r.status}).`);
  return c.resultado;
}

const conLimite = (promesa, ms, mensaje) => Promise.race([promesa, new Promise((_, mal) => setTimeout(() => mal(new Error(mensaje)), ms))]);

async function conOCR(imagenes, enlace, onProgreso) {
  const { createWorker } = await importarModulo(() => import("tesseract.js"));
  onProgreso?.("Preparando la lectura de texto (la primera vez descarga unos MB)…");
  // Archivos del lector servidos desde el mismo dominio de BFK Datos (vite.config.js los copia a /ocr al compilar).
  const worker = await conLimite(createWorker("spa", 1, {
    workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang", workerBlobURL: false, cacheMethod: "write",
    logger: (m) => { if (m.status === "recognizing text") onProgreso?.(`Leyendo texto… ${Math.round((m.progress || 0) * 100)}%`); },
  }), 90_000, "No se pudo preparar el lector de texto (revisa la conexión e intenta de nuevo, o ingresa los datos manualmente).");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "3" }); // segmentación automática (la predeterminada, "bloque único", omite textos grandes como el precio)
    let texto = "";
    for (let i = 0; i < imagenes.length; i++) {
      onProgreso?.(`Leyendo captura ${i + 1} de ${imagenes.length}…`);
      const { data } = await conLimite(worker.recognize(imagenes[i]), 90_000, "La lectura de la captura tardó demasiado. Intenta con una imagen más pequeña o ingresa los datos manualmente.");
      texto += (data?.text || "") + "\n";
    }
    return resultadoDesdeLectura(lecturaDesdeTexto(texto), { metodo: "ocr", enlace });
  } finally { worker.terminate().catch(() => {}); }
}

// archivos: File[] (imágenes). Devuelve el mismo formato que la consulta por enlace.
export async function leerCapturas(token, archivos, { enlace = "", onProgreso } = {}) {
  const lista = [...(archivos || [])].filter((f) => /^image\//.test(f.type || "")).slice(0, 4);
  if (!lista.length) throw new Error("Elige al menos una imagen.");
  onProgreso?.("Preparando las imágenes…");
  if (await iaDisponible(token)) {
    try {
      const imgs = []; for (const f of lista) imgs.push(await normalizarImagen(f, 1568));
      onProgreso?.("Interpretando las capturas con IA…");
      return await conIA(token, imgs, enlace);
    } catch (e) { onProgreso?.(`IA no disponible (${e.message}); se usará la lectura en el dispositivo…`); }
  }
  const imgs = []; for (const f of lista) imgs.push(await normalizarImagen(f, 2200, "image/png")); // sin pérdida para el OCR
  return conOCR(imgs, enlace, onProgreso);
}
