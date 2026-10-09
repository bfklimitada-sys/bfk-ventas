// Pruebas de la conciliación bancaria (Etapas 1 a 3, autorizadas el 09/10/2026). Datos 100 % ficticios.
// Ejecutar: node docs/pruebas-conciliacion-bancaria/ejecutar.mjs
import { createHash } from "node:crypto";
import { claveMovimiento, leerCartolaBancoEstado, montoEntero, normalizarOperacion, totalesPorMes, unirCartolas } from "../../src/lib/cartolas.js";
import { CIERRE_CONCILIACION, conciliarMovimientos, opcionesAbono, registrosBancarios } from "../../src/lib/conciliacion.js";
import { apoyoEnGestion, cajaYFueraDelBanco, claseGasto, comisionesYApoyo, resultadoMes, resumenFinanciadores } from "../../src/lib/informes.js";
import { calcularF29, desgloseF29, periodoF29 } from "../../src/lib/f29.js";
import { calcularPagoVendedor } from "../../src/lib/calculos.js";
import { comisionesPorPagar, movimientosCaja, resumenCaja } from "../../src/lib/caja.js";
import { repartirFIFO, ocsPendientesFinanciador } from "../../src/components/forms/FormAbonoFinanciador.jsx";
import { cartolaEnLinea, cartolaHistorica, idaYVuelta } from "./cartolas_sinteticas.mjs";
import { esConflictoDuplicado, idRegistroCartola, marcaMovimiento, verificarRegistro } from "../../src/lib/registroCartola.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const leer = (wb, n = "c.xlsx") => leerCartolaBancoEstado(idaYVuelta(wb), n);
const huella = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex");

// ════════════════ 1. Lector de cartolas ════════════════
const movsH = [
  { fecha: "2026-09-01", op: "0008812", desc: "TEF DE MUNICIPALIDAD FICTICIA DEL VALLE", abono: 430000 },
  { fecha: "2026-09-02", op: "7012345", desc: "TEF A FICTICIA ROJAS ANA", cargo: 120000 },
  { fecha: "2026-09-03", op: "7000020", desc: "DEPOSITO CON DOCUMENTOS", abono: 80000 },
];
let c = leer(cartolaHistorica(movsH, { saldoInicial: 10000, numero: 4 }), "h.xlsx");
eq("histórica: se lee por encabezado, sin errores", [c.formato, c.errores, c.movs.length, c.numero], ["historico", [], 3, "4"]);
eq("histórica: fecha con año, operación sin ceros, montos enteros y saldo conservado", c.movs.map((m) => [m.fecha, m.operacion, m.cargo, m.abono, m.saldo]),
  [["2026-09-01", "8812", 0, 430000, 440000], ["2026-09-02", "7012345", 120000, 0, 320000], ["2026-09-03", "7000020", 0, 80000, 400000]]);
