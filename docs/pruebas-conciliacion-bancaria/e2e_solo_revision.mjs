// Cartolas que no cuadran → «Solo revisión» (22/10/2026): se consultan, pero no se registra, concilia ni guarda nada.
// PC y celular, Supabase SIMULADO (nada sale a la red). Datos 100 % ficticios (réplica del caso real de $910.000).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-conciliacion-bancaria/e2e_solo_revision.mjs http://127.0.0.1:4179/
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
const conResumen = (wb, clave, valor) => { const f = XLSX.utils.sheet_to_json(wb.Sheets.Resumen, { header: 1, defval: "" }); for (const x of f) if (String(x[0]).trim() === clave) x[4] = valor; wb.Sheets.Resumen = XLSX.utils.aoa_to_sheet(f); return wb; };
const pesosL = (v) => "$ " + v.toLocaleString("es-CL");

const datos = () => { const d = crearDatos(); d.vendedores[0].nombre = "Luis Ejemplo Soto"; d.financiadores[1].tipo = "propio"; d.categorias_gasto.push({ id: "cat_otros", nombre: "Otros gastos" }); return d; };
const HIST = [{ fecha: "2026-09-26", op: "7000005", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 77000 }, { fecha: "2026-10-01", op: "7000006", desc: "TEF DE CLIENTE ANTIGUO", abono: 50000 }];
const LINEA = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-14", op: "8813", desc: "TEF A PROVEEDOR UNO", cargo: 250000 },
  { fecha: "2026-10-16", op: "8815", desc: "TEF DE 70000000-1 UNIVERSIDAD FICTICIA", abono: 800799 },
  { fecha: "2026-10-17", op: "8817", desc: "TEF A DESCONOCIDO", cargo: 33333 },
  { fecha: "2026-10-20", op: "8819", desc: "DEPOSITO CON DOCUMENTOS", abono: 910005 },
  { fecha: "2026-10-21", op: "0", desc: "OTROS ABONOS", abono: 183302 },
];
const S0 = 3000000 - 77000 + 50000, SF = LINEA.reduce((s, m) => s + (m.abono || 0) - (m.cargo || 0), S0);
const rHist = escribe("sr_hist.xlsx", cartolaHistorica(HIST, { saldoInicial: 3000000, numero: 9, desde: "2026-09-25", hasta: "2026-10-01" }));
const rMal = escribe("sr_linea_no_cuadra.xlsx", conResumen(cartolaEnLinea(LINEA, { saldoInicial: S0 }), "Saldo Contable", pesosL(SF - 910000)));
const rOK = escribe("sr_linea_corregida.xlsx", cartolaEnLinea(LINEA, { saldoInicial: S0 }));
const wbOm = cartolaEnLinea(LINEA, { saldoInicial: S0 });
{ const f = XLSX.utils.sheet_to_json(wbOm.Sheets.Registros, { header: 1, defval: "" }).filter((x) => !String(x[2]).endsWith("8813")); wbOm.Sheets.Registros = XLSX.utils.aoa_to_sheet(f); }
const rOmit = escribe("sr_linea_omitido.xlsx", wbOm);

async function cargar(p, archivos, otra = false) {
  if (!otra) {
    await p.getByRole("button", { name: /^Cartola$/ }).first().click();
    await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
    await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles(archivos);
  } else await p.locator("[data-cartola-conciliacion] input[type=file]").setInputFiles(archivos);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 700);
}
const escrituras = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo !== "GET");
const ACCIONES = "[data-preparar],[data-vincular-registro],[data-rechazar],[data-rechazar-todos],[data-registrar],[data-deshacer-vinculo],[data-guardar-totales],[data-confirmar-totales]";

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  // R1. Solo la cartola que no cuadra: se consulta todo; ninguna acción; nada se escribe.
  {
    const b = crearBase(datos(), { mp: RESPUESTAS_MP });
    const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
    const n0 = b.escr.length;
    await cargar(p, [rMal]);
    const t = await p.locator("[data-cartola-conciliacion]").innerText();
    ok(`${X}R01_archivo_marcado_solo_revision`, (await p.locator('[data-archivo="solo-revision"]').count()) === 1 && /no cuadra · Solo revisión/.test(t));
    ok(`${X}R02_aviso_claro`, /Una cartola no cuadra: quedaron en «Solo revisión»/.test(t) && /no se registra, no se concilia ni se guardan saldos/.test(t) && /Descarga la cartola de nuevo más tarde/.test(t));
    const diag = await p.locator("[data-solo-revision] [data-diagnostico]").innerText();
    ok(`${X}R03_diferencia_explicada_sin_suponer_operaciones`, /Diferencia: \$910\.000/.test(diag) && /no coincide con el saldo del último movimiento/.test(diag) && !/8811|8813|8815|8817|8819/.test(diag), diag);
    ok(`${X}R04_sin_acciones_ni_conciliacion`, (await p.locator(ACCIONES).count()) === 0 && (await p.locator("[data-contador]").count()) === 0 && (await p.locator("[data-sin-conciliacion]").count()) === 1);
    await p.locator("[data-ver-movimientos-revision]").click(); await espera(p, 300);
    const mv = await p.locator("[data-movimientos-revision]").innerText();
    ok(`${X}R05_movimientos_consultables_con_fecha_monto_y_operacion`, (await p.locator("[data-mov-revision]").count()) === LINEA.length && /12\/10\/26 · op\. 8811 · TEF A EJEMPLO SOTO LUIS/.test(mv) && /\$910\.005/.test(mv), mv.slice(0, 300));
    ok(`${X}R06_ver_movimientos_no_habilita_acciones`, (await p.locator(ACCIONES).count()) === 0);
    ok(`${X}R07_no_se_escribe_nada`, escrituras(b, n0).length === 0, escrituras(b, n0).map((w) => w.tabla));
    ok(`${X}R08_sin_desborde_y_sin_errores`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1) && errs.length === 0, errs);
    await p.screenshot({ path: process.env[`CAPTURA_R1_${X}`] || `/tmp/solo_revision_${X}.png`, fullPage: false });
    await ctx.close();
  }
}

