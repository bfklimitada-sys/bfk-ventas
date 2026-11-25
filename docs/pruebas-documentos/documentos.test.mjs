// Pruebas del generador documental de la oferta (25/11/2026): procesamiento del texto pegado, modelo público, los tres PDF,
// privacidad, determinismo, paginación, numeración, Mercado Público y Ventas privadas, valores económicos iguales al cálculo.
// Uso (desde la raíz del repositorio):
//   npx esbuild docs/pruebas-documentos/documentos.test.mjs --bundle --platform=node --format=esm --outfile=/tmp/doc.test.mjs \
//     --loader:.jsx=jsx --define:import.meta.env='{}' && node /tmp/doc.test.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { jsPDF } from "jspdf";
import { calcularCotizacion, fichaParaGuardar } from "../../src/lib/cotizaciones.js";
import { procesarTextoTecnico, filasDeFicha, categoriaDe, normalizarUnidades, reestructurarFicha } from "../../src/lib/especificaciones.js";
import { modeloOfertaMP, modeloOfertaVP, propuestaMatrizMP, condicionesDocumento, fichaDocumento, plazoDesdeProductos, textoPlazo, condicionesConProductos } from "../../src/lib/modeloOferta.js";
import { generarDocumentoOferta, nombreArchivoOferta, fichasEETT, revisarModeloOferta, pesos } from "../../src/lib/documentosOferta.js";
import { versionPara, huellaContenido } from "../../src/lib/documentosOfertaDatos.js";
import { documentoDesdeEditor } from "../../src/lib/ventasPrivadas.js";
import { IMG, LOGO, FUENTES, TEXTO_TV, TEXTO_SILLA } from "./casos.mjs";
import { cotizacionEjemplo } from "./generar_ejemplos.mjs";

let n = 0; const F = [];
const ok = (t, c, d = "") => { if (c) { n++; console.log("OK   ", t); } else { F.push(t); console.log("FALLA", t, typeof d === "string" ? d.slice(0, 400) : JSON.stringify(d).slice(0, 400)); } };
const DIR = "/tmp/pruebas-documentos"; fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
const opciones = { jsPDF, fuentes: FUENTES, logo: LOGO };
const texto = (bytes, nombre) => { const f = `${DIR}/${nombre}`; fs.writeFileSync(f, Buffer.from(bytes)); return execFileSync("pdftotext", ["-layout", f, "-"]).toString(); };
const fuentesPdf = (nombre) => execFileSync("pdffonts", [`${DIR}/${nombre}`]).toString();
const paginasTexto = (t) => t.split("\f").filter((p) => p.trim()).map((p) => p.replace(/[ \t]+/g, " "));

// ── 1. Texto pegado ──
const tv = procesarTextoTecnico(TEXTO_TV, { marca: "Samsung", modelo: "UN43U8000HGXPE", nombre: "Smart TV" });
ok("T1 se reconocen pares en dos líneas, «:» y listados", tv.filas.some((f) => f.etiqueta === "Tamaño de pantalla" && f.valor === "43 pulgadas") && tv.filas.some((f) => f.etiqueta === "Puertos HDMI" && f.valor === "3"));
ok("T2 publicidad y datos comerciales fuera (precio, cuotas, envío, vendedor)", ["Precio", "cuotas", "Envío gratis", "Vendido por"].every((p) => tv.descartados.some((d) => d.includes(p))) && !tv.filas.some((f) => /\$|cuotas|vendido/i.test(`${f.etiqueta} ${f.valor}`)), tv.descartados);
ok("T3 el texto original se conserva intacto", tv.original === TEXTO_TV);
ok("T4 valores negativos «No» se conservan", tv.filas.some((f) => f.etiqueta === "HDR" && f.valor === "No") && tv.filas.some((f) => f.etiqueta === "VGA" && f.valor === "No"));
ok("T5 unidades: número y unidad separados (60hz → 60 Hz, 120kg → 120 kg) sin tocar otras palabras", normalizarUnidades("60hz") === "60 Hz" && normalizarUnidades("120kg") === "120 kg" && normalizarUnidades("1 año") === "1 año" && normalizarUnidades("4K UHD") === "4K UHD");
const silla = procesarTextoTecnico(TEXTO_SILLA);
ok("T6 tabla con tabuladores (silla) y agrupación dinámica sin categorías vacías", silla.filas.length >= 11 && silla.categorias.every((c) => c.filas.length) && silla.categorias.some((c) => c.id === "ergonomia") && silla.categorias.some((c) => c.id === "materiales"), silla.categorias.map((c) => c.id));
ok("T7 calificaciones y despacho de la página quedan fuera", silla.descartados.length === 2);
const contra = procesarTextoTecnico("Resolución: 4K\nResolución: Full HD\nPeso: -\nPeso: -\nColor: Negro\nColor: Negro");
ok("T8 contradicción marcada (se conservan ambos valores), incompleto marcado, duplicado exacto eliminado",
  contra.filas.filter((f) => f.etiqueta === "Resolución").length === 2 && contra.filas.filter((f) => f.etiqueta === "Resolución").every((f) => f.contradictorio)
  && contra.filas.filter((f) => f.etiqueta === "Peso").length === 1 && contra.filas.find((f) => f.etiqueta === "Peso").incompleto && contra.filas.filter((f) => f.etiqueta === "Color").length === 1
  && contra.avisos.some((a) => a.tipo === "contradiccion") && contra.avisos.some((a) => a.tipo === "incompleto"));
