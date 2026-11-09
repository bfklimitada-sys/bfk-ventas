// EETT privada con el recorrido de Mercado Público (09/11/2026) — adaptador lib/vpEETT.js sobre el generador ÚNICO lib/eettPdf.js.
//   A. Copia aislada de la cotización de la captura (CP-2026-0001, «Bolso Paramédico Mediano 47L», fixture_cp_2026_0001.json):
//      los textos descriptivos quedan como descripción y los pares «característica: valor» como especificaciones; nada se pierde,
//      nada aparece como «No informado» y todo llega al PDF (nombre, marca, modelo, color, especificaciones y descripción).
//   B. Plantilla de Mercado Público: misma tabla de la primera página con las referencias del canal (cotización, EETT, cliente
//      completo, RUT, plazo), sin «Objeto del suministro», «Alcance», requisitos ni marca de borrador; numeración y orden.
//   C. Compatibilidad: un borrador o una emisión anterior conserva lo que tenía; el formato anterior se imprime igual que antes;
//      el PDF de Mercado Público no cambia.
// Uso: node docs/pruebas-ventas-privadas/eett_como_mp.test.mjs   (requiere git; REF_MP = referencia publicada, por defecto origin/main)
import { readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsPDF } from "jspdf";

const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = join(AQUI, "../.."); const LIB = join(RAIZ, "src/lib");
const REF = process.env.REF_MP || "origin/main"; const SALIDA = process.env.SALIDA_PDF || "";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + String(typeof d === "string" ? d : JSON.stringify(d)).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function texto(buf) { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise; let s = ""; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n"; return { s: s.replace(/\s+/g, " "), paginas: d.numPages }; }
const normalizar = (buf) => Buffer.from(buf).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");
// Texto tal como lo imprime la plantilla (Helvetica WinAnsi: guiones largos → «-»).
const comoPDF = (s) => String(s).replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
const enPDF = (t, s) => t.includes(comoPDF(s));

// Versiones publicadas (REF) del generador y del adaptador, para comparar byte a byte.
const sufijo = `.ref-${process.pid}.js`; const temporales = [];
const copiar = (archivo, reemplazos = []) => { let t = execFileSync("git", ["-C", RAIZ, "show", `${REF}:src/lib/${archivo}`]).toString(); for (const [a, b] of reemplazos) t = t.split(a).join(b); const p = join(LIB, archivo.replace(/\.js$/, sufijo)); writeFileSync(p, t); temporales.push(p); return p; };
let refPdf, refVP, act, vp;
try {
  refPdf = await import(pathToFileURL(copiar("eettPdf.js")).href);
  refVP = await import(pathToFileURL(copiar("vpEETT.js", [['from "./eettPdf.js"', `from "./eettPdf${sufijo}"`]])).href);
  act = await import(pathToFileURL(join(LIB, "eettPdf.js")).href); vp = await import(pathToFileURL(join(LIB, "vpEETT.js")).href);
} finally { for (const p of temporales) rmSync(p, { force: true }); }
const { tieneDatosComerciales, itemEETTDesde } = await import(pathToFileURL(join(LIB, "ventasPrivadas.js")).href);

const logo = "data:image/jpeg;base64," + readFileSync(join(RAIZ, "src/assets/bfk-logo.jpg")).toString("base64");
const FX = JSON.parse(readFileSync(join(AQUI, "fixture_cp_2026_0001.json"), "utf8"));
const ficha = FX.item.ficha;
const emitida = (contenido, extra = {}) => ({ folio: "ET-2026-0001", revision: 0, estado: "emitida", emitida_en: "2026-11-09T21:00:00Z", contenido, ...extra });
const pdfVP = (e, opc = {}) => Buffer.from(vp.crearPdfEETTVP(e, { jsPDF, logo, ...opc }).output("arraybuffer"));

// ═══ A. La ficha del bolso ═══════════════════════════════════════════════════════════════════════════════════════════════
const n = vp.normalizarFichaEETT(ficha);
const PARES = [["Capacidad", "47 litros"], ["Dimensiones", "35 cm ancho × 45 cm largo × 30 cm alto"], ["Material", "Tela RipStop antidesgarro e impermeable"], ["Colores disponibles", "Azul médico / Rojo emergencia"],
  ["SKU Azul", "BOL-BPRM-A"], ["SKU Rojo", "BOL-BPRM-R"], ["Contenido", "Bolso vacío (sin insumos) + estuche transparente desmontable con velcro"]];
ok("A1 los 7 pares «característica: valor» de la ficha quedan como especificaciones, en su orden", JSON.stringify(n.especificaciones.map((p) => [p.etiqueta, p.valor])) === JSON.stringify(PARES), n.especificaciones);
ok("A2 ningún texto descriptivo queda como característica sin valor", n.generales.length === 0 && [...n.generales, ...n.especificaciones].every((p) => p.etiqueta && p.valor));
const textos = [...ficha.generales, ...ficha.especificaciones].map((p) => p.etiqueta);
ok("A3 los 12 textos descriptivos (título, párrafo y 10 características descritas) quedan completos en la descripción, en su orden",
  textos.every((t) => n.descripcion.includes(t)) && textos.reduce((a, t) => (a === -1 ? -1 : n.descripcion.indexOf(t, a) === -1 ? -1 : n.descripcion.indexOf(t, a)), 0) !== -1, n.descripcion.slice(0, 200));
const fuente = [...textos, ...ficha.descripcion.split("\n")].join(" ");
const salida = [n.descripcion, ...n.especificaciones.map((p) => `${p.etiqueta}: ${p.valor}`)].join(" ");
const palabras = (s) => s.normalize("NFC").split(/\s+/).filter(Boolean).sort().join(" ");
ok("A4 nada se pierde ni se inventa: las mismas palabras de la ficha, sin agregar ninguna", palabras(fuente) === palabras(salida));
ok("A5 nombre, marca, modelo, color e imágenes de la ficha sin cambios", n.nombre === ficha.nombre && n.marca === "TBQ" && n.modelo === "BOL-BPRM-A" && n.color === "Azul" && JSON.stringify(n.imagenes) === JSON.stringify(ficha.imagenes));
const lineaFx = { ...FX.item, id: FX.item.id };
const previoFx = { ...FX.eett.contenido, items: [itemEETTDesde(lineaFx, null, null)] };
ok("A5b el borrador de producción (ventana anterior) tenía 12 textos como características sin valor (lo que mostraba «No informado»)", previoFx.items[0].caracteristicas.length === 12 && previoFx.items[0].caracteristicas.every((k) => k.valor === ""));
const cont = vp.contenidoEETTVP({ cotizacion: { folio: "CP-2026-0001", revision: 0 }, cliente: FX.cliente, plazo_entrega: FX.rev.plazo_entrega, fecha: "2026-11-09", responsable: "Kevin Vergara", elaborado_por: "Kevin Vergara", items: [lineaFx], previo: previoFx });
const it = cont.items[0];
ok("A6 contenido de la EETT: formato «mp», sin objeto ni alcance, sin datos comerciales, ítem 1 con cantidad y unidad de la cotización", cont.formato === "mp" && !("objeto" in cont) && !("alcance" in cont) && !tieneDatosComerciales(cont)
  && it.item_id === FX.item.id && it.orden === 1 && it.cantidad === 2 && it.unidad === "UN" && it.imagenes.length === 2 && !("legado" in it) && !("codigo" in it));
ok("A7 todas las características con valor (la emisión no encuentra «No informado»)", it.caracteristicas.length === 7 && it.caracteristicas.every((k) => k.valor.trim() && !/no informado/i.test(k.valor)) && it.caracteristicas.every((k) => k.grupo === "especificaciones"));
const bufFx = pdfVP(emitida(cont)); const tFx = await texto(bufFx);
if (SALIDA) { mkdirSync(SALIDA, { recursive: true }); writeFileSync(join(SALIDA, "EETT-privada-CP-2026-0001-copia-aislada.pdf"), bufFx); }
ok("A8 el PDF trae nombre, marca, modelo y color", /1\. BOLSO PARAM.DICO MEDIANO 47L/.test(tFx.s) && /MARCA TBQ/.test(tFx.s) && /MODELO BOL-BPRM-A/.test(tFx.s) && /COLOR Azul/.test(tFx.s), tFx.s.slice(0, 600));
ok("A9 el PDF trae las 7 especificaciones con su valor", PARES.every(([e, v]) => enPDF(tFx.s, e) && enPDF(tFx.s, v)), PARES.filter(([e, v]) => !enPDF(tFx.s, e) || !enPDF(tFx.s, v)));
ok("A10 el PDF trae la descripción técnica completa (título, párrafo y las 10 características descritas)", /DESCRIPCI.N T.CNICA/.test(tFx.s) && textos.every((x) => enPDF(tFx.s, x)), textos.filter((x) => !enPDF(tFx.s, x)).map((x) => x.slice(0, 60)));
ok("A11 sin «No informado» ni campos vacíos de la ventana anterior", !/No informado/i.test(tFx.s) && !/Objeto del suministro|Alcance|Requisitos del cliente|BORRADOR/i.test(tFx.s));

// ═══ B. Plantilla de Mercado Público con las referencias del canal ═══════════════════════════════════════════════════════
ok("B1 tabla de la primera página: cotización, EETT, fecha, plazo, cliente COMPLETO y RUT (sin licitación ni institución)",
  /COTIZACI.N ESPECIFICACIONES T.CNICAS FECHA EMISI.N CP-2026-0001 ET-2026-0001 Rev\. 0 09\/11\/2026/.test(tFx.s) && /PLAZO ENTREGA CLIENTE RUT 3 d.as habiles FONDO HOSPITAL DE LA DIRECCION DE PREVISION DE CARABINEROS DE CHILE 61\.513\.003-6/.test(tFx.s)
  && !/LICITACI.N|INSTITUCI.N SOLICITANTE/.test(tFx.s), tFx.s.slice(0, 400));
ok("B2 misma estructura de Mercado Público: banda, CARACTERÍSTICAS, columnas, descripción, elaboración y pie de BFK", /INFORMACI.N T.CNICA DE PRODUCTOS/.test(tFx.s) && /CARACTER.STICAS Caracter.sticas Generales MARCA TBQ/.test(tFx.s) && / Especificaciones Capacidad 47 litros/.test(tFx.s) && /DESCRIPCI.N T.CNICA/.test(tFx.s)
  && /ELABORACI.N DE ESPECIFICACIONES T.CNICAS Empresa: BFK Limitada Vendedor responsable: Kevin Vergara Elaborado por: Kevin Vergara Fecha: 09\/11\/2026 Cotizaci.n: CP-2026-0001/.test(tFx.s) && tFx.s.includes(act.CONTACTO_BFK.replace(/\s+/g, " ")));
// Mismo dibujo que Mercado Público: la ficha normalizada impresa con el generador tal cual (crearPdfEETT sin opciones del canal)
// produce exactamente las mismas páginas de producto (se compara el texto a partir del nombre del producto).
const mpMismaFicha = await texto(Buffer.from(act.crearPdfEETT({ id_externo: "X", nombre: "X", fecha: "2026-11-09", plazo: "3 días habiles", institucion: "X", rut: "X" }, [{ ficha: { ...n, nombre: "1. " + n.nombre, imagenes: [] } }], { jsPDF, logo, elaboracion: { vendedor: "Kevin Vergara", elaborado_por: "Kevin Vergara", fecha: "2026-11-09", cotizacion: "CP-2026-0001" } }).output("arraybuffer")));
const desdeProducto = (s) => s.slice(s.indexOf("1. BOLSO"));
ok("B3 las páginas del producto son las de la plantilla de Mercado Público (mismo generador, mismo contenido)", desdeProducto(mpMismaFicha.s) === desdeProducto(tFx.s) && mpMismaFicha.paginas === tFx.paginas, [mpMismaFicha.paginas, tFx.paginas]);
// Numeración y orden: tres líneas en orden 1, 2, 3 (aunque lleguen desordenadas), con un servicio.
const lin = (orden, nombre, extra = {}) => ({ id: `i${orden}`, orden, cantidad: 1, unidad: "UN", tipo: "producto", ficha: { nombre, marca: "M", modelo: "X-1", generales: [{ etiqueta: "Material", valor: "Acero" }], especificaciones: [], descripcion: "", imagenes: [] }, ...extra });
const c3 = vp.contenidoEETTVP({ cotizacion: { folio: "CP-2026-0002", revision: 1 }, cliente: { razon_social: "Cliente", rut: "1-9" }, plazo_entrega: "5 días", fecha: "2026-11-09", items: [lin(2, "Segundo"), lin(1, "Primero"), lin(3, "Instalación", { tipo: "servicio", unidad: "GL" })] });
const t3 = await texto(pdfVP(emitida(c3, { revision: 2 })));
ok("B4 numeración y orden de la cotización (1, 2, 3) y referencia de la revisión", t3.s.indexOf("1. PRIMERO") > 0 && t3.s.indexOf("1. PRIMERO") < t3.s.indexOf("2. SEGUNDO") && t3.s.indexOf("2. SEGUNDO") < t3.s.indexOf("3. INSTALACI") && /CP-2026-0002 · R1|CP-2026-0002 . R1/.test(t3.s) && /ET-2026-0001 Rev\. 2/.test(t3.s) && /Versi.n 2/.test(t3.s), t3.s.slice(0, 300));
ok("B5 un servicio no muestra marca ni modelo", !/3\. INSTALACI.N.{0,80}MARCA/.test(t3.s));
const previa = vp.nombreArchivoEETTVP({ folio: "", revision: null, contenido: cont }); const final = vp.nombreArchivoEETTVP(emitida(cont));
ok("B6 nombre del archivo con el criterio de Mercado Público (EETT_<referencia>.pdf)", previa === "EETT_CP-2026-0001.pdf" && final === "EETT_CP-2026-0001_ET-2026-0001_Rev0.pdf", [previa, final]);
const tPrev = await texto(pdfVP({ folio: "", revision: null, estado: "previa", contenido: cont }));
ok("B7 vista previa sin folio de EETT: la celda se omite (nunca un valor ficticio) y no lleva marca de borrador", !/ESPECIFICACIONES T.CNICAS/.test(tPrev.s.slice(0, 300)) && !/BORRADOR/.test(tPrev.s) && /CP-2026-0001/.test(tPrev.s));
ok("B8 «mismo contenido» ignora solo la fecha de generación", vp.mismoContenidoEETT(cont, { ...cont, fecha: "2026-12-01" }) && !vp.mismoContenidoEETT(cont, { ...cont, plazo_entrega: "5 días" }));

// Pares: casos límite.
const P = vp.parCaracteristica;
ok("B9 reconoce «Etiqueta: valor» (con viñeta) y descarta frases con dos puntos, horas y enlaces",
  JSON.stringify(P("- Peso: 2 kg")) === JSON.stringify({ etiqueta: "Peso", valor: "2 kg" }) && P("Capacidad: 47 litros")?.valor === "47 litros" && !P("Se entrega sin insumos y con un estuche transparente desmontable incluido: listo para equipar")
  && !P("10:30") && !P("https://x.cl/a") && !P("Nota. Algo: otra cosa") && !P("Resistente al agua"));
const nMix = vp.normalizarFichaEETT({ nombre: "Equipo", marca: "ACME", modelo: "Z-9", generales: [{ etiqueta: "Material", valor: "Acero" }, { etiqueta: "Voltaje: 220 V", valor: "" }, { etiqueta: "", valor: "Uso industrial continuo" }, { etiqueta: "Modelo", valor: "Z-9" }],
  especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }, { etiqueta: "Potencia", valor: "2 HP" }], descripcion: "Equipo robusto.\nPeso: 12 kg\nPotencia: 2 HP" });
