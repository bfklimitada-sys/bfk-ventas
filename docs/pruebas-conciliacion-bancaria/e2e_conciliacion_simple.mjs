// Conciliación simple (21/10/2026): tres grupos, «Ver conciliados», «Es este registro» / «No corresponde» sin escribir
// registros financieros, «Registrado en BFK, pendiente de verificar en banco» y lenguaje simple. PC y celular.
// Supabase SIMULADO en memoria (nada sale a la red). Datos 100 % ficticios.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-conciliacion-bancaria/e2e_conciliacion_simple.mjs http://127.0.0.1:4179/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import os from "node:os";
import path from "node:path";
import { cartolaEnLinea, cartolaHistorica } from "./cartolas_sinteticas.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);
const escribe = (nombre, wb) => { const r = path.join(os.tmpdir(), nombre); XLSX.writeFile(wb, r); return r; };
const FIN = ["eventos_pago_cliente", "eventos_pago_financiamiento", "pagos_vendedor", "gastos_indirectos", "aportes_socios", "ordenes_compra_v2", "eventos_compra", "eventos_factura", "financiadores", "iva_mensual", "ajustes_saldo_financiador"];
const huella = (b) => JSON.stringify(FIN.map((t) => (b.db[t] || []).map((f) => JSON.stringify(f)).sort()));

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
  d.eventos_pago_cliente.find((e) => e.id === "pc7").fecha = "2026-10-19";      // vale vista recibido, sin cobrar
  d.eventos_compra.push({ id: "k20", oc_id: "oc20", fecha: "2026-10-16", monto_venta: 124798, costo_compra: 80000, financiador_id: "f2", proveedor: "Proveedor CS" });
  d.eventos_pago_financiamiento.push({ id: "pf21", oc_id: "oc21", financiador_id: "f1", fecha: "2026-10-13", monto: 260000 });
  d.gastos_indirectos.push(
    { id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 400000, mes: 10, anio: 2026, fecha: "2026-10-20", detalle: "IVA septiembre" },
    { id: "g_ppm", categoria_id: "cat_impuesto", subcategoria: "PPM", monto: 35000, mes: 10, anio: 2026, fecha: "2026-10-20", detalle: "PPM septiembre" },
    { id: "g250a", categoria_id: "cat_otros", monto: 250000, mes: 10, anio: 2026, fecha: "2026-10-14", detalle: "Arriendo bodega" },
    { id: "g250b", categoria_id: "cat_otros", monto: 250000, mes: 10, anio: 2026, fecha: "2026-10-14", detalle: "Servicio técnico" });
  d.pagos_vendedor.push({ id: "pv1", vendedor_id: "v1", anio: 2026, mes: 9, fecha: "2026-10-12", monto_pagado: 450000, monto_extra_gestion: 30000, monto_transferido: 480000 });
  return d;
};
const rHist = escribe("cs_hist.xlsx", cartolaHistorica([{ fecha: "2026-10-01", op: "7000007", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 1000 }], { saldoInicial: 5000000, numero: 9 }));
const LINEA = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-13", op: "8812", desc: "TEF A FICTICIA ROJAS ANA", cargo: 260000 },
  { fecha: "2026-10-14", op: "8813", desc: "TEF A PROVEEDOR UNO", cargo: 250000 },
  { fecha: "2026-10-14", op: "8814", desc: "TEF A PROVEEDOR DOS", cargo: 250000 },
  { fecha: "2026-10-16", op: "8815", desc: "TEF DE 70000000-1 UNIVERSIDAD FICTICIA", abono: 800799 },
  { fecha: "2026-10-16", op: "8816", desc: "TEF A PROVEEDOR CS", cargo: 80000 },
  { fecha: "2026-10-17", op: "8817", desc: "TEF A DESCONOCIDO", cargo: 33333 },
  { fecha: "2026-10-20", op: "8818", desc: "PAGO EN LINEA SII F29", cargo: 435000 },
  { fecha: "2026-10-20", op: "8819", desc: "DEPOSITO DOCUMENTO", abono: 500000 },
];
const rLinea = escribe("cs_linea.xlsx", cartolaEnLinea(LINEA, { saldoInicial: 4999000 }));
// Tramo superpuesto (movimientos 3 a 7, otra descarga con glosas recortadas) para probar que las decisiones persisten.
const rTramo = escribe("cs_tramo.xlsx", cartolaEnLinea(LINEA.slice(2, 7), { saldoInicial: 4999000 - 480000 - 260000, glosaVariante: true }));