const amb = procesarTextoTecnico("Potencia\n750 W\nVelocidad\nRegulable\nIncluye maletín de transporte y dos brocas.");
ok("T9 párrafo descriptivo conservado aparte; pares de dos líneas reconocidos", amb.filas.length === 2 && amb.parrafos.length === 1);
const marcaMal = procesarTextoTecnico("Marca: LG\nModelo: 43UR", { marca: "Samsung", modelo: "UN43" });
ok("T10 marca/modelo distintos a la ficha: aviso, sin corregir", marcaMal.avisos.filter((a) => a.tipo === "contradiccion").length === 2);
ok("T11 descripción breve solo con datos presentes", /43 pulgadas/.test(tv.descripcion) && !/excelente|ideal|perfect|inmersiv/i.test(tv.descripcion));
ok("T12 categorías por etiqueta: peso máximo = capacidad, material = materiales, apoyacabezas = ergonomía, frecuencia de actualización = pantalla",
  categoriaDe("Peso máximo soportado") === "operacion" && categoriaDe("Material del asiento") === "materiales" && categoriaDe("Apoyacabezas") === "ergonomia" && categoriaDe("Frecuencia de actualización") === "pantalla");
ok("T13 texto vacío o sin características: aviso", procesarTextoTecnico("").avisos.some((a) => a.tipo === "vacio"));
const conTablaPipe = procesarTextoTecnico("| Voltaje | 220 V |\n| Potencia | 1200w |");
ok("T14 tabla con «|»", conTablaPipe.filas.length === 2 && conTablaPipe.filas[1].valor === "1200 W");

// ── 2. Modelo público y cálculo (Mercado Público) ──
const cot = cotizacionEjemplo(); const calc = calcularCotizacion(cot);
const cond = { plazo_entrega: "5 días desde la aceptación de la OC", tipo_dias: "habiles", garantia: "12 meses", vigencia: "30 días" };
const modelo = modeloOfertaMP(cot, calc, { version: 1, fecha: "2026-11-25", condiciones: cond, matriz: propuestaMatrizMP(cot) });
ok("M1 precios del modelo = cálculo existente (unitario y total por línea, neto, IVA, total)",
  modelo.items.every((it, i) => it.unitario === calc.lineas[i].unitario_neto && it.total === calc.lineas[i].neto_linea)
  && modelo.totales.neto === calc.totales.neto && modelo.totales.iva === calc.totales.iva_debito && modelo.totales.total === calc.totales.total, { m: modelo.totales, c: calc.totales });
