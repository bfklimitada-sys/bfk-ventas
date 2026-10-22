// Conciliación simple sin duplicaciones (21/10/2026): los 15 escenarios pedidos, con datos 100 % ficticios.
// Funciones puras (nada se escribe). Se ejecuta con ejecutar.mjs (esbuild resuelve los imports de src/).
import { leerCartolaBancoEstado, unirCartolas } from "../../src/lib/cartolas.js";
import { conciliarMovimientos, marcaCartola } from "../../src/lib/conciliacion.js";
import { vistaConciliacion } from "../../src/lib/conciliacionVista.js";
import { verificarRegistro } from "../../src/lib/registroCartola.js";
import { cartolaEnLinea, cartolaHistorica, idaYVuelta } from "./cartolas_sinteticas.mjs";

const F = []; let n = 0;
const eq = (k, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { F.push(k); console.log("FALLA " + k + " :: " + String(JSON.stringify(a)).slice(0, 400) + " ≠ " + String(JSON.stringify(b)).slice(0, 300)); } else { n++; console.log("OK    " + k); } };
const si = (k, v, d) => eq(k, !!v, true) || (!v && d !== undefined && console.log("      " + JSON.stringify(d).slice(0, 400)));

// ── Datos BFK ficticios ──
const oc = (id, numero, cliente, rut, extra = {}) => ({ id, numero_oc: numero, cliente, rut_cliente: rut, tipo_registro: "venta", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente",
  monto_facturado: 0, monto_cobrado: 0, financiador_id: "f1", eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_compra: [], eventos_factura: [], ...extra });
const datosBase = () => ({
  financiadores: [{ id: "f1", nombre: "Ana Ficticia Rojas", tipo: "externo" }, { id: "fb", nombre: "Cuenta BFK", tipo: "propio" }],
  vendedores: [{ id: "v1", nombre: "Luis Ejemplo Soto" }],
  ocs: [
    // Universidad Ficticia: factura 303 cobrada el 15/10 (registro manual) y factura 338 pendiente (como el caso real).
    oc("oc1", "1111-200-AG26", "UNIVERSIDAD FICTICIA", "70.000.000-1", { monto_facturado: 124798, monto_cobrado: 124798, estado_pago_cliente: "pagado",
      eventos_factura: [{ id: "fa1", numero_factura: "303", fecha: "2026-08-19", monto: 124798 }],
      eventos_pago_cliente: [{ id: "c_uta", fecha: "2026-10-15", monto: 124798, medio_pago: "transferencia" }] }),
    oc("oc2", "1111-276-AG26", "UNIVERSIDAD FICTICIA", "70.000.000-1", { monto_facturado: 676001, eventos_factura: [{ id: "fa2", numero_factura: "338", fecha: "2026-10-07", monto: 676001 }] }),
    // Cobro registrado con RUT del cliente en la glosa (fecha contable 10/10, banco 12/10).
    oc("oc6", "6666-1-AG26", "HOSPITAL FICTICIO DEL SUR", "69.333.333-3", { monto_facturado: 120000, monto_cobrado: 120000, estado_pago_cliente: "pagado",
      eventos_factura: [{ id: "fa6", numero_factura: "350", fecha: "2026-10-01", monto: 120000 }],
      eventos_pago_cliente: [{ id: "c_hosp", fecha: "2026-10-10", monto: 120000, medio_pago: "transferencia" }] }),
    // Vale vista recibido y aún sin cobrar en el banco.
    oc("oc3", "3333-1-AG26", "MUNICIPALIDAD FICTICIA", "69.111.111-1", { monto_facturado: 910005, monto_cobrado: 0,
      eventos_factura: [{ id: "fa3", numero_factura: "320", fecha: "2026-10-01", monto: 910005 }],
      eventos_pago_cliente: [{ id: "c_vv", fecha: "2026-10-14", monto: 910005, medio_pago: "vale_vista", cobrado_en_banco: false }] }),
    // Compra pagada con fondos propios (Cuenta BFK) y devolución FIFO a la financista.
    oc("oc4", "4444-1-AG26", "CLIENTE COMPRA PROPIA", "76.444.444-4", { financiador_id: "fb", eventos_compra: [{ id: "k1", fecha: "2026-10-16", costo_compra: 80000, financiador_id: "fb", proveedor: "Proveedor CS" }] }),
    oc("oc5", "5555-1-AG26", "CLIENTE FIFO", "76.555.555-5", { eventos_pago_financiamiento: [{ id: "pf1", financiador_id: "f1", fecha: "2026-10-13", monto: 260000 }] }),
  ],
  gastos: [
    { id: "g_iva", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 400000, fecha: "2026-10-20", detalle: "IVA septiembre" },
    { id: "g_ppm", categoria_id: "cat_impuesto", subcategoria: "PPM", monto: 35000, fecha: "2026-10-20", detalle: "PPM septiembre" },
    { id: "g250a", categoria_id: "cat_otros", monto: 250000, fecha: "2026-10-14", detalle: "Arriendo bodega" },
    { id: "g250b", categoria_id: "cat_otros", monto: 250000, fecha: "2026-10-14", detalle: "Servicio técnico" },
    { id: "g_pre", categoria_id: "cat_otros", monto: 77000, fecha: "2026-09-26", detalle: "Proveedor antiguo" },
  ],
  pagosVendedor: [{ id: "pv1", vendedor_id: "v1", fecha: "2026-10-12", monto_pagado: 450000, monto_extra_gestion: 30000, monto_transferido: 480000 }],
  pagoFinSueltos: [], aportes: [], decisiones: [],
});
const categorias = [{ id: "cat_impuesto", nombre: "Impuesto SII" }, { id: "cat_otros", nombre: "Otros" }];

