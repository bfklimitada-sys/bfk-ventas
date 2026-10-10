// Pruebas de interfaz: registro desde la cartola con DOS SESIONES a la vez, doble clic y reimportación.
// Chromium + Playwright con Supabase SIMULADO en memoria (la simulación rechaza ids repetidos como la clave
// primaria de PostgreSQL). Nada sale a la red. Datos 100 % ficticios.
// Uso: node docs/pruebas-conciliacion-bancaria/e2e_concurrencia.mjs http://127.0.0.1:4179/   (build servido con vite preview)
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import os from "node:os";
import path from "node:path";
import { cartolaEnLinea, cartolaHistorica } from "./cartolas_sinteticas.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, detalle) => { if (!v) { F.push(k); console.log("FALLA " + k + (detalle !== undefined ? " :: " + JSON.stringify(detalle).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const escribe = (nombre, wb) => { const r = path.join(os.tmpdir(), nombre); XLSX.writeFile(wb, r); return r; };

const datos = () => {
  const d = crearDatos();
  d.vendedores[0].nombre = "Luis Ejemplo Soto"; d.financiadores[0].nombre = "Ana Ficticia Rojas"; d.financiadores[1].tipo = "propio";
  d.categorias_gasto.push({ id: "cat_otros", nombre: "Otros gastos" });
  for (const f of d.eventos_factura.filter((x) => x.oc_id === "oc7")) f.fecha = "2026-10-04";   // fecha fija: factura anterior al abono
  return d;
};
// Cartolas ficticias: histórica (anterior al cierre) y en línea (posterior), que empalman por saldo.
const rHist = escribe("cc_hist.xlsx", cartolaHistorica([{ fecha: "2026-10-01", op: "7000007", desc: "TEF A PROVEEDOR FICTICIO", cargo: 1000 }], { saldoInicial: 3000000, numero: 6 }));
const rLinea = escribe("cc_linea.xlsx", cartolaEnLinea([
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-12", op: "7000011", desc: "TEF A FICTICIA ROJAS ANA", cargo: 260000 },
  { fecha: "2026-10-13", op: "7000012", desc: "TEF A PROVEEDOR FICTICIO QWE", cargo: 55000 },
  { fecha: "2026-10-13", op: "7000013", desc: "TEF DE CLIENTE FICTICIO", abono: 760000 },
], { saldoInicial: 2999000 }));
const K = { pago: "2026-10-12|480000|0|2519000", retiro: "2026-10-12|260000|0|2259000", gasto: "2026-10-13|55000|0|2204000", cobro: "2026-10-13|0|760000|2964000" };

async function sesion(b) {
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 1800, movil: false, espera: 3000 });
  await p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([rHist, rLinea]);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await p.waitForTimeout(400);
  return { p, errs, ctx };
}
// Prepara el registro con todo elegido a mano y la confirmación marcada (sin pulsar «Registrar»).
async function preparar(p, clave, como) {
  await p.locator(`[data-preparar="${clave}"]`).click(); await p.waitForTimeout(200);
  if (como === "cobro") {
    const sel = p.locator("[data-opcion-abono]");
    const v = await sel.evaluate((s) => [...s.options].map((o) => o.value).find((x) => x)); if (!v) return false;
    await sel.selectOption(v);
  } else {
    await p.locator("[data-tipo-egreso]").selectOption(como);
    if (como === "vendedor") { await p.locator("[data-destino]").selectOption("v1"); await p.locator("[data-mes-comision]").selectOption("8"); await p.locator("[data-anio-comision]").fill("2026"); }
    if (como === "gasto") await p.locator("[data-categoria]").selectOption("cat_otros");
    if (como === "retiro") await p.locator("[data-socio]").fill("Ana Ficticia Rojas");
  }
  await p.waitForTimeout(150); await p.locator("[data-confirmo]").check(); await p.waitForTimeout(150);
  return true;
}
const filas = (b, tabla) => (b.db[tabla] || []).filter((f) => f.marca_cartola);
const rpcs = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo === "RPC" && /cartola/.test(w.tabla)).length;
const texto = (p) => p.locator("[role=dialog]").innerText().catch(() => "");

