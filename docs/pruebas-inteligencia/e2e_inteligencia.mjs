// Inteligencia Comercial (04/11/2026; 05/11/2026: criterio de fecha, avance con pausa y cancelación, avisos separados,
// fechas relativas a hoy para que la prueba no dependa del día en que se ejecuta): prueba de interfaz en escritorio y celular. Supabase, ChileCompra y /api/inteligencia
// SIMULADOS (nada sale a la red). ic_resumen / ic_detalle se simulan con lib/inteligenciaComercial.js, cuya igualdad con
// las funciones SQL reales se comprueba aparte (validar_sql.sh → sql_vs_js.mjs).
// Uso: node docs/pruebas-inteligencia/e2e_inteligencia.mjs http://127.0.0.1:4302/
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { COTIZACIONES, filaCotizacion, versionesDe, respuestasMP } from "./fixture.mjs";
import { normalizarResultadoMP, construirOportunidades, filtrarOportunidades, resumirOportunidades, resumenConCriterio, ordenarPaginar, periodoDe } from "../../src/lib/inteligenciaComercial.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4302/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);
const pesos = (s) => (/[-−]/.test(String(s || "")) ? -1 : 1) * Number(String(s || "").replace(/[^0-9]/g, ""));

const mp = respuestasMP();
const RES = Object.entries(mp).map(([c, r]) => ({ ...normalizarResultadoMP(c, r.listado, r.detalle, { detalleError: r.detalleFalla ? "HTTP 504" : "" }), consultado_en: "2026-11-04T03:00:00Z", verificado_en: "2026-11-04T03:00:00Z", consulta_estado: "ok" }));
const COT = COTIZACIONES.map(filaCotizacion), VER = COTIZACIONES.flatMap(versionesDe);
const OPS = construirOportunidades(COT, VER, RES), OPS_LOCAL = construirOportunidades(COT, VER, []);
const filtrosDe = (b) => ({ desde: b.p_desde || null, hasta: b.p_hasta || null, institucion: b.p_institucion || "", vendedor: b.p_vendedor || "", resultado: b.p_resultado || "" });
// Fechas relativas a la ejecución (corrección F): la última sincronización simulada es de hace 1 hora (no dispara la automática).
const haceUnaHora = () => new Date(Date.now() - 3600_000).toISOString();
const hoyChile = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
const hoyDMA = () => [hoyChile(), new Date().toISOString().slice(0, 10)].flatMap((x) => { const [a, m, d] = x.split("-"); return [`${d}-${m}-${a}`, `${d}/${m}/${a}`, `${Number(d)}/${Number(m)}/${a}`]; });

// Rutas propias (tienen prioridad sobre las del simulador general por registrarse después).
async function rutasIC(page, est) {
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch { /* sin cuerpo */ }
    if (u.pathname.endsWith("/api/inteligencia")) {
      est.sinc.push(b); const r = est.respSinc.shift() || { status: 200, json: { ok: true, procesados: 0, actualizados: 0, errores: 0, hay_mas: false } };
      if (r.json?.ok) est.ultimaSinc = new Date().toISOString();
      return route.fulfill({ status: r.status, json: r.json });
    }
    if (!u.hostname.endsWith("supabase.co")) return route.fallback();
    const fn = u.pathname.includes("/rpc/") ? u.pathname.split("/").pop() : null;
    if (["ic_resumen", "ic_detalle", "ic_resumen_v2", "ic_detalle_v2"].includes(fn)) {
      est.rpc.push({ fn, b });
      if (est.modo === "caida") return route.fulfill({ status: 503, json: { message: "Servicio no disponible (simulado)" } });
      if (est.modo === "sin_migracion" || (est.modo === "base_v1" && fn.endsWith("_v2"))) return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Could not find the function public." + fn } });
      if (est.lento) await new Promise((ok) => setTimeout(ok, est.lento));
      const f = { ...filtrosDe(b), criterio: fn.endsWith("_v2") ? b.p_criterio : "presentacion" };
      if (fn.startsWith("ic_resumen")) return route.fulfill({ json: { ...resumenConCriterio(OPS, f), ultima_sincronizacion: est.ultimaSinc } });
      return route.fulfill({ json: ordenarPaginar(filtrarOportunidades(OPS, f), { q: b.p_q, orden: b.p_orden, desc: b.p_desc, pagina: Math.floor(b.p_offset / b.p_limite), porPagina: b.p_limite }) });
    }
    const tabla = u.pathname.split("/").pop();
    if (req.method() === "GET" && tabla === "cotizaciones" && u.searchParams.get("estado")?.startsWith("in.(presentada")) { est.lecturas.push("cotizaciones"); return route.fulfill({ json: COT.filter((c) => ["presentada", "adjudicada", "no_adjudicada"].includes(c.estado)) }); }
    if (req.method() === "GET" && tabla === "cotizacion_versiones") { est.lecturas.push("versiones"); return route.fulfill({ json: VER.filter((v) => v.estado !== "borrador") }); }
    return route.fallback();
  });
}
async function abrirIC(page) { await page.click('[data-desplegable="inteligencia"] > button'); await page.waitForSelector("[data-inteligencia]", { timeout: 15000 }); await page.waitForSelector('[data-indicador="ic-presentadas"]', { timeout: 15000 }); await espera(page, 700); }
const kpi = (page, d) => page.$eval(`[data-indicador="${d}"] [data-indicador-monto]`, (e) => e.textContent.trim()).catch(() => null);
const nuevoEstado = (o = {}) => ({ modo: "base", rpc: [], sinc: [], respSinc: [], lecturas: [], ultimaSinc: haceUnaHora(), lento: 0, ...o });
const esResumen = (r) => r.fn.startsWith("ic_resumen");

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const datos = () => { const d = crearDatos(); d.cotizaciones = COT; return d; };

