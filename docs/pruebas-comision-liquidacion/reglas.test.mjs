// Pruebas: comisión ligada a la OC y a su liquidación original, VIGENTE DESDE NOVIEMBRE 2026 (13/11/2026; octubre queda como estaba).
//  1. Antes de noviembre 2026 (octubre incluido) nada se recalcula: cada mes anterior da EXACTAMENTE lo mismo que la versión publicada (3ac3a64).
//  2. OC pagada antes de noviembre y refacturada (dos veces) hacia noviembre o después: conserva su pago, sigue apareciendo en su
//     liquidación como referencia y no genera comisión en los meses de las nuevas facturas.
//  3. Desde noviembre: la refacturación no mueve la comisión (no pagada, pago parcial con saldo, pagada); la cobranza sigue a la
//     factura vigente.
//  4. «Por revisar»: guardadas (1398-624 / 564162-290) sin cambios de monto ni pagos nuevos; derivadas, fuera de todo pago.
//  5. Misma regla en Comisiones (calcularPagoVendedor), pago manual (registrarPagoVendedor) y cartola (prepararPagoVendedor).
import { calcularPagoVendedor, mesesConFactura, periodoComision, liquidacionComision, facturaVigente, comisionOrdinariaPeriodo, textoNoIncluida } from "../../src/lib/calculos.js";
import { evaluarPagoVendedor, prepararPagoVendedor, registrarPagoVendedor } from "../../src/lib/pagosVendedor.js";
import { ocsConSaldo } from "../../src/lib/cobranza.js";
import * as ANT from "@anterior/calculos.js";
import * as VIG from "@vigente/calculos.js";   // versión en producción hasta esta regla (460951e): la usa la migración

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
// Migración 2026-11-13-comision-periodo-cerrado (13/11/2026): registra el mes en que cada OC con comisión cuenta HOY, si es
// octubre 2026 o anterior, con la regla vigente hasta ahora (la misma que la función de la base).
const cerrar = (db) => { db.ocs = db.ocs.map((o) => { if (!o.vendedor_id || !VIG.generaComision(o) || o.comision_cierre_anio != null) return o;
  const p = VIG.periodoComision(o); return p && p.anio * 12 + p.mes < 2026 * 12 + 11 ? { ...o, comision_cierre_anio: p.anio, comision_cierre_mes: p.mes } : o; }); };