eq("histórica: depósitos con documentos validados con Total Abonos + Total Depósitos", leer(cartolaHistorica(movsH, { saldoInicial: 10000 })).errores, []);
eq("histórica: columnas en otro orden → mismo resultado", leer(cartolaHistorica(movsH, { saldoInicial: 10000, columnasDesordenadas: true })).movs.map(claveMovimiento), c.movs.map(claveMovimiento));
eq("histórica: falta una columna → archivo rechazado completo", (() => { const r = leer(cartolaHistorica(movsH, { sinColumna: "Saldo" })); return [r.movs.length, /Saldo/.test(r.errores[0])]; })(), [0, true]);
eq("histórica: Resumen que no cuadra → rechazado", leer(cartolaHistorica(movsH, { saldoInicial: 10000, totalesMal: true })).movs.length, 0);
eq("histórica: N° de movimientos declarado distinto → rechazado", leer(cartolaHistorica(movsH, { saldoInicial: 10000, nDeclarados: 5 })).errores.some((e) => /declara 5/.test(e)), true);
eq("histórica: última fecha distinta de la Fecha Final → rechazado", leer(cartolaHistorica(movsH, { saldoInicial: 10000, hasta: "2026-09-30" })).errores.some((e) => /Fecha Final/.test(e)), true);
eq("histórica: cadena de saldo rota → rechazado", (() => { const r = leer(cartolaHistorica([{ ...movsH[0] }, { ...movsH[1], saldo: 1 }, movsH[2]], { saldoInicial: 10000 })); return [r.movs.length, r.errores.some((e) => /saldo no cuadra/i.test(e))]; })(), [0, true]);
// Histórica de más de 12 meses: el año se obtiene recorriendo los meses
const largos = [["2024-06-14", 1000], ["2024-10-21", 2000], ["2025-01-09", 3000], ["2025-06-27", 4000], ["2025-07-18", 5000]].map(([f, a], k) => ({ fecha: f, op: String(7000000 + k), desc: "TEF DE CLIENTE FICTICIO", abono: a }));
eq("histórica de más de 12 meses: años correctos", leer(cartolaHistorica(largos, { saldoInicial: 0 })).movs.map((m) => m.fecha), largos.map((m) => m.fecha));
eq("monto con decimales → error", (() => { try { montoEntero(1500.5, "x"); return "aceptado"; } catch { return "rechazado"; } })(), "rechazado");
eq("formatos de monto BancoEstado", [montoEntero("$1.234.567"), montoEntero("$ 98.765"), montoEntero(""), montoEntero(0)], [1234567, 98765, 0, 0]);
eq("N° de operación de 7 y 11 dígitos → misma referencia", [normalizarOperacion("0008812"), normalizarOperacion("00000008812"), normalizarOperacion("")], ["8812", "8812", ""]);
const linea = leer(cartolaEnLinea([{ fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 }, { fecha: "2026-10-13", op: "7000009", desc: "ABONO PAGO A PROVEEDORES", abono: 143999 }], { saldoInicial: 600000 }), "linea.xlsx");
eq("en línea: «$ x», vacíos, operación de 11 dígitos y saldo", [linea.formato, linea.errores, linea.movs.map((m) => [m.fecha, m.operacion, m.cargo, m.abono, m.saldo])],
  ["linea", [], [["2026-10-12", "8811", 480000, 0, 120000], ["2026-10-13", "7000009", 0, 143999, 263999]]]);
eq("libro que no es cartola → rechazado sin excepción", leerCartolaBancoEstado({ Sheets: {} }, "x").errores.length > 0, true);

// ════════════════ 2. Unión de cartolas y deduplicación ════════════════
const h1 = leer(cartolaHistorica(movsH, { saldoInicial: 10000, numero: 4 }), "h1.xlsx");
const h1b = leer(cartolaHistorica(movsH, { saldoInicial: 10000, numero: 4 }), "h1-otra-descarga.xlsx");
let u = unirCartolas([h1, h1b]);
eq("archivo repetido: no duplica nada", [u.leidos, u.movs.length, u.duplicadosQuitados, u.archivosRepetidos], [6, 3, 3, 1]);
const mismoEnLinea = leer(cartolaEnLinea(movsH, { saldoInicial: 10000, glosaVariante: true }), "mismo-periodo-en-linea.xlsx");
u = unirCartolas([h1, mismoEnLinea]);
eq("mismo período en el otro formato (glosa distinta): no duplica", [u.movs.length, u.faltantes.length], [3, 0]);
const giros = leer(cartolaHistorica([{ fecha: "2025-03-17", op: "", desc: "GIRO CAJERO AUTOMATICO 14/03 11:02", cargo: 90000 }, { fecha: "2025-03-17", op: "", desc: "GIRO CAJERO AUTOMATICO 14/03 11:04", cargo: 90000 }], { saldoInicial: 300000 }), "giros.xlsx");
eq("dos movimientos reales iguales del mismo día se conservan", unirCartolas([giros, giros]).movs.length, 2);
const siguiente = leer(cartolaHistorica([{ fecha: "2026-09-10", op: "7000099", desc: "TEF DE OTRO CLIENTE", abono: 1000 }], { saldoInicial: 400000, numero: 5 }), "n5.xlsx");
const conHueco = leer(cartolaHistorica([{ fecha: "2026-09-20", op: "7000100", desc: "TEF DE OTRO CLIENTE", abono: 1000 }], { saldoInicial: 999000, numero: 7 }), "n7.xlsx");
eq("continuidad: cartolas que empalman no avisan faltantes", unirCartolas([h1, siguiente]).faltantes.length, 0);
u = unirCartolas([h1, siguiente, conHueco]);
eq("cartola faltante detectada por saldo", u.faltantes.map((g) => [g.despuesDe, g.antesDe, g.saldoEsperado, g.saldoEncontrado]), [["2026-09-10", "2026-09-20", 401000, 999000]]);
const rota = leer(cartolaHistorica(movsH, { saldoInicial: 10000, totalesMal: true }), "rota.xlsx");
u = unirCartolas([h1, rota]);
eq("cartola con error: se informa y no se usa", [u.rechazadas.map((r) => r.nombre), u.movs.length], [["rota.xlsx"], 3]);
eq("totales por mes para banco_mensual", totalesPorMes(h1.movs), [{ id: "2026-09", anio: 2026, mes: 9, entro: 510000, salio: 120000, saldo_cierre: 400000 }]);