ok("B10 pares con valor se conservan en su grupo; «Etiqueta: valor» sin valor se separa; repetidos exactos y el modelo repetido no se duplican",
  JSON.stringify(nMix.generales) === JSON.stringify([{ etiqueta: "Material", valor: "Acero" }, { etiqueta: "Voltaje", valor: "220 V" }]) && JSON.stringify(nMix.especificaciones) === JSON.stringify([{ etiqueta: "Potencia", valor: "2 HP" }, { etiqueta: "Peso", valor: "12 kg" }])
  && nMix.descripcion === "Uso industrial continuo\n\nEquipo robusto.", nMix);

// ═══ C. Compatibilidad ═══════════════════════════════════════════════════════════════════════════════════════════════════
const anterior = { ...previoFx, objeto: "Suministro de bolsos", alcance: "Entrega en Santiago", items: [{ ...previoFx.items[0], garantia: "12 meses", accesorios: ["Estuche"],
  normas: [{ norma: "ISO 9001", respaldo_texto: "Certificado 2026" }, { norma: "NCh 123" }], requisitos: [{ requisito: "Color azul", ofrecido: "Azul", cumplimiento: "cumple", respaldo: "Ficha" }, { requisito: "Impermeable", cumplimiento: "cumple" }],
  caracteristicas: [...previoFx.items[0].caracteristicas, { caracteristica: "Peso", valor: "1,2 kg", unidad: "", origen: null }] }] };
