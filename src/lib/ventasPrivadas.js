// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Ventas privadas (línea VP) — reglas puras de presentación. La base decide (funciones vp_*):
// este archivo solo REPLICA sus fórmulas para mostrar valores mientras se edita, y arma textos,
// estados, alertas, agenda e indicadores a partir de lo que la base devolvió.
// Fórmulas (idénticas a vp_cotizacion_items / vp_recalcular_revision en SQL):
//   línea:  bruto = round(cantidad × precio) · neto = round(cantidad × precio × (100 − descuento%) / 100)
//   total:  neto = Σ neto líneas · IVA = round(neto × 19%) si es afecta (0 si exenta) · total = neto + IVA
// Pesos enteros. Nunca se suma lo cotizado con lo vendido, ni un anticipo con su aplicación a una factura.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

export const TASA_IVA = 0.19;
const num = (v) => { const n = Number(String(v ?? "").toString().replace(",", ".")); return Number.isFinite(n) ? n : 0; };
// round() de PostgreSQL sobre numeric redondea la mitad alejándose de cero; Math.round lo hace hacia +∞.
// Con montos no negativos (los únicos permitidos) ambos coinciden; se fija el criterio para valores .5 exactos.
export const redondear = (x) => (x < 0 ? -Math.round(-x) : Math.round(x + 1e-9));