const pagar = (db, { vendedorId = "m", mes, anio, monto, id }) => registrarPagoVendedor({ ...escritor(db), token: "t", id, vendedorId, monto, fecha: "2026-11-13", mes, anio, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
const refacturar = (db, ocId, nuevas) => { db.ocs = db.ocs.map((o) => (o.id === ocId ? { ...o, eventos_factura: [...o.eventos_factura, ...nuevas] } : o)); };
const c = (db, anio, mes, v = "m") => calcularPagoVendedor({ vendedorId: v, ocs: db.ocs, anio, mes, ivaMensual: [], pagosVendedor: db.pagos });
const cAnt = (db, anio, mes, v = "m") => ANT.calcularPagoVendedor({ vendedorId: v, ocs: db.ocs, anio, mes, ivaMensual: [], pagosVendedor: db.pagos });
const n = (x) => (x ? { calculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, ocs: x.detalle.map((l) => l.numero_oc).sort() } : null);
const numerico = (x) => (x ? { pagoCalculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, porRegularizar: x.porRegularizar, sumaUtilidad: x.sumaUtilidad, comisionOrdinaria: x.comisionOrdinaria, detalle: x.detalle.map((l) => [l.numero_oc, l.utilidad]).sort((p, q) => String(p[0]).localeCompare(String(q[0]))) } : null);

// ── 1. OC pagada en junio y refacturada después del cierre, dos veces (agosto 2026 y noviembre 2026) y en marzo 2027 ──
let db = base([oc("J", "m", 300000, 200000, [fac("j1", "100", "2026-06-10", 300000)]), oc("H", "m", 100000, 60000, [fac("h1", "110", "2026-06-20", 100000)])]);
cerrar(db);   // estado al 13/11/2026: J y H cuentan en junio
eq("junio antes de pagar: (100.000 + 40.000)/2", n(c(db, 2026, 6)), { calculado: 70000, pagado: 0, deuda: 70000, ocs: ["H", "J"] });
let r = await pagar(db, { mes: 6, anio: 2026, monto: 70000, id: "p-jun" });
eq("pago manual de junio: marca J y H; ancla junio", [r.ocIds.sort(), db.ocs.find((o) => o.id === "J").comision_mes], [["H", "J"], 6]);
const junioPublicado = JSON.stringify(numerico(c(db, 2026, 6)));
refacturar(db, "J", [fac("j2", "150", "2026-08-05", 300000, "100")]);
refacturar(db, "J", [nc("j3", "60", "2026-11-07", "150"), fac("j4", "190", "2026-11-07", 300000)]);
db.ocs.push(oc("K", "m", 200000, 150000, [fac("k1", "191", "2026-11-09", 200000)]));
const J = db.ocs.find((o) => o.id === "J");
eq("J: la cobranza sigue a la factura vigente (N° 190, noviembre)", [facturaVigente(J)?.numero_factura, ocsConSaldo(db.ocs).find((x) => x.oc.id === "J")?.fechaFactura], ["190", "2026-11-07"]);
eq("J: su comisión sigue en junio (período cerrado), para siempre", [liquidacionComision(J).periodo, liquidacionComision(J).cerrada], [{ anio: 2026, mes: 6 }, true]);
eq("junio conserva su pago ($70.000) y su cálculo, idéntico al de antes de refacturar", [c(db, 2026, 6).pagado, JSON.stringify(numerico(c(db, 2026, 6))) === junioPublicado], [70000, true]);
eq("en junio, J se muestra refacturada (factura vigente de noviembre)", c(db, 2026, 6).detalle.find((l) => l.ocId === "J")?.facturaVigenteMes, { anio: 2026, mes: 11 });
eq("agosto (1ª nueva factura): sin comisión", c(db, 2026, 8), null);
eq("noviembre (2ª nueva factura): solo K; J no genera comisión", n(c(db, 2026, 11)), { calculado: 25000, pagado: 0, deuda: 25000, ocs: ["K"] });
eq("versión anterior a la regla (para comparar): noviembre SÍ contaba J otra vez (duplicado)", n(cAnt(db, 2026, 11)).ocs, ["J", "K"]);
eq("noviembre informa J con su período original y el motivo", c(db, 2026, 11).refacturadasFuera, [{ ocId: "J", numero_oc: "J", liquidacion: { anio: 2026, mes: 6 }, pagada: true, motivo: "ya considerada en la comisión de Jun/2026 (período cerrado), ya pagada" }]);
let ev = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 25000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago manual de noviembre: $25.000, marca solo K", [ev.comision, ev.ocIds], [25000, ["K"]]);
const cart = prepararPagoVendedor({ userId: "u", id: "p-c", vendedorId: "m", monto: 25000, fecha: "2026-11-13", mes: 11, anio: 2026, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("cartola (fila para la base): misma comisión, solo K", [cart.fila.monto_pagado, cart.fila.monto_extra_gestion, cart.ocIds], [25000, 0, ["K"]]);
refacturar(db, "J", [nc("j5", "61", "2027-03-02", "190"), fac("j6", "220", "2027-03-02", 300000)]);
eq("J refacturada otra vez (marzo 2027): junio y noviembre intactos; marzo sin comisión", [JSON.stringify(numerico(c(db, 2026, 6))) === junioPublicado, n(c(db, 2026, 11)).ocs, c(db, 2027, 3)], [true, ["K"], null]);
eq("los pagos registrados no cambian (solo los dos hechos en la prueba)", db.pagos.map((p) => [p.id, p.mes, p.monto_pagado]), [["p-jun", 6, 70000]]);

// ── 2. Pagos parciales ──────────────────────────────────────────────────────────────────────────────
// 2a. Desde noviembre: P liquidada en noviembre, abono parcial, refacturada en diciembre → noviembre conserva lo abonado y el saldo.
db = base([oc("P", "m", 500000, 300000, [fac("p1", "200", "2026-11-15", 500000)]), oc("Q", "m", 100000, 50000, [fac("q1", "201", "2026-11-20", 100000)])]);
cerrar(db);
r = await pagar(db, { mes: 11, anio: 2026, monto: 50000, id: "p-oct-1" });
eq("noviembre: abono parcial $50.000 de $125.000, no marca OC", [r.pagoComision, r.ocIds], [50000, []]);
refacturar(db, "P", [nc("p2", "70", "2026-12-03", "200"), fac("p3", "230", "2026-12-03", 500000)]);
eq("P refacturada en diciembre: cuenta en noviembre", periodoComision(db.ocs.find((o) => o.id === "P")), { anio: 2026, mes: 11 });
eq("noviembre reconoce lo abonado y conserva solo el saldo", n(c(db, 2026, 11)), { calculado: 125000, pagado: 50000, deuda: 75000, ocs: ["P", "Q"] });
eq("diciembre: P no genera comisión", c(db, 2026, 12), null);
r = await pagar(db, { mes: 11, anio: 2026, monto: 75000, id: "p-oct-2" });
eq("pagar el saldo completa noviembre y marca P y Q en noviembre", [c(db, 2026, 11).deuda, r.ocIds.sort(), db.ocs.find((o) => o.id === "P").comision_mes], [0, ["P", "Q"], 11]);
// 2b. Antes de octubre: septiembre con abono parcial; S refacturada en noviembre → por revisar, fuera de noviembre y de todo pago.
db = base([oc("S", "m", 400000, 200000, [fac("s1", "300", "2026-09-10", 400000)]), oc("T", "m", 200000, 100000, [fac("t1", "320", "2026-11-05", 200000)])],
  [{ id: "pv9", vendedor_id: "m", anio: 2026, mes: 9, monto_pagado: 40000 }]);
refacturar(db, "S", [nc("s2", "80", "2026-11-12", "300"), fac("s3", "330", "2026-11-12", 400000)]);
cerrar(db);
const liqS = liquidacionComision(db.ocs.find((o) => o.id === "S"), db.pagos);
eq("S (liquidación septiembre con abono parcial, refacturada en noviembre): por revisar y excluida", [liqS.porRevisar, liqS.excluida], [true, true]);
eq("noviembre: solo T; S listada por revisar", [n(c(db, 2026, 11)).ocs, c(db, 2026, 11).porRevisar.map((x) => [x.numero_oc, x.incluida])], [["T"], [["S", false]]]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago de noviembre: no incluye ni marca S", [ev.comision, ev.ocIds], [50000, ["T"]]);
eq("septiembre (anterior a la vigencia): igual a la versión publicada", JSON.stringify(numerico(c(db, 2026, 9))) === JSON.stringify(numerico(cAnt(db, 2026, 9))), true);
eq("revisada «no estaba pagada»: S vuelve a contar en noviembre", n(calcularPagoVendedor({ vendedorId: "m", ocs: db.ocs.map((o) => (o.id === "S" ? { ...o, comision_revision: "revisada" } : o)), anio: 2026, mes: 11, pagosVendedor: db.pagos })).ocs, ["S", "T"]);

// ── 3. OC aún no pagada ─────────────────────────────────────────────────────────────────────────────
db = base([oc("U", "m", 400000, 300000, [fac("u1", "300", "2026-11-20", 400000)]), oc("N", "m", 200000, 100000, [fac("n1", "320", "2026-12-05", 200000)])]);
refacturar(db, "U", [nc("u2", "80", "2026-12-13", "300"), fac("u3", "330", "2026-12-13", 400000)]);
eq("U (noviembre, no pagada) refacturada en diciembre: cuenta en noviembre", [n(c(db, 2026, 11)).ocs, n(c(db, 2026, 12)).ocs], [["U"], ["N"]]);
eq("pago de diciembre marca solo N; cobranza de U con la factura 330", [evaluarPagoVendedor({ vendedorId: "m", mes: 12, anio: 2026, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos }).ocIds, facturaVigente(db.ocs.find((o) => o.id === "U"))?.numero_factura], [["N"], "330"]);
// No pagada, liquidación anterior SIN pagos en ese mes, refacturada hacia la vigencia: cuenta donde hoy (mes de la factura vigente).
db = base([oc("W", "m", 300000, 200000, [fac("w1", "400", "2026-09-20", 300000), fac("w2", "410", "2026-10-03", 300000, "400")])]);
cerrar(db);
eq("no pagada sin pagos en su mes original (septiembre): cuenta en octubre, como hoy", [periodoComision(db.ocs[0]), n(c(db, 2026, 10)).ocs, n(cAnt(db, 2026, 10)).ocs], [{ anio: 2026, mes: 10 }, ["W"], ["W"]]);
const octW = JSON.stringify(numerico(c(db, 2026, 10)));
refacturar(db, "W", [nc("w3", "90", "2027-01-08", "410"), fac("w4", "420", "2027-01-08", 300000)]);
eq("W (octubre, no pagada) refacturada en enero 2027: sigue en octubre, octubre idéntico; enero sin comisión",
  [periodoComision(db.ocs[0]), JSON.stringify(numerico(c(db, 2026, 10))) === octW, c(db, 2027, 1)], [{ anio: 2026, mes: 10 }, true, null]);

// ── 4. Varios vendedores en un mes nuevo: la refacturada pagada no altera el reparto ──────────────────
db = base([oc("A1", "a", 300000, 100000, [fac("a1", "500", "2026-11-02", 300000), fac("a3", "510", "2026-12-10", 300000, "500")], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 11 }),
  oc("B1", "b", 300000, 200000, [fac("b1", "501", "2026-12-04", 300000)]), oc("A2", "a", 100000, 0, [fac("a2", "502", "2026-12-06", 100000)])]);
cerrar(db);
const per = comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 12, ivaMensual: [] });
eq("diciembre (2 vendedores): utilidades sin la OC de noviembre ya pagada", [per.utilidades.get("a"), per.utilidades.get("b"), per.total], [100000, 100000, 100000]);
eq("noviembre conserva la OC del vendedor a", comisionOrdinariaPeriodo({ ocs: db.ocs, anio: 2026, mes: 11, ivaMensual: [] }).utilidades.get("a"), 200000);

// ── 5. «Por revisar» guardadas (como 1398-624 y 564162-290): sin cambios de monto, sin pagos nuevos ───
const doble = oc("D", "m", 311999, 239960, [fac("d1", "204", "2026-06-04", 311999), fac("d2", "205", "2026-08-14", 311999, "204")],
  { vendedor_pagado: true, comision_anio: 2026, comision_mes: 8, comision_revision: "por_revisar", comision_revision_motivo: "Posible pago en dos liquidaciones: 06/2026 y 08/2026" });
const otraAgo = oc("E", "m", 100000, 50000, [fac("e1", "206", "2026-08-20", 100000)]);
db = base([doble, otraAgo], [{ id: "pv8", vendedor_id: "m", anio: 2026, mes: 8, monto_pagado: 61020 }]);
cerrar(db);
eq("agosto con la OC por revisar: montos idénticos a la versión publicada", JSON.stringify(numerico(c(db, 2026, 8))) === JSON.stringify(numerico(cAnt(db, 2026, 8))), true);
eq("agosto: aviso por revisar (incluida, ya pagada); junio no la recupera", [c(db, 2026, 8).porRevisar.map((x) => [x.numero_oc, x.incluida]), c(db, 2026, 6)], [[["D", true]], null]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 8, anio: 2026, monto: 100000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("un pago adicional a agosto no marca la OC por revisar", ev.ocIds.includes("D"), false);

// ── 6. Antes de noviembre, ningún mes cambia (conjunto mixto, comparado con la versión publicada) ──────
const mix = base([
  oc("M1", "m", 239200, 222970, [fac("m1", "257", "2026-07-22", 239200), fac("m2", "295", "2026-08-13", 239200, "257")], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 8 }),
  oc("M2", "m", 183302, 139770, [fac("m3", "267", "2026-07-25", 183302)], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 7 }),
  oc("M3", "m", 200000, 100000, [fac("m6", "10", "2026-07-10", 200000)], { vendedor_pagado: true }),
  oc("M4", "m", 187200, 150960, [fac("m7", "163", "2026-05-04", 124800), fac("m8", "164", "2026-05-04", 62400)]),
  oc("M5", "m", 172900, 143960, [fac("m9", "227", "2026-06-30", 172900), fac("m10", "227", "2026-07-30", 172900, "225")], { vendedor_pagado: true }),
], [{ id: "x7", vendedor_id: "m", anio: 2026, mes: 7, monto_pagado: 90000 }, { id: "x5", vendedor_id: "m", anio: 2026, mes: 5, monto_pagado: 1000, monto_verificado: 18120 }]);
// Estado publicado al cierre (13/11/2026), antes de cualquier refacturación posterior.
const publicado = Array.from({ length: 10 }, (_, i) => JSON.stringify(numerico(cAnt(mix, 2026, i + 1))));
const mesesPub = ANT.mesesConFactura("m", mix.ocs);
cerrar(mix);
refacturar(mix, "M2", [nc("m4", "59", "2026-11-15", "267"), fac("m5", "349", "2026-11-15", 183302)]);
refacturar(mix, "M1", [nc("m11", "62", "2027-02-10", "295"), fac("m12", "360", "2027-02-10", 239200)]);
refacturar(mix, "M4", [nc("m13", "63", "2027-06-01", "163"), fac("m14", "370", "2027-06-01", 124800)]);
let iguales = 0; const distintos = [];
for (let m = 1; m <= 10; m++) { JSON.stringify(numerico(c(mix, 2026, m))) === publicado[m - 1] ? iguales++ : distintos.push(m); }
eq("enero–octubre 2026: los 10 meses idénticos al estado publicado, aunque se refacturen después (2026 y 2027)", [iguales, distintos], [10, []]);
eq("meses con comisión anteriores a noviembre: los mismos que antes", mesesConFactura("m", mix.ocs).filter((x) => x.anio * 12 + x.mes < 2026 * 12 + 11), mesesPub.filter((x) => x.anio * 12 + x.mes < 2026 * 12 + 11));
eq("noviembre 2026, febrero y junio 2027: las refacturadas no generan comisión (la versión anterior a la regla sí: duplicado)",
  [n(c(mix, 2026, 11)), c(mix, 2027, 2), c(mix, 2027, 6), n(cAnt(mix, 2026, 11))?.ocs], [null, null, null, ["M2"]]);

// ── 7. Octubre queda como estaba: una OC pagada en julio y refacturada en octubre cuenta en octubre (regla anterior) ──
const oct7 = base([oc("O7", "m", 183302, 139770, [fac("o1", "267", "2026-07-25", 183302), nc("o2", "59", "2026-10-15", "267"), fac("o3", "349", "2026-10-15", 183302)], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 7 })]);
cerrar(oct7);
eq("octubre: igual a la versión publicada (la OC refacturada en octubre cuenta en octubre)", [n(c(oct7, 2026, 10))?.ocs, JSON.stringify(numerico(c(oct7, 2026, 10))) === JSON.stringify(numerico(cAnt(oct7, 2026, 10)))], [["O7"], true]);
eq("julio no la lista como «pagada sin nueva comisión» (en octubre sí cuenta)", c(oct7, 2026, 7)?.liquidadasAqui, undefined);
const oct7antes = JSON.stringify(numerico(c(oct7, 2026, 10)));
refacturar(oct7, "O7", [nc("o4", "64", "2027-02-03", "349"), fac("o5", "380", "2027-02-03", 183302)]);
eq("O7 (pagada, cuenta en octubre) refacturada en febrero 2027: octubre idéntico, febrero sin comisión",
  [JSON.stringify(numerico(c(oct7, 2026, 10))) === oct7antes, c(oct7, 2027, 2)], [true, null]);

