import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// Lector de texto (OCR) del módulo Cotizaciones: se sirve desde el mismo dominio de BFK Datos (sin depender de un CDN externo).
// Se copia desde node_modules al compilar; no se guarda en el repositorio.
const ARCHIVOS_OCR = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "core/tesseract-core-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "core/tesseract-core-simd-lstm.wasm.js"],
  ["tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "core/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz", "lang/spa.traineddata.gz"],
];
const copiarOCR = () => ({
  name: "bfk-copiar-ocr", apply: "build",
  writeBundle(opciones) {
    const destino = resolve(opciones.dir || "dist", "ocr");
    for (const [origen, nombre] of ARCHIVOS_OCR) { const f = resolve(destino, nombre); mkdirSync(resolve(f, ".."), { recursive: true }); copyFileSync(resolve("node_modules", origen), f); }
  },
});

// Ayudantes internos de Vite/Rollup en un archivo propio: así los módulos que se cargan bajo demanda (jsPDF, html2canvas,
// lector de PDF) no dependen del archivo principal de la app y conservan su nombre entre publicaciones. Una pestaña que
// quedó abierta con una versión anterior sigue encontrando esos archivos (antes cambiaban de nombre en cada despliegue).
const ayudantesAparte = (id) => (id.includes("vite/preload-helper") || id.includes("commonjsHelpers") ? "vite-ayudantes" : undefined);

export default defineConfig({
  plugins: [react(), copiarOCR()],
  build: { rollupOptions: { output: { manualChunks: ayudantesAparte } } },
});