ok("M2 despacho Mercado Público = $0 (modalidad A)", modelo.totales.despacho_texto === "$0" && calc.totales.despacho_mercado_publico === 0);
const json = JSON.stringify(modelo);
ok("M3 el modelo no contiene costos, recargos, proveedores, enlaces ni utilidades",
  !/costo|recargo|proveedor|enlace|utilidad|margen|precio_origen|envio|financ|comision/i.test(Object.keys(flat(modelo)).join(" ")) && !json.includes("Tienda A") && !json.includes("160000"));
ok("M4 condiciones sin valores inventados: solo las completadas + las que salen de Productos (despacho incluido en el valor unitario)",
  condicionesDocumento({}).length === 0 && modelo.condiciones.length === 4 && modelo.condiciones[0].valor.includes("hábiles")
  && modelo.condiciones.some((c) => c.titulo === "Despacho" && c.valor === "Incluido en el valor unitario"), modelo.condiciones);
// Ficha pegada «tal cual» desde Mercado Libre (25/11/2026): etiqueta y valor en líneas separadas, títulos de sección y
// una característica sin valor. Se reordena sola (al guardar y al imprimir), sin inventar valores.
{
  const ml = fs.readFileSync(`${process.env.RAIZ_BFK || "."}/docs/pruebas-documentos/ficha_mercadolibre.txt`, "utf8");
  const r = procesarTextoTecnico(ml, { marca: "Hisense", modelo: "55q6qv" });
  const v = (e) => r.filas.find((f) => f.etiqueta === e)?.valor;
  const cat = (e) => r.filas.find((f) => f.etiqueta === e)?.categoria;
  ok("ML1 pares en dos líneas con títulos de sección: cada etiqueta con su valor (sin corrimientos)",
    v("Sistema operativo") === "Vidaa" && v("Apps integradas") === "Netflix, YouTube, Disney+, Prime Video" && v("Es smart") === "Sí" && v("Con HDMI") === "Sí"
    && v("Cantidad de puertos HDMI") === "3" && v("Accesorios incluidos") === "Control remoto" && v("Frecuencia de actualización de la pantalla") === "60 Hz" && v("Peso con soporte") === "9,5 kg"
    && !r.filas.some((f) => ["Tecnología", "Conectividad", "Pantalla", "Peso y dimensiones", "Accesorios"].includes(f.etiqueta) || /^(Sí|No)$/.test(f.etiqueta)), r.filas.map((f) => `${f.etiqueta}=${f.valor}`));
  ok("ML2 categorías por etiqueta o por la sección de la página", cat("Tipo de resolución") === "pantalla" && cat("Con Wi-Fi") === "conectividad" && cat("Sistema operativo") === "software" && cat("Peso") === "dimensiones" && cat("Accesorios incluidos") === "accesorios");
  ok("ML3 la etiqueta sin valor no se inventa ni se corre: queda avisada y fuera de la ficha", !r.filas.some((f) => /contraste/i.test(f.etiqueta)) && r.descartados.includes("Relación de contraste: (sin valor)") && r.avisos.some((a) => /Relación de contraste/.test(a.mensaje)));
  const ficha = { nombre: "TV", marca: "Hisense", modelo: "55q6qv", generales: [], especificaciones: ml.split("\n").map((l) => ({ etiqueta: l, valor: "" })), descripcion: "" };
  const d = fichaDocumento(ficha);
  ok("ML4 ficha guardada desordenada → el documento la imprime por categorías; los párrafos quedan en la descripción",
    d.categorias.some((c) => c.titulo === "Conectividad" && c.filas.length === 7) && /Dolby Vision/.test(d.descripcion) && !/^Vidaa$/m.test(d.descripcion) && !/^Sí$/m.test(d.descripcion), d.categorias.map((c) => c.titulo));
  const simple = { nombre: "Silla", descripcion: "Silla ergonómica.\nMuy cómoda." , especificaciones: [{ etiqueta: "Material", valor: "Malla" }] };
  ok("ML5 una ficha sin ese formato queda exactamente igual", reestructurarFicha(simple) === simple);
}
// Plazo de entrega desde los productos (25/11/2026): se define junto al despacho; el de la oferta es el mayor (5 hábiles ≈ 7 corridos).
{
  const it = (d, t, x) => ({ ficha: { condiciones_producto: { plazo_dias: d, plazo_tipo: t, plazo_entrega: x } } });
  const a = plazoDesdeProductos([it(5, "habiles"), it(8, "corridos"), it(null, "", "")]);
  const b = plazoDesdeProductos([it(10, "habiles"), it(12, "corridos")]);
  ok("M4b plazo de la oferta = el mayor de los productos (hábiles vs corridos) y cuenta los productos sin plazo",
    a.texto === "8 días corridos" && a.sinPlazo === 1 && b.texto === "10 días hábiles" && textoPlazo(1, "habiles") === "1 día hábil", { a, b });
  const c = condicionesConProductos({}, [it(5, "habiles")], "15 DÍAS"); const d = condicionesConProductos({ plazo_entrega: "Inmediato", despacho: "A bodega" }, [it(5, "habiles")], "");
  const e = condicionesConProductos({}, [it(null, "", "")], "15 DÍAS");
  ok("M4c lo escrito a mano prevalece; sin plazo en productos se usa el plazo anterior de la cotización; servicios sin despacho",
    c.plazo_entrega === "5 días hábiles" && d.plazo_entrega === "Inmediato" && d.despacho === "A bodega" && e.plazo_entrega === "15 DÍAS"
    && condicionesConProductos({}, [{ tipo: "servicio", ficha: {} }], "").despacho === "", { c, d, e });
  const g = fichaParaGuardar({ nombre: "X", condiciones_producto: { plazo_dias: "7", plazo_tipo: "habiles", plazo_entrega: "7 días hábiles", basura: "x" } });
  ok("M4d el plazo del producto se guarda (días, tipo y texto) sin campos extra", JSON.stringify(g.condiciones_producto) === JSON.stringify({ plazo_entrega: "7 días hábiles", plazo_dias: 7, plazo_tipo: "habiles" }), g.condiciones_producto);
}
ok("M5 matriz propuesta desde requerimientos: siempre «Por verificar»", modelo.matriz.length === 1 && modelo.matriz[0].estado === "por_verificar" && modelo.matriz[0].item === 1);
ok("M6 sin requerimientos no hay matriz (nunca se inventa)", propuestaMatrizMP({ ...cot, requerimientos: [] }).length === 0);
ok("M7 el texto original del proveedor nunca llega al modelo", !JSON.stringify(modeloOfertaMP({ ...cot, items: cot.items.map((it) => ({ ...it, ficha: { ...it.ficha, texto_original: "Precio $199.990 Tienda Ejemplo" } })) }, calc, {})).includes("199.990"));
function flat(o, p = "", out = {}) { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) flat(v, Array.isArray(o) ? p : `${p}.${k}`, out); else out[p] = o; return out; }

