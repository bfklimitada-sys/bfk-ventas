// Pruebas: la comisión queda ligada a la OC y a su liquidación original (13/11/2026).
// Casos pedidos por Kevin: OC pagada en junio y refacturada dos veces (sigue en junio, sin comisión en los meses de las
// nuevas facturas, cobranza con la factura nueva), OC con pago parcial (se reconoce lo abonado, queda el saldo) y OC aún
// no pagada. Más: «Por revisar», ajuste de utilidad aparte, reparto del período con varios vendedores, y la misma regla en
// Comisiones (calcularPagoVendedor), pago manual (registrarPagoVendedor) y cartola (prepararPagoVendedor, la fila que
// recibe la función de la base).
import { calcularPagoVendedor, mesesConFactura, periodoComision, liquidacionComision, facturaVigente, comisionOrdinariaPeriodo } from "../../src/lib/calculos.js";
import { evaluarPagoVendedor, prepararPagoVendedor, registrarPagoVendedor } from "../../src/lib/pagosVendedor.js";
import { ocsConSaldo } from "../../src/lib/cobranza.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };
const fac = (id, numero, fecha, monto, anula = null) => ({ id, numero_factura: numero, fecha, monto, factura_anulada_numero: anula });
const nc = (id, numero, fecha, monto, refFolio) => ({ id, numero_factura: numero, fecha, monto: 0, tipo_dte: 61, ref_folio: refFolio, ref_codigo: 1 });
const oc = (id, vendedor, venta, costo, facturas, extra = {}) => ({ id, numero_oc: id, vendedor_id: vendedor, tipo_registro: "venta", estado_factura_propia: "emitida",
  monto_total: venta, costo_total: costo, monto_facturado: venta, monto_cobrado: 0, estado_pago_cliente: "pendiente", eventos_factura: facturas, eventos_pago_cliente: [], ...extra });
// Escritor simulado: lo que hacen la app y la base (incluido el disparador: al marcar pagada ancla la liquidación y
// guarda la utilidad liquidada).
const base = (ocs, pagos = []) => ({ ocs: ocs.map((o) => ({ ...o })), pagos: [...pagos] });
const escritor = (db) => ({
  ins: async (tabla, _t, fila) => { if (db.pagos.some((p) => p.id === fila.id)) throw new Error("duplicate key 23505"); db.pagos.push({ ...fila, creadoEn: "2026-11-13T12:00:00Z" }); },
  upd: async (tabla, _t, id, cambios) => { db.ocs = db.ocs.map((o) => { if (o.id !== id) return o;
    const n = { ...o, ...cambios };
    if (cambios.vendedor_pagado === true && !o.vendedor_pagado) { const p = periodoComision(o); n.comision_anio ??= p.anio; n.comision_mes ??= p.mes; n.comision_utilidad = n.monto_total - n.costo_total; }
    if (cambios.vendedor_pagado === false && o.vendedor_pagado) n.comision_utilidad = null;
    return n; }); },
});
const pagar = async (db, { vendedorId, mes, anio, monto, id }) => { const w = escritor(db);
  return registrarPagoVendedor({ ...w, token: "t", id, vendedorId, monto, fecha: "2026-11-13", mes, anio, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos }); };
const refacturar = (db, ocId, nueva) => { db.ocs = db.ocs.map((o) => (o.id === ocId ? { ...o, eventos_factura: [...o.eventos_factura, ...nueva] } : o)); };
const c = (db, v, anio, mes) => calcularPagoVendedor({ vendedorId: v, ocs: db.ocs, anio, mes, ivaMensual: [], pagosVendedor: db.pagos });
const n = (x) => (x ? { calculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, ocs: x.detalle.map((l) => l.numero_oc).sort() } : null);

