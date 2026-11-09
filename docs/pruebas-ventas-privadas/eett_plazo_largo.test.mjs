// Plazo de entrega largo en la EETT (09/11/2026) — generador ÚNICO (lib/eettPdf.js) para Mercado Público y Ventas privadas.
//   · Con un plazo largo, la celda «PLAZO ENTREGA» se escribe completa y la fila crece: nada se corta ni se superpone.
//   · Con un plazo de una línea el PDF es idéntico byte a byte al de origin/main (documentos ya emitidos se ven igual),
//     en ambos canales (Ventas privadas: contenido congelado de una EETT emitida con el adaptador de main y el de la rama).
//   · Las demás celdas conservan su comportamiento.
// Uso: node docs/pruebas-ventas-privadas/eett_plazo_largo.test.mjs   (requiere git)
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";

const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = join(AQUI, "../.."); const LIB = join(RAIZ, "src/lib");
const REF = process.env.REF_MP || "origin/main";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function pagina1(buf) { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; return (await (await d.getPage(1)).getTextContent()).items.map((x) => ({ s: x.str, y: x.transform[5] })).filter((x) => x.s.trim()); }
const plano = (items) => items.map((x) => x.s).join(" ").replace(/\s+/g, " ");
const normalizar = (buf) => Buffer.from(buf).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");

// Versiones de origin/main del generador y del adaptador privado (copias temporales junto a las de la rama).
const sufijo = `.ref-${process.pid}.js`; const temporales = [];
const copiar = (archivo, reemplazos = []) => { let t = execFileSync("git", ["-C", RAIZ, "show", `${REF}:src/lib/${archivo}`]).toString(); for (const [a, b] of reemplazos) t = t.split(a).join(b); const p = join(LIB, archivo.replace(/\.js$/, sufijo)); writeFileSync(p, t); temporales.push(p); return p; };
let refPdf, refVP, act, actVP;
try {
  refPdf = await import(pathToFileURL(copiar("eettPdf.js")).href);
  refVP = await import(pathToFileURL(copiar("vpEETT.js", [['from "./eettPdf.js"', `from "./eettPdf${sufijo}"`]])).href);
  act = await import(pathToFileURL(join(LIB, "eettPdf.js")).href); actVP = await import(pathToFileURL(join(LIB, "vpEETT.js")).href);
} finally { for (const p of temporales) rmSync(p, { force: true }); }

const logo = "data:image/jpeg;base64," + readFileSync(join(RAIZ, "src/assets/bfk-logo.jpg")).toString("base64");
const LARGO = "15 días hábiles contados desde la recepción conforme de la orden de compra, sujeto a disponibilidad de stock del proveedor y despacho a la dirección indicada por el cliente en Laja";
const items = [{ ficha: { nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", generales: [{ etiqueta: "Material", valor: "Hierro fundido" }], especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }] } }];
const cot = (plazo) => ({ id_externo: "1525570-33-COT26", nombre: "ADQUISICIÓN DE BOMBAS", fecha: "2026-11-09", plazo, institucion: "MUNICIPALIDAD DE LAJA", rut: "69.170.100-K" });
const eettVP = (plazo, extra = {}) => ({ folio: "ET-2026-0001", revision: 0, estado: "emitida", contenido: { fecha: "2026-11-09", cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5" }, cotizacion: { folio: "CP-2026-0001", revision: 1 },
  plazo_entrega: plazo, responsable: "Kevin", empresa: { razon_social: "Ingeniería y Servicios BFK Limitada" }, objeto: "Suministro de bomba", items: [{ item_id: "a", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] }], ...extra } });
const mp = (lib, plazo) => lib.crearPdfEETT(cot(plazo), items, { jsPDF, logo }).output("arraybuffer");
const vp = (libVP, plazo) => libVP.crearPdfEETTVP(eettVP(plazo), { jsPDF, logo, empresa: { razon_social: "Ingeniería y Servicios BFK Limitada" } }).output("arraybuffer");

for (const [canal, gen, lib, libRef] of [["MP", mp, act, refPdf], ["VP", vp, actVP, refVP]]) {
  // 1. Plazo corto: idéntico byte a byte a origin/main (documentos ya emitidos se ven igual).
  ok(`${canal}_plazo_corto_identico_a_${REF}`, normalizar(gen(lib, "10 días hábiles")) === normalizar(gen(libRef, "10 días hábiles")));
  // 2. Plazo largo: completo y la fila crece.
  const antes = await pagina1(gen(libRef, LARGO)); const ahora = await pagina1(gen(lib, LARGO));
  const t = plano(ahora);
  ok(`${canal}_plazo_largo_se_lee_completo`, t.includes(LARGO), t.slice(0, 400));
  ok(`${canal}_antes_se_cortaba (referencia)`, !plano(antes).includes(LARGO));
  const lineasPlazo = ahora.filter((x) => LARGO.includes(x.s.trim()) && x.s.trim().length > 3);
  const yUltima = Math.min(...lineasPlazo.map((x) => x.y));
  const franja = ahora.find((x) => /BOMBA CENTR/.test(x.s));
  ok(`${canal}_la_fila_crece_y_no_se_superpone (${lineasPlazo.length} líneas)`, lineasPlazo.length >= 4 && franja && franja.y < yUltima - 4, { lineas: lineasPlazo.length, yUltima, franja: franja?.y });
  const franjaAntes = antes.find((x) => /BOMBA CENTR/.test(x.s));
  ok(`${canal}_el_resto_del_documento_baja_lo_justo`, franjaAntes && franja && Math.abs((franjaAntes.y - franja.y) - (lineasPlazo.length - 1) * 3.9 * 72 / 25.4) < 0.6, { antes: franjaAntes?.y, ahora: franja?.y });
}
// 3. Las demás celdas no cambian de comportamiento (Mercado Público: nombre e institución siguen en una línea).
const largoNombre = { ...cot("2 DIAS"), nombre: "ADQUISICIÓN DE " + "MATERIALES DIVERSOS ".repeat(12), institucion: "MUNICIPALIDAD " + "DE LA COMUNA ".repeat(10) };
ok("MP_otras_celdas_iguales_a_main", normalizar(act.crearPdfEETT(largoNombre, items, { jsPDF, logo }).output("arraybuffer")) === normalizar(refPdf.crearPdfEETT(largoNombre, items, { jsPDF, logo }).output("arraybuffer")));
// 4. Ejemplo para revisar a mano (EETT privada con plazo largo).
if (process.env.EJEMPLO) { writeFileSync(process.env.EJEMPLO, Buffer.from(vp(actVP, LARGO))); console.log("Ejemplo:", process.env.EJEMPLO); }
console.log(`RESUMEN plazo largo en la EETT (ambos canales, contra ${REF}): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
