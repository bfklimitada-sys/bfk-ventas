// Conciliación automática sin duplicaciones (22/10/2026). Datos 100 % ficticios. Funciones puras: nada se escribe.
// Regla: conciliar no es registrar; monto y fecha no bastan; nunca se crea un movimiento financiero solo.
import { leerCartolaBancoEstado, unirCartolas } from "../../src/lib/cartolas.js";
import { CIERRE_CONCILIACION, conciliarMovimientos, marcaCartola, referenciasAprendidas, registrosBancarios } from "../../src/lib/conciliacion.js";
import { vistaConciliacion } from "../../src/lib/conciliacionVista.js";
import { cartolaEnLinea, cartolaHistorica, idaYVuelta } from "./cartolas_sinteticas.mjs";

const F = []; let n = 0;
const eq = (k, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { F.push(k); console.log("FALLA " + k + " :: " + String(JSON.stringify(a)).slice(0, 500) + " ≠ " + String(JSON.stringify(b)).slice(0, 300)); } else { n++; console.log("OK    " + k); } };

const oc = (id, numero, cliente, rut, extra = {}) => ({ id, numero_oc: numero, cliente, rut_cliente: rut, tipo_registro: "venta", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente",
  monto_facturado: 0, monto_cobrado: 0, financiador_id: "fext", eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_compra: [], eventos_factura: [], ...extra });
const cobrada = (id, numero, cliente, rut, fecha, monto, extra = {}) => oc(id, numero, cliente, rut, { monto_facturado: monto, monto_cobrado: monto, estado_pago_cliente: "pagado",
  eventos_factura: [{ id: "f" + id, numero_factura: "9" + id.slice(-2), fecha: "2026-09-01", monto }], eventos_pago_cliente: [{ id: "c_" + id, fecha, monto, medio_pago: "transferencia" }], ...extra });
