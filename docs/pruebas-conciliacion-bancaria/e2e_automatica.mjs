// Conciliación automática (22/10/2026), interfaz: referencias aprendidas de vínculos confirmados, propuestas con evidencia
// y lo que falta, «No corresponde» sobre lo reconocido automáticamente; nunca se registra solo. PC y celular.
// Supabase SIMULADO en memoria (nada sale a la red). Datos 100 % ficticios.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-conciliacion-bancaria/e2e_automatica.mjs http://127.0.0.1:4179/
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
const escriturasFinancieras = (b, desde) => b.escr.slice(desde).filter((w) => w.metodo !== "GET" && (FIN.includes(w.tabla) || /registrar_|cartola_vincular|eliminar_registro/.test(w.tabla)));

const S0 = 4999000;
const LINEA = [
  { fecha: "2026-10-16", op: "220622", desc: "ABONO PAGO A PROVEEDORES", abono: 91000 },
  { fecha: "2026-10-16", op: "7086746", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 16757 },
  { fecha: "2026-10-19", op: "7086800", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 45000 },
  { fecha: "2026-10-20", op: "220622", desc: "ABONO PAGO A PROVEEDORES", abono: 174199 },
  { fecha: "2026-10-22", op: "203999", desc: "ABONO PAGO A PROVEEDORES", abono: 71500 },
  { fecha: "2026-10-22", op: "7090000", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 200000 },
];
const saldos = []; { let s = S0; for (const m of LINEA) { s += (m.abono || 0) - (m.cargo || 0); saldos.push(s); } }
const CL = LINEA.map((m, i) => `${m.fecha}|${m.cargo || 0}|${m.abono || 0}|${saldos[i]}`);
const MARCA = LINEA.map((m, i) => `cart:${m.fecha.replace(/-/g, "")}:${m.cargo || 0}:${m.abono || 0}:${saldos[i]}:1`);
const rHist = escribe("ca_hist.xlsx", cartolaHistorica([{ fecha: "2026-10-01", op: "7000007", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 1000 }], { saldoInicial: 5000000, numero: 9 }));
const rLinea = escribe("ca_linea.xlsx", cartolaEnLinea(LINEA, { saldoInicial: S0 }));