// ── X1: dos sesiones registran el MISMO pago a vendedor en el mismo instante → la base acepta uno solo ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.pago, "vendedor"); await preparar(B.p, K.pago, "vendedor");
  await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
  await A.p.waitForTimeout(3500);
  const pv = filas(b, "pagos_vendedor");
  ok("X1_dos_sesiones_simultaneas_un_solo_pago", pv.length === 1, pv.map((f) => f.id));
  ok("X1_marca_del_movimiento_en_la_base", pv[0]?.marca_cartola === "cart:20261012:480000:0:2519000:1", pv[0]?.marca_cartola);
  const tA = await texto(A.p), tB = await texto(B.p);
  ok("X1_la_sesion_rechazada_lo_informa", /Otra sesión|ya fue registrado|ya tiene un registro/.test(tA + tB));
  ok("X1_sin_errores", A.errs.length === 0 && B.errs.length === 0, [...A.errs, ...B.errs]);
  await A.ctx.close(); await B.ctx.close();
}

// ── X2: la otra sesión tiene la pantalla desactualizada (no recargó) → la verificación con datos frescos no escribe ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.pago, "vendedor"); await preparar(B.p, K.pago, "vendedor");
  await A.p.locator("[data-registrar]").click(); await A.p.waitForTimeout(3000);
  const n0 = b.escr.length;
  await B.p.locator("[data-registrar]").click(); await B.p.waitForTimeout(2500);
  ok("X2_sesion_desactualizada_no_escribe", rpcs(b, n0) === 0 && filas(b, "pagos_vendedor").length === 1, b.escr.slice(n0).filter((w) => w.metodo !== "GET"));
  ok("X2_motivo_visible", /ya fue registrado|ya tiene un registro/.test(await texto(B.p)));
  await A.ctx.close(); await B.ctx.close();
}

// ── X3: doble clic (dos clics en el mismo instante, antes de que la pantalla se actualice) → una sola escritura ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b);
  await preparar(A.p, K.gasto, "gasto");
  const n0 = b.escr.length;
  await A.p.locator("[data-registrar]").evaluate((btn) => { btn.click(); btn.click(); btn.click(); });
  await A.p.waitForTimeout(3000);
  ok("X3_triple_clic_un_solo_intento_de_escritura", rpcs(b, n0) === 1 && filas(b, "gastos_indirectos").length === 1, rpcs(b, n0));
  ok("X3_sin_errores", A.errs.length === 0, A.errs);
  // Reimportación tras el registro: queda conciliado, no se vuelve a ofrecer y no escribe.
  const n1 = b.escr.length;
  await A.p.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  await A.p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await A.p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await A.p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([rHist, rLinea, rLinea]);
  await A.p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await A.p.waitForTimeout(400);
  ok("X3_reimportar_no_vuelve_a_proponer", (await A.p.locator(`[data-preparar="${K.gasto}"]`).count()) === 0
    && (await A.p.locator(`[data-mov="${K.gasto}"]`).first().getAttribute("data-estado")) !== "pendiente");
  ok("X3_reimportar_no_escribe", b.escr.slice(n1).filter((w) => w.metodo !== "GET").length === 0);
  await A.ctx.close();
}

// ── X4: retiro de capital desde dos sesiones a la vez → un solo retiro ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.retiro, "retiro"); await preparar(B.p, K.retiro, "retiro");
  await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
  await A.p.waitForTimeout(3500);
  const ap = filas(b, "aportes_socios");
  ok("X4_retiro_simultaneo_uno_solo", ap.length === 1 && ap[0].tipo === "retiro", ap);
  ok("X4_ningun_gasto", !b.escr.some((w) => w.tabla === "gastos_indirectos" && w.metodo === "POST"));
  await A.ctx.close(); await B.ctx.close();
}

