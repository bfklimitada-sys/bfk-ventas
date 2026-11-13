// Pruebas: comisión ligada a la OC y a su liquidación original, VIGENTE DESDE OCTUBRE 2026 (13/11/2026, condiciones de Kevin).
//  1. Antes de octubre 2026 nada se recalcula: cada mes anterior da EXACTAMENTE lo mismo que la versión publicada (3ac3a64).
//  2. OC pagada antes de octubre y refacturada (dos veces) hacia octubre o después: conserva su pago, sigue apareciendo en su
//     liquidación como referencia y no genera comisión en los meses de las nuevas facturas.
//  3. Desde octubre: la refacturación no mueve la comisión (no pagada, pago parcial con saldo, pagada); la cobranza sigue a la
//     factura vigente.
//  4. «Por revisar»: guardadas (1398-624 / 564162-290) sin cambios de monto ni pagos nuevos; derivadas, fuera de todo pago.
//  5. Misma regla en Comisiones (calcularPagoVendedor), pago manual (registrarPagoVendedor) y cartola (prepararPagoVendedor).
import { calcularPagoVendedor, mesesConFactura, periodoComision, liquidacionComision, facturaVigente, comisionOrdinariaPeriodo } from "../../src/lib/calculos.js";
import { evaluarPagoVendedor, prepararPagoVendedor, registrarPagoVendedor } from "../../src/lib/pagosVendedor.js";
import { ocsConSaldo } from "../../src/lib/cobranza.js";
import * as ANT from "@anterior/calculos.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };
const fac = (id, numero, fecha, monto, anula = null) => ({ id, numero_factura: numero, fecha, monto, factura_anulada_numero: anula });
const nc = (id, numero, fecha, refFolio) => ({ id, numero_factura: numero, fecha, monto: 0, tipo_dte: 61, ref_folio: refFolio, ref_codigo: 1 });
const oc = (id, vendedor, venta, costo, facturas, extra = {}) => ({ id, numero_oc: id, vendedor_id: vendedor, tipo_registro: "venta", estado_factura_propia: "emitida",
  monto_total: venta, costo_total: costo, monto_facturado: venta, monto_cobrado: 0, estado_pago_cliente: "pendiente", eventos_factura: facturas, eventos_pago_cliente: [], ...extra });
