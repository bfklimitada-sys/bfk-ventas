// PDF EETT con especificaciones extensas (caso 5602-269-COT26: cargador con párrafo largo).
// Uso: SALIDA=carpeta node docs/pruebas-cotizaciones/pdf_eett_largo.mjs  (requiere pdftotext)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { crearPdfEETT } from "../../src/lib/eettPdf.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } else { nOk++; console.log("OK    " + k); } };
const logo = "data:image/jpeg;base64," + readFileSync(join(AQUI, "../../src/assets/bfk-logo.jpg")).toString("base64");

const PARRAFO = "Cargador de pared original para iPhone con tecnología de carga rápida Power Delivery de 20W, compatible con iPhone 8 y modelos posteriores, incluyendo iPhone 11, 12, 13, 14 y 15 en todas sus versiones. Entrada AC 100-240V, 50/60Hz, 0,5A. Salida USB-C 5V/3A, 9V/2,22A. Permite cargar hasta el 50% de la batería en aproximadamente 30 minutos cuando se utiliza con un cable USB-C a Lightning compatible. Diseño compacto con enchufe tipo A plegable, carcasa de policarbonato resistente a impactos y protección contra sobrecorriente, sobrevoltaje, cortocircuito y sobrecalentamiento. Incluye cable USB-C a Lightning de 1 metro con conectores reforzados, apto para sincronización de datos. Certificaciones: CE, FCC, RoHS. Garantía de 12 meses del fabricante contra defectos de fabricación. Producto nuevo, sellado en su empaque original, con manual de usuario en español. Temperatura de operación: 0 a 35 °C. Dimensiones aproximadas del adaptador: 45 x 45 x 28 mm; peso aproximado 60 g. Compatible además con iPad, AirPods y otros dispositivos que admiten carga USB-C Power Delivery.";
const cot = { id_externo: "5602-269-COT26", nombre: "MANTENCIÓN Y REPARACIÓN DE TECHUMBRE DEL GIMNASIO MUNICIPAL", fecha: "2026-10-13", plazo: "5 DÍAS HÁBILES",
  institucion: "ILUSTRE MUNICIPALIDAD DE PRUEBA", rut: "69.000.000-0" };
const cargador = { ficha: { nombre: "CARGADOR IPHONE 20W USB-C CON CABLE LIGHTNING", marca: "Apple", modelo: "MHJA3AM/A", color: "Blanco",
  especificaciones: [{ etiqueta: "Potencia", valor: "20W" }, { etiqueta: "Conector", valor: "USB-C" }, { etiqueta: "ESPECIFICACIONES Y CARACTERISTICAS", valor: PARRAFO }, { etiqueta: "Garantía", valor: "12 meses" }],
  imagenes: [logo, logo] } };
// Párrafo extremadamente largo (debe continuar en otra página sin perder texto).
const enorme = Array.from({ length: 9 }, (_, i) => `Bloque ${i + 1}. ` + PARRAFO).join("\n");
const extremo = { ficha: { nombre: "PRODUCTO CON TEXTO EXTREMO", marca: "Genérica", modelo: "X-1",
  generales: [{ etiqueta: "Material de la estructura y terminaciones", valor: "Acero galvanizado con pintura electrostática de alta resistencia a la intemperie" }],
  especificaciones: [{ etiqueta: "Detalle", valor: enorme }, { etiqueta: "Nota final", valor: "Fin de las especificaciones" }], imagenes: [logo] } };

const doc = crearPdfEETT(cot, [cargador, extremo], { jsPDF, logo, elaboracion: { vendedor: "Juan Pérez", elaborado_por: "Kevin Vergara", fecha: "2026-10-13", cotizacion: "5602-269-COT26", version: 1 } });
const dir = process.env.SALIDA || mkdtempSync(join(tmpdir(), "eett-"));
const ruta = join(dir, "EETT_5602-269-COT26_prueba.pdf");
writeFileSync(ruta, Buffer.from(doc.output("arraybuffer")));
const n = doc.getNumberOfPages();
const pag = Array.from({ length: n }, (_, i) => execFileSync("pdftotext", ["-f", String(i + 1), "-l", String(i + 1), ruta, "-"]).toString());
const plano = (s) => s.replace(/\s+/g, " ").replace(/- /g, "-");
const todo = plano(pag.join(" "));
const palabras = (s) => s.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ");
const contiene = (texto) => { const w = palabras(textoSimple(texto)); const t = " " + palabras(textoSimple(todo)).join(" ") + " "; return w.every((x) => t.includes(" " + x + " ") || t.includes(x)); };
const textoSimple = (s) => s.normalize("NFC");
ok("L1_cargador_en_pagina_1_con_etiqueta", /ESPECIFICACIONES Y CARACTERISTICAS/.test(pag[0]) && /CARGADOR IPHONE/.test(pag[0]));
ok("L2_parrafo_completo_sin_truncar", contiene(PARRAFO));
ok("L3_texto_extremo_completo", contiene(enorme) && /Fin de las especificaciones/.test(todo));
ok("L4_extremo_continua_en_paginas_siguientes", n >= 3 && /continuaci/i.test(pag[n - 1]), n);
ok("L5_pie_y_encabezado_en_todas", pag.every((t) => /bfklimitada@gmail\.com/.test(t) && /INFORMACI.N\s+T.CNICA DE/.test(t)));
ok("L6_numeracion", pag.every((t, i) => new RegExp(`${i + 1}\\s*/\\s*${n}`).test(t)));
ok("L7_sin_datos_comerciales", !/\$|http|precio/i.test(todo));
console.log(`\nPDF: ${ruta}  (${n} páginas)\n${nOk} OK, ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
