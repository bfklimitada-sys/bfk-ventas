// PDF EETT: una ficha por producto, continuación de páginas y AUSENCIA de datos comerciales.
// Uso: node docs/pruebas-cotizaciones/pdf_eett.test.mjs   (requiere pdftotext; SALIDA=carpeta para guardar el PDF)
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";
import { crearPdfEETT, textoPDF, nombreArchivoEETT } from "../../src/lib/eettPdf.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } else { nOk++; console.log("OK    " + k); } };
const logo = "data:image/jpeg;base64," + readFileSync(join(AQUI, "../../src/assets/bfk-logo.jpg")).toString("base64");
const extra = (process.env.IMAGENES || "").split(",").filter(Boolean).map((f) => "data:image/jpeg;base64," + readFileSync(f).toString("base64"));
const img = extra.length ? extra : [logo, logo];

const cot = { id_externo: "1525570-33-COT26", nombre: "ADQUISICIÓN DE IMPRESORA MULTIFUNCIONAL", fecha: "2026-08-20", plazo: "2 DIAS",
  institucion: "ASOCIACIÓN DE MUNICIPIOS PARA LA SEGURIDAD COMUNITARIA", rut: "65.229.008-6",
  // Datos internos que JAMÁS deben aparecer en el PDF:
  recargo: 0.3, observaciones: "nota interna confidencial", direccion_entrega: "Calle Interna 123" };
const comercial = { precio_origen: 187654, enlace: "https://www.falabella.com/falabella-cl/product/999/impresora", proveedor: "Falabella", recargo: 0.42, disponibilidad: "Stock 7 unidades", envio_key: "e1" };
const items = [
  { ...comercial, ficha: { nombre: "IMPRESORA MULTIFUNCIONAL SMART TANK 520 TANQUE DE TINTA COLOR USB ALTO RENDIMIENTO", marca: "HP", modelo: "SMART TANK 580", color: "BLANCO",
    especificaciones: [{ etiqueta: "Tipo de impresión", valor: "Inyección a color" }, { etiqueta: "Resolución (DPI)", valor: "Hasta 1200 x 1200 dpi" }, { etiqueta: "Conectividad/conexión", valor: "USB,Wifi" }, { etiqueta: "Número de cartuchos", valor: "4" }, { etiqueta: "Calidad de impresión", valor: "Alta resolución" }, { etiqueta: "Funcionalidad", valor: "Imprime, copia y escanea" }],
    imagenes: img } },
  { ...comercial, precio_origen: 45990, enlace: "https://articulo.mercadolibre.cl/MLC-123-silla", proveedor: "Mercado Libre", ficha: { nombre: "Silla ergonómica “ejecutiva” – respaldo alto ≥ 120 cm", marca: "Genérica", modelo: "SE-2000", color: "Negro",
    generales: [{ etiqueta: "Material", valor: "Cuero sintético" }], especificaciones: Array.from({ length: 46 }, (_, i) => ({ etiqueta: `Especificación ${i + 1}`, valor: `Valor técnico ${i + 1} con un texto algo más largo para envolver` })),
    descripcion: "Silla de oficina con regulación de altura. ".repeat(40), imagenes: [img[0]] } },
  { ...comercial, ficha: { nombre: "Cable UTP Cat6 305 m", marca: "Nexxt", modelo: "AB360NXT12", especificaciones: [{ etiqueta: "Categoría", valor: "6" }], imagenes: [] } },
];

const elaboracion = { vendedor: "Juan Pérez", elaborado_por: "Kevin Vergara", fecha: "2026-10-13", cotizacion: "1525570-33-COT26", version: 4 };
const doc = crearPdfEETT(cot, items, { jsPDF, logo, elaboracion });
const dir = process.env.SALIDA || mkdtempSync(join(tmpdir(), "eett-"));
const ruta = join(dir, "EETT_prueba.pdf");
writeFileSync(ruta, Buffer.from(doc.output("arraybuffer")));
const paginas = doc.getNumberOfPages();
const porPagina = Array.from({ length: paginas }, (_, i) => execFileSync("pdftotext", ["-layout", "-f", String(i + 1), "-l", String(i + 1), ruta, "-"]).toString());
const todo = porPagina.join("\n");

