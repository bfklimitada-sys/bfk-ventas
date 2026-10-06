// Datos ficticios para las pruebas de interfaz de OCs (Fase 4A). Tablas planas, como en la base.
export const dias = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const ahora = () => new Date().toISOString();

export function crearDatos() {
  const oc = (i, numero, o = {}) => ({
    id: "oc" + i, numero_oc: numero, cliente: "MUNICIPALIDAD FICTICIA " + i, entidad: "DEPTO " + i, rut_cliente: `69.${100 + i}.000-${i % 10}`, comuna: "LAJA",
    vendedor_id: "v1", es_venta_propia: false, financiador_id: "f1", tipo_registro: "venta",
    estado_compra: "comprado", estado_entrega: "pendiente", estado_factura_propia: "pendiente", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente",
    monto_total: 1190000 + i * 10000, costo_total: 800000 + i * 5000, monto_facturado: 0, monto_cobrado: 0, monto_pagado_fin: 0, dias_pago: 30,
    fecha_emision_mp: dias(40 - i), fecha_hora_emision_mp: dias(40 - i) + "T10:30:00", estado_postventa: "sin_incidencias",
    creadoEn: new Date(Date.now() - (40 - i) * 864e5).toISOString(), creado_por: "u1", archivada: false, no_en_mp: false, sync_pendiente: false, ...o,
  });
  const ordenes_compra_v2 = [
    oc(1, "2001-101-SE26"),                                                      // compra (fecha real ≠ emisión), entrega atrasada, productos comprados
    oc(2, "2002-102-SE26", { vendedor_id: "v2", estado_entrega: "confirmada", estado_factura_propia: "emitida", monto_facturado: 1210000 }), // factura vencida
    oc(3, "2003-103-SE26", { estado_entrega: "entregado" }),                     // entregada (registro anterior) sin factura
    oc(4, "2004-104-SE26", { estado_entrega: "confirmada", estado_factura_propia: "emitida", monto_facturado: 1230000 }), // por vencer, 2 entregas
    oc(5, "2005-105-SE26", { vendedor_id: null, estado_compra: "pendiente", costo_total: 0, financiador_id: null }),     // MP sin comprar y sin vendedor
    oc(6, "VD-006", { fecha_emision_mp: null, fecha_hora_emision_mp: null }),   // venta directa (fecha de la OC editable)
    oc(7, "2007-107-SE26", { estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "parcial", monto_facturado: 1260000, monto_cobrado: 500000, monto_pagado_fin: 200000 }),
    oc(8, "2008-108-SE26", { vendedor_id: null, estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", estado_pago_financiamiento: "pagado", monto_facturado: 1270000, monto_cobrado: 1270000, monto_pagado_fin: 840000 }), // cerrada sin vendedor
    oc(9, "2009-109-SE26", { rut_cliente: "", fecha_hora_emision_mp: null }),  // le faltan datos: se completa sola al abrir (sin tocar la compra)
    oc(10, "2010-110-SE26", { archivada: true, archivada_en: ahora(), archivada_por: "u1", archivo_motivo: "Duplicada" }),
    oc(11, "2011-111-SE26", { vendedor_id: "v2", estado_entrega: "confirmada", estado_postventa: "con_incidencia" }),
  ];
  const evc = (i, fecha, o = {}) => ({ id: "ec" + i, oc_id: "oc" + i, fecha, monto_venta: 1190000 + i * 10000, costo_compra: 800000 + i * 5000, fecha_entrega_estimada: null, financiador_id: "f1", proveedor: "Proveedor " + i, ...o });
  return {
    ordenes_compra_v2,
    eventos_compra: [
      evc(1, dias(30), { fecha_entrega_estimada: dias(20) }), evc(2, dias(50)), evc(3, dias(35), { fecha_entrega_estimada: dias(10) }), evc(4, dias(40)),
      evc(6, dias(15)), evc(7, dias(25)), evc(8, dias(60)), evc(9, dias(12)), evc(10, dias(20)), evc(11, dias(18)),
    ],
    eventos_entrega: [
      { id: "en2", oc_id: "oc2", fecha: dias(46) }, { id: "en4a", oc_id: "oc4", fecha: dias(30) }, { id: "en4b", oc_id: "oc4", fecha: dias(29) },
      { id: "en7", oc_id: "oc7", fecha: dias(8) }, { id: "en8", oc_id: "oc8", fecha: dias(55) }, { id: "en11", oc_id: "oc11", fecha: dias(10) },
    ],
    eventos_factura: [
      { id: "fa2", oc_id: "oc2", fecha: dias(45), numero_factura: "702", monto: 1210000 }, { id: "fa4", oc_id: "oc4", fecha: dias(27), numero_factura: "704", monto: 1230000 },
      { id: "fa7", oc_id: "oc7", fecha: dias(5), numero_factura: "707", monto: 1260000 }, { id: "fa8", oc_id: "oc8", fecha: dias(50), numero_factura: "708", monto: 1270000 },
    ],
    eventos_pago_cliente: [
      { id: "pc7", oc_id: "oc7", fecha: dias(2), monto: 500000, medio_pago: "vale_vista", cobrado_en_banco: false, institucion: "BancoEstado" },
      { id: "pc8", oc_id: "oc8", fecha: dias(20), monto: 1270000, medio_pago: "transferencia", cobrado_en_banco: true },
    ],
    eventos_pago_financiamiento: [
      { id: "pf7", oc_id: "oc7", financiador_id: "f1", fecha: dias(3), monto: 200000 }, { id: "pf8", oc_id: "oc8", financiador_id: "f1", fecha: dias(15), monto: 840000 },
    ],
    oc_productos_link: [
      { id: "l1v", oc_id: "oc1", descripcion: "Silla ergonómica × 3 | Venta: $1.200.000", url: "sin-link", orden: 0, origen: null, cantidad: null },
      { id: "l1a", oc_id: "oc1", descripcion: "Silla modelo A", url: "https://tienda.cl/a", orden: 1, origen: "compra", cantidad: 2, precio_compra: 100000, precio_venta: 300000, direccion_entrega: "Bodega Norte" },
      { id: "l1b", oc_id: "oc1", descripcion: "Silla modelo B", url: "https://tienda.cl/b", orden: 2, origen: "compra", cantidad: 1, precio_compra: 50000, precio_venta: 100000, direccion_entrega: null },
      { id: "l9c", oc_id: "oc9", descripcion: "Compra en ferretería", url: "https://ferre.cl/x", orden: 0, origen: "compra", cantidad: null, precio_compra: 90000 },
      { id: "l9v", oc_id: "oc9", descripcion: "Producto por completar", url: "sin-link", orden: 1, origen: null, cantidad: null },
    ],
    oc_comentarios: [{ id: "cm1", oc_id: "oc1", usuario_id: "u1", usuario_nombre: "Admin Prueba", texto: "Nota de prueba", creadoEn: ahora() }],
    oc_reclamos: [], oc_responsables: [],
    eventos_postventa: [{ id: "pv11", oc_id: "oc11", tipo: "falla", descripcion: "Falla de prueba", estado: "abierto", fecha: dias(3), costo_extra: 0, creadoEn: ahora() }],
    perfiles: [{ id: "u1", nombre: "Admin Prueba", rol: "admin", email: "u1@prueba.cl" }, { id: "u2", nombre: "Usuario Prueba", rol: "usuario", email: "u2@prueba.cl", vendedor_id: "v1" }],
    vendedores: [{ id: "v1", nombre: "Vendedor Uno", comision_pct: 10 }, { id: "v2", nombre: "Vendedora Dos", comision_pct: 10 }],
    financiadores: [{ id: "f1", nombre: "Financiador Uno", saldo_deuda: 2500000 }, { id: "f2", nombre: "Cuenta BFK", saldo_deuda: 0 }],
    categorias_gasto: [{ id: "cat_impuesto", nombre: "Impuesto SII" }], gastos_indirectos: [], iva_mensual: [], pagos_vendedor: [], ajustes_saldo_financiador: [], aportes_socios: [],
    contactos_cobranza: [], entidades_catalogo: [], notificaciones: [], historial_cambios: [], cartolas_importadas: [], saldo_banco: [], banco_mensual: [], mp_uso_diario: [],
    mp_cache_avisos: [{ id: "aceptadas", datos: [{ numero_oc: "3001-1-SE26", nombre: "Aceptada uno" }, { numero_oc: "3002-2-SE26", nombre: "Cancelada dos" }, { numero_oc: "3003-3-SE26", nombre: "No disponible tres" }, { numero_oc: "2001-101-SE26", nombre: "Ya cargada" }], actualizado_en: ahora() }],
  };
}

// Respuestas simuladas de /api/oc (lo que entrega la función de Vercel, ya normalizado).
const ocNorm = (numero, codigo_estado, o = {}) => ({
  numero_oc: numero, nombre_oc: "OC " + numero, codigo_estado, estado_mp: String(codigo_estado), cliente: "HOSPITAL FICTICIO", entidad: "ABASTECIMIENTO", rut_cliente: "61.602.123-4",
  comuna: "LOS ÁNGELES", region: "BIOBÍO", direccion: "Av. Siempre Viva 123", contacto: "Ana · 9999", correo_cliente: "compras@hospital.cl", monto_total: 2380000,
  fecha_envio: dias(3) + "T09:00:00", fecha_creacion: dias(4) + "T09:00:00", tipo_despacho_codigo: "7", tipo_despacho: "Despachar a dirección de envío", forma_pago: "30 días contra recepción de factura", dias_pago: 30,
  productos: [{ orden: 0, descripcion: "Monitor 24 pulgadas", cantidad: 2, precio_venta_unitario: 1000000, total_linea: 2000000, categoria: "Computación" }], ...o,
});
export const RESPUESTAS_MP = {
  "3001-1-SE26": { status: 200, body: { ok: true, oc: ocNorm("3001-1-SE26", 6) } },
  "3002-2-SE26": { status: 200, body: { ok: true, oc: ocNorm("3002-2-SE26", 9) } },
  "3003-3-SE26": { status: 404, body: { ok: false, error: "OC no encontrada en Mercado Público" } },
  "2009-109-SE26": { status: 200, body: { ok: true, oc: ocNorm("2009-109-SE26", 6, { fecha_envio: dias(31) + "T08:00:00" }) } },
  "2001-101-SE26": { status: 200, body: { ok: true, oc: ocNorm("2001-101-SE26", 6, { fecha_envio: dias(41) + "T11:00:00" }) } },
  "4001-1-SE26": { status: 404, body: { ok: false, error: "OC no encontrada en Mercado Público" } },
  "4002-2-SE26": { status: 502, body: { ok: false, error: "Mercado Público no respondió correctamente (código 500). Intente de nuevo en unos minutos." } },
  "4003-3-SE26": { status: 200, body: { ok: true, oc: ocNorm("4003-3-SE26", 9) } },
  "4004-4-SE26": { status: 200, body: { ok: true, oc: ocNorm("4004-4-SE26", 4) } },
  "4005-5-SE26": { status: 200, body: { ok: true, oc: ocNorm("4005-5-SE26", 6) } },
};
