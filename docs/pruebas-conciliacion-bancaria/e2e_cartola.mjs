// Pruebas de interfaz de la cartola (Etapas 1 a 3). Chromium + Playwright con Supabase SIMULADO en memoria (mock de la
// Fase 4A): nada sale a la red y cada escritura queda registrada. Datos 100 % ficticios.
// Uso: node docs/pruebas-conciliacion-bancaria/e2e_cartola.mjs http://127.0.0.1:4179/   (build servido con vite preview)
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cartolaEnLinea, cartolaHistorica } from "./cartolas_sinteticas.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, detalle) => { if (!v) { F.push(k); console.log("FALLA " + k + (detalle !== undefined ? " :: " + JSON.stringify(detalle).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const escritorio = { ancho: 1440, alto: 900, movil: false };
const FINANCIERAS = ["eventos_pago_cliente", "eventos_pago_financiamiento", "pagos_vendedor", "gastos_indirectos", "aportes_socios", "ordenes_compra_v2", "ajustes_saldo_financiador"];
const escriturasFinancieras = (b, desde = 0) => b.escr.slice(desde).filter((w) => w.metodo !== "GET" && (FINANCIERAS.includes(w.tabla) || w.tabla === "rpc"));
const escribe = (nombre, wb) => { const r = path.join(os.tmpdir(), nombre); XLSX.writeFile(wb, r); return r; };

// Personas con dos palabras distintivas en el nombre (así la glosa del banco se reconoce como en producción).
const datos = () => {
  const d = crearDatos();
  d.vendedores[0].nombre = "Luis Ejemplo Soto"; d.financiadores[0].nombre = "Ana Ficticia Rojas";
  d.financiadores[1].tipo = "propio";
  d.categorias_gasto.push({ id: "cat_gratificacion", nombre: "Gratificación" }, { id: "cat_apoyo_gestion", nombre: "Apoyo en gestión y actualización de datos" });
  d.gastos_indirectos.push({ id: "g_agu", categoria_id: "cat_gratificacion", monto: 190000, mes: 9, anio: 2026, fecha: "2026-09-30", detalle: "Aguinaldo Luis Ejemplo", subcategoria: null });
  return d;
};
// Cartolas ficticias: histórica (anterior al cierre) y en línea (posterior), que empalman por saldo.
const hist = [
  { fecha: "2026-09-26", op: "7000005", desc: "TEF A PROVEEDOR FICTICIO XYZ", cargo: 77000 },
  { fecha: "2026-10-01", op: "7000007", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 190000 },
  { fecha: "2026-10-02", op: "8812", desc: "TEF DE CLIENTE DESCONOCIDO", abono: 410003 },
];
const linea = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-13", op: "7000010", desc: "TEF A FICTICIA ROJAS ANA", cargo: 260000 },
];
const rHist = escribe("e2e_hist.xlsx", cartolaHistorica(hist, { saldoInicial: 3000000, numero: 6 }));
const rHist2 = escribe("e2e_hist_otra_descarga.xlsx", cartolaHistorica(hist, { saldoInicial: 3000000, numero: 6 }));
const rLinea = escribe("e2e_linea.xlsx", cartolaEnLinea(linea, { saldoInicial: 3143003 }));
const rHueco = escribe("e2e_hueco.xlsx", cartolaEnLinea([{ fecha: "2026-10-13", op: "7000020", desc: "TEF DE OTRO", abono: 1000 }], { saldoInicial: 5 }));
const rotaWb = cartolaHistorica(hist, { saldoInicial: 3000000, totalesMal: true });
const rRota = escribe("e2e_rota.xlsx", rotaWb);

async function abrirCartola(p, archivos) {
  await p.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});   // el registro anterior cierra la ventana y recarga
  await p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles(archivos);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 500);
}
const estado = (p, clave) => p.locator(`[data-mov="${clave}"]`).first().getAttribute("data-estado");