const pendiente = (id, numero, cliente, rut, fechaFactura, monto) => oc(id, numero, cliente, rut, { monto_facturado: monto, eventos_factura: [{ id: "f" + id, numero_factura: "1" + id.slice(-2), fecha: fechaFactura, monto }] });
const base = () => ({
  financiadores: [{ id: "fbyron", nombre: "Byron Ficticio Vegas", tipo: "externo" }, { id: "fext", nombre: "Ana Ficticia Rojas", tipo: "externo" }, { id: "fbfk", nombre: "Cuenta BFK", tipo: "propio" }],
  vendedores: [{ id: "vmat", nombre: "Matias Ficticio Vegas" }],
  ocs: [
    cobrada("o1", "1000-1-AG26", "I MUNICIPALIDAD DE MAULE", "69.110.900-3", "2026-10-16", 91000),
    pendiente("o2", "1000-2-AG26", "I MUNICIPALIDAD DE MAULE", "69.110.900-3", "2026-10-01", 174199),
    pendiente("o3", "3904-413-AG26", "I MUNICIPALIDAD DE BULNES", "69.141.200-8", "2026-06-01", 71500),
    cobrada("o4", "1000-4-AG26", "I MUNICIPALIDAD DE ARICA", "69.010.100-9", "2026-10-10", 1690002),
    pendiente("o5", "1000-5-AG26", "UNIVERSIDAD FICTICIA DEL NORTE", "70.000.000-1", "2026-09-10", 300000),
    pendiente("o6", "1000-6-AG26", "UNIVERSIDAD FICTICIA DEL NORTE", "70.000.000-1", "2026-09-20", 200000),
    pendiente("o7", "1000-7-AG26", "HOSPITAL FICTICIO", "61.000.000-7", "2026-09-15", 500000),
    oc("o8", "1000-8-AG26", "CLIENTE COMPRA EXTERNA", "76.000.000-8", { eventos_compra: [{ id: "k_ext", fecha: "2026-10-14", costo_compra: 120000, financiador_id: "fext", proveedor: "PROVEEDOR UNO" }] }),
    oc("o9", "1000-9-AG26", "CLIENTE FIFO", "76.000.000-9", { eventos_pago_financiamiento: [{ id: "pf_aug", financiador_id: "fbyron", fecha: "2026-08-13", monto: 200000 }, { id: "pf_oct", financiador_id: "fbyron", fecha: "2026-10-13", monto: 300000 }] }),
  ],
  gastos: [
    { id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 16757, fecha: "2026-10-15", detalle: null },
    { id: "g_iva2", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 45000, fecha: "2026-10-19", detalle: null },
  ],
  pagosVendedor: [{ id: "pv1", vendedor_id: "vmat", fecha: "2026-10-12", monto_pagado: 500000, monto_extra_gestion: 50000, monto_transferido: 550000 }],
  pagoFinSueltos: [], aportes: [], decisiones: [],
});
const categorias = [{ id: "cat_impuesto", nombre: "Impuesto SII" }];
const LINEA = [
  { fecha: "2026-10-12", op: "7005369", desc: "TEF A VEGAS FICTICIO MATIAS", cargo: 550000 },
  { fecha: "2026-10-13", op: "7004000", desc: "TEF A VEGAS FICTICIO BYRON", cargo: 300000 },
  { fecha: "2026-10-14", op: "7001111", desc: "TEF A PROVEEDOR UNO LIMITADA", cargo: 120000 },
  { fecha: "2026-10-16", op: "220622", desc: "ABONO PAGO A PROVEEDORES", abono: 91000 },
  { fecha: "2026-10-16", op: "7086746", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 16757 },
  { fecha: "2026-10-17", op: "1077", desc: "TEF DE ILUSTRE MUNICIPALIDAD DE ARI", abono: 1690002 },
  { fecha: "2026-10-19", op: "7086800", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 45000 },
  { fecha: "2026-10-20", op: "220622", desc: "ABONO PAGO A PROVEEDORES", abono: 174199 },
  { fecha: "2026-10-21", op: "1350037", desc: "PAGOS VARIOS RUT 70000000-1", abono: 500000 },
  { fecha: "2026-10-21", op: "1350040", desc: "PAGOS VARIOS RUT 61000000-7", abono: 200000 },
  { fecha: "2026-10-22", op: "203999", desc: "ABONO PAGO A PROVEEDORES", abono: 71500 },
  { fecha: "2026-10-22", op: "7090000", desc: "TEF A GESTION EMPRESARIAL AM LIMITA", cargo: 200000 },
];
const lin = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA, { saldoInicial: 5000000 })), "linea.xlsx");
eq("cartola ficticia válida", lin.errores, []);
const U = unirCartolas([lin]);
const correr = (d, movs = U.movs) => { const C = conciliarMovimientos(movs, d); return { C, V: vistaConciliacion(C, { ocs: d.ocs, categorias }) }; };
const por = (C, op, monto) => C.movimientos.find((x) => x.m.operacion === op && x.monto === monto);
const item = (V, x) => [...V.ya, ...V.revisar, ...V.sinRegistrar].find((i) => i.x === x);

