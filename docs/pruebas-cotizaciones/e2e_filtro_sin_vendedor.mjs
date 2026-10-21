// Vista general de Cotizaciones: filtro «Sin vendedor asignado», combinación con estado, etiqueta «Sin vendedor»,
// indicador de presentadas sin vendedor y filtros en la consulta paginada del SERVIDOR (21/10/2026).
// PC 1280 px y celular 390 px, Supabase SIMULADO (filtra como PostgREST; nada sale a la red). Incluye las 4 cotizaciones
// históricas presentadas sin vendedor de producción (mismos códigos, instituciones y montos) y el borrador sin vendedor.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_filtro_sin_vendedor.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "./modulo_simulado.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const CATALOGO = [{ id: "v1", nombre: "Vendedor Uno" }, { id: "v2", nombre: "Vendedora Dos" }];
const ITEM = (k, precio) => ({ key: k, producto_id: null, ficha: { nombre: "Producto " + k, marca: "Marca", modelo: "M-" + k, especificaciones: [{ etiqueta: "Tipo", valor: "Prueba" }], imagenes: [] }, ficha_aprobada: true, enlace: "https://tienda.cl/" + k, proveedor: "Tienda", cantidad: 1, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, disponibilidad: "En stock", origen_datos: "enlace" });
const COT = (id, codigo, institucion, nombre, estado, vend, neto, total, act) => ({ id, version: 1, id_externo: codigo, nombre, institucion, rut: "61.000.000-0", direccion_entrega: "Calle 1", comuna: "Laja", estado, fecha: act.slice(0, 10), recargo: 0.3, plazo: "5 DIAS", actualizado_en: act,
  vendedor_id: vend?.id || null, vendedor_nombre: vend?.nombre || "", subtotal_neto: neto, impuestos: total - neto, total,
  envios: [{ key: "e1", proveedor: "Tienda", monto: 0, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "simulación" }], items: [ITEM("a", Math.round(total))] });
// Las 4 históricas (antiguas: sin filtro quedan en la página 2) + borrador sin vendedor + 26 con vendedor más recientes.
const HIST = [
  COT("h1", "1507-10-COT26", "MINISTERIO DE OBRAS PUBLICAS DIREC CION GRAL DE OO PP DCYF", "Adquisición de 4 neumáticos para vehículo fiscal", "presentada", null, 380172, 452405, "2026-10-17T03:05:00Z"),
  COT("h2", "5067-2525-COT26", "UNIVERSIDAD DE SANTIAGO DE CHILE", "Sol.93785 CC006 / Adquisición de Celular", "presentada", null, 972269, 1157000, "2026-10-20T00:21:00Z"),
  COT("h3", "1101892-226-COT26", "INSTITUTO DE INVESTIGACIONES AGROPECUARIAS", "(1)- impresora multifuncional de inyeccion de tinta", "presentada", null, 287311, 341900, "2026-10-20T23:40:00Z"),
  COT("h4", "836-92-COT26", "GOBIERNO REGIONAL V REGION", "Adquisición de Notebook para el Gobierno Regional de Valparaíso", "presentada", null, 1273185, 1515090, "2026-10-20T19:41:00Z"),
].map((c) => ({ ...c, recargo: 0, items: c.id === "h1" ? [ITEM("a", 452404)] : c.items }));   // 452404 con IVA → neto 380172 + IVA 72233 = 452405   // sin recargo: el total que recalcula el editor coincide con el precio del producto
const BORR = { ...COT("b1", "", "", "", "borrador", null, 377020, 448654, "2026-10-17T01:46:00Z"), id_externo: null };
const CON = Array.from({ length: 26 }, (_, i) => COT(`c${i}`, `${9000 + i}-1-COT26`, i % 2 ? "MUNICIPALIDAD DE LAJA" : "HOSPITAL DE LOS ANGELES", `Compra ${i}`, i === 0 ? "adjudicada" : i < 3 ? "borrador" : "presentada", CATALOGO[i % 2], 100000, 119000, `2026-10-21T1${String(i % 10)}:${String(10 + i).padStart(2, "0")}:00Z`));
const CODIGOS_HIST = HIST.map((c) => c.id_externo).sort();

async function preparar({ movil }) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, usuario: "u2", ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 2500 });
  const M = moduloSimulado(2); M.reglaVendedor = { catalogo: CATALOGO, admins: ["u1"] };
  for (const c of [...HIST, BORR, ...CON]) M.cots.set(c.id, JSON.parse(JSON.stringify(c)));
  await r.page.route("**/*", (route) => M.manejar(route));
  await r.page.reload({ waitUntil: "load" }); await espera(r.page, 2500);
  return { ...r, p: r.page, M };
}
async function irCotizaciones(p, movil) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
}
const tarjetas = (p) => p.locator("[data-panel-cotizaciones] [data-cotizacion]");
const codigos = async (p) => (await tarjetas(p).evaluateAll((els) => els.map((e) => e.getAttribute("data-cotizacion")))).sort();
const ultimaConsulta = (M) => (M.consultasLista || []).filter((x) => /cotizacion_items/.test(x)).at(-1) || "";
const marcarSinVendedor = async (p, v) => { const c = p.locator("[data-filtro-sin-vendedor] input"); if ((await c.isChecked()) !== v) await c.click(); await espera(p, 900); };
const indicador = (p) => p.locator('[data-indicador-monto="presentadas-sin-vendedor"]');
const instantanea = (M) => JSON.stringify([...M.cots.values()].filter((c) => !["h1"].includes(c.id)).map((c) => [c.id, c.vendedor_id, c.vendedor_nombre, c.estado, c.total]));

