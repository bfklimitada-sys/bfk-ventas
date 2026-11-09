// EETT de la cotización de la captura (CP-2026-0001 · «Bolso Paramédico Mediano 47L») sobre una COPIA AISLADA de sus datos
// técnicos (fixture_cp_2026_0001.json y sus dos fotos reducidas), en navegador real, contra PostgREST real sobre una base
// desechable (nunca producción). Compara el recorrido privado con el de Mercado Público (simulador de siempre, misma ficha).
//   Privado: abrir CP-2026-0001 con su borrador ET-2026-0001 Rev. 0 armado por la ventana anterior → pestaña EETT (revisión de
//   fichas, sin «No informado», sin objeto/alcance) → «Vista previa de EETT» (no guarda nada) → «Generar y descargar» desde la
//   vista previa → la EETT se emite con el mismo folio y revisión → el PDF trae la descripción y las características →
//   «PDF» desde «EETT generadas» descarga lo mismo → generar otra vez no emite una revisión idéntica.
//   Mercado Público: misma ficha → pestaña EETT → vista previa → generar y descargar (para comparar pantallas y PDF).
// Uso: (entorno.sh instalar) → PGRST_URL, JWT_SECRET, VP_DB_URL ·
//      node docs/pruebas-ventas-privadas/e2e_eett_cp_2026_0001.mjs http://127.0.0.1:4330/ escritorio|celular   (CAPTURAS=carpeta)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrir, chromium, CHROME, U, psql, comoUsuario, sinDesborde, calma, marca, escriturasMP, archivos } from "./arnes_vp.mjs";
import { crearBase, abrir as abrirMP } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";
import * as ui from "./ui_cotizacion_vp.mjs";
import { itemEETTDesde } from "../../src/lib/ventasPrivadas.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.argv[2] || "http://127.0.0.1:4330/"; const MODO = process.argv[3] || "escritorio"; const movil = MODO === "celular";
const [ancho, alto] = movil ? [390, 844] : [1440, 900];
const CAPT = process.env.CAPTURAS || "/tmp/capturas-eett-cp"; mkdirSync(CAPT, { recursive: true });
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 600)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
// s: texto completo. continuo: el texto sin los cortes de página (encabezado, pie, número y franja «(continuación)»), para
// leer un párrafo que la plantilla continúa en la página siguiente.
async function textoPDF(buf) {
  const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, verbosity: 0 }).promise; const pags = [];
  for (let i = 1; i <= d.numPages; i++) pags.push((await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " ").trim());
  const continuo = pags.map((t, i) => { let x = t.replace(/\s*\d+ \/ \d+$/, ""); if (i > 0) { const k = x.indexOf("(CONTINUACIÓN) DESCRIPCIÓN TÉCNICA "); x = k >= 0 ? x.slice(k + 35) : x.replace(/^.*?Laja, Chile\. /, ""); } return x; }).join(" ").replace(/ ELABORACI.N DE ESPECIFICACIONES T.CNICAS.*$/, "");
  return { s: pags.join(" "), continuo, paginas: d.numPages };
}
async function descarga(p, accion) { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), accion()]); return { buf: readFileSync(await dl.path()), nombre: dl.suggestedFilename() }; }
const captura = async (p, nombre) => { await espera(p, 400); await p.screenshot({ path: `${CAPT}/${MODO}-${nombre}.png` }); };
const comoPDF = (s) => String(s).replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
const PROHIBIDAS = /\/api\/(inteligencia|interpretar|compra-agil)/;
const vigilar = (p) => { const vistas = []; p.on("request", (r) => { if (PROHIBIDAS.test(r.url())) vistas.push(r.url().replace(/\?.*/, "")); }); return vistas; };
const imagenes = (buf) => (Buffer.from(buf).toString("latin1").match(/\/Subtype \/Image/g) || []).length;

