// Genera src/lib/atajoSafari.generado.js: el código autocontenido que se pega en el Atajo de iPhone.
// Uso: node scripts/generar-atajo.mjs   (volver a ejecutar si cambia extraerProducto.js, captura.js o src/atajo/entrada.js)
import { buildSync } from "esbuild";
import { writeFileSync } from "node:fs";
const r = buildSync({ entryPoints: ["src/atajo/entrada.js"], bundle: true, minify: true, format: "iife", target: ["safari15"], write: false, legalComments: "none" });
const codigo = r.outputFiles[0].text.trim();
writeFileSync("src/lib/atajoSafari.generado.js",
  "// ARCHIVO GENERADO por scripts/generar-atajo.mjs — no editar a mano.\n" +
  "// Código del Atajo de iPhone; \"__BFK_APP__\" se reemplaza por la dirección de BFK Datos al copiarlo.\n" +
  `export const CODIGO_ATAJO_PLANTILLA = ${JSON.stringify(codigo)};\n` +
  "export const codigoAtajo = (app) => CODIGO_ATAJO_PLANTILLA.split(\"__BFK_APP__\").join(String(app || \"\").replace(/\\/+$/, \"\"));\n");
console.log(`atajo generado: ${codigo.length} caracteres`);
