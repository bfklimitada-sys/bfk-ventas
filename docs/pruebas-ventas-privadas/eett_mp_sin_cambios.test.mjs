// Las EETT de Mercado Público NO cambian con las opciones agregadas para Ventas privadas (06/11/2026).
// Genera los mismos PDF con lib/eettPdf.js de la rama y con el de main (git show origin/main), y compara los bytes
// (descontando solo la fecha de creación y el identificador aleatorio del archivo) y el texto por página.
// Uso: node docs/pruebas-ventas-privadas/eett_mp_sin_cambios.test.mjs   (requiere git y pdftotext)
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";

const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = join(AQUI, "../..");
const REF = process.env.REF_MP || "origin/main";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } else { nOk++; console.log("OK    " + k); } };

const tmp = join(RAIZ, "src/lib", `.eettPdf-ref-${process.pid}.js`);
writeFileSync(tmp, execFileSync("git", ["-C", RAIZ, "show", `${REF}:src/lib/eettPdf.js`]));
let ref, act;
try { ref = await import(pathToFileURL(tmp).href); act = await import(pathToFileURL(join(RAIZ, "src/lib/eettPdf.js")).href); }
finally { rmSync(tmp, { force: true }); }

const logo = "data:image/jpeg;base64," + readFileSync(join(RAIZ, "src/assets/bfk-logo.jpg")).toString("base64");
const PARRAFO = "Cargador de pared con carga rápida Power Delivery de 20W, entrada AC 100-240V, 50/60Hz, 0,5A. Salida USB-C 5V/3A, 9V/2,22A. Diseño compacto con enchufe plegable, carcasa de policarbonato y protección contra sobrecorriente, sobrevoltaje y cortocircuito. Incluye cable de 1 metro. Certificaciones: CE, FCC, RoHS. Garantía de 12 meses. ";
const cot = { id_externo: "1525570-33-COT26", nombre: "ADQUISICIÓN DE IMPRESORA MULTIFUNCIONAL", fecha: "2026-08-20", plazo: "2 DIAS", institucion: "ASOCIACIÓN DE MUNICIPIOS PARA LA SEGURIDAD COMUNITARIA", rut: "65.229.008-6", recargo: 0.3 };
const items = [
  { precio_origen: 187654, ficha: { nombre: "IMPRESORA MULTIFUNCIONAL SMART TANK 520", marca: "HP", modelo: "SMART TANK 580", color: "BLANCO",
    especificaciones: [{ etiqueta: "Tipo de impresión", valor: "Inyección a color" }, { etiqueta: "Resolución (DPI)", valor: "Hasta 1200 x 1200 dpi" }, { etiqueta: "Conectividad", valor: "USB, Wifi" }], imagenes: [logo, logo] } },
  { ficha: { nombre: "Silla ergonómica “ejecutiva” – respaldo alto ≥ 120 cm", marca: "Genérica", modelo: "SE-2000", generales: [{ etiqueta: "Material", valor: "Cuero sintético" }],
    especificaciones: Array.from({ length: 46 }, (_, i) => ({ etiqueta: `Especificación ${i + 1}`, valor: `Valor técnico ${i + 1} con un texto algo más largo para envolver` })), descripcion: "Silla de oficina con regulación de altura. ".repeat(40), imagenes: [logo] } },
  { ficha: { nombre: "CARGADOR 20W", marca: "Apple", modelo: "MHJA3AM/A", especificaciones: [{ etiqueta: "Detalle", valor: Array.from({ length: 9 }, (_, i) => `Bloque ${i + 1}. ${PARRAFO.repeat(3)}`).join("\n") }, { etiqueta: "Nota", valor: "Fin" }], imagenes: [] } },
];
const elaboracion = { vendedor: "Juan Pérez", elaborado_por: "Kevin Vergara", fecha: "2026-10-13", cotizacion: "1525570-33-COT26", version: 4 };
const casos = [
  ["tres_productos_con_elaboracion", cot, items, { logo, elaboracion }],
  ["sin_id_externo", { ...cot, id_externo: "" }, items.slice(0, 1), { logo }],
  ["texto_extremo", cot, items.slice(2), { logo, elaboracion }],
  ["sin_logo", cot, items.slice(1, 2), {}],
];
const normalizar = (buf) => Buffer.from(buf).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");
const dir = mkdtempSync(join(tmpdir(), "eett-mp-"));
for (const [n, c, its, op] of casos) {
  const a = ref.crearPdfEETT(c, its, { jsPDF, ...op }), b = act.crearPdfEETT(c, its, { jsPDF, ...op });
  const ba = a.output("arraybuffer"), bb = b.output("arraybuffer");
  ok(`M_${n}_mismas_paginas (${a.getNumberOfPages()})`, a.getNumberOfPages() === b.getNumberOfPages());
  ok(`M_${n}_bytes_identicos`, normalizar(ba) === normalizar(bb), { ref: ba.byteLength, rama: bb.byteLength });
  const ra = join(dir, `${n}-ref.pdf`), rb = join(dir, `${n}-rama.pdf`); writeFileSync(ra, Buffer.from(ba)); writeFileSync(rb, Buffer.from(bb));
  const ta = execFileSync("pdftotext", ["-layout", ra, "-"]).toString(), tb = execFileSync("pdftotext", ["-layout", rb, "-"]).toString();
  ok(`M_${n}_texto_identico`, ta === tb);
}
ok("M_nombre_archivo_igual", ref.nombreArchivoEETT(cot, 3) === act.nombreArchivoEETT(cot, 3) && ref.CONTACTO_BFK === act.CONTACTO_BFK);
console.log(`RESUMEN EETT Mercado Público sin cambios (contra ${REF}): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