// ── 1. OC pagada en junio y refacturada dos veces ───────────────────────────────────────────────────
// Junio 2026 (antes de la regla del período): comisión = (utilidad − IVA neto 0) / 2.
let db = base([oc("J", "m", 300000, 200000, [fac("j1", "100", "2026-06-10", 300000)]), oc("H", "m", 100000, 60000, [fac("h1", "110", "2026-06-20", 100000)])]);
const junioAntes = n(c(db, "m", 2026, 6));
eq("junio antes de pagar: J y H, comisión (100.000 + 40.000)/2", junioAntes, { calculado: 70000, pagado: 0, deuda: 70000, ocs: ["H", "J"] });
let r = await pagar(db, { vendedorId: "m", mes: 6, anio: 2026, monto: 70000, id: "p-jun" });
eq("pago manual de junio completo: marca J y H pagadas", [r.ocIds.sort(), db.ocs.filter((o) => o.vendedor_pagado).map((o) => o.id).sort()], [["H", "J"], ["H", "J"]]);
eq("al quedar pagada: liquidación junio y utilidad liquidada guardadas", ["comision_anio", "comision_mes", "comision_utilidad"].map((k) => db.ocs.find((o) => o.id === "J")[k]), [2026, 6, 100000]);
refacturar(db, "J", [fac("j2", "150", "2026-08-05", 300000, "100")]);                    // 1ª refacturación (agosto)
refacturar(db, "J", [nc("j3", "60", "2026-10-07", 0, "150"), fac("j4", "190", "2026-10-07", 300000)]);   // 2ª (octubre, NC código 1)
db.ocs.push(oc("K", "m", 200000, 150000, [fac("k1", "191", "2026-10-09", 200000)]));     // otra venta de octubre
const J = db.ocs.find((o) => o.id === "J");
eq("J: la cobranza sigue a la factura nueva (N° 190, octubre)", [facturaVigente(J)?.numero_factura, ocsConSaldo(db.ocs).find((x) => x.oc.id === "J")?.fechaFactura], ["190", "2026-10-07"]);
eq("J: su comisión sigue en junio", periodoComision(J), { anio: 2026, mes: 6 });
eq("junio después de refacturar dos veces: mismo cálculo, pagado, sin deuda", n(c(db, "m", 2026, 6)), { calculado: 70000, pagado: 70000, deuda: 0, ocs: ["H", "J"] });
eq("J aparece en junio marcada como refacturada en octubre", c(db, "m", 2026, 6).detalle.find((l) => l.numero_oc === "J")?.facturaVigenteMes, { anio: 2026, mes: 10 });
eq("agosto (1ª nueva factura): sin comisión", c(db, "m", 2026, 8), null);
eq("octubre (2ª nueva factura): solo K; J no genera comisión", n(c(db, "m", 2026, 10)), { calculado: 25000, pagado: 0, deuda: 25000, ocs: ["K"] });
eq("octubre informa J como no incluida (liquidada y pagada en junio)", c(db, "m", 2026, 10).refacturadasFuera, [{ ocId: "J", numero_oc: "J", liquidacion: { anio: 2026, mes: 6 }, pagada: true }]);
eq("meses con comisión: junio y octubre (agosto no)", mesesConFactura("m", db.ocs).map((x) => `${x.anio}-${x.mes}`), ["2026-10", "2026-6"]);
let ev = evaluarPagoVendedor({ vendedorId: "m", mes: 10, anio: 2026, monto: 25000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago manual de octubre: $25.000, marca solo K", [ev.comision, ev.ocIds], [25000, ["K"]]);
const cartola = prepararPagoVendedor({ userId: "u", id: "p-cart", vendedorId: "m", monto: 25000, fecha: "2026-11-13", mes: 10, anio: 2026, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("cartola (fila para la base): misma comisión y solo K", [cartola.fila.monto_pagado, cartola.fila.monto_extra_gestion, cartola.ocIds], [25000, 0, ["K"]]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 8, anio: 2026, monto: 10000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("un pago imputado a agosto no encuentra comisión: todo es extra y no marca J", [ev.comision, ev.pagoComision, ev.extraGestion, ev.ocIds], [0, 0, 10000, []]);
// Cambio de utilidad después de liquidada (la refacturación cambió el monto): ajuste aparte.
db.ocs = db.ocs.map((o) => (o.id === "J" ? { ...o, monto_total: 320000 } : o));
const jun2 = c(db, "m", 2026, 6);
eq("utilidad cambiada: junio sigue con la utilidad liquidada y sin deuda", [jun2.pagoCalculado, jun2.deuda, jun2.sumaUtilidad], [70000, 0, 140000]);
eq("utilidad cambiada: diferencia aparte para revisar (+20.000), no entra al saldo", [jun2.ajusteUtilidadTotal, jun2.ajustesUtilidad[0].utilidadLiquidada, jun2.ajustesUtilidad[0].utilidadActual], [20000, 100000, 120000]);

// ── 2. OC con pago parcial ──────────────────────────────────────────────────────────────────────────
db = base([oc("P", "m", 500000, 300000, [fac("p1", "200", "2026-07-15", 500000)]), oc("Q", "m", 100000, 50000, [fac("q1", "201", "2026-07-20", 100000)])]);
eq("julio: comisión (200.000 + 50.000)/2 = 125.000", c(db, "m", 2026, 7).pagoCalculado, 125000);
r = await pagar(db, { vendedorId: "m", mes: 7, anio: 2026, monto: 50000, id: "p-jul-1" });
eq("abono parcial de $50.000: no marca OC (julio no queda cubierto)", [r.pagoComision, r.ocIds, db.ocs.some((o) => o.vendedor_pagado)], [50000, [], false]);
refacturar(db, "P", [nc("p2", "70", "2026-09-03", 0, "200"), fac("p3", "230", "2026-09-03", 500000)]);
eq("P refacturada en septiembre: su comisión sigue en julio", periodoComision(db.ocs.find((o) => o.id === "P")), { anio: 2026, mes: 7 });
eq("julio reconoce lo abonado y conserva solo el saldo", n(c(db, "m", 2026, 7)), { calculado: 125000, pagado: 50000, deuda: 75000, ocs: ["P", "Q"] });
eq("septiembre: P no genera comisión", c(db, "m", 2026, 9), null);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 7, anio: 2026, monto: 75000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pagar el saldo de julio ($75.000) cubre el mes y marca P y Q en julio", [ev.pendienteAntes, ev.pagoComision, ev.extraGestion, ev.ocIds.sort()], [75000, 75000, 0, ["P", "Q"]]);
r = await pagar(db, { vendedorId: "m", mes: 7, anio: 2026, monto: 75000, id: "p-jul-2" });
eq("después del saldo: julio pagado, P liquidada en julio", [c(db, "m", 2026, 7).deuda, db.ocs.find((o) => o.id === "P").comision_mes], [0, 7]);
await pagar(db, { vendedorId: "m", mes: 7, anio: 2026, monto: 75000, id: "p-jul-2" }).then(() => eq("doble envío del mismo pago", "registrado", "rechazado"), () => eq("doble envío del mismo pago: rechazado (sin duplicar)", db.pagos.length, 2));

// ── 3. OC aún no pagada ─────────────────────────────────────────────────────────────────────────────
db = base([oc("U", "m", 400000, 300000, [fac("u1", "300", "2026-10-20", 400000)]), oc("N", "m", 200000, 100000, [fac("n1", "320", "2026-11-05", 200000)])]);
refacturar(db, "U", [nc("u2", "80", "2026-11-13", 0, "300"), fac("u3", "330", "2026-11-13", 400000)]);
eq("U no pagada y refacturada en noviembre: se liquida en octubre (su liquidación original)", periodoComision(db.ocs.find((o) => o.id === "U")), { anio: 2026, mes: 10 });
eq("octubre: U pendiente", n(c(db, "m", 2026, 10)), { calculado: 50000, pagado: 0, deuda: 50000, ocs: ["U"] });
eq("noviembre: solo N (U no entra)", n(c(db, "m", 2026, 11)), { calculado: 50000, pagado: 0, deuda: 50000, ocs: ["N"] });
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago de noviembre: marca solo N", ev.ocIds, ["N"]);
eq("cobranza de U con la factura nueva (N° 330)", facturaVigente(db.ocs.find((o) => o.id === "U"))?.numero_factura, "330");

// ── 4. Varios vendedores (regla del período desde octubre 2026): la refacturada no altera el reparto del mes nuevo ──
db = base([oc("A1", "a", 300000, 100000, [fac("a1", "400", "2026-10-02", 300000)]), oc("B1", "b", 300000, 200000, [fac("b1", "401", "2026-11-04", 300000)]),
  oc("A2", "a", 100000, 0, [fac("a2", "402", "2026-11-06", 100000)])]);
refacturar(db, "A1", [fac("a3", "410", "2026-11-10", 300000, "400")]);
const per = comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 11, ivaMensual: [] });
eq("noviembre (2 vendedores): utilidades sin la OC refacturada de octubre", [per.utilidades.get("a"), per.utilidades.get("b"), per.total], [100000, 100000, 100000]);
eq("octubre conserva la OC refacturada del vendedor a", comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 10, ivaMensual: [] }).utilidades.get("a"), 200000);

// ── 5. «Por revisar» ────────────────────────────────────────────────────────────────────────────────
// Liquidación original verificada (planilla sin detalle por OC) y OC no marcada: no se puede comprobar si quedó cubierta.
db = base([oc("R", "m", 200000, 100000, [fac("r1", "500", "2026-05-12", 200000)]), oc("S", "m", 300000, 200000, [fac("s1", "520", "2026-08-08", 300000)])],
  [{ id: "pv5", vendedor_id: "m", anio: 2026, mes: 5, monto_pagado: 450000, monto_verificado: 450000, fecha: "2026-05-31" }]);
refacturar(db, "R", [fac("r2", "510", "2026-08-02", 200000, "500")]);
const liqR = liquidacionComision(db.ocs.find((o) => o.id === "R"));
eq("R: por revisar (liquidación original verificada sin detalle), excluida", [liqR.porRevisar, liqR.excluida, liqR.periodo], [true, true, { anio: 2026, mes: 5 }]);
eq("agosto: R no entra; solo S", n(c(db, "m", 2026, 8)), { calculado: 50000, pagado: 0, deuda: 0 + 50000, ocs: ["S"] });
const may = c(db, "m", 2026, 5);
eq("mayo: R listada por revisar, fuera del cálculo; el monto verificado no cambia", [may.porRevisar.map((x) => [x.numero_oc, x.incluida]), may.pagoCalculado, may.detalle.length], [[["R", false]], 450000, 0]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 5, anio: 2026, monto: 1, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago a mayo: no marca R (por revisar)", [ev.ocIds, ev.porRevisar.map((x) => x.numero_oc)], [[], ["R"]]);
// Revisada: «no estaba pagada» → vuelve al cálculo de su liquidación original; «ya estaba pagada» → se marca pagada allí.
eq("revisada (no estaba pagada): deja de estar por revisar", liquidacionComision({ ...db.ocs.find((o) => o.id === "R"), comision_revision: "revisada" }).porRevisar, false);
// Marcada por revisar en la base (posible pago en dos liquidaciones) y ya pagada: se conserva donde se pagó, con aviso.
const doble = oc("D", "m", 311999, 239960, [fac("d1", "204", "2026-06-04", 311999), fac("d2", "205", "2026-08-14", 311999, "204")],
  { vendedor_pagado: true, comision_anio: 2026, comision_mes: 8, comision_revision: "por_revisar", comision_revision_motivo: "Posible pago en dos liquidaciones: 06/2026 y 08/2026" });
const ago = calcularPagoVendedor({ vendedorId: "m", ocs: [doble], anio: 2026, mes: 8 });
eq("doble posible: se conserva en agosto (pagada), con aviso, incluida", [ago.detalle.map((l) => l.numero_oc), ago.porRevisar.map((x) => [x.numero_oc, x.incluida])], [["D"], [["D", true]]]);
eq("doble posible: junio no la recupera", calcularPagoVendedor({ vendedorId: "m", ocs: [doble], anio: 2026, mes: 6 }), null);

// ── 6. Sin refacturación nada cambia ────────────────────────────────────────────────────────────────
const parcial2 = oc("Z", "m", 187200, 150960, [fac("z1", "163", "2026-05-04", 124800), fac("z2", "164", "2026-05-04", 62400)]);
eq("facturas parciales sin anulación: mes de la vigente más reciente (sin cambios)", [periodoComision(parcial2), liquidacionComision(parcial2).refacturada], [{ anio: 2026, mes: 5 }, false]);
const dosVig = oc("Y", "m", 10, 5, [fac("y1", "1", "2026-06-30", 10), fac("y2", "2", "2026-07-30", 10)]);
eq("dos facturas vigentes en meses distintos: mes de la más reciente (sin cambios)", periodoComision(dosVig), { anio: 2026, mes: 7 });

console.log(`RESUMEN comisión ligada a la liquidación de la OC: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