// ══ Regla definitiva (Kevin, 13/11/2026 16:15): refacturaciones entre meses y años ═══════════════════════════════════
const sinPagos = (db) => JSON.stringify(db.pagos);
// ── 8. EJEMPLO OBLIGATORIO: liquidada en noviembre 2026 y refacturada en marzo 2027 ──
db = base([oc("X1", "m", 400000, 200000, [fac("x1", "600", "2026-11-18", 400000)]), oc("X2", "m", 100000, 60000, [fac("x2", "601", "2026-11-25", 100000)])]);
cerrar(db);
r = await pagar(db, { mes: 11, anio: 2026, monto: 120000, id: "p-nov" });
eq("noviembre 2026 pagado completo: marca X1 y X2; ancla noviembre", [c(db, 2026, 11).deuda, r.ocIds.sort(), db.ocs.find((o) => o.id === "X1").comision_mes], [0, ["X1", "X2"], 11]);
const novPagado = JSON.stringify(numerico(c(db, 2026, 11)));
refacturar(db, "X1", [nc("x3", "70", "2027-03-09", "600"), fac("x4", "640", "2027-03-09", 400000)]);
db.ocs.push(oc("X5", "m", 200000, 100000, [fac("x5", "641", "2027-03-15", 200000)]));
eq("X1 conserva su comisión en noviembre 2026", periodoComision(db.ocs.find((o) => o.id === "X1")), { anio: 2026, mes: 11 });
eq("noviembre 2026 idéntico y pagado (sin saldo nuevo ni por regularizar)", [JSON.stringify(numerico(c(db, 2026, 11))) === novPagado, c(db, 2026, 11).deuda, c(db, 2026, 11).porRegularizar], [true, 0, 0]);
eq("marzo 2027 no genera una segunda comisión por X1 (solo X5)", n(c(db, 2027, 3)), { calculado: 50000, pagado: 0, deuda: 50000, ocs: ["X5"] });
eq("marzo 2027 muestra X1 con su período original y el motivo", c(db, 2027, 3).refacturadasFuera.map(textoNoIncluida), ["X1 → Nov/2026: su comisión es de su liquidación original, Nov/2026, ya pagada"]);
eq("la cobranza de X1 sigue a la factura vigente (N° 640, marzo 2027)", ocsConSaldo(db.ocs).find((x) => x.oc.id === "X1")?.fechaFactura, "2027-03-09");
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 3, anio: 2027, monto: 50000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
const cart3 = prepararPagoVendedor({ userId: "u", id: "p-c3", vendedorId: "m", monto: 50000, fecha: "2027-04-02", mes: 3, anio: 2027, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("pago manual y cartola de marzo 2027: $50.000, solo X5 (nunca X1)", [ev.comision, ev.ocIds, cart3.fila.monto_pagado, cart3.ocIds], [50000, ["X5"], 50000, ["X5"]]);
ev = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 1000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos });
eq("un pago adicional a noviembre 2026 no es comisión (pendiente $0: todo va a extra de gestión)", [ev.pendienteAntes, ev.pagoComision, ev.extraGestion], [0, 0, 1000]);