// ════════════════ 3. Conciliación ════════════════
const ev = (id, fecha, monto, o = {}) => ({ id, fecha, monto, medio_pago: "transferencia", ...o });
const oc = (id, numero, o = {}) => ({ id, numero_oc: numero, cliente: "CLIENTE FICTICIO", rut_cliente: "", tipo_registro: "venta", archivada: false, es_venta_propia: false,
  financiador_id: "f_ana", vendedor_id: "v_luis", estado_factura_propia: "emitida", monto_total: 0, costo_total: 0, monto_facturado: 0, monto_cobrado: 0, monto_pagado_fin: 0,
  estado_pago_financiamiento: "pendiente", eventos_compra: [], eventos_factura: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [], ...o });
const datos = {
  financiadores: [{ id: "f_ana", nombre: "Ana Ficticia Rojas", tipo: "externo", saldo_deuda: 560000 }, { id: "f_bfk", nombre: "Cuenta BFK", tipo: "propio", saldo_deuda: 0 }],
  vendedores: [{ id: "v_luis", nombre: "Luis Ejemplo Soto" }, { id: "v_pedro", nombre: "Pedro Prueba Vera" }],
  ocs: [
    oc("o1", "OC-1", { cliente: "MUNICIPALIDAD FICTICIA DEL VALLE", rut_cliente: "70.123.456-3", monto_total: 430000, monto_facturado: 430000, monto_cobrado: 430000, costo_total: 400000,
      eventos_compra: [{ fecha: "2026-08-20", costo_compra: 400000 }], eventos_factura: [{ id: "f1", numero_factura: "10", fecha: "2026-09-01", monto: 430000 }], eventos_pago_cliente: [ev("c1", "2026-09-15", 430000)] }),
    oc("o2", "OC-2", { cliente: "SERVICIO DE SALUD NORTE", rut_cliente: "61.000.000-2", monto_total: 300000, monto_facturado: 300000, monto_cobrado: 300000,
      eventos_factura: [{ id: "f2", numero_factura: "11", fecha: "2026-09-02", monto: 300000 }], eventos_pago_cliente: [ev("c2", "2026-09-10", 300000)] }),
    oc("o3", "OC-3", { monto_total: 143999, monto_facturado: 143999, eventos_factura: [{ id: "f3", numero_factura: "12", fecha: "2026-10-12", monto: 143999 }] }),
    oc("o4", "OC-4", { monto_total: 143999, monto_facturado: 143999, eventos_factura: [{ id: "f4", numero_factura: "13", fecha: "2026-10-20", monto: 143999 }] }),
    oc("o5", "OC-5", { costo_total: 100000, monto_pagado_fin: 100000, estado_pago_financiamiento: "pagado", eventos_compra: [{ fecha: "2026-08-01", costo_compra: 100000 }], eventos_pago_financiamiento: [{ id: "pf1", fecha: "2026-09-05", monto: 100000 }] }),
    oc("o6", "OC-6", { costo_total: 150000, monto_pagado_fin: 150000, estado_pago_financiamiento: "pagado", eventos_compra: [{ fecha: "2026-08-02", costo_compra: 150000 }], eventos_pago_financiamiento: [{ id: "pf2", fecha: "2026-09-05", monto: 150000 }] }),
    oc("o7", "OC-7", { costo_total: 250000, monto_pagado_fin: 250000, estado_pago_financiamiento: "pagado", eventos_compra: [{ fecha: "2026-08-03", costo_compra: 250000 }], eventos_pago_financiamiento: [{ id: "pf3", fecha: "2026-09-05", monto: 250000 }] }),
    oc("o9", "OC-9", { costo_total: 460000, monto_pagado_fin: 300000, eventos_compra: [{ fecha: "2026-08-04", costo_compra: 460000 }], eventos_pago_financiamiento: [{ id: "pf4", fecha: "2026-09-12", monto: 300000 }] }),
    oc("o8", "OC-8", { tipo_registro: "externa", monto_total: 380003, eventos_pago_cliente: [ev("c8", "2026-09-22", 380003, { medio_pago: "fuera_banco" })] }),
  ],
  gastos: [
    { id: "g1", fecha: "2026-09-30", monto: 200000, categoria_id: "cat_gratificacion", anio: 2026, mes: 9, detalle: "Aguinaldo Luis Ejemplo" },
    { id: "g2", fecha: "2026-09-30", monto: 200000, categoria_id: "cat_gratificacion", anio: 2026, mes: 9, detalle: "Aguinaldo Pedro Prueba" },
    { id: "g3", fecha: "2026-10-13", monto: 18750, categoria_id: "cat_apoyo_gestion", anio: 2026, mes: 10, detalle: "Apoyo en gestión" },
    { id: "g4", fecha: "2026-09-17", monto: 50000, categoria_id: "cat_impuesto", anio: 2026, mes: 8, detalle: "F29 agosto" },
  ],
  pagosVendedor: [],
  pagoFinSueltos: [],
  aportes: [{ id: "a1", fecha: "2026-09-28", monto: 300000, socio: "Ana Ficticia Rojas", tipo: "retiro", medio: "Transferencia BancoEstado" }],
};
const banco = [
  { fecha: "2026-09-05", op: "7000001", desc: "TEF A FICTICIA ROJAS ANA", cargo: 500000 },
  { fecha: "2026-09-12", op: "7000002", desc: "TEF A FICTICIA ROJAS ANA", cargo: 320000 },
  { fecha: "2026-09-15", op: "7000030", desc: "PAGOS VARIOS RUT 70123456-3", abono: 430000 },
  { fecha: "2026-09-18", op: "7000003", desc: "TEF BANCOESTADO DE OPERADOR LOGISTICO FICTICIO", abono: 104537 },
  { fecha: "2026-09-18", op: "7000004", desc: "TEF BANCOESTADO A OPERADOR LOGISTICO FICTICIO", cargo: 104537 },
  { fecha: "2026-09-20", op: "7000031", desc: "ABONO PAGO A PROVEEDORES", abono: 300000 },
  { fecha: "2026-09-23", op: "8812", desc: "TEF DE CLIENTE DESCONOCIDO", abono: 380003 },
  { fecha: "2026-09-25", op: "7000020", desc: "DEPOSITO CON DOCUMENTOS", abono: 143999 },
  { fecha: "2026-09-26", op: "7000005", desc: "TEF A PROVEEDOR FICTICIO XYZ", cargo: 77000 },
  { fecha: "2026-09-28", op: "7000006", desc: "TEF A FICTICIA ROJAS ANA", cargo: 300000 },
  { fecha: "2026-10-01", op: "7000007", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 200000 },
  { fecha: "2026-10-01", op: "7000008", desc: "TEF A PRUEBA VERA PEDRO", cargo: 200000 },
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-13", op: "7000009", desc: "ABONO PAGO A PROVEEDORES", abono: 143999 },
];
const cart = leer(cartolaHistorica(banco, { saldoInicial: 2000000, numero: 6 }), "n6.xlsx");
eq("cartola sintética de prueba válida", cart.errores, []);
const crudo = huella(datos);
const r = conciliarMovimientos(unirCartolas([cart]).movs, datos);
const est = (f, monto) => { const x = r.movimientos.find((y) => y.m.fecha === f && y.monto === monto); return x && [x.estado, x.registrable]; };
const regs = (f, monto, desc) => r.movimientos.filter((y) => y.m.fecha === f && y.monto === monto && (!desc || y.m.descripcion.includes(desc))).map((y) => y.registros.map((g) => g.id));
eq("cobro con RUT del cliente en la glosa → conciliado", [est("2026-09-15", 430000), regs("2026-09-15", 430000)], [["conciliado", false], [["c1"]]]);
eq("abono solo por monto (sin RUT ni nombre, 10 días) → posible, nunca preseleccionado", [est("2026-09-20", 300000), r.movimientos.some((x) => x.preseleccionado)], [["posible", false], false]);
eq("pago agrupado (lote FIFO de 3 registros que suman exacto) → conciliado", [est("2026-09-05", 500000), regs("2026-09-05", 500000)[0].sort()], [["conciliado", false], ["pf1", "pf2", "pf3"]]);
eq("lote que no suma exacto → posible registrado, no conciliado", est("2026-09-12", 320000), ["posible", false]);
eq("aguinaldos del mismo día y monto a personas distintas: cada uno con su registro", [regs("2026-10-01", 200000, "LUIS")[0], regs("2026-10-01", 200000, "PEDRO")[0]], [["g1"], ["g2"]]);
const usos = {}; r.movimientos.forEach((x) => x.registros.forEach((g) => (usos[g.id] = (usos[g.id] || 0) + 1)));
eq("ningún registro BFK se usa para dos movimientos", Object.values(usos).filter((n) => n > 1).length, 0);
eq("abono y cargo compensados el mismo día → neutro", [est("2026-09-18", 104537), r.movimientos.filter((x) => x.estado === "neutro").length], [["neutro", false], 2]);
eq("cobro registrado fuera del banco no concilia un abono del mismo monto → pendiente visible", est("2026-09-23", 380003), ["pendiente", false]);
eq("retiro de capital por banco → conciliado con el retiro (no con un gasto)", [est("2026-09-28", 300000), regs("2026-09-28", 300000)[0]], [["conciliado", false], ["a1"]]);
eq("pendientes anteriores al cierre: visibles y NO registrables", [est("2026-09-25", 143999), est("2026-09-26", 77000)], [["pendiente", false], ["pendiente", false]]);
eq("pendientes posteriores al cierre: registrables", [est("2026-10-12", 480000), est("2026-10-13", 143999)], [["pendiente", true], ["pendiente", true]]);
eq("cierre por defecto 07/10/2026", CIERRE_CONCILIACION, "2026-10-07");
eq("se muestran TODOS los movimientos", r.movimientos.length, banco.length);
eq("control inverso: registro BFK posterior al cierre sin línea bancaria", r.sinLinea.map((x) => x.id), ["g3"]);
const opc = opcionesAbono(r.movimientos.find((x) => x.m.fecha === "2026-10-13").m, datos.ocs);
eq("opciones de un abono: sin facturas posteriores al abono y sin selección", [opc.map((o) => o.asignaciones.map((a) => a.ocId)).flat(), opc.some((o) => o.sugerida)], [["o3"], false]);
eq("las funciones no modifican los datos", huella(datos), crudo);
// Registro posterior (simulado en memoria): el pago de 480.000 deja de ser registrable y no se propone dos veces
const conPago = { ...datos, pagosVendedor: [{ id: "pv1", vendedor_id: "v_luis", anio: 2026, mes: 8, fecha: "2026-10-12", monto_pagado: 461250, monto_extra_gestion: 18750, monto_transferido: 480000 }] };
const r2 = conciliarMovimientos(unirCartolas([cart, cart]).movs, conPago);
eq("tras registrar: el movimiento queda conciliado y no se vuelve a proponer (reimportación)", (() => { const x = r2.movimientos.find((y) => y.m.fecha === "2026-10-12"); return [x.estado, x.registrable, x.registros.map((g) => g.id)]; })(), ["conciliado", false, ["pv1"]]);
eq("reimportar dos veces la misma cartola no duplica propuestas", r2.movimientos.filter((x) => x.registrable).length, 1);
eq("universo bancario: excluye cobros fuera del banco", registrosBancarios(datos).some((x) => x.id === "c8"), false);

