// Liquidaciones de comisiones CERRADAS y ajustes (15/11/2026, Kevin). Uso: node docs/pruebas-liquidaciones-cerradas/reglas.test.mjs
import { calcularPagoVendedor, datosCierre, liquidacionesPorCerrar, mesesConFactura, periodoComision, efectoAjuste } from "../../src/lib/calculos.js";
import { evaluarPagoVendedor, prepararPagoVendedor, registrarPagoVendedor } from "../../src/lib/pagosVendedor.js";
import { comisionesPorPagar } from "../../src/lib/caja.js";
import { resultadoMes } from "../../src/lib/informes.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };
const fac = (id, numero, fecha, monto, anula = null) => ({ id, numero_factura: numero, fecha, monto, factura_anulada_numero: anula });
const nc = (id, numero, fecha, refFolio) => ({ id, numero_factura: numero, fecha, monto: 0, tipo_dte: 61, ref_folio: refFolio, ref_codigo: 1 });
const oc = (id, vendedor, venta, costo, facturas, extra = {}) => ({ id, numero_oc: id, vendedor_id: vendedor, tipo_registro: "venta", estado_factura_propia: "emitida",
  monto_total: venta, costo_total: costo, monto_facturado: venta, monto_cobrado: 0, estado_pago_cliente: "pendiente", eventos_factura: facturas, eventos_pago_cliente: [], ...extra });
const iva = (anio, mes, ventas = 0, compras = 0) => ({ id: `i${anio}${mes}`, anio, mes, iva_ventas: ventas, iva_compras: compras, iva_pagado: 0, desglose_f29: true, remanente_anterior: 0, ppm: 0, otras_retenciones: 0 });
const pago = (id, v, anio, mes, monto, extra = {}) => ({ id, vendedor_id: v, anio, mes, monto_pagado: monto, fecha: "2026-12-05", estado: "pagado", ...extra });
const numerico = (x) => (x ? { pagoCalculado: x.pagoCalculado, pagado: x.pagado, deuda: x.deuda, porRegularizar: x.porRegularizar, sumaUtilidad: x.sumaUtilidad, comisionOrdinaria: x.comisionOrdinaria,
  descuentoF29: x.descuentoF29, detalle: x.detalle.map((l) => [l.numero_oc, l.utilidad]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) } : null);
// Cierre como lo hace la base (cerrar_liquidacion_comision / migración): lo calculado en ese momento.
const cerrar = (cierres, c, v, origen = "pagada") => { const d = datosCierre(c, v, origen); cierres.liquidaciones.push({ id: `cl_${v}_${d.anio}_${String(d.mes).padStart(2, "0")}`, ...d, cerrada_en: "2026-12-06T12:00:00Z" }); return cierres; };
const decidir = (cierres, x) => { cierres.decisiones.push({ id: `d${cierres.decisiones.length + 1}`, decidido_en: `2026-12-1${cierres.decisiones.length}T10:00:00Z`, ...x }); return cierres; };
const C = (args) => calcularPagoVendedor({ ivaMensual: [iva(2026, 11), iva(2026, 12), iva(2027, 3)], ...args });

// ── 1. Cerrar no cambia nada: lo registrado da exactamente lo mismo ──
let ocs = [oc("A", "m", 1000000, 600000, [fac("a1", "1", "2026-11-10", 1000000)]), oc("B", "m", 500000, 300000, [fac("b1", "2", "2026-11-20", 500000)])];
let pagos = [pago("p1", "m", 2026, 11, 300000)];
let cierres = { liquidaciones: [], decisiones: [] };
const c0 = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos });
eq("noviembre: comisión 300.000 pagada completa", [c0.pagoCalculado, c0.deuda], [300000, 0]);
eq("se propone cerrar noviembre (mes terminado, pagado completo, definitivo)", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs, ivaMensual: [iva(2026, 11)], pagosVendedor: pagos, cierres, hoy: new Date("2026-12-06T12:00:00") }).map((d) => [d.anio, d.mes, d.origen, d.comision_reconocida]), [[2026, 11, "pagada", 300000]]);
cerrar(cierres, c0, "m");
const c1 = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres });
eq("cerrada: mismos montos, OC y utilidades que antes de cerrar", JSON.stringify(numerico(c1)) === JSON.stringify(numerico(c0)), true);
eq("cerrada: indicador y comisión reconocida", [c1.cerrada?.origen, c1.cerrada?.comisionReconocida, c1.ajustesPorRevisar], ["pagada", 300000, undefined]);
eq("ya no se propone cerrar otra vez", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs, ivaMensual: [iva(2026, 11)], pagosVendedor: pagos, cierres, hoy: new Date("2026-12-06T12:00:00") }), []);