for (const vista of [{ n: "escritorio", ancho: 1280, alto: 900, movil: false }, { n: "celular", ancho: 390, alto: 844, movil: true }]) {
  const V = vista.n;
  // ── Administrador, migración instalada ──
  const base = crearBase(datos()); const est = nuevoEstado();
  const { page, errs, ctx } = await abrir(browser, base, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
  const chunks = []; page.on("request", (r) => { if (/InteligenciaComercial-/.test(r.url())) chunks.push(r.url()); });
  await rutasIC(page, est);
  // T13: el Panel abre normalmente y sin cargar el módulo
  ok(`${V}_T13_panel_abre_con_sus_indicadores`, !!(await page.$('[data-indicador="banco"]')) && !!(await page.$('[data-desplegable="inteligencia"]')));
  ok(`${V}_T13_modulo_no_se_descarga_al_abrir_el_panel`, chunks.length === 0 && est.rpc.length === 0);
  const escrAntes = base.escr.length;
  const t0 = Date.now(); await abrirIC(page); const msAbrir = Date.now() - t0;
  ok(`${V}_T13_indicadores_en_menos_de_2_s (${msAbrir} ms)`, msAbrir < 2000 + 700);
  ok(`${V}_T13_carga_diferida_al_abrir`, chunks.length === 1);
  const anio = resumirOportunidades(filtrarOportunidades(OPS, periodoDe({ tipo: "anio", anio: 2026 }))).indicadores;
  ok(`${V}_K01_ocho_indicadores`, (await page.$$('[data-indicador^="ic-"]')).length === 8);
  ok(`${V}_K00_usa_funciones_v2_con_criterio_presentacion`, est.rpc.some((r) => r.fn === "ic_resumen_v2" && r.b.p_criterio === "presentacion"), est.rpc.map((r) => r.fn));
  ok(`${V}_K02_presentadas`, (await kpi(page, "ic-presentadas")) === String(anio.presentadas), [await kpi(page, "ic-presentadas"), anio.presentadas]);
  ok(`${V}_K03_monto_ofertado_neto`, pesos(await kpi(page, "ic-ofertado")) === anio.monto_ofertado_neto);
  ok(`${V}_K04_ganadas_perdidas_pendientes`, (await kpi(page, "ic-ganadas")) === String(anio.ganadas) && (await kpi(page, "ic-perdidas")) === String(anio.perdidas) && (await kpi(page, "ic-pendientes")) === String(anio.pendientes));
  ok(`${V}_K05_monto_adjudicado`, pesos(await kpi(page, "ic-adjudicado")) === anio.monto_ganado_neto);
  ok(`${V}_K06_tasa`, (await kpi(page, "ic-tasa")) === `${String(anio.tasa_exito).replace(".", ",")}%`, [await kpi(page, "ic-tasa"), anio.tasa_exito]);
  ok(`${V}_K07_diferencia_comparables`, (await kpi(page, "ic-diferencia")) === `${String(anio.diferencia_pct_ponderada).replace(".", ",")}%`);
  ok(`${V}_G01_cinco_graficos`, (await page.$$("[data-grafico]")).length === 5);
  // D: cobertura parcial y avisos separados por tipo
  const txt = async (d) => (await page.$(`[data-aviso-linea="${d}"]`)) ? (await page.textContent(`[data-aviso-linea="${d}"]`)) : "";
  ok(`${V}_D10_cobertura_parcial_informada`, new RegExp(`Indicadores parciales: ${anio.sin_consultar + anio.pendientes_por_verificar} oportunidad(es)? .*\\(${anio.sin_consultar} sin consultar · ${anio.pendientes_por_verificar} por verificar\\)`).test(await txt("ic-cobertura")), await txt("ic-cobertura"));
  ok(`${V}_D11_ganadas_sin_regularizar_separadas`, /^.?1 adjudicación ganada según ChileCompra sigue «presentada» en Cotizaciones/.test((await txt("ic-avisos-ganadas")).trim()) && /1 oportunidad donde ChileCompra informa un resultado distinto/.test(await txt("ic-avisos")), [await txt("ic-avisos-ganadas"), await txt("ic-avisos")]);
  ok(`${V}_D12_tasa_marcada_parcial`, /parcial/.test(await page.textContent('[data-indicador="ic-tasa"]')));
  ok(`${V}_D13_pendientes_desglosadas`, new RegExp(`${anio.sin_consultar} sin consultar · ${anio.en_proceso} en proceso · ${anio.pendientes_por_verificar} por verificar`).test(await page.textContent('[data-indicador="ic-pendientes"]')), await page.textContent('[data-indicador="ic-pendientes"]'));
  ok(`${V}_G02_competidores_frente_a_bfk`, (await page.$$eval("[data-competidor]", (xs) => xs.map((x) => x.getAttribute("data-competidor")))).join() === "77.888.999-K,76.111.111-1");
  // Rótulo interactivo (hover/toque)
  const barra = await page.$('[data-barra="perdida"]'); await barra.scrollIntoViewIfNeeded(); await espera(page, 200); const bb = await barra.boundingBox();
  const n0 = est.rpc.length;
  if (vista.movil) {
    // Celular: un toque muestra el valor y filtra por ese resultado (texto alternativo del gráfico con los valores).
    await page.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height - 4); await espera(page, 900);
    ok(`${V}_G03_texto_alternativo_con_valores`, new RegExp(`Perdidas: ${anio.perdidas}`).test(await page.getAttribute("[data-grafico='barras-resultado'] svg", "aria-label")));
  } else {
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height - 4); await espera(page, 300);
    ok(`${V}_G03_rotulo_al_pasar_o_tocar`, /Perdidas/.test(await page.$eval("[data-grafico='barras-resultado'] [data-rotulo]", (e) => e.textContent).catch(() => "")));
    await page.click('[data-barra="perdida"]'); await espera(page, 900);
  }
  ok(`${V}_F01_barra_filtra_resultado`, est.rpc.slice(n0).some((r) => esResumen(r) && r.b.p_resultado === "perdida") && (await page.$eval('[data-filtro="resultado"]', (e) => e.value)) === "perdida");
  await page.selectOption('[data-filtro="resultado"]', ""); await espera(page, 700);
  // Filtros: mes, año, rango, institución y vendedor
  await page.selectOption('[data-filtro="tipo"]', "mes"); await page.selectOption('[data-filtro="anio"]', "2026"); await page.selectOption('[data-filtro="mes"]', "10"); await espera(page, 900);
  const oct = resumirOportunidades(filtrarOportunidades(OPS, periodoDe({ tipo: "mes", anio: 2026, mes: 10 }))).indicadores;
  ok(`${V}_T01_filtro_mes`, est.rpc.filter(esResumen).slice(-1)[0].b.p_desde === "2026-10-01" && (await kpi(page, "ic-presentadas")) === String(oct.presentadas) && (await kpi(page, "ic-tasa")) === `${String(oct.tasa_exito).replace(".", ",")}%`);
  await page.selectOption('[data-filtro="mes"]', "11"); await espera(page, 900);
  ok(`${V}_T01_filtro_mes_noviembre`, (await kpi(page, "ic-presentadas")) === String(resumirOportunidades(filtrarOportunidades(OPS, periodoDe({ tipo: "mes", anio: 2026, mes: 11 }))).indicadores.presentadas));
  await page.selectOption('[data-filtro="tipo"]', "rango"); await page.fill('[data-filtro="desde"]', "2026-10-10"); await page.fill('[data-filtro="hasta"]', "2026-10-25"); await espera(page, 900);
  const rg = resumirOportunidades(filtrarOportunidades(OPS, { desde: "2026-10-10", hasta: "2026-10-25" })).indicadores;
  ok(`${V}_T01_filtro_rango`, (await kpi(page, "ic-presentadas")) === String(rg.presentadas) && est.rpc.filter(esResumen).slice(-1)[0].b.p_hasta === "2026-10-25");
  await page.selectOption('[data-filtro="tipo"]', "anio"); await page.fill('[data-filtro="institucion"]', "hospital de los angeles"); await espera(page, 900);
  ok(`${V}_T01_filtro_institucion`, (await kpi(page, "ic-presentadas")) === String(resumirOportunidades(filtrarOportunidades(OPS, { ...periodoDe({ tipo: "anio", anio: 2026 }), institucion: "hospital de los angeles" })).indicadores.presentadas));
  await page.fill('[data-filtro="institucion"]', ""); await page.selectOption('[data-filtro="vendedor"]', "Vendedora Dos"); await espera(page, 900);
  ok(`${V}_T01_filtro_vendedor`, (await kpi(page, "ic-presentadas")) === String(resumirOportunidades(filtrarOportunidades(OPS, { ...periodoDe({ tipo: "anio", anio: 2026 }), vendedor: "Vendedora Dos" })).indicadores.presentadas));
  await page.selectOption('[data-filtro="vendedor"]', ""); await espera(page, 700);
  // T09/cancelación: cambios rápidos → solo cuenta el último (las consultas anteriores se cancelan o se descartan)
  est.lento = 600; const nr = est.rpc.length;
  await page.selectOption('[data-filtro="tipo"]', "rango"); await page.fill('[data-filtro="desde"]', "2026-10-02"); await page.fill('[data-filtro="hasta"]', "2026-10-20"); await espera(page, 400); await page.fill('[data-filtro="hasta"]', "2026-11-03"); await espera(page, 2200); est.lento = 0;
  const ult = est.rpc.slice(nr).filter(esResumen);
  ok(`${V}_P01_consultas_obsoletas_canceladas`, ult.length >= 1 && ult.length <= 3 && ult.slice(-1)[0].b.p_hasta === "2026-11-03" && (await kpi(page, "ic-presentadas")) === String(resumirOportunidades(filtrarOportunidades(OPS, { desde: "2026-10-02", hasta: "2026-11-03" })).indicadores.presentadas), ult.map((r) => r.b.p_hasta));
  await page.selectOption('[data-filtro="tipo"]', "mes"); await page.selectOption('[data-filtro="mes"]', "11"); await espera(page, 900);
  // Caché por período: volver al mismo período no consulta otra vez
  const nc = est.rpc.length; await page.selectOption('[data-filtro="mes"]', "10"); await espera(page, 900);
  ok(`${V}_P02_cache_por_periodo`, est.rpc.length === nc);
  // E1: criterio de fecha de adjudicación (noviembre): solo resultados con fecha; pendientes no aplican
  await page.selectOption('[data-filtro="mes"]', "11"); await espera(page, 900);
  await page.selectOption('[data-filtro="criterio"]', "adjudicacion"); await espera(page, 1000);
  const novA = resumenConCriterio(OPS, { ...periodoDe({ tipo: "mes", anio: 2026, mes: 11 }), criterio: "adjudicacion" }).indicadores;
  const ultR = est.rpc.filter(esResumen).slice(-1)[0];
  ok(`${V}_E101_consulta_con_criterio_adjudicacion`, ultR.fn === "ic_resumen_v2" && ultR.b.p_criterio === "adjudicacion" && ultR.b.p_desde === "2026-11-01", ultR);
  ok(`${V}_E102_indicadores_por_adjudicacion`, (await kpi(page, "ic-presentadas")) === String(novA.presentadas) && (await kpi(page, "ic-ganadas")) === String(novA.ganadas) && (await kpi(page, "ic-perdidas")) === String(novA.perdidas), [await kpi(page, "ic-presentadas"), novA.presentadas, await kpi(page, "ic-perdidas"), novA.perdidas]);
  ok(`${V}_E103_criterio_identificado_y_sin_mezcla`, /Oportunidades resueltas/.test(await page.textContent('[data-indicador="ic-presentadas"]')) && (await kpi(page, "ic-pendientes")) === "—"
    && /Criterio: fecha de adjudicación/.test(await page.textContent('[data-aviso-linea="ic-criterio"]')) && /Por fecha de adjudicación/.test(await page.textContent("[data-estado-sinc]")) && !(await page.$('[data-aviso-linea="ic-cobertura"]')));
  await page.click('[data-desplegable="ic-detalle"] > button'); await page.waitForSelector("[data-fila-ic]", { timeout: 8000 }); await espera(page, 700);
  const filasA = await page.$$eval("[data-fila-ic]", (xs) => xs.map((x) => x.getAttribute("data-fila-ic")));
  const espA = ordenarPaginar(filtrarOportunidades(OPS, { ...periodoDe({ tipo: "mes", anio: 2026, mes: 11 }), criterio: "adjudicacion" }), { orden: "fecha_adjudicacion", desc: true, porPagina: 15 }).filas.map((o) => o.clave);
  ok(`${V}_E104_detalle_ordenado_por_adjudicacion_con_columna`, filasA.join() === espA.join() && (await page.$$("[data-fecha-adjudicacion]")).length === espA.length && filasA.includes("1001-2-COT26"), [filasA, espA]);
  await page.click('[data-desplegable="ic-detalle"] > button'); await espera(page, 400);
  await page.selectOption('[data-filtro="criterio"]', "presentacion"); await espera(page, 900);
  const novP = resumenConCriterio(OPS, periodoDe({ tipo: "mes", anio: 2026, mes: 11 })).indicadores;
  ok(`${V}_E105_volver_a_presentacion_desde_cache`, /Cotizaciones presentadas/.test(await page.textContent('[data-indicador="ic-presentadas"]')) && (await kpi(page, "ic-presentadas")) === String(novP.presentadas) && (await kpi(page, "ic-pendientes")) === String(novP.pendientes), [await kpi(page, "ic-presentadas"), novP.presentadas]);
  await page.selectOption('[data-filtro="tipo"]', "anio"); await espera(page, 800);

  // Detalle: búsqueda, orden y paginación, «Información no disponible»
  await page.click('[data-desplegable="ic-detalle"] > button'); await page.waitForSelector("[data-fila-ic]", { timeout: 8000 }); await espera(page, 600);
  ok(`${V}_D01_detalle_primera_pagina`, (await page.$$("[data-fila-ic]")).length === 15 && /Página 1 de 2/.test(await page.textContent("[data-paginacion]")));
  await page.click('[data-pagina="siguiente"]'); await espera(page, 800);
  const todas = filtrarOportunidades(OPS, periodoDe({ tipo: "anio", anio: 2026 }));
  ok(`${V}_D02_paginacion`, (await page.$$("[data-fila-ic]")).length === todas.length - 15);
  await page.fill("[data-buscar]", "comercial sur"); await espera(page, 900);
  ok(`${V}_D03_busqueda`, (await page.$$("[data-fila-ic]")).length === 3 && /Página 1 de 1/.test(await page.textContent("[data-paginacion]")));
  await page.fill("[data-buscar]", "1001-8-COT26"); await espera(page, 900);
  ok(`${V}_D04_resultado_pendiente_de_verificar`, /Resultado pendiente de verificar/.test(await page.textContent('[data-fila-ic="1001-8-COT26"]')));
  await page.fill("[data-buscar]", "1001-9-COT26"); await espera(page, 900);
  ok(`${V}_D05_enlace_mercado_publico`, (await page.getAttribute('[data-fila-ic="1001-9-COT26"] [data-enlace-mp]', "href")) === "https://buscador.mercadopublico.cl/ficha?code=1001-9-COT26");
  await page.fill("[data-buscar]", ""); await espera(page, 700);
  const esperado = ordenarPaginar(todas, { orden: "diferencia", desc: true, porPagina: 15 }).filas.map((o) => o.clave);
  if (vista.movil) await page.selectOption("[data-orden]", "diferencia:d"); else { await page.click('[data-columna="diferencia"]'); }
  await espera(page, 900);
  ok(`${V}_D06_ordenamiento`, (await page.$$eval("[data-fila-ic]", (xs) => xs.map((x) => x.getAttribute("data-fila-ic")))).join() === esperado.join());
  ok(`${V}_D07_no_comparable_explicado`, /Base tributaria distinta/.test(await page.textContent("[data-tabla-detalle]")));

  // Exportación (CSV y Excel) con el período
  const [dc] = await Promise.all([page.waitForEvent("download"), page.click('[data-exportar="csv"]')]);
  const csv = readFileSync(await dc.path(), "utf8");
  ok(`${V}_T16_csv`, dc.suggestedFilename() === "inteligencia-comercial_2026-01-01_2026-12-31.csv" && csv.includes("Período desde;2026-01-01") && csv.includes("1001-2-COT26") && new RegExp(`Última sincronización con ChileCompra;${est.ultimaSinc.slice(0, 10)}`).test(csv) && /Generado;20/.test(csv)
    && csv.includes("Criterio de fecha;Fecha de presentación") && csv.includes("Fecha de adjudicación (ChileCompra)"));
  const [dx] = await Promise.all([page.waitForEvent("download"), page.click('[data-exportar="xlsx"]')]);
  const wb = XLSX.read(readFileSync(await dx.path()));
  const det = XLSX.utils.sheet_to_json(wb.Sheets.Oportunidades);
  ok(`${V}_T16_excel`, wb.SheetNames.join() === "Resumen,Por mes,Oportunidades,Empresas adjudicadas" && det.length === todas.length && XLSX.utils.sheet_to_json(wb.Sheets["Empresas adjudicadas"]).length === 2);

  // Sincronización manual: varias rondas, avance real y recálculo; mensajes diferenciados (D)
  const cola = (e, sc = 0, pv = 0) => ({ total: 16, sin_consultar: sc, por_verificar: pv, en_proceso: 2, finales: 10, con_error: 0, elegibles_ahora: e, proximo_reintento: null });
  est.respSinc.push({ status: 200, json: { ok: true, procesados: 40, actualizados: 3, errores: 1, hay_mas: true, conteo: { ganada: 2, perdida: 30, pendiente: 7, sin_respuesta: 1 }, ganadas_nuevas: ["1001-10-COT26", "1001-1-COT26"], cola: cola(5, 5), ritmo_ms: 1200 } },
    { status: 200, json: { ok: true, procesados: 5, actualizados: 1, errores: 0, hay_mas: false, conteo: { perdida: 4, por_verificar: 1 }, ganadas_nuevas: [], cola: cola(0, 0, 1), ritmo_ms: 1200 } });
  const nrs = est.rpc.length; await page.click("[data-sincronizar]"); await page.waitForSelector('[data-aviso-linea="ic-sinc"]', { timeout: 8000 }); await espera(page, 900);
  const msj = await page.textContent('[data-aviso-linea="ic-sinc"]');
  ok(`${V}_S01_sincroniza_en_rondas`, est.sinc.length === 2 && est.sinc[0].origen === "manual" && est.sinc[1].ritmo_ms === 1200 && /Sincronización completa: 45 revisadas · 2 ganadas · 34 perdidas · 7 en proceso · 1 por verificar \(ganador aún no confirmado\) · 1 sin respuesta/.test(msj), msj);
  ok(`${V}_S01_ganadas_confirmadas_y_lo_que_queda`, /1001-10-COT26, 1001-1-COT26/.test(msj) && /1 oportunidad queda por verificar/.test(msj) && !/límite de ChileCompra/.test(msj), msj);
  const estadoTxt = await page.textContent("[data-estado-sinc]");
  ok(`${V}_S02_recalcula_despues`, est.rpc.slice(nrs).some(esResumen) && hoyDMA().some((d) => estadoTxt.includes(d)) && /recién/.test(estadoTxt), estadoTxt);
  // Pausa pedida por ChileCompra: se informa con cuenta regresiva y CONTINÚA sola (sin detenerse)
  est.respSinc.push({ status: 200, json: { ok: true, procesados: 2, actualizados: 0, errores: 0, hay_mas: true, pausa_ms: 2500, respuestas_429: 4, limite_alcanzado: true, conteo: { perdida: 2 }, cola: cola(30, 28) } },
    { status: 200, json: { ok: true, procesados: 30, actualizados: 2, errores: 0, hay_mas: false, conteo: { perdida: 28, ganada: 2 }, ganadas_nuevas: ["1001-2-COT26", "1001-7-COT26"], cola: cola(0) } });
  await page.click("[data-sincronizar]"); await page.waitForSelector('[data-aviso-linea="ic-sinc-avance"]', { timeout: 5000 }); await espera(page, 700);
  const enPausa = await page.textContent('[data-aviso-linea="ic-sinc-avance"]');
  ok(`${V}_S03_pausa_informada_con_avance`, /ChileCompra pidió bajar la velocidad: se reanuda en \d s/.test(enPausa) && /2 revisadas/.test(enPausa) && /quedan 30 por consultar ahora \(28 nunca consultadas\)/.test(enPausa) && !!(await page.$("[data-cancelar-sinc]")), enPausa);
  await page.waitForSelector('[data-aviso-linea="ic-sinc"]', { timeout: 10000 }); await espera(page, 500);
  ok(`${V}_S03_continua_sola_y_completa`, est.sinc.length === 4 && /Sincronización completa: 32 revisadas · 2 ganadas · 30 perdidas/.test(await page.textContent('[data-aviso-linea="ic-sinc"]')) && !(await page.$('[data-aviso-linea="ic-sinc-avance"]')), await page.textContent('[data-aviso-linea="ic-sinc"]'));
  // Cancelar durante una pausa: se detiene, informa lo que queda y permite reanudar
  est.respSinc.push({ status: 200, json: { ok: true, procesados: 3, actualizados: 0, errores: 0, hay_mas: true, pausa_ms: 30_000, conteo: { pendiente: 3 }, cola: cola(300, 290) } });
  await page.click("[data-sincronizar]"); await page.waitForSelector("[data-cancelar-sinc]", { timeout: 5000 }); await espera(page, 600);
  await page.click("[data-cancelar-sinc]"); await page.waitForSelector('[data-aviso-linea="ic-sinc"]', { timeout: 5000 }); await espera(page, 400);
  const canc = await page.textContent('[data-aviso-linea="ic-sinc"]');
  ok(`${V}_S06_cancelar_y_reanudar`, est.sinc.length === 5 && /Sincronización cancelada: 3 revisadas/.test(canc) && /Quedan 300 por consultar/.test(canc) && /reanudar/.test(canc) && !(await page.$("[data-cancelar-sinc]")) && !(await page.$("[data-sincronizar][disabled]")), canc);
  est.respSinc.push({ status: 502, json: { ok: false, codigo: "TICKET_INVALIDO", error: "ChileCompra rechazó el ticket configurado (HTTP 401/403). No se modificó ningún resultado." } });
  await page.click("[data-sincronizar]"); await page.waitForSelector('[data-aviso-linea="ic-sinc"]', { timeout: 5000 }); await espera(page, 1000);
  ok(`${V}_S04_error_api_informado_panel_sigue`, /rechazó el ticket/.test(await page.textContent('[data-aviso-linea="ic-sinc"]')) && !!(await page.$('[data-indicador="ic-presentadas"]')) && !!(await page.$('[data-indicador="banco"]')));
  // T19: ninguna escritura de datos (ni financiera ni de otro tipo) desde el navegador por este módulo
  const nuevas = base.escr.slice(escrAntes).filter((w) => !["mp_uso_diario", "mp_cache_avisos"].includes(w.tabla));
  ok(`${V}_T19_sin_escrituras_desde_el_navegador`, nuevas.length === 0, nuevas.map((w) => w.metodo + " " + w.tabla));
  // T15/T14: sin desbordes horizontales
  ok(`${V}_T14_T15_sin_desborde_horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]));
  await page.screenshot({ path: `/tmp/ic-${V}.png`, fullPage: true });
  ok(`${V}_E01_sin_errores_de_pagina`, errs.length === 0, errs);
  await ctx.close();

  // ── Usuario sin permiso de administrador: lee, no sincroniza ──
  {
    const b2 = crearBase(datos()); const e2 = nuevoEstado({ ultimaSinc: null });
    const { page: p2, ctx: c2 } = await abrir(browser, b2, { url: URL_APP, usuario: "u2", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
    await rutasIC(p2, e2); await abrirIC(p2); await espera(p2, 800);
    ok(`${V}_T12_usuario_sin_boton_de_sincronizar`, !(await p2.$("[data-sincronizar]")) && /administrador/.test(await p2.textContent("[data-inteligencia]")));
    ok(`${V}_T12_usuario_sin_sincronizacion_automatica`, e2.sinc.length === 0);
    ok(`${V}_T12_usuario_lee_indicadores`, (await kpi(p2, "ic-presentadas")) === String(anio.presentadas));
    await c2.close();
  }
  // ── Administrador con la última sincronización antigua: sincronización automática en segundo plano (una vez) ──
  {
    const b3 = crearBase(datos()); const e3 = nuevoEstado({ ultimaSinc: "2026-10-01T00:00:00Z" }); e3.respSinc.push({ status: 200, json: { ok: true, procesados: 1, actualizados: 0, errores: 0, hay_mas: false } });
    const { page: p3, ctx: c3 } = await abrir(browser, b3, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
    await rutasIC(p3, e3); await abrirIC(p3); await espera(p3, 1500);
    ok(`${V}_S05_automatica_si_mas_de_12_h`, e3.sinc.length === 1 && e3.sinc[0].origen === "automatica");
    await c3.close();
  }
  // ── Base con el módulo del 04/11 pero SIN la corrección del 05/11: funciona con ic_resumen/ic_detalle (presentación) ──
  {
    const b6 = crearBase(datos()); const e6 = nuevoEstado({ modo: "base_v1" });
    const { page: p6, ctx: c6, errs: er6 } = await abrir(browser, b6, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
    await rutasIC(p6, e6); await abrirIC(p6); await espera(p6, 800);
    ok(`${V}_V1_compatible_con_la_base_del_04_11`, e6.rpc.some((r) => r.fn === "ic_resumen") && (await kpi(p6, "ic-presentadas")) === String(anio.presentadas) && (await p6.$eval('[data-filtro="criterio"]', (x) => x.disabled)) && er6.length === 0, e6.rpc.map((r) => r.fn));
    await c6.close();
  }
  // ── T20: migración NO instalada → cálculo local con los estados de las cotizaciones, sin errores ──
  {
    const b4 = crearBase(datos()); const e4 = nuevoEstado({ modo: "sin_migracion" });
    const { page: p4, ctx: c4, errs: er4 } = await abrir(browser, b4, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
    await rutasIC(p4, e4); await abrirIC(p4); await espera(p4, 800);
    const loc = resumirOportunidades(filtrarOportunidades(OPS_LOCAL, periodoDe({ tipo: "anio", anio: 2026 }))).indicadores;
    ok(`${V}_T20_aviso_modo_local`, !!(await p4.$('[data-aviso-linea="ic-local"]')) && !(await p4.$("[data-sincronizar]")));
    ok(`${V}_T20_indicadores_locales`, (await kpi(p4, "ic-presentadas")) === String(loc.presentadas) && (await kpi(p4, "ic-ganadas")) === String(loc.ganadas) && (await kpi(p4, "ic-perdidas")) === String(loc.perdidas), [await kpi(p4, "ic-ganadas"), loc.ganadas]);
    ok(`${V}_T20_sin_sincronizacion_ni_errores`, e4.sinc.length === 0 && er4.length === 0 && e4.lecturas.includes("versiones"), er4);
    await p4.click('[data-desplegable="ic-detalle"] > button'); await p4.waitForSelector("[data-fila-ic]", { timeout: 8000 });
    ok(`${V}_T20_detalle_local`, (await p4.$$("[data-fila-ic]")).length === 15);
    await c4.close();
  }
  // ── Base caída: el Panel sigue funcionando y el error queda dentro del módulo ──
  {
    const b5 = crearBase(datos()); const e5 = nuevoEstado({ modo: "caida" });
    const { page: p5, ctx: c5 } = await abrir(browser, b5, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil });
    await rutasIC(p5, e5); await p5.click('[data-desplegable="inteligencia"] > button'); await p5.waitForSelector('[data-aviso-linea="ic-error"]', { timeout: 10000 });
    ok(`${V}_T09_base_caida_error_contenido`, /no disponible/i.test(await p5.textContent('[data-aviso-linea="ic-error"]')) && !!(await p5.$('[data-indicador="banco"]')) && !!(await p5.$('[data-prioridad], [data-desplegable="caja"]')));
    await c5.close();
  }
}
await browser.close();
console.log(`e2e_inteligencia: ${nOk}/${nOk + F.length} correctas`);
process.exit(F.length ? 1 : 0);