// Número desde lo que escribe el usuario («12,5», «1.500» no: solo coma o punto decimal). Vacío → null.
export const aNumero = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).trim().replace(/\s/g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };
// Monto en pesos escrito por el usuario («$1.500.000», «1500000»): los puntos son separadores de miles.
export const aPesos = (v) => { if (v === "" || v == null) return null; const n = Number(String(v).replace(/[$\s.]/g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n) : NaN; };
// Línea lista para enviar a la base (números normalizados; los costos solo si corresponde).
export const lineaParaGuardar = (it, conCostos) => ({ tipo: it.tipo, producto_id: it.producto_id || null, codigo: it.codigo || null, descripcion: it.descripcion, unidad: it.unidad,
  cantidad: aNumero(it.cantidad), precio_unitario: aNumero(it.precio_unitario), descuento_pct: aNumero(it.descuento_pct) ?? 0,
  ...(conCostos ? { costo_unitario: aNumero(it.costo_unitario), costo_nota: it.costo_nota || null } : {}) });

export function calcularLinea(it) {
  const cantidad = num(it?.cantidad), precio = num(it?.precio_unitario), desc = Math.min(100, Math.max(0, num(it?.descuento_pct)));
  const bruto = redondear(cantidad * precio);
  const neto = redondear((cantidad * precio * (100 - desc)) / 100);
  const costoU = it?.costo_unitario === "" || it?.costo_unitario == null ? null : num(it.costo_unitario);
  const costo = costoU == null ? null : redondear(cantidad * costoU);
  return { bruto, descuento: bruto - neto, neto, costo, utilidad: costo == null ? null : neto - costo };
}

export function calcularTotales(items, { afecta_iva = true, tasa_iva = TASA_IVA } = {}) {
  const lineas = (items || []).map(calcularLinea);
  const bruto = lineas.reduce((s, l) => s + l.bruto, 0);
  const neto = lineas.reduce((s, l) => s + l.neto, 0);
  const iva = afecta_iva ? redondear(neto * num(tasa_iva)) : 0;
  const conCosto = lineas.filter((l) => l.costo != null);
  const costo = conCosto.reduce((s, l) => s + l.costo, 0);
  const sinCosto = lineas.length - conCosto.length;
  const utilidad = neto - costo;
  return { lineas, bruto, descuento: bruto - neto, neto, iva, total: neto + iva, costo, sinCosto, utilidad,
    margen: neto > 0 ? utilidad / neto : null };   // margen sobre la venta NETA
}

// ── Validaciones de entrada (las mismas que exige la base; aquí solo para avisar antes) ─────────────
export function validarLineas(items) {
  const errores = [];
  if (!items?.length) errores.push("Agrega al menos una línea.");
  (items || []).forEach((it, i) => {
    const n = i + 1;
    if (!String(it.descripcion || "").trim()) errores.push(`Línea ${n}: falta la descripción.`);
    const c = aNumero(it.cantidad), pr = aNumero(it.precio_unitario), d = aNumero(it.descuento_pct) ?? 0, co = aNumero(it.costo_unitario);
    if (!(c > 0)) errores.push(`Línea ${n}: la cantidad debe ser un número mayor que cero.`);
    if (pr == null || !(pr >= 0)) errores.push(`Línea ${n}: precio unitario inválido.`);
    if (!(d >= 0 && d <= 100)) errores.push(`Línea ${n}: el descuento debe estar entre 0 y 100 %.`);
    if (co != null && !(co >= 0)) errores.push(`Línea ${n}: costo inválido.`);
  });
  return errores;
}

// ── Estados ─────────────────────────────────────────────────────────────────────────────────────────
export const ESTADOS_COTIZACION = {
  borrador: { l: "Borrador", tono: "neutro" }, enviada: { l: "Enviada", tono: "info" }, aceptada: { l: "Aceptada", tono: "ok" },
  rechazada: { l: "Rechazada", tono: "danger" }, vencida: { l: "Vencida", tono: "warn" }, reemplazada: { l: "Reemplazada", tono: "neutro" },
};
export const ESTADOS_ENTREGA = { pendiente: { l: "Por entregar", tono: "warn" }, parcial: { l: "Entrega parcial", tono: "info" }, entregada: { l: "Entregada", tono: "ok" } };
export const ESTADOS_FACTURACION = { sin_facturar: { l: "Sin facturar", tono: "warn" }, parcial: { l: "Facturada parcial", tono: "info" }, facturada: { l: "Facturada", tono: "ok" } };
export const ESTADOS_PAGO = { pendiente: { l: "Pago pendiente", tono: "warn" }, parcial: { l: "Pago parcial", tono: "info" }, pagada: { l: "Pagada", tono: "ok" } };
export const MEDIOS_PAGO = [
  { v: "transferencia", l: "Transferencia" }, { v: "deposito", l: "Depósito" }, { v: "efectivo", l: "Efectivo" }, { v: "cheque", l: "Cheque" },
  { v: "vale_vista", l: "Vale vista" }, { v: "tarjeta", l: "Tarjeta" }, { v: "otro", l: "Otro" },
];
export const TIPOS_DOCUMENTO_VENTA = [
  { v: "factura_afecta", l: "Factura afecta" }, { v: "factura_exenta", l: "Factura exenta" }, { v: "boleta", l: "Boleta" }, { v: "otro", l: "Otro documento" },
];
export const CATEGORIAS_DOCUMENTO = {
  oc_cliente: "OC del cliente", factura: "Factura", guia_despacho: "Guía de despacho", comprobante_entrega: "Comprobante de entrega",
  comprobante_pago: "Comprobante de pago", compra: "Respaldo de compra (interno)", aceptacion: "Aceptación del cliente", eett_anexo: "Anexo EETT",
  ficha_tecnica: "Ficha técnica", manual: "Manual", foto: "Fotografía", certificado: "Certificado", otro: "Otro respaldo",
};
export const TIPOS_PRODUCTO = [
  { v: "equipo", l: "Equipo" }, { v: "material", l: "Material" }, { v: "herramienta", l: "Herramienta" }, { v: "repuesto", l: "Repuesto" },
  { v: "insumo", l: "Insumo" }, { v: "servicio", l: "Servicio" }, { v: "otro", l: "Otro" },
];
// Parámetros sugeridos por tipo de producto: solo una ayuda para no olvidar datos; nada es obligatorio.
export const PARAMETROS_SUGERIDOS = {
  equipo: ["Potencia", "Alimentación", "Capacidad", "Dimensiones", "Peso", "Material", "Grado de protección"],
  material: ["Material", "Dimensiones", "Espesor", "Peso", "Norma de fabricación"],
  herramienta: ["Potencia", "Alimentación", "Peso", "Dimensiones"],
  repuesto: ["Equipo compatible", "Material", "Dimensiones"],
  insumo: ["Presentación", "Contenido", "Material"],
  servicio: ["Alcance", "Duración", "Lugar de ejecución"],
  otro: [],
};
export const NO_INFORMADO = "No informado";

export const etiquetaEstado = (mapa, k) => mapa[k]?.l || k || "—";
export const tonoEstado = (mapa, k) => mapa[k]?.tono || "neutro";

// Acciones disponibles en la cotización según su estado y quién mira (la base vuelve a validar todo).
export function accionesCotizacion(cot, { esResponsable, esAdmin }) {
  const est = cot?.estado; const ef = cot?.estado_efectivo || est; const tieneVenta = !!cot?.venta_id;
  const puede = !!(esResponsable || esAdmin);
  return {
    editar: puede && est === "borrador",
    enviar: puede && est === "borrador" && Number(cot?.n_items) > 0,
    aceptar: puede && (est === "enviada" || est === "vencida"),
    rechazar: puede && (est === "enviada" || est === "vencida"),
    vencer: puede && est === "enviada" && ef === "vencida",
    nuevaRevision: puede && est !== "borrador",
    volverBorrador: !!esAdmin && est === "enviada",
    crearVenta: puede && !!cot?.revision_aceptada_id && !tieneVenta,
    verVenta: tieneVenta,
    duplicar: true,
    eett: puede,
  };
}

// ── Formatos ───────────────────────────────────────────────────────────────────────────────────────
export const pesos = (n) => (n == null || n === "" ? "—" : "$" + Math.round(Number(n) || 0).toLocaleString("es-CL"));
export const pct = (x) => (x == null || !Number.isFinite(x) ? "—" : (Math.round(x * 1000) / 10).toLocaleString("es-CL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %");
export const cantidadTxt = (n) => { const x = Number(n) || 0; return x.toLocaleString("es-CL", { maximumFractionDigits: 3 }); };
export const fechaTxt = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : "—"; };
export const hoyISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const sumarDias = (iso, n) => { const d = new Date(String(iso).slice(0, 10) + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + Number(n || 0)); return d.toISOString().slice(0, 10); };
export const diasEntre = (a, b) => Math.round((new Date(String(b).slice(0, 10) + "T12:00:00Z") - new Date(String(a).slice(0, 10) + "T12:00:00Z")) / 86400000);
export const folioRevision = (folio, rev) => `${folio}${Number(rev) > 0 ? ` · R${rev}` : ""}`;
export const nuevaClave = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID()
  : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 0x3) | 0x8).toString(16); }));

