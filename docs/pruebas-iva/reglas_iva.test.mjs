// Pruebas de la regla única de IVA neto del período (comisiones) e IVA a pagar (F29).
// Ejecutar: node docs/pruebas-iva/ejecutar.mjs   (empaqueta con esbuild y corre estas pruebas)
import { ivaNetoPeriodo, ivaAPagarPeriodo, registroIvaDe, calcularPagoVendedor } from "../../src/lib/calculos.js";
import { evaluarPagoVendedor } from "../../src/lib/pagosVendedor.js";
import { periodoF29, calcularF29 } from "../../src/lib/f29.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};

// ── IVA neto y a pagar ──
const reg = (anio, mes, iva_ventas, iva_compras, extra = {}) => ({ id: `iva_${anio}_${mes}`, anio, mes, iva_ventas, iva_compras, ...extra });
eq("neto positivo (débito > crédito)", ivaNetoPeriodo(reg(2026, 3, 190000, 50000)), 140000);
eq("neto cero (débito = crédito)", ivaNetoPeriodo(reg(2026, 3, 80000, 80000)), 0);
eq("neto negativo (crédito > débito)", ivaNetoPeriodo(reg(2026, 3, 20000, 80000)), -60000);
eq("neto sin registro = 0", ivaNetoPeriodo(null), 0);
eq("neto con textos numéricos", ivaNetoPeriodo({ iva_ventas: "1000", iva_compras: "250" }), 750);
eq("neto con nulos", ivaNetoPeriodo({ iva_ventas: null, iva_compras: 300 }), -300);
eq("a pagar positivo = neto", ivaAPagarPeriodo(reg(2026, 3, 190000, 50000)), 140000);
eq("a pagar con neto cero = 0", ivaAPagarPeriodo(reg(2026, 3, 80000, 80000)), 0);
eq("a pagar con neto negativo = 0 (remanente)", ivaAPagarPeriodo(reg(2026, 3, 20000, 80000)), 0);
eq("registroIvaDe tolera mes/año como texto", registroIvaDe([{ ...reg(2026, 3, 1, 0), mes: "3", anio: "2026" }], 2026, 3)?.iva_ventas, 1);
eq("registroIvaDe sin coincidencia = null", registroIvaDe([reg(2026, 3, 1, 0)], 2026, 4), null);

// ── Comisión ──
const oc = (id, { util = 1000000, fecha = "2026-03-15", factura = 1190000, propia = false, vend = "v1" } = {}) => ({
  id, vendedor_id: vend, estado_factura_propia: "emitida", monto_total: 1190000, costo_total: 1190000 - util, es_venta_propia: propia,
  eventos_factura: [{ id: "f" + id, fecha, monto: factura }],
});
const com = (ocs, ivaMensual, extra = {}) => calcularPagoVendedor({ vendedorId: "v1", ocs, anio: 2026, mes: 3, ivaMensual, pagosVendedor: [], ...extra });
const formulaAnterior = (util, d, c) => Math.max(0, Math.round(util / 2 - Math.max(0, d - c) / 2));

