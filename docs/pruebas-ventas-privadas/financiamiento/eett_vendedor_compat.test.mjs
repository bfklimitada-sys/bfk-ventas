// «Vendedor» en las EETT privadas (11/11/2026): las EETT YA EMITIDAS (sin «vendedor» en su contenido) y las de Mercado Público
// se generan IDÉNTICAS byte a byte a origin/main; una EETT nueva con vendedor solo cambia la línea «Vendedor responsable».
// Uso: node docs/pruebas-ventas-privadas/financiamiento/eett_vendedor_compat.test.mjs   (requiere git)
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";
const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = join(AQUI, "../../.."); const LIB = join(RAIZ, "src/lib"); const REF = process.env.REF_MP || "origin/main";
let nOk = 0; const F = []; const ok = (k, v, d) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + String(d).slice(0, 300) : "")); } };
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
const texto = async (buf) => { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise; const t = []; for (let i = 1; i <= d.numPages; i++) t.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ")); return t.join(" ").replace(/\s+/g, " "); };
const normalizar = (buf) => Buffer.from(buf).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");
const sufijo = `.ref-${process.pid}.js`; const tmp = [];
const copiar = (a, r = []) => { let t = execFileSync("git", ["-C", RAIZ, "show", `${REF}:src/lib/${a}`]).toString(); for (const [x, y] of r) t = t.split(x).join(y); const p = join(LIB, a.replace(/\.js$/, sufijo)); writeFileSync(p, t); tmp.push(p); return p; };
let refPdf, refVP, act, actVP;
try { refPdf = await import(pathToFileURL(copiar("eettPdf.js")).href); refVP = await import(pathToFileURL(copiar("vpEETT.js", [['from "./eettPdf.js"', `from "./eettPdf${sufijo}"`]])).href);
  act = await import(pathToFileURL(join(LIB, "eettPdf.js")).href); actVP = await import(pathToFileURL(join(LIB, "vpEETT.js")).href); }
finally { for (const p of tmp) rmSync(p, { force: true }); }
const logo = "data:image/jpeg;base64," + readFileSync(join(RAIZ, "src/assets/bfk-logo.jpg")).toString("base64");
const FX = JSON.parse(readFileSync(join(RAIZ, "docs/pruebas-ventas-privadas/fixture_cp_2026_0001.json"), "utf8"));
const empresa = { razon_social: "Ingeniería y Servicios BFK Limitada", nombre_corto: "BFK Ltda." };
const lineas = [{ id: "i1", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", descripcion: FX.item.descripcion, ficha: FX.item.ficha }];
const base = { cotizacion: { folio: "CP-2026-0001", revision: 0 }, cliente: { razon_social: "Carabineros de Chile", rut: "61.513.003-6" }, plazo_entrega: "3 días", fecha: "2026-11-10", responsable: "Kevin Vergara", elaborado_por: "Kevin Vergara", items: lineas };
const emitida = (contenido) => ({ folio: "ET-2026-0001", revision: 0, estado: "emitida", emitida_en: "2026-11-10T12:00:00Z", contenido });
const pdf = (lib, e) => lib.crearPdfEETTVP(e, { jsPDF, logo, empresa }).output("arraybuffer");
// 1. Contenido emitido con el formato de Mercado Público SIN vendedor (todas las EETT emitidas hasta hoy): idéntico a main.
const sinVend = refVP.contenidoEETTVP(base);
ok("EETT emitida (formato MP, sin vendedor): el contenido nuevo sin vendedor es idéntico al de main", JSON.stringify(actVP.contenidoEETTVP(base)) === JSON.stringify(sinVend));
ok("EETT emitida (formato MP, sin vendedor): PDF idéntico byte a byte a main", normalizar(pdf(actVP, emitida(sinVend))) === normalizar(pdf(refVP, emitida(sinVend))));
// 2. Contenido del formato anterior (borrador/emisión de la ventana anterior de CP-2026-0001): idéntico a main.
const legado = { ...FX.eett.contenido, cotizacion: { folio: "CP-2026-0001", revision: 0 } };
ok("EETT del formato anterior: PDF idéntico byte a byte a main", normalizar(pdf(actVP, emitida(legado))) === normalizar(pdf(refVP, emitida(legado))));
// 3. Mercado Público: generador sin cambios.
const cot = { id_externo: "1525570-33-COT26", nombre: "ADQUISICIÓN", fecha: "2026-11-09", plazo: "10 días", institucion: "MUNICIPALIDAD DE LAJA", rut: "69.170.100-K" };
const items = [{ ficha: FX.item.ficha }];
for (const v of ["", "Kevin Vergara"]) ok(`Mercado Público (vendedor «${v || "sin"}»): PDF idéntico byte a byte a main`,
  normalizar(act.crearPdfEETT({ ...cot, vendedor_nombre: v }, items, { jsPDF, logo, elaboracion: v ? { vendedor: v } : undefined }).output("arraybuffer"))
  === normalizar(refPdf.crearPdfEETT({ ...cot, vendedor_nombre: v }, items, { jsPDF, logo, elaboracion: v ? { vendedor: v } : undefined }).output("arraybuffer")));
// 4. EETT nueva con vendedor: solo cambia «Vendedor responsable»; el responsable queda en el contenido.
for (const v of ["BFK Ltda.", "Matías Vegas"]) {
  const c = actVP.contenidoEETTVP({ ...base, vendedor: v });
  const tN = await texto(pdf(actVP, emitida(c))); const tA = await texto(pdf(actVP, emitida(sinVend)));
  ok(`EETT nueva con vendedor «${v}»: contenido con vendedor y responsable`, c.vendedor === v && c.responsable === "Kevin Vergara");
  ok(`EETT nueva con vendedor «${v}»: el PDF solo cambia la línea del vendedor`, tN.includes(`Vendedor responsable: ${v}`) && tN.replace(`Vendedor responsable: ${v}`, "Vendedor responsable: Kevin Vergara") === tA, tN.slice(0, 200));
  const prev = await texto(pdf(actVP, { ...emitida(c), estado: "borrador", folio: "" }));
  ok(`Vista previa con vendedor «${v}»: mismo vendedor`, prev.includes(`Vendedor responsable: ${v}`));
}
ok("vendedor vacío no se guarda (sin asignar → responsable)", !("vendedor" in actVP.contenidoEETTVP({ ...base, vendedor: "  " })));
console.log(`RESUMEN eett_vendedor_compat (contra ${REF}): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