// ── 2. Cambia el costo de una OC liquidada → comisión intacta + «Ajuste por revisar» ──
ocs = ocs.map((o) => (o.id === "A" ? { ...o, costo_total: 650000 } : o));
const c2 = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres });
eq("comisión, pagos y saldo intactos (300.000 · pagado 300.000 · saldo 0)", [c2.pagoCalculado, c2.pagado, c2.deuda, c2.porRegularizar], [300000, 300000, 0, 0]);
eq("utilidad usada sigue siendo la liquidada (400.000)", c2.detalle.find((l) => l.ocId === "A").utilidad, 400000);
eq("ajuste por revisar con OC, vendedor, período, utilidad anterior y nueva", c2.ajustesPorRevisar.map((a) => [a.numero_oc, a.vendedorId, a.periodo, a.utilidadAnterior, a.utilidadNueva, a.diferencia, a.efecto]),
  [["A", "m", { anio: 2026, mes: 11 }, 400000, 350000, -50000, -25000]]);
eq("el pago del mes no incluye el ajuste y no se puede pagar más comisión (pendiente 0)", (() => { const e = evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 10000, ocs, ivaMensual: [iva(2026, 11)], pagosVendedor: pagos, cierres });
  return [e.pendienteAntes, e.pagoComision, e.extraGestion, e.ajustesPorRevisar.length]; })(), [0, 0, 10000, 1]);
// Rechazado: sin cambios y sin aviso pendiente.
let cr = JSON.parse(JSON.stringify(cierres)); decidir(cr, { tipo: "ajuste_utilidad", resultado: "rechazado", liquidacion_id: cr.liquidaciones[0].id, oc_id: "A", numero_oc: "A", utilidad_anterior: 400000, utilidad_nueva: 350000, monto: 0, motivo: "x", respaldo: "y" });
const c2r = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres: cr });
eq("rechazado: comisión igual, sin ajuste pendiente", [c2r.pagoCalculado, c2r.ajustesPorRevisar, c2r.ajustesAprobados], [300000, undefined, undefined]);
// Aprobado: línea aparte en el mes original; lo pagado no cambia; queda «por regularizar» (no se mueve ningún pago).
decidir(cierres, { tipo: "ajuste_utilidad", resultado: "aprobado", liquidacion_id: cierres.liquidaciones[0].id, oc_id: "A", numero_oc: "A", utilidad_anterior: 400000, utilidad_nueva: 350000, monto: -25000, motivo: "Costo real mayor", respaldo: "Factura proveedor 123" });
const c3 = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres });
eq("aprobado: comisión = reconocida + ajuste (275.000), pagado 300.000 intacto, por regularizar 25.000", [c3.pagoCalculado, c3.pagado, c3.deuda, c3.porRegularizar, c3.ajustesAprobados.length, c3.ajustesPorRevisar], [275000, 300000, 0, 25000, 1, undefined]);
// Un segundo cambio se compara con la última decisión.
ocs = ocs.map((o) => (o.id === "A" ? { ...o, costo_total: 640000 } : o));
const c4 = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres });
eq("nuevo cambio: ajuste respecto de lo ya decidido (350.000 → 360.000)", c4.ajustesPorRevisar.map((a) => [a.utilidadAnterior, a.utilidadNueva, a.diferencia]), [[350000, 360000, 10000]]);