const cAnt = vp.contenidoEETTVP({ cotizacion: { folio: "CP-2026-0001", revision: 0 }, cliente: FX.cliente, plazo_entrega: "3 días habiles", fecha: "2026-11-09", items: [lineaFx], previo: anterior });
const ia = cAnt.items[0];
ok("C1 un borrador anterior con datos propios los conserva (objeto, alcance, garantía, accesorios, norma y requisito con respaldo)", cAnt.objeto === "Suministro de bolsos" && cAnt.alcance === "Entrega en Santiago" && ia.garantia === "12 meses" && ia.accesorios[0] === "Estuche"
  && ia.normas.length === 1 && ia.requisitos.length === 1);
ok("C2 lo que la emisión rechazaría (norma o cumplimiento sin respaldo) y lo completado a mano queda guardado aparte, sin perderse", ia.legado?.normas?.[0]?.norma === "NCh 123" && ia.legado?.requisitos?.[0]?.requisito === "Impermeable" && ia.legado?.caracteristicas?.[0]?.caracteristica === "Peso");
const tAnt = await texto(pdfVP(emitida(cAnt)));
ok("C3 esos datos anteriores se imprimen (no se pierden); una EETT nueva no los tiene", /Objeto del suministro Suministro de bolsos/.test(tAnt.s) && /GARANT.A 12 meses/.test(tAnt.s) && /ISO 9001/.test(tAnt.s) && !/NCh 123/.test(tAnt.s));
// Formato anterior: se imprime igual que con la versión publicada (cliente breve: byte a byte).
const legadoCorto = { folio: "ET-2026-0001", revision: 0, estado: "emitida", contenido: { fecha: "2026-11-09", cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5" }, cotizacion: { folio: "CP-2026-0001", revision: 1 },
  plazo_entrega: "10 días", responsable: "Kevin", empresa: { razon_social: "Ingeniería y Servicios BFK Limitada" }, objeto: "Suministro de bomba", items: [{ item_id: "a", orden: 1, cantidad: 2, unidad: "UN", tipo: "producto", nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] }] } };
