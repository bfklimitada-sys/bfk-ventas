// Pruebas del F29 con el desglose del informe del contador (13/11/2026).
// Cubre: prueba de aceptación de octubre 2026, declaración sin pago, pago único (sin duplicar al volver a guardar o
// reenviar), F29 en $0 frente a dato pendiente, período con IVA a pagar, registros históricos idénticos a la versión
// anterior (comisiones, F29 y caja), validaciones del pago y lectura de montos del informe.
import { planGuardarIva, planPagoF29, pagadoSiiDe } from "../../src/lib/ivaUnificado.js";
import { desgloseRegistroF29, leerMontoF29 } from "../../src/lib/f29Desglose.js";
import { desgloseF29, calcularF29 } from "../../src/lib/f29.js";
import { calcularPagoVendedor, comisionOrdinariaPeriodo, descuentoTributarioPeriodo, comisionProvisoria, retencionesPeriodo } from "../../src/lib/calculos.js";
import { resumenCaja, comisionesPorPagar } from "../../src/lib/caja.js";
import * as ANT_CALC from "@anterior/calculos.js";
import * as ANT_F29 from "@anterior/f29.js";
import * as ANT_CAJA from "@anterior/caja.js";
import * as ANT_IVAU from "@anterior/ivaUnificado.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };

// Aplica un plan de guardado sobre una «base» en memoria (como haría App.jsx con la base real).
const aplicarIva = (db, plan) => {
  if (plan.iva.accion === "actualizar") db.iva = db.iva.map((r) => (r.id === plan.iva.id ? { ...r, ...plan.iva.fila } : r));
  else db.iva = [...db.iva, { id: `iva_${db.iva.length + 1}`, ...plan.iva.fila }];
  if (plan.gasto.accion !== "ninguna") db.gastos = [...db.gastos, { id: "inesperado", ...plan.gasto.fila }];
};
const aplicarPago = (db, plan) => { if (plan.accion === "insertar") { if (db.gastos.some((g) => g.id === plan.fila.id)) throw new Error("duplicate key 23505"); db.gastos = [...db.gastos, plan.fila]; } };

// ── 1. Prueba de aceptación: informe de octubre de 2026 ──────────────────────────────────────────────
const octubre = { anio: 2026, mes: 10, ventasNetas: 6331221, comprasNetas: 6189588, ivaVentas: 1202931, ivaCompras: 1176028,
  desglose: true, remanenteAnterior: 149951, ppm: 31656, otrasRetenciones: 0 };
