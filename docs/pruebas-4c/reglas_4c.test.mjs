// Pruebas unitarias de la Fase 4C (Mercado Público y operación diaria). Ejecutar: node docs/pruebas-4c/ejecutar.mjs
import { cambiosOCDesdeMP, elegirRevisionAutomatica, fotoMP, lineaVentaDesdeMP, planProductosVenta, recepcionMP, toca } from "../../src/lib/mercadoPublico.js";
import { cobradoEnBanco, estadoOperativo, filtrarPanel, ingresoPendienteOC, ocCanceladaEnMP } from "../../src/lib/ocs.js";
import { calcularPagoVendedor, facturaVigente, mesesConFactura, periodoComision } from "../../src/lib/calculos.js";
import { abonoYaRegistrado, calzarAbonos, combinacionExacta, repartirAbono, rutsEnTexto, validarSeleccion } from "../../src/lib/cobranza.js";
import { coincideBusqueda, cumpleCriterios, listaProveedores } from "../../src/lib/busqueda.js";
import { contenidoFicha, filasVista, libroVista } from "../../src/lib/exportacionVista.js";
import { calcularAlertas } from "../../src/components/ui/Multiusuario.jsx";
import handler from "../../api/oc.mjs";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const dias = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// ── 1. Foto de Mercado Público: neto/IVA, aceptación, recepción e ítems estructurados ──
const dMP = { numero_oc: "3013-587-AG26", codigo_estado: 12, estado_mp: "Recepción Conforme", monto_neto: 100000, impuestos: 19000, monto_total: 119000,
  descuentos: 0, cargos: 0, fecha_envio: "2026-09-01T10:00:00", fecha_aceptacion: "2026-09-02T09:00:00", dias_pago: 30,
  cliente: "Muni Nueva", entidad: "Depto", rut_cliente: "69.150.600-2", contacto: "Ana", correo_cliente: "a@b.cl", tipo_despacho: "A convenir",
  productos: [{ descripcion: "Silla", especificacion_proveedor: "Silla ergonómica X", codigo_producto: "56101504", categoria: "Muebles", cantidad: 2, unidad: "Unidad", precio_venta_unitario: 50000, total_linea: 100000 }] };
const foto = fotoMP(dMP, "2026-10-06T12:00:00Z");
eq("foto: neto, IVA y total", [foto.neto, foto.iva, foto.total], [100000, 19000, 119000]);
eq("foto: aceptación y recepción", [foto.aceptada, foto.fecha_aceptacion, foto.recepcion], [true, "2026-09-02T09:00:00", "conforme"]);
eq("foto: ítem estructurado (cantidad, unidad, unitario, total, especificación)", [foto.items[0].cantidad, foto.items[0].unidad, foto.items[0].precio_unitario, foto.items[0].total, foto.items[0].especificacion_proveedor], [2, "Unidad", 50000, 100000, "Silla ergonómica X"]);
eq("recepción: códigos 12/13/14/15", [12, 13, 14, 15, 6].map((c) => recepcionMP(c)?.clave || null), ["conforme", "pendiente", "parcial", "conforme_incompleta", null]);

// ── 2. Sincronización sin pisar datos manuales válidos ──
const ocManual = { cliente: "Cliente corregido a mano", entidad: "", rut_cliente: "69.150.600-2", contacto: "Pedro (manual)", correo_cliente: "", comuna: "Laja",
  fecha_emision_mp: "2026-08-30", fecha_hora_emision_mp: null, dias_pago: 50, monto_total: 125000, tipo_despacho: "" };
const ch = cambiosOCDesdeMP(ocManual, dMP);
eq("sync: no pisa cliente, contacto, comuna, plazo ni monto ingresados", ["cliente", "contacto", "comuna", "dias_pago", "monto_total"].map((k) => k in ch), [false, false, false, false, false]);
eq("sync: completa solo lo vacío (entidad, correo, despacho)", [ch.entidad, ch.correo_cliente, ch.tipo_despacho], ["Depto", "a@b.cl", "A convenir"]);
eq("sync: la fecha de emisión siempre viene de Mercado Público", [ch.fecha_emision_mp, ch.fecha_hora_emision_mp], ["2026-09-01", "2026-09-01T10:00:00"]);
eq("sync: monto en cero se completa con el total de MP", cambiosOCDesdeMP({ monto_total: 0 }, dMP).monto_total, 119000);
eq("sync: 'Por completar' cuenta como vacío", cambiosOCDesdeMP({ cliente: "POR COMPLETAR" }, dMP).cliente, "Muni Nueva");

