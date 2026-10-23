// Conciliación masiva (23/10/2026), interfaz: seleccionar coincidencias seguras, resumen antes de confirmar, confirmar en
// lote (solo decisiones), dos usuarios a la vez, «Deshacer este lote» y registro en serie de movimientos nuevos con
// revisión y confirmación de cada uno. PC y celular. Supabase SIMULADO en memoria. Datos 100 % ficticios.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-conciliacion-bancaria/e2e_conciliacion_masiva.mjs http://127.0.0.1:4179/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import os from "node:os";
import path from "node:path";
import { cartolaEnLinea, cartolaHistorica } from "./cartolas_sinteticas.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const SALIDA = process.env.SALIDA || "/tmp";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);
const escribe = (nombre, wb) => { const r = path.join(os.tmpdir(), nombre); XLSX.writeFile(wb, r); return r; };
const FIN = ["eventos_pago_cliente", "eventos_pago_financiamiento", "pagos_vendedor", "gastos_indirectos", "aportes_socios", "ordenes_compra_v2", "eventos_compra", "eventos_factura", "financiadores", "iva_mensual", "ajustes_saldo_financiador"];
const huella = (b) => JSON.stringify(FIN.map((t) => (b.db[t] || []).map((f) => JSON.stringify(f)).sort()));
const escriturasFinancieras = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo !== "GET" && (FIN.includes(w.tabla) || /registrar_|cartola_vincular|eliminar_registro/.test(w.tabla)));

const datos = () => {
  const d = crearDatos();
  d.vendedores[0].nombre = "Luis Ejemplo Soto"; d.financiadores[0].nombre = "Ana Ficticia Rojas"; d.financiadores[1].tipo = "propio";
  d.categorias_gasto.push({ id: "cat_otros", nombre: "Otros gastos" });
  const base = d.ordenes_compra_v2[0];
  d.ordenes_compra_v2.push(
    { ...base, id: "oc20", numero_oc: "1111-200-AG26", cliente: "UNIVERSIDAD FICTICIA", rut_cliente: "70.000.000-1", financiador_id: "f2", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", monto_facturado: 124798, monto_cobrado: 124798 },
    { ...base, id: "oc21", numero_oc: "1111-276-AG26", cliente: "UNIVERSIDAD FICTICIA", rut_cliente: "70.000.000-1", estado_factura_propia: "emitida", monto_facturado: 676001, monto_cobrado: 0 });
  d.eventos_factura.push({ id: "fa20", oc_id: "oc20", fecha: "2026-08-19", numero_factura: "303", monto: 124798 }, { id: "fa21", oc_id: "oc21", fecha: "2026-10-07", numero_factura: "338", monto: 676001 });
  d.eventos_pago_cliente.push({ id: "c_uta", oc_id: "oc20", fecha: "2026-10-15", monto: 124798, medio_pago: "transferencia", cobrado_en_banco: true });
  d.eventos_pago_financiamiento.push({ id: "pf21", oc_id: "oc21", financiador_id: "f1", fecha: "2026-10-13", monto: 260000 });
  d.gastos_indirectos.push(
    { id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 400000, mes: 10, anio: 2026, fecha: "2026-10-20", detalle: "IVA septiembre" },
    { id: "g_ppm", categoria_id: "cat_impuesto", subcategoria: "PPM", monto: 35000, mes: 10, anio: 2026, fecha: "2026-10-20", detalle: "PPM septiembre" },
    { id: "g250a", categoria_id: "cat_otros", monto: 250000, mes: 10, anio: 2026, fecha: "2026-10-14", detalle: "Arriendo bodega" },
    { id: "g250b", categoria_id: "cat_otros", monto: 250000, mes: 10, anio: 2026, fecha: "2026-10-14", detalle: "Servicio técnico" });
  d.pagos_vendedor.push({ id: "pv1", vendedor_id: "v1", anio: 2026, mes: 9, fecha: "2026-10-12", monto_pagado: 450000, monto_extra_gestion: 30000, monto_transferido: 480000 });
  return d;
};
const rHist = escribe("cm_hist.xlsx", cartolaHistorica([{ fecha: "2026-10-01", op: "7000007", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 1000 }], { saldoInicial: 5000000, numero: 9 }));
const LINEA = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },                 // segura: persona (pago vendedor)
  { fecha: "2026-10-13", op: "8812", desc: "TEF A FICTICIA ROJAS ANA", cargo: 260000 },                // segura: persona (devolución)
  { fecha: "2026-10-14", op: "8813", desc: "TEF A PROVEEDOR UNO", cargo: 250000 },                     // ambigua: dos gastos iguales
  { fecha: "2026-10-16", op: "8815", desc: "TEF DE 70000000-1 UNIVERSIDAD FICTICIA", abono: 124798 },  // segura: RUT
  { fecha: "2026-10-17", op: "8817", desc: "TEF A DESCONOCIDO", cargo: 33333 },                        // sin registro
  { fecha: "2026-10-18", op: "8818", desc: "TEF A OTRO DESCONOCIDO", cargo: 44444 },                   // sin registro
  { fecha: "2026-10-20", op: "8820", desc: "PAGO EN LINEA SII F29", cargo: 435000 },                    // segura: SII (IVA + PPM)
];
const rLinea = escribe("cm_linea.xlsx", cartolaEnLinea(LINEA, { saldoInicial: 4999000 }));
const saldos = []; { let s = 4999000; for (const m of LINEA) { s += (m.abono || 0) - (m.cargo || 0); saldos.push(s); } }
const CL = LINEA.map((m, i) => `${m.fecha}|${m.cargo || 0}|${m.abono || 0}|${saldos[i]}`);
const MARCA = LINEA.map((m, i) => `cart:${m.fecha.replace(/-/g, "")}:${m.cargo || 0}:${m.abono || 0}:${saldos[i]}:1`);

