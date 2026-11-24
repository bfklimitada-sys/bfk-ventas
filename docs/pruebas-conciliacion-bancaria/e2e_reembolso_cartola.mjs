// Cartola: el abono del proveedor por una compra de venta privada anulada se reconoce como REEMBOLSO (24/11/2026).
// PC y celular, Supabase SIMULADO (nada sale a la red). Datos ficticios: compra en Falabella que no llegó, anulada con reembolso.
//  · El abono de Falabella por el mismo monto aparece «Por revisar» con «Reembolso de compra anulada» (nunca se confirma solo).
//  · «Es este registro» guarda el reembolso recibido con la marca del abono (vp_registrar_reembolso), sin decisión de
//    conciliación, sin ingresos ni gastos nuevos → el movimiento pasa a «Ya registrado».
//  · «No corresponde» no guarda nada.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-conciliacion-bancaria/e2e_reembolso_cartola.mjs http://127.0.0.1:4179/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import os from "node:os";
import path from "node:path";
import { cartolaEnLinea } from "./cartolas_sinteticas.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);
const escribe = (nombre, wb) => { const r = path.join(os.tmpdir(), nombre); XLSX.writeFile(wb, r); return r; };

const COMPRA = { id: "k-falabella", venta_id: "v-1", origen: "registro", gasto_id: null, proveedor: "Falabella", total: 119000, documento_tipo: "factura",
  estado: "anulada", anulada_en: "2026-11-05T13:00:00Z", reembolso_estado: "pendiente", reembolso_monto: 119000, reembolso_fecha: null, reembolso_marca: null };
const datos = () => { const d = crearDatos(); d.vp_compras = [structuredClone(COMPRA)]; return d; };
const LINEA = [
  { fecha: "2026-11-09", op: "9101", desc: "ABONO FALABELLA RETAIL S.A.", abono: 119000 },
  { fecha: "2026-11-10", op: "9102", desc: "TEF A PROVEEDOR UNO", cargo: 25000 },
];
const archivo = escribe("reembolso_linea.xlsx", cartolaEnLinea(LINEA, { saldoInicial: 2000000 }));

// vp_registrar_reembolso simulado con las reglas de la base (marca única; solo un reembolso pendiente).
function conReembolso(b) {
  const llamadas = []; const rpc0 = b.rpc;
  b.rpc = (fn, cuerpo, yo, interno) => {
    if (fn !== "vp_registrar_reembolso") return rpc0(fn, cuerpo, yo, interno);
    llamadas.push(cuerpo);
    const k = (b.db.vp_compras || []).find((x) => x.id === cuerpo.p_compra);
    if (!k || k.reembolso_estado !== "pendiente") return { status: 400, json: { code: "23514", message: "VP_ESTADO: esta compra no tiene un reembolso esperado" } };
    if ((b.db.vp_compras || []).some((x) => x.reembolso_marca === cuerpo.p_marca)) return { status: 409, json: { code: "23505", message: "VP_DUPLICADO" } };
    Object.assign(k, { reembolso_estado: "recibido", reembolso_fecha: cuerpo.p_fecha, reembolso_monto: Math.round(cuerpo.p_monto), reembolso_marca: cuerpo.p_marca });
    b.escr.push({ tabla: "rpc/vp_registrar_reembolso", metodo: "POST", cuerpo });
    return { status: 200, json: { id: k.id, reembolso: "recibido", marca: cuerpo.p_marca } };
  };
  return llamadas;
}
async function cargar(p) {
  await p.getByRole("button", { name: /^Cartola$/ }).first().click();
  await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
  await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles([archivo]);
  await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 1200);
}
const escrituras = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo !== "GET");
const movFalabella = (p) => p.locator('[data-mov]').filter({ hasText: "FALABELLA" }).first();

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  const b = crearBase(datos(), { mp: RESPUESTAS_MP }); const llamadas = conReembolso(b);
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
  await cargar(p);
  const m = movFalabella(p);
  ok(`${X}01_abono_por_revisar`, (await m.getAttribute("data-estado")) === "posible", await m.getAttribute("data-estado"));
  await m.click(); await espera(p, 400);
  const t = await m.innerText();
  ok(`${X}02_propone_el_reembolso_con_el_proveedor`, /Reembolso de compra anulada/.test(t) && /Falabella/i.test(t) && /\$119\.000/.test(t), t);
  ok(`${X}03_evidencia_proveedor_en_glosa`, /proveedor del reembolso aparece en el detalle del banco/.test(t), t);
  const n0 = b.escr.length;
  await m.locator(`[data-rechazar="${COMPRA.id}"]`).click(); await espera(p, 600);
  ok(`${X}04_no_corresponde_no_guarda_nada`, escrituras(b, n0).length === 0 && llamadas.length === 0 && /se siguen proponiendo/.test(await p.locator("[data-cartola-conciliacion]").innerText()));
  await m.locator(`[data-vincular-registro="${COMPRA.id}"]`).click(); await espera(p, 2500);
  ok(`${X}05_registra_el_reembolso_con_la_marca_del_abono`, llamadas.length === 1 && /^cart:20261109:0:119000:/.test(llamadas[0].p_marca) && llamadas[0].p_monto === 119000 && llamadas[0].p_fecha === "2026-11-09", llamadas);
  const w = escrituras(b, n0).map((x) => x.tabla);
  ok(`${X}06_sin_decision_ni_ingresos_ni_gastos_nuevos`, w.length === 1 && w[0] === "rpc/vp_registrar_reembolso", w);
  ok(`${X}07_compra_queda_reembolsada`, b.db.vp_compras[0].reembolso_estado === "recibido");
  await espera(p, 1000);
  const est = await p.locator('[data-mov]').filter({ hasText: "FALABELLA" }).first().getAttribute("data-estado").catch(() => null);
  if (est !== "conciliado") { const ver = p.locator("[data-ver-conciliados]"); if (await ver.count()) { await ver.click(); await espera(p, 300); } }
  ok(`${X}08_el_movimiento_pasa_a_ya_registrado`, (await p.locator('[data-mov]').filter({ hasText: "FALABELLA" }).first().getAttribute("data-estado")) === "conciliado");
  ok(`${X}09_sin_desborde_y_sin_errores`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1) && errs.length === 0, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN e2e_reembolso_cartola: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