// ── Cartolas ficticias: histórica (antes del cierre) y en línea (después), que empalman por saldo ──
const HIST = [
  { fecha: "2026-09-26", op: "7000005", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 77000 },
  { fecha: "2026-09-27", op: "7000006", desc: "CARGO SIN IDENTIFICAR", cargo: 11111 },
  { fecha: "2026-10-12", op: "8800", desc: "TEF DE 69333333-3 HOSPITAL FICTICIO", abono: 120000 },
];
const LINEA = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-13", op: "8812", desc: "TEF A FICTICIA ROJAS ANA", cargo: 260000 },
  { fecha: "2026-10-14", op: "8813", desc: "TEF A PROVEEDOR UNO", cargo: 250000 },
  { fecha: "2026-10-14", op: "8814", desc: "TEF A PROVEEDOR DOS", cargo: 250000 },
  { fecha: "2026-10-16", op: "8815", desc: "TEF DE 70000000-1 UNIVERSIDAD FICTICIA", abono: 800799 },
  { fecha: "2026-10-16", op: "8816", desc: "TEF A PROVEEDOR CS", cargo: 80000 },
  { fecha: "2026-10-16", op: "8817", desc: "DEPOSITO DOCUMENTO VALE VISTA", abono: 910005 },
  { fecha: "2026-10-17", op: "8818", desc: "TEF A DESCONOCIDO", cargo: 33333 },
  { fecha: "2026-10-17", op: "8819", desc: "TEF DE 69222222-2 OTRO CLIENTE", abono: 55555 },
  { fecha: "2026-10-20", op: "8820", desc: "PAGO EN LINEA SII F29", cargo: 435000 },
];
const hist = leerCartolaBancoEstado(idaYVuelta(cartolaHistorica(HIST, { saldoInicial: 3000000, numero: 9, desde: "2026-09-25", hasta: "2026-10-12" })), "hist.xlsx");
const saldoHist = 3000000 - 77000 - 11111 + 120000;
const lin = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA, { saldoInicial: saldoHist })), "linea.xlsx");
eq("cartolas ficticias válidas", [hist.errores, lin.errores], [[], []]);
const U = unirCartolas([hist, lin]);
const datos = datosBase();
const antes = JSON.stringify(datos);
const C = conciliarMovimientos(U.movs, datos);
const V = vistaConciliacion(C, { ocs: datos.ocs, categorias });
const mov = (f, monto) => C.movimientos.find((x) => x.m.fecha === f && x.monto === monto);
const movs = (f, monto) => C.movimientos.filter((x) => x.m.fecha === f && x.monto === monto);
const grupoDe = (x) => V.ya.some((i) => i.x === x) ? "ya" : V.revisar.some((i) => i.x === x) ? "revisar" : V.sinRegistrar.some((i) => i.x === x) ? "sin" : V.anteriores.some((i) => i.x === x) ? "anteriores" : "?";