// ── 9. Octubre 2026 (no pagada) refacturada en diciembre 2026 y otra vez en marzo 2027 ──
db = base([oc("A", "m", 200000, 100000, [fac("a1", "700", "2026-10-10", 200000)]), oc("B", "m", 300000, 100000, [fac("b1", "701", "2026-12-04", 300000)])]);
cerrar(db);
const octA = JSON.stringify(numerico(c(db, 2026, 10)));
refacturar(db, "A", [nc("a2", "71", "2026-12-05", "700"), fac("a3", "702", "2026-12-05", 200000)]);
refacturar(db, "A", [nc("a4", "72", "2027-03-05", "702"), fac("a5", "703", "2027-03-05", 200000)]);
eq("A sigue en octubre (ya considerada): octubre idéntico", [periodoComision(db.ocs.find((o) => o.id === "A")), JSON.stringify(numerico(c(db, 2026, 10))) === octA], [{ anio: 2026, mes: 10 }, true]);
eq("diciembre: solo B; marzo 2027: nada (A no genera nuevas comisiones)", [n(c(db, 2026, 12)).ocs, c(db, 2027, 3)?.detalle ?? null], [["B"], null]);
eq("la versión anterior a la regla movía A a marzo 2027 (duplicado evitado)", n(cAnt(db, 2027, 3))?.ocs, ["A"]);
eq("octubre la muestra refacturada (factura vigente de marzo 2027): la cobranza sigue a la nueva factura", c(db, 2026, 10).detalle.find((l) => l.ocId === "A")?.facturaVigenteMes, { anio: 2027, mes: 3 });
db.ocs.push(oc("B2", "m", 100000, 50000, [fac("b2", "704", "2027-03-20", 100000)]));
eq("marzo 2027 (con otra venta) la informa con su período cerrado y el motivo", c(db, 2027, 3).refacturadasFuera.map(textoNoIncluida), ["A → Oct/2026: ya considerada en la comisión de Oct/2026 (período cerrado)"]);
eq("pago manual y cartola de diciembre: solo B", [evaluarPagoVendedor({ vendedorId: "m", mes: 12, anio: 2026, monto: 100000, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos }).ocIds,
  prepararPagoVendedor({ userId: "u", id: "p-c9", vendedorId: "m", monto: 100000, fecha: "2027-01-05", mes: 12, anio: 2026, ocs: db.ocs, ivaMensual: [], pagosVendedor: db.pagos }).ocIds], [["B"], ["B"]]);