// ── Situación inicial (sin decisiones previas) ──
const d0 = base(); const h0 = JSON.stringify(d0);
const { C: C0, V: V0 } = correr(d0);
eq("A01 comisión pagada (persona en el detalle) → Ya registrado", [por(C0, "7005369", 550000).estado, por(C0, "7005369", 550000).registros.map((r) => r.id)], ["conciliado", ["pv1"]]);
eq("A02 devolución FIFO existente (persona) → Ya registrada; la de agosto no se ofrece", [por(C0, "7004000", 300000).estado, por(C0, "7004000", 300000).registros.map((r) => r.id)], ["conciliado", ["pf_oct"]]);
eq("A03 compra financiada por tercero: no pasa por el banco → el cargo queda Sin registrar (sin candidato de compra)", [por(C0, "7001111", 120000).estado, por(C0, "7001111", 120000).candidatos], ["pendiente", undefined]);
eq("A04 «Abono pago a proveedores» con un cobro del mismo monto y fecha → Por revisar (monto y fecha no bastan)", por(C0, "220622", 91000).estado, "posible");
const iGeam = item(V0, por(C0, "7086746", 16757));
eq("A05 transferencia a Gestión Empresarial AM igual a un gasto IVA → Por revisar, explica qué falta", [iGeam.x.estado, /solo indica el destinatario/.test(iGeam.falta)], ["posible", true]);
eq("A06 nombre abreviado único («…DE ARI» → Arica) + monto → Ya registrado", [por(C0, "1077", 1690002).estado, por(C0, "1077", 1690002).evidencia.includes("nombre abreviado del cliente en la glosa")], ["conciliado", true]);
const iMaule2 = item(V0, por(C0, "220622", 174199));
eq("A07 abono por el saldo de otra factura de Maule, sin referencia confirmada → propuesta NO identificada", [iMaule2.propuesta?.identificada, /1000-2-AG26/.test(iMaule2.posible), /no prueba/.test(iMaule2.falta)], [false, true, true]);
const iVarias = item(V0, por(C0, "1350037", 500000));
eq("A08 pago de varias facturas en un depósito (RUT en el detalle) → propuesta identificada de 2 facturas, solo lo abonado", [iVarias.propuesta?.identificada, /2 facturas/.test(iVarias.posible), /únicamente \$500\.000/.test(iVarias.accion), iVarias.x.registrable], [true, true, true, true]);
const iParcial = item(V0, por(C0, "1350040", 200000));
eq("A09 cobro parcial (RUT en el detalle, factura de $500.000) → se ofrece abono parcial, nunca preseleccionado", [/Abono parcial/.test(iParcial.posible), iParcial.propuesta], [true, null]);
const iBulnes = item(V0, por(C0, "203999", 71500));
eq("A10 Bulnes: factura de $71.500 pendiente propuesta, pero sin identificar al pagador (no se marca pagada)", [iBulnes.propuesta?.identificada, /3904-413-AG26/.test(iBulnes.posible), /no prueba/.test(iBulnes.falta), iBulnes.x.estado], [false, true, true, "pendiente"]);
const g200 = por(C0, "7090000", 200000), i200 = item(V0, g200);
eq("A11 Gestión Empresarial AM $200.000 sin registro: Sin registrar, sin ofrecer la devolución a Byron de agosto", [g200.estado, g200.candidatos, /No hay ningún registro BFK de \$200\.000/.test(i200.falta)], ["pendiente", undefined, true]);
eq("A12 antecedentes del destinatario visibles (no son prueba)", /coincidió con gastos «Impuesto SII».*no una prueba/.test(i200.antecedentes || ""), true);