// ════════════════ 4. Informes (Etapa 3) ════════════════
const conExtra = { ...datos, pagosVendedor: conPago.pagosVendedor };
const ap = apoyoEnGestion(conExtra);
eq("apoyo en gestión: gasto + extra del pago, cada uno una vez", [ap.items.map((x) => [x.origen, x.monto]), ap.total], [[["pago_vendedor", 18750], ["gasto", 18750]], 37500]);
const cy = comisionesYApoyo({ ...conExtra });
eq("comisión y apoyo por período: el total transferido es uno solo", cy.filas.map((f) => [f.anio, f.mes, f.comision, f.apoyoEnPago, f.transferido]), [[2026, 8, 461250, 18750, 480000]]);
const cajaI = cajaYFueraDelBanco(conExtra);
eq("caja del informe = universo único de movimientosCaja", cajaI.caja, movimientosCaja({ ...conExtra, ocs: conExtra.ocs.filter((o) => !o.archivada) }).reduce((s, m) => s + m.monto, 0));
eq("retiro de capital: aparece como capital y no dentro de gastos", [cajaI.porTipo.retiro?.monto, cajaI.porTipo.gasto?.monto], [-300000, -468750]);
eq("cobros fuera del banco: informados aparte, no suman a la caja", [cajaI.fuera.cobrosFueraBanco.n, cajaI.fuera.cobrosFueraBanco.total], [1, 380003]);
eq("clase de gasto: impuesto y retención no son operacionales", [claseGasto({ categoria_id: "cat_impuesto" }), claseGasto({ categoria_id: "cat_x", subcategoria: "Retención (sin movimiento bancario)" }), claseGasto({ categoria_id: "cat_apoyo_gestion" }), claseGasto({ categoria_id: "cat_gratificacion" })],
  ["impuestos", "retenciones", "apoyo", "operacional"]);