// 1. Cartola importada dos veces (y cartolas superpuestas): nada se duplica; marcas idénticas.
const U2 = unirCartolas([hist, lin, hist, lin]);
eq("01 cartola cargada dos veces: mismos movimientos y mismas marcas", [U2.movs.length, U2.movs.map((_, i) => marcaCartola(U2.movs, i))], [U.movs.length, U.movs.map((_, i) => marcaCartola(U.movs, i))]);
const sup = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA.slice(0, 4), { saldoInicial: saldoHist })), "superpuesta.xlsx");
const U3 = unirCartolas([hist, lin, sup]);
eq("14 cartolas de períodos superpuestos: no duplican movimientos", [U3.movs.length, U3.duplicadosQuitados], [U.movs.length, 4]);
const C2 = conciliarMovimientos(U2.movs, datosBase());
eq("01 cargarla dos veces no cambia nada por registrar", C2.movimientos.filter((x) => x.registrable).length, C.movimientos.filter((x) => x.registrable).length);

// 2. Cobro previamente registrado (con diferencia de fecha contable/bancaria de 2 días) → ya registrado.
eq("02/11 cobro ya registrado (fecha contable 10/10, banco 12/10, RUT en la glosa) → Ya registrado", [mov("2026-10-12", 120000).estado, grupoDe(mov("2026-10-12", 120000)), mov("2026-10-12", 120000).registros.map((r) => r.id)], ["conciliado", "ya", ["c_hosp"]]);

// 3. Compra previamente registrada (fondos propios) → por revisar con la compra; nunca un gasto nuevo automático.
const mc = mov("2026-10-16", 80000);
eq("03 compra con fondos propios ya registrada → Por revisar con la compra (no Sin registrar)", [mc.estado, grupoDe(mc), (mc.candidatos || []).map((r) => r.id), mc.registrable], ["posible", "revisar", ["k1"], false]);

// 4. Pago al SII con IVA y PPM juntos → ya registrado; no se propone otro gasto.
const ms = mov("2026-10-20", 435000);
eq("04 pago al SII (IVA + PPM en un cargo) → Ya registrado con ambos gastos", [ms.estado, ms.registros.map((r) => r.id).sort(), ms.registrable], ["conciliado", ["g_iva", "g_ppm"], false]);

// 5. Devolución FIFO existente → ya registrada (no es gasto nuevo, FIFO intacto).
eq("05 devolución a financiadora ya registrada → Ya registrado", [mov("2026-10-13", 260000).estado, mov("2026-10-13", 260000).registros.map((r) => r.tipo)], ["conciliado", ["pago_financiador"]]);

// 6. Comisión de vendedor pagada → ya registrada.
eq("06 pago de comisión ya registrado → Ya registrado", [mov("2026-10-12", 480000).estado, mov("2026-10-12", 480000).registros.map((r) => r.id)], ["conciliado", ["pv1"]]);