// ── 3. Los tres PDF ──
const docs = {};
for (const tipo of ["cotizacion", "eett", "oferta"]) docs[tipo] = await generarDocumentoOferta(tipo, modelo, opciones);
const tx = Object.fromEntries(Object.entries(docs).map(([k, r]) => [k, texto(r.bytes, r.nombre)]));
ok("P1 nombres de archivo COT_/EETT_/OFERTA_<referencia>_v1.pdf", docs.cotizacion.nombre === "COT_1540-1372-COT26_v1.pdf" && docs.eett.nombre === "EETT_1540-1372-COT26_v1.pdf" && docs.oferta.nombre === "OFERTA_1540-1372-COT26_v1.pdf");
ok("P2 fuente Liberation Sans incorporada (normal y negrita) y nada de Helvetica dibujado", ["cotizacion", "eett", "oferta"].every((t) => { const f = fuentesPdf(docs[t].nombre); return /LiberationSans\s+CID TrueType\s+Identity-H\s+yes/.test(f) && /LiberationSans-Bold|LiberationSans\b/.test(f); }));
ok("P3 A4 en todos", ["cotizacion", "eett", "oferta"].every((t) => /595\.2\d* x 841\.8\d* pts \(A4\)/.test(execFileSync("pdfinfo", [`${DIR}/${docs[t].nombre}`]).toString())));
ok("P4 cotización: precios, subtotal, IVA, total, despacho $0, condiciones y vendedor", [pesos(calc.lineas[0].unitario_neto), pesos(calc.totales.neto), pesos(calc.totales.iva_debito), pesos(calc.totales.total), "Despacho", "$0", "IVA 19%", "TOTAL OFERTA", "CONDICIONES COMERCIALES", "Plazo de entrega", "Vendedor responsable"].every((x) => tx.cotizacion.includes(x)), tx.cotizacion.slice(0, 800));
ok("P5 EETT sin ningún monto ni texto económico", !/\$\s?\d|TOTAL OFERTA|Subtotal|Unit\. neto|IVA/.test(tx.eett), tx.eett.match(/.*(\$\s?\d|IVA).*/)?.[0]);
ok("P6 ningún documento contiene costos, proveedores ni enlaces de compra", Object.values(tx).every((t) => !/Tienda A|160\.000|simulación|https?:\/\/|costo|recargo|utilidad/i.test(t)));
ok("P7 EETT: una ficha por producto con número de ítem, cantidad, fotos y especificaciones agrupadas", /ÍTEM 01 \| SMART TV SAMSUNG/.test(tx.eett) && /ÍTEM 02 \| SILLA ERGONÓMICA RD/.test(tx.eett) && /ÍTEM 03 \| SILLA DE ESCRITORIO SYRA/.test(tx.eett) && /Cantidad: 2 unidades/.test(tx.eett) && /Pantalla e imagen/.test(tx.eett) && /Ergonomía y ajustes/.test(tx.eett));
const imgsEett = execFileSync("pdfimages", ["-list", `${DIR}/${docs.eett.nombre}`]).toString().trim().split("\n").slice(2).filter((l) => / image /.test(l));
ok("P8 fotografías: 2 + 2 + 1 de los productos + logo en cada página", imgsEett.length === 5 + docs.eett.paginas, imgsEett.length);
ok("P9 numeración «n / N» en cada página y versión en el pie", paginasTexto(tx.eett).every((p, i, a) => new RegExp(`\\b${i + 1} ?/ ?${a.length}\\b`).test(p) && /Versión 01/.test(p)) && paginasTexto(tx.eett).length === docs.eett.paginas);
ok("P10 oferta consolidada: cotización + condiciones + fichas + matriz con numeración continua", docs.oferta.paginas === 1 + docs.eett.paginas && /OFERTA TÉCNICA Y ECONÓMICA/.test(tx.oferta) && /CONDICIONES COMERCIALES/.test(tx.oferta) && /CUMPLIMIENTO TÉCNICO/.test(tx.oferta) && paginasTexto(tx.oferta).every((p, i, a) => new RegExp(`\\b${i + 1} ?/ ?${a.length}\\b`).test(p)));
const pagFicha = [...tx.oferta.matchAll(/Ficha técnica: pág\. (\d+)/g)].map((m) => Number(m[1]));
ok("P11 cada producto del detalle cita la página de su ficha, y esa página tiene la ficha del mismo ítem", pagFicha.length === 3 && pagFicha.every((pg, i) => paginasTexto(tx.oferta)[pg - 1].includes(`ÍTEM 0${i + 1} |`)), pagFicha);
ok("P12 matriz: requisito, ofertado y estado", /Televisor: Pantalla de 43 pulgadas/.test(tx.eett) && /Por verificar/.test(tx.eett));
ok("P13 condiciones del producto (garantía particular) en su ficha", /CONDICIONES DEL PRODUCTO/.test(tx.eett) && /6 meses por defectos de fabricación/.test(tx.eett));
ok("P14 cliente en la EETT (institución y RUT)", /CLIENTE: MUNICIPALIDAD DE EJEMPLO · RUT 69\.000\.000-0/.test(tx.eett));