const rm = resultadoMes(conExtra, 2026, 9);
eq("resultado del mes = margen − comisiones − apoyo − gastos operacionales", rm.resultado, rm.margenComercial - rm.comisiones - rm.apoyoGestion - rm.gastosOperacionales);
eq("resultado del mes: aguinaldos son gasto operacional; el F29 no", [rm.gastosOperacionales, resultadoMes(conExtra, 2026, 8).impuestosInformativos], [400000, 50000]);
const fins = resumenFinanciadores({ ...conExtra, ajustes: [] });
eq("financiadores: compras − devoluciones = saldo, sin Cuenta BFK", fins.map((f) => [f.id, f.compras, f.devoluciones, f.calculado, f.saldo]), [["f_ana", 1360000, 800000, 560000, 560000]]);

// ════════════════ 5. F29 con IVA + PPM y comisiones provisorias ════════════════
const ivaM = [
  { anio: 2026, mes: 7, iva_ventas: 50000, iva_compras: 0, iva_pagado: 70000 },
  { anio: 2026, mes: 8, iva_ventas: 1234000, iva_compras: 789000, iva_pagado: 482300 },
  { anio: 2026, mes: 9, iva_ventas: 100000, iva_compras: 40000 },
];
const gF29 = [{ categoria_id: "cat_impuesto", anio: 2026, mes: 8, monto: 482300 }, { categoria_id: "cat_impuesto", anio: 2026, mes: 7, monto: 50000 }];
eq("F29 agosto 2026: IVA 445.000 + PPM 37.300 = 482.300, pagado, pendiente 0", desgloseF29(ivaM, gF29, 2026, 8), { anio: 2026, mes: 8, iva: 445000, ppm: 37300, det: 482300, pag: 482300, pend: 0, faltaTotalF29: false });
eq("F29 julio 2026: antes de la regla, sin PPM (sin cambio retroactivo)", periodoF29(ivaM, gF29, 2026, 7), { anio: 2026, mes: 7, det: 50000, pag: 50000, pend: 0 });
eq("F29 septiembre 2026 sin total registrado: IVA pendiente y aviso de PPM faltante", [desgloseF29(ivaM, gF29, 2026, 9).pend, calcularF29({ ivaMensual: ivaM, gastos: gF29, anioActual: 2026, mesActual: 10 }).faltaTotal], [60000, [{ anio: 2026, mes: 9 }]]);
eq("F29 con PPM registrado y no pagado: el pendiente incluye el PPM", desgloseF29([{ anio: 2026, mes: 9, iva_ventas: 100000, iva_compras: 40000, iva_pagado: 75000 }], [], 2026, 9).pend, 75000);
const ocCom = oc("oc_com", "OC-COM", { vendedor_id: "v_luis", monto_total: 300000, costo_total: 200000, eventos_factura: [{ id: "fc", numero_factura: "50", fecha: "2026-09-10", monto: 300000 }] });
const cSep = calcularPagoVendedor({ vendedorId: "v_luis", ocs: [ocCom], anio: 2026, mes: 9, ivaMensual: ivaM, pagosVendedor: [] });
eq("comisión de septiembre con IVA pero sin total F29 → provisoria", [cSep.f29Incompleto, comisionesPorPagar({ vendedores: datos.vendedores, ocs: [ocCom], ivaMensual: ivaM, pagosVendedor: [] }).detalle.map((d) => d.provisoria)], [true, [true]]);
eq("misma comisión con el total del F29 registrado → definitiva", comisionesPorPagar({ vendedores: datos.vendedores, ocs: [ocCom], ivaMensual: [{ anio: 2026, mes: 9, iva_ventas: 100000, iva_compras: 40000, iva_pagado: 75000 }], pagosVendedor: [] }).detalle.map((d) => d.provisoria), [false]);