// ── Búsqueda y filtros ─────────────────────────────────────────────────────────────────────────────
const plano = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filtrarCotizaciones(filas, { texto = "", estado = "", cliente = "", desde = "", hasta = "" } = {}) {
  const q = plano(texto).trim();
  return (filas || []).filter((c) => {
    if (estado && (c.estado_efectivo || c.estado) !== estado) return false;
    if (cliente && c.cliente_id !== cliente) return false;
    if (desde && String(c.fecha_emision) < desde) return false;
    if (hasta && String(c.fecha_emision) > hasta) return false;
    if (q && !plano(`${c.folio} ${c.cliente_nombre} ${c.cliente_rut} ${c.contacto_nombre || ""} ${c.venta_folio || ""}`).includes(q)) return false;
    return true;
  });
}
export function filtrarVentas(filas, { texto = "", estado = "", cliente = "" } = {}) {
  const q = plano(texto).trim();
  return (filas || []).filter((v) => {
    if (estado === "anuladas") { if (v.estado !== "anulada") return false; }
    else if (v.estado === "anulada") return false;
    if (estado === "por_entregar" && v.estado_entrega === "entregada") return false;
    if (estado === "por_facturar" && v.estado_facturacion === "facturada") return false;
    if (estado === "por_cobrar" && !(Number(v.saldo) > 0)) return false;
    if (estado === "vencidas" && !(Number(v.monto_vencido) > 0)) return false;
    if (cliente && v.cliente_id !== cliente) return false;
    if (q && !plano(`${v.folio} ${v.cliente_nombre} ${v.cliente_rut} ${v.cotizacion_folio || ""} ${v.oc_cliente_numeros || ""}`).includes(q)) return false;
    return true;
  });
}