const db = { iva: [], gastos: [{ id: "g_sep", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", anio: 2026, mes: 9, monto: 16757, fecha: "2026-10-15" }] };
let plan = planGuardarIva({ data: octubre, gastos: db.gastos, ivaMensual: db.iva });
eq("oct: inserta la declaración con el desglose", [plan.iva.accion, plan.iva.fila.desglose_f29, plan.iva.fila.remanente_anterior, plan.iva.fila.ppm, plan.iva.fila.otras_retenciones, plan.iva.fila.iva_pagado],
  ["insertar", true, 149951, 31656, 0, 31656]);
eq("oct: guardar NO crea gasto", plan.gasto, { accion: "ninguna" });
aplicarIva(db, plan);
const rOct = db.iva[0];
const d = desgloseRegistroF29(rOct);
eq("oct: ventas netas / compras netas (columna Neto)", [rOct.ventas_netas, rOct.compras_netas], [6331221, 6189588]);
eq("oct: IVA débito / crédito", [d.debito, d.credito], [1202931, 1176028]);
eq("oct: remanente anterior reajustado", d.remanente, 149951);
eq("oct: IVA neto del mes = $26.903", d.ivaNeto, 26903);
eq("oct: IVA a pagar = $0", d.ivaAPagar, 0);
eq("oct: PPM = $31.656 / otras retenciones = $0", [d.ppm, d.otras], [31656, 0]);
eq("oct: Total a pagar F29 = $31.656", d.total, 31656);
eq("oct: Remanente para noviembre = $123.048", d.remanenteSiguiente, 123048);
// 13/11/2026 12:48 (Kevin): desde octubre 2026, con el desglose completo, el descuento es el Total a pagar F29 ($31.656), no $58.559.
eq("oct: descuento tributario total para comisiones = Total a pagar F29 = $31.656", [d.descuentoComisiones, d.reglaTotalF29], [31656, true]);
const tOct = descuentoTributarioPeriodo(db.iva, 2026, 10);
eq("oct: regla de comisiones → IVA a pagar $0 + PPM y otras $31.656 = $31.656 (no $58.559)", [tOct.impIva, tOct.retenciones, tOct.descuentoF29, tOct.reglaTotalF29], [0, 31656, 31656, true]);
// Guardado sin pago: pendiente $31.656, ningún gasto creado.
let f = desgloseF29(db.iva, db.gastos, 2026, 10);
eq("oct sin pago: pendiente $31.656, pagado $0", [f.det, f.pag, f.pend, f.faltaTotalF29], [31656, 0, 31656, false]);
eq("oct sin pago: no existe gasto del período", db.gastos.filter((g) => g.anio === 2026 && g.mes === 10).length, 0);
const hoyNov = new Date(2026, 10, 13);
eq("oct sin pago: Caja descuenta $31.656 de F29 pendiente", resumenCaja({ ocs: [], financiadores: [], gastos: db.gastos, pagosVendedor: [], ivaMensual: db.iva, vendedores: [], pagoFinSueltos: [], aportes: [], saldoBanco: null, hoy: hoyNov }).f29Pendiente, 31656);
// Volver a guardar el mismo período: actualiza, no crea gastos.
plan = planGuardarIva({ data: octubre, gastos: db.gastos, ivaMensual: db.iva });
eq("oct: volver a guardar actualiza el mismo registro sin gasto", [plan.iva.accion, plan.iva.id, plan.gasto.accion], ["actualizar", rOct.id, "ninguna"]);
aplicarIva(db, plan);
// Registrar el pago (base de prueba en memoria).
const pago = { id: "gas_pago_oct", anio: 2026, mes: 10, monto: 31656, fecha: "2026-11-20", hoy: "2026-11-20" };
let pp = planPagoF29({ ...pago, gastos: db.gastos, ivaMensual: db.iva });
eq("pago oct: inserta un gasto Impuesto SII con monto y fecha reales", [pp.accion, pp.fila.categoria_id, pp.fila.subcategoria, pp.fila.monto, pp.fila.mes, pp.fila.anio, pp.fila.fecha, pp.pendienteDespues],
  ["insertar", "cat_impuesto", "IVA Mensual", 31656, 10, 2026, "2026-11-20", 0]);
aplicarPago(db, pp);
f = desgloseF29(db.iva, db.gastos, 2026, 10);
eq("pago oct: saldo $0", [f.pag, f.pend], [31656, 0]);
pp = planPagoF29({ ...pago, gastos: db.gastos, ivaMensual: db.iva });
eq("pago oct: reenviar el MISMO pago no lo duplica", [!!pp.duplicado, pp.accion], [true, undefined]);
pp = planPagoF29({ ...pago, id: "gas_otro", gastos: db.gastos, ivaMensual: db.iva });
eq("pago oct: un segundo pago con saldo $0 se rechaza", [!!pp.error, pp.accion], [true, undefined]);
plan = planGuardarIva({ data: octubre, gastos: db.gastos, ivaMensual: db.iva }); aplicarIva(db, plan);
plan = planGuardarIva({ data: { ...octubre, ventasNetas: 6331221 }, gastos: db.gastos, ivaMensual: db.iva }); aplicarIva(db, plan);
eq("oct: volver a guardar dos veces después del pago → una sola salida de caja", [db.gastos.filter((g) => g.anio === 2026 && g.mes === 10).length, pagadoSiiDe(db.gastos, 2026, 10), desgloseF29(db.iva, db.gastos, 2026, 10).pend], [1, 31656, 0]);
eq("oct: el pago de septiembre existente no cambia", db.gastos.find((g) => g.id === "g_sep"), { id: "g_sep", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", anio: 2026, mes: 9, monto: 16757, fecha: "2026-10-15" });
eq("oct pagado: Caja sin F29 pendiente de octubre", calcularF29({ ivaMensual: db.iva, gastos: db.gastos, anioActual: 2026, mesActual: 11 }).periodos.find((p) => p.mes === 10).pend, 0);

// Comisiones de octubre: un vendedor y dos vendedores (descuento único antes de dividir).
const oc = (id, v, venta, costo, fecha) => ({ id, numero_oc: id, vendedor_id: v, tipo_registro: "venta", estado_factura_propia: "emitida", monto_total: venta, costo_total: costo,
  eventos_factura: [{ id: "f" + id, numero_factura: id, fecha, monto: venta }] });
const ocs1 = [oc("A", "v1", 1500000, 1000000, "2026-10-10")];
let c = calcularPagoVendedor({ vendedorId: "v1", ocs: ocs1, anio: 2026, mes: 10, ivaMensual: db.iva, pagosVendedor: [] });
eq("comisión oct, un vendedor: (500.000 − 31.656)/2 = 234.172", [c.comisionOrdinaria, c.descuentoF29, c.retenciones, c.impIva, c.f29Incompleto, comisionProvisoria(c)], [234172, 31656, 31656, 0, false, false]);
eq("comisión oct: datos del desglose para la pantalla", [c.reglaTotalF29, c.ivaNetoF29, c.remanenteF29], [true, 26903, 149951]);
const ocs2 = [oc("A", "v1", 1500000, 1000000, "2026-10-10"), oc("B", "v2", 900000, 600000, "2026-10-12")];
const per = comisionOrdinariaPeriodo({ ocs: ocs2, anio: 2026, mes: 10, ivaMensual: db.iva });
eq("comisión oct, dos vendedores: total = (800.000 − 31.656)/2 = 384.172, descuento una sola vez", [per.descuentoF29, per.total, per.partes.get("v1") + per.partes.get("v2")], [31656, 384172, 384172]);
eq("comisión oct, dos vendedores: reparto por utilidad (500.000 y 300.000)", [per.partes.get("v1"), per.partes.get("v2")], [Math.round(384172 * 5 / 8), 384172 - Math.round(384172 * 5 / 8)]);
// Aunque el F29 siga pendiente de pago, el descuento es el mismo (se registra el pago después).
const ivSinPago = db.iva; const gSinPago = db.gastos.filter((g) => !(g.anio === 2026 && g.mes === 10));
eq("comisión oct: el descuento no depende del pago del F29", [descuentoTributarioPeriodo(ivSinPago, 2026, 10).descuentoF29, desgloseF29(ivSinPago, gSinPago, 2026, 10).pend], [31656, 31656]);
// Montos verificados y pagos se respetan.
c = calcularPagoVendedor({ vendedorId: "v1", ocs: ocs1, anio: 2026, mes: 10, ivaMensual: db.iva, pagosVendedor: [{ id: "pv", vendedor_id: "v1", anio: 2026, mes: 10, monto_pagado: 200000, monto_verificado: 210000 }] });
eq("comisión oct: un monto verificado manda sobre la fórmula; el pago se conserva", [c.pagoCalculado, c.pagado, c.esVerificado], [210000, 200000, true]);
// Desglose INCOMPLETO en octubre (remanente pendiente): regla anterior y comisión provisoria hasta completarlo.
const ivInc = [{ ...rOct, remanente_anterior: null }];
c = calcularPagoVendedor({ vendedorId: "v1", ocs: ocs1, anio: 2026, mes: 10, ivaMensual: ivInc, pagosVendedor: [] });
eq("oct con remanente pendiente: sin regla del total, provisoria", [c.reglaTotalF29, c.descuentoF29, c.f29Incompleto, comisionProvisoria(c)], [undefined, 58559, true, true]);
// Antes de octubre 2026 un período con desglose completo conserva la regla anterior (IVA neto + retenciones).
const ivSep = [{ ...rOct, id: "s", mes: 9 }];
eq("sep 2026 con desglose completo: regla anterior (IVA neto + PPM + otras)", [descuentoTributarioPeriodo(ivSep, 2026, 9).descuentoF29, desgloseRegistroF29(ivSep[0]).descuentoComisiones], [58559, 58559]);

// ── 2. F29 en $0 frente a dato pendiente ─────────────────────────────────────────────────────────────
const cero = { anio: 2026, mes: 11, ventasNetas: 0, comprasNetas: 0, ivaVentas: 0, ivaCompras: 0, desglose: true, remanenteAnterior: 0, ppm: 0, otrasRetenciones: 0 };
let p0 = planGuardarIva({ data: cero, gastos: [], ivaMensual: [] });
eq("F29 $0: guarda ceros explícitos (no NULL)", [p0.iva.fila.remanente_anterior, p0.iva.fila.ppm, p0.iva.fila.otras_retenciones, p0.iva.fila.iva_pagado], [0, 0, 0, 0]);
let iv0 = [{ id: "i0", ...p0.iva.fila }];
let f0 = desgloseF29(iv0, [], 2026, 11);
eq("F29 $0: total $0, completo, nada pendiente", [f0.det, f0.pend, f0.faltaTotalF29, f0.desglose.total], [0, 0, false, 0]);
eq("F29 $0: se lista entre los períodos del F29 (declarado)", calcularF29({ ivaMensual: iv0, gastos: [], anioActual: 2026, mesActual: 12 }).periodos.map((p) => [p.mes, p.conDesglose]), [[11, true]]);
eq("F29 $0: pago rechazado (sin saldo)", !!planPagoF29({ id: "x", anio: 2026, mes: 11, monto: 1, fecha: "2026-12-10", gastos: [], ivaMensual: iv0 }).error, true);
const pend = planGuardarIva({ data: { ...cero, ppm: null, otrasRetenciones: "", remanenteAnterior: undefined }, gastos: [], ivaMensual: [] });
eq("pendiente: vacío → NULL (distinto de $0)", [pend.iva.fila.remanente_anterior, pend.iva.fila.ppm, pend.iva.fila.otras_retenciones, pend.iva.fila.iva_pagado], [null, null, null, 0]);
const fp = desgloseF29([{ id: "ip", ...pend.iva.fila }], [], 2026, 11);
eq("pendiente: faltan datos, total sin determinar", [fp.faltaTotalF29, fp.desglose.total, fp.desglose.pendientes], [true, null, ["remanente_anterior", "ppm", "otras_retenciones"]]);
c = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc("Z", "v1", 300000, 100000, "2026-11-05")], anio: 2026, mes: 11, ivaMensual: [{ id: "ip", ...pend.iva.fila }], pagosVendedor: [] });
eq("pendiente: la comisión queda provisoria (PPM pendiente) y no se presume $0 definitivo", [c.f29Incompleto, comisionProvisoria(c)], [true, true]);
c = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc("Z", "v1", 300000, 100000, "2026-11-05")], anio: 2026, mes: 11, ivaMensual: iv0, pagosVendedor: [] });
eq("$0 explícito: la comisión es definitiva (200.000/2)", [c.f29Incompleto, comisionProvisoria(c), c.comisionOrdinaria], [false, false, 100000]);