// 7. Dos operaciones legítimas de igual monto: ninguna se da por duplicada ni se concilia sola.
const dos = movs("2026-10-14", 250000);
eq("07 dos cargos de $250.000 el mismo día → ambos Por revisar, cada uno con los dos gastos", dos.map((x) => [x.estado, (x.candidatos || []).map((r) => r.id).sort()]), [["posible", ["g250a", "g250b"]], ["posible", ["g250a", "g250b"]]]);
const itDos = V.revisar.find((i) => i.x === dos[0]);
si("07 se avisa que hay otro igual el mismo día, sin llamarlo duplicado", itDos?.aviso && /operaciones distintas/.test(itDos.aviso) && !/duplicad[oa]s?\b(?!\.)/.test(itDos.aviso.replace("no se trata como duplicado", "")), itDos?.aviso);

// 8 y 9. Gasto y cobro sin coincidencia → Sin registrar (se registran solo con confirmación).
eq("08 gasto sin coincidencia → Sin registrar", [mov("2026-10-17", 33333).estado, grupoDe(mov("2026-10-17", 33333)), mov("2026-10-17", 33333).registrable], ["pendiente", "sin", true]);
eq("09 cobro sin coincidencia → Sin registrar", [mov("2026-10-17", 55555).estado, grupoDe(mov("2026-10-17", 55555)), mov("2026-10-17", 55555).registrable], ["pendiente", "sin", true]);

// 10. Vale vista recibido pero no cobrado: no cuenta como caja ni como «registrado sin banco»; su depósito se
//     propone marcar como cobrado (no un cobro nuevo).
const mv = mov("2026-10-16", 910005);
eq("10 depósito del vale vista → Por revisar (marcar cobrado), no un cobro nuevo", [grupoDe(mv), V.revisar.find((i) => i.x === mv)?.tipo, mv.valeVista?.map((v) => v.id)], ["revisar", "vale_vista", ["c_vv"]]);
eq("10 vale vista sin depósito no figura como registrado sin banco", C.sinLinea.some((r) => r.id === "c_vv"), false);

// 12. Registro BFK sin movimiento bancario (el caso real): explica el posible pago conjunto, no lo llama duplicado.
const uta = V.registradosSinBanco.find((s) => s.r.id === "c_uta");
si("12 cobro de $124.798 sin movimiento → Registrado en BFK, pendiente de verificar en banco", uta, V.registradosSinBanco.map((s) => s.r.id));
si("12 pista: abono de $800.799 = este cobro + factura 1111-276 pendiente ($676.001)", uta?.tipoPista === "agrupado" && /800\.799/.test(uta.pista) && /1111-276-AG26/.test(uta.pista), uta?.pista);
si("12 nunca se llama duplicado", V.registradosSinBanco.every((s) => !/duplicado(?! necesariamente)/i.test(s.pista.replace("No es necesariamente un duplicado", ""))), V.registradosSinBanco.map((s) => s.pista));

const itConj = V.sinRegistrar.find((i) => i.x.monto === 800799);
si("12 el abono de $800.799 se presenta como HIPÓTESIS y pide evidencia; no propone crear ni eliminar cobros", itConj?.conjunto && /^Hipótesis/.test(itConj.posible) && /No registres ni elimines cobros solo por esta suma/.test(itConj.accion) && /comprobante/.test(itConj.accion) && !itConj.x.registrable === false, itConj);
// Si se registra desde la OC el cobro pendiente ($676.001, misma fecha del banco), el abono queda conciliado solo.
const datosConj = datosBase(); datosConj.ocs.find((o) => o.id === "oc2").eventos_pago_cliente.push({ id: "c_338", fecha: "2026-10-16", monto: 676001, medio_pago: "transferencia" });
const CJ = conciliarMovimientos(U.movs, datosConj);
const mj = CJ.movimientos.find((x) => x.monto === 800799);
eq("12 tras registrar lo pendiente: el abono queda Ya registrado con los dos cobros y ya no hay aviso", [mj.estado, mj.registros.map((r) => r.id).sort(), CJ.sinLinea.some((r) => r.id === "c_uta")], ["conciliado", ["c_338", "c_uta"], false]);