// Base simulada de las decisiones (misma regla que conciliacion_decidir: un vínculo por movimiento y por registro).
function conDecisiones(b) {
  b.db.conciliacion_decisiones = []; let seq = 0; const rpc0 = b.rpc;
  b.rpc = (fn, body, yo, interno) => {
    if (fn === "conciliacion_decidir") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: JSON.parse(JSON.stringify(body)), n: b.escr.length });
      const D = b.db.conciliacion_decisiones;
      if (body.p_decision === "vinculado" && (D.some((d) => d.marca === body.p_marca && d.decision === "vinculado") || D.some((d) => d.decision === "vinculado" && d.tabla === body.p_tabla && body.p_ids.includes(d.registro_id))))
        return { status: 400, json: { code: "23505", message: "CONC: este movimiento bancario ya está vinculado" } };
      for (const id of body.p_ids) D.push({ id: ++seq, marca: body.p_marca, decision: body.p_decision, tabla: body.p_tabla, registro_id: id, usuario_nombre: "Usuario Prueba", creado_en: "2026-10-21T12:00:00Z", anulado_en: null });
      return { status: 200, json: { ok: true } };
    }
    if (fn === "conciliacion_anular") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: body, n: b.escr.length });
      const d = b.db.conciliacion_decisiones.find((x) => x.id === body.p_id); if (d) d.anulado_en = "2026-10-21T13:00:00Z";
      return { status: 200, json: { ok: true } };
    }
    return rpc0(fn, body, yo, interno);
  };
  return b;
}
async function abrirCartola(p, archivos = [rHist, rLinea]) {
  await p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles(archivos);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 600);
}
const cuenta = async (p, g) => Number(await p.locator(`[data-cuenta="${g}"]`).innerText());
const enSeccion = (p, g) => p.locator(`[data-grupo-seccion="${g}"] [data-mov]`);
const K = (f, cargo, abono, saldo) => `${f}|${cargo}|${abono}|${saldo}`;
const saldos = []; { let s = 4999000; for (const m of LINEA) { s += (m.abono || 0) - (m.cargo || 0); saldos.push(s); } }
const CL = LINEA.map((m, i) => K(m.fecha, m.cargo || 0, m.abono || 0, saldos[i]));
const PROHIBIDAS = /control inverso|posible registrado|registro posterior al cierre/i;
// Escrituras que cambiarían registros financieros (cualquier tabla financiera o registro desde la cartola).
const escriturasFinancieras = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo !== "GET" && (FIN.includes(w.tabla) || /registrar_|cartola_vincular|eliminar_registro/.test(w.tabla)));

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  const b = conDecisiones(crearBase(datos(), { mp: RESPUESTAS_MP }));
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
  await abrirCartola(p);
  const h0 = huella(b), n0 = b.escr.length;

  // 1. Por defecto: solo «Por revisar» y «Sin registrar»; conciliados y anteriores, ocultos.
  ok(`${X}01_contadores_tres_grupos`, (await cuenta(p, "revisar")) === 4 && (await cuenta(p, "sin-registrar")) === 2 && (await cuenta(p, "ya")) === 3, [await cuenta(p, "revisar"), await cuenta(p, "sin-registrar"), await cuenta(p, "ya")]);
  ok(`${X}02_por_defecto_sin_conciliados`, (await p.locator('[data-grupo-seccion="ya"]').count()) === 0 && (await enSeccion(p, "revisar").count()) === 4 && (await enSeccion(p, "sin-registrar").count()) === 2);
  // 2. Cada movimiento muestra fecha, descripción, monto, motivo y acción; lenguaje simple.
  const tarjeta = p.locator(`[data-mov="${CL[5]}"]`);
  const tt = await tarjeta.innerText();
  ok(`${X}03_tarjeta_con_fecha_descripcion_monto_motivo_accion`, /16\/10/.test(tt) && /PROVEEDOR CS/.test(tt) && /80\.000/.test(tt) && /Motivo/.test(tt) && /Acción/.test(tt) && /Compra con fondos propios/.test(tt), tt);
  ok(`${X}04_sin_expresiones_confusas`, !PROHIBIDAS.test(await p.locator("[data-cartola-conciliacion]").innerText()));
  ok(`${X}05_dos_cargos_iguales_avisados_no_duplicados`, /operaciones distintas/.test(await p.locator(`[data-mov="${CL[2]}"]`).innerText()) && (await p.locator(`[data-mov="${CL[2]}"] [data-vincular-registro]`).count()) === 2);
  ok(`${X}06_deposito_de_vale_vista_por_revisar`, (await p.locator(`[data-mov="${CL[8]}"]`).getAttribute("data-tipo-revision")) === "vale_vista" && (await p.locator(`[data-mov="${CL[8]}"] [data-preparar]`).count()) === 1);
  // 3. Registrado en BFK sin movimiento: el cobro de $124.798 con la pista del pago conjunto.
  const sb = p.locator('[data-registrado-sin-banco="c_uta"]');
  ok(`${X}07_registrado_en_bfk_pendiente_de_verificar_en_banco`, (await sb.count()) === 1 && (await sb.getAttribute("data-pista")) === "agrupado" && /800\.799/.test(await sb.innerText()) && /1111-276-AG26/.test(await sb.innerText()) && !/duplicado(?! necesariamente)/i.test((await sb.innerText()).replace("No es necesariamente un duplicado", "")), await sb.innerText().catch(() => ""));
  // 4. «Ver conciliados»: pago al SII (IVA + PPM), devolución FIFO y comisión, como «ya registrado».
  await p.locator("[data-ver-conciliados]").click(); await espera(p, 300);
  const ya = await p.locator('[data-grupo-seccion="ya"]').innerText();
  ok(`${X}08_ver_conciliados`, (await enSeccion(p, "ya").count()) === 3 && /Gasto de \$435\.000 ya registrado en BFK/.test(ya) && /Devolución a financiador de \$260\.000 ya registrada/.test(ya) && /Pago a vendedor de \$480\.000 ya registrado/.test(ya), ya.slice(0, 400));
  await p.locator("[data-ver-conciliados]").click(); await espera(p, 200);

  // 5. «Es este registro» (compra con fondos propios): guarda la decisión, NO crea ni cambia registros.
  await p.locator(`[data-mov="${CL[5]}"] [data-vincular-registro="k20"]`).click(); await espera(p, 1500);
  const dec = b.escr.slice(n0).filter((w) => w.tabla === "conciliacion_decidir");
  ok(`${X}09_vincular_guarda_decision`, dec.length === 1 && dec[0].cuerpo.p_tabla === "eventos_compra" && JSON.stringify(dec[0].cuerpo.p_ids) === '["k20"]' && dec[0].cuerpo.p_decision === "vinculado" && /^cart:20261016:80000:0:/.test(dec[0].cuerpo.p_marca), dec[0]?.cuerpo);
  ok(`${X}10_vincular_pasa_a_ya_registrado`, (await cuenta(p, "revisar")) === 3 && (await cuenta(p, "ya")) === 4);
  ok(`${X}11_vincular_no_escribe_registros_financieros`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0, escriturasFinancieras(b, n0).map((w) => w.tabla));

  // 6. «No corresponde» en uno de los dos cargos iguales: el rechazado no se vuelve a ofrecer y nada se registra.
  await p.locator(`[data-mov="${CL[2]}"] [data-rechazar="g250a"]`).click(); await espera(p, 1500);
  const rech = b.escr.slice(n0).filter((w) => w.tabla === "conciliacion_decidir" && w.cuerpo.p_decision === "rechazado");
  ok(`${X}12_no_corresponde_guarda_rechazo`, rech.length === 1 && JSON.stringify(rech[0].cuerpo.p_ids) === '["g250a"]');
  ok(`${X}13_tras_rechazo_sigue_por_revisar_solo_con_el_otro_gasto`, (await cuenta(p, "revisar")) === 3 && (await cuenta(p, "ya")) === 4
    && (await p.locator(`[data-mov="${CL[2]}"] [data-vincular-registro]`).count()) === 1 && (await p.locator(`[data-mov="${CL[2]}"] [data-vincular-registro="g250b"]`).count()) === 1,
    [await cuenta(p, "revisar"), await cuenta(p, "ya")]);
  ok(`${X}14_rechazo_no_escribe_registros_financieros`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0);

  // 6b. Persistencia: cerrar la ventana, volver a abrir y cargar las cartolas en otro orden y con un tramo superpuesto.
  await p.keyboard.press("Escape"); await p.locator("[role=dialog]").waitFor({ state: "detached", timeout: 10000 }).catch(() => {}); await espera(p, 400);
  await abrirCartola(p, [rTramo, rLinea, rHist]);
  ok(`${X}13b_decisiones_persisten_al_volver_a_abrir_con_cartolas_superpuestas`, (await cuenta(p, "revisar")) === 3 && (await cuenta(p, "ya")) === 4
    && (await p.locator(`[data-grupo-seccion="revisar"] [data-mov="${CL[5]}"]`).count()) === 0 && (await p.locator(`[data-mov="${CL[2]}"] [data-vincular-registro="g250a"]`).count()) === 0,
    [await cuenta(p, "revisar"), await cuenta(p, "ya")]);

  // 7. Deshacer el vínculo: vuelve a «Por revisar»; tampoco toca registros.
  await p.locator("[data-ver-conciliados]").click(); await espera(p, 300);
  await p.locator(`[data-mov="${CL[5]}"] [data-deshacer-vinculo]`).click(); await espera(p, 1500);
  ok(`${X}15_deshacer_vinculo`, (await p.locator(`[data-grupo-seccion="revisar"] [data-mov="${CL[5]}"]`).count()) === 1 && b.escr.slice(n0).some((w) => w.tabla === "conciliacion_anular") && huella(b) === h0);

  // 8. «Sin registrar»: el registro nuevo sigue pidiendo elegir y confirmar (nada preseleccionado).
  await p.locator(`[data-preparar="${CL[6]}"]`).click(); await espera(p, 300);
  ok(`${X}16_sin_registrar_pide_elegir_y_confirmar`, (await p.locator("[data-tipo-egreso]").inputValue()) === "" && await p.locator("[data-registrar]").isDisabled());
  ok(`${X}17_sin_escrituras_financieras_en_toda_la_revision`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0);
  ok(`${X}18_sin_desborde_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok(`${X}19_sin_errores_js`, errs.length === 0, errs);
  await p.screenshot({ path: process.env[`CAPTURA_${X}`] || `/tmp/conciliacion_${X}.png`, fullPage: false });
  await ctx.close();
}

// 9. Sin la actualización de la base: se consulta y se registra lo nuevo, pero los botones de decisión no se activan.
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await p.route("**/rest/v1/conciliacion_decisiones*", (r) => r.fulfill({ status: 404, json: { code: "PGRST205", message: "Could not find the table" } }));
  await abrirCartola(p);
  ok("S01_sin_tabla_aviso_y_botones_inactivos", (await p.locator("[data-decisiones-no-disponibles]").count()) === 1 && await p.locator("[data-vincular-registro]").first().isDisabled());
  ok("S02_sin_tabla_igual_clasifica", (await cuenta(p, "revisar")) === 4 && (await cuenta(p, "ya")) === 3);
  ok("S03_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
console.log(`\nRESUMEN conciliación simple (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
