// Inteligencia Comercial (04/11/2026): reglas puras y sincronización con ChileCompra SIMULADA (nada sale a la red).
// Uso: node docs/pruebas-inteligencia/reglas.test.mjs
import { normalizarResultadoMP, construirOportunidades, filtrarOportunidades, resumirOportunidades, periodoDe, ordenarPaginar, csvInforme, hojasInforme,
  estadoProcesoDe, rutNorm, esCodigoCompraAgil, enlaceMP, mediana, r1, NO_DISPONIBLE } from "../../src/lib/inteligenciaComercial.js";
import { sincronizar, LIMITES } from "../../api/inteligencia.mjs";
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
ok("N01_estados", ["publicada", "cerrada", "proveedor_seleccionado", "desierta", "cancelada"].every((e, i) => estadoProcesoDe({ id_estado: i + 2 }) === e) && estadoProcesoDe({ glosa: "OC Emitida" }) === "oc_emitida" && estadoProcesoDe({ codigo: "Proveedor Seleccionado" }) === "proveedor_seleccionado" && estadoProcesoDe(null) === "sin_informacion");
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

// 9 y 10. Errores, límites de API y reintentos (ChileCompra y la base SIMULADAS)
function simulado({ listado = {}, detalle = {}, fallasListado = {}, reloj } = {}) {
  const llamadas = []; const rpcs = [];
  const f = async (url) => {
    const t = reloj.t; llamadas.push({ url, t });
    const det = !url.includes("?id="); const cod = decodeURIComponent(det ? url.split("/").pop() : url.split("?id=")[1]);
    const reg = det ? detalle[cod] : listado[cod];
    if (!det && fallasListado[cod] > 0) { fallasListado[cod]--; return { status: 504, json: async () => ({}) }; }
    if (typeof reg === "number") return { status: reg, json: async () => ({ errors: [{ codigo: reg }] }) };
    if (reg === "red") throw Object.assign(new Error("x"), { name: "TypeError" });
    if (!reg) return { status: 200, json: async () => ({ payload: { items: [] } }) };
    return { status: 200, json: async () => ({ payload: det ? reg : { items: [reg] } }) };
  };
  const rpc = async (fn, body) => { rpcs.push({ fn, body }); return { resultado: body.p.resultado || "sin_informacion", cambio: true }; };
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
{
  const s = simulado({ listado: { "1001-2-COT26": 429, "1001-3-COT26": L("1001-3-COT26") }, reloj });
  const r = await sincronizar({ pendientes: [{ codigo: "1001-2-COT26" }, { codigo: "1001-3-COT26" }], ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_429_detiene_todo", r.limite_alcanzado && s.rpcs.find((x) => x.body.p.codigo === "1001-2-COT26").body.p.consulta_estado === "limite" && r.procesados + r.restantes === 2, r);
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
  const lento = { ...LIMITES, presupuestoMs: 30_000 };
  const s = simulado({ listado: Object.fromEntries(["1001-3-COT26", "1001-4-COT26", "1001-5-COT26", "1001-6-COT26"].map((c) => [c, L(c)])), reloj });
  const f2 = async (u, o) => { reloj.t += 9000; return s.f(u, o); };
  const r = await sincronizar({ pendientes: ["1001-3-COT26", "1001-4-COT26", "1001-5-COT26", "1001-6-COT26"].map((codigo) => ({ codigo })), ticket: "t", rpc: s.rpc, f: f2, ahora, lim: lento });
  ok("T09_plazo_total_deja_restantes", r.procesados < 4 && r.restantes === 4 - r.procesados && r.restantes > 0, r);
}
{
  const s = simulado({ listado: {}, reloj });
  const r = await sincronizar({ pendientes: Array.from({ length: 70 }, (_, i) => ({ codigo: `5-${i}-COT26` })), ticket: "t", rpc: s.rpc, f: s.f, ahora });
  ok("T09_maximo_de_codigos_por_llamada", r.procesados === LIMITES.maxCodigos && s.llamadas.length === LIMITES.maxCodigos);
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
globalThis.setTimeout = realSetTimeout;

console.log(`reglas: ${N - F}/${N} correctas`);
process.exit(F ? 1 : 0);