// ── X5: cobro (abono) desde dos sesiones a la vez → un solo grupo de cobros ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  const hay = (await preparar(A.p, K.cobro, "cobro")) && (await preparar(B.p, K.cobro, "cobro"));
  if (!hay) ok("X5_cobro_hay_opcion_ficticia", false, "sin opción de abono en los datos ficticios");
  else {
    const n0 = b.escr.length;
    await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
    await A.p.waitForTimeout(3500);
    const ev = filas(b, "eventos_pago_cliente");
    ok("X5_cobro_simultaneo_un_solo_registro", ev.length >= 1 && new Set(ev.map((e) => e.marca_cartola)).size === 1, ev.map((e) => [e.id, e.marca_cartola]));
    ok("X5_cobro_monto_una_vez", ev.reduce((s, e) => s + Number(e.monto), 0) === 760000, ev.map((e) => e.monto));
    ok("X5_a_lo_mas_dos_intentos_uno_rechazado", rpcs(b, n0) <= 2);
  }
  await A.ctx.close(); await B.ctx.close();
}

// ── X6: tipo distinto con pantalla desactualizada (A: gasto · B: pago a vendedor) → B no escribe ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.gasto, "gasto"); await preparar(B.p, K.gasto, "vendedor");
  await A.p.locator("[data-registrar]").click(); await A.p.waitForTimeout(3000);
  const n0 = b.escr.length;
  await B.p.locator("[data-registrar]").click(); await B.p.waitForTimeout(2500);
  ok("X6_otro_tipo_sesion_desactualizada_no_escribe", b.escr.slice(n0).filter((w) => w.metodo !== "GET").length === 0 && filas(b, "pagos_vendedor").length === 0);
  await A.ctx.close(); await B.ctx.close();
}

// ── X7: tipos distintos EN EL MISMO INSTANTE (A: gasto · B: pago a vendedor) → la base acepta uno solo ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.gasto, "gasto"); await preparar(B.p, K.gasto, "vendedor");
  await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
  await A.p.waitForTimeout(3500);
  const n = filas(b, "gastos_indirectos").length + filas(b, "pagos_vendedor").length;
  ok("X7_tipos_distintos_simultaneos_uno_solo", n === 1, n);
  await A.ctx.close(); await B.ctx.close();
}

// Inserta un registro MANUAL justo antes de que la cartola llame a la base (la carrera que la pantalla no ve).
const manualAntesDeRpc = (b, tabla, fila) => {
  const orig = b.rpc; let hecho = false;
  b.rpc = (fn, cuerpo, yo) => { if (!hecho && /cartola/.test(fn)) { hecho = true; b.db[tabla].push({ creadoEn: "2026-10-11T12:00:00.000Z", ...fila }); } return orig(fn, cuerpo, yo); };
};
const pagoManual = { id: "pv_manual", vendedor_id: "v1", anio: 2026, mes: 8, monto_pagado: 480000, monto_extra_gestion: 0, monto_transferido: 480000, fecha: "2026-10-11", estado: "pagado", notas: "registro manual" };

// ── X8: BFK01 → la pantalla muestra el registro manual; «Es este registro» lo vincula sin crear nada ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b);
  await preparar(A.p, K.pago, "vendedor");
  manualAntesDeRpc(b, "pagos_vendedor", pagoManual);
  await A.p.locator("[data-registrar]").click();
  await A.p.locator("[data-duplicado-manual]").waitFor({ timeout: 8000 }).catch(() => {});
  ok("X8_bfk01_muestra_el_registro_manual", (await A.p.locator('[data-registro-manual="pv_manual"]').count()) === 1);
  ok("X8_nada_guardado_ni_preseleccionado", b.db.pagos_vendedor.filter((f) => f.monto_transferido === 480000).length === 1);
  await A.p.locator("[data-vincular]").click(); await A.p.waitForTimeout(3000);
  const pv = b.db.pagos_vendedor.filter((f) => f.monto_transferido === 480000);
  ok("X8_vincular_marca_el_manual_sin_crear_otro", pv.length === 1 && pv[0].id === "pv_manual" && pv[0].marca_cartola === "cart:20261012:480000:0:2519000:1", pv.map((f) => [f.id, f.marca_cartola]));
  ok("X8_sin_errores", A.errs.length === 0, A.errs);
  await A.ctx.close();
}