// ── 3. Período con IVA a pagar ───────────────────────────────────────────────────────────────────────
const conIva = { anio: 2026, mes: 12, ventasNetas: 5263158, comprasNetas: 3157895, ivaVentas: 1000000, ivaCompras: 600000, desglose: true, remanenteAnterior: 123048, ppm: 26316, otrasRetenciones: 5000 };
let pi = planGuardarIva({ data: conIva, gastos: [], ivaMensual: [] }); const ivI = [{ id: "ii", ...pi.iva.fila }];
const dI = desgloseRegistroF29(ivI[0]);
eq("IVA a pagar: neto 400.000 − remanente 123.048 = 276.952; remanente siguiente 0", [dI.ivaNeto, dI.ivaAPagar, dI.remanenteSiguiente], [400000, 276952, 0]);
eq("IVA a pagar: total F29 = 276.952 + 26.316 + 5.000 = 308.268 (iva_pagado guarda el total)", [dI.total, pi.iva.fila.iva_pagado], [308268, 308268]);
eq("IVA a pagar: descuento comisiones = Total a pagar F29 = 308.268", dI.descuentoComisiones, 308268);
const gI = [];
let pq = planPagoF29({ id: "p1", anio: 2026, mes: 12, monto: 200000, fecha: "2027-01-15", gastos: gI, ivaMensual: ivI, hoy: "2027-01-20" });
eq("IVA a pagar: pago parcial → saldo 108.268", [pq.accion, pq.pendienteDespues], ["insertar", 108268]); gI.push(pq.fila);
pq = planPagoF29({ id: "p2", anio: 2026, mes: 12, monto: 108269, fecha: "2027-01-18", gastos: gI, ivaMensual: ivI, hoy: "2027-01-20" });
eq("IVA a pagar: un pago mayor que el saldo se rechaza", !!pq.error, true);
pq = planPagoF29({ id: "p2", anio: 2026, mes: 12, monto: 108268, fecha: "2027-01-18", gastos: gI, ivaMensual: ivI, hoy: "2027-01-20" }); gI.push(pq.fila);
eq("IVA a pagar: dos pagos vigentes saldan el período", desgloseF29(ivI, gI, 2026, 12).pend, 0);
eq("pago: fecha futura rechazada", !!planPagoF29({ id: "p9", anio: 2026, mes: 12, monto: 1, fecha: "2027-02-01", gastos: [], ivaMensual: ivI, hoy: "2027-01-20" }).error, true);
eq("pago: sin F29 declarado se rechaza", !!planPagoF29({ id: "p9", anio: 2027, mes: 1, monto: 1, fecha: "2027-01-20", gastos: [], ivaMensual: ivI, hoy: "2027-01-20" }).error, true);
eq("pago: sin fecha se rechaza", !!planPagoF29({ id: "p9", anio: 2026, mes: 12, monto: 1, fecha: "", gastos: [], ivaMensual: ivI }).error, true);
// Remanente reajustado distinto del nominal del mes anterior: se usa el escrito.
eq("remanente: se usa el reajustado escrito aunque difiera del nominal anterior (123.048 vs 125.000)", desgloseRegistroF29({ ...ivI[0], remanente_anterior: 125000 }).ivaAPagar, 275000);