// R2. Correctos e incorrectos juntos, y corrección posterior (PC).
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  const n0 = b.escr.length;
  await cargar(p, [rHist, rMal]);
  const t = await p.locator("[data-cartola-conciliacion]").innerText();
  ok("R09_mezcla_separada", (await p.locator('[data-archivo="ok"]').count()) === 1 && (await p.locator('[data-archivo="solo-revision"]').count()) === 1 && /usa solo los archivos que sí cuadran/.test(t));
  await p.locator("[data-ver-conciliados]").click(); await espera(p, 200);
  if (await p.locator("[data-ver-anteriores]").count()) { await p.locator("[data-ver-anteriores]").click(); await espera(p, 200); }
  const claves = await p.locator("[data-mov]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mov")));
  ok("R10_la_conciliacion_usa_solo_la_cartola_valida", claves.length === HIST.length && claves.every((k) => k < "2026-10-02"), claves);
  ok("R11_sin_registrar_ni_guardar_totales", (await p.locator("[data-preparar]").count()) === 0 && (await p.locator("[data-guardar-totales]").count()) === 0 && (await p.locator("[data-totales-bloqueados]").count()) === 1);
  ok("R12_no_se_escribe_nada", escrituras(b, n0).length === 0);
  // Corrección: se agrega la cartola corregida del mismo período → se revalida todo y se habilita lo que corresponde.
  await cargar(p, [rOK], true);
  const pre = await p.locator("[data-preparar]").count();
  ok("R13_cartola_corregida_habilita_acciones_validadas", pre === LINEA.length && (await p.locator('[data-archivo="ok"]').count()) === 2, pre);
  ok("R14_la_que_no_cuadra_sigue_en_revision_y_los_totales_bloqueados", (await p.locator("[data-solo-revision]").count()) === 1 && (await p.locator("[data-guardar-totales]").count()) === 0);
  ok("R15_corregir_no_escribe_nada_por_si_solo", escrituras(b, n0).length === 0);
  // Empezar de nuevo solo con archivos que cuadran: sin avisos y con todo habilitado.
  await p.getByRole("button", { name: "Empezar de nuevo" }).click(); await espera(p, 300);
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([rHist, rOK]); await p.locator("[data-cartola-conciliacion]").waitFor(); await espera(p, 700);
  ok("R16_solo_validos_sin_aviso_y_totales_habilitados", (await p.locator("[data-aviso-solo-revision]").count()) === 0 && (await p.locator("[data-confirmar-totales]").count()) === 1 && (await p.locator("[data-preparar]").count()) === LINEA.length);
  ok("R17_sin_errores", errs.length === 0, errs);
  await p.screenshot({ path: process.env.CAPTURA_R2 || "/tmp/solo_revision_mezcla.png", fullPage: false });
  await ctx.close();
}

// R3. Movimiento omitido dentro del archivo: se marca dónde salta el saldo (PC).
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await cargar(p, [rHist, rOmit]);
  const diag = await p.locator("[data-solo-revision] [data-diagnostico]").innerText();
  ok("R18_movimiento_omitido_diagnosticado", /el saldo baja \$250\.000 sin un movimiento que lo explique/.test(diag) && /16\/10\/2026/.test(diag), diag);
  await p.locator("[data-ver-movimientos-revision]").click(); await espera(p, 300);
  ok("R19_salto_marcado_en_la_lista", (await p.locator("[data-salto]").count()) === 1 && (await p.locator("[data-mov-revision]").count()) === LINEA.length - 1);
  ok("R20_sin_acciones_para_la_cartola_omitida", (await p.locator('[data-preparar*="2026-10-"]').count()) === 0 && errs.length === 0, errs);
  await p.screenshot({ path: process.env.CAPTURA_R3 || "/tmp/solo_revision_omitido.png", fullPage: false });
  await ctx.close();
}

await browser.close();
console.log(`\nRESUMEN cartolas en solo revisión (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