// ── 3. Venta que aumenta: ajuste positivo aprobado → saldo pendiente en el mes original ──
let ocs3 = [oc("V", "m", 400000, 200000, [fac("v1", "9", "2026-12-03", 400000)])];
let pagos3 = [pago("q1", "m", 2026, 12, 100000)];
let cie3 = { liquidaciones: [], decisiones: [] };
cerrar(cie3, C({ vendedorId: "m", ocs: ocs3, anio: 2026, mes: 12, pagosVendedor: pagos3 }), "m");
ocs3 = [{ ...ocs3[0], monto_total: 440000 }];
const a3 = C({ vendedorId: "m", ocs: ocs3, anio: 2026, mes: 12, pagosVendedor: pagos3, cierres: cie3 }).ajustesPorRevisar[0];
decidir(cie3, { tipo: "ajuste_utilidad", resultado: "aprobado", liquidacion_id: cie3.liquidaciones[0].id, oc_id: "V", numero_oc: "V", utilidad_anterior: a3.utilidadAnterior, utilidad_nueva: a3.utilidadNueva, monto: a3.efecto, motivo: "m", respaldo: "r" });
const c5 = C({ vendedorId: "m", ocs: ocs3, anio: 2026, mes: 12, pagosVendedor: pagos3, cierres: cie3 });
eq("venta +40.000 → efecto +20.000; diciembre queda con saldo 20.000", [a3.efecto, c5.pagoCalculado, c5.deuda], [20000, 120000, 20000]);
const e5 = evaluarPagoVendedor({ vendedorId: "m", mes: 12, anio: 2026, monto: 25000, ocs: ocs3, ivaMensual: [], pagosVendedor: pagos3, cierres: cie3 });
eq("pagar 25.000: 20.000 comisión (el ajuste aprobado) + 5.000 extra de gestión", [e5.pagoComision, e5.extraGestion], [20000, 5000]);

// ── 4. Pagos parciales: un mes con pago parcial no se cierra; el saldo sigue siendo la obligación original ──
const ocs4 = [oc("P", "m", 600000, 300000, [fac("p1", "20", "2026-11-15", 600000)])];
const parcial = [pago("r1", "m", 2026, 11, 60000)];
eq("pago parcial: no se propone cerrar", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs: ocs4, ivaMensual: [iva(2026, 11)], pagosVendedor: parcial, cierres: { liquidaciones: [], decisiones: [] }, hoy: new Date("2026-12-06") }), []);
eq("pago parcial: saldo = 150.000 − 60.000", C({ vendedorId: "m", ocs: ocs4, anio: 2026, mes: 11, pagosVendedor: parcial }).deuda, 90000);
eq("mes en curso no se cierra aunque esté pagado", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs: ocs4, ivaMensual: [iva(2026, 11)], pagosVendedor: [pago("r2", "m", 2026, 11, 150000)], cierres: { liquidaciones: [], decisiones: [] }, hoy: new Date("2026-11-20") }), []);
eq("comisión provisoria (sin F29) no se cierra", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs: ocs4, ivaMensual: [], pagosVendedor: [pago("r2", "m", 2026, 11, 150000)], cierres: { liquidaciones: [], decisiones: [] }, hoy: new Date("2026-12-06") }).length, 0);
eq("octubre o antes nunca se cierra solo (solo la migración, con evidencia)", liquidacionesPorCerrar({ vendedores: [{ id: "m" }], ocs: [oc("O", "m", 600000, 300000, [fac("o1", "21", "2026-10-15", 600000)])], ivaMensual: [iva(2026, 10)], pagosVendedor: [pago("r3", "m", 2026, 10, 150000)], cierres: { liquidaciones: [], decisiones: [] }, hoy: new Date("2026-12-06") }), []);

// ── 5. Refacturaciones (incluso entre años) en un mes cerrado: sin nueva comisión ni ajuste ──
let ocs5 = [oc("R", "m", 300000, 100000, [fac("r1", "30", "2026-11-05", 300000)])]; const pagos5 = [pago("s1", "m", 2026, 11, 100000)];
const cie5 = { liquidaciones: [], decisiones: [] }; cerrar(cie5, C({ vendedorId: "m", ocs: ocs5, anio: 2026, mes: 11, pagosVendedor: pagos5 }), "m");
ocs5 = [{ ...ocs5[0], eventos_factura: [...ocs5[0].eventos_factura, nc("r2", "70", "2027-03-02", "30"), fac("r3", "31", "2027-03-02", 300000), nc("r4", "71", "2028-01-10", "31"), fac("r5", "32", "2028-01-10", 300000)] }];
const c6 = C({ vendedorId: "m", ocs: ocs5, anio: 2026, mes: 11, pagosVendedor: pagos5, cierres: cie5 });
eq("refacturada en 2027 y 2028: noviembre 2026 intacto, sin ajuste; 2027 y 2028 sin comisión", [c6.pagoCalculado, c6.deuda, c6.ajustesPorRevisar, C({ vendedorId: "m", ocs: ocs5, anio: 2027, mes: 3, cierres: cie5 }), C({ vendedorId: "m", ocs: ocs5, anio: 2028, mes: 1, cierres: cie5 })],
  [100000, 0, undefined, null, null]);