ok("P1_un_solo_pdf_con_varias_paginas", paginas >= 4, paginas);
ok("P2_ficha_1_en_pagina_1", /SMART TANK 520/.test(porPagina[0]) && !/SE-2000/.test(porPagina[0]));
const pSilla = porPagina.findIndex((t) => /SE-2000/.test(t));
ok("P3_ficha_2_empieza_en_pagina_nueva", pSilla === 1, pSilla);
ok("P4_ficha_larga_continua_en_pagina_siguiente", /continuaci/i.test(porPagina[2] || "") && /Especificaci.n 46/.test(todo));
const pCable = porPagina.findIndex((t) => /AB360NXT12/.test(t));
ok("P5_ficha_3_en_su_propia_pagina", pCable > pSilla && !/SE-2000|Especificaci.n \d/.test(porPagina[pCable]), pCable);
ok("P6_encabezado_en_cada_pagina_y_tabla_solo_en_la_primera", porPagina.every((t) => /INFORMACI.N\s+T.CNICA DE/.test(t)) && /ID LICITACI/.test(porPagina[0]) && /1525570-33-COT26/.test(porPagina[0]) && /65\.229\.008-6/.test(porPagina[0]) && porPagina.slice(1).every((t) => !/ID LICITACI|65\.229\.008-6/.test(t)));
ok("P7_pie_contacto_en_cada_pagina", porPagina.every((t) => /bfklimitada@gmail\.com/.test(t)));
ok("P8_marca_modelo_color", /HP/.test(porPagina[0]) && /SMART TANK 580/.test(porPagina[0]) && /BLANCO/.test(porPagina[0]));
ok("P9_fecha_formato_chileno", /20\/08\/2026/.test(porPagina[0]));
// Privacidad: nada comercial ni interno.
const prohibidos = ["187654", "187.654", "45990", "45.990", "falabella.com", "mercadolibre", "Falabella", "Mercado Libre", "http", "Stock 7", "0.42", "42%", "confidencial", "Calle Interna", "$"];
const encontrados = prohibidos.filter((p) => todo.includes(p));
ok("P10_sin_datos_comerciales_ni_internos", encontrados.length === 0, encontrados);
ok("P11_caracteres_especiales_sustituidos", /"EJECUTIVA"/.test(todo) && />= 120/.test(todo), (todo.match(/SILLA[^\n]*/) || [""])[0]);
ok("P12_textoPDF_limpia", textoPDF("a “b” – c ≥ d ✓") === 'a "b" - c >= d');
ok("P13_producto_sin_imagen_no_falla", pCable >= 0);
const ultima = porPagina[paginas - 1];
ok("P18_elaboracion_en_ultima_pagina", /ELABORACI.N DE ESPECIFICACIONES T.CNICAS/.test(ultima) && /Empresa: BFK Limitada/.test(ultima) && /Vendedor responsable: Juan P.rez/.test(ultima) && /Elaborado por: Kevin Vergara/.test(ultima) && /Fecha: 13\/10\/2026/.test(ultima) && /Cotizaci.n: 1525570-33-COT26/.test(ultima) && /Versi.n 4/.test(ultima), ultima.slice(-600));
ok("P19_elaboracion_una_sola_vez", (todo.match(/ELABORACI.N DE ESPECIFICACIONES/g) || []).length === 1);
ok("P20_nombre_archivo_con_version", nombreArchivoEETT(cot, 4) === "EETT_1525570-33-COT26_v4.pdf");
const meta = execFileSync("pdfinfo", [ruta]).toString();
ok("P14_tamano_A4", /595\.28 x 841\.89/.test(meta), meta.match(/Page size:.*/)?.[0]);

// Sin ID de Mercado Público: el PDF se genera y la cabecera omite esa columna.
{
  const sinId = { ...cot, id_externo: "" };
  const d2 = crearPdfEETT(sinId, items.slice(2), { jsPDF, logo });
  const r2 = join(dir, "EETT_sin_id.pdf"); writeFileSync(r2, Buffer.from(d2.output("arraybuffer")));
  const t2 = execFileSync("pdftotext", ["-layout", r2, "-"]).toString();
  ok("P15_sin_id_genera_pdf", d2.getNumberOfPages() === 1 && /AB360NXT12/.test(t2));
  ok("P16_sin_id_omite_columna_id", !/ID LICITACI/.test(t2) && /NOMBRE LICITACI/.test(t2) && /20\/08\/2026/.test(t2) && /65\.229\.008-6/.test(t2) && !/undefined|null/.test(t2), t2.slice(0, 400));
  ok("P17_nombre_archivo_sin_id", nombreArchivoEETT(sinId) === "EETT_2026-08-20_ASOCIACION_DE_MUNICIPIOS_PARA_LA_SEGURIDAD_COMUNI.pdf" && nombreArchivoEETT(cot) === "EETT_1525570-33-COT26.pdf" && nombreArchivoEETT({}) === "EETT_cotizacion.pdf", [nombreArchivoEETT(sinId), nombreArchivoEETT({})]);
}
console.log(`\nPDF: ${ruta} (${paginas} páginas)\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