const a = normalizar(refVP.crearPdfEETTVP(legadoCorto, { jsPDF, logo }).output("arraybuffer")), b = normalizar(vp.crearPdfEETTVP(legadoCorto, { jsPDF, logo }).output("arraybuffer"));
ok("C4 una EETT emitida con el formato anterior se descarga idéntica (byte a byte) a la versión publicada", a === b);
ok("C4b nombre de archivo del formato anterior sin cambios", vp.nombreArchivoEETTVP(legadoCorto) === refVP.nombreArchivoEETTVP(legadoCorto));
const legadoLargo = { ...legadoCorto, contenido: { ...legadoCorto.contenido, cliente: FX.cliente } };
ok("C5 formato anterior con razón social larga: también idéntico byte a byte a la versión publicada (el ajuste del cliente es solo del formato nuevo)",
  normalizar(refVP.crearPdfEETTVP(legadoLargo, { jsPDF, logo }).output("arraybuffer")) === normalizar(vp.crearPdfEETTVP(legadoLargo, { jsPDF, logo }).output("arraybuffer")));
// El generador sin la opción «completo» corta la celda igual que antes; con ella, la escribe completa.
const tabla = (completo) => act.crearPdfEETT({ nombre: "X" }, [{ ficha: { nombre: "P" } }], { jsPDF, proceso: [[{ titulo: "Plazo entrega", valor: "1 día" }, { titulo: "Cliente", valor: FX.cliente.razon_social, ...(completo ? { completo: true } : {}) }, { titulo: "RUT", valor: "1-9" }]] }).output("arraybuffer");
const tablaRef = refPdf.crearPdfEETT({ nombre: "X" }, [{ ficha: { nombre: "P" } }], { jsPDF, proceso: [[{ titulo: "Plazo entrega", valor: "1 día" }, { titulo: "Cliente", valor: FX.cliente.razon_social }, { titulo: "RUT", valor: "1-9" }]] }).output("arraybuffer");
ok("C5b opción explícita «completo»: sin ella, la tabla es idéntica a la publicada; con ella, el cliente se lee completo",
  normalizar(tabla(false)) === normalizar(tablaRef) && !/CARABINEROS DE CHILE/.test((await texto(Buffer.from(tabla(false)))).s) && /CARABINEROS DE CHILE/.test((await texto(Buffer.from(tabla(true)))).s));