// ── 6. Cambio de vendedor de una OC liquidada: el vendedor original conserva; el nuevo no recibe comisión duplicada ──
let ocs6 = [oc("X", "m", 500000, 300000, [fac("x1", "40", "2026-11-12", 500000)]), oc("Y", "k", 200000, 100000, [fac("y1", "41", "2026-12-12", 200000)])];
const pagos6 = [pago("t1", "m", 2026, 11, 100000)]; const cie6 = { liquidaciones: [], decisiones: [] };
cerrar(cie6, C({ vendedorId: "m", ocs: ocs6, anio: 2026, mes: 11, pagosVendedor: pagos6 }), "m");
ocs6 = ocs6.map((o) => (o.id === "X" ? { ...o, vendedor_id: "k" } : o));
const m6 = C({ vendedorId: "m", ocs: ocs6, anio: 2026, mes: 11, pagosVendedor: pagos6, cierres: cie6 });
eq("vendedor original: conserva 100.000; ajuste por revisar «ya no corresponde»", [m6.pagoCalculado, m6.ajustesPorRevisar.map((a) => [a.numero_oc, a.utilidadNueva, a.motivo])], [100000, [["X", 0, "ya no corresponde a este mes o vendedor"]]]);
eq("vendedor nuevo: X no genera comisión en noviembre (ni aparece el mes)", [C({ vendedorId: "k", ocs: ocs6, anio: 2026, mes: 11, pagosVendedor: pagos6, cierres: cie6 }), mesesConFactura("k", ocs6, cie6).map((x) => `${x.anio}-${x.mes}`)], [null, ["2026-12"]]);
eq("pago del vendedor nuevo no marca X", evaluarPagoVendedor({ vendedorId: "k", mes: 11, anio: 2026, monto: 50000, ocs: ocs6, ivaMensual: [], pagosVendedor: pagos6, cierres: cie6 }).ocIds, []);

// ── 7. OC nueva que cae en un mes cerrado (factura tardía de noviembre): ajuste por revisar, no cambia la comisión ──
const ocs7 = [...ocs, oc("T", "m", 220000, 100000, [fac("t1", "50", "2026-11-28", 220000)], { comision_tras_cierre: true })];
const c7 = C({ vendedorId: "m", ocs: ocs7, anio: 2026, mes: 11, pagosVendedor: pagos, cierres });
eq("OC nueva en un mes liquidado: comisión igual (275.000), aparece como ajuste por revisar", [c7.pagoCalculado, c7.ajustesPorRevisar.find((a) => a.ocId === "T")?.motivo, c7.ajustesPorRevisar.find((a) => a.ocId === "T")?.efecto],
  [275000, "OC nueva en un mes ya liquidado", 60000]);
eq("y no se marca pagada con un pago a ese mes", evaluarPagoVendedor({ vendedorId: "m", mes: 11, anio: 2026, monto: 1000, ocs: ocs7, ivaMensual: [], pagosVendedor: [...pagos, pago("p9", "m", 2026, 11, 0)], cierres }).ocIds.includes("T"), false);

// ── 8. OC histórica nunca liquidada que recibe vendedor después: «Por revisar», fuera de todo mes y pago ──
const ocs8 = [oc("H", "m", 300000, 100000, [fac("h1", "60", "2026-08-10", 300000)], { comision_revision: "por_revisar", comision_revision_motivo: "Vendedor asignado el 15/11/2026 a una OC con factura de 08/2026, período cerrado y nunca liquidada: …" }),
  oc("G", "m", 200000, 100000, [fac("g1", "61", "2026-08-12", 200000)], { comision_cierre_anio: 2026, comision_cierre_mes: 8 })];