// ── El usuario confirma dos vínculos (decisiones auditables): BFK aprende el pagador y el destinatario ──
const x91 = por(C0, "220622", 91000), x16 = por(C0, "7086746", 16757);
const d1 = base(); d1.decisiones = [
  { marca: x91.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_o1", mov_operacion: "220622", mov_descripcion: "ABONO PAGO A PROVEEDORES" },
  { marca: x16.marca, decision: "vinculado", tabla: "gastos_indirectos", registro_id: "g_iva", mov_operacion: "7086746", mov_descripcion: "TEF A GESTION EMPRESARIAL AM LIMITA" }];
const ap = referenciasAprendidas(d1, registrosBancarios(d1));
eq("B01 se aprende: op. 220622 → Maule; Gestión Empresarial AM → Impuesto SII", [ap.pagadores.get("PAP|220622"), ap.destinatarios.get("GESTION EMPRESARIAL AM LIM")], ["691109003", "cat:cat_impuesto"]);
const { C: C1, V: V1 } = correr(d1);
const iMaule2b = item(V1, por(C1, "220622", 174199));
eq("B02 siguiente pago con la misma referencia → factura pendiente de Maule IDENTIFICADA (se propone, no se registra sola)", [iMaule2b.propuesta?.identificada, /referencia de pagador ya confirmada/.test(iMaule2b.motivo), iMaule2b.x.estado], [true, true, "pendiente"]);
eq("B03 siguiente IVA a Gestión Empresarial AM igual a un gasto IVA → Ya registrado automáticamente (aprendido)", [por(C1, "7086800", 45000).estado, por(C1, "7086800", 45000).origen, por(C1, "7086800", 45000).registros.map((r) => r.id)], ["conciliado", "aprendido", ["g_iva2"]]);
eq("B04 Gestión Empresarial AM $200.000 sin gasto que calce → sigue Sin registrar (no se asume IVA ni gasto nuevo)", por(C1, "7090000", 200000).estado, "pendiente");
const iAuto = V1.ya.find((i) => i.x === por(C1, "7086800", 45000));
eq("B05 lo reconocido automáticamente se marca como tal (se puede descartar con «No corresponde»)", iAuto?.reconocidoAuto, "aprendido");
// Reversible: «No corresponde» guarda un rechazo → vuelve a revisión, sin tocar el gasto.
const d2 = JSON.parse(JSON.stringify(d1)); d2.decisiones.push({ marca: por(C1, "7086800", 45000).marca, decision: "rechazado", tabla: "gastos_indirectos", registro_id: "g_iva2" });
eq("B06 «No corresponde» sobre lo reconocido → ya no se concilia con ese gasto", correr(d2).C.movimientos.find((x) => x.m.operacion === "7086800").estado !== "conciliado", true);
// Una referencia que apuntó a dos clientes distintos deja de usarse.
const d3 = JSON.parse(JSON.stringify(d1)); d3.ocs.push(cobrada("o10", "1000-10-AG26", "OTRO CLIENTE", "65.000.000-1", "2026-09-30", 12345));
d3.decisiones.push({ marca: "cart:20260930:0:12345:1:1", decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_o10", mov_operacion: "220622", mov_descripcion: "ABONO PAGO A PROVEEDORES" });
eq("B07 referencia ambigua (dos clientes) → se ignora", referenciasAprendidas(d3, registrosBancarios(d3)).pagadores.has("PAP|220622"), false);

// ── Otros escenarios ──
const dup = unirCartolas([lin, lin, leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA.slice(0, 6), { saldoInicial: 5000000 })), "tramo.xlsx")]);
eq("C01 cartolas repetidas y superpuestas → mismas marcas", dup.movs.map((_, i) => marcaCartola(dup.movs, i)), U.movs.map((_, i) => marcaCartola(U.movs, i)));
eq("C02 cartola en «Solo revisión» no entra a la conciliación", unirCartolas([{ ...lin, errores: ["no cuadra"], soloRevision: true, movsRevision: lin.movs, movs: [] }]).movs.length, 0);
// Candidato antiguo: un cobro del 05/08 no se ofrece para un abono del 16/10 si hubo un abono igual el 20/08.
const dV = base(); dV.ocs.push(cobrada("o11", "1000-11-AG26", "UNIVERSIDAD DE OTRA", "60.000.000-1", "2026-08-05", 77777));
const H = leerCartolaBancoEstado(idaYVuelta(cartolaHistorica([{ fecha: "2026-08-20", op: "4030120", desc: "DEPOSITO CON DOCUMENTOS", abono: 77777 }], { saldoInicial: 4922223, numero: 3, desde: "2026-08-14", hasta: "2026-08-20" })), "h.xlsx");
const L2 = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea([{ fecha: "2026-10-16", op: "220699", desc: "ABONO PAGO A PROVEEDORES", abono: 77777 }], { saldoInicial: 5000000 })), "l2.xlsx");
const CV = conciliarMovimientos(unirCartolas([H, L2]).movs, dV);
eq("C03 el candidato antiguo queda solo en el abono más cercano (20/08), no en el del 16/10", [CV.movimientos.find((x) => x.m.fecha === "2026-08-20").candidatos?.map((r) => r.id), CV.movimientos.find((x) => x.m.fecha === "2026-10-16").estado], [["c_o11"], "pendiente"]);
// Reapertura: con la decisión guardada, el movimiento se reconoce igual al volver a cargar.
eq("C04 reapertura: el vínculo confirmado se reconoce al recargar", correr(d1, unirCartolas([lin]).movs).C.movimientos.find((x) => x.marca === x91.marca).origen, "decision");
eq("C05 cierre histórico sin cambios", CIERRE_CONCILIACION, "2026-10-07");
eq("C06 conciliar (con y sin decisiones) no modifica los datos (huella)", JSON.stringify(d0), h0);
eq("C07 nunca se crea un movimiento: nada queda «registrado» por la conciliación (solo propuestas)", [...V0.sinRegistrar, ...V1.sinRegistrar].every((i) => i.x.estado === "pendiente"), true);

console.log(`\nRESUMEN conciliación automática: ${n} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