// ── Copia aislada de los datos técnicos de CP-2026-0001 (sin costos ni precios de producción) ──────────────────────────────
const FX = JSON.parse(readFileSync(join(AQUI, "fixture_cp_2026_0001.json"), "utf8"));
const ficha = FX.item.ficha; const C = FX.cat;
const FOTOS = ficha.imagenes.map((r) => ({ ruta: r, buf: readFileSync(join(AQUI, "fixture_cp_2026_0001", r.split("/").pop())) }));
for (const f of FOTOS) { psql(`insert into storage.objects (bucket_id, name, owner, metadata) values ('cz-productos', ${lit(f.ruta)}, '${U.ana}', '{}'::jsonb);`); archivos.set("cz-productos/" + f.ruta, f.buf); }
psql(`insert into public.productos_catalogo (id, nombre, marca, modelo, color, descripcion_tecnica, caracteristicas, especificaciones, imagenes, fuente, estado, creado_por, ultima_revision)
      values ('${C.id}', ${lit(C.nombre)}, ${lit(C.marca)}, ${lit(C.modelo)}, ${lit(C.color)}, ${lit(C.descripcion_tecnica)}, ${lit(JSON.stringify(ficha.generales))}::jsonb, ${lit(JSON.stringify(ficha.especificaciones))}::jsonb, ${lit(JSON.stringify(C.imagenes))}::jsonb, ${lit(C.fuente)}, 'aprobado', '${U.ana}', now());`);
const cli = JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_guardar_cliente(${lit(JSON.stringify({ rut: "61513003-6", razon_social: FX.cliente.razon_social, tipo_persona: "empresa", direccion_entrega: "Santiago", comuna_entrega: "Santiago" }))}::jsonb);`));
const cot = JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_guardar_cotizacion(${lit(JSON.stringify({ cliente_id: cli.id, plazo_entrega: FX.rev.plazo_entrega, vigencia_dias: 15,
  items: [{ tipo: "producto", producto_id: C.id, descripcion: FX.item.descripcion, unidad: "UN", cantidad: 2, precio_unitario: 59990, ficha, ficha_aprobada: false }] }))}::jsonb);`));
