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
const filas = (b, tabla) => (b.db[tabla] || []).filter((f) => String(f.id).includes("_cart_"));
const posts = (b, tabla, desde) => b.escr.slice(desde).filter((w) => w.tabla === tabla && w.metodo === "POST").length;
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
  ok("X1_id_derivado_del_movimiento", pv[0]?.id === "pv_cart_20261012_480000_0_2519000_1", pv[0]?.id);
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
  ok("X2_sesion_desactualizada_no_escribe", posts(b, "pagos_vendedor", n0) === 0 && filas(b, "pagos_vendedor").length === 1, b.escr.slice(n0).filter((w) => w.metodo !== "GET"));
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
  ok("X3_triple_clic_un_solo_intento_de_escritura", posts(b, "gastos_indirectos", n0) === 1 && filas(b, "gastos_indirectos").length === 1, posts(b, "gastos_indirectos", n0));
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
    ok("X5_cobro_simultaneo_un_solo_registro", ev.length >= 1 && new Set(ev.map((e) => e.id.split("-")[0])).size === 1 && ev.every((e) => e.id.endsWith("-1") || /-\d+$/.test(e.id)), ev.map((e) => e.id));
    ok("X5_cobro_monto_una_vez", ev.reduce((s, e) => s + Number(e.monto), 0) === 760000, ev.map((e) => e.monto));
    ok("X5_a_lo_mas_dos_intentos_uno_rechazado", posts(b, "eventos_pago_cliente", n0) <= 2);
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

// ── R1 (informativo, límite conocido): tipos distintos EN EL MISMO INSTANTE. Sin cambio en la base no hay garantía. ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const A = await sesion(b), B = await sesion(b);
  await preparar(A.p, K.gasto, "gasto"); await preparar(B.p, K.gasto, "vendedor");
  await Promise.all([A.p.locator("[data-registrar]").click(), B.p.locator("[data-registrar]").click()]);
  await A.p.waitForTimeout(3500);
  const n = filas(b, "gastos_indirectos").length + filas(b, "pagos_vendedor").length;
  console.log(`INFO  R1_tipos_distintos_simultaneos: ${n} registro(s) ${n > 1 ? "→ DUPLICADO POSIBLE (límite conocido, requiere cambio en la base)" : "(esta vez la verificación alcanzó a bloquear)"}`);
  await A.ctx.close(); await B.ctx.close();
}

await browser.close();
console.log(`\nRESUMEN pruebas de concurrencia de la cartola: ${nOk} OK, ${F.length} FALLA(S)${F.length ? " · " + F.join(", ") : ""}`);
if (F.length) process.exitCode = 1;