// ── 10. Octubre 2026 PAGADA y refacturada en marzo 2027: octubre conserva cálculo y pago ──
db = base([oc("O", "m", 300000, 100000, [fac("o1", "710", "2026-10-20", 300000)], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 10 })],
  [{ id: "pv10", vendedor_id: "m", anio: 2026, mes: 10, monto_pagado: 100000 }]);
cerrar(db);
const octO = JSON.stringify(numerico(c(db, 2026, 10))); const pagosO = sinPagos(db);
refacturar(db, "O", [nc("o2", "73", "2027-03-11", "710"), fac("o3", "711", "2027-03-11", 300000)]);
eq("octubre: mismo cálculo, mismo pago, sin saldo por regularizar", [JSON.stringify(numerico(c(db, 2026, 10))) === octO, c(db, 2026, 10).pagado, c(db, 2026, 10).porRegularizar], [true, 100000, 0]);
eq("la versión anterior a la regla dejaba octubre sin la OC (pago aparentemente de más)", n(cAnt(db, 2026, 10)), null);
eq("marzo 2027: sin comisión; pagos intactos", [c(db, 2027, 3), sinPagos(db) === pagosO], [null, true]);

// ── 11. Nunca considerada antes de noviembre: factura de octubre refacturada en noviembre (como 1540-2131) ──
db = base([oc("C", "m", 250000, 150000, [fac("c1", "720", "2026-10-28", 250000), nc("c2", "74", "2026-11-05", "720"), fac("c3", "721", "2026-11-05", 250000)])]);
cerrar(db);
eq("al cierre cuenta en noviembre (no en octubre): sin período cerrado", [periodoComision(db.ocs[0]), liquidacionComision(db.ocs[0]).cerrada, c(db, 2026, 10)], [{ anio: 2026, mes: 11 }, false, null]);
refacturar(db, "C", [nc("c4", "75", "2027-03-03", "721"), fac("c5", "722", "2027-03-03", 250000)]);
eq("refacturada en marzo 2027: su primer período válido (noviembre 2026) no se mueve", [periodoComision(db.ocs[0]), n(c(db, 2026, 11)).ocs, c(db, 2027, 3)], [{ anio: 2026, mes: 11 }, ["C"], null]);

