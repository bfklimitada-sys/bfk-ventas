// Vendedor y financiador por OC: reglas puras. node --test docs/pruebas-vendfin/reglas.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluarCambioFinanciador, evaluarCambioVendedor, faltaFinanciador, faltaVendedor, nombreFinanciador, nombreVendedor, pasaFiltroFinanciador, pasaFiltroVendedor, primerNombre, SIN } from "../../src/lib/asignaciones.js";
import { calcularPagoVendedor, mesesConFactura } from "../../src/lib/calculos.js";

const V = [{ id: "v1", nombre: "Matías Vegas" }, { id: "v2", nombre: "Juan Vergara" }];
const F = [{ id: "f1", nombre: "Kevin Vergara", tipo: "externo" }, { id: "f2", nombre: "Matías Vegas", tipo: "externo" }, { id: "fb", nombre: "Cuenta BFK", tipo: "propio" }];
const oc = (extra = {}) => ({ id: "a", numero_oc: "A", tipo_registro: "venta", estado_factura_propia: "emitida", monto_total: 119000, costo_total: 50000,
  eventos_factura: [{ id: "fa", numero_factura: "10", fecha: "2026-05-10", monto: 119000, tipo_dte: 33 }], eventos_compra: [], eventos_pago_financiamiento: [], ...extra });

test("nombres, Sin definir y faltantes", () => {
  const o = oc({ vendedor_id: "v1", financiador_id: null });
  assert.equal(nombreVendedor(o, V), "Matías Vegas"); assert.equal(primerNombre(nombreVendedor(o, V)), "Matías");
  assert.equal(nombreFinanciador(o, F), "Sin definir"); assert.equal(primerNombre("Sin definir"), "Sin definir");
  assert.equal(faltaVendedor(o), false); assert.equal(faltaFinanciador(o), true);
  assert.equal(nombreVendedor({ vendedores: { nombre: "Juan" }, vendedor_id: "x" }), "Juan");   // forma en que la app carga la OC
  assert.equal(faltaVendedor({ tipo_registro: "aporte_socio" }), false);
});

test("filtros por vendedor/financiador, incluido Sin definir", () => {
  const a = oc({ vendedor_id: "v1", financiador_id: "f1" }), b = oc({ vendedor_id: null, financiador_id: null });
  assert.deepEqual([a, b].filter((o) => pasaFiltroVendedor(o, "v1")), [a]);
  assert.deepEqual([a, b].filter((o) => pasaFiltroVendedor(o, SIN)), [b]);
  assert.deepEqual([a, b].filter((o) => pasaFiltroFinanciador(o, SIN)), [b]);
  assert.deepEqual([a, b].filter((o) => pasaFiltroFinanciador(o, "")), [a, b]);
});

test("cambio de vendedor: bloqueado si la comisión de ese mes ya se pagó a él; permitido si no", () => {
  const o = oc({ vendedor_id: "v1" });
  const pagos = [{ vendedor_id: "v1", anio: 2026, mes: 5, monto_pagado: 1 }];
  assert.equal(evaluarCambioVendedor(o, "v2", pagos).bloqueado, true);
  assert.equal(evaluarCambioVendedor(o, null, pagos).bloqueado, true);
  assert.equal(evaluarCambioVendedor(o, "v2", []).bloqueado, false);
  assert.match(evaluarCambioVendedor(o, "v2", [{ vendedor_id: "v2", anio: 2026, mes: 5 }]).avisos.join(" "), /comisión adicional/);
  assert.equal(evaluarCambioVendedor(o, "v1", pagos).sinCambios, true);
  assert.equal(evaluarCambioVendedor(oc({ vendedor_id: null }), "v1", pagos).bloqueado, false);   // asignar desde Sin definir
  assert.equal(evaluarCambioVendedor(oc({ vendedor_id: "v1", es_venta_propia: true }), null, []).bloqueado, true);
});

test("cambio de financiador: con pagos bloqueado; con compra no puede quedar sin definir y pide confirmación", () => {
  const sinCompra = oc({ financiador_id: "f1" });
  assert.equal(evaluarCambioFinanciador(sinCompra, null).bloqueado, false);
  assert.equal(evaluarCambioFinanciador(sinCompra, "f2").requiereConfirmacion, false);
  const conCompra = oc({ financiador_id: "f1", eventos_compra: [{ costo_compra: 50000 }] });
  assert.equal(evaluarCambioFinanciador(conCompra, null).bloqueado, true);
  const c = evaluarCambioFinanciador(conCompra, "f2");
  assert.equal(c.bloqueado, false); assert.equal(c.requiereConfirmacion, true); assert.match(c.avisos[0], /\$50\.000/);
  const pagada = oc({ financiador_id: "f1", eventos_compra: [{ costo_compra: 50000 }], eventos_pago_financiamiento: [{ monto: 50000 }] });
  assert.equal(evaluarCambioFinanciador(pagada, "f2").bloqueado, true);
  assert.equal(evaluarCambioFinanciador(pagada, "f1").sinCambios, true);
});