// 13. Movimientos anteriores al cierre: solo consulta (no registrables).
eq("13 anterior al cierre sin registro → Antes del cierre, no registrable", [grupoDe(mov("2026-09-27", 11111)), mov("2026-09-27", 11111).registrable], ["anteriores", false]);
eq("13 anterior al cierre que solo coincide en monto y fecha → Antes del cierre (solo consulta)", [grupoDe(mov("2026-09-26", 77000)), mov("2026-09-26", 77000).estado, mov("2026-09-26", 77000).registrable], ["anteriores", "posible", false]);

// 15. Pendientes que se resuelven después: decisiones y registros posteriores.
const mDesc = mov("2026-10-17", 33333);
const datosDesp = datosBase();
datosDesp.gastos.push({ id: "g_nuevo", categoria_id: "cat_otros", monto: 33333, fecha: "2026-10-17", detalle: "Desde cartola", marca_cartola: mDesc.marca });
datosDesp.decisiones = [
  { marca: mc.marca, decision: "vinculado", tabla: "eventos_compra", registro_id: "k1", usuario_nombre: "Kevin", creado_en: "2026-10-21T10:00:00Z" },
  { marca: dos[0].marca, decision: "vinculado", tabla: "gastos_indirectos", registro_id: "g250a" },
  { marca: dos[1].marca, decision: "rechazado", tabla: "gastos_indirectos", registro_id: "g250a" },
  { marca: mov("2026-10-17", 55555).marca, decision: "rechazado", tabla: "eventos_pago_cliente", registro_id: "c_hosp" },
];
const D = conciliarMovimientos(U.movs, datosDesp);
const d = (f, monto, k = 0) => D.movimientos.filter((x) => x.m.fecha === f && x.monto === monto)[k];
eq("15 registrado desde la cartola → Ya registrado por la marca (certeza)", [d("2026-10-17", 33333).estado, d("2026-10-17", 33333).origen, d("2026-10-17", 33333).registrable], ["conciliado", "cartola", false]);
eq("15 vínculo confirmado (compra) → Ya registrado, sin crear nada", [d("2026-10-16", 80000).estado, d("2026-10-16", 80000).origen, d("2026-10-16", 80000).registros.map((r) => r.id)], ["conciliado", "decision", ["k1"]]);
eq("15 el gasto vinculado a un cargo ya no se ofrece al otro cargo igual (queda solo el otro gasto, por revisar)", [d("2026-10-14", 250000, 0).registros.map((r) => r.id), d("2026-10-14", 250000, 1).estado, (d("2026-10-14", 250000, 1).candidatos || []).map((r) => r.id)], [["g250a"], "posible", ["g250b"]]);
eq("15 rechazo: el registro rechazado no se vuelve a proponer para ese movimiento", (d("2026-10-17", 55555).candidatos || []).some((r) => r.id === "c_hosp"), false);
eq("15 verificación previa: un movimiento vinculado no se registra de nuevo", verificarRegistro(U.movs, d("2026-10-16", 80000).i, datosDesp).ok, false);
const datosRoto = datosBase(); datosRoto.decisiones = [{ id: 9, marca: mc.marca, decision: "vinculado", tabla: "eventos_compra", registro_id: "k_borrada" }];
const R = conciliarMovimientos(U.movs, datosRoto); const VR = vistaConciliacion(R, { ocs: datosRoto.ocs, categorias });
eq("15 vínculo con un registro que ya no existe → Por revisar (no queda como conciliado)", VR.revisar.find((i) => i.x.marca === mc.marca)?.tipo, "vinculo_roto");

// Movimiento incompatible: no se agrupan registros de tipos distintos.
const datosMix = datosBase(); datosMix.gastos.push({ id: "g80", categoria_id: "cat_otros", monto: 80000, fecha: "2026-10-16", detalle: "Otro" });
const VM = vistaConciliacion(conciliarMovimientos(U.movs, datosMix), { ocs: datosMix.ocs, categorias });
const itMix = VM.revisar.find((i) => i.x.m.fecha === "2026-10-16" && i.x.monto === 80000);
eq("un movimiento no se vincula a registros de tipos distintos a la vez (una opción por registro)", itMix?.opciones.map((o) => o.registros.length), [1, 1]);

