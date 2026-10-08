// Pruebas de la cuadratura financiera 2026-10 (lib/caja.js, lib/ocs.js). Ejecutar: node docs/pruebas-cuadratura/ejecutar.mjs
import { movimientosCaja, resumenCaja } from "../../src/lib/caja.js";
import { ingresoPendienteOC, utilidadPorMes } from "../../src/lib/ocs.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const oc = (id, o = {}) => ({ id, numero_oc: id, tipo_registro: "venta", vendedor_id: "m", financiador_id: "f1", estado_factura_propia: "pendiente",
  eventos_compra: [], eventos_factura: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [], ...o });
const fin = [{ id: "f1", nombre: "Byron Vegas", tipo: "externo", saldo_deuda: 0 }, { id: "fk", nombre: "Kevin Vergara", tipo: "externo", saldo_deuda: 100 }, { id: "bfk", nombre: "Cuenta BFK", tipo: "propio", saldo_deuda: 0 }];
const vacio = { financiadores: fin, gastos: [], pagosVendedor: [], ivaMensual: [], vendedores: [], pagoFinSueltos: [], aportes: [], hoy: new Date(2026, 9, 7) };

// 1. Pagos parciales: se descuentan una sola vez; el vale vista sin depositar va aparte.
const parcial = oc("P", { monto_total: 1000, monto_facturado: 1000, monto_cobrado: 700, estado_factura_propia: "emitida",
  eventos_factura: [{ id: "f", numero_factura: "9", tipo_documento: "factura", fecha: "2026-09-01", monto: 1000 }],
  eventos_pago_cliente: [{ fecha: "2026-09-10", monto: 400, medio_pago: "transferencia" }, { fecha: "2026-09-20", monto: 300, medio_pago: "vale_vista", cobrado_en_banco: false }] });
const rp = resumenCaja({ ...vacio, ocs: [parcial], saldoBanco: { saldo: 400, fecha_corte: "2026-10-07" } });
eq("pago parcial: factura por cobrar 300, vale vista 300, caja 400", [rp.facturasPorCobrar, rp.valeVista, rp.caja], [300, 300, 400]);
eq("pago parcial: cobrado + por cobrar + vale vista = facturado (sin duplicar)", rp.caja + rp.facturasPorCobrar + rp.valeVista, 1000);

// 2. Anulación: factura anulada por NC; la vigente manda. Sin factura vigente → venta sin facturar.
const anulada = oc("A", { monto_total: 500, monto_facturado: 0, estado_factura_propia: "pendiente", eventos_compra: [{ fecha: "2026-09-01", costo_compra: 300 }],
  eventos_factura: [{ id: "f1", numero_factura: "10", tipo_documento: "factura", fecha: "2026-09-02", monto: 500 }, { id: "nc", numero_factura: "3", tipo_documento: "nota_credito", ref_folio: "10", ref_codigo: 1, fecha: "2026-09-03", monto: 500 }] });
const ra = resumenCaja({ ...vacio, ocs: [anulada], saldoBanco: null });
eq("anulada: no es factura por cobrar; queda como venta sin facturar", [ra.facturasPorCobrar, ra.ventasPorFacturar], [0, 500]);

// 3. Retención y cobro fuera de banco: saldan al cliente, no son caja ni por cobrar.
const fuera = oc("F", { monto_total: 200, monto_facturado: 200, monto_cobrado: 200, estado_factura_propia: "emitida",
  eventos_pago_cliente: [{ fecha: "2024-07-26", monto: 150, medio_pago: "fuera_banco" }, { fecha: "2024-11-18", monto: 50, medio_pago: "transferencia" }] });
const rf = resumenCaja({ ...vacio, ocs: [fuera], saldoBanco: { saldo: 50, fecha_corte: "2026-10-07" } });
eq("fuera de banco: caja 50, por cobrar 0, conciliado", [rf.caja, rf.porCobrar, rf.diferenciaBancoCaja], [50, 0, 0]);

// 4. Doble conteo que corrige la cuadratura: pago a financiador registrado sin salir del banco y compensado con un ajuste
//    que deja la deuda vigente. Con base en la caja registrada se restaba dos veces; con base en el banco, una.
const k = oc("K", { financiador_id: "fk", monto_total: 0, eventos_pago_financiamiento: [{ fecha: "2025-01-10", monto: 100, financiador_id: "fk" }] });
const rk = resumenCaja({ ...vacio, ocs: [k], saldoBanco: { saldo: 0, fecha_corte: "2026-10-07" } });
eq("pago sin TEF + deuda vigente: caja −100, banco 0, diferencia 100", [rk.caja, rk.saldoBancario, rk.diferenciaBancoCaja], [-100, 0, 100]);
eq("pago sin TEF + deuda vigente: la proyección resta la deuda una sola vez", rk.saldoProyectado, 0 - 100);

// 5. Fondos propios pagados por un socio antes de la apertura: no es dinero que vuelva a salir del banco.
const prop = oc("C", { financiador_id: "bfk", monto_total: 0, eventos_compra: [{ fecha: "2024-06-26", costo_compra: 121518 }] });
const rc = resumenCaja({ ...vacio, financiadores: fin.map((f) => ({ ...f, saldo_deuda: 0 })), ocs: [prop], saldoBanco: { saldo: 0, fecha_corte: "2026-10-07" } });
eq("compra anterior a la apertura: caja −121518, proyección 0", [rc.caja, rc.saldoProyectado], [-121518, 0]);
eq("abonos − cargos en un período no incluyen lo anterior al período",
  movimientosCaja({ ...vacio, ocs: [prop] }).filter((m) => m.fecha >= "2024-07-15").reduce((s, m) => s + m.monto, 0), 0);

// 6. Ventas externas: no son venta ni utilidad de BFK.
const ext = oc("X", { tipo_registro: "externa", es_venta_propia: true, monto_total: 400001, costo_total: 258498, fecha_emision_mp: "2026-09-15",
  eventos_pago_cliente: [{ fecha: "2026-09-20", monto: 400001, medio_pago: "fuera_banco" }] });
const v1 = oc("V1", { monto_total: 1000, costo_total: 600, fecha_emision_mp: "2026-09-02", eventos_compra: [{ fecha: "2026-10-01", costo_compra: 600 }], eventos_postventa: [{ costo_extra: 100 }] });
const v2 = oc("V2", { monto_total: 3000, costo_total: 2700, fecha_emision_mp: "2026-10-03", eventos_compra: [{ fecha: "2026-10-04", costo_compra: 2700 }] });
const u = utilidadPorMes([ext, v1, v2, oc("Z", { archivada: true, monto_total: 9999, fecha_emision_mp: "2026-09-01" })]);
eq("utilidad por mes: fecha de la OC (no de la compra), con postventa, sin externas ni archivadas", u["2026-09"], { venta: 1000, costo: 700, util: 300, n: 1, pct: 30 });
eq("utilidad por mes: margen agregado del mes", u["2026-10"], { venta: 3000, costo: 2700, util: 300, n: 1, pct: 10 });
eq("venta externa: no aporta a por cobrar", ingresoPendienteOC(ext), 0);

console.log(`\nRESUMEN pruebas cuadratura financiera (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
