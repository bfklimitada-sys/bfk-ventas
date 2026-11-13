// Compara, con los DATOS REALES de una copia restaurada (vía PostgREST), los cálculos de la versión anterior (main 9a7adcb)
// y de la nueva (F29 con desglose): comisiones de cada vendedor y mes, F29 por período, compromisos y resumen de Caja,
// resultado mensual del informe. Solo lectura (GET). Uso:
//   PGRST_URL=… JWT_SECRET=… USUARIO=<uuid admin de la copia> node comparar_real.bundle.mjs [permitir=2026-10,2026-11,2026-12] [salida.json]
// «permitir»: períodos en que se aceptan diferencias (los que la prueba registró con el desglose); fuera de ellos todo debe
// ser idéntico. Imprime RESUMEN y sale con código 1 si hay diferencias no permitidas.
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import * as N_CALC from "../../src/lib/calculos.js";
import * as N_F29 from "../../src/lib/f29.js";
import * as N_CAJA from "../../src/lib/caja.js";
import * as N_INF from "../../src/lib/informes.js";
import * as A_CALC from "@anterior/calculos.js";
import * as A_F29 from "@anterior/f29.js";
import * as A_CAJA from "@anterior/caja.js";
import * as A_INF from "@anterior/informes.js";

const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const permitir = new Set(String(process.argv[2] || "").split(",").filter(Boolean));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ahora = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: ahora + 3600, iat: ahora });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const get = async (ruta) => { const r = await fetch(`${PGRST_URL}/${ruta}`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!r.ok) throw new Error(`${r.status} ${ruta}`); return r.json(); };
const sel = (t, q = "") => get(`${t}?select=*${q}`).catch(() => []);

const ocsD = await get("ordenes_compra_v2?select=*,vendedores(nombre),financiadores(nombre),eventos_compra(*),eventos_entrega(*),eventos_factura(*),eventos_pago_cliente(*),eventos_pago_financiamiento(*),oc_productos_link(*),oc_comentarios(*)&order=creadoEn.desc");
const pv = await sel("eventos_postventa"); const pvPorOC = {}; for (const r of pv) (pvPorOC[r.oc_id] ||= []).push(r);
const todas = ocsD.map((o) => ({ ...o, eventos_postventa: pvPorOC[o.id] || [] }));
const ocs = todas.filter((o) => !o.archivada);
const D = {
  ocs, financiadores: await sel("financiadores", "&order=nombre"), vendedores: await sel("vendedores", "&order=nombre"), categorias: await sel("categorias_gasto", "&order=nombre"),
  gastos: await sel("gastos_indirectos", "&order=fecha.desc"), ivaMensual: await sel("iva_mensual"), pagosVendedor: await sel("pagos_vendedor"),
  ajustes: await sel("ajustes_saldo_financiador"), pagoFinSueltos: await sel("eventos_pago_financiamiento", "&oc_id=is.null"), aportes: await sel("aportes_socios", "&order=fecha.desc"),
};
D.saldoBanco = (await sel("saldo_banco", "&id=eq.actual"))[0] || null;
const hoy = new Date(2026, 10, 13, 12, 0, 0);
const comp = []; const dif = [];
const cmp = (clave, periodo, a, n) => { const iguales = JSON.stringify(a) === JSON.stringify(n); comp.push(clave);
  if (!iguales) dif.push({ clave, periodo, permitido: permitir.has(periodo), anterior: a, nuevo: n }); };
const per = (a, m) => `${a}-${String(m).padStart(2, "0")}`;
// Comisiones: cada vendedor × mes con facturas (y meses con IVA registrado).
for (const v of D.vendedores) for (const { anio, mes } of A_CALC.mesesConFactura(v.id, ocs)) {
  const args = { vendedorId: v.id, ocs, anio, mes, ivaMensual: D.ivaMensual, pagosVendedor: D.pagosVendedor };
  cmp(`comision ${v.id} ${per(anio, mes)}`, per(anio, mes), A_CALC.calcularPagoVendedor(args), N_CALC.calcularPagoVendedor(args));
}
// F29 por período y totales.
const claves = new Set(); D.ivaMensual.forEach((i) => claves.add(per(i.anio, i.mes))); D.gastos.filter((g) => g.categoria_id === "cat_impuesto").forEach((g) => claves.add(per(g.anio, g.mes)));
for (const k of claves) { const [a, m] = k.split("-").map(Number); cmp(`f29 ${k}`, k, A_F29.desgloseF29(D.ivaMensual, D.gastos, a, m), N_F29.desgloseF29(D.ivaMensual, D.gastos, a, m)); }
// Totales (dependen de todos los períodos): se comparan aparte y se atribuyen a «total».
const A_tot = A_F29.calcularF29({ ivaMensual: D.ivaMensual, gastos: D.gastos, anioActual: 2026, mesActual: 11 });
const N_tot = N_F29.calcularF29({ ivaMensual: D.ivaMensual, gastos: D.gastos, anioActual: 2026, mesActual: 11 });
const sinPermitidos = (x) => ({ ...x, periodos: x.periodos.filter((q) => !permitir.has(per(q.anio, q.mes))).map(({ anio, mes, det, pag, pend }) => ({ anio, mes, det, pag, pend })),
  mostrados: undefined, anterior: undefined, total: undefined, faltaTotal: (x.faltaTotal || []).filter((q) => !permitir.has(per(q.anio, q.mes))), visible: undefined });