// Escritor simulado (app + disparador de la base: al marcar pagada ancla la liquidación y guarda la utilidad).
const base = (ocs, pagos = []) => ({ ocs: ocs.map((o) => ({ ...o })), pagos: [...pagos] });
const escritor = (db) => ({
  ins: async (_t, _k, fila) => { if (db.pagos.some((p) => p.id === fila.id)) throw new Error("duplicate key 23505"); db.pagos.push({ ...fila }); },
  upd: async (_t, _k, id, cambios) => { db.ocs = db.ocs.map((o) => { if (o.id !== id) return o; const n = { ...o, ...cambios };
    if (cambios.vendedor_pagado === true && !o.vendedor_pagado) { const p = periodoComision(o); n.comision_anio ??= p.anio; n.comision_mes ??= p.mes; n.comision_utilidad = n.monto_total - n.costo_total; }
    if (cambios.vendedor_pagado === false && o.vendedor_pagado) n.comision_utilidad = null;
    return n; }); },
});
const pagar = (db, { vendedorId = "m", mes, anio, monto, id }) => registrarPagoVendedor({ ...escritor(db), token: "t", id, vendedorId, monto, fecha: "2026-11-13", mes, anio, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
const refacturar = (db, ocId, nuevas) => { db.ocs = db.ocs.map((o) => (o.id === ocId ? { ...o, eventos_factura: [...o.eventos_factura, ...nuevas] } : o)); };
const c = (db, anio, mes, v = "m") => calcularPagoVendedor({ vendedorId: v, ocs: db.ocs, anio, mes, ivaMensual: [], pagosVendedor: db.pagos });
const cAnt = (db, anio, mes, v = "m") => ANT.calcularPagoVendedor({ vendedorId: v, ocs: db.ocs, anio, mes, ivaMensual: [], pagosVendedor: db.pagos });
const n = (x) => (x ? { calculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, ocs: x.detalle.map((l) => l.numero_oc).sort() } : null);
const numerico = (x) => (x ? { pagoCalculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, porRegularizar: x.porRegularizar, sumaUtilidad: x.sumaUtilidad, comisionOrdinaria: x.comisionOrdinaria, detalle: x.detalle.map((l) => [l.numero_oc, l.utilidad]) } : null);

// ── 1. OC pagada en junio y refacturada dos veces (agosto y octubre) ─────────────────────────────────
let db = base([oc("J", "m", 300000, 200000, [fac("j1", "100", "2026-06-10", 300000)]), oc("H", "m", 100000, 60000, [fac("h1", "110", "2026-06-20", 100000)])]);
eq("junio antes de pagar: (100.000 + 40.000)/2", n(c(db, 2026, 6)), { calculado: 70000, pagado: 0, deuda: 70000, ocs: ["H", "J"] });
let r = await pagar(db, { mes: 6, anio: 2026, monto: 70000, id: "p-jun" });
eq("pago manual de junio: marca J y H; ancla junio", [r.ocIds.sort(), db.ocs.find((o) => o.id === "J").comision_mes], [["H", "J"], 6]);
refacturar(db, "J", [fac("j2", "150", "2026-08-05", 300000, "100")]);
refacturar(db, "J", [nc("j3", "60", "2026-10-07", "150"), fac("j4", "190", "2026-10-07", 300000)]);
db.ocs.push(oc("K", "m", 200000, 150000, [fac("k1", "191", "2026-10-09", 200000)]));
const J = db.ocs.find((o) => o.id === "J");
eq("J: la cobranza sigue a la factura vigente (N° 190, octubre)", [facturaVigente(J)?.numero_factura, ocsConSaldo(db.ocs).find((x) => x.oc.id === "J")?.fechaFactura], ["190", "2026-10-07"]);
eq("J: liquidación junio; no cuenta en ningún mes nuevo (ya pagada)", [liquidacionComision(J).liquidacion, liquidacionComision(J).periodo], [{ anio: 2026, mes: 6 }, null]);
eq("junio conserva su pago ($70.000) y su cálculo es el de la versión publicada (sin recalcular)", [c(db, 2026, 6).pagado, JSON.stringify(numerico(c(db, 2026, 6))) === JSON.stringify(numerico(cAnt(db, 2026, 6)))], [70000, true]);
eq("J sigue apareciendo en junio (pagada en esa liquidación, factura vigente de octubre)", c(db, 2026, 6).liquidadasAqui, [{ ocId: "J", numero_oc: "J", facturaVigenteMes: { anio: 2026, mes: 10 }, utilidad: 100000 }]);
eq("agosto (1ª nueva factura): sin comisión", c(db, 2026, 8), null);
eq("octubre (2ª nueva factura): solo K; J no genera comisión", n(c(db, 2026, 10)), { calculado: 25000, pagado: 0, deuda: 25000, ocs: ["K"] });
eq("versión publicada (para comparar): octubre SÍ contaba J otra vez (duplicado)", n(cAnt(db, 2026, 10)).ocs, ["J", "K"]);
eq("octubre informa J como ya pagada en junio", c(db, 2026, 10).refacturadasFuera, [{ ocId: "J", numero_oc: "J", liquidacion: { anio: 2026, mes: 6 }, pagada: true }]);
let ev = evaluarPagoVendedor({ vendedorId: "m", mes: 10, anio: 2026, monto: 25000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago manual de octubre: $25.000, marca solo K", [ev.comision, ev.ocIds], [25000, ["K"]]);
const cart = prepararPagoVendedor({ userId: "u", id: "p-c", vendedorId: "m", monto: 25000, fecha: "2026-11-13", mes: 10, anio: 2026, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("cartola (fila para la base): misma comisión, solo K", [cart.fila.monto_pagado, cart.fila.monto_extra_gestion, cart.ocIds], [25000, 0, ["K"]]);

// ── 2. Pagos parciales ──────────────────────────────────────────────────────────────────────────────
// 2a. Desde octubre: P liquidada en octubre, abono parcial, refacturada en diciembre → octubre conserva lo abonado y el saldo.
db = base([oc("P", "m", 500000, 300000, [fac("p1", "200", "2026-10-15", 500000)]), oc("Q", "m", 100000, 50000, [fac("q1", "201", "2026-10-20", 100000)])]);
r = await pagar(db, { mes: 10, anio: 2026, monto: 50000, id: "p-oct-1" });
eq("octubre: abono parcial $50.000 de $125.000, no marca OC", [r.pagoComision, r.ocIds], [50000, []]);
refacturar(db, "P", [nc("p2", "70", "2026-12-03", "200"), fac("p3", "230", "2026-12-03", 500000)]);
eq("P refacturada en diciembre: cuenta en octubre", periodoComision(db.ocs.find((o) => o.id === "P")), { anio: 2026, mes: 10 });
eq("octubre reconoce lo abonado y conserva solo el saldo", n(c(db, 2026, 10)), { calculado: 125000, pagado: 50000, deuda: 75000, ocs: ["P", "Q"] });
eq("diciembre: P no genera comisión", c(db, 2026, 12), null);
r = await pagar(db, { mes: 10, anio: 2026, monto: 75000, id: "p-oct-2" });
eq("pagar el saldo completa octubre y marca P y Q en octubre", [c(db, 2026, 10).deuda, r.ocIds.sort(), db.ocs.find((o) => o.id === "P").comision_mes], [0, ["P", "Q"], 10]);
// 2b. Antes de octubre: septiembre con abono parcial; S refacturada en noviembre → por revisar, fuera de noviembre y de todo pago.
db = base([oc("S", "m", 400000, 200000, [fac("s1", "300", "2026-09-10", 400000)]), oc("T", "m", 200000, 100000, [fac("t1", "320", "2026-11-05", 200000)])],
  [{ id: "pv9", vendedor_id: "m", anio: 2026, mes: 9, monto_pagado: 40000 }]);
refacturar(db, "S", [nc("s2", "80", "2026-11-12", "300"), fac("s3", "330", "2026-11-12", 400000)]);
const liqS = liquidacionComision(db.ocs.find((o) => o.id === "S"), db.pagos);
eq("S (liquidación septiembre con abono parcial, refacturada en noviembre): por revisar y excluida", [liqS.porRevisar, liqS.excluida], [true, true]);
eq("noviembre: solo T; S listada por revisar", [n(c(db, 2026, 11)).ocs, c(db, 2026, 11).porRevisar.map((x) => [x.numero_oc, x.incluida])], [["T"], [["S", false]]]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago de noviembre: no incluye ni marca S", [ev.comision, ev.ocIds], [50000, ["T"]]);
eq("septiembre (anterior a octubre): igual a la versión publicada", JSON.stringify(numerico(c(db, 2026, 9))) === JSON.stringify(numerico(cAnt(db, 2026, 9))), true);
eq("revisada «no estaba pagada»: S vuelve a contar en noviembre", n(calcularPagoVendedor({ vendedorId: "m", ocs: db.ocs.map((o) => (o.id === "S" ? { ...o, comision_revision: "revisada" } : o)), anio: 2026, mes: 11, pagosVendedor: db.pagos })).ocs, ["S", "T"]);

// ── 3. OC aún no pagada ─────────────────────────────────────────────────────────────────────────────
db = base([oc("U", "m", 400000, 300000, [fac("u1", "300", "2026-10-20", 400000)]), oc("N", "m", 200000, 100000, [fac("n1", "320", "2026-11-05", 200000)])]);
refacturar(db, "U", [nc("u2", "80", "2026-11-13", "300"), fac("u3", "330", "2026-11-13", 400000)]);
eq("U (octubre, no pagada) refacturada en noviembre: cuenta en octubre", [n(c(db, 2026, 10)).ocs, n(c(db, 2026, 11)).ocs], [["U"], ["N"]]);
eq("pago de noviembre marca solo N; cobranza de U con la factura 330", [evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos }).ocIds, facturaVigente(db.ocs.find((o) => o.id === "U"))?.numero_factura], [["N"], "330"]);
// No pagada, liquidación anterior SIN pagos en ese mes, refacturada hacia la vigencia: cuenta donde hoy (mes de la factura vigente).
db = base([oc("W", "m", 300000, 200000, [fac("w1", "400", "2026-09-20", 300000), fac("w2", "410", "2026-10-03", 300000, "400")])]);
eq("no pagada sin pagos en su mes original (septiembre): cuenta en octubre, como hoy", [periodoComision(db.ocs[0]), n(c(db, 2026, 10)).ocs, n(cAnt(db, 2026, 10)).ocs], [{ anio: 2026, mes: 10 }, ["W"], ["W"]]);

// ── 4. Varios vendedores en un mes nuevo: la refacturada pagada no altera el reparto ──────────────────
db = base([oc("A1", "a", 300000, 100000, [fac("a1", "500", "2026-10-02", 300000), fac("a3", "510", "2026-11-10", 300000, "500")], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 10 }),
  oc("B1", "b", 300000, 200000, [fac("b1", "501", "2026-11-04", 300000)]), oc("A2", "a", 100000, 0, [fac("a2", "502", "2026-11-06", 100000)])]);
const per = comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 11, ivaMensual: [] });
eq("noviembre (2 vendedores): utilidades sin la OC de octubre ya pagada", [per.utilidades.get("a"), per.utilidades.get("b"), per.total], [100000, 100000, 100000]);
eq("octubre conserva la OC del vendedor a", comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 10, ivaMensual: [] }).utilidades.get("a"), 200000);