// ── 4. Determinismo: vista previa = documento emitido = documento descargado de nuevo ──
const otra = await generarDocumentoOferta("oferta", JSON.parse(JSON.stringify(modelo)), opciones);
ok("D1 mismo modelo → PDF idéntico byte a byte (huella igual)", otra.huellaPdf === docs.oferta.huellaPdf && Buffer.compare(Buffer.from(otra.bytes), Buffer.from(docs.oferta.bytes)) === 0);
const cambiado = await generarDocumentoOferta("oferta", { ...modelo, items: modelo.items.map((it, i) => (i ? it : { ...it, cantidad: 3 })) }, opciones);
ok("D2 cualquier cambio cambia la huella del modelo (obliga a revisar de nuevo)", cambiado.huellaModelo !== docs.oferta.huellaModelo);
const hc1 = await huellaContenido(modelo); const hc2 = await huellaContenido({ ...modelo, version: 7 });
ok("D3 la huella de contenido no depende del número de versión", hc1 === hc2);
ok("D4 versión: misma información conserva su número; información distinta → la siguiente", versionPara([{ version: 1, huella_contenido: hc1 }], hc1) === 1 && versionPara([{ version: 1, huella_contenido: "x" }], hc1) === 2 && versionPara([], hc1) === 1);

// ── 5. Casos de paginación y volumen ──
const diez = { ...modelo, items: Array.from({ length: 12 }, (_, i) => ({ ...modelo.items[i % 3], n: i + 1, nombre: `${modelo.items[i % 3].nombre} variante ${i + 1}` })) };
const r10 = await generarDocumentoOferta("oferta", diez, opciones); const t10 = texto(r10.bytes, r10.nombre);
const p10 = paginasTexto(t10);
ok("V1 doce productos: todas las fichas y páginas numeradas", Array.from({ length: 12 }, (_, i) => `ÍTEM ${String(i + 1).padStart(2, "0")} |`).every((x) => t10.includes(x)) && p10.every((p, i) => new RegExp(`\\b${i + 1} ?/ ?${p10.length}\\b`).test(p)), r10.paginas);
ok("V2 el detalle de la cotización continúa en otra página repitiendo el encabezado de la tabla", (t10.match(/DETALLE DE LA OFERTA/g) || []).length >= 1 && p10.filter((p) => /Producto ofertado/.test(p)).length >= 1);
// Página casi vacía: ninguna página (salvo la última) con menos del 25 % de líneas que la más llena.
const lineasPag = p10.map((p) => p.split("\n").filter((l) => l.trim()).length);
ok("V3 sin páginas prácticamente vacías", lineasPag.slice(0, -1).every((l) => l >= Math.max(...lineasPag) * 0.25), lineasPag);
const iguales = { ...modelo, items: [modelo.items[1], { ...modelo.items[1], n: 2 }, { ...modelo.items[0], n: 3 }].map((it, i) => ({ ...it, n: i + 1 })) };
const grupos = fichasEETT(iguales);
ok("V4 líneas con ficha idéntica → una sola ficha con la cantidad total", grupos.length === 2 && grupos[0].items.join(",") === "1,2" && grupos[0].cantidad === 6);
const rIg = await generarDocumentoOferta("eett", iguales, opciones);
ok("V5 la ficha agrupada indica sus ítems y la cantidad total", /ÍTEMS 01, 02 \| SILLA ERGONÓMICA RD/.test(texto(rIg.bytes, "ig.pdf")) && /Cantidad: 6 unidades/.test(texto(rIg.bytes, "ig.pdf")));
const extenso = { ...modelo, items: [{ ...modelo.items[0], ficha: { ...modelo.items[0].ficha, categorias: [{ titulo: "Otras características", filas: Array.from({ length: 70 }, (_, i) => ({ etiqueta: `Característica ${i + 1}`, valor: i % 7 === 0 ? "Valor extenso ".repeat(18) : `Valor ${i + 1}` })) }] } }] };
const rEx = await generarDocumentoOferta("eett", extenso, opciones); const tEx = texto(rEx.bytes, "ex.pdf");
ok("V6 información técnica extensa: continúa en varias páginas con «(continuación)», sin perder filas", rEx.paginas >= 3 && /\(CONTINUACIÓN\)/.test(tEx) && Array.from({ length: 70 }, (_, i) => `Característica ${i + 1}`).every((x) => tEx.includes(x)));
const sinFotos = { ...modelo, items: modelo.items.map((it) => ({ ...it, ficha: { ...it.ficha, imagenes: [] } })) };
const rSF = await generarDocumentoOferta("cotizacion", sinFotos, opciones);
ok("V7 sin fotografías: la cotización se genera y el detalle no deja hueco de miniaturas", rSF.paginas === 1 && revisarModeloOferta(sinFotos, "eett").some((a) => /sin fotografías/.test(a.mensaje)));
const cuatro = { ...modelo, items: [{ ...modelo.items[0], ficha: { ...modelo.items[0].ficha, imagenes: [IMG.tv_frente, IMG.tv_medidas, IMG.silla_rd_1, IMG.silla_syra] } }] };
const r4 = await generarDocumentoOferta("eett", cuatro, opciones);
ok("V8 cuatro fotografías en una ficha", execFileSync("pdfimages", ["-list", `${DIR}/${(fs.writeFileSync(`${DIR}/c4.pdf`, Buffer.from(r4.bytes)), "c4.pdf")}`]).toString().split("\n").filter((l) => / image /.test(l)).length === 4 + r4.paginas);

