// Pruebas del cierre financiero (lib/caja.js). Ejecutar: node docs/pruebas-cierre/ejecutar.mjs
import { comisionesPorPagar, conciliacionBancaria, movimientosCaja, periodosIvaSinRegistrar, resumenCaja } from "../../src/lib/caja.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const oc = (id, o = {}) => ({ id, numero_oc: id, tipo_registro: "venta", vendedor_id: "m", financiador_id: "f1", estado_factura_propia: "emitida",
  eventos_compra: [], eventos_factura: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [], ...o });
const financiadores = [{ id: "f1", nombre: "Byron Vegas", tipo: "externo", saldo_deuda: 500 }, { id: "f2", nombre: "Francisco Balboa", tipo: "externo", saldo_deuda: -100 }, { id: "bfk", nombre: "Cuenta BFK", tipo: "propio", saldo_deuda: 0 }];
const ocs = [
  oc("A", { monto_total: 1190, monto_facturado: 1190, monto_cobrado: 1190, costo_total: 800, eventos_factura: [{ id: "fa", numero_factura: "1", fecha: "2026-07-10", monto: 1190 }],
    eventos_pago_cliente: [{ fecha: "2026-07-20", monto: 1190, medio_pago: "transferencia", cobrado_en_banco: true }], eventos_pago_financiamiento: [{ fecha: "2026-08-10", monto: 800, financiador_id: "f1" }],
    eventos_compra: [{ fecha: "2026-07-01", costo_compra: 800 }] }),
  // abono parcial + vale vista sin depositar
  oc("B", { monto_total: 2000, monto_facturado: 2000, monto_cobrado: 1500, costo_total: 1000, eventos_factura: [{ id: "fb", numero_factura: "2", fecha: "2026-08-05", monto: 2000 }],
    eventos_pago_cliente: [{ fecha: "2026-08-06", monto: 1000, medio_pago: "transferencia", cobrado_en_banco: true }, { fecha: "2026-08-20", monto: 500, medio_pago: "vale_vista", cobrado_en_banco: false }],
    eventos_compra: [{ fecha: "2026-08-01", costo_compra: 1000 }] }),
  // fondos propios: la compra sale de la caja
  oc("C", { financiador_id: "bfk", monto_total: 300, monto_facturado: 0, monto_cobrado: 0, costo_total: 200, estado_factura_propia: "pendiente", eventos_compra: [{ fecha: "2026-07-15", costo_compra: 200 }] }),
  // venta externa: su cobro está en la cuenta, en caja y en el banco, y se muestra como fondos por liquidar
  oc("X", { tipo_registro: "externa", es_venta_propia: true, vendedor_id: null, monto_total: 400, eventos_pago_cliente: [{ fecha: "2026-08-06", monto: 400, medio_pago: "transferencia", cobrado_en_banco: true }] }),
  oc("Z", { archivada: true, eventos_pago_cliente: [{ fecha: "2026-08-06", monto: 9999 }] }),
];
const gastos = [{ fecha: "2026-07-02", monto: 50, categoria_id: "cat_contador", mes: 7, anio: 2026 }, { fecha: "2026-08-02", monto: 30, categoria_id: "cat_impuesto", mes: 7, anio: 2026 }];
const pagosVendedor = [{ vendedor_id: "m", anio: 2026, mes: 7, monto_pagado: 100, fecha: "2026-08-30" }];
const aportes = [{ fecha: "2026-07-29", monto: 600, tipo: "aporte", socio: "K" }, { fecha: "2026-09-01", monto: 100, tipo: "retiro", socio: "K" }];
const pagoFinSueltos = [{ fecha: "2026-07-29", monto: 100, financiador_id: "f2" }];
const ivaMensual = [{ anio: 2026, mes: 7, iva_ventas: 60, iva_compras: 0 }];
const saldoBanco = { saldo: 1000, fecha_corte: "2026-08-03" };
const base = { ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores: [{ id: "m", nombre: "Matías Vegas" }], pagoFinSueltos, aportes, saldoBanco, hoy: new Date(2026, 9, 6) };

// 1. Un solo universo: caja y saldo esperado usan exactamente los mismos movimientos
const movs = movimientosCaja(base);
const c = conciliacionBancaria(movs, saldoBanco);
const hastaCorte = movs.filter((m) => !m.fecha || m.fecha <= "2026-08-03").reduce((s, m) => s + m.monto, 0);
eq("conciliación: pendiente = movimientos hasta el corte − banco", c.pendienteConciliacion, hastaCorte - 1000);
eq("conciliación: caja = esperado + pendiente", c.caja, c.esperado + c.pendienteConciliacion);
eq("universo: la venta externa entra a caja y a saldo esperado (ambos)", [movs.some((m) => m.tipo === "cobro_externo"), c.movPosteriores === movs.filter((m) => m.fecha > "2026-08-03").reduce((s, m) => s + m.monto, 0)], [true, true]);
eq("universo: vale vista sin depositar no es caja; archivadas fuera", [movs.some((m) => m.monto === 500), movs.some((m) => m.monto === 9999)], [false, false]);
// caja = 1190 + 1000 + 400 + 600 − 100(retiro) − 800 − 100(suelto) − 200(fondos propios) − 80(gastos) − 100(vendedor)
eq("caja calculada", c.caja, 1190 + 1000 + 400 + 600 - 100 - 800 - 100 - 200 - 80 - 100);