// ── 5. «Por revisar» guardadas (como 1398-624 y 564162-290): sin cambios de monto, sin pagos nuevos ───
const doble = oc("D", "m", 311999, 239960, [fac("d1", "204", "2026-06-04", 311999), fac("d2", "205", "2026-08-14", 311999, "204")],
  { vendedor_pagado: true, comision_anio: 2026, comision_mes: 8, comision_revision: "por_revisar", comision_revision_motivo: "Posible pago en dos liquidaciones: 06/2026 y 08/2026" });
const otraAgo = oc("E", "m", 100000, 50000, [fac("e1", "206", "2026-08-20", 100000)]);
db = base([doble, otraAgo], [{ id: "pv8", vendedor_id: "m", anio: 2026, mes: 8, monto_pagado: 61020 }]);
eq("agosto con la OC por revisar: montos idénticos a la versión publicada", JSON.stringify(numerico(c(db, 2026, 8))) === JSON.stringify(numerico(cAnt(db, 2026, 8))), true);
eq("agosto: aviso por revisar (incluida, ya pagada); junio no la recupera", [c(db, 2026, 8).porRevisar.map((x) => [x.numero_oc, x.incluida]), c(db, 2026, 6)], [[["D", true]], null]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 8, anio: 2026, monto: 100000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("un pago adicional a agosto no marca la OC por revisar", ev.ocIds.includes("D"), false);

// ── 6. Antes de octubre, ningún mes cambia (conjunto mixto, comparado con la versión publicada) ──────
const mix = base([
  oc("M1", "m", 239200, 222970, [fac("m1", "257", "2026-07-22", 239200), fac("m2", "295", "2026-08-13", 239200, "257")], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 8 }),
  oc("M2", "m", 183302, 139770, [fac("m3", "267", "2026-07-25", 183302), nc("m4", "59", "2026-10-15", "267"), fac("m5", "349", "2026-10-15", 183302)], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 7 }),
  oc("M3", "m", 200000, 100000, [fac("m6", "10", "2026-07-10", 200000)], { vendedor_pagado: true }),
  oc("M4", "m", 187200, 150960, [fac("m7", "163", "2026-05-04", 124800), fac("m8", "164", "2026-05-04", 62400)]),
  oc("M5", "m", 172900, 143960, [fac("m9", "227", "2026-06-30", 172900), fac("m10", "227", "2026-07-30", 172900, "225")], { vendedor_pagado: true }),
], [{ id: "x7", vendedor_id: "m", anio: 2026, mes: 7, monto_pagado: 90000 }, { id: "x5", vendedor_id: "m", anio: 2026, mes: 5, monto_pagado: 1000, monto_verificado: 18120 }]);
let iguales = 0; const distintos = [];
for (let m = 1; m <= 9; m++) { JSON.stringify(numerico(c(mix, 2026, m))) === JSON.stringify(numerico(cAnt(mix, 2026, m))) ? iguales++ : distintos.push(m); }
eq("enero–septiembre 2026: los 9 meses idénticos a la versión publicada", [iguales, distintos], [9, []]);
eq("meses con comisión anteriores a octubre: los mismos que antes", mesesConFactura("m", mix.ocs).filter((x) => x.anio * 12 + x.mes < 2026 * 12 + 10), ANT.mesesConFactura("m", mix.ocs).filter((x) => x.anio * 12 + x.mes < 2026 * 12 + 10));
eq("octubre: la OC pagada en julio (M2, refacturada en octubre) ya no genera comisión", [n(c(mix, 2026, 10)), n(cAnt(mix, 2026, 10))?.ocs], [null, ["M2"]]);

console.log(`RESUMEN comisión ligada a la liquidación de la OC: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