// ── 6. Avisos antes de emitir ──
const incompleto = { ...modelo, cliente: { nombre: "", filas: [] }, items: [{ ...modelo.items[0], unitario: 0, ficha: { ...modelo.items[0].ficha, categorias: [{ titulo: "Pantalla e imagen", filas: [{ etiqueta: "Resolución", valor: "4K", contradictorio: true }, { etiqueta: "Resolución", valor: "HD", contradictorio: true }] }] } }] };
const av = revisarModeloOferta(incompleto, "oferta");
ok("A1 faltantes y contradicciones se advierten; sin cliente o sin precio no se emite", av.some((a) => a.nivel === "bloqueo" && /cliente|institución/i.test(a.mensaje)) && av.some((a) => a.nivel === "bloqueo" && /precio/.test(a.mensaje)) && av.some((a) => /valores distintos/.test(a.mensaje)));
const conPrecio = { ...modelo, items: [{ ...modelo.items[0], ficha: { ...modelo.items[0].ficha, descripcion: "Oferta $199.990 en www.tienda.cl" } }] };
ok("A2 un precio o enlace en la información técnica bloquea la emisión", revisarModeloOferta(conPrecio, "eett").some((a) => a.nivel === "bloqueo"));

// ── 7. Ventas privadas: mismo diseño, sin campos de Mercado Público ──
const docVP = documentoDesdeEditor({ folio: "CP-2026-0007", revision: 0, cab: { fecha_emision: "2026-11-25", vigencia_hasta: "2026-12-25", plazo_entrega: "10 días hábiles", condiciones_pago: "Contado", contacto_nombre: "Ana Pérez", contacto_correo: "ana@ejemplo.cl", direccion_entrega: "Calle Uno 45, Concepción", afecta_iva: true },
  cliente: { razon_social: "Maderas del Sur SpA", rut: "76.086.428-5", giro: "Aserradero", direccion: "Ruta 5 km 10", comuna: "Los Ángeles" },
  items: [{ tipo: "producto", codigo: "", descripcion: "Silla ergonómica RD", unidad: "UN", cantidad: 4, precio_unitario: 95000, descuento_pct: 10 }, { tipo: "servicio", codigo: "", descripcion: "Armado en sitio", unidad: "UN", cantidad: 1, precio_unitario: 30000, descuento_pct: 0 }],
  empresa: { razon_social: "Ingeniería y Servicios BFK Limitada", rut: "76.000.000-0", correo: "bfklimitada@gmail.com" }, responsable: "Vendedor VP" });
