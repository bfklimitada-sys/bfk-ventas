// Estados de la comisión (09/10/2026): en curso · por liquidar (provisoria) · pendiente de pago · pagada.
// Datos ficticios. Solo presentación: los montos calculados y los pagos no cambian.
// Ejecutar: node docs/pruebas-comisiones/ejecutar.mjs
import { calcularPagoVendedor, comisionProvisoria, estadoComisionMes, esMesEnCurso, mesesConFactura } from "../../src/lib/calculos.js";
import { comisionesPorPagar, resumenCaja } from "../../src/lib/caja.js";
import { evaluarPagoVendedor } from "../../src/lib/pagosVendedor.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const venta = (id, vend, fecha, util, o = {}) => ({ id, numero_oc: id, tipo_registro: "venta", vendedor_id: vend, financiador_id: "f1", estado_factura_propia: "emitida",
  monto_total: 1000000 + util, costo_total: 1000000, monto_facturado: 1000000 + util, eventos_compra: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [],
  eventos_factura: [{ id: "f" + id, numero_factura: id, fecha, monto: 1000000 + util }], ...o });
const vendedores = [{ id: "va", nombre: "Vendedor Alfa" }, { id: "vb", nombre: "Vendedor Beta" }];
const ocs = [
  venta("A6", "va", "2026-06-10", 200000),              // junio: IVA registrado (antes de ago-2026 basta el IVA) · pagado
  venta("A7", "va", "2026-07-10", 300000),              // julio: IVA registrado · impago → pendiente de pago (exigible)
  venta("A8", "va", "2026-08-10", 400000),              // agosto: IVA sin total F29 → por liquidar
  venta("A9", "va", "2026-09-10", 500000),              // septiembre: sin IVA → por liquidar
  venta("A10", "va", "2026-10-03", 100000),             // octubre (mes en curso) → en curso
  venta("B8", "vb", "2026-08-20", 600000),              // otro vendedor, agosto con F29 completo → pendiente de pago
  venta("B10", "vb", "2026-10-05", 80000),              // otro vendedor, mes en curso
  venta("B4", "vb", "2025-04-15", 50000),               // abril 2025 (sin descuento de IVA) · verificado y pagado
];
const ivaMensual = [
  { anio: 2026, mes: 6, iva_ventas: 20000, iva_compras: 0 }, { anio: 2026, mes: 7, iva_ventas: 30000, iva_compras: 0 },
  { anio: 2026, mes: 8, iva_ventas: 40000, iva_compras: 0 },            // sin iva_pagado: falta el total del F29
  { anio: 2026, mes: 10, iva_ventas: 1000, iva_compras: 0, iva_pagado: 1500 },   // mes en curso con IVA: sigue «en curso»
];
const ivaB = [...ivaMensual.filter((i) => i.mes !== 8), { anio: 2026, mes: 8, iva_ventas: 40000, iva_compras: 0, iva_pagado: 50000 }];
const pagosVendedor = [
  { id: "p6", vendedor_id: "va", anio: 2026, mes: 6, monto_pagado: 90000, fecha: "2026-07-30" },
  { id: "p4", vendedor_id: "vb", anio: 2025, mes: 4, monto_pagado: 25000, monto_verificado: 25000, fecha: "2025-05-30" },
  { id: "px", vendedor_id: "va", anio: 2026, mes: 7, monto_pagado: 999999, fecha: "2026-08-01", anulado_en: "2026-08-02T00:00:00Z" },   // anulado: no cuenta
];
const hoy = new Date(2026, 9, 9, 12, 0, 0);   // 09/10/2026
const calc = (v, anio, mes, iva = ivaMensual) => calcularPagoVendedor({ vendedorId: v, ocs, anio, mes, ivaMensual: iva, pagosVendedor });
const estado = (v, anio, mes, iva) => estadoComisionMes(calc(v, anio, mes, iva), hoy);

// 1. Estado por mes
eq("junio pagado → pagada", estado("va", 2026, 6), "pagada");
eq("julio con IVA, impago → pendiente de pago (exigible)", estado("va", 2026, 7), "pendiente");
eq("agosto con IVA pero sin total del F29 → por liquidar", estado("va", 2026, 8), "por_liquidar");
eq("septiembre sin IVA → por liquidar", estado("va", 2026, 9), "por_liquidar");
eq("octubre (mes actual) → en curso, aunque tenga IVA registrado", estado("va", 2026, 10), "en_curso");
eq("agosto con F29 completo → pendiente de pago", estado("vb", 2026, 8, ivaB), "pendiente");
eq("abril 2025 verificado y pagado → pagada", estado("vb", 2025, 4), "pagada");
eq("pago anulado no cuenta: julio sigue impago", calc("va", 2026, 7).pagado, 0);
eq("provisoria = falta IVA o total F29 (regla única)", [7, 8, 9].map((m) => comisionProvisoria(calc("va", 2026, m))), [false, true, true]);
eq("verificado nunca es provisorio", comisionProvisoria({ esVerificado: true, ivaRegistrado: false }), false);
eq("mes en curso: cambio de año (diciembre → enero)", [esMesEnCurso(2026, 12, new Date(2027, 0, 2)), esMesEnCurso(2027, 1, new Date(2027, 0, 2))], [false, true]);
eq("mes futuro (factura adelantada) → en curso", esMesEnCurso(2026, 11, hoy), true);

