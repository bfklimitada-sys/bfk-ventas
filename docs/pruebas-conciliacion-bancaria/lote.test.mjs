// Conciliación masiva segura (23/10/2026): selección de coincidencias seguras, revalidación con datos frescos, ejecución
// del lote (solo decisiones), conflictos entre dos usuarios y «Deshacer este lote». Datos 100 % ficticios.
import { leerCartolaBancoEstado, unirCartolas } from "../../src/lib/cartolas.js";
import { conciliarMovimientos } from "../../src/lib/conciliacion.js";
import { vistaConciliacion } from "../../src/lib/conciliacionVista.js";
import { coincidenciasSeguras, decisionesDelLote, ejecutarLote, esConflicto, resumenLote, revalidar } from "../../src/lib/conciliacionLote.js";
import { cartolaEnLinea, idaYVuelta } from "./cartolas_sinteticas.mjs";

const F = []; let n = 0;
const eq = (k, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { F.push(k); console.log("FALLA " + k + " :: " + String(JSON.stringify(a)).slice(0, 400) + " ≠ " + String(JSON.stringify(b)).slice(0, 300)); } else { n++; console.log("OK    " + k); } };

const oc = (id, numero, cliente, rut, extra = {}) => ({ id, numero_oc: numero, cliente, rut_cliente: rut, tipo_registro: "venta", estado_factura_propia: "emitida", estado_pago_cliente: "pagado",
  monto_facturado: 0, monto_cobrado: 0, financiador_id: "fext", eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_compra: [], eventos_factura: [], ...extra });
const cobro = (id, numero, cliente, rut, fecha, monto) => oc(id, numero, cliente, rut, { monto_facturado: monto, monto_cobrado: monto,
  eventos_factura: [{ id: "f" + id, numero_factura: "9" + id, fecha: "2026-09-01", monto }], eventos_pago_cliente: [{ id: "c_" + id, fecha, monto, medio_pago: "transferencia" }] });