// Mercado Público: el generador no cambia (mismo PDF byte a byte que la versión publicada).
const cotMP = { id_externo: "1525570-33-COT26", nombre: "ADQUISICIÓN DE BOLSOS PARAMÉDICOS PARA EL SERVICIO DE URGENCIA DEL HOSPITAL", fecha: "2026-11-09", plazo: "3 días habiles", institucion: FX.cliente.razon_social, rut: FX.cliente.rut };
const itemsMP = [{ ficha }, { ficha: { nombre: "Bomba", marca: "Pedrollo", modelo: "CPm 680", generales: [{ etiqueta: "Material", valor: "Hierro fundido" }], especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }] } }];
const elab = { vendedor: "Kevin Vergara", elaborado_por: "Kevin Vergara", fecha: "2026-11-09", cotizacion: "1525570-33-COT26", version: 3 };
const mpRef = refPdf.crearPdfEETT(cotMP, itemsMP, { jsPDF, logo, elaboracion: elab }).output("arraybuffer"), mpAct = act.crearPdfEETT(cotMP, itemsMP, { jsPDF, logo, elaboracion: elab }).output("arraybuffer");
ok("C6 el PDF de Mercado Público no cambia (byte a byte con la versión publicada), con la misma ficha del bolso", normalizar(mpRef) === normalizar(mpAct));
if (SALIDA) writeFileSync(join(SALIDA, "EETT-MP-misma-ficha-del-bolso.pdf"), Buffer.from(mpAct));

console.log(`\nRESUMEN eett_como_mp: ${nOk} OK, ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