// 2. Totales separados, mismo total que antes
const r = comisionesPorPagar({ vendedores, ocs, ivaMensual, pagosVendedor, hoy });
const deuda = (v, m) => calc(v, 2026, m).deuda;
eq("exigible = solo julio de Alfa (B8 de Beta: F29 incompleto en este escenario)", r.exigible, deuda("va", 7));
eq("por liquidar = agosto y septiembre de Alfa + agosto de Beta", r.porLiquidar, deuda("va", 8) + deuda("va", 9) + deuda("vb", 8));
eq("en curso = octubre de Alfa y de Beta", r.enCurso, deuda("va", 10) + deuda("vb", 10));
const totalAntes = vendedores.flatMap((v) => mesesConFactura(v.id, ocs).map(({ anio, mes }) => calc(v.id, anio, mes))).reduce((s, c) => s + c.deuda, 0);
eq("total sin cambios = exigible + por liquidar + en curso", [r.total, r.exigible + r.porLiquidar + r.enCurso], [totalAntes, totalAntes]);
eq("definitivas = exigible; provisorias = por liquidar + en curso", [r.definitivas, r.provisorias], [r.exigible, r.porLiquidar + r.enCurso]);
eq("detalle con estado por vendedor y mes", r.detalle.map((d) => `${d.vendedorId}/${d.mes}:${d.estado}`).sort(), ["va/10:en_curso", "va/7:pendiente", "va/8:por_liquidar", "va/9:por_liquidar", "vb/10:en_curso", "vb/8:por_liquidar"]);
const r2 = comisionesPorPagar({ vendedores, ocs, ivaMensual: ivaB, pagosVendedor, hoy });
eq("todos los vendedores: Beta pasa a exigible al completar el F29 de agosto", r2.detalle.find((d) => d.vendedorId === "vb" && d.mes === 8).estado, "pendiente");
const r3 = comisionesPorPagar({ vendedores, ocs, ivaMensual, pagosVendedor, hoy: new Date(2026, 10, 2) });
eq("al cerrar octubre (IVA y total del F29 registrados), su comisión pasa a pendiente de pago", r3.detalle.filter((d) => d.mes === 10).map((d) => `${d.vendedorId}:${d.estado}`).sort(), ["va:pendiente", "vb:pendiente"]);

// 3. El Panel descuenta lo mismo que antes; los montos de comisión no cambian
const base = { ocs, financiadores: [], gastos: [], pagosVendedor, ivaMensual, vendedores, pagoFinSueltos: [], aportes: [], saldoBanco: null, hoy };
const rc = resumenCaja(base);
eq("resumen: comisiones con desglose y mismo total", [rc.comisiones.total, rc.comisiones.exigible, rc.comisiones.porLiquidar, rc.comisiones.enCurso], [r.total, r.exigible, r.porLiquidar, r.enCurso]);
eq("saldo proyectado descuenta el total (sin cambio de fórmula)", rc.saldoProyectado, rc.baseProyeccion + rc.porCobrar + rc.valeVista - rc.deudaFinanciadores - rc.comisiones.total - rc.f29Pendiente - rc.fondosExternos);
eq("saldo provisorio mientras haya comisiones no definitivas", rc.provisorio, true);

// 4. Formulario de pago: avisos con la misma regla
const ev = (m) => evaluarPagoVendedor({ vendedorId: "va", mes: m, anio: 2026, monto: 1, ocs, ivaMensual, pagosVendedor, hoy });
eq("formulario: octubre en curso", [ev(10).enCurso, ev(9).enCurso], [true, false]);
eq("formulario: provisoria por IVA o por F29", [ev(8).provisoria, ev(8).f29Incompleto, ev(9).provisoria, ev(9).sinIvaRegistrado, ev(7).provisoria], [true, true, true, true, false]);
eq("formulario: el monto de la comisión no cambia", ev(7).comision, Math.round(calc("va", 2026, 7).pagoCalculado));

console.log(`\nRESUMEN estados de comisión: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