cmp("f29 periodos fuera de los de prueba", "total", sinPermitidos(A_tot), sinPermitidos(N_tot));
const cajaArgs = { ...D, hoy };
const quitarPrueba = (r) => JSON.parse(JSON.stringify(r, (k, v) => (k === "f29" || k === "f29Pendiente" || k === "saldoProyectado" || k === "provisorio" || k === "comisiones" ? undefined : v)));
cmp("caja (sin F29/comisiones de prueba)", "total", quitarPrueba(A_CAJA.resumenCaja(cajaArgs)), quitarPrueba(N_CAJA.resumenCaja(cajaArgs)));
const cpA = A_CAJA.comisionesPorPagar(cajaArgs), cpN = N_CAJA.comisionesPorPagar(cajaArgs);
cmp("comisiones por pagar fuera de los períodos de prueba", "total", cpA.detalle.filter((x) => !permitir.has(per(x.anio, x.mes))), cpN.detalle.filter((x) => !permitir.has(per(x.anio, x.mes))));
if (!permitir.size) { cmp("caja completa", "total", A_CAJA.resumenCaja(cajaArgs), N_CAJA.resumenCaja(cajaArgs)); cmp("f29 total", "total", A_tot, N_tot); }
for (let a = 2024; a <= 2026; a++) for (let m = 1; m <= 12; m++) { if (a === 2026 && m > 11) break;
  cmp(`informe ${per(a, m)}`, per(a, m), A_INF.resultadoMes(D, a, m), N_INF.resultadoMes(D, a, m)); }
// Octubre 2026 con el desglose (si la prueba lo registró): reglas esperadas con la versión nueva.
const oct = D.ivaMensual.find((r) => Number(r.anio) === 2026 && Number(r.mes) === 10);
const extra = {};
if (oct?.desglose_f29) {
  const t = N_CALC.descuentoTributarioPeriodo(D.ivaMensual, 2026, 10); const f = N_F29.desgloseF29(D.ivaMensual, D.gastos, 2026, 10);
  extra.octubre = { descuento: t.descuentoF29, ivaNeto: t.impIva, retenciones: t.retenciones, totalF29: f.det, pagado: f.pag, pendiente: f.pend };
  extra.octubre_ok = t.descuentoF29 === 58559 && t.impIva === 26903 && t.retenciones === 31656 && f.det === 31656;
  extra.comisiones_octubre = D.vendedores.map((v) => N_CALC.calcularPagoVendedor({ vendedorId: v.id, ocs, anio: 2026, mes: 10, ivaMensual: D.ivaMensual, pagosVendedor: D.pagosVendedor }))
    .filter(Boolean).map((c) => ({ descuentoF29: c.descuentoF29, f29Incompleto: c.f29Incompleto, provisoria: N_CALC.comisionProvisoria(c) }));
  extra.comisiones_octubre_ok = extra.comisiones_octubre.every((c) => c.descuentoF29 === 58559 && !c.f29Incompleto);
}
const noPermitidas = dif.filter((d) => !d.permitido);
if (process.argv[3]) writeFileSync(process.argv[3], JSON.stringify({ dif, extra }, null, 1));
console.log(`DATOS|ocs=${ocs.length}|vendedores=${D.vendedores.length}|iva_mensual=${D.ivaMensual.length}|gastos=${D.gastos.length}|pagos_vendedor=${D.pagosVendedor.length}`);
for (const d of dif) console.log(`${d.permitido ? "DIFERENCIA_PERMITIDA" : "DIFERENCIA"}|${d.clave}`);
if (Object.keys(extra).length) console.log("OCTUBRE|" + JSON.stringify(extra));
const okExtra = !oct?.desglose_f29 || (extra.octubre_ok && extra.comisiones_octubre_ok);
console.log(`RESUMEN comparación con datos reales: ${comp.length} comparaciones, ${comp.length - dif.length} idénticas, ${dif.length - noPermitidas.length} diferencias en períodos de prueba, ${noPermitidas.length} diferencias NO permitidas${okExtra ? "" : " · OCTUBRE_INCORRECTO"}`);
if (noPermitidas.length || !okExtra) process.exitCode = 1;