const c8 = C({ vendedorId: "m", ocs: ocs8, anio: 2026, mes: 8, pagosVendedor: [] });
eq("agosto: solo G; H listada «Por revisar», no incluida", [c8.detalle.map((l) => l.ocId), c8.porRevisar.map((r) => [r.numero_oc, r.incluida])], [["G"], [["H", false]]]);
eq("no se incorpora a noviembre ni a otro mes", [periodoComision(ocs8[0]), C({ vendedorId: "m", ocs: ocs8, anio: 2026, mes: 11 })], [{ anio: 2026, mes: 8 }, null]);
eq("un pago a agosto no la marca", evaluarPagoVendedor({ vendedorId: "m", mes: 8, anio: 2026, monto: 50000, ocs: ocs8, ivaMensual: [], pagosVendedor: [] }).ocIds, ["G"]);
// Decidida «reconocer» con agosto ya cerrado → ajuste por revisar en agosto (no cambia agosto hasta aprobarlo).
const cie8 = { liquidaciones: [], decisiones: [] }; cerrar(cie8, c8, "m", "historica_pagada");
const ocs8b = ocs8.map((o) => (o.id === "H" ? { ...o, comision_revision: "revisada" } : o));
const c8b = C({ vendedorId: "m", ocs: ocs8b, anio: 2026, mes: 8, pagosVendedor: [], cierres: cie8 });
eq("reconocida con agosto cerrado: agosto igual, ajuste por revisar por H", [c8b.pagoCalculado === c8.pagoCalculado, c8b.ajustesPorRevisar.map((a) => [a.numero_oc, a.motivo])], [true, [["H", "OC nueva en un mes ya liquidado"]]]);

// ── 9. Varios vendedores: el efecto propuesto usa el reparto del período registrado ──
const liqV = { comision_ordinaria: 90000, descuento_f29: 40000, regla_periodo: true, utilidad_periodo: 400000, utilidad_vendedor: 200000, peso: 200000, peso_total: 400000 };
eq("dos vendedores (mitad cada uno): +100.000 de utilidad propia → total 230.000 × 300/500 = 138.000 → efecto +48.000", efectoAjuste(liqV, { delta: 100000 }), 48000);
eq("venta propia: el efecto es la diferencia completa", efectoAjuste(liqV, { delta: 12345, ventaPropia: true }), 12345);
eq("nunca baja de $0 la comisión del período", efectoAjuste({ ...liqV, comision_ordinaria: 0, utilidad_periodo: 10000, utilidad_vendedor: 5000, peso: 5000, peso_total: 10000 }, { delta: -100000 }), 0);

// ── 10. Cartola, caja e informes usan la misma liquidación cerrada ──
const filaCart = prepararPagoVendedor({ userId: "u", id: "pc", vendedorId: "m", monto: 30000, fecha: "2026-12-07", mes: 11, anio: 2026, ocs, ivaMensual: [iva(2026, 11)], pagosVendedor: pagos, cierres });
eq("cartola: a un mes cerrado ya pagado todo va a extra de gestión", [filaCart.fila.monto_pagado, filaCart.fila.monto_extra_gestion], [0, 30000]);
const caja = comisionesPorPagar({ vendedores: [{ id: "m", nombre: "M" }], ocs, ivaMensual: [iva(2026, 11)], pagosVendedor: pagos, cierres, hoy: new Date("2026-12-20") });
eq("caja: noviembre cerrado sin deuda (no aparece por pagar)", JSON.stringify(caja).includes('"mes":11'), false);
const inf = resultadoMes({ ocs, gastos: [], pagosVendedor: pagos, ivaMensual: [iva(2026, 11)], vendedores: [{ id: "m" }], categorias: [], cierres }, 2026, 11);
eq("informe del mes usa la comisión reconocida + ajustes aprobados (275.000)", JSON.stringify(inf).includes("275000"), true);

// ── 11. Sin liquidaciones cerradas todo es idéntico a la versión anterior (garantía para lo no cerrado) ──
const sinCierres = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos }), conVacio = C({ vendedorId: "m", ocs, anio: 2026, mes: 11, pagosVendedor: pagos, cierres: { liquidaciones: [], decisiones: [] } });
eq("cierres vacíos = sin cierres", JSON.stringify(sinCierres) === JSON.stringify(conVacio), true);

console.log(`RESUMEN liquidaciones cerradas y ajustes: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