const base = () => ({
  financiadores: [{ id: "fbyron", nombre: "Byron Ficticio Vegas", tipo: "externo" }, { id: "fext", nombre: "Ana Ficticia Rojas", tipo: "externo" }],
  vendedores: [{ id: "vmat", nombre: "Matias Ficticio Vegas" }],
  ocs: [cobro("o1", "1000-1-AG26", "UNIVERSIDAD FICTICIA DEL NORTE", "70.000.000-1", "2026-10-15", 300000),
        cobro("o2", "1000-2-AG26", "HOSPITAL FICTICIO", "61.000.000-7", "2026-10-16", 91000),
        cobro("o3", "1000-3-AG26", "MUNICIPALIDAD FICTICIA", "69.000.000-2", "2026-09-01", 50000),
        oc("o4", "1000-4-AG26", "CLIENTE FIFO", "76.000.000-9", { eventos_pago_financiamiento: [{ id: "pf_oct", financiador_id: "fbyron", fecha: "2026-10-13", monto: 300000 }] })],
  gastos: [{ id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 400000, fecha: "2026-10-20" }, { id: "g_ppm", categoria_id: "cat_impuesto", subcategoria: "PPM", monto: 35000, fecha: "2026-10-20" }],
  pagosVendedor: [{ id: "pv1", vendedor_id: "vmat", fecha: "2026-10-12", monto_pagado: 500000, monto_extra_gestion: 50000, monto_transferido: 550000 }],
  pagoFinSueltos: [], aportes: [], decisiones: [],
});
const LINEA = [
  { fecha: "2026-10-12", op: "7005369", desc: "TEF A VEGAS FICTICIO MATIAS", cargo: 550000 },          // seguro: persona
  { fecha: "2026-10-13", op: "7004000", desc: "TEF A VEGAS FICTICIO BYRON", cargo: 300000 },           // seguro: persona (devolución existente)
  { fecha: "2026-10-15", op: "1350037", desc: "PAGOS VARIOS RUT 70000000-1", abono: 300000 },          // seguro: RUT
  { fecha: "2026-10-16", op: "220622", desc: "ABONO PAGO A PROVEEDORES", abono: 91000 },                // NO: solo monto y fecha (por revisar)
  { fecha: "2026-10-20", op: "8818", desc: "PAGO EN LINEA SII F29", cargo: 435000 },                     // seguro: glosa SII + IVA+PPM
  { fecha: "2026-10-21", op: "7009999", desc: "TEF A DESCONOCIDO SPA", cargo: 12345 },                  // NO: sin registro
];
const movs = unirCartolas([leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA, { saldoInicial: 5000000 })), "l.xlsx")]).movs;
const correr = (d) => { const C = conciliarMovimientos(movs, d); return { C, V: vistaConciliacion(C, { ocs: d.ocs, categorias: [{ id: "cat_impuesto", nombre: "Impuesto SII" }] }) }; };
const d0 = base(); const h0 = JSON.stringify(d0);
const { C: C0, V: V0 } = correr(d0);
const S0 = coincidenciasSeguras(V0);
const op = (s) => movs.find((m) => m.fecha === s.fecha && m.descripcion === s.descripcion)?.operacion;
eq("L01 solo coincidencias con evidencia: persona, devolución, RUT y pago SII", S0.map((s) => op(s)).sort(), ["1350037", "7004000", "7005369", "8818"]);
eq("L02 nunca entra lo que solo coincide por monto y fecha ni lo que no tiene registro", S0.some((s) => ["220622", "7009999"].includes(op(s))), false);
eq("L03 cada una con registros de un solo tipo que suman exacto", S0.every((s) => s.registros.reduce((a, r) => a + r.monto, 0) === s.monto && new Set(s.registros.map((r) => r.tabla)).size === 1), true);
eq("L04 pago SII = IVA + PPM (dos gastos, una decisión)", S0.find((s) => op(s) === "8818")?.ids.sort(), ["g_iva", "g_ppm"]);
const R = resumenLote(S0);
eq("L05 resumen: movimientos, abonos, cargos y totales", [R.n, R.abonos, R.totalAbonos, R.cargos, R.totalCargos, R.registros], [4, 1, 300000, 3, 1285000, 5]);
// Antes del cierre: nunca seguras (no se decide sobre lo cerrado).
const C1 = conciliarMovimientos(movs, d0, { cierre: "2026-10-31" });
eq("L06 movimientos anteriores al cierre nunca son seguros", coincidenciasSeguras(vistaConciliacion(C1, { ocs: d0.ocs })).length, 0);
// Ya confirmado (decisión) o registrado desde la cartola: deja de ser «por confirmar».
const xRut = C0.movimientos.find((x) => x.m.operacion === "1350037");
const d1 = base(); d1.decisiones = [{ id: 1, marca: xRut.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_o1" }];
eq("L07 lo ya confirmado no vuelve a ofrecerse", coincidenciasSeguras(correr(d1).V).some((s) => s.marca === xRut.marca), false);

// Revalidación con datos frescos (otra persona pudo actuar entre la selección y la confirmación).
const sRut = S0.find((s) => s.marca === xRut.marca);
eq("L08 revalidar: sin cambios → sigue", revalidar(sRut, C0).ok, true);
eq("L09 revalidar: otra persona ya lo confirmó → se omite como hecho", [revalidar(sRut, correr(d1).C).ok, revalidar(sRut, correr(d1).C).yaHecho], [false, true]);
const d2 = base(); d2.ocs[0].eventos_pago_cliente = [];   // el cobro se borró
eq("L10 revalidar: el registro ya no existe → queda para revisar", revalidar(sRut, correr(d2).C).ok, false);
const d3 = base(); d3.ocs.push(cobro("o9", "1000-9-AG26", "UNIVERSIDAD FICTICIA DEL NORTE", "70.000.000-1", "2026-10-14", 300000));
eq("L11 revalidar: aparece otro registro posible → ya no es segura", revalidar(sRut, correr(d3).C).ok, false);

// Ejecución: solo decisiones; un conflicto de la base no detiene el resto; nada más se llama.
const llamadas = []; let otra = false;
const decidir = async (d) => { llamadas.push(d); if (d.marca === sRut.marca && otra) throw Object.assign(new Error('duplicate key value violates unique constraint "conc_dec_registro_vinculado"'), { rpcCuerpo: { code: "23505" } }); };
const res1 = await ejecutarLote(S0, { leerFrescos: async () => base(), conciliar: (f) => conciliarMovimientos(movs, f), decidir });
eq("L12 lote completo: 4 decisiones «vinculado», con sus registros", [res1.every((r) => r.ok), llamadas.length, llamadas.every((d) => d.decision === "vinculado")], [true, 4, true]);
eq("L13 los datos no se modifican (huella)", JSON.stringify(d0), h0);
llamadas.length = 0; otra = true;
const res2 = await ejecutarLote(S0, { leerFrescos: async () => base(), conciliar: (f) => conciliarMovimientos(movs, f), decidir });
eq("L14 dos usuarios: el conflicto de la base se informa y el resto sigue", [res2.filter((r) => r.ok).length, res2.find((r) => r.marca === sRut.marca).conflicto, /otra persona/.test(res2.find((r) => r.marca === sRut.marca).motivo)], [3, true, true]);
llamadas.length = 0;
const res3 = await ejecutarLote(S0, { leerFrescos: async () => d1, conciliar: (f) => conciliarMovimientos(movs, f), decidir });
eq("L15 dos usuarios: lo confirmado por otra persona antes de guardar se omite sin llamar a la base", [llamadas.some((d) => d.marca === sRut.marca), res3.find((r) => r.marca === sRut.marca).yaHecho], [false, true]);
eq("L16 errores de unicidad se reconocen como conflicto", [esConflicto({ message: "duplicate key value" }), esConflicto({ message: "otra cosa" })], [true, false]);
// Deshacer: solo las decisiones nuevas de las marcas confirmadas.
const antes = [{ id: 7, marca: "m0", decision: "vinculado" }];
const despues = [...antes, { id: 8, marca: "m1", decision: "vinculado" }, { id: 9, marca: "m2", decision: "vinculado" }, { id: 10, marca: "m3", decision: "rechazado" }, { id: 11, marca: "mx", decision: "vinculado" }];
eq("L17 «Deshacer este lote» anula solo lo creado por el lote", decisionesDelLote(antes, despues, ["m1", "m2", "m3", "m0"]), [8, 9]);

// Conflicto: un vínculo guardado cuyo registro ya no existe («vínculo roto») nunca entra al lote.
const d4 = base(); d4.decisiones = [{ id: 5, marca: xRut.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_no_existe" }];
const C4 = correr(d4).C;
eq("L18 movimiento con vínculo roto (conflicto) no entra al lote", [C4.movimientos.find((x) => x.marca === xRut.marca).vinculoRoto ? "roto" : "-", coincidenciasSeguras(correr(d4).V).some((s) => s.marca === xRut.marca)], ["roto", false]);
// Deshacer: una decisión ANTERIOR de la misma marca (p. ej. un rechazo previo) nunca se anula con el lote.
eq("L19 decisiones anteriores de las mismas marcas no se tocan", decisionesDelLote([{ id: 3, marca: "m1", decision: "rechazado" }], [{ id: 3, marca: "m1", decision: "rechazado" }, { id: 12, marca: "m1", decision: "vinculado" }], ["m1"]), [12]);

console.log(`\nRESUMEN conciliación masiva: ${n} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