// ── X9: BFK01 → «Es otra operación» registra el pago de la cartola y deja el manual como está ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b);
  await preparar(A.p, K.pago, "vendedor");
  manualAntesDeRpc(b, "pagos_vendedor", pagoManual);
  await A.p.locator("[data-registrar]").click();
  await A.p.locator("[data-duplicado-manual]").waitFor({ timeout: 8000 }).catch(() => {});
  await A.p.locator("[data-distinto]").click(); await A.p.waitForTimeout(3000);
  const pv = b.db.pagos_vendedor.filter((f) => f.monto_transferido === 480000);
  ok("X9_confirmar_distinto_registra_y_conserva_el_manual", pv.length === 2 && pv.filter((f) => f.marca_cartola).length === 1 && !pv.find((f) => f.id === "pv_manual").marca_cartola, pv.map((f) => [f.id, f.marca_cartola]));
  await A.ctx.close();
}

// ── X10: registro MANUAL posterior a uno de cartola → alerta en el Panel; «Revisado» la quita ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b);
  await preparar(A.p, K.gasto, "gasto");
  await A.p.locator("[data-registrar]").click(); await A.p.waitForTimeout(3000);
  b.escribir("POST", "gastos_indirectos", new URLSearchParams(), { id: "gas_manual", categoria_id: "cat_otros", monto: 55000, mes: 10, anio: 2026, fecha: "2026-10-14", detalle: "registro manual" });
  ok("X10_manual_posterior_queda_alertado", /posible duplicado de cart:20261013:55000/.test(b.db.gastos_indirectos.find((g) => g.id === "gas_manual")?.alerta_cartola || ""));
  await A.p.reload(); await A.p.waitForTimeout(3500);
  await A.p.locator("[data-alertas-cartola]").waitFor({ timeout: 8000 }).catch(() => {});
  ok("X10_alerta_visible_en_el_panel", (await A.p.locator('[data-alerta="gas_manual"]').count()) === 1);
  await A.p.locator('[data-quitar-alerta="gas_manual"]').click(); await A.p.waitForTimeout(2500);
  ok("X10_revisado_quita_la_alerta", !b.db.gastos_indirectos.find((g) => g.id === "gas_manual").alerta_cartola && (await A.p.locator('[data-alerta="gas_manual"]').count()) === 0);
  await A.ctx.close();
}

// ── X12: devolución a financiador desde la cartola (FIFO global, función de la base) y reimportación ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  for (const S of [A, B]) {
    await S.p.locator(`[data-preparar="${K.retiro}"]`).click(); await S.p.waitForTimeout(200);
    await S.p.locator("[data-tipo-egreso]").selectOption("financiador"); await S.p.locator("[data-destino]").selectOption("f1");
    await S.p.waitForTimeout(150); await S.p.locator("[data-confirmo]").check(); await S.p.waitForTimeout(150);
  }
  await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
  await A.p.waitForTimeout(3500);
  const ev = filas(b, "eventos_pago_financiamiento");
  ok("X12_financiador_dos_sesiones_un_solo_pago", ev.length >= 1 && new Set(ev.map((e) => e.marca_cartola)).size === 1 && ev.reduce((s, e) => s + Number(e.monto), 0) === 260000, ev.map((e) => [e.oc_id, e.monto]));
  ok("X12_pagos_al_financiador_elegido", ev.every((e) => e.financiador_id === "f1"));
  ok("X12_devolucion_no_es_gasto", !b.db.gastos_indirectos.some((g) => g.marca_cartola));
  await A.ctx.close(); await B.ctx.close();
}

// ── X11: la aplicación activada antes que la base (función no instalada) → no registra nada y lo dice ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const orig = b.rpc; b.rpc = (fn, cuerpo, yo) => (/cartola/.test(fn) ? { status: 404, json: { code: "PGRST202", message: `Could not find the function public.${fn}` } } : orig(fn, cuerpo, yo));
  const A = await sesion(b);
  await preparar(A.p, K.gasto, "gasto");
  const n0 = b.escr.length;
  await A.p.locator("[data-registrar]").click(); await A.p.waitForTimeout(2500);
  ok("X11_sin_funcion_no_escribe_y_avisa", b.escr.slice(n0).filter((w) => w.metodo !== "GET").length === 0 && /aún no está activa/.test(await texto(A.p)));
  await A.ctx.close();
}

await browser.close();
console.log(`\nRESUMEN pruebas de concurrencia de la cartola: ${nOk} OK, ${F.length} FALLA(S)${F.length ? " · " + F.join(", ") : ""}`);
if (F.length) process.exitCode = 1;