const datos = () => {
  const d = crearDatos(); const base = d.ordenes_compra_v2[0];
  d.ordenes_compra_v2.push(
    { ...base, id: "om1", numero_oc: "1000-1-AG26", cliente: "I MUNICIPALIDAD DE MAULE", rut_cliente: "69.110.900-3", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", monto_facturado: 91000, monto_cobrado: 91000 },
    { ...base, id: "om2", numero_oc: "1000-2-AG26", cliente: "I MUNICIPALIDAD DE MAULE", rut_cliente: "69.110.900-3", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente", monto_facturado: 174199, monto_cobrado: 0 },
    { ...base, id: "obu", numero_oc: "3904-413-AG26", cliente: "I MUNICIPALIDAD DE BULNES", rut_cliente: "69.141.200-8", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente", monto_facturado: 71500, monto_cobrado: 0 });
  d.eventos_factura.push({ id: "fm1", oc_id: "om1", fecha: "2026-09-01", numero_factura: "901", monto: 91000 }, { id: "fm2", oc_id: "om2", fecha: "2026-10-01", numero_factura: "902", monto: 174199 },
    { id: "fbu", oc_id: "obu", fecha: "2026-06-01", numero_factura: "190", monto: 71500 });
  d.eventos_pago_cliente.push({ id: "c_m1", oc_id: "om1", fecha: "2026-10-16", monto: 91000, medio_pago: "transferencia", cobrado_en_banco: true });
  d.gastos_indirectos.push(
    { id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 16757, mes: 10, anio: 2026, fecha: "2026-10-15", detalle: null },
    { id: "g_iva2", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 45000, mes: 10, anio: 2026, fecha: "2026-10-19", detalle: null });
  return d;
};
// Decisiones ya confirmadas por el usuario (auditables), y la misma regla de la base para nuevas.
function conDecisiones(b) {
  let seq = 10; const D = b.db.conciliacion_decisiones = [
    { id: 1, marca: MARCA[0], decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_m1", mov_operacion: "220622", mov_descripcion: "ABONO PAGO A PROVEEDORES", usuario_nombre: "Usuario Prueba", creado_en: "2026-10-21T12:00:00Z", anulado_en: null },
    { id: 2, marca: MARCA[1], decision: "vinculado", tabla: "gastos_indirectos", registro_id: "g_iva", mov_operacion: "7086746", mov_descripcion: "TEF A GESTION EMPRESARIAL AM LIMITA", usuario_nombre: "Usuario Prueba", creado_en: "2026-10-21T12:00:00Z", anulado_en: null }];
  const rpc0 = b.rpc;
  b.rpc = (fn, body, yo, interno) => {
    if (fn === "conciliacion_decidir") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: JSON.parse(JSON.stringify(body)), n: b.escr.length });
      if (body.p_decision === "vinculado" && D.some((x) => !x.anulado_en && x.decision === "vinculado" && (x.marca === body.p_marca || (x.tabla === body.p_tabla && body.p_ids.includes(x.registro_id)))))
        return { status: 409, json: { code: "23505", message: 'duplicate key value violates unique constraint "conc_dec_registro_vinculado"' } };
      for (const id of body.p_ids) D.push({ id: ++seq, marca: body.p_marca, decision: body.p_decision, tabla: body.p_tabla, registro_id: id, mov_operacion: body.p_operacion, mov_descripcion: body.p_descripcion, usuario_nombre: "Usuario Prueba", creado_en: "2026-10-22T12:00:00Z", anulado_en: null });
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
const enGrupo = async (p, g, i) => (await p.locator(`[data-grupo-seccion="${g}"] [data-mov="${CL[i]}"]`).count()) === 1;
const texto = (p, i) => p.locator(`[data-mov="${CL[i]}"]`).first().innerText();

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  const b = conDecisiones(crearBase(datos(), { mp: RESPUESTAS_MP }));
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
  await abrirCartola(p);
  const h0 = huella(b), n0 = b.escr.length;

  // Por defecto solo lo pendiente; lo reconocido no se muestra.
  ok(`${X}01_por_defecto_sin_conciliados`, (await p.locator('[data-grupo-seccion="ya"]').count()) === 0);
  // Siguiente pago de Maule con la misma referencia ya confirmada → propuesta con pagador identificado, sin registrar.
  const t3 = await texto(p, 3);
  ok(`${X}02_referencia_confirmada_identifica_al_pagador`, await enGrupo(p, "sin-registrar", 3) && /pagador identificado/.test(t3) && /1000-2-AG26/.test(t3) && /Evidencia/.test(t3), t3);
  // Bulnes: factura de $71.500 propuesta, pero la glosa no identifica al pagador → se explica qué falta.
  const t4 = await texto(p, 4);
  ok(`${X}03_bulnes_propuesta_sin_pagador_identificado`, await enGrupo(p, "sin-registrar", 4) && /3904-413-AG26/.test(t4) && /Falta/.test(t4) && !/pagador identificado/.test(t4), t4);
  // Gestión Empresarial AM $200.000: no se ofrece ningún registro antiguo; se muestra el antecedente como tal.
  const t5 = await texto(p, 5);
  ok(`${X}04_geam_200000_sin_registro_y_con_antecedente`, await enGrupo(p, "sin-registrar", 5) && /No hay ningún registro BFK de \$200\.000/.test(t5) && /Antecedentes/.test(t5) && (await p.locator(`[data-mov="${CL[5]}"] [data-vincular-registro]`).count()) === 0, t5);
  ok(`${X}05_nada_preseleccionado_ni_registrado`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0);
  await p.screenshot({ path: process.env.SALIDA ? path.join(process.env.SALIDA, `automatica_${X}_pendientes.png`) : `/tmp/automatica_${X}_pendientes.png`, fullPage: !movil });

  // IVA a Gestión Empresarial AM igual a un gasto IVA → Ya registrado (aprendido), con «No corresponde».
  await p.locator("[data-ver-conciliados]").click(); await espera(p, 400);
  ok(`${X}06_iva_reconocido_automaticamente`, await enGrupo(p, "ya", 2) && (await p.locator(`[data-mov="${CL[2]}"] [data-no-corresponde-auto]`).count()) === 1);
  await p.locator(`[data-mov="${CL[2]}"]`).first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: process.env.SALIDA ? path.join(process.env.SALIDA, `automatica_${X}_reconocido.png`) : `/tmp/automatica_${X}_reconocido.png` });
  await p.locator(`[data-mov="${CL[2]}"] [data-no-corresponde-auto]`).click(); await espera(p, 1500);
  const rpc = b.escr.slice(n0).filter((w) => w.tabla === "conciliacion_decidir");
  ok(`${X}07_no_corresponde_guarda_un_rechazo_y_vuelve_a_revision`, rpc.length === 1 && rpc[0].cuerpo.p_decision === "rechazado" && rpc[0].cuerpo.p_ids.join() === "g_iva2" && !(await enGrupo(p, "ya", 2)), rpc.map((w) => w.cuerpo));
  ok(`${X}08_sin_escrituras_financieras_huella_intacta`, escriturasFinancieras(b, n0).length === 0 && huella(b) === h0);
  ok(`${X}09_sin_desborde_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok(`${X}10_sin_errores_js`, errs.length === 0, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN conciliación automática (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
