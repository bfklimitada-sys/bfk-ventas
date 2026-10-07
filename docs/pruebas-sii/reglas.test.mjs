// Pruebas del modelo tributario en la app (lib/tributario.js) y de su uso en comisiones/cobranza.
import { facturasVigentesDe, montoTributarioVigente, estadoDocumento, cadenaDocumental, efectoMonto, nombreDocumento } from "../../src/lib/tributario.js";
import { facturasVigentes, facturaVigente, calcularPagoVendedor } from "../../src/lib/calculos.js";
import { saldoPorCobrar } from "../../src/lib/cobranza.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };
const F = (id, folio, monto, extra = {}) => ({ id, numero_factura: folio, monto, fecha: "2026-06-04", ...extra });
const NC = (id, folio, monto, ref, cod, extra = {}) => ({ id, numero_factura: folio, monto, tipo_dte: 61, ref_folio: ref, ref_codigo: cod, fecha: "2026-08-05", ...extra });
const oc = (docs, extra = {}) => ({ id: "o", vendedor_id: "v1", monto_total: 247000, costo_total: 147000, estado_factura_propia: "emitida", eventos_factura: docs, ...extra });

// Caso real: factura 203 + NC 44 código 2
const o203 = oc([F("f203", "203", 247000, { tipo_dte: 33, verificado_sii: true }), NC("nc44", "44", 0, "203", 2, { ref_motivo: "Corrección giro de factura 203" })], { monto_facturado: 247000, monto_cobrado: 247000 });
eq("203+NC44: factura 203 vigente", facturasVigentesDe(o203).map((f) => f.numero_factura), ["203"]);
eq("203+NC44: monto tributario $247.000", montoTributarioVigente(o203), 247000);
eq("203+NC44: estados", [estadoDocumento(o203, o203.eventos_factura[0]), estadoDocumento(o203, o203.eventos_factura[1])], ["vigente", "nc_texto"]);
eq("203+NC44: NC sin efecto", efectoMonto(o203, o203.eventos_factura[1]), 0);
eq("203+NC44: cadena = factura → NC", cadenaDocumental(o203).map((g) => g.map(nombreDocumento)), [["Factura 203", "NC 44"]]);
eq("203+NC44: facturaVigente (cobro/comisión) es la 203", facturaVigente(o203)?.numero_factura, "203");
eq("203+NC44: calculos.facturasVigentes no incluye la NC", facturasVigentes(o203).length, 1);

// Código 1 + refacturación
const o1 = oc([F("a", "100", 119000), NC("n1", "50", 119000, "100", 1), F("b", "101", 119000, { fecha: "2026-06-10" })]);
eq("cód.1: factura 100 anulada, 101 vigente", [estadoDocumento(o1, o1.eventos_factura[0]), estadoDocumento(o1, o1.eventos_factura[2])], ["anulada", "vigente"]);
eq("cód.1: monto tributario = refacturación", montoTributarioVigente(o1), 119000);
eq("cód.1: cadena factura → NC → refacturación", cadenaDocumental(o1).map((g) => g.map(nombreDocumento)), [["Factura 100", "NC 50"], ["Factura 101"]]);
const o1b = oc([F("a", "100", 119000), NC("n1", "50", 119000, "100", 1)]);
eq("cód.1 sin refacturar: sin facturas vigentes", [facturasVigentesDe(o1b).length, montoTributarioVigente(o1b), facturaVigente(o1b)], [0, 0, null]);

// Código 3 (NC parcial)
const o3 = oc([F("a", "200", 119000), NC("n3", "60", 19000, "200", 3)]);
eq("cód.3: monto tributario 100.000", montoTributarioVigente(o3), 100000);
eq("cód.3: factura sigue vigente, NC corrige monto", [estadoDocumento(o3, o3.eventos_factura[0]), estadoDocumento(o3, o3.eventos_factura[1]), efectoMonto(o3, o3.eventos_factura[1])], ["vigente", "nc_monto", -19000]);
const o3b = oc([F("a", "200", 119000), NC("x", "61", 119000, "200", 1), NC("n3", "60", 19000, "200", 3)]);
eq("cód.3 sobre factura anulada no resta dos veces", montoTributarioVigente(o3b), 0);

// Múltiples facturas + reemisión antigua
const om = oc([F("a", "300", 100000), F("b", "301", 100000), F("c", "302", 100000, { nota_credito: "70", factura_anulada_numero: "301" })]);
eq("múltiples + reemisión antigua", [facturasVigentesDe(om).map((f) => f.numero_factura), montoTributarioVigente(om)], [["300", "302"], 200000]);
eq("reemisión antigua: cadena 301 → 302", cadenaDocumental(om).map((g) => g.map(nombreDocumento)), [["Factura 300"], ["Factura 301", "Factura 302"]]);

// ND suma
eq("ND suma", montoTributarioVigente(oc([F("a", "400", 100000), { id: "d", numero_factura: "9", monto: 5000, tipo_dte: 56, ref_folio: "400", ref_codigo: 3 }])), 105000);

// Cobranza parte del facturado tributario (calculado por la base)
eq("saldo por cobrar = facturado − cobrado", saldoPorCobrar({ monto_facturado: 100000, monto_cobrado: 40000 }), 60000);

// Comisión: la NC código 2 no cambia mes ni monto
const base = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc([F("f203", "203", 247000, { tipo_dte: 33 })])], anio: 2026, mes: 6 });
const conNC = calcularPagoVendedor({ vendedorId: "v1", ocs: [o203], anio: 2026, mes: 6 });
eq("comisión: NC código 2 no cambia el cálculo de junio", [conNC.pagoCalculado, conNC.sumaFacts], [base.pagoCalculado, base.sumaFacts]);
eq("comisión: la NC de agosto no crea mes de comisión", calcularPagoVendedor({ vendedorId: "v1", ocs: [o203], anio: 2026, mes: 8 }), null);
eq("comisión: factura anulada por NC cód.1 no comisiona", calcularPagoVendedor({ vendedorId: "v1", ocs: [o1b], anio: 2026, mes: 6 }), null);

console.log(`\n${ok} OK · ${fallas} fallas`);
if (fallas) process.exit(1);
