// Conciliación BancoEstado 2026-10: qué entra (y qué no) a la caja. node --test docs/pruebas-conciliacion/
import { test } from "node:test";
import assert from "node:assert/strict";
import { movimientosCaja, resumenCaja } from "../../src/lib/caja.js";
import { cobradoEnBanco, cobradoDelCliente, ingresoPendienteOC, valeVistasPendientes } from "../../src/lib/ocs.js";
import { esCobroFueraDeBanco, esValeVistaPendiente, esDocumentoBancario, cobroEnCaja, gastoEnCaja, aporteEnCaja, SUBCAT_GASTO_SIN_BANCO, MEDIO_APORTE_SIN_BANCO } from "../../src/lib/mediosPago.js";

const oc = (id, cobros, extra = {}) => ({ id, numero_oc: id, tipo_registro: "venta", monto_total: 1000, monto_facturado: 1000, costo_total: 0,
  estado_factura_propia: "emitida", eventos_pago_cliente: cobros, eventos_pago_financiamiento: [], eventos_compra: [], eventos_factura: [], ...extra });
const cobro = (monto, medio_pago, cobrado_en_banco = true, fecha = "2026-08-13") => ({ fecha, monto, medio_pago, cobrado_en_banco });

test("transferencia, vale vista cobrado y sin medio (históricos) siguen siendo caja", () => {
  for (const e of [cobro(1, "transferencia"), cobro(1, "vale_vista", true), cobro(1, "cheque", true), { fecha: "2026-01-01", monto: 1 }, cobro(1, null, null)])
    assert.equal(cobroEnCaja(e), true, JSON.stringify(e));
  assert.equal(cobroEnCaja(cobro(1, "vale_vista", false)), false);
});

test("retención y cobro fuera de banco: saldan la factura pero no son caja ni vale vista pendiente", () => {
  const o = oc("A", [cobro(991296, "transferencia"), cobro(8704, "retencion", false)], { monto_facturado: 1000000 });
  assert.equal(cobradoEnBanco(o), 991296);
  assert.equal(cobradoDelCliente(o), 1000000);
  assert.equal(ingresoPendienteOC(o), 0);
  assert.deepEqual(valeVistasPendientes(o), []);
  assert.equal(o.eventos_pago_cliente.some(esValeVistaPendiente), false);
  assert.equal(o.eventos_pago_cliente.some(esDocumentoBancario), false);
  assert.equal(esCobroFueraDeBanco(cobro(1, "fuera_banco", false)), true);
  // aunque por error quedara cobrado_en_banco = true, un cobro fuera de banco nunca es caja
  assert.equal(cobroEnCaja(cobro(1, "fuera_banco", true)), false);
});

test("caja: venta externa cobrada fuera de banco no entra ni crea pasivo externo; gasto de retención y aporte sin banco no mueven caja", () => {
  const ext = oc("EXT", [cobro(400001, "fuera_banco", false, "2026-08-06")], { tipo_registro: "externa" });
  const dgac = oc("DGAC", [cobro(426498, "transferencia", true, "2025-08-05"), cobro(8704, "retencion", false)], { monto_facturado: 435202, monto_total: 426498 });
  const gastos = [{ fecha: "2026-08-05", monto: 8704, categoria_id: "cat_ret", subcategoria: SUBCAT_GASTO_SIN_BANCO }, { fecha: "2026-08-01", monto: 1000, categoria_id: "cat_otros", subcategoria: "" }];
  const aportes = [{ fecha: "2026-07-29", tipo: "aporte", monto: 209418, medio: MEDIO_APORTE_SIN_BANCO }, { fecha: "2026-07-30", tipo: "aporte", monto: 5000, medio: "Transferencia" }];
  const movs = movimientosCaja({ ocs: [ext, dgac], financiadores: [], gastos, pagosVendedor: [], pagoFinSueltos: [], aportes });
  assert.deepEqual(movs.map((m) => [m.tipo, m.monto]).sort(), [["aporte", 5000], ["cobro", 426498], ["gasto", -1000]].sort());
  const r = resumenCaja({ ocs: [ext, dgac], financiadores: [], gastos, pagosVendedor: [], ivaMensual: [], vendedores: [], pagoFinSueltos: [], aportes, saldoBanco: null, hoy: new Date("2026-10-07") });
  assert.equal(r.caja, 430498);
  assert.equal(r.fondosExternos, 0);
  assert.equal(r.porCobrar, 0);
  assert.equal(gastoEnCaja(gastos[0]), false); assert.equal(aporteEnCaja(aportes[0]), false);
});

test("compatibilidad: sin los medios nuevos, la caja es la misma de antes", () => {
  const o1 = oc("V", [cobro(500, "transferencia"), cobro(200, "vale_vista", false), cobro(300, "cheque", true)]);
  const r = movimientosCaja({ ocs: [o1], financiadores: [], gastos: [{ fecha: "2026-01-01", monto: 50 }], pagosVendedor: [{ fecha: "2026-01-02", monto_pagado: 10 }], pagoFinSueltos: [], aportes: [{ fecha: "2026-01-03", tipo: "aporte", monto: 7 }, { fecha: "2026-01-04", tipo: "retiro", monto: 3 }] });
  assert.equal(r.reduce((s, m) => s + m.monto, 0), 500 + 300 - 50 - 10 + 7 - 3);
});