// ── 4. Registros históricos sin desglose: idénticos a la versión anterior ───────────────────────────
// Valores con la forma de producción (jun–sep 2026, leídos en solo lectura el 13/11/2026) y casos antiguos.
const hist = [
  { id: "h6", anio: 2026, mes: 6, ventas_netas: 0, iva_ventas: 35033, compras_netas: 0, iva_compras: 0, iva_pagado: 35033 },
  { id: "h7", anio: 2026, mes: 7, ventas_netas: 0, iva_ventas: 649597, compras_netas: 0, iva_compras: 0, iva_pagado: 649597 },
  { id: "h8", anio: 2026, mes: 8, ventas_netas: 8173269, iva_ventas: 1552920, compras_netas: 5178704, iva_compras: 983956, iva_pagado: 609830 },
  { id: "h9", anio: 2026, mes: 9, ventas_netas: 3351431, iva_ventas: 636771, compras_netas: 4290475, iva_compras: 815190, iva_pagado: 16757 },
  { id: "h1", anio: 2025, mes: 4, ventas_netas: 0, iva_ventas: 50000, compras_netas: 0, iva_compras: 10000, iva_pagado: 40000 },
  { id: "h2", anio: 2025, mes: 11, ventas_netas: 0, iva_ventas: 10000, compras_netas: 0, iva_compras: 90000, iva_pagado: 0 },
  // Las columnas nuevas llegan en NULL desde la base para los registros anteriores.
].map((r) => ({ ...r, remanente_anterior: null, ppm: null, otras_retenciones: null, desglose_f29: null }));
const gHist = [[2026, 6, 35033, "2026-07-16"], [2026, 7, 649597, "2026-08-20"], [2026, 8, 609830, "2026-09-17"], [2026, 9, 16757, "2026-10-15"], [2025, 11, 5000, "2025-12-20"]]
  .map(([anio, mes, monto, fecha], i) => ({ id: "gh" + i, categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", anio, mes, monto, fecha }));
const ocsH = [];
[[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2025, 4], [2025, 11]].forEach(([a, m], i) => { ocsH.push(oc("H" + i, "v1", 2000000 + i * 1000, 1200000, `${a}-${String(m).padStart(2, "0")}-15`)); ocsH.push(oc("K" + i, "v2", 700000, 650000 + i * 7000, `${a}-${String(m).padStart(2, "0")}-18`)); });
const vend = [{ id: "v1", nombre: "Uno" }, { id: "v2", nombre: "Dos" }];
const pagosV = [{ id: "pv1", vendedor_id: "v1", anio: 2026, mes: 8, monto_pagado: 300000 }, { id: "pv2", vendedor_id: "v2", anio: 2025, mes: 11, monto_pagado: 1000, monto_verificado: 12345 }];
let iguales = 0, distintos = [];
for (const [a, m] of [[2026, 6], [2026, 7], [2026, 8], [2026, 9], [2025, 4], [2025, 11]]) {
  for (const v of ["v1", "v2"]) {
    const n1 = calcularPagoVendedor({ vendedorId: v, ocs: ocsH, anio: a, mes: m, ivaMensual: hist, pagosVendedor: pagosV });
    const n0 = ANT_CALC.calcularPagoVendedor({ vendedorId: v, ocs: ocsH, anio: a, mes: m, ivaMensual: hist, pagosVendedor: pagosV });
    JSON.stringify(n1) === JSON.stringify(n0) ? iguales++ : distintos.push(`${v} ${m}/${a}`);
  }
  const f1 = desgloseF29(hist, gHist, a, m), f0b = ANT_F29.desgloseF29(hist, gHist, a, m);
  JSON.stringify(f1) === JSON.stringify(f0b) ? iguales++ : distintos.push(`F29 ${m}/${a}`);
  retencionesPeriodo(registro(hist, a, m)) === ANT_CALC.retencionesPeriodo(registro(hist, a, m)) ? iguales++ : distintos.push(`ret ${m}/${a}`);
}
function registro(iv, a, m) { return iv.find((r) => r.anio === a && r.mes === m); }
eq("históricos: comisiones, F29 y retenciones idénticos a la versión anterior (24 comparaciones: 6 períodos × 2 vendedores + F29 + retenciones)", [iguales, distintos], [24, []]);
const cajaArgs = { ocs: ocsH, financiadores: [], gastos: gHist, pagosVendedor: pagosV, ivaMensual: hist, vendedores: vend, pagoFinSueltos: [], aportes: [], saldoBanco: null, hoy: hoyNov };
eq("históricos: resumen de Caja idéntico a la versión anterior", JSON.stringify(resumenCaja(cajaArgs)) === JSON.stringify(ANT_CAJA.resumenCaja(cajaArgs)), true);
eq("históricos: comisiones por pagar idénticas", JSON.stringify(comisionesPorPagar(cajaArgs)) === JSON.stringify(ANT_CAJA.comisionesPorPagar(cajaArgs)), true);
eq("históricos: F29 de agosto 2026 = 568.964 + 40.866 = 609.830, pagado, pendiente 0", (({ iva, ppm, det, pag, pend }) => [iva, ppm, det, pag, pend])(desgloseF29(hist, gHist, 2026, 8)), [568964, 40866, 609830, 609830, 0]);
// Editar un registro anterior en su formato: misma fila que la versión anterior (iva_mensual), sin gasto.
for (const [a, m, tot] of [[2026, 8, 609830], [2026, 9, 0], [2025, 11, 0], [2026, 7, 700000]]) {
  const r = registro(hist, a, m);
  const data = { anio: a, mes: m, ventasNetas: r.ventas_netas, ivaVentas: r.iva_ventas, comprasNetas: r.compras_netas, ivaCompras: r.iva_compras, pagadoSii: tot, totalF29: tot, fechaPago: null };
  const n1 = planGuardarIva({ data, gastos: gHist, ivaMensual: hist }), n0 = ANT_IVAU.planGuardarIva({ data, gastos: gHist, ivaMensual: hist });
  eq(`histórico ${m}/${a} editado en su formato: misma fila iva_mensual que antes, sin columnas nuevas ni gasto`, [n1.iva, n1.gasto.accion], [n0.iva, "ninguna"]);
}
// Convertir un histórico al desglose solo con datos explícitos (la interfaz exige los tres; aquí la regla resultante).
const conv = planGuardarIva({ data: { anio: 2026, mes: 9, ventasNetas: 3351431, ivaVentas: 636771, comprasNetas: 4290475, ivaCompras: 815190, desglose: true, remanenteAnterior: 0, ppm: 16757, otrasRetenciones: 0 }, gastos: gHist, ivaMensual: hist });
const ivConv = hist.map((r) => (r.id === conv.iva.id ? { ...r, ...conv.iva.fila } : r));
eq("histórico septiembre pasado al desglose con PPM explícito 16.757: mismo descuento y F29", [descuentoTributarioPeriodo(ivConv, 2026, 9).descuentoF29, descuentoTributarioPeriodo(hist, 2026, 9).descuentoF29, desgloseF29(ivConv, gHist, 2026, 9).pend],
  [-178419 + 16757, -178419 + 16757, 0]);

// ── 5. Lectura de montos copiados del informe ────────────────────────────────────────────────────────
eq("montos: «$ 1.202.931» → 1202931", leerMontoF29("$ 1.202.931").valor, 1202931);
eq("montos: «31656» → 31656", leerMontoF29("31656").valor, 31656);
eq("montos: «–» del informe → $0", leerMontoF29("–").valor, 0);
eq("montos: «0» → $0 (no pendiente)", leerMontoF29("0").valor, 0);
eq("montos: vacío → pendiente (null)", leerMontoF29("  ").valor, null);
eq("montos: negativo rechazado", !!leerMontoF29("-$ 1.302.271").error, true);
eq("montos: texto rechazado", !!leerMontoF29("12,5").error, true);

console.log(`RESUMEN F29 con desglose: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