test("misma persona vendedor y financiador no altera la comisión", () => {
  const a = oc({ vendedor_id: "v1", financiador_id: "f1" }), b = oc({ vendedor_id: "v1", financiador_id: "f2" });
  const ca = calcularPagoVendedor({ vendedorId: "v1", ocs: [a], anio: 2026, mes: 5 }), cb = calcularPagoVendedor({ vendedorId: "v1", ocs: [b], anio: 2026, mes: 5 });
  assert.equal(ca.pagoCalculado, cb.pagoCalculado);
});

test("solo las ventas de BFK generan comisión (venta externa y aporte no)", () => {
  const ext = oc({ vendedor_id: "v1", tipo_registro: "externa", es_venta_propia: true });
  assert.deepEqual(mesesConFactura("v1", [ext]), []);
  assert.equal(calcularPagoVendedor({ vendedorId: "v1", ocs: [ext], anio: 2026, mes: 5 }), null);
  const venta = oc({ vendedor_id: "v1" });
  assert.equal(calcularPagoVendedor({ vendedorId: "v1", ocs: [venta, ext], anio: 2026, mes: 5 }).detalle.length, 1);
});

test("venta de capitalización BFK Ltda.: no es faltante, no genera comisión, filtro propio", async () => {
  const { esCapitalizacion, estadoComision, CAPITALIZACION, valorVendedor } = await import("../../src/lib/asignaciones.js");
  const cap = oc({ capitalizacion_bfk: true, vendedor_id: null, financiador_id: "fb" });
  const falta = oc({ vendedor_id: null });
  assert.equal(esCapitalizacion(cap), true);
  assert.equal(faltaVendedor(cap), false); assert.equal(faltaVendedor(falta), true);
  assert.equal(nombreVendedor(cap, V), "BFK Ltda. · Capitalización");
  assert.equal(valorVendedor(cap), CAPITALIZACION);
  assert.deepEqual([cap, falta].filter((o) => pasaFiltroVendedor(o, CAPITALIZACION)), [cap]);
  assert.deepEqual([cap, falta].filter((o) => pasaFiltroVendedor(o, SIN)), [falta]);
  assert.equal(estadoComision(cap).genera, false);
  assert.match(estadoComision(cap).texto, /capitalización/);
  assert.equal(nombreFinanciador(cap, F), "Cuenta BFK");   // el financiador real se mantiene
  const { tieneVendedor } = await import("../../src/lib/ocs.js");
  assert.equal(tieneVendedor(cap), true); assert.equal(tieneVendedor(falta), false);
});

test("comisión excluida (mes cerrado): figura el vendedor, no cambia la comisión del mes", async () => {
  const { estadoComision } = await import("../../src/lib/asignaciones.js");
  const base = oc({ vendedor_id: "v1" }), excl = oc({ id: "b", numero_oc: "B", vendedor_id: "v1", comision_excluida: true });
  const c1 = calcularPagoVendedor({ vendedorId: "v1", ocs: [base], anio: 2026, mes: 5 });
  const c2 = calcularPagoVendedor({ vendedorId: "v1", ocs: [base, excl], anio: 2026, mes: 5 });
  assert.equal(c1.pagoCalculado, c2.pagoCalculado); assert.equal(c2.detalle.length, 1);
  assert.deepEqual(mesesConFactura("v1", [excl]), []);
  assert.equal(nombreVendedor(excl, V), "Matías Vegas"); assert.equal(faltaVendedor(excl), false);
  assert.equal(estadoComision(excl).genera, false);
  // su vendedor se puede corregir aunque el mes esté pagado (no está en ese pago)
  assert.equal(evaluarCambioVendedor(excl, "v2", [{ vendedor_id: "v1", anio: 2026, mes: 5 }]).bloqueado, false);
});

test("cambiar a capitalización: aviso y bloqueos", async () => {
  const { CAPITALIZACION } = await import("../../src/lib/asignaciones.js");
  assert.match(evaluarCambioVendedor(oc({ vendedor_id: null }), CAPITALIZACION, []).avisos.join(" "), /capitalización/);
  assert.equal(evaluarCambioVendedor(oc({ vendedor_id: "v1" }), CAPITALIZACION, [{ vendedor_id: "v1", anio: 2026, mes: 5 }]).bloqueado, true);
  assert.equal(evaluarCambioVendedor(oc({ vendedor_id: "v1", es_venta_propia: true }), CAPITALIZACION, []).bloqueado, true);
  assert.equal(evaluarCambioVendedor(oc({ capitalizacion_bfk: true }), CAPITALIZACION, []).sinCambios, true);
});