// Productos: completa vacíos, no toca lo editado ni lo comprado, no duplica.
const links = [
  { id: "l1", origen: "venta", orden: 0, descripcion: "Silla (editada a mano)", cantidad: 3, precio_venta: null, categoria: null },
  { id: "c1", origen: "compra", orden: 0, descripcion: "Silla comprada en tienda", precio_compra: 40000 },
];
const plan = planProductosVenta(links, [...dMP.productos, { descripcion: "Mesa", cantidad: 1, total_linea: 30000, categoria: "Muebles" }]);
eq("productos: descripción y cantidad editadas a mano no se pisan", plan.actualizar, [{ id: "l1", patch: { precio_venta: 100000, categoria: "Muebles" } }]);
eq("productos: se agrega la línea que falta (estructurada, origen venta)", plan.insertar, [{ descripcion: "Mesa", cantidad: 1, precio_venta: 30000, categoria: "Muebles", origen: "venta", orden: 1 }]);
eq("productos: una segunda pasada no duplica", planProductosVenta([...links, { id: "l2", origen: "venta", orden: 1, descripcion: "Mesa", cantidad: 1, precio_venta: 30000, categoria: "Muebles" }],
  [...dMP.productos, { descripcion: "Mesa", cantidad: 1, total_linea: 30000, categoria: "Muebles" }]), { actualizar: [{ id: "l1", patch: { precio_venta: 100000, categoria: "Muebles" } }], insertar: [] });
eq("productos: línea nueva estructurada desde MP", lineaVentaDesdeMP(dMP.productos[0], 0), { descripcion: "Silla", cantidad: 2, precio_venta: 100000, categoria: "Muebles", origen: "venta", orden: 0 });

// ── 3. Revisión automática prudente ──
const ahora = new Date("2026-10-06T15:00:00Z");
const base = (id, extra = {}) => ({ id, numero_oc: `${id}-1-AG26`.replace(/^o/, "100"), tipo_registro: "venta", ...extra });
const ocsRev = [
  base("o1"),                                                               // nunca revisada: entra
  base("o2"),                                                               // revisada hace 1 día: no
  base("o3"),                                                               // revisada hace 5 días: entra
  base("o4", { estado_pago_cliente: "pagado", estado_pago_financiamiento: "pagado" }),   // cerrada: no
  base("o5"),                                                               // cancelada en MP: no
  base("o6", { no_en_mp: true }),                                           // no existe en MP: no
  { id: "o7", numero_oc: "VD-001", tipo_registro: "venta" },                // no es de MP: no
  base("o8"),                                                               // recepción conforme: no
];
const fotosRev = { o2: { revisado_en: "2026-10-05T15:00:00Z", codigo_estado: 6 }, o3: { revisado_en: "2026-10-01T15:00:00Z", codigo_estado: 6 }, o5: { revisado_en: "2026-09-01T00:00:00Z", codigo_estado: 9 }, o8: { revisado_en: "2026-09-01T00:00:00Z", codigo_estado: 12 } };
eq("revisión: solo abiertas de MP, no revisadas en 3 días; primero las nunca revisadas", elegirRevisionAutomatica(ocsRev, fotosRev, ahora).map((o) => o.id), ["o1", "o3"]);
eq("revisión: tope por vez", elegirRevisionAutomatica(Array.from({ length: 30 }, (_, i) => base(`o${100 + i}`)), {}, ahora).length, 12);
eq("revisión: como mucho cada 6 horas", [toca(null, ahora), toca("2026-10-06T10:00:00Z", ahora), toca("2026-10-06T08:00:00Z", ahora)], [true, false, true]);