for (const movil of [false, true]) {
  const K = movil ? "M" : "P";
  const { p, ctx, M, errs } = await preparar({ movil });
  await irCotizaciones(p, movil);
  const otrasAntes = instantanea(M);
  if (process.env.CAPTURA_INICIO) await p.screenshot({ path: `${process.env.CAPTURA_INICIO}-${K}.png` });

  // 1. Indicador de presentadas sin vendedor (cuenta del servidor, no de la página cargada).
  ok(`${K}01_indicador_presentadas_sin_vendedor_4`, (await indicador(p).innerText()).trim() === "4" && /Presentadas sin vendedor/.test(await p.locator("[data-panel-cotizaciones]").innerText()));
  ok(`${K}02_cuenta_desde_el_servidor`, (M.consultasLista || []).some((x) => /estado=eq\.presentada/.test(x) && /vendedor_id=is\.null/.test(x) && /select=id&/.test(x)));

  // 2. Sin filtros: 31 cotizaciones paginadas; las históricas NO están en la primera página.
  const pag1 = await codigos(p);
  ok(`${K}03_sin_filtro_paginado_historicas_fuera_de_pagina_1`, pag1.length === 20 && !pag1.some((c) => CODIGOS_HIST.includes(c)) && /31 cotizaciones/.test(await p.locator("[data-paginacion]").innerText()), pag1);

  // 3. Filtro «Sin vendedor asignado»: históricas + borrador (de toda la base, vía servidor).
  ok(`${K}04_texto_filtrar_por_vendedor`, (await p.locator("[data-filtro-vendedor]").getAttribute("placeholder")) === "Filtrar por vendedor" && (await p.locator("[data-filtro-vendedor]").getAttribute("aria-label")) === "Filtrar por vendedor");
  await marcarSinVendedor(p, true);
  const sv = await codigos(p);
  ok(`${K}05_sin_vendedor_incluye_historicas_y_borrador`, sv.length === 5 && CODIGOS_HIST.every((c) => sv.includes(c)) && sv.includes("b1"), sv);
  ok(`${K}06_filtro_en_consulta_del_servidor`, /vendedor_id=is\.null/.test(ultimaConsulta(M)) && /limit=20&offset=0/.test(ultimaConsulta(M)), ultimaConsulta(M));
  ok(`${K}07_etiqueta_sin_vendedor_en_cada_una`, await p.locator("[data-panel-cotizaciones] [data-cotizacion] [data-sin-vendedor]").count() === 5);
  ok(`${K}08_filtro_vendedor_deshabilitado_con_sin_vendedor`, await p.locator("[data-filtro-vendedor]").isDisabled());
  ok(`${K}09_resumen_5_cotizaciones`, /5 cotizaciones con estos filtros/.test(await p.locator("[data-resumen-filtros]").innerText()));

  // 4. Combinado con «Presentada»: las 4 históricas que requieren regularización.
  await p.locator("[data-filtro-estado]").selectOption("presentada"); await espera(p, 900);
  const pres = await codigos(p);
  ok(`${K}10_presentada_y_sin_vendedor_son_las_4_historicas`, JSON.stringify(pres) === JSON.stringify(CODIGOS_HIST), pres);
  ok(`${K}11_consulta_combina_estado_y_sin_vendedor`, /estado=eq\.presentada/.test(ultimaConsulta(M)) && /vendedor_id=is\.null/.test(ultimaConsulta(M)));
  ok(`${K}12_resumen_indica_regularizar`, /requieren asignar vendedor responsable/.test(await p.locator("[data-resumen-filtros]").innerText()));
  const t836 = p.locator('[data-cotizacion="836-92-COT26"]');
  ok(`${K}13_tarjeta_historica_muestra_institucion_y_etiqueta`, /GOBIERNO REGIONAL V REGION/.test(await t836.innerText()) && /Sin vendedor/.test(await t836.innerText()) && /Presentada/.test(await t836.innerText()));

  // 5. Búsqueda por código, institución y nombre, combinada con los filtros (servidor).
  const buscar = async (t) => { await p.locator("[data-buscar-cotizacion]").fill(t); await espera(p, 900); return codigos(p); };
  ok(`${K}14_busca_por_codigo`, JSON.stringify(await buscar("836-92")) === '["836-92-COT26"]');
  ok(`${K}15_busca_por_institucion`, JSON.stringify(await buscar("santiago de chile")) === '["5067-2525-COT26"]');
  ok(`${K}16_busca_por_nombre`, JSON.stringify(await buscar("neumáticos")) === '["1507-10-COT26"]');
  ok(`${K}17_busqueda_en_consulta_del_servidor`, /or=\(id_externo\.ilike\.\*neumáticos\*,nombre\.ilike/.test(ultimaConsulta(M)) && /vendedor_id=is\.null/.test(ultimaConsulta(M)), ultimaConsulta(M));
  ok(`${K}18_busqueda_sin_resultados_con_aviso`, (await buscar("hospital")).length === 0 && /No hay cotizaciones con esos filtros/.test(await p.locator("[data-panel-cotizaciones]").innerText()));

  // 6. Quitar filtros y luego «Filtrar por vendedor» (servidor); las que tienen vendedor no llevan la etiqueta.
  await p.locator("[data-quitar-filtros]").click(); await espera(p, 900);
  ok(`${K}19_quitar_filtros`, (await codigos(p)).length === 20 && !(await p.locator("[data-filtro-sin-vendedor] input").isChecked()) && (await p.locator("[data-filtro-estado]").inputValue()) === "" && (await p.locator("[data-buscar-cotizacion]").inputValue()) === "");
  await p.locator("[data-filtro-vendedor]").fill("dos"); await espera(p, 900);
  const dos = await tarjetas(p).count();
  ok(`${K}20_filtrar_por_vendedor_en_servidor`, dos === 13 && /vendedor_nombre=ilike\.\*dos\*/.test(ultimaConsulta(M)) && await p.locator("[data-panel-cotizaciones] [data-sin-vendedor]").count() === 0, { dos, q: ultimaConsulta(M) });
  await p.locator("[data-filtro-vendedor]").fill(""); await espera(p, 900);

  // 7. Indicador → lleva directo a Presentada + Sin vendedor.
  await p.locator('[data-indicador-monto="presentadas-sin-vendedor"]').click(); await espera(p, 900);
  ok(`${K}21_indicador_abre_las_que_requieren_regularizacion`, JSON.stringify(await codigos(p)) === JSON.stringify(CODIGOS_HIST) && (await p.locator("[data-filtro-estado]").inputValue()) === "presentada" && await p.locator("[data-filtro-sin-vendedor] input").isChecked());

  // 8. Cada histórica se abre y se puede volver a guardar sin vendedor (sin cambios de montos ni vendedor).
  for (const h of HIST) {
    await p.locator(`[data-cotizacion="${h.id_externo}"]`).click(); await espera(p, 1500);
    await tab(p, "datos");
    const aviso = await H(p).locator('[data-aviso-linea="historica-sin-vendedor"]').count();
    await H(p).locator('[data-campo="comuna"]').fill("Laja (revisada)");
    const n0 = M.rpc.filter((r) => /cz_guardar/.test(r.fn)).length;
    await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1300);
    const c = M.cots.get(h.id);
    ok(`${K}22_${h.id_externo}_abre_y_guarda_sin_vendedor`, aviso === 1 && M.rpc.filter((r) => /cz_guardar/.test(r.fn)).length === n0 + 1 && c.version === 2 && !c.vendedor_id && c.estado === "presentada" && Number(c.total) === h.total, { aviso, v: c.version, vend: c.vendedor_id, total: c.total });
    await H(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 900);
    // restablecer la simulación (cada caso parte de la histórica tal como está en producción)
    M.cots.set(h.id, JSON.parse(JSON.stringify(h)));
  }

  // 9. Al asignar vendedor a una histórica, deja de aparecer en el filtro y el indicador baja (solo PC; en la simulación).
  if (!movil) {
    await p.locator('[data-cotizacion="836-92-COT26"]').click(); await espera(p, 1500); await tab(p, "datos");
    await H(p).locator('[data-campo="vendedor"]').selectOption("v1"); await espera(p, 200);
    await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1300);
    await H(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 1500);
    const tras = await codigos(p);
    ok("P23_asignada_sale_del_filtro_e_indicador_baja", tras.length === 3 && !tras.includes("836-92-COT26") && (await indicador(p).innerText()).trim() === "3" && M.cots.get("h4").vendedor_nombre === "Vendedor Uno", { tras });
    M.cots.set("h4", JSON.parse(JSON.stringify(HIST[3])));
  }

  // 10. Nada más cambió: vendedores existentes, estados y montos de las demás cotizaciones intactos; sin otras llamadas.
  ok(`${K}24_otras_cotizaciones_y_vendedores_intactos`, instantanea(M) === otrasAntes);
  ok(`${K}25_solo_guardados_de_cotizacion`, M.rpc.every((r) => /cz_guardar_cotizacion/.test(r.fn)), [...new Set(M.rpc.map((r) => r.fn))]);
  ok(`${K}26_sin_desborde_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok(`${K}27_sin_errores_js`, errs.length === 0, errs);
  if (movil) await p.screenshot({ path: process.env.CAPTURA_MOVIL || "/tmp/filtro_movil.png", fullPage: false });
  else await p.screenshot({ path: process.env.CAPTURA_PC || "/tmp/filtro_pc.png", fullPage: false });
  await ctx.close();
}

await browser.close();
console.log(`RESUMEN e2e filtro sin vendedor: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