// ════════════════ 7. Registro desde la cartola: protección contra duplicados (concurrencia) ════════════════
const um = unirCartolas([cart]).movs;
const iPago = um.findIndex((m) => m.fecha === "2026-10-12");
eq("verificación con datos frescos: pendiente posterior al cierre → se puede registrar", verificarRegistro(um, iPago, datos).ok, true);
const idA = idRegistroCartola("vendedor", um, iPago, []), idB = idRegistroCartola("vendedor", unirCartolas([cart, cart]).movs, iPago, []);
eq("dos sesiones (o reimportación) calculan el MISMO id para el mismo movimiento", [idA, idA === idB], ["pv_cart_20261012_480000_0_" + um[iPago].saldo + "_1", true]);
eq("tablas distintas → prefijos distintos (gasto, retiro, cobro)", ["gasto", "retiro", "cobro"].map((t) => idRegistroCartola(t, um, iPago, []).split("_cart_")[0]), ["gas", "ap", "evp"]);
const vaivenes = unirCartolas([leer(cartolaHistorica([{ fecha: "2026-10-14", op: "", desc: "GIRO FICTICIO", cargo: 100 }, { fecha: "2026-10-14", op: "7000050", desc: "TEF DE FICTICIO", abono: 100 },
  { fecha: "2026-10-14", op: "", desc: "GIRO FICTICIO", cargo: 100 }], { saldoInicial: 1000 }))]).movs;