// ── E1: cargar y consultar no escribe nada; deduplica; muestra todo; nada preseleccionado ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const n0 = b.escr.length;
  await abrirCartola(p, [rHist, rHist2, rLinea]);
  const nMov = await p.locator("[data-mov]").count();
  ok("E1_muestra_todos_los_movimientos_sin_duplicar", nMov === 5, nMov);
  ok("E1_informa_duplicados", /no se cuentan dos veces/.test(await p.locator("[data-duplicados]").innerText().catch(() => "")));
  ok("E1_aguinaldo_conciliado_con_su_registro", (await estado(p, "2026-10-01|190000|0|2733000")) === "conciliado");
  ok("E1_cobro_desconocido_pendiente_visible_y_no_registrable", (await estado(p, "2026-10-02|0|410003|3143003")) === "pendiente" && (await p.locator('[data-preparar="2026-10-02|0|410003|3143003"]').count()) === 0);
  ok("E1_egreso_anterior_al_cierre_no_registrable", (await p.locator('[data-preparar="2026-09-26|77000|0|2923000"]').count()) === 0);
  ok("E1_posteriores_al_cierre_registrables", (await p.locator("[data-preparar]").count()) === 2);
  await p.locator('[data-preparar="2026-10-12|480000|0|2663003"]').click(); await espera(p, 300);
  ok("E1_nada_preseleccionado", (await p.locator("[data-tipo-egreso]").inputValue()) === "" && (await p.locator("[data-registrar]").isDisabled()));
  await p.locator("[data-tipo-egreso]").selectOption("vendedor"); await p.locator("[data-destino]").selectOption("v1"); await espera(p, 200);
  ok("E1_sin_confirmacion_no_se_puede_registrar", await p.locator("[data-registrar]").isDisabled());
  ok("E1_confirmacion_resume_lo_que_se_escribira", /Pago a Luis Ejemplo Soto por \$480\.000/.test(await p.locator("[data-confirmacion]").innerText()));
  for (const f of ["conciliado", "posible", "pendiente", "neutro"]) { await p.locator(`[data-filtro="${f}"]`).click(); await espera(p, 150); await p.locator(`[data-filtro="${f}"]`).click(); }
  ok("E1_consultar_no_escribe_nada", escriturasFinancieras(b, n0).length === 0 && b.escr.slice(n0).filter((w) => w.metodo !== "GET").length === 0, b.escr.slice(n0).filter((w) => w.metodo !== "GET"));
  ok("E1_totales_requieren_confirmacion", await p.locator("[data-guardar-totales]").isDisabled());
  ok("E1_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

// ── E2: registro con confirmación explícita: UN pago, con la operación bancaria; al reimportar queda conciliado ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await abrirCartola(p, [rHist, rLinea]);
  const n0 = b.escr.length;
  await p.locator('[data-preparar="2026-10-12|480000|0|2663003"]').click(); await espera(p, 300);
  await p.locator("[data-tipo-egreso]").selectOption("vendedor"); await p.locator("[data-destino]").selectOption("v1");
  await p.locator("[data-mes-comision]").selectOption("8"); await p.locator("[data-anio-comision]").fill("2026"); await espera(p, 200);
  await p.locator("[data-confirmo]").check(); await espera(p, 150);
  await p.locator("[data-registrar]").click(); await espera(p, 3000);
  const w = escriturasFinancieras(b, n0);
  const pv = w.filter((x) => x.tabla === "pagos_vendedor" && x.metodo === "POST");
  ok("E2_un_solo_pago_registrado", pv.length === 1 && w.filter((x) => x.tabla !== "pagos_vendedor" && x.tabla !== "ordenes_compra_v2").length === 0, w.map((x) => [x.metodo, x.tabla]));
  const fila = Array.isArray(pv[0]?.cuerpo) ? pv[0].cuerpo[0] : pv[0]?.cuerpo;
  ok("E2_pago_con_total_y_operacion_bancaria", fila && Number(fila.monto_transferido) === 480000 && fila.referencia_bancaria === "8811" && Number(fila.mes) === 8 && fila.fecha === "2026-10-12", fila);
  await abrirCartola(p, [rHist, rLinea, rHist]);
  ok("E2_reimportado_queda_conciliado_y_no_se_vuelve_a_proponer", (await estado(p, "2026-10-12|480000|0|2663003")) === "conciliado" && (await p.locator('[data-preparar="2026-10-12|480000|0|2663003"]').count()) === 0);
  ok("E2_reimportar_no_escribe", escriturasFinancieras(b, n0).length === w.length);
  ok("E2_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

// ── E3: retiro de capital desde la cartola: se registra como capital, nunca como gasto ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await abrirCartola(p, [rHist, rLinea]);
  const n0 = b.escr.length;
  await p.locator('[data-preparar="2026-10-13|260000|0|2403003"]').click(); await espera(p, 300);
  await p.locator("[data-tipo-egreso]").selectOption("retiro"); await p.locator("[data-socio]").fill("Ana Ficticia Rojas"); await espera(p, 200);
  ok("E3_confirmacion_dice_que_no_es_gasto", /no es gasto/.test(await p.locator("[data-confirmacion]").innerText()));
  await p.locator("[data-confirmo]").check(); await p.locator("[data-registrar]").click(); await espera(p, 2500);
  const w = escriturasFinancieras(b, n0);
  const ap = w.find((x) => x.tabla === "aportes_socios" && x.metodo === "POST");
  const filaAp = Array.isArray(ap?.cuerpo) ? ap.cuerpo[0] : ap?.cuerpo;
  ok("E3_retiro_en_aportes_socios", filaAp && filaAp.tipo === "retiro" && Number(filaAp.monto) === 260000 && filaAp.medio === "Transferencia BancoEstado", filaAp);
  ok("E3_ningun_gasto_registrado", !w.some((x) => x.tabla === "gastos_indirectos"));
  ok("E3_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

// ── E4: cartola faltante y cartola con error: se avisa y no se usa ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const n0 = b.escr.length;
  await abrirCartola(p, [rHist, rHueco, rRota]);
  ok("E4_aviso_de_cartola_faltante", /Falta\(n\) cartola\(s\)/.test(await p.locator("[data-cartolas-faltantes]").innerText().catch(() => "")));
  ok("E4_cartola_con_error_rechazada", (await p.locator('[data-archivo="rechazado"]').count()) === 1);
  ok("E4_solo_movimientos_validos", (await p.locator("[data-mov]").count()) === 4);
  ok("E4_no_escribe", b.escr.slice(n0).filter((w) => w.metodo !== "GET").length === 0);
  ok("E4_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

// ── E5: Panel y Gastos (Etapa 3): informe financiero, margen comercial y apoyo en gestión ──
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const t = await p.evaluate(() => document.body.innerText);
  ok("E5_informe_financiero_visible", /Informe financiero/i.test(t) && /Resultado del mes/.test(t) && /F29 por período/.test(t) && /Financiadores: deuda y devoluciones/.test(t));
  ok("E5_margen_comercial_renombrado", /Margen comercial del mes/i.test(t) && !/Utilidad del mes/i.test(t));
  ok("E5_caja_y_fuera_del_banco", /Registrado fuera de BancoEstado/.test(t));
  await p.locator('aside [data-nav="gastos"]').click().catch(() => {}); await espera(p, 800);
  ok("E5_apoyo_en_gestion_en_gastos", /Apoyo en gestión/.test(await p.evaluate(() => document.body.innerText)));
  ok("E5_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
console.log(`\nRESUMEN pruebas de interfaz de la cartola: ${nOk} OK, ${F.length} FALLA(S)${F.length ? " · " + F.join(", ") : ""}`);
if (F.length) process.exitCode = 1;