// ── Historial por cliente ───────────────────────────────────────────────────────────────────────────
export function resumenCliente(clienteId, { cotizaciones = [], ventas = [] }) {
  const cs = cotizaciones.filter((c) => c.cliente_id === clienteId);
  const vs = ventas.filter((v) => v.cliente_id === clienteId && v.estado !== "anulada");
  return {
    cotizaciones: cs, ventas: vs,
    nCotizaciones: cs.length, nAceptadas: cs.filter((c) => c.revision_aceptada_id).length,
    vendido: vs.reduce((s, v) => s + Number(v.total || 0), 0),
    cobrado: vs.reduce((s, v) => s + Number(v.cobrado || 0), 0),
    saldo: vs.reduce((s, v) => s + Number(v.saldo || 0), 0),
    vencido: vs.reduce((s, v) => s + Number(v.monto_vencido || 0), 0),
  };
}

// ── Indicadores (Finanzas / Inicio) sin dobles conteos ──────────────────────────────────────────────
// cotizado: cotizaciones vivas (enviadas, no vencidas) sin venta — pipeline, NUNCA ingreso.
// vendido: ventas vigentes (total) · facturado: facturas vigentes · cobrado: pagos vigentes (no imputaciones).
export function indicadoresVP({ cotizaciones = [], ventas = [], margenes = [] } = {}, { desde, hasta } = {}) {
  const enRango = (f) => (!desde || String(f) >= desde) && (!hasta || String(f) <= hasta);
  const vivas = cotizaciones.filter((c) => (c.estado_efectivo || c.estado) === "enviada" && !c.venta_id && enRango(c.fecha_emision));
  const vig = ventas.filter((v) => v.estado !== "anulada" && enRango(v.fecha));
  const porId = new Map((margenes || []).map((m) => [m.venta_id, m]));
  const conCostos = vig.filter((v) => porId.get(v.id)?.costo_estimado != null);
  const costoEst = conCostos.reduce((s, v) => s + Number(porId.get(v.id).costo_estimado || 0), 0);
  const netoConCostos = conCostos.reduce((s, v) => s + Number(v.neto || 0), 0);
  const conReal = vig.filter((v) => Number(porId.get(v.id)?.n_compras || 0) > 0);
  const costoReal = conReal.reduce((s, v) => s + Number(porId.get(v.id).costo_real || 0), 0);
  const netoConReal = conReal.reduce((s, v) => s + Number(v.neto || 0), 0);
  const costoRealDesdeGastos = conReal.reduce((s, v) => s + Number(porId.get(v.id).costo_real_desde_gastos || 0), 0);
  return {
    cotizado: vivas.reduce((s, c) => s + Number(c.total || 0), 0), nCotizado: vivas.length,
    vendido: vig.reduce((s, v) => s + Number(v.total || 0), 0), vendidoNeto: vig.reduce((s, v) => s + Number(v.neto || 0), 0), nVentas: vig.length,
    facturado: vig.reduce((s, v) => s + Number(v.facturado || 0), 0),
    cobrado: vig.reduce((s, v) => s + Number(v.cobrado || 0), 0),
    saldo: vig.reduce((s, v) => s + Number(v.saldo || 0), 0),
    porFacturar: vig.reduce((s, v) => s + Number(v.por_facturar || 0), 0),
    vencido: vig.reduce((s, v) => s + Number(v.monto_vencido || 0), 0),
    anticipos: vig.reduce((s, v) => s + Number(v.anticipos || 0), 0),
    // Utilidad estimada: solo ventas con costos visibles para quien mira (los demás no se suponen en cero).
    costosVisibles: conCostos.length, ventasSinCostoVisible: vig.length - conCostos.length,
    costoEstimado: costoEst, utilidadEstimada: netoConCostos - costoEst, margenEstimado: netoConCostos > 0 ? (netoConCostos - costoEst) / netoConCostos : null,
    ventasConCostoReal: conReal.length, costoReal, utilidadReal: netoConReal - costoReal, margenReal: netoConReal > 0 ? (netoConReal - costoReal) / netoConReal : null,
    costoRealDesdeGastos,
  };
}