eq("dos movimientos reales con la misma clave → marcas distintas (ocurrencia)", [vaivenes.length, vaivenes[0].clave === vaivenes[2].clave, marcaMovimiento(vaivenes, 0) !== marcaMovimiento(vaivenes, 2)], [3, true, true]);
const frescoConPago = { ...datos, pagosVendedor: [{ id: idA, vendedor_id: "v_luis", anio: 2026, mes: 8, fecha: "2026-10-12", monto_pagado: 461250, monto_extra_gestion: 18750, monto_transferido: 480000 }] };
eq("otra sesión ya lo registró (datos frescos) → bloqueado antes de escribir", [verificarRegistro(um, iPago, frescoConPago).ok, /otra sesión|ya tiene/.test(verificarRegistro(um, iPago, frescoConPago).motivo)], [false, true]);
const frescoOtroTipo = { ...datos, gastos: [...datos.gastos, { id: idRegistroCartola("gasto", um, iPago, []), fecha: "2026-11-30", monto: 1, categoria_id: "cat_otros", anio: 2026, mes: 11, detalle: "registro de otra sesión" }] };
eq("otra sesión lo registró como OTRO tipo (su marca está en otra tabla) → bloqueado", verificarRegistro(um, iPago, frescoOtroTipo).ok, false);
const anulado = { ...datos, pagosVendedor: [{ ...frescoConPago.pagosVendedor[0], anulado_en: "2026-10-12T15:00:00Z" }] };
const vAn = verificarRegistro(um, iPago, anulado);
eq("pago anulado: se puede volver a registrar con un id nuevo, igual para dos sesiones", [vAn.ok, idRegistroCartola("vendedor", um, iPago, vAn.existentes)], [true, idA + "_r2"]);
eq("sin datos frescos (lectura fallida) → no se registra", verificarRegistro(um, iPago, null).ok, false);
eq("anterior al cierre → no se registra", verificarRegistro(um, um.findIndex((m) => m.fecha === "2026-09-26"), datos).ok, false);
eq("rechazo por clave primaria reconocido", [esConflictoDuplicado(new Error('duplicate key value violates unique constraint "pagos_vendedor_pkey"')), esConflictoDuplicado(new Error("Error de red"))], [true, false]);
eq("la verificación no modifica los datos", huella(datos), crudo);