// 2. Resumen: cada concepto por separado, sin contar dos veces el vale vista
const r = resumenCaja(base);
eq("por cobrar sin el vale vista (B: 2000 − 1000 en banco − 500 vale vista; C sin facturar 300)", r.porCobrar, 500 + 300);
eq("vale vista pendiente aparte", [r.valeVista, r.nValeVista], [500, 1]);
eq("deuda financiadores neta (incluye saldo a favor)", r.deudaFinanciadores, 400);
eq("fondos externos por liquidar", r.fondosExternos, 400);
// Comisiones: julio con IVA registrado (definitiva); agosto sin IVA (provisoria); todas, no solo el mes actual
const cm = comisionesPorPagar(base);
eq("comisiones: todos los meses impagos, con provisorias marcadas", cm.detalle.map((d) => [d.mes, d.provisoria]), [[8, true], [7, false]].filter(([m]) => cm.detalle.some((d) => d.mes === m)));
eq("comisiones: total = definitivas + provisorias", cm.total, cm.definitivas + cm.provisorias);
eq("IVA: meses con movimiento y sin registro quedan 'pendientes de registrar' (sin estimar)", periodosIvaSinRegistrar({ ocs, ivaMensual, anioActual: 2026, mesActual: 10 }), [{ anio: 2026, mes: 8 }]);
eq("F29 pendiente solo de lo registrado (jul: 60 − 30 pagado)", r.f29Pendiente, 30);
// Cuadratura 2026-10: la proyección parte del saldo bancario esperado (no de la caja registrada).
eq("saldo proyectado = saldo bancario esperado + por cobrar + vale vista − deudas − comisiones − F29 − fondos externos",
  r.saldoProyectado, r.conciliacion.esperado + r.porCobrar + r.valeVista - r.deudaFinanciadores - r.comisiones.total - r.f29Pendiente - r.fondosExternos);
eq("base de la proyección = saldo bancario esperado", [r.baseEsBanco, r.baseProyeccion, r.saldoBancario], [true, r.conciliacion.esperado, r.conciliacion.esperado]);
eq("diferencia banco − caja registrada = esperado − caja (= −pendiente de conciliación)", r.diferenciaBancoCaja, r.conciliacion.esperado - r.caja);
eq("por cobrar = facturas por cobrar + ventas sin facturar", [r.facturasPorCobrar, r.ventasPorFacturar, r.porCobrar], [500, 300, 800]);
eq("saldo proyectado provisorio mientras falte IVA", r.provisorio, true);
// Etapa 3 (autorizada 09/10/2026): desde agosto 2026 el período es definitivo solo con el total del F29 (IVA + PPM) registrado.
eq("sin IVA pendiente ni comisiones provisorias → definitivo", resumenCaja({ ...base, ivaMensual: [...ivaMensual, { anio: 2026, mes: 8, iva_ventas: 10, iva_compras: 0, iva_pagado: 10 }] }).provisorio, false);
eq("agosto 2026 con IVA pero sin total del F29 (PPM desconocido) → provisorio", resumenCaja({ ...base, ivaMensual: [...ivaMensual, { anio: 2026, mes: 8, iva_ventas: 10, iva_compras: 0 }] }).provisorio, true);
const r2 = resumenCaja({ ...base, saldoBanco: { saldo: 999999, fecha_corte: "2026-08-03" } });
eq("la caja registrada no cambia la proyección: solo cambia si cambia el saldo del banco", r2.saldoProyectado - r.saldoProyectado, 999999 - 1000);
const r3 = resumenCaja({ ...base, saldoBanco: null });
eq("sin saldo de banco: la proyección parte de la caja registrada y se indica", [r3.baseEsBanco, r3.saldoBancario, r3.saldoProyectado], [false, null, r3.caja + r3.porCobrar + r3.valeVista - r3.deudaFinanciadores - r3.comisiones.total - r3.f29Pendiente - r3.fondosExternos]);
// Una compra pagada fuera del banco (registrada en BFK, sin cargo bancario) baja la caja registrada, pero no la proyección.
const fuera = { ...base, ocs: [...ocs, oc("P", { financiador_id: "bfk", monto_total: 0, costo_total: 70, estado_factura_propia: "pendiente", eventos_compra: [{ fecha: "2026-06-20", costo_compra: 70 }] })] };
const r4 = resumenCaja(fuera);
eq("operación fuera del banco: caja registrada −70, proyección igual", [r4.caja - r.caja, r4.saldoProyectado - r.saldoProyectado], [-70, 0]);
eq("sin saldo de banco: no hay conciliación", conciliacionBancaria(movs, null).hayCorte, false);

console.log(`\nRESUMEN pruebas cierre financiero (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