// ── Alertas (se integran a Alertas con canal «Ventas privadas») ─────────────────────────────────────
export function alertasVP({ cotizaciones = [], ventas = [] } = {}, hoy = hoyISO(), diasAviso = 3) {
  const out = [];
  for (const c of cotizaciones) {
    if (c.estado !== "enviada" || c.venta_id) continue;
    const d = Number(c.dias_para_vencer);
    if (d < 0) out.push({ canal: "vp", nivel: "medio", icono: "⏳", titulo: "Cotización vencida sin respuesta", detalle: `Venció el ${fechaTxt(c.vigencia_hasta)}: registra la respuesta o márcala como vencida.`, oc: c.folio, cliente: c.cliente_nombre, monto: c.total, destino: { tab: "vp_cotizaciones", id: c.id }, filtro: "vp_cot_vencida" });
    else if (d <= diasAviso) out.push({ canal: "vp", nivel: "medio", icono: "⏳", titulo: d === 0 ? "Cotización vence hoy" : `Cotización vence en ${d} día${d === 1 ? "" : "s"}`, detalle: `Vigente hasta el ${fechaTxt(c.vigencia_hasta)}.`, oc: c.folio, cliente: c.cliente_nombre, monto: c.total, destino: { tab: "vp_cotizaciones", id: c.id }, filtro: "vp_cot_por_vencer" });
  }
  for (const v of ventas) {
    if (v.estado === "anulada") continue;
    if (v.estado_entrega !== "entregada" && v.fecha_entrega_comprometida) {
      const d = diasEntre(hoy, v.fecha_entrega_comprometida);
      if (d < 0) out.push({ canal: "vp", nivel: "alto", icono: "🚚", titulo: "Entrega atrasada", detalle: `Comprometida para el ${fechaTxt(v.fecha_entrega_comprometida)} · ${etiquetaEstado(ESTADOS_ENTREGA, v.estado_entrega)}.`, oc: v.folio, cliente: v.cliente_nombre, destino: { tab: "vp_ordenes", id: v.id }, filtro: "vp_entrega_atrasada" });
      else if (d <= diasAviso) out.push({ canal: "vp", nivel: "medio", icono: "🚚", titulo: d === 0 ? "Entrega comprometida para hoy" : `Entrega en ${d} día${d === 1 ? "" : "s"}`, detalle: `${etiquetaEstado(ESTADOS_ENTREGA, v.estado_entrega)} · ${cantidadTxt(v.cant_entregada)} de ${cantidadTxt(v.cant_total)}.`, oc: v.folio, cliente: v.cliente_nombre, destino: { tab: "vp_ordenes", id: v.id }, filtro: "vp_entrega_proxima" });
    } else if (v.estado_entrega !== "entregada" && !v.fecha_entrega_comprometida) {
      out.push({ canal: "vp", nivel: "bajo", icono: "🚚", titulo: "Entrega pendiente sin fecha comprometida", detalle: `${cantidadTxt(v.cant_entregada)} de ${cantidadTxt(v.cant_total)} entregado.`, oc: v.folio, cliente: v.cliente_nombre, destino: { tab: "vp_ordenes", id: v.id }, filtro: "vp_entrega_sin_fecha" });
    }
    if (Number(v.monto_vencido) > 0) out.push({ canal: "vp", nivel: "alto", icono: "💸", titulo: "Pago vencido", detalle: `Factura vencida desde el ${fechaTxt(v.primer_vencimiento)} (plazo ${v.plazo_pago_dias} días).`, oc: v.folio, cliente: v.cliente_nombre, monto: v.monto_vencido, destino: { tab: "vp_ordenes", id: v.id }, filtro: "vp_pago_vencido" });
  }
  const orden = { alto: 0, medio: 1, bajo: 2 };
  return out.sort((a, b) => orden[a.nivel] - orden[b.nivel]);
}