// Pantalla: grupos y textos simples.
eq("grupos: por revisar / sin registrar / ya registrados / antes del cierre", [V.revisar.length, V.sinRegistrar.length, V.ya.length, V.anteriores.length], [4, 3, 4, 2]);
si("textos sin «control inverso», «posible registrado» ni «registro posterior al cierre»", ![...V.ya, ...V.revisar, ...V.sinRegistrar, ...V.anteriores].some((i) => /control inverso|posible registrado|registro posterior al cierre/i.test(JSON.stringify([i.titulo, i.motivo, i.accion]))));
si("cada movimiento trae fecha, descripción, monto, motivo y acción", [...V.revisar, ...V.sinRegistrar].every((i) => i.fecha && i.descripcion && i.monto > 0 && i.motivo && i.accion));
// Ejemplo de Kevin: gasto de $250.000 ya registrado y su transferencia → se ofrece conciliar con el gasto existente
// («Es este registro»), sin crear otro gasto; una vez confirmado: «Gasto de $250.000 ya registrado en BFK».
{
  const dk = datosBase(); dk.gastos = dk.gastos.filter((g) => g.id !== "g250b");
  const Ck = conciliarMovimientos(U.movs, dk); const xk = Ck.movimientos.find((x) => x.m.operacion === "8813");
  const Vk = vistaConciliacion(Ck, { ocs: dk.ocs, categorias }); const ik = Vk.revisar.find((i) => i.x === xk);
  eq("ejemplo de Kevin: gasto de $250.000 ya registrado → Por revisar con «Es este registro» y sin registro nuevo", [xk.estado, xk.registrable, ik?.opciones.map((o) => o.registros.map((r) => r.id))], ["posible", false, [["g250a"]]]);
  dk.decisiones = [{ marca: xk.marca, decision: "vinculado", tabla: "gastos_indirectos", registro_id: "g250a" }];
  const Vk2 = vistaConciliacion(conciliarMovimientos(U.movs, dk), { ocs: dk.ocs, categorias });
  eq("ejemplo de Kevin: confirmado → «Gasto de $250.000 ya registrado en BFK»", Vk2.ya.find((i) => i.x.m.operacion === "8813")?.titulo, "Gasto de $250.000 ya registrado en BFK");
}