const mVP = modeloOfertaVP(docVP, [cot.items[1].ficha, {}], { version: 1, vendedor: "Vendedor VP", condiciones: { garantia: "6 meses" } });
ok("VP1 totales del modelo = totales calculados por Ventas privadas", mVP.totales.neto === docVP.neto && mVP.totales.iva === docVP.iva && mVP.totales.total === docVP.total && mVP.items[0].total === docVP.items[0].subtotal_neto);
const cVP = await generarDocumentoOferta("cotizacion", mVP, opciones); const tVP = texto(cVP.bytes, cVP.nombre);
ok("VP2 nombre de archivo con el folio interno de BFK", cVP.nombre === "COT_CP-2026-0007_v1.pdf");
ok("VP3 datos de la venta privada: cliente, RUT, contacto, dirección; sin ID Compra Ágil ni institución", /Maderas del Sur SpA/.test(tVP) && /76\.086\.428-5/.test(tVP) && /Ana Pérez/.test(tVP) && /Calle Uno 45/.test(tVP) && !/Compra Ágil|Licitación|Institución/i.test(tVP));
ok("VP4 condiciones desde la cotización privada (plazo, forma de pago, vigencia) + garantía", /10 días hábiles/.test(tVP) && /Contado/.test(tVP) && /25\/12\/2026/.test(tVP) && /6 meses/.test(tVP));
ok("VP5 sin despacho «$0» de Mercado Público en ventas privadas", !/Despacho\s+\$0/.test(tVP));
const eVP = await generarDocumentoOferta("eett", mVP, opciones); const teVP = texto(eVP.bytes, eVP.nombre);
ok("VP6 la EETT privada omite el servicio sin ficha técnica y mantiene el diseño", /ÍTEM 01 \| SILLA ERGONÓMICA RD/.test(teVP) && !/ÍTEM 02/.test(teVP) && /INFORMACIÓN TÉCNICA/.test(teVP));
ok("VP7 mismo diseño: encabezado y pie iguales a Mercado Público (texto con «  |  » como la referencia)", /BFK Limitada \| Cotización económica CP-2026-0007 \| Versión 01/.test(tVP.replace(/[ \t]+/g, " ")) && /bfklimitada@gmail\.com \| \+56 9 97141822/.test(tVP.replace(/[ \t]+/g, " ")) && /COTIZACIÓN ECONÓMICA/.test(tVP));

