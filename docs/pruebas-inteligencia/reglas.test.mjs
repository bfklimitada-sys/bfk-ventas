// Inteligencia Comercial (04/11/2026): reglas puras y sincronización con ChileCompra SIMULADA (nada sale a la red).
// Uso: node docs/pruebas-inteligencia/reglas.test.mjs
import { normalizarResultadoMP, construirOportunidades, filtrarOportunidades, resumirOportunidades, periodoDe, ordenarPaginar, csvInforme, hojasInforme,
  estadoProcesoDe, rutNorm, esCodigoCompraAgil, enlaceMP, mediana, r1, NO_DISPONIBLE, CANCELADA_ID } from "../../src/lib/inteligenciaComercial.js";
import { sincronizar, LIMITES, crearManejador } from "../../api/inteligencia.mjs";
import { COTIZACIONES, filaCotizacion, versionesDe, respuestasMP } from "./fixture.mjs";

let F = 0, N = 0;
const ok = (k, c, d) => { N++; if (c) console.log("OK    " + k); else { F++; console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── Datos base: oportunidades desde el fixture con los resultados que armaría el servidor ──
const mp = respuestasMP();
const resultados = Object.entries(mp).map(([c, r]) => ({ ...normalizarResultadoMP(c, r.listado, r.detalle, { detalleError: r.detalleFalla ? "HTTP 504" : "" }), consultado_en: "2026-11-04T03:00:00Z" }));
const cot = COTIZACIONES.map(filaCotizacion); const ver = COTIZACIONES.flatMap(versionesDe);
const ops = construirOportunidades(cot, ver, resultados);
const por = (c) => ops.find((o) => o.codigo === c);
const FINALES_OK = ["ganada", "perdida", "desierta", "cancelada", "sin_oferta_bfk"];

// 1. Filtros por mes, año y rango
ok("T01_periodo_mes", eq(periodoDe({ tipo: "mes", anio: 2026, mes: 2 }), { desde: "2026-02-01", hasta: "2026-02-28" }));
ok("T01_periodo_mes_bisiesto", eq(periodoDe({ tipo: "mes", anio: 2028, mes: 2 }), { desde: "2028-02-01", hasta: "2028-02-29" }));
ok("T01_periodo_anio", eq(periodoDe({ tipo: "anio", anio: 2026 }), { desde: "2026-01-01", hasta: "2026-12-31" }));
ok("T01_periodo_rango_invertido", eq(periodoDe({ tipo: "rango", desde: "2026-10-25", hasta: "2026-10-10" }), { desde: "2026-10-10", hasta: "2026-10-25" }));
ok("T01_periodo_rango_abierto", eq(periodoDe({ tipo: "rango", desde: "2026-10-25", hasta: "" }), { desde: "2026-10-25", hasta: null }));
ok("T01_filtro_octubre", filtrarOportunidades(ops, periodoDe({ tipo: "mes", anio: 2026, mes: 10 })).every((o) => o.fecha_presentacion.startsWith("2026-10")));
ok("T01_filtro_noviembre_cuenta", filtrarOportunidades(ops, periodoDe({ tipo: "mes", anio: 2026, mes: 11 })).length === 2);
ok("T01_filtro_rango_inclusivo", filtrarOportunidades(ops, { desde: "2026-10-05", hasta: "2026-10-05" }).map((o) => o.codigo).join() === "1001-2-COT26");
ok("T01_filtro_institucion_sin_tilde", filtrarOportunidades(ops, { institucion: "LOS ANGELES" }).every((o) => o.institucion === "Hospital de Los Ángeles"));
ok("T01_filtro_vendedor_y_sin_vendedor", filtrarOportunidades(ops, { vendedor: "Vendedora Dos" }).every((o) => o.vendedor_nombre === "Vendedora Dos") && filtrarOportunidades(ops, { vendedor: "__sin__" }).length === 0);

// 2. Ganadas, perdidas y pendientes
ok("T02_ganada_por_cotizacion_adjudicada", por("1001-1-COT26").resultado === "ganada" && por("1001-1-COT26").fuente_resultado === "Cotización BFK (adjudicada)");
ok("T02_perdida_verificada_en_chilecompra", por("1001-2-COT26").resultado === "perdida" && /ChileCompra/.test(por("1001-2-COT26").fuente_resultado));
ok("T02_perdida_por_registro_bfk", por("1001-9-COT26").resultado === "perdida" && por("1001-9-COT26").fuente_resultado === "Cotización BFK (no adjudicada)");
ok("T02_pendiente_publicada_y_cerrada", por("1001-3-COT26").resultado === "pendiente" && por("1001-4-COT26").resultado === "pendiente" && por("1001-3-COT26").verificacion === "en_proceso");
ok("T02_ganada_externa_con_cotizacion_presentada", por("1001-10-COT26").resultado === "ganada" && /regularizar/.test(por("1001-10-COT26").aviso) && por("1001-10-COT26").estado_cotizacion === "presentada");

// 3. Tasa de éxito = G / (G + P) × 100 (pendientes, desiertas y canceladas no cuentan)
const R = resumirOportunidades(ops);
const G = ops.filter((o) => o.resultado === "ganada").length, P = ops.filter((o) => o.resultado === "perdida").length;
ok("T03_tasa_exito", R.indicadores.tasa_exito === r1((G / (G + P)) * 100), { tasa: R.indicadores.tasa_exito, G, P });
ok("T03_pendientes_no_son_perdidas", R.indicadores.perdidas === P && R.indicadores.pendientes === ops.filter((o) => o.resultado === "pendiente").length);
ok("T03_sin_ganadas_ni_perdidas_tasa_nula", resumirOportunidades(ops.filter((o) => o.resultado === "pendiente")).indicadores.tasa_exito === null);
ok("T03_redondeo_como_postgresql", r1(42.85714) === 42.9 && r1(-2.25) === -2.3 && r1(2.25) === 2.3 && r1(12.35) === 12.4);

// 4. Ofertas con múltiples productos: una oportunidad
ok("T04_varios_productos_una_vez", ops.filter((o) => o.codigo === "1001-15-COT26").length === 1 && por("1001-15-COT26").oferta_neto === 300000);
// 8. Ausencia de duplicados (mismo código en dos cotizaciones)
ok("T08_un_codigo_una_oportunidad", new Set(ops.map((o) => o.clave)).size === ops.length);
ok("T08_duplicado_toma_la_mas_avanzada", por("1001-12-COT26").estado_cotizacion === "adjudicada" && por("1001-12-COT26").n_cotizaciones === 2);
ok("T08_borrador_lista_descartada_fuera", !ops.some((o) => ["1001-13-COT26", "1001-16-COT26", "1001-18-COT26"].includes(o.codigo)));

// 5. Procesos sin adjudicatario conocido
ok("T05_detalle_caido_por_verificar", por("1001-8-COT26").resultado === "pendiente" && por("1001-8-COT26").verificacion === "por_verificar" && por("1001-8-COT26").adjudicatario_nombre === null);
ok("T05_detalle_caido_guarda_motivo", /504/.test(resultados.find((r) => r.codigo === "1001-8-COT26").consulta_error || ""));
const exp = hojasInforme(R, ops).Oportunidades;
ok("T05_exporta_informacion_no_disponible", exp.find((f) => f["Código Compra Ágil"] === "1001-8-COT26")["Empresa adjudicada"] === NO_DISPONIBLE);
ok("T05_perdida_sin_adjudicatario_no_comparable", por("1001-9-COT26").comparable === true && construirOportunidades([filaCotizacion({ ...COTIZACIONES[8], codigo: "1001-90-COT26" })], [], []).every((o) => o.comparable === false && o.motivo_no_comparable === NO_DISPONIBLE));

// 6. Procesos cancelados o desiertos
ok("T06_desierta_y_cancelada", por("1001-5-COT26").resultado === "desierta" && por("1001-6-COT26").resultado === "cancelada" && R.indicadores.desiertas === 1 && R.indicadores.canceladas === 1);
ok("T06_cancelada_fecha_y_motivo", resultados.find((r) => r.codigo === "1001-6-COT26").fecha_resultado_fuente === "fecha_cancelacion" && /presupuesto/.test(resultados.find((r) => r.codigo === "1001-6-COT26").motivo));

// 7. Comparación neto/IVA/exento
ok("T07_misma_base_comparable", por("1001-2-COT26").comparable && por("1001-2-COT26").diferencia === 23800 && por("1001-2-COT26").diferencia_pct === 11.1);
ok("T07_exenta_vs_afecta_no_comparable", !por("1001-7-COT26").comparable && por("1001-7-COT26").motivo_no_comparable === "Base tributaria distinta (afecta/exenta)" && por("1001-7-COT26").oferta_base === "exenta");
ok("T07_despacho_incluido_en_total", por("1001-15-COT26").adjudicado_total === 300000 && por("1001-15-COT26").diferencia === 57000);
const usd = construirOportunidades([filaCotizacion({ ...COTIZACIONES[1], id: "x1" })], [], [{ ...resultados.find((r) => r.codigo === "1001-2-COT26"), moneda: "USD" }]);
ok("T07_moneda_distinta_no_comparable", usd[0].comparable === false && usd[0].motivo_no_comparable === "Moneda distinta");
ok("T07_no_usa_presupuesto_del_comprador", ops.every((o) => !Object.keys(o).some((k) => /presupuesto/.test(k)) && o.oferta_total !== 400000 && o.adjudicado_total !== 400000 && o.adjudicado_total !== 500000));
ok("T07_base_tributaria", normalizarResultadoMP("1001-7-COT26", mp["1001-7-COT26"].listado, mp["1001-7-COT26"].detalle).base_tributaria === "afecta");

// Normalización de la respuesta oficial
ok("N01_estados", [[2, "publicada"], [3, "cerrada"], [4, "proveedor_seleccionado"], [6, "desierta"], [CANCELADA_ID, "cancelada"]].every(([i, e]) => estadoProcesoDe({ id_estado: i }) === e) && estadoProcesoDe({ glosa: "OC Emitida" }) === "oc_emitida" && estadoProcesoDe({ codigo: "Proveedor Seleccionado" }) === "proveedor_seleccionado" && estadoProcesoDe(null) === "sin_informacion");
ok("N02_rut_bfk_formatos", rutNorm("77.322.317-3") === rutNorm("77322317-3") && rutNorm("77.888.999-k") === "77888999K");
ok("N03_ganada_si_bfk_seleccionada", normalizarResultadoMP("1001-10-COT26", mp["1001-10-COT26"].listado, mp["1001-10-COT26"].detalle).resultado === "ganada");
ok("N04_sin_oferta_bfk", normalizarResultadoMP("1001-11-COT26", mp["1001-11-COT26"].listado, mp["1001-11-COT26"].detalle).resultado === "sin_oferta_bfk");
const dos = { ...mp["1001-2-COT26"].detalle, proveedores_cotizando: mp["1001-2-COT26"].detalle.proveedores_cotizando.map((x) => ({ ...x, proveedor_seleccionado: 1 })) };
ok("N05_dos_seleccionadas_no_se_deduce", normalizarResultadoMP("1001-2-COT26", mp["1001-2-COT26"].listado, dos).resultado === "sin_informacion");
ok("N06_codigos", esCodigoCompraAgil(" 3390-246-cot26 ") && !esCodigoCompraAgil("1234-56-LE26") && enlaceMP("1001-2-COT26").startsWith("https://buscador.mercadopublico.cl/ficha?code=") && enlaceMP("1234-5-LE26") === "");
ok("N07_mediana", mediana([3, 1, 2]) === 2 && mediana([1, 2, 3, 4]) === 2.5 && mediana([]) === null);

// Detalle: búsqueda, orden y paginación
const pg = ordenarPaginar(ops, { orden: "oferta_total", desc: true, pagina: 0, porPagina: 5 });
ok("T_detalle_orden_y_pagina", pg.filas.length === 5 && pg.total === ops.length && pg.filas[0].oferta_total >= pg.filas[4].oferta_total);
ok("T_detalle_busqueda_competidor", ordenarPaginar(ops, { q: "comercial sur" }).filas.every((o) => o.adjudicatario_nombre === "Comercial Sur SpA") && ordenarPaginar(ops, { q: "comercial sur" }).total === 3);
ok("T_detalle_vacios_al_final", ordenarPaginar(ops, { orden: "diferencia", desc: true, porPagina: 99 }).filas.slice(-1)[0].diferencia === null);
ok("T_detalle_pagina_2", ordenarPaginar(ops, { pagina: 1, porPagina: 5 }).filas[0].clave === ordenarPaginar(ops, { porPagina: 6 }).filas[5].clave);
// Empate en cantidad (2 y 2): primero el de mayor monto adjudicado (Norte $359.500 > Sur $321.300). Solo cuenta PERDIDAS de BFK.
ok("T_competidores_frente_a_bfk", R.competidores.map((c) => `${c.nombre}:${c.n}:${c.monto_total}`).join() === "Distribuidora Norte Ltda:2:359500,Comercial Sur SpA:2:321300" && R.competidores.every((c) => c.rut !== "77.322.317-3"), R.competidores);

// 16. Exportación
const csv = csvInforme(resumirOportunidades(filtrarOportunidades(ops, periodoDe({ tipo: "mes", anio: 2026, mes: 10 })), periodoDe({ tipo: "mes", anio: 2026, mes: 10 })), filtrarOportunidades(ops, periodoDe({ tipo: "mes", anio: 2026, mes: 10 })), { generado: "2026-11-04T10:00:00Z", ultimaSincronizacion: "2026-11-04T03:00:00Z" });
ok("T16_csv_periodo_y_fechas", csv.startsWith("﻿") && csv.includes("Período desde;2026-10-01") && csv.includes("Período hasta;2026-10-31") && csv.includes("Generado;2026-11-04T10:00:00Z") && csv.includes("Última sincronización con ChileCompra;2026-11-04T03:00:00Z"));
ok("T16_csv_detalle_sin_noviembre", csv.includes("1001-2-COT26") && !csv.includes("1001-10-COT26") && csv.split("\r\n").length > 10);
const hojas = hojasInforme(R, ops, { ultimaSincronizacion: null });
ok("T16_hojas", eq(Object.keys(hojas), ["Resumen", "Por mes", "Oportunidades", "Empresas adjudicadas"]) && hojas["Empresas adjudicadas"].length === R.competidores.length);
ok("T16_desglose_neto_iva_total", ["Ofertado BFK neto", "Ofertado BFK IVA", "Ofertado BFK total", "Adjudicado neto", "Adjudicado impuesto", "Adjudicado despacho", "Adjudicado total"].every((k) => k in hojas.Oportunidades[0]));
ok("T16_sin_sincronizacion_no_disponible", hojas.Resumen.find((r) => r[0] === "Última sincronización con ChileCompra")[1] === NO_DISPONIBLE);
ok("T16_csv_escapa_punto_y_coma", csvInforme(R, [{ ...ops[0], institucion: 'Muni; "Laja"' }]).includes('"Muni; ""Laja"""'));

// E1 (05/11/2026): criterio de fecha de adjudicación, cobertura y avisos separados (D)
{
  const { fechaInformada, resumenConCriterio, filtrarOportunidades: filtrar, nombreArchivo } = await import("../../src/lib/inteligenciaComercial.js");
  ok("E1_fecha_informada", fechaInformada("2026-10-14 16:00:00") === "2026-10-14" && fechaInformada("2026-11-01T02:00:00Z") === "2026-11-01" && fechaInformada("2026-10-31T23:30:00-03:00") === "2026-11-01"
    && fechaInformada("2026-11-01T02:00:00+00:00") === "2026-11-01" && fechaInformada(null) === null && fechaInformada("sin fecha") === null);
  const o2 = por("1001-2-COT26"), o3 = por("1001-3-COT26"), o12 = por("1001-12-COT26");
  ok("E1_fecha_adjudicacion_solo_con_resultado", o2.fecha_presentacion === "2026-10-05" && o2.fecha_adjudicacion === "2026-11-02" && o3.fecha_adjudicacion === null && o12.resultado === "ganada" && o12.fecha_adjudicacion === "2026-10-12", [o2.fecha_adjudicacion, o3.fecha_adjudicacion, o12.fecha_adjudicacion]);
  const novAdj = filtrar(ops, { criterio: "adjudicacion", desde: "2026-11-01", hasta: "2026-11-30" }).map((o) => o.codigo).sort();
  ok("E1_noviembre_por_adjudicacion", novAdj.includes("1001-2-COT26") && novAdj.includes("1001-9-COT26") && !novAdj.includes("1001-3-COT26") && novAdj.every((c) => FINALES_OK.includes(por(c).resultado)), novAdj);
  ok("E1_octubre_por_presentacion_incluye_la_adjudicada_en_noviembre", filtrar(ops, { desde: "2026-10-01", hasta: "2026-10-31" }).some((o) => o.codigo === "1001-2-COT26"));
  const rA = resumenConCriterio(ops, { criterio: "adjudicacion" }), rP = resumenConCriterio(ops, {});
  ok("E1_adjudicacion_sin_pendientes_y_criterio_informado", rA.indicadores.pendientes === 0 && rA.criterio === "adjudicacion" && rP.criterio === "presentacion" && rA.indicadores.presentadas < rP.indicadores.presentadas);
  ok("E1_los_criterios_no_se_mezclan", rA.indicadores.ganadas + rA.indicadores.perdidas + rA.indicadores.desiertas + rA.indicadores.canceladas + rA.indicadores.sin_oferta_bfk === filtrar(ops, { criterio: "adjudicacion" }).length);
  ok("E1_sin_fecha_adjudicacion_informado", rA.indicadores.sin_fecha_adjudicacion === ops.filter((o) => FINALES_OK.includes(o.resultado) && !o.fecha_adjudicacion).length && rP.indicadores.sin_fecha_adjudicacion === 0, rA.indicadores.sin_fecha_adjudicacion);
  ok("D1_cobertura_y_avisos_separados", rP.indicadores.ganadas_sin_regularizar === 1 && rP.indicadores.otros_avisos === 1 && rP.indicadores.avisos === 2 && rP.indicadores.sin_consultar === 1 && rP.indicadores.en_proceso === 2,
    { g: rP.indicadores.ganadas_sin_regularizar, o: rP.indicadores.otros_avisos, sc: rP.indicadores.sin_consultar, ep: rP.indicadores.en_proceso });
  ok("D1_perdida_solo_con_evidencia", ops.filter((o) => o.resultado === "perdida").every((o) => o.estado_cotizacion === "no_adjudicada" || o.resultado_externo === "perdida")
    && ops.filter((o) => ["sin_consultar", "en_proceso", "por_verificar"].includes(o.verificacion) && o.estado_cotizacion === "presentada").every((o) => o.resultado === "pendiente"));
  const hA = hojasInforme(rA, filtrar(ops, { criterio: "adjudicacion" }));
  ok("E1_exportacion_con_criterio_y_fecha_de_adjudicacion", hA.Resumen.some((r) => r[0] === "Criterio de fecha" && r[1] === "Fecha de adjudicación") && "Fecha de adjudicación (ChileCompra)" in hA.Oportunidades[0]
    && nombreArchivo({ desde: "2026-11-01", hasta: "2026-11-30" }, "csv", "adjudicacion") === "inteligencia-comercial_adjudicacion_2026-11-01_2026-11-30.csv");
  const { textoConteo, mensajeFinal } = await import("../../src/lib/inteligenciaMensajes.js");
  const t = textoConteo({ procesados: 10, conteo: { ganada: 2, perdida: 3, pendiente: 4, por_verificar: 1 } });
  ok("D2_mensaje_diferencia_resultados", /10 revisadas · 2 ganadas · 3 perdidas · 4 en proceso · 1 por verificar/.test(t), t);
  const m1 = mensajeFinal({ motivo_fin: "completo", procesados: 35, conteo: { ganada: 2, perdida: 20, pendiente: 13 }, ganadas_nuevas: ["1063796-37-COT26", "2042-356-COT26"], cola: { elegibles_ahora: 0, sin_consultar: 0, por_verificar: 0 } });
  ok("D2_mensaje_completo_con_ganadas", m1.tono === "ok" && /Sincronización completa: 35 revisadas · 2 ganadas · 20 perdidas · 13 en proceso\./.test(m1.texto) && /1063796-37-COT26, 2042-356-COT26/.test(m1.texto) && !/límite/.test(m1.texto), m1);
  const m2 = mensajeFinal({ motivo_fin: "cancelado", procesados: 5, conteo: { perdida: 5 }, ganadas_nuevas: [], cola: { elegibles_ahora: 300, sin_consultar: 290, por_verificar: 2 } });
  ok("D2_mensaje_cancelado_informa_lo_que_queda", m2.tono === "warn" && /cancelada/.test(m2.texto) && /Quedan 300 por consultar/.test(m2.texto) && /reanudar/.test(m2.texto), m2);
  const m3 = mensajeFinal({ motivo_fin: "error", error: "ChileCompra rechazó el ticket configurado (HTTP 401/403).", codigo: "TICKET_INVALIDO", procesados: 40, conteo: { perdida: 40 }, ganadas_nuevas: [] });
  ok("D2_mensaje_error_conserva_el_avance", m3.tono === "danger" && /rechazó el ticket/.test(m3.texto) && /antes del error: 40 revisadas/.test(m3.texto), m3);
  ok("D2_todo_al_dia", mensajeFinal({ motivo_fin: "completo", procesados: 0, conteo: {}, ganadas_nuevas: [] }).texto === "Todo al día: no había resultados por consultar.");
}

// 9 y 10. Errores, límites de API y reintentos (ChileCompra y la base SIMULADAS)
// seq: respuestas en secuencia por URL (p. ej. [429, 429, 200]); el 200 usa el registro normal. retryAfter: segundos.
function simulado({ listado = {}, detalle = {}, fallasListado = {}, seq = {}, retryAfter = null, reloj } = {}) {
  const llamadas = []; const rpcs = [];
  const f = async (url) => {
    const t = reloj.t; llamadas.push({ url, t });
    const det = !url.includes("?id="); const cod = decodeURIComponent(det ? url.split("/").pop() : url.split("?id=")[1]);
    const reg = det ? detalle[cod] : listado[cod];
    const k = (det ? "D:" : "L:") + cod;
    if (seq[k]?.length) { const st = seq[k].shift(); if (st !== 200) return { status: st, headers: { get: (h) => (h === "retry-after" && retryAfter ? String(retryAfter) : null) }, json: async () => ({ errors: [{ codigo: String(st), mensaje: "Se ha superado el límite de tasa de solicitudes." }] }) }; }
    if (!det && fallasListado[cod] > 0) { fallasListado[cod]--; return { status: 504, json: async () => ({}) }; }
    if (reg === "lento") { reloj.t += 30_000; throw Object.assign(new Error("t"), { name: "TimeoutError" }); }
    if (typeof reg === "number") return { status: reg, json: async () => ({ errors: [{ codigo: reg }] }) };
    if (reg === "red") throw Object.assign(new Error("x"), { name: "TypeError" });
    if (!reg) return { status: 200, json: async () => ({ payload: { items: [] } }) };
    return { status: 200, json: async () => ({ payload: det ? reg : { items: [reg] } }) };
  };
  const rpc = async (fn, body) => { rpcs.push({ fn, body }); return { resultado: body.p?.resultado || "sin_informacion", cambio: true }; };
  return { f, rpc, llamadas, rpcs };
}
const reloj = { t: 0 }; const ahora = () => reloj.t;
const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms) => { reloj.t += ms; return realSetTimeout(fn, 0); };   // la espera avanza el reloj simulado
const L = (c) => mp[c].listado, Dd = (c) => mp[c].detalle;
{
  const s = simulado({ listado: { "1001-2-COT26": L("1001-2-COT26"), "1001-3-COT26": L("1001-3-COT26") }, detalle: { "1001-2-COT26": Dd("1001-2-COT26") }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-2-COT26" }, { codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_flujo_normal", r.procesados === 2 && r.errores === 0 && s.rpcs.length === 2 && s.rpcs.find((x) => x.body.p.codigo === "1001-2-COT26").body.p.resultado === "perdida" && s.rpcs.find((x) => x.body.p.codigo === "1001-2-COT26").body.p.adjudicatario_nombre === "Comercial Sur SpA", r);
  ok("T09_detalle_solo_si_hay_seleccion", s.llamadas.filter((x) => !x.url.includes("?id=")).length === 1);
  ok("T09_pausa_entre_consultas", s.llamadas.every((x, i) => i === 0 || x.t - s.llamadas[i - 1].t >= LIMITES.pausaMs), s.llamadas);
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, fallasListado: { "1001-3-COT26": 1 }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T10_reintento_tras_504", s.llamadas.length === 2 && r.errores === 0 && s.rpcs[0].body.p.consulta_estado === "ok", r);
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, fallasListado: { "1001-3-COT26": 5 }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T10_un_solo_reintento_luego_error", s.llamadas.length === 2 && r.errores === 1 && s.rpcs[0].body.p.consulta_estado === "error" && /504/.test(s.rpcs[0].body.p.consulta_error), r);
}
{
  const s = simulado({ listado: { "1001-3-COT26": "red" }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T10_sin_conexion_registrado", r.errores === 1 && /Sin respuesta/.test(s.rpcs[0].body.p.consulta_error));
}
// ── 429 (corrección 05/11/2026): restricción temporal → esperar, bajar el ritmo y reintentar; nunca detener todo ──
{
  const s = simulado({ listado: { "1001-2-COT26": L("1001-2-COT26") }, detalle: { "1001-2-COT26": Dd("1001-2-COT26") }, seq: { "D:1001-2-COT26": [429] }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-2-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  const det = s.llamadas.filter((x) => !x.url.includes("?id="));
  ok("T21_429_en_detalle_espera_y_reintenta_la_misma", det.length === 2 && det[1].t - det[0].t >= LIMITES.esperas429[0] && r.respuestas_429 === 1 && r.reintentos_429 === 1, { det, r: { ...r, resultados: 0 } });
  ok("T21_429_en_detalle_resultado_verificado_igual", s.rpcs.length === 1 && s.rpcs[0].body.p.resultado === "perdida" && s.rpcs[0].body.p.adjudicatario_nombre === "Comercial Sur SpA" && !r.pausa_ms);
  ok("T21_429_baja_el_ritmo", r.ritmo_ms === Math.min(LIMITES.pausaMaxMs, LIMITES.pausaMs * 2), r.ritmo_ms);
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26"), "1001-4-COT26": L("1001-4-COT26") }, seq: { "L:1001-3-COT26": [429, 429] }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }, { codigo: "1001-4-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T22_429_en_listado_dos_veces_luego_bien", r.procesados === 2 && r.restantes === 0 && !r.pausa_ms && r.respuestas_429 === 2 && s.rpcs.every((x) => x.body.p.consulta_estado === "ok"), { ...r, resultados: 0 });
  ok("T22_no_se_detiene_ni_marca_limite_en_la_base", !s.rpcs.some((x) => x.body.p.consulta_estado === "limite") && !r.ticket_rechazado);
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26"), "1001-4-COT26": L("1001-4-COT26"), "1001-5-COT26": L("1001-5-COT26") }, seq: { "L:1001-3-COT26": [429, 429, 429, 429, 429] }, reloj });
  const r = await sincronizar({ pendientes: ["1001-3-COT26", "1001-4-COT26", "1001-5-COT26"].map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: s.f, ahora, lim: { ...LIMITES, concurrencia: 1 } });
  ok("T23_429_insistente_pausa_sugerida_sin_registrar_el_codigo", r.pausa_ms === LIMITES.pausaSugeridaMs && !s.rpcs.some((x) => x.body.p.codigo === "1001-3-COT26") && r.aplazados === 1, { ...r, resultados: 0 });
  ok("T23_429_insistente_deja_restantes_para_reanudar", r.restantes === 3 && r.procesados === 0 && s.llamadas.length === 1 + LIMITES.esperas429.length, { restantes: r.restantes, llamadas: s.llamadas.length });
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, seq: { "L:1001-3-COT26": [429] }, retryAfter: 7, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T24_respeta_retry_after", s.llamadas.length === 2 && s.llamadas[1].t - s.llamadas[0].t >= 7000 && r.procesados === 1, s.llamadas);
}
{
  const s = simulado({ listado: { "1001-2-COT26": L("1001-2-COT26") }, detalle: { "1001-2-COT26": Dd("1001-2-COT26") }, seq: { "D:1001-2-COT26": [429, 429, 429, 429] }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-2-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T25_detalle_429_insistente_guarda_listado_y_reintento_limite", s.rpcs[0].body.p.resultado === "sin_informacion" && s.rpcs[0].body.p.reintento_detalle === "limite" && r.pausa_ms > 0 && r.conteo.por_verificar === 1, s.rpcs[0].body.p);
}
{
  const s = simulado({ listado: { "1001-8-COT26": L("1001-8-COT26") }, detalle: { "1001-8-COT26": "lento" }, reloj });
  await sincronizar({ pendientes: [{ codigo: "1001-8-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T25_detalle_lento_reintento_demora", s.rpcs[0].body.p.reintento_detalle === "demora" && /demora/.test(s.rpcs[0].body.p.consulta_error), s.rpcs[0].body.p);
}
{
  const s = simulado({ listado: { "1001-8-COT26": L("1001-8-COT26") }, detalle: { "1001-8-COT26": 504 }, reloj });
  await sincronizar({ pendientes: [{ codigo: "1001-8-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T25_detalle_504_reintento_error", s.rpcs[0].body.p.reintento_detalle === "error");
}
{
  const cods = ["1001-2-COT26", "1001-7-COT26", "1001-1-COT26", "1001-3-COT26"];
  const s = simulado({ listado: Object.fromEntries(cods.map((c) => [c, L(c)])), detalle: Object.fromEntries(cods.filter((c) => Dd(c)).map((c) => [c, Dd(c)])), reloj });
  const lento = { ...LIMITES, presupuestoMs: 20_000, minDetalleMs: 14_000 };
  const f2 = async (u, o) => { if (u.includes("?id=")) reloj.t += 6_000; return s.f(u, o); };   // cada listado tarda 6 s
  const r = await sincronizar({ pendientes: cods.map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: f2, ahora, lim: lento });
  const sinTiempo = s.rpcs.filter((x) => x.body.p.reintento_detalle === "sin_tiempo");
  ok("T26_sin_tiempo_marcado_para_reintento_inmediato", sinTiempo.length >= 1 && sinTiempo.every((x) => x.body.p.resultado === "sin_informacion" && /sin tiempo/.test(x.body.p.consulta_error)), s.rpcs.map((x) => [x.body.p.codigo, x.body.p.reintento_detalle]));
  ok("T26_conteo_por_verificar", r.conteo.por_verificar === sinTiempo.length, r.conteo);
}
{
  const cods = Array.from({ length: 12 }, (_, i) => `7-${i}-COT26`);
  const s = simulado({ listado: Object.fromEntries(cods.map((c) => [c, { ...L("1001-3-COT26"), codigo: c }])), reloj });
  const r = await sincronizar({ pendientes: cods.map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: s.f, ahora, ritmoMs: 4_000 });
  ok("T27_ritmo_recibido_y_recuperacion_gradual", s.llamadas[1].t - s.llamadas[0].t >= 4_000 && r.ritmo_ms < 4_000 && r.ritmo_ms >= LIMITES.pausaMinMs, { ritmo: r.ritmo_ms, d: s.llamadas[1].t - s.llamadas[0].t });
  const r2 = await sincronizar({ pendientes: [{ codigo: cods[0] }], ticket: "t", rpc: s.rpc, f: s.f, ahora, ritmoMs: 99_999 });
  const r3 = await sincronizar({ pendientes: [{ codigo: cods[0] }], ticket: "t", rpc: s.rpc, f: s.f, ahora, ritmoMs: 1 });
  ok("T27_ritmo_acotado", r2.ritmo_ms === LIMITES.pausaMaxMs && r3.ritmo_ms === LIMITES.pausaMinMs, [r2.ritmo_ms, r3.ritmo_ms]);
}
{
  const s = simulado({ listado: { "1001-1-COT26": L("1001-1-COT26"), "1001-2-COT26": L("1001-2-COT26") }, detalle: { "1001-1-COT26": Dd("1001-1-COT26"), "1001-2-COT26": Dd("1001-2-COT26") }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-1-COT26" }, { codigo: "1001-2-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T28_conteo_y_ganadas_nuevas", r.conteo.ganada === 1 && r.conteo.perdida === 1 && r.ganadas_nuevas.join() === "1001-1-COT26", { conteo: r.conteo, g: r.ganadas_nuevas });
}
{
  const s = simulado({ listado: { "1001-2-COT26": 401 }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-2-COT26" }, { codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_ticket_rechazado_no_marca_el_rechazado", r.ticket_rechazado && !s.rpcs.some((x) => x.body.p.codigo === "1001-2-COT26"), r);
}
{
  const s = simulado({ listado: { "1001-8-COT26": L("1001-8-COT26") }, detalle: { "1001-8-COT26": 504 }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-8-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T10_detalle_caido_guarda_listado", r.errores === 0 && s.rpcs[0].body.p.resultado === "sin_informacion" && s.rpcs[0].body.p.estado_proceso === "proveedor_seleccionado" && /504/.test(s.rpcs[0].body.p.consulta_error));
}
{
  const s = simulado({ listado: { "1001-2-COT26": L("1001-2-COT26") }, detalle: { "1001-2-COT26": Dd("1001-2-COT26") }, reloj });
  await sincronizar({ pendientes: [{ codigo: "1001-2-COT26", detalle_consultado: true }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_no_repite_detalle_ya_verificado", s.llamadas.length === 1);
}
{
  const s = simulado({ listado: {}, reloj });
  await sincronizar({ pendientes: [{ codigo: "1001-99-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_codigo_no_encontrado", s.rpcs[0].body.p.consulta_estado === "no_encontrada");
}
{
  const lento = { ...LIMITES, presupuestoMs: 30_000, concurrencia: 1 };
  const s = simulado({ listado: Object.fromEntries(["1001-3-COT26", "1001-4-COT26", "1001-5-COT26", "1001-6-COT26"].map((c) => [c, L(c)])), reloj });
  const f2 = async (u, o) => { reloj.t += 9000; return s.f(u, o); };
  const r = await sincronizar({ pendientes: ["1001-3-COT26", "1001-4-COT26", "1001-5-COT26", "1001-6-COT26"].map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: f2, ahora, lim: lento });
  ok("T09_plazo_total_deja_restantes", r.procesados < 4 && r.restantes === 4 - r.procesados && r.restantes > 0, r);
}
{
  const s = simulado({ listado: {}, reloj });
  const r = await sincronizar({ pendientes: Array.from({ length: 70 }, (_, i) => ({ codigo: `5-${i}-COT26` })), ticket: "t", rpc: s.rpc, f: s.f, ahora, lim: { ...LIMITES, pausaMs: 0, pausaMinMs: 0 } });
  ok("T09_maximo_de_codigos_por_llamada", r.procesados === LIMITES.maxCodigos && s.llamadas.length === LIMITES.maxCodigos);
  const s2 = simulado({ listado: {}, reloj });
  const r2 = await sincronizar({ pendientes: Array.from({ length: 70 }, (_, i) => ({ codigo: `5-${i}-COT26` })), ticket: "t", rpc: s2.rpc, f: s2.f, ahora });
  ok("T09_ritmo_prudente_limita_por_plazo_sin_perder_codigos", r2.procesados < LIMITES.maxCodigos && r2.procesados + r2.restantes === LIMITES.maxCodigos && s2.llamadas.every((x, i) => i === 0 || x.t - s2.llamadas[i - 1].t >= LIMITES.pausaMinMs), { p: r2.procesados, r: r2.restantes });
}
{
  let activos = 0, max = 0; const cods = ["1001-3-COT26", "1001-4-COT26", "1001-5-COT26", "1001-6-COT26", "1001-2-COT26"]; const s = simulado({ listado: Object.fromEntries(cods.map((c) => [c, L(c)])), reloj });
  const f3 = async (u, o) => { activos++; max = Math.max(max, activos); await new Promise((ok) => realSetTimeout(ok, 5)); activos--; return s.f(u, o); };
  await sincronizar({ pendientes: cods.map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: f3, ahora });
  ok("T09_concurrencia_limitada", max <= LIMITES.concurrencia && max >= 1, max);
}
{
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, reloj });
  const rpcMal = async () => { throw new Error("IC404: el código no corresponde"); };
  const r = await sincronizar({ pendientes: [{ codigo: "1001-3-COT26" }], ticket: "t", rpc: rpcMal, f: s.f, ahora });
  ok("T09_error_de_la_base_informado", r.errores === 1 && r.resultados[0].consulta_estado === "error_base");
}
// ── Manejador HTTP (05/11/2026): permisos, avance real (cola), hay_mas, pausa, registro de la sincronización ──
function resp() { const r = { code: 0, body: null, h: {} }; return { r, res: { setHeader: (k, v) => { r.h[k] = v; }, status(c) { r.code = c; return this; }, json(b) { r.body = b; return this; } } }; }
function baseSimulada({ pendientes = [], cola = { total: 3, sin_consultar: 1, por_verificar: 0, en_proceso: 1, finales: 1, con_error: 0, elegibles_ahora: 0, proximo_reintento: null }, sinEstado = false, sinMigracion = false } = {}) {
  const llamadas = [];
  const rpcDe = () => async (fn, body) => {
    llamadas.push({ fn, body });
    if (fn === "ic_pendientes_sincronizar") { if (sinMigracion) throw Object.assign(new Error("no existe"), { status: 404, codigo: "PGRST202" }); return pendientes; }
    if (fn === "ic_estado_sincronizacion") { if (sinEstado) throw Object.assign(new Error("no existe"), { status: 404, codigo: "PGRST202" }); return cola; }
    if (fn === "ic_registrar_resultado") return { resultado: body.p.resultado || "sin_informacion", cambio: true };
    if (fn === "ic_registrar_sincronizacion") return 1;
    return null;
  };
  return { rpcDe, llamadas };
}
const admin = async () => ({ uid: "u-admin", token: "tk", admin: true });
{
  const b = baseSimulada();
  const h = crearManejador({ validar: async () => ({ uid: "u", token: "t", admin: false }), rpcDe: b.rpcDe, ticketDe: () => "T" });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  ok("T30_solo_administradores", r.code === 403 && r.body.codigo === "SOLO_ADMIN" && b.llamadas.length === 0);
}
{
  const b = baseSimulada({ pendientes: [{ codigo: "1001-3-COT26" }], cola: { total: 3, sin_consultar: 0, por_verificar: 0, en_proceso: 1, finales: 2, con_error: 0, elegibles_ahora: 0, proximo_reintento: null } });
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, reloj });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T", f: s.f });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: { origen: "manual" } }, res);
  ok("T31_completo_sin_mas_y_con_cola", r.code === 200 && r.body.ok && r.body.hay_mas === false && r.body.cola.total === 3 && r.body.procesados === 1 && r.body.ritmo_ms >= LIMITES.pausaMinMs, r.body);
  const reg = b.llamadas.find((x) => x.fn === "ic_registrar_sincronizacion").body.p;
  ok("T31_sincronizacion_registrada_sin_limite", reg.consultados === 1 && reg.limite_alcanzado === false && reg.detalle === null, reg);
}
{
  const b = baseSimulada({ pendientes: [{ codigo: "1001-3-COT26" }], cola: { total: 50, sin_consultar: 40, por_verificar: 0, en_proceso: 1, finales: 9, con_error: 0, elegibles_ahora: 40, proximo_reintento: null } });
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, reloj });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T", f: s.f });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: { ritmo_ms: 3000 } }, res);
  ok("T32_hay_mas_si_la_base_tiene_elegibles", r.body.hay_mas === true, r.body);
  ok("T32_ritmo_del_navegador_respetado", r.body.ritmo_ms <= 3000 && r.body.ritmo_ms >= LIMITES.pausaMinMs);
}
{
  const b = baseSimulada({ pendientes: [{ codigo: "1001-3-COT26" }, { codigo: "1001-4-COT26" }] });
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26"), "1001-4-COT26": L("1001-4-COT26") }, seq: { "L:1001-3-COT26": [429, 429, 429, 429] }, reloj });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T", f: s.f, lim: { ...LIMITES, concurrencia: 1 } });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  const reg = b.llamadas.find((x) => x.fn === "ic_registrar_sincronizacion").body.p;
  ok("T33_pausa_de_chilecompra_hay_mas_y_ok", r.code === 200 && r.body.ok && r.body.hay_mas === true && r.body.pausa_ms === LIMITES.pausaSugeridaMs && !r.body.ticket_rechazado, r.body);
  ok("T33_registro_informa_429_y_pausa", reg.limite_alcanzado === true && /bajar la velocidad \(429 × 4; 3 reintentos; pausa de 30 s\)/.test(reg.detalle), reg.detalle);
}
{
  const b = baseSimulada({ pendientes: [{ codigo: "1001-3-COT26" }], sinEstado: true });
  const s = simulado({ listado: { "1001-3-COT26": L("1001-3-COT26") }, reloj });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T", f: s.f });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  ok("T34_base_sin_la_correccion_sigue_funcionando", r.code === 200 && r.body.ok && r.body.cola === null && r.body.hay_mas === false, r.body);
}
{
  const b = baseSimulada({ sinMigracion: true });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T" });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  ok("T35_sin_migracion_informado", r.code === 503 && r.body.codigo === "SIN_MIGRACION");
}
{
  const b = baseSimulada({ pendientes: [{ codigo: "1001-3-COT26" }] });
  const s = simulado({ listado: { "1001-3-COT26": 401 }, reloj });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T", f: s.f });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  ok("T36_ticket_rechazado_502_sin_registrar_resultados", r.code === 502 && r.body.codigo === "TICKET_INVALIDO" && !b.llamadas.some((x) => x.fn === "ic_registrar_resultado"));
}
{
  const b = baseSimulada({ pendientes: [] });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T" });
  let ultimo; for (let i = 0; i < LIMITES.llamadasPorMinuto + 1; i++) { const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res); ultimo = r; }
  ok("T37_limite_propio_informa_cuanto_esperar", ultimo.code === 429 && ultimo.body.codigo === "LIMITE_BFK" && ultimo.body.reintentar_ms > 0 && ultimo.body.reintentar_ms <= 60_000, ultimo.body);
  const h2 = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "" });
  const { r, res } = resp(); await h2({ method: "POST", headers: {}, body: {} }, res);
  ok("T37_sin_ticket", r.code === 503 && r.body.codigo === "SIN_TICKET");
}
{
  const b = baseSimulada({ pendientes: [] });
  const h = crearManejador({ validar: admin, rpcDe: b.rpcDe, ticketDe: () => "T" });
  const { r, res } = resp(); await h({ method: "POST", headers: {}, body: {} }, res);
  ok("T38_todo_al_dia", r.code === 200 && r.body.hay_mas === false && r.body.procesados === 0 && r.body.cola.total === 3);
}
// F: estados reales de la API (el texto manda; el número solo si falta el texto; un número no observado no se adivina)
ok("T39_estado_por_texto_prioriza_sobre_id", estadoProcesoDe({ id_estado: 6, codigo: "desierta" }) === "desierta" && estadoProcesoDe({ id_estado: 4, codigo: "proveedor_seleccionado" }) === "proveedor_seleccionado" && estadoProcesoDe({ id_estado: 2, codigo: "publicada" }) === "publicada" && estadoProcesoDe({ id_estado: 3, codigo: "cerrada" }) === "cerrada");
ok("T39_estado_6_es_desierta_no_cancelada", estadoProcesoDe(6) === "desierta" && estadoProcesoDe({ id_estado: 6 }) === "desierta");
ok("T39_id_no_observado_no_se_adivina", estadoProcesoDe(7) === "sin_informacion" && estadoProcesoDe(99) === "sin_informacion");

globalThis.setTimeout = realSetTimeout;

console.log(`reglas: ${N - F}/${N} correctas`);
process.exit(F ? 1 : 0);