// ── 4. Estado único (lista, Panel, Alertas y Agenda) ──
const f = (n, monto = 1000, extra = {}) => ({ id: `f${n}`, fecha: dias(n), numero_factura: String(n), monto, ...extra });
eq("estado: cancelada en MP y no cobrada", estadoOperativo({ mp: { codigo_estado: 9 }, eventos_compra: [{}] }).clave, "mp_cancelada");
eq("estado: cancelada en MP pero ya cobrada sigue su ciclo", estadoOperativo({ mp: { codigo_estado: 9 }, estado_pago_cliente: "pagado", estado_factura_propia: "emitida", estado_entrega: "confirmada", estado_pago_financiamiento: "no_aplica" }).clave, "cerrada");
eq("estado: cerrada con financiamiento 'no aplica'", estadoOperativo({ eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", estado_pago_financiamiento: "no_aplica" }).texto, "Cerrada");
eq("estado: abono parcial visible", estadoOperativo({ eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "parcial", eventos_factura: [f(3)] }).texto.startsWith("Abono parcial"), true);
eq("estado: vale vista sin cobrar en banco", estadoOperativo({ eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", estado_pago_financiamiento: "pagado", eventos_pago_cliente: [{ medio_pago: "vale_vista", cobrado_en_banco: false, monto: 5 }] }).clave, "vale_vista");
eq("estado: sin aceptar en MP (sin compra)", estadoOperativo({ mp: { codigo_estado: 4 } }).clave, "mp_sin_aceptar");
const ocCancel = { id: "x1", numero_oc: "1-1-AG26", tipo_registro: "venta", mp: { codigo_estado: 9 }, vendedor_id: "v1" };
eq("Panel y Alertas: mismo criterio para canceladas en MP", [filtrarPanel([ocCancel], "mp_cancelada").length, calcularAlertas([ocCancel]).filter((a) => a.filtro === "mp_cancelada").length, ocCanceladaEnMP(ocCancel)], [1, 1, true]);

// ── 5. Saldo proyectado: cobros parciales y vale vista ──
const ocP = { tipo_registro: "venta", monto_total: 119000, monto_facturado: 119000, monto_cobrado: 50000, estado_pago_cliente: "parcial",
  eventos_pago_cliente: [{ monto: 30000, medio_pago: "transferencia", cobrado_en_banco: true }, { monto: 20000, medio_pago: "vale_vista", cobrado_en_banco: false }] };
eq("caja: el vale vista sin cobrar en el banco no es caja", cobradoEnBanco(ocP), 30000);
eq("por cobrar: factura − cobros en banco (el vale vista se cuenta una vez, aquí)", ingresoPendienteOC(ocP), 89000);
eq("por cobrar: OC pagada con vale vista sin depositar sigue por llegar", ingresoPendienteOC({ ...ocP, monto_cobrado: 119000, estado_pago_cliente: "pagado", eventos_pago_cliente: [{ monto: 119000, medio_pago: "vale_vista", cobrado_en_banco: false }] }), 119000);
eq("por cobrar: pagada por transferencia = 0", ingresoPendienteOC({ ...ocP, monto_cobrado: 119000, estado_pago_cliente: "pagado", eventos_pago_cliente: [{ monto: 119000, medio_pago: "transferencia", cobrado_en_banco: true }] }), 0);
eq("por cobrar: sin facturar se toma el monto de la OC", ingresoPendienteOC({ tipo_registro: "venta", monto_total: 50000, monto_facturado: 0, eventos_pago_cliente: [] }), 50000);
eq("por cobrar: cobro mayor que la factura no resta", ingresoPendienteOC({ tipo_registro: "venta", monto_total: 100, monto_facturado: 100, eventos_pago_cliente: [{ monto: 150 }] }), 0);
eq("por cobrar: aporte o venta externa no cuenta", ingresoPendienteOC({ tipo_registro: "externa", monto_total: 999 }), 0);

// ── 6. Comisión: solo la factura vigente define el mes, y se listan las OCs del cálculo ──
const ocsCom = [
  // factura de julio anulada por la de agosto: cuenta SOLO en agosto
  { id: "c1", numero_oc: "A-1", vendedor_id: "m", estado_factura_propia: "emitida", monto_total: 100000, costo_total: 60000,
    eventos_factura: [{ id: "a", numero_factura: "10", fecha: "2026-07-20", monto: 100000 }, { id: "b", numero_factura: "20", fecha: "2026-08-03", monto: 100000, factura_anulada_numero: "10" }] },
  // dos registros de la misma factura sin anulación: entra una sola vez, en el mes de la más reciente
  { id: "c2", numero_oc: "A-2", vendedor_id: "m", estado_factura_propia: "emitida", monto_total: 50000, costo_total: 30000,
    eventos_factura: [{ id: "c", numero_factura: "30", fecha: "2026-08-10", monto: 50000 }] },
  { id: "c3", numero_oc: "A-3", vendedor_id: "m", estado_factura_propia: "emitida", monto_total: 40000, costo_total: 20000, es_venta_propia: true,
    eventos_factura: [{ id: "d", numero_factura: "40", fecha: "2026-08-15", monto: 40000 }] },
];
eq("comisión: el mes es el de la factura vigente", periodoComision(ocsCom[0]), { anio: 2026, mes: 8 });
eq("comisión: julio ya no aparece (su factura está anulada)", mesesConFactura("m", ocsCom), [{ anio: 2026, mes: 8 }]);
const ago = calcularPagoVendedor({ vendedorId: "m", ocs: ocsCom, anio: 2026, mes: 8 });
eq("comisión: detalle con las OCs del cálculo", ago.detalle.map((l) => [l.numero_oc, l.factura, l.utilidad, l.ventaPropia]), [["A-1", "20", 40000, false], ["A-2", "30", 20000, false], ["A-3", "40", 20000, true]]);
eq("comisión: desglose (utilidad sin ventas propias / ventas propias)", [ago.sumaUtilidad, ago.pagoVentasPropias], [60000, Math.round(20000 - (40000 - 40000 / 1.19))]);
eq("comisión: julio no tiene cálculo", calcularPagoVendedor({ vendedorId: "m", ocs: ocsCom, anio: 2026, mes: 7 }), null);
eq("factura vigente: si todas están anuladas no hay vigente", facturaVigente({ eventos_factura: [{ id: "x", numero_factura: "1", factura_anulada_numero: "2" }, { id: "y", numero_factura: "2", factura_anulada_numero: "1" }] }), null);

// ── 7. Cobranza y cartola ──
const rut = "69.150.600-2";
const ocC = (id, num, saldo, fFact, extra = {}) => ({ id, numero_oc: num, cliente: "Municipalidad de Pruebas", rut_cliente: rut, tipo_registro: "venta",
  estado_factura_propia: "emitida", estado_pago_cliente: "pendiente", monto_facturado: saldo, monto_cobrado: 0, eventos_factura: [{ id: `f${id}`, numero_factura: id, fecha: fFact, monto: saldo }], ...extra });
const ocsCob = [ocC("1", "OC-1", 100000, "2026-08-01"), ocC("2", "OC-2", 50000, "2026-08-05"), ocC("3", "OC-3", 70000, "2026-08-10"),
  { ...ocC("9", "OC-9", 30000, "2026-08-01"), rut_cliente: "76.111.111-1", cliente: "Otro" }];
const mov = (abono, descripcion = `TRANSF DE ${rut.replace(/\./g, "")} MUNICIPALIDAD`) => ({ fecha: "2026-09-01", abono, descripcion });
let it = calzarAbonos([mov(100000)], ocsCob)[0];
eq("cartola: factura exacta marcada", [it.opciones[0].tipo, it.sugerida, it.opciones[0].asignaciones[0].ocId], ["exacto", "ex_1", "1"]);
it = calzarAbonos([mov(150000)], ocsCob)[0];
eq("cartola: un abono para varias facturas del mismo RUT", [it.sugerida, it.opciones.find((o) => o.tipo === "varias").asignaciones.map((a) => [a.ocId, a.monto])], ["va_691506002", [["1", 100000], ["2", 50000]]]);
it = calzarAbonos([mov(60000)], ocsCob)[0];
const par = it.opciones.find((o) => o.tipo === "parcial");
eq("cartola: abono parcial a la factura más antigua, no se marca solo", [it.sugerida, par.asignaciones.map((a) => [a.ocId, a.monto, a.parcial])], ["", [["1", 60000, true]]]);
it = calzarAbonos([mov(30000, "DEPOSITO SIN RUT")], ocsCob)[0];
eq("cartola: sin RUT solo se propone la factura exacta (otro cliente)", [it.sugerida, it.opciones.length], ["ex_9", 1]);
const ocVV = { ...ocC("5", "OC-5", 0, "2026-08-01"), monto_facturado: 80000, monto_cobrado: 80000, estado_pago_cliente: "pagado",
  eventos_pago_cliente: [{ id: "vv1", monto: 80000, medio_pago: "vale_vista", cobrado_en_banco: false }] };
it = calzarAbonos([mov(80000)], [...ocsCob, ocVV])[0];
eq("cartola: depósito de un vale vista ya registrado se marca cobrado (no cobro nuevo)", [it.sugerida, it.opciones[0].valeVista.eventoId, it.opciones[0].asignaciones.length], ["vv_vv1", "vv1", 0]);
eq("cartola: el depósito del vale vista se propone aunque su cobro ya esté registrado (mismo monto y fecha)", calzarAbonos([mov(80000)], [...ocsCob, ocVV], [{ fecha: "2026-08-31", monto: 80000, destino: "cli_5" }])[0]?.sugerida, "vv_vv1");
eq("cartola: dos facturas iguales sin RUT → no se elige sola", calzarAbonos([mov(50000, "DEPOSITO")], [ocC("a", "OC-a", 50000, "2026-08-01"), { ...ocC("b", "OC-b", 50000, "2026-08-01"), rut_cliente: "76.111.111-1", cliente: "Otro" }])[0].sugerida, "");
eq("cartola: abono ya registrado en fragmentos del mismo día no se repite", abonoYaRegistrado(mov(150000), [{ fecha: "2026-09-01", monto: 100000, destino: "cli_1" }, { fecha: "2026-09-01", monto: 50000, destino: "cli_2" }]), true);
eq("cartola: combinación ambigua no se elige", combinacionExacta([{ saldo: 10 }, { saldo: 20 }, { saldo: 10 }, { saldo: 20 }], 30), null);
eq("cartola: reparto parcial sin pasarse del saldo", repartirAbono(120, [{ oc: { id: "a", numero_oc: "a" }, saldo: 100, fechaFactura: "2026-01-01" }, { oc: { id: "b", numero_oc: "b" }, saldo: 100, fechaFactura: "2026-02-01" }]).asignaciones.map((a) => a.monto), [100, 20]);
eq("cartola: RUT con y sin puntos", rutsEnTexto("PAGO 69.150.600-2 Y 691506002"), ["691506002"]);
const items2 = calzarAbonos([mov(60000), mov(60000, `OTRO ABONO ${rut}`)], ocsCob);
eq("cartola: dos abonos parciales que superan el saldo se rechazan", validarSeleccion(items2, { 0: items2[0].opciones.find((o) => o.tipo === "parcial").id, 1: items2[1].opciones.find((o) => o.tipo === "parcial").id }) !== null, true);

// ── 8. Búsqueda y filtros ──
const ocB = { id: "b1", numero_oc: "77-1-AG26", cliente: "Hospital", vendedor_id: "v1", financiador_id: "fin_byron", vendedores: { nombre: "Matías Vegas" }, financiadores: { nombre: "Byron Vegas" },
  oc_productos_link: [{ descripcion: "Notebook Lenovo", origen: "venta" }, { descripcion: "Notebook", proveedor: "PC Factory", origen: "compra" }],
  eventos_compra: [{ proveedor: "pc factory" }], eventos_pago_cliente: [{ medio_pago: "vale_vista", cobrado_en_banco: false, institucion: "Banco de Chile" }] };
eq("búsqueda: producto, proveedor, vendedor, financiador e institución", ["lenovo", "factory", "matias", "byron", "banco de chile", "inexistente"].map((q) => coincideBusqueda(ocB, q)), [true, true, true, true, true, false]);
eq("filtros: vendedor/financiador/proveedor/producto/vale vista", [
  cumpleCriterios(ocB, { vendedor: "v1" }), cumpleCriterios(ocB, { vendedor: "__sin__" }), cumpleCriterios(ocB, { financiador: "fin_kevin" }),
  cumpleCriterios(ocB, { proveedor: "PC FACTORY" }), cumpleCriterios(ocB, { producto: "lenovo" }), cumpleCriterios(ocB, { valeVista: "pendiente" }),
  cumpleCriterios({ ...ocB, eventos_pago_cliente: [] }, { valeVista: "cualquiera" })], [true, false, false, true, true, true, false]);
eq("filtros: proveedores sin repetir (mayúsculas)", listaProveedores([ocB]).length, 1);

// ── 9. Excel de la vista y ficha PDF ──
const ocX = { ...ocsCom[0], cliente: "Muni", vendedores: { nombre: "Matías" }, mp: { neto: 84034, iva: 15966, codigo_estado: 6, estado: "Aceptada", aceptada: true } };
const fila = filasVista([ocX])[0];
eq("Excel: montos como números y factura vigente", [fila["Venta (monto OC)"], fila["Ganancia"], fila["Factura vigente"], fila["Neto MP"], fila["IVA MP"], fila["Vendedor"]], [100000, 40000, "20", 84034, 15966, "Matías"]);
eq("Excel: una fila por OC filtrada", libroVista([ocX, ocsCom[1]]).filas.length, 2);
const ficha = contenidoFicha(ocX);
eq("ficha: secciones", ficha.map((s) => s.titulo), ["Orden de compra", "Montos", "Mercado Público", "Productos", "Etapas"]);
eq("ficha: factura anulada y vigente marcadas", ficha.find((s) => s.titulo === "Etapas").tabla.filas.filter((r) => r[0] === "Factura").map((r) => r[2]), ["Factura 10 · Anulada", "Factura 20 · Vigente"]);   // Fase SII: cada documento con su estado tributario

// ── 10. /api/oc devuelve unidad, cancelación y última modificación ──
process.env.MP_TICKET = "ticket-de-prueba";
const fetchOriginal = globalThis.fetch;
const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader() {} };
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: "u" }) };
  if (u.includes("/rest/v1/perfiles")) return { ok: true, status: 200, json: async () => [{ id: "u" }] };
  return { ok: true, status: 200, json: async () => ({ Listado: [{ Codigo: "1-1-AG26", CodigoEstado: 9, Estado: "Cancelada", TotalNeto: 100, Impuestos: 19, Total: 119,
    Fechas: { FechaEnvio: "2026-09-01T10:00:00", FechaCancelacion: "2026-09-05T11:00:00", FechaUltimaModificacion: "2026-09-05T11:00:00" },
    Items: { Listado: [{ Cantidad: 2, Unidad: "Unidad", PrecioNeto: 50, Total: 100, EspecificacionComprador: "Silla", Producto: "Silla de oficina" }] } }] }) };
};
await handler({ headers: { authorization: "Bearer t" }, query: { codigo: "1-1-AG26" } }, res);
globalThis.fetch = fetchOriginal;
eq("api: unidad, producto, fecha de cancelación, neto e IVA", [res.body.oc.productos[0].unidad, res.body.oc.productos[0].producto, res.body.oc.fecha_cancelacion, res.body.oc.monto_neto, res.body.oc.impuestos], ["Unidad", "Silla de oficina", "2026-09-05T11:00:00", 100, 19]);
eq("api → foto: cancelada", fotoMP(res.body.oc).codigo_estado, 9);

console.log(`\nRESUMEN pruebas Fase 4C (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