// Base simulada de decisiones: misma regla que conciliacion_decidir (un vínculo por movimiento y por registro).
function conDecisiones(b, { conflictoEn = null } = {}) {
  b.db.conciliacion_decisiones = []; let seq = 0; const rpc0 = b.rpc;
  b.rpc = (fn, body, yo, interno) => {
    if (fn === "conciliacion_decidir") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: JSON.parse(JSON.stringify(body)), n: b.escr.length });
      const D = b.db.conciliacion_decisiones;
      if (body.p_marca === conflictoEn || (body.p_decision === "vinculado" && D.some((d) => !d.anulado_en && d.decision === "vinculado" && (d.marca === body.p_marca || (d.tabla === body.p_tabla && body.p_ids.includes(d.registro_id))))))
        return { status: 409, json: { code: "23505", message: 'duplicate key value violates unique constraint "conc_dec_registro_vinculado"' } };
      for (const id of body.p_ids) D.push({ id: ++seq, marca: body.p_marca, decision: body.p_decision, tabla: body.p_tabla, registro_id: id, mov_operacion: body.p_operacion, mov_descripcion: body.p_descripcion, usuario_nombre: "Usuario Prueba", creado_en: "2026-10-23T12:00:00Z", anulado_en: null });
      return { status: 200, json: { ok: true } };
    }
    if (fn === "conciliacion_anular") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: body, n: b.escr.length });
      const d = b.db.conciliacion_decisiones.find((x) => x.id === body.p_id); if (d) d.anulado_en = "2026-10-23T13:00:00Z";
      return { status: 200, json: { ok: true } };
    }
    return rpc0(fn, body, yo, interno);
  };
  return b;
}
async function abrirCartola(p) {
  await p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([rHist, rLinea]);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 600);
}
const rpcs = (b, n0, fn) => b.escr.slice(n0).filter((w) => w.tabla === fn);
const SEGURAS = [0, 1, 3, 6];

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  const b = conDecisiones(crearBase(datos(), { mp: RESPUESTAS_MP }));
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
  await abrirCartola(p);
  const h0 = huella(b), n0 = b.escr.length;
  const enSeguras = async (i) => (await p.locator(`[data-segura="${MARCA[i]}"]`).count()) === 1;

  // 1. Solo lo seguro aparece para confirmar en lote; lo ambiguo y lo nuevo siguen aparte.
  ok(`${X}01_seguras_son_las_4_con_evidencia`, (await p.locator("[data-segura]").count()) === 4 && (await Promise.all(SEGURAS.map(enSeguras))).every(Boolean));
  ok(`${X}02_ambiguo_y_sin_registro_quedan_aparte`, (await p.locator(`[data-grupo-seccion="revisar"] [data-mov="${CL[2]}"]`).count()) === 1
    && (await p.locator(`[data-grupo-seccion="sin-registrar"] [data-mov="${CL[4]}"]`).count()) === 1 && !(await enSeguras(2)) && !(await enSeguras(4)));
  // 2. Seleccionar todas, quitar una, revisar: el resumen muestra movimientos, montos, registros y evidencia.
  await p.locator("[data-seleccionar-seguras]").click(); await espera(p, 200);
  ok(`${X}03_seleccionar_coincidencias_seguras_marca_todas`, (await p.locator("[data-sel-segura]:checked").count()) === 4);
  await p.locator(`[data-sel-segura="${MARCA[6]}"]`).uncheck(); await espera(p, 200);
  await p.locator("[data-revisar-lote]").click(); await espera(p, 300);
  const tR = await p.locator("[data-resumen-lote]").innerText();
  ok(`${X}04_resumen_con_movimientos_montos_registros_y_evidencia`, (await p.locator("[data-fila-lote]").count()) === 3 && /1 abono por \$124\.798/.test(tR) && /2 cargos por \$740\.000/.test(tR)
    && /Registro BFK/.test(tR) && /Evidencia: .*RUT/.test(tR) && /persona en la glosa/.test(tR) && !/PAGO EN LINEA SII/.test(tR), tR.slice(0, 600));
  ok(`${X}05_confirmar_exige_marcar_la_confirmacion`, await p.locator("[data-confirmar-lote]").isDisabled());
  await p.locator("[data-resumen-lote]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SALIDA, `masiva_${X}_resumen.png`), fullPage: !movil });
  // 3. Confirmar: solo decisiones «vinculado» con sus registros; ningún registro financiero creado ni cambiado.
  await p.locator("[data-confirmar-lote-check]").check(); await p.locator("[data-confirmar-lote]").click(); await espera(p, 2000);
  const dec = rpcs(b, n0, "conciliacion_decidir");
  ok(`${X}06_tres_decisiones_vinculado_con_sus_registros`, dec.length === 3 && dec.every((w) => w.cuerpo.p_decision === "vinculado")
    && dec.find((w) => w.cuerpo.p_marca === MARCA[3])?.cuerpo.p_ids.join() === "c_uta" && dec.find((w) => w.cuerpo.p_marca === MARCA[0])?.cuerpo.p_tabla === "pagos_vendedor", dec.map((w) => w.cuerpo));
  ok(`${X}07_sin_escrituras_financieras_huella_intacta`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0, escriturasFinancieras(b, n0));
  const tRes = await p.locator("[data-resultado-lote]").innerText().catch(() => "");
  ok(`${X}08_resultado_y_quedan_las_no_seleccionadas`, /3 vínculos confirmados/.test(tRes) && (await p.locator("[data-segura]").count()) === 1 && await enSeguras(6), tRes);
  await p.locator("[data-resultado-lote]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SALIDA, `masiva_${X}_resultado.png`), fullPage: !movil });
  // 4. Deshacer el lote: anula exactamente esas 3 decisiones (4 filas: ninguna, porque SII no estaba); vuelven a «seguras».
  await p.locator("[data-deshacer-lote]").click(); await espera(p, 1500);
  const an = rpcs(b, n0, "conciliacion_anular");
  ok(`${X}09_deshacer_lote_anula_solo_lo_del_lote`, an.length === 3 && (await p.locator("[data-segura]").count()) === 4 && huella(b) === h0, an.map((w) => w.cuerpo));
  // 5. Dos usuarios: entre la selección y la confirmación, otra persona confirma una; y la base rechaza otra (conflicto).
  await p.locator("[data-seleccionar-seguras]").click(); await p.locator("[data-revisar-lote]").click(); await espera(p, 200);
  b.db.conciliacion_decisiones.push({ id: 900, marca: MARCA[1], decision: "vinculado", tabla: "eventos_pago_financiamiento", registro_id: "pf21", usuario_nombre: "Otra persona", creado_en: "2026-10-23T12:30:00Z", anulado_en: null });
  const rpc1 = b.rpc; b.rpc = (fn, body, yo, i) => (fn === "conciliacion_decidir" && body.p_marca === MARCA[6]) ? (b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: body }), { status: 409, json: { code: "23505", message: "duplicate key value violates unique constraint \"conc_dec_marca_vinculada\"" } }) : rpc1(fn, body, yo, i);
  const n1 = b.escr.length;
  await p.locator("[data-confirmar-lote-check]").check(); await p.locator("[data-confirmar-lote]").click(); await espera(p, 2000);
  b.rpc = rpc1;
  const tR2 = await p.locator("[data-resultado-lote]").innerText().catch(() => "");
  ok(`${X}10_dos_usuarios_omitido_y_conflicto_informados_el_resto_guardado`, /2 vínculos confirmados · 2 no se guardaron/.test(tR2) && /ya estaba confirmado/.test(tR2) && /otra persona acaba de vincular/.test(tR2)
    && !rpcs(b, n1, "conciliacion_decidir").some((w) => w.cuerpo.p_marca === MARCA[1]), tR2);
  ok(`${X}11_sin_escrituras_financieras_tras_concurrencia`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0);
  await p.locator("[data-cerrar-resultado-lote]").click(); await espera(p, 200);

  // 6. Registro en serie de movimientos nuevos: cada uno se revisa y se confirma; la cartola sigue abierta.
  const n2 = b.escr.length;
  await p.locator(`[data-sel-nuevo="${MARCA[4]}"]`).check(); await p.locator(`[data-sel-nuevo="${MARCA[5]}"]`).check();
  await p.locator("[data-registrar-serie]").click(); await espera(p, 400);
  ok(`${X}12_serie_abre_el_primero_sin_preseleccion`, /Registro 1 de 2/.test(await p.locator("[data-serie]").innerText()) && (await p.locator("[data-tipo-egreso]").count()) === 1
    && (await p.locator("[data-tipo-egreso]").inputValue()) === "" && await p.locator("[data-registrar]").isDisabled());
  await p.locator("[data-tipo-egreso]").selectOption("gasto"); await p.locator("[data-categoria]").selectOption("cat_otros");
  ok(`${X}13_sin_confirmar_no_registra`, await p.locator("[data-registrar]").isDisabled());
  await p.locator("[data-serie]").scrollIntoViewIfNeeded();
  await p.screenshot({ path: path.join(SALIDA, `masiva_${X}_serie.png`), fullPage: !movil });
  await p.locator("[data-confirmo]").check(); await p.locator("[data-registrar]").click(); await espera(p, 3000);
  const reg = rpcs(b, n2, "registrar_movimiento_cartola");
  ok(`${X}14_registra_solo_el_confirmado_y_la_cartola_sigue_abierta`, reg.length === 1 && reg[0].cuerpo.p_marca === MARCA[4] && (await p.locator("[data-cartola-conciliacion]").count()) === 1, reg.map((w) => w.cuerpo.p_marca));
  ok(`${X}15_abre_el_siguiente_para_revisar`, /Registro 2 de 2 · 1 registrado/.test(await p.locator("[data-serie]").innerText().catch(() => "")) && (await p.locator("[data-tipo-egreso]").inputValue()) === "");
  await p.locator("[data-serie-saltar]").click(); await espera(p, 400);
  ok(`${X}16_saltar_no_registra_y_termina`, /1 registrado, 1 saltado/.test(await p.locator("[data-serie-terminada]").innerText().catch(() => "")) && rpcs(b, n2, "registrar_movimiento_cartola").length === 1);
  ok(`${X}17_solo_un_registro_financiero_nuevo_en_toda_la_prueba`, escriturasFinancieras(b, n0).filter((w) => /registrar_/.test(w.tabla)).length === 1);
  ok(`${X}18_sin_desborde_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok(`${X}19_sin_errores_js`, errs.length === 0, errs);
  await ctx.close();
}

// Serie con devolución a financista (FIFO) y aviso de duplicado manual (escritorio). El reparto FIFO enviado a la base en
// serie debe ser IDÉNTICO al del registro normal de un solo movimiento; el duplicado detiene la serie hasta resolverlo.
{
  const LINEA2 = [...LINEA, { fecha: "2026-10-21", op: "8821", desc: "TEF A FICTICIA ROJAS ANA", cargo: 1000000 }];
  const s2 = []; { let s = 4999000; for (const m of LINEA2) { s += (m.abono || 0) - (m.cargo || 0); s2.push(s); } }
  const M2 = LINEA2.map((m, i) => `cart:${m.fecha.replace(/-/g, "")}:${m.cargo || 0}:${m.abono || 0}:${s2[i]}:1`);
  const CL2 = LINEA2.map((m, i) => `${m.fecha}|${m.cargo || 0}|${m.abono || 0}|${s2[i]}`);
  const rL2 = escribe("cm_linea2.xlsx", cartolaEnLinea(LINEA2, { saldoInicial: 4999000 }));
  const datos2 = () => { const d = datos(); d.gastos_indirectos.push({ id: "g333", categoria_id: "cat_otros", monto: 33333, mes: 10, anio: 2026, fecha: "2026-10-17", detalle: "Gasto manual", creadoEn: "2026-10-17T10:00:00Z" }); return d; };
  const abrir2 = async (p) => {
    await p.getByRole("button", { name: /^Cartola$/ }).first().click();
    await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
    await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([rHist, rL2]);
    await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 600);
  };
  const pagarFin = async (p) => { await p.locator("[data-tipo-egreso]").selectOption("financiador"); await p.locator("[data-destino]").selectOption("f1"); await p.locator("[data-confirmo]").check(); await p.locator("[data-registrar]").click(); await espera(p, 3000); };
  // a) Registro normal (uno solo): reparto FIFO de referencia.
  const bA = conDecisiones(crearBase(datos2(), { mp: RESPUESTAS_MP }));
  const A = await abrir(browser, bA, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await abrir2(A.page); const nA = bA.escr.length;
  await A.page.locator(`[data-preparar="${CL2[7]}"]`).click(); await espera(A.page, 300); await pagarFin(A.page);
  const refFifo = rpcs(bA, nA, "registrar_pago_financiador_cartola")[0]?.cuerpo.p_asignaciones;
  ok("F01_registro_normal_reparte_fifo_mas_antigua_primero", JSON.stringify(refFifo) === JSON.stringify([{ oc_id: "oc2", monto: 810000 }, { oc_id: "oc4", monto: 190000 }]), refFifo);
  await A.ctx.close();
  // b) En serie: primero el gasto con un registro manual parecido (aviso de duplicado), luego la devolución.
  const bS = conDecisiones(crearBase(datos2(), { mp: RESPUESTAS_MP }));
  const S = await abrir(browser, bS, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 }); const p = S.page;
  await abrir2(p); const nS = bS.escr.length;
  await p.locator(`[data-mov="${CL2[4]}"] [data-rechazar="g333"]`).click(); await espera(p, 1200);   // «No corresponde» → pasa a Sin registrar
  await p.locator(`[data-sel-nuevo="${M2[4]}"]`).check(); await p.locator(`[data-sel-nuevo="${M2[7]}"]`).check();
  await p.locator("[data-registrar-serie]").click(); await espera(p, 400);
  await p.locator("[data-tipo-egreso]").selectOption("gasto"); await p.locator("[data-categoria]").selectOption("cat_otros"); await p.locator("[data-confirmo]").check();
  await p.locator("[data-registrar]").click(); await espera(p, 2500);
  ok("F02_serie_muestra_el_aviso_de_duplicado_y_no_avanza", (await p.locator("[data-duplicado-manual]").count()) === 1 && /Registro 1 de 2 · 0 registrados/.test(await p.locator("[data-serie]").innerText())
    && rpcs(bS, nS, "registrar_movimiento_cartola").length === 1 && !bS.db.gastos_indirectos.some((g) => g.marca_cartola === M2[4]),
    { serie: await p.locator("[data-serie]").innerText().catch(() => "-"), error: await p.locator("[data-error]").innerText().catch(() => "-"), rpcs: rpcs(bS, nS, "registrar_movimiento_cartola").length, dup: await p.locator("[data-duplicado-manual]").count() });
  await p.locator("[data-duplicado-manual] [data-vincular]").click(); await espera(p, 3000);
  ok("F03_vincular_el_manual_no_crea_gasto_y_avanza", bS.db.gastos_indirectos.filter((g) => g.monto === 33333).length === 1 && bS.db.gastos_indirectos.find((g) => g.id === "g333")?.marca_cartola === M2[4]
    && /Registro 2 de 2 · 1 registrado/.test(await p.locator("[data-serie]").innerText().catch(() => "")));
  await pagarFin(p);
  const serieFifo = rpcs(bS, nS, "registrar_pago_financiador_cartola")[0]?.cuerpo.p_asignaciones;
  ok("F04_serie_reparte_fifo_igual_que_el_registro_normal", JSON.stringify(serieFifo) === JSON.stringify(refFifo), serieFifo);
  ok("F05_cartola_sigue_abierta_y_serie_terminada", (await p.locator("[data-cartola-conciliacion]").count()) === 1 && /2 registrados/.test(await p.locator("[data-serie-terminada]").innerText().catch(() => "")));
  ok("F06_sin_errores_js", S.errs.length === 0, S.errs);
  await S.ctx.close();
}

// Sin la base de decisiones (actualización pendiente): no se ofrece confirmar en lote.
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await p.route("**/rest/v1/conciliacion_decisiones*", (r) => r.fulfill({ status: 404, json: { code: "PGRST205", message: "Could not find the table" } }));
  await abrirCartola(p);
  ok("S01_sin_base_de_decisiones_no_hay_lote", (await p.locator("[data-segura]").count()) === 0 && (await p.locator("[data-seleccionar-seguras]").count()) === 0);
  ok("S02_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN conciliación masiva (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