// ════════════════ 6. Invariantes: consultar o importar no cambia nada ════════════════
const foto = (d) => {
  const rc = resumenCaja({ ...d, ivaMensual: ivaM, saldoBanco: { saldo: 1000000, fecha_corte: "2026-10-07" }, hoy: new Date("2026-10-14T12:00:00-03:00") });
  return { ventas: d.ocs.reduce((s, o) => s + o.monto_total, 0), costos: d.ocs.reduce((s, o) => s + o.costo_total, 0), cobros: huella(d.ocs.map((o) => o.eventos_pago_cliente)),
    caja: rc.caja, deuda: rc.deudaFinanciadores, comisiones: rc.comisiones.total, f29: rc.f29Pendiente, proyectado: rc.saldoProyectado, gastos: huella(d.gastos),
    fifo: huella(repartirFIFO(200000, ocsPendientesFinanciador(d.ocs, "f_ana", [])).reparto.map((x) => [x.oc.id, x.asignado])) };
};
const antes = foto(conExtra);
for (let k = 0; k < 3; k++) conciliarMovimientos(unirCartolas([cart, mismoEnLinea, cart]).movs, conExtra);
cajaYFueraDelBanco(conExtra); resultadoMes(conExtra, 2026, 9); resumenFinanciadores({ ...conExtra, ajustes: [] });
eq("ventas, costos, cobros, caja, deudas, comisiones, F29, gastos y FIFO idénticos tras importar 3 veces", foto(conExtra), antes);

console.log(`\nRESUMEN pruebas conciliación bancaria (Etapas 1-3): ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