const folio = q1(`select folio from public.vp_cotizaciones where id = '${cot.id}';`);
const linea = JSON.parse(q1(`select to_jsonb(i) from public.vp_cotizacion_items i where revision_id = '${cot.revision_id}';`));
// Borrador de la ventana anterior, con el mismo contenido que ET-2026-0001 en producción (objeto vacío y 12 textos sin valor).
const legado = { ...FX.eett.contenido, cotizacion: { folio, revision: 0 }, items: [itemEETTDesde(linea, null, null)] };
const borr = JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_guardar_eett(${lit(JSON.stringify({ cotizacion_id: cot.id, contenido: legado }))}::jsonb);`));
ok("P0 copia aislada: CP-2026-0001 con el bolso y su borrador ET-2026-0001 Rev. 0 (12 textos sin valor, objeto vacío)", folio === "CP-2026-0001" && borr.folio === "ET-2026-0001" && borr.revision === 0
  && q1(`select jsonb_array_length(contenido->'items'->0->'caracteristicas')||'|'||coalesce(contenido->>'objeto','')||'|'||estado from public.vp_eett where id = '${borr.id}';`) === "12||borrador", JSON.stringify({ folio, borr }));

async function irACotizaciones(p) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="vp_cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="vp_cotizaciones"]').click();
  await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 500);
}

async function recorridoPrivado(browser) {
  const { page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ancho, alto, movil });
  const llamadas = vigilar(p); await calma(); const m0 = marca();
  await irACotizaciones(p); await p.locator(`[data-cotizacion="${folio}"]`).click(); await espera(p, 1500);
  const h = ui.hoja(p);
  await ui.pestana(p, "eett"); await espera(p, 600); await captura(p, "privado-1-pestana-eett");
  const tab = await h.locator('[role="tabpanel"]:visible, [data-panel-pestana="eett"]').first().innerText().catch(() => h.innerText());
  ok(`${MODO} V1 pestaña EETT como Mercado Público: «Ficha 1: Bolso Paramédico Mediano 47L» lista, «Vista previa de EETT» y «Generar y descargar EETT»`, (await h.locator("[data-revision-eett]").count()) === 1
    && /Ficha 1: Bolso Param.dico Mediano 47L/.test(await h.locator('[data-revision-eett="1"]').innerText()) && /Lista/.test(await h.locator('[data-revision-eett="1"]').innerText())
    && await h.locator("[data-generar-eett]").isEnabled() && /Vista previa de EETT/.test(await h.locator("[data-vista-previa-eett]").innerText()));
  ok(`${MODO} V2 sin «No informado», sin «Objeto del suministro» ni «Alcance», sin lista de errores ni ventana propia`, !/No informado|Objeto del suministro|Alcance|Emitir EETT|Guardar borrador/i.test(await h.innerText()) && !(await p.locator('[data-ventana^="eett"], [data-errores-eett]').count()), tab.slice(0, 300));
  ok(`${MODO} V3 el borrador anterior aparece en «EETT generadas» y se completará con el mismo folio`, /ET-2026-0001 Rev\. 0/.test(await h.locator('[data-eett="ET-2026-0001-R0"]').innerText()) && /Sin emitir/.test(await h.locator('[data-eett="ET-2026-0001-R0"]').innerText()));
  const v0 = q1(`select version||'|'||estado from public.vp_eett where id = '${borr.id}';`);
  await h.locator("[data-vista-previa-eett]").click(); const vp = p.locator('[data-hoja-lateral="vista-previa-eett"]');
  await vp.locator('[data-pagina-preview="1"]').waitFor({ timeout: 20000 }); await espera(p, 900); await captura(p, "privado-2-vista-previa");
  ok(`${MODO} V4 vista previa (la de Mercado Público): no guarda ni emite nada`, /Vista previa de EETT/.test(await vp.innerText()) && /No se guard. la cotizaci.n ni se registr. ninguna EETT/.test(await vp.innerText())
    && /EETT_CP-2026-0001_ET-2026-0001\.pdf · 2 p.ginas/.test(await vp.innerText()) && q1(`select version||'|'||estado from public.vp_eett where id = '${borr.id}';`) === v0);
  if (await vp.locator('[data-pagina-preview="2"]').count()) { await vp.locator('[data-pagina-preview="2"]').scrollIntoViewIfNeeded(); await captura(p, "privado-3-vista-previa-pagina-2"); }
  const d1 = await descarga(p, () => vp.getByText("Generar y descargar", { exact: true }).click()); await espera(p, 1500);
  writeFileSync(`${CAPT}/${MODO}-EETT-privada-${d1.nombre}`, d1.buf);
  await captura(p, "privado-4-tras-generar");
  const t = await textoPDF(d1.buf);
  const fila = JSON.parse(q1(`select to_jsonb(e) - 'contenido' || jsonb_build_object('formato', contenido->>'formato', 'objeto', contenido ? 'objeto', 'n', jsonb_array_length(contenido->'items'->0->'caracteristicas')) from public.vp_eett e where id = '${borr.id}';`));
  ok(`${MODO} V5 «Generar y descargar» desde la vista previa emite el MISMO borrador (ET-2026-0001 Rev. 0) con el formato de Mercado Público`, fila.estado === "emitida" && fila.folio === "ET-2026-0001" && fila.revision === 0 && fila.formato === "mp" && fila.objeto === false && fila.n === 7 && /^[0-9a-f]{64}$/.test(fila.hash)
    && q1(`select count(*) from public.vp_eett where cotizacion_id = '${cot.id}';`) === "1", JSON.stringify(fila));
  ok(`${MODO} V6 archivo con el criterio de Mercado Público`, d1.nombre === "EETT_CP-2026-0001_ET-2026-0001_Rev0.pdf", d1.nombre);
  const PARES = ficha.descripcion.split("\n").map((l) => l.split(/:\s*/));
  ok(`${MODO} V7 el PDF trae nombre, marca, modelo y color de la ficha`, /1\. BOLSO PARAM.DICO MEDIANO 47L/.test(t.s) && /MARCA TBQ/.test(t.s) && /MODELO BOL-BPRM-A/.test(t.s) && /COLOR Azul/.test(t.s));
  ok(`${MODO} V8 el PDF trae las 7 características con su valor (Especificaciones)`, PARES.every(([e, v]) => t.s.includes(comoPDF(e)) && t.s.includes(comoPDF(v))), PARES.filter(([e, v]) => !t.s.includes(comoPDF(e)) || !t.s.includes(comoPDF(v))));
  const textos = [...ficha.generales, ...ficha.especificaciones].map((x) => x.etiqueta);
  ok(`${MODO} V9 el PDF trae la descripción técnica completa (12 textos descriptivos, ninguno como característica vacía)`, /DESCRIPCI.N T.CNICA/.test(t.s) && textos.every((x) => t.continuo.includes(comoPDF(x))), textos.filter((x) => !t.continuo.includes(comoPDF(x))).map((x) => x.slice(0, 50)));
  ok(`${MODO} V10 encabezado con referencias del canal (cotización, EETT, cliente completo, RUT, plazo) y sin «No informado»`, /CP-2026-0001 ET-2026-0001 Rev\. 0/.test(t.s) && /CARABINEROS DE CHILE 61\.513\.003-6/.test(t.s) && /3 d.as habiles/.test(t.s)
    && !/No informado|Objeto del suministro|LICITACI.N|INSTITUCI.N SOLICITANTE|BORRADOR/i.test(t.s));
  ok(`${MODO} V11 las 2 fotos de la ficha van en el PDF (como en Mercado Público) y sin precios`, imagenes(d1.buf) >= 3 && !/\$\s?\d|59\.990/.test(t.s), imagenes(d1.buf));
  ok(`${MODO} V12 «EETT generadas» muestra ET-2026-0001 Rev. 0 emitida con su PDF`, /Emitida/.test(await h.locator('[data-eett="ET-2026-0001-R0"]').innerText()) && (await h.locator('[data-eett="ET-2026-0001-R0"] [data-descargar-eett]').count()) === 1);
  await h.locator('[data-eett="ET-2026-0001-R0"]').scrollIntoViewIfNeeded(); await captura(p, "privado-5-eett-generadas");
  const d2 = await descarga(p, () => h.locator('[data-eett="ET-2026-0001-R0"] [data-descargar-eett]').click());
  ok(`${MODO} V13 «PDF» de la EETT emitida descarga el mismo documento`, (await textoPDF(d2.buf)).s === t.s && d2.nombre === d1.nombre);
  const d3 = await descarga(p, () => h.locator("[data-generar-eett]").click()); await espera(p, 1200);
  ok(`${MODO} V14 generar otra vez sin cambios descarga la misma emisión (no crea otra revisión)`, q1(`select count(*) from public.vp_eett where cotizacion_id = '${cot.id}';`) === "1" && (await textoPDF(d3.buf)).s === t.s);
  ok(`${MODO} V15 sin desborde horizontal`, !movil || await sinDesborde(p));
  ok(`${MODO} V16 sin errores de página`, !errs.length, errs.join(" | "));
  ok(`${MODO} V17 sin llamadas a Inteligencia Comercial, IA ni sincronizaciones`, !llamadas.length, llamadas.join(" "));
  ok(`${MODO} V18 no se escribió nada en Mercado Público`, !escriturasMP(m0).length);
  await ctx.close();
  return t;
}

// Mercado Público con la MISMA ficha (simulador de siempre): para comparar pantallas y PDF.
async function recorridoMP(browser) {
  const b = crearBase(crearDatos(), {});
  const { page: p, ctx, errs } = await abrirMP(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route)); const llamadas = vigilar(p);
  const fotos = FOTOS.map((f) => "data:image/jpeg;base64," + f.buf.toString("base64"));
  M.cots.set("c-1", { id: "c-1", version: 2, id_externo: "1234-5-COT26", nombre: "Adquisición de bolso paramédico", institucion: FX.cliente.razon_social, rut: FX.cliente.rut, direccion_entrega: "Santiago", comuna: "Santiago", estado: "borrador",
    fecha: "2026-11-09", plazo: FX.rev.plazo_entrega, recargo: 0.3, actualizado_en: "2026-11-09", vendedor_id: null, vendedor_nombre: "", envios: [],
    items: [{ key: "a", cantidad: 2, precio_origen: 46000, precio_incluye_iva: true, con_factura: true, envio_key: null, recargo: null, proveedor: "Falabella", enlace: "https://tienda.invalid/x", ficha: { ...ficha, imagenes: fotos } }] });
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); } else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500); await p.locator('[data-cotizacion="1234-5-COT26"]').click(); await espera(p, 1500);
  const H = p.locator('[data-hoja-lateral="cotizacion"]');
  await H.locator('[role="tab"][data-tab="eett"]').click(); await espera(p, 600); await captura(p, "mp-1-pestana-eett");
  ok(`${MODO} MP1 pestaña EETT de Mercado Público con la misma ficha`, (await H.locator("[data-revision-eett]").count()) === 1 && /Vista previa de EETT/.test(await H.locator("[data-vista-previa-eett]").innerText()));
  for (const cb of await H.locator("[data-aprobar-ficha] input").all()) if (!(await cb.isChecked())) await cb.check().catch(() => {});
  await H.locator("[data-vista-previa-eett]").click(); const vp = p.locator('[data-hoja-lateral="vista-previa-eett"]');
  await vp.locator('[data-pagina-preview="1"]').waitFor({ timeout: 20000 }); await espera(p, 900); await captura(p, "mp-2-vista-previa");
  const boton = vp.getByText("Generar y descargar", { exact: true });
  const d = await descarga(p, async () => { if (await boton.count()) await boton.click(); else { await vp.locator("[data-cerrar-hoja]").first().click(); await H.locator("[data-generar-eett]").click(); } });
  writeFileSync(`${CAPT}/${MODO}-EETT-MP-${d.nombre}`, d.buf); await espera(p, 800); await captura(p, "mp-3-tras-generar");
  const t = await textoPDF(d.buf);
  ok(`${MODO} MP2 EETT de Mercado Público generada y descargada con la misma plantilla`, /INFORMACI.N T.CNICA DE PRODUCTOS/.test(t.s) && /BOLSO PARAM.DICO MEDIANO 47L/.test(t.s) && imagenes(d.buf) >= 3);
  ok(`${MODO} MP3 sin errores ni llamadas a Inteligencia Comercial`, !errs.length && !llamadas.some((u) => /inteligencia/.test(u)), errs.join(" | ") + llamadas.join(" "));
  await ctx.close();
  return t;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const tMP = await recorridoMP(browser);
  const tVP = await recorridoPrivado(browser);
  // Misma estructura del documento: banda, tabla, franja del producto, CARACTERÍSTICAS, dos columnas, descripción, elaboración, pie.
  const estructura = (s) => ["INFORMACIÓN TÉCNICA DE PRODUCTOS", "BOLSO PARAMÉDICO MEDIANO 47L", "CARACTERÍSTICAS", "Características Generales", "Especificaciones", "ELABORACIÓN DE ESPECIFICACIONES TÉCNICAS", "Empresa: BFK Limitada", "bfklimitada@gmail.com"].map((x) => s.includes(x));
  ok(`${MODO} X1 ambos PDF con la misma estructura de la plantilla de Mercado Público`, estructura(tMP.s).every(Boolean) && estructura(tVP.s).every(Boolean), JSON.stringify([estructura(tMP.s), estructura(tVP.s)]));
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_eett_cp_2026_0001 (${MODO}): ${nOk} OK, ${F.length} fallas · Capturas y PDF en ${CAPT}`);
process.exit(F.length ? 1 : 0);