// ── 12. Factura de un período cerrado registrada después del cierre (OC nueva) ──
db = base([oc("S1", "m", 200000, 100000, [fac("s1", "730", "2026-09-12", 200000)])]);
cerrar(db);
const sepAntes = JSON.stringify(numerico(c(db, 2026, 9)));
db.ocs.push(oc("F", "m", 120000, 60000, [fac("f1", "731", "2026-09-28", 120000)], { comision_tras_cierre: true }));   // la base la marca al crearla
eq("septiembre (cerrado) no cambia; F entra en el primer período abierto (noviembre 2026) con aviso",
  [JSON.stringify(numerico(c(db, 2026, 9))) === sepAntes, periodoComision(db.ocs[1]), c(db, 2026, 11).detalle[0].motivoPeriodo],
  [true, { anio: 2026, mes: 11 }, "Factura de Sep/2026, período ya cerrado: se considera en el primer período abierto"]);
// Vendedor asignado después del cierre a una OC de un mes cerrado: tampoco altera ese mes.
db = base([oc("S1", "m", 200000, 100000, [fac("s1", "730", "2026-09-12", 200000)]), oc("V", null, 90000, 30000, [fac("v1", "732", "2026-09-15", 90000)])]);
cerrar(db);
db.ocs = db.ocs.map((o) => (o.id === "V" ? { ...o, vendedor_id: "m" } : o));
eq("vendedor asignado después a una OC antigua: regla anterior (su mes de factura), como hasta hoy", [n(c(db, 2026, 9)).ocs, c(db, 2026, 11)], [["S1", "V"], null]);
refacturar(db, "F", []);
db.ocs.push(oc("F2", "m", 120000, 60000, [fac("f2", "733", "2026-09-28", 120000), nc("f3", "80", "2026-12-02", "733"), fac("f4", "734", "2026-12-02", 120000)], { comision_tras_cierre: true }));
eq("OC nueva con factura de septiembre refacturada en diciembre: sigue en noviembre 2026 (no se mueve)", periodoComision(db.ocs.find((o) => o.id === "F2")), { anio: 2026, mes: 11 });