let r = com([oc("a")], [reg(2026, 3, 190000, 50000)]);
eq("IVA neto positivo: (1.000.000 − 140.000)/2", [r.pagoCalculado, r.impIva, r.ivaVentas, r.ivaCompras, r.ivaRegistrado], [430000, 140000, 190000, 50000, true]);
eq("IVA neto positivo: igual al criterio anterior", r.pagoCalculado, formulaAnterior(1000000, 190000, 50000));
r = com([oc("a")], [reg(2026, 3, 80000, 80000)]);
eq("IVA neto cero: mitad de la utilidad", [r.pagoCalculado, r.impIva], [500000, 0]);
r = com([oc("a")], [reg(2026, 3, 20000, 80000)]);
eq("IVA neto negativo: suma (1.000.000 + 60.000)/2", [r.pagoCalculado, r.impIva], [530000, -60000]);
eq("IVA neto negativo: el criterio anterior lo dejaba en 0 (500.000)", formulaAnterior(1000000, 20000, 80000), 500000);
r = com([oc("a", { util: 100000 })], [reg(2026, 3, 400000, 100000)]);
eq("resultado negativo (IVA neto > utilidad): comisión $0", [r.pagoCalculado, r.deuda, r.estado], [0, 0, "pagado"]);
r = com([oc("a", { util: -50000 })], [reg(2026, 3, 10000, 90000)]);
eq("utilidad negativa con IVA neto negativo: (−50.000 + 80.000)/2", r.pagoCalculado, 15000);
r = com([oc("a", { util: -200000 })], [reg(2026, 3, 10000, 90000)]);
eq("utilidad negativa mayor que el crédito: $0", r.pagoCalculado, 0);
r = com([oc("a")], []);
eq("período sin IVA registrado: sin descuento y marcado", [r.pagoCalculado, r.impIva, r.ivaRegistrado], [500000, 0, false]);
r = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc("a", { fecha: "2025-04-10" })], anio: 2025, mes: 4, ivaMensual: [reg(2025, 4, 10000, 90000)], pagosVendedor: [] });
eq("regla especial abril 2025: no usa IVA aunque sea negativo", [r.pagoCalculado, r.impIva, r.sinIva], [500000, 0, true]);
r = com([oc("a"), oc("p", { util: 300000, propia: true })], [reg(2026, 3, 20000, 80000)]);
eq("venta propia sin cambios (100% utilidad − IVA de su factura) + general con neto negativo", [r.pagoVentasPropias, r.pagoCalculado], [110000, 530000 + 110000]);
r = com([oc("a")], [reg(2026, 3, 20000, 80000)], { pagosVendedor: [{ vendedor_id: "v1", mes: 3, anio: 2026, monto_pagado: 480000, monto_verificado: 480000 }] });
eq("mes verificado: manda el monto verificado", [r.pagoCalculado, r.esVerificado, r.deuda], [480000, true, 0]);
r = com([oc("a")], [{ ...reg(2026, 3, 20000, 80000), mes: "3", anio: "2026" }]);
eq("registro con mes/año como texto se reconoce", [r.ivaRegistrado, r.impIva], [true, -60000]);
r = com([oc("a", { fecha: "2026-04-02" })], [reg(2026, 3, 20000, 80000)]);
eq("sin facturas en el período: null", r, null);

// ── Pagos (misma regla) ──
const ev = evaluarPagoVendedor({ vendedorId: "v1", mes: 3, anio: 2026, monto: 500000, ocs: [oc("a")], ivaMensual: [reg(2026, 3, 20000, 80000)], pagosVendedor: [] });
eq("evaluarPagoVendedor usa la misma comisión (neto negativo)", [ev.comision, ev.pendiente, ev.completo, ev.ocIds], [530000, 30000, false, []]);
const ev2 = evaluarPagoVendedor({ vendedorId: "v1", mes: 3, anio: 2026, monto: 530000, ocs: [oc("a")], ivaMensual: [reg(2026, 3, 20000, 80000)], pagosVendedor: [] });
eq("pago completo marca la OC", [ev2.completo, ev2.ocIds], [true, ["a"]]);

// ── F29 (IVA a pagar, no cambia) ──
eq("F29 período con neto positivo", periodoF29([reg(2026, 3, 190000, 50000)], [{ categoria_id: "cat_impuesto", mes: 3, anio: 2026, monto: 100000 }], 2026, 3), { anio: 2026, mes: 3, det: 140000, pag: 100000, pend: 40000 });
eq("F29 período con neto negativo: determinado 0", periodoF29([reg(2026, 3, 20000, 80000)], [], 2026, 3), { anio: 2026, mes: 3, det: 0, pag: 0, pend: 0 });
eq("F29 período con neto cero", periodoF29([reg(2026, 3, 5, 5)], [], 2026, 3).det, 0);
const f = calcularF29({ ivaMensual: [reg(2026, 2, 20000, 80000), reg(2026, 3, 190000, 50000)], gastos: [], anioActual: 2026, mesActual: 3 });
eq("F29 total suma solo lo positivo", [f.total, f.mostrados.map((x) => x.det)], [140000, [140000]]);

// ── Equivalencia con el criterio anterior cuando el IVA neto no es negativo ──
let difPos = 0, difNeg = 0, nNeg = 0;
let semilla = 7; const rnd = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
for (let k = 0; k < 2000; k++) {
  const util = rnd(3000000) - 500000, d = rnd(600000), c = rnd(600000);
  const x = com([oc("a", { util })], [reg(2026, 3, d, c)]).pagoCalculado;
  const antes = formulaAnterior(util, d, c), nuevo = Math.max(0, Math.round(util / 2 - (d - c) / 2));
  if (d - c >= 0 && x !== antes) difPos++;
  if (d - c < 0) { nNeg++; if (x !== nuevo) difNeg++; }
}
eq("2000 casos: con IVA neto ≥ 0 el resultado es idéntico al anterior", difPos, 0);
eq(`2000 casos: con IVA neto < 0 (${nNeg}) aplica utilidad − neto`, difNeg, 0);

console.log(`\nRESUMEN pruebas IVA: ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