// ── 8. Ficha real de CP-2026-0001 (copia aislada): textos descriptivos sin valor y pares dentro de la descripción ──
const FX = JSON.parse(fs.readFileSync("docs/pruebas-ventas-privadas/fixture_cp_2026_0001.json", "utf8"));
const mCP = modeloOfertaVP({ folio: "CP-2026-0001", fecha_emision: "2026-11-25", cliente: { razon_social: FX.cliente.razon_social, rut: "61.513.003-6" }, items: [{ tipo: "producto", descripcion: FX.item.descripcion, unidad: "UN", cantidad: 2, precio_unitario: 59990, subtotal_neto: 119980 }], neto: 119980, iva: 22796, total: 142776 },
  [{ ...FX.item.ficha, imagenes: [] }], { version: 1 });
const fCP = mCP.items[0].ficha; const filasCP = fCP.categorias.flatMap((c) => c.filas);
const rCP = await generarDocumentoOferta("eett", mCP, opciones); const tCP = texto(rCP.bytes, "cp.pdf").replace(/\s+/g, " ");
const textosCP = [...FX.item.ficha.generales, ...FX.item.ficha.especificaciones].map((x) => x.etiqueta.replace(/\s+/g, " ").trim());
ok("R1 ficha real: los textos sin valor van a «Descripción técnica», nunca como característica vacía", !filasCP.some((r) => !String(r.valor || "").trim()) && textosCP.every((x) => fCP.descripcion.replace(/\s+/g, " ").includes(x)));
ok("R2 ficha real: los pares de la descripción son características (capacidad, dimensiones, material)", ["Capacidad", "Dimensiones", "Material"].every((e) => filasCP.some((r) => r.etiqueta.startsWith(e) && r.valor)));
ok("R3 ficha real: el PDF trae todos los textos descriptivos completos", textosCP.every((x) => tCP.includes(x.replace(/[—–]/g, (m) => m))), textosCP.filter((x) => !tCP.includes(x)).map((x) => x.slice(0, 40)));

console.log(`\nRESUMEN documentos: ${n} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