// ── 13. Entre años: diciembre 2026 → enero 2027 → diciembre 2027; enero 2027 → 2028 ──
db = base([oc("Y1", "m", 300000, 200000, [fac("y1", "740", "2026-12-20", 300000)]), oc("Y2", "m", 500000, 300000, [fac("y2", "741", "2027-01-15", 500000)])]);
cerrar(db);
refacturar(db, "Y1", [nc("y3", "76", "2027-01-04", "740"), fac("y4", "742", "2027-01-04", 300000)]);
refacturar(db, "Y1", [nc("y5", "77", "2027-12-02", "742"), fac("y6", "743", "2027-12-02", 300000)]);
refacturar(db, "Y2", [nc("y7", "78", "2028-02-01", "741"), fac("y8", "744", "2028-02-01", 500000)]);
eq("Y1 sigue en diciembre 2026 y Y2 en enero 2027", [periodoComision(db.ocs[0]), periodoComision(db.ocs[1])], [{ anio: 2026, mes: 12 }, { anio: 2027, mes: 1 }]);
eq("enero 2027 solo Y2; diciembre 2027 y febrero 2028 sin comisión", [n(c(db, 2027, 1)).ocs, c(db, 2027, 12), c(db, 2028, 2)], [["Y2"], null, null]);
eq("cada OC aparece en un solo mes (todos los meses de 2026 a 2028)", db.ocs.map((o) => mesesConFactura("m", [o]).length), [1, 1]);

// ── 14. Pago parcial desde noviembre y refacturación al año siguiente ──
db = base([oc("PP", "m", 600000, 300000, [fac("pp1", "750", "2026-12-10", 600000)])]);
cerrar(db);
r = await pagar(db, { mes: 12, anio: 2026, monto: 60000, id: "p-dic-1" });
refacturar(db, "PP", [nc("pp2", "79", "2027-02-14", "750"), fac("pp3", "751", "2027-02-14", 600000)]);
eq("diciembre 2026 reconoce el abono ($60.000) y conserva el saldo ($90.000); febrero 2027 sin comisión",
  [n(c(db, 2026, 12)), c(db, 2027, 2)], [{ calculado: 150000, pagado: 60000, deuda: 90000, ocs: ["PP"] }, null]);
r = await pagar(db, { mes: 12, anio: 2026, monto: 90000, id: "p-dic-2" });
eq("pagar el saldo en diciembre 2026 completa la obligación original (marca PP en diciembre)", [c(db, 2026, 12).deuda, r.ocIds, db.ocs[0].comision_mes, db.ocs[0].comision_anio], [0, ["PP"], 12, 2026]);

console.log(`RESUMEN comisión ligada a la liquidación de la OC: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