// ── Agenda: eventos con fecha (entregas comprometidas, vencimientos de cotizaciones y de pago) ───────
export function eventosAgendaVP({ cotizaciones = [], ventas = [] } = {}) {
  const ev = [];
  for (const c of cotizaciones) if (c.estado === "enviada" && !c.venta_id && c.vigencia_hasta) ev.push({ canal: "vp", fecha: String(c.vigencia_hasta).slice(0, 10), tipo: "cotizacion_vence", titulo: `Vence cotización ${c.folio}`, detalle: c.cliente_nombre, monto: c.total, destino: { tab: "vp_cotizaciones", id: c.id } });
  for (const v of ventas) {
    if (v.estado === "anulada") continue;
    if (v.fecha_entrega_comprometida && v.estado_entrega !== "entregada") ev.push({ canal: "vp", fecha: String(v.fecha_entrega_comprometida).slice(0, 10), tipo: "entrega", titulo: `Entrega ${v.folio}`, detalle: v.cliente_nombre, destino: { tab: "vp_ordenes", id: v.id } });
    if (v.proximo_vencimiento && Number(v.saldo) > 0) ev.push({ canal: "vp", fecha: String(v.proximo_vencimiento).slice(0, 10), tipo: "pago_vence", titulo: `Vence pago ${v.folio}`, detalle: v.cliente_nombre, monto: v.saldo, destino: { tab: "vp_ordenes", id: v.id } });
  }
  return ev.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ── Contenido público (PDF de la cotización): lista blanca de campos. Ningún costo puede llegar aquí. ──
const CAMPOS_ITEM_PUBLICO = ["orden", "tipo", "codigo", "descripcion", "unidad", "cantidad", "precio_unitario", "descuento_pct", "subtotal_neto"];
export function documentoPublicoCotizacion(doc) {
  if (!doc) return null;
  const pick = (o, ks) => Object.fromEntries(ks.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
  return {
    folio: doc.folio, revision: doc.revision, fecha_emision: doc.fecha_emision, vigencia_hasta: doc.vigencia_hasta,
    cliente: pick(doc.cliente || {}, ["razon_social", "rut", "giro", "direccion", "comuna", "region"]),
    contacto: pick(doc.contacto || {}, ["nombre", "correo", "telefono"]),
    plazo_entrega: doc.plazo_entrega, direccion_entrega: doc.direccion_entrega, condiciones_pago: doc.condiciones_pago,
    observaciones: doc.observaciones, condiciones_comerciales: doc.condiciones_comerciales,
    afecta_iva: doc.afecta_iva !== false, tasa_iva: doc.tasa_iva ?? TASA_IVA,
    bruto: doc.bruto, descuento: doc.descuento, neto: doc.neto, iva: doc.iva, total: doc.total,
    items: (doc.items || []).map((it) => pick(it, CAMPOS_ITEM_PUBLICO)),
    empresa: pick(doc.empresa || {}, ["razon_social", "nombre_corto", "rut", "giro", "lema", "direccion", "comuna", "correo", "telefonos", "sitio_web"]),
    responsable: doc.responsable || null,
  };
}
// Arma el contenido del documento desde el editor (borrador), con la misma forma que vp_documento_publico().
export function documentoDesdeEditor({ folio, revision, cab, cliente, items, empresa, responsable }) {
  const t = calcularTotales(items, cab);
  return documentoPublicoCotizacion({
    folio, revision, fecha_emision: cab.fecha_emision, vigencia_hasta: cab.vigencia_hasta,
    cliente, contacto: { nombre: cab.contacto_nombre, correo: cab.contacto_correo, telefono: cab.contacto_telefono },
    plazo_entrega: cab.plazo_entrega, direccion_entrega: cab.direccion_entrega, condiciones_pago: cab.condiciones_pago,
    observaciones: cab.observaciones, condiciones_comerciales: cab.condiciones_comerciales, afecta_iva: cab.afecta_iva !== false, tasa_iva: TASA_IVA,
    bruto: t.bruto, descuento: t.descuento, neto: t.neto, iva: t.iva, total: t.total,
    items: (items || []).map((it, i) => ({ orden: i + 1, tipo: it.tipo, codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad, cantidad: num(it.cantidad),
      precio_unitario: num(it.precio_unitario), descuento_pct: num(it.descuento_pct), subtotal_neto: t.lineas[i].neto })),
    empresa, responsable,
  });
}

// ── EETT ───────────────────────────────────────────────────────────────────────────────────────────
// Claves que NUNCA van en una EETT (la base rechaza la emisión si aparecen).
export const CLAVES_COMERCIALES = /(costo|margen|utilidad|precio|descuento|subtotal|neto|iva|total|recargo)/i;
export function tieneDatosComerciales(o) {
  if (Array.isArray(o)) return o.some(tieneDatosComerciales);
  if (o && typeof o === "object") return Object.entries(o).some(([k, v]) => CLAVES_COMERCIALES.test(k) || tieneDatosComerciales(v));
  return false;
}
// Ítem de EETT a partir de la línea de la cotización y la ficha técnica del producto (si existe).
// Lo que falta se marca «No informado» (nunca se completa por suposición).
// Ficha técnica (modelo de Mercado Público) → características de la EETT privada. Generales → grupo «generales» (van en
// «Características Generales» del PDF, como en Mercado Público); especificaciones → grupo «especificaciones».
export function caracteristicasDeFicha(ficha) {
  const s = (v) => String(v ?? "").trim(); const out = [];
  for (const p of ficha?.generales || []) if (s(p?.etiqueta) || s(p?.valor)) out.push({ caracteristica: s(p.etiqueta), valor: s(p.valor), unidad: "", grupo: "generales", origen: { tipo: "ficha" } });
  for (const p of ficha?.especificaciones || []) if (s(p?.etiqueta) || s(p?.valor)) out.push({ caracteristica: s(p.etiqueta), valor: s(p.valor), unidad: "", grupo: "especificaciones", origen: { tipo: "ficha" } });
  return out;
}
// Desde el 08/11/2026 la línea trae su FICHA técnica (la misma de Mercado Público, ingresada en la cotización): nombre, marca,
// modelo, color, descripción, características generales, especificaciones e imágenes salen de ella sin volver a escribirse.
// La biblioteca técnica aporta solo lo que la ficha no tiene (condiciones, accesorios, exclusiones, garantía, normas).
export function itemEETTDesde(linea, producto, tecnico) {
  const t = tecnico || {};
  const ficha = linea?.ficha && typeof linea.ficha === "object" ? linea.ficha : null;
  const sugeridos = ficha ? [] : PARAMETROS_SUGERIDOS[t.tipo_producto || (linea.tipo === "servicio" ? "servicio" : "otro")] || [];
  const car = ficha ? caracteristicasDeFicha(ficha)
    : (t.caracteristicas || []).map((c) => ({ caracteristica: c.caracteristica, valor: c.valor, unidad: c.unidad || "", grupo: c.grupo || "", origen: c.origen || null }));
  for (const s of sugeridos) if (!car.some((c) => plano(c.caracteristica) === plano(s))) car.push({ caracteristica: s, valor: NO_INFORMADO, unidad: "", sugerido: true, excluir: false });
  return {
    item_id: linea.id, orden: linea.orden, cantidad: Number(linea.cantidad), unidad: linea.unidad, tipo: linea.tipo,
    producto_id: producto?.id || linea.producto_id || null,
    nombre: (ficha && String(ficha.nombre || "").trim()) || producto?.nombre || linea.descripcion,
    marca: ficha ? String(ficha.marca || "").trim() : producto?.marca || "", modelo: ficha ? String(ficha.modelo || "").trim() : producto?.modelo || "",
    ...(ficha && String(ficha.color || "").trim() ? { color: String(ficha.color).trim() } : {}),
    codigo: t.codigo || linea.codigo || "",
    descripcion: ficha ? String(ficha.descripcion || "").trim() : producto?.descripcion_tecnica || "",
    ...(ficha ? { imagenes: (ficha.imagenes || []).filter((x) => typeof x === "string" && x && !x.startsWith("data:")).slice(0, 2), origen_ficha: "cotizacion" } : {}),
    caracteristicas: car,
    condiciones_operacion: t.condiciones_operacion || "", condiciones_instalacion: t.condiciones_instalacion || "",
    accesorios: [...(t.accesorios || [])], exclusiones: [...(t.exclusiones || [])], garantia: t.garantia || "",
    normas: (t.normas || []).map((n) => ({ ...n })),
    requisitos: [], anexos: [],
    fuente: t.fuente_tipo ? { tipo: t.fuente_tipo, detalle: t.fuente_detalle || "" } : null,
  };
}
// Revisión previa a emitir (mismas reglas que vp_emitir_eett).
export function revisarEETT(contenido) {
  const errores = [], avisos = [];
  if (!String(contenido?.objeto || "").trim()) errores.push("Falta el objeto del suministro.");
  if (!contenido?.items?.length) errores.push("Selecciona al menos un ítem.");
  for (const it of contenido?.items || []) {
    for (const c of it.caracteristicas || []) {
      if (c.excluir) continue;
      if (!String(c.valor || "").trim() || plano(c.valor) === plano(NO_INFORMADO)) errores.push(`Ítem ${it.orden}: «${c.caracteristica}» está «No informado» (complétalo o exclúyelo).`);
      if (c.pendiente_revision) errores.push(`Ítem ${it.orden}: «${c.caracteristica}» viene de una extracción sin revisar.`);
    }
    for (const r of it.requisitos || []) {
      if ((r.cumplimiento === "cumple" || r.cumplimiento === "equivalente") && !String(r.respaldo || "").trim()) errores.push(`Ítem ${it.orden}: no se declara cumplimiento de «${r.requisito}» sin respaldo.`);
    }
    for (const n of it.normas || []) if (!String(n.respaldo_texto || "").trim() && !n.respaldo_documento_id) errores.push(`Ítem ${it.orden}: la norma «${n.norma}» no tiene respaldo.`);
    if (!String(it.marca || "").trim() && it.tipo !== "servicio") avisos.push(`Ítem ${it.orden}: sin marca (se imprimirá «No informado»).`);
  }
  if (tieneDatosComerciales(contenido)) errores.push("El contenido incluye costos o precios: las EETT no los muestran.");
  return { errores, avisos };
}
// Lo que se imprime de un ítem (las características excluidas no aparecen).
export const caracteristicasVisibles = (it) => (it?.caracteristicas || []).filter((c) => !c.excluir && String(c.valor || "").trim());
export const CUMPLIMIENTOS = [
  { v: "sin_declarar", l: "Sin declarar (solo informativo)" }, { v: "cumple", l: "Cumple (requiere respaldo)" },
  { v: "equivalente", l: "Equivalente (requiere respaldo)" }, { v: "no_cumple", l: "No cumple" },
];

// Propuestas de extracción desde el texto de una ficha técnica (por página). Solo pares «Etiqueta: valor» que aparecen
// literalmente en el texto; nunca se infiere un valor. La persona revisa cada fila antes de incorporarla.
const UNIDADES = ["kW", "W", "HP", "hp", "CV", "V", "VAC", "VDC", "A", "mA", "Hz", "rpm", "kg", "g", "t", "mm", "cm", "m", "m2", "m²", "m3", "m³", "L", "l", "L/min", "l/min", "m3/h", "m³/h", "bar", "psi", "kPa", "MPa", "°C", "ºC", "%", "dB", "IP", "lm", "W/m²", "kVA", "Nm", "pulg", '"'];
export function propuestasDesdeTexto(paginas) {
  const out = []; const vistas = new Set();
  (paginas || []).forEach((texto, idx) => {
    for (const bruta of String(texto || "").split(/\r?\n/)) {
      const l = bruta.replace(/ /g, " ").replace(/\s+/g, " ").trim();
      const m = l.match(/^([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][^:]{1,60}?)\s*[:：]\s*(.{1,120})$/);
      if (!m) continue;
      const car = m[1].trim(); let val = m[2].trim(); let unidad = "";
      const mu = val.match(/^(-?[\d.,]+(?:\s*[x×]\s*[\d.,]+){0,2})\s*([A-Za-z°º%²³/"]{1,6}(?:\/[A-Za-z]{1,4})?)$/);
      if (mu && UNIDADES.some((u) => u.toLowerCase() === mu[2].toLowerCase())) { val = mu[1].trim(); unidad = mu[2]; }
      const k = plano(car) + "|" + plano(val);
      if (vistas.has(k)) continue; vistas.add(k);
      out.push({ caracteristica: car, valor: val, unidad, pagina: idx + 1, texto_origen: l.slice(0, 200) });
    }
  });
  return out;
}

// ── Mensajes de error de la base, legibles ─────────────────────────────────────────────────────────
export function mensajeVP(e) {
  const s = String(e?.message || e || "");
  if (e?.noInstalado) return "Ventas privadas aún no está activado en la base de datos.";
  const m = s.match(/VP[A-Z_0-9]*:\s*(.*)$/s) || s.match(/PI_RUT:\s*(.*)$/s);
  if (m) return m[1].trim();
  if (/Failed to fetch|NetworkError/i.test(s)) return "Sin conexión con la base de datos. Intenta nuevamente.";
  return s || "Ocurrió un error inesperado.";
}