// ═════ Verificaciones previas a la publicación (Kevin, 21/10/2026 22:52) ═════
// V1. Monto y fecha solos → «Por revisar», nunca conciliación automática.
{
  const dv = datosBase();
  dv.gastos = [{ id: "gv", categoria_id: "cat_otros", monto: 33333, fecha: "2026-10-17", detalle: "Algo" }];   // mismo monto y fecha que «TEF A DESCONOCIDO»
  dv.ocs.find((o) => o.id === "oc2").eventos_pago_cliente.push({ id: "cv", fecha: "2026-10-17", monto: 55555, medio_pago: "transferencia" });   // cliente distinto al del detalle
  const Cv = conciliarMovimientos(U.movs, dv);
  const g = Cv.movimientos.find((x) => x.monto === 33333), c = Cv.movimientos.find((x) => x.monto === 55555);
  eq("V1 cargo con un único gasto del mismo monto y fecha → Por revisar (no conciliado ni registrable)", [g.estado, g.registrable, g.evidencia], ["posible", false, ["monto exacto", "fecha ±3 días", "sin otro dato"]]);
  eq("V1 abono con un único cobro del mismo monto y fecha, sin RUT ni nombre → Por revisar", [c.estado, c.registrable], ["posible", false]);
  const dsii = datosBase(); const sinGlosa = U.movs.map((m) => (m.descripcion === "PAGO EN LINEA SII F29" ? { ...m, descripcion: "TRANSFERENCIA ELECTRONICA" } : m));
  eq("V1 IVA + PPM que suman el cargo pero el detalle no dice SII → Por revisar con ambos gastos", (() => { const x = conciliarMovimientos(sinGlosa, dsii).movimientos.find((y) => y.monto === 435000); return [x.estado, (x.candidatos || []).map((r) => r.id).sort()]; })(), ["posible", ["g_iva", "g_ppm"]]);
}
// V2. Las decisiones persisten: misma marca al recargar, con cartolas superpuestas y en otro orden de carga.
{
  const lin2 = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA, { saldoInicial: saldoHist, glosaVariante: true })), "otra_descarga.xlsx");
  const supB = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(LINEA.slice(2, 7), { saldoInicial: saldoHist - 480000 - 260000 })), "tramo.xlsx");
  const cargas = [[hist, lin], [lin, hist], [hist, lin2, supB], [supB, lin, hist, lin2]].map((cs) => unirCartolas(cs).movs);
  const marcas = cargas.map((ms) => ms.map((_, i) => marcaCartola(ms, i)).sort());
  eq("V2 misma marca de cada movimiento al recargar, en otro orden y con cartolas superpuestas", marcas.every((m) => JSON.stringify(m) === JSON.stringify(marcas[0])), true);
  const dd = datosBase(); dd.decisiones = [{ marca: mc.marca, decision: "vinculado", tabla: "eventos_compra", registro_id: "k1" }, { marca: mov("2026-10-17", 55555).marca, decision: "rechazado", tabla: "eventos_pago_cliente", registro_id: "c_hosp" }];
  eq("V2 la decisión se aplica igual en las cuatro formas de cargar", cargas.map((ms) => conciliarMovimientos(ms, dd).movimientos.find((x) => x.monto === 80000).origen), ["decision", "decision", "decision", "decision"]);
}
// V3. Identificación estable aun con dos transferencias legítimas del mismo monto y fecha.
{
  eq("V3 dos cargos de $250.000 el mismo día → marcas distintas", new Set(dos.map((x) => x.marca)).size, 2);
  // Caso extremo: cargo, abono y cargo del mismo monto el mismo día → dos líneas con la MISMA fecha, monto y saldo.
  const EXT = [{ fecha: "2026-10-18", op: "9001", desc: "TEF A PROVEEDOR X", cargo: 1000 }, { fecha: "2026-10-18", op: "9002", desc: "TEF DE PROVEEDOR X", abono: 1000 }, { fecha: "2026-10-18", op: "9003", desc: "TEF A PROVEEDOR X", cargo: 1000 }];
  const e1 = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(EXT, { saldoInicial: 50000 })), "e1.xlsx");
  const e2 = leerCartolaBancoEstado(idaYVuelta(cartolaEnLinea(EXT, { saldoInicial: 50000, glosaVariante: true })), "e2.xlsx");
  const mk = (cs) => { const ms = unirCartolas(cs).movs; return ms.map((m, i) => `${m.operacion}=${marcaCartola(ms, i)}`); };
  const a1 = mk([e1]), a2 = mk([e2, e1]), a3 = mk([e1, e2, e1]);
  eq("V3 líneas idénticas (misma fecha, monto y saldo) → ocurrencia 1 y 2, y no se pierde ninguna", [a1.length, new Set(a1.map((x) => x.split("=")[1])).size], [3, 3]);
  eq("V3 la ocurrencia es estable al recargar y con otra descarga de la misma cartola", [JSON.stringify(a2) === JSON.stringify(a1), JSON.stringify(a3) === JSON.stringify(a1)], [true, true]);
}
// V4. Una decisión no vincula el movimiento con registros incompatibles.
{
  const dm = datosBase(); dm.gastos.push({ id: "g80", categoria_id: "cat_otros", monto: 80000, fecha: "2026-10-16", detalle: "Otro" });
  const VM2 = vistaConciliacion(conciliarMovimientos(U.movs, dm), { ocs: dm.ocs, categorias });
  const it = VM2.revisar.find((i) => i.x.monto === 80000);
  eq("V4 compra y gasto del mismo monto → una opción por registro, nunca juntos", it.opciones.map((o) => o.registros.map((r) => r.tabla)), [["eventos_compra"], ["gastos_indirectos"]]);
  dm.decisiones = [{ marca: it.marca, decision: "vinculado", tabla: "eventos_compra", registro_id: "k1" }, { marca: it.marca, decision: "vinculado", tabla: "gastos_indirectos", registro_id: "g80" }];
  const x = conciliarMovimientos(U.movs, dm).movimientos.find((y) => y.monto === 80000);
  eq("V4 si llegaran vínculos de tipos distintos (la base lo impide), el movimiento NO queda conciliado: vuelve a revisarse", [x.estado === "conciliado", !!x.vinculoRoto, x.registrable], [false, true, false]);
}
// V5. Abono conjunto contra varios cobros: sin duplicar los registrados ni superar lo abonado.
{
  const dj = datosBase(); dj.ocs.find((o) => o.id === "oc2").eventos_pago_cliente.push({ id: "c_338", fecha: "2026-10-16", monto: 676001, medio_pago: "transferencia" });
  const sinRut = U.movs.map((m) => (m.abono === 800799 ? { ...m, descripcion: "TRANSFERENCIA DE TERCEROS" } : m));
  const xj = conciliarMovimientos(sinRut, dj).movimientos.find((y) => y.monto === 800799);
  const ij = vistaConciliacion(conciliarMovimientos(sinRut, dj), { ocs: dj.ocs, categorias }).revisar.find((i) => i.x.monto === 800799);
  eq("V5 sin RUT en el detalle: los dos cobros que suman el abono quedan Por revisar como UNA opción conjunta", [xj.estado, ij?.opciones.map((o) => o.registros.map((r) => r.id).sort())], ["posible", [["c_338", "c_uta"]]]);
  eq("V5 la opción conjunta suma exactamente lo abonado (no lo supera)", ij.opciones[0].registros.reduce((a, r) => a + r.monto, 0), 800799);
  dj.decisiones = [{ marca: xj.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_uta" }, { marca: xj.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_338" }];
  const Cj = conciliarMovimientos(sinRut, dj);
  eq("V5 confirmado: conciliado con ambos cobros, ninguno queda «sin banco» y no hay nada por registrar", [Cj.movimientos.find((y) => y.monto === 800799).estado, Cj.sinLinea.some((r) => ["c_uta", "c_338"].includes(r.id)), Cj.movimientos.find((y) => y.monto === 800799).registrable], ["conciliado", false, false]);
  const dSolo = datosBase(); dSolo.decisiones = [{ marca: xj.marca, decision: "vinculado", tabla: "eventos_pago_cliente", registro_id: "c_uta" }];
  const xs = conciliarMovimientos(sinRut, dSolo).movimientos.find((y) => y.monto === 800799);
  eq("V5 un vínculo que no cubre el abono completo no lo deja conciliado (la base además exige suma exacta)", [xs.estado === "conciliado", !!xs.vinculoRoto, xs.registrable], [false, true, false]);
}
// V6. Confirmar o descartar no modifica ningún dato financiero.
{
  const d6 = datosBase(); const h6 = JSON.stringify({ ...d6, decisiones: undefined });
  d6.decisiones = [{ marca: mc.marca, decision: "vinculado", tabla: "eventos_compra", registro_id: "k1" }, { marca: dos[0].marca, decision: "rechazado", tabla: "gastos_indirectos", registro_id: "g250a" }];
  conciliarMovimientos(U.movs, d6); vistaConciliacion(conciliarMovimientos(U.movs, d6), { ocs: d6.ocs, categorias }); verificarRegistro(U.movs, 0, d6);
  eq("V6 compras, cobros, gastos, pagos al SII, comisiones y devoluciones intactos tras decidir", JSON.stringify({ ...d6, decisiones: undefined }), h6);
}

// La conciliación no cambia ningún dato (huella de los datos de entrada).
eq("la conciliación no modifica los datos (huella idéntica)", JSON.stringify(datos), antes);

console.log(`\nRESUMEN conciliación simple: ${n} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
