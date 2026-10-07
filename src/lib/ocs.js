// ═══════════════════════════════════════════════════════════════
// Criterios únicos de la OC para toda la interfaz (Fase 4A).
// Lista, filtros, Panel, Alertas y Agenda usan estas mismas funciones,
// así un contador siempre abre exactamente las OCs que cuenta.
// Solo leen la OC: no escriben datos ni cambian reglas comerciales.
// ═══════════════════════════════════════════════════════════════
import { estadoVencimiento, facturaVigente, plazoPago } from "./calculos.js";
import { fmt } from "./theme.js";
import { cobroEnCaja, cobroSaldaCliente, esValeVistaPendiente } from "./mediosPago.js";

// ── Código de la OC ───────────────────────────────────────────
// Código con forma de Mercado Público: 1234-567-AG26 (acepta "Nº" delante).
export const esCodigoMP = (numero) =>
  /^\s*N?[ºo°]?\s*\d+\s*-\s*\d+\s*-\s*[A-Za-z]{2}\d{2}\s*$/.test(String(numero || ""));

// Clave para comparar códigos: la misma que usa el índice único de la base
// (quita "Nº"/"N°"/"No" inicial, deja solo letras y números, en mayúscula) y,
// además, una "N" pegada a los números ("N1234-5-AG26" es la misma OC).
export const normalizarCodigoOC = (v) =>
  String(v || "")
    .replace(/^\s*[Nn][ºo°]\s*/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^N(?=\d)/, "");

// Busca una OC con el mismo código (normalizado) en las listas dadas (activas y archivadas).
export const buscarOCPorCodigo = (codigo, listas, excluirId = null) => {
  const k = normalizarCodigoOC(codigo);
  if (!k) return null;
  for (const lista of listas || []) {
    for (const o of lista || []) {
      if (o && o.id !== excluirId && normalizarCodigoOC(o.numero_oc) === k) return o;
    }
  }
  return null;
};

export const mensajeDuplicado = (o) =>
  o?.archivada
    ? `La OC ${o.numero_oc} ya existe y está archivada: restáurela desde Administración en vez de crearla de nuevo.`
    : `La OC ${o?.numero_oc} ya está cargada. Búsquela en Compras.`;

// Error de la base por código repetido (índice único) → mensaje claro.
export const esErrorDuplicado = (e) => /duplicate|unique|23505/i.test(String(e?.message || e || ""));

// ── Estados de Mercado Público (CodigoEstado) ──────────────────
export const ESTADOS_MP = {
  4: { texto: "Enviada a proveedor: todavía no aceptada", tipo: "sin_aceptar" },
  5: { texto: "En proceso: todavía no aceptada", tipo: "sin_aceptar" },
  6: { texto: "Aceptada", tipo: "aceptada" },
  9: { texto: "Cancelada en Mercado Público", tipo: "cancelada" },
  12: { texto: "Aceptada · recepción conforme", tipo: "aceptada" },
  13: { texto: "Aceptada · pendiente de recepcionar", tipo: "aceptada" },
  14: { texto: "Aceptada · recepcionada parcialmente", tipo: "aceptada" },
  15: { texto: "Aceptada · recepción conforme incompleta", tipo: "aceptada" },
};
export const estadoMP = (codigo) => {
  const c = Number(codigo);
  return ESTADOS_MP[c] || { texto: c ? `Estado ${c} en Mercado Público` : "Estado no informado por Mercado Público", tipo: "desconocido" };
};

// Respuesta de /api/oc → qué mostrar. tipo: "ok" | "no_disponible" | "error".
export const resultadoConsultaMP = (status, cuerpo) => {
  if (status === 404) return { tipo: "no_disponible" };
  if (status >= 200 && status < 300 && cuerpo?.ok && cuerpo?.oc) return { tipo: "ok", oc: cuerpo.oc, estado: estadoMP(cuerpo.oc.codigo_estado) };
  return { tipo: "error", mensaje: cuerpo?.error || `Mercado Público no respondió (código ${status}). Intente de nuevo en unos minutos.` };
};

// ── Etapas (un solo criterio para toda la app) ─────────────────
export const esVenta = (oc) => (oc?.tipo_registro || "venta") === "venta";
export const estaComprada = (oc) => (oc?.eventos_compra || []).length > 0;
// "Entregada": confirmada (registro actual) o entregado (registros anteriores).
export const ESTADOS_ENTREGADA = ["confirmada", "entregado"];
export const estaEntregada = (oc) => ESTADOS_ENTREGADA.includes(oc?.estado_entrega);
export const estaFacturada = (oc) => oc?.estado_factura_propia === "emitida";
export const estaCobrada = (oc) => oc?.estado_pago_cliente === "pagado";
// Etapa de financiamiento cumplida: pagada, o "no aplica" (venta propia o fondos propios, reglas 2 y 3 de la Fase 4B).
export const financiamientoPagado = (oc) => oc?.estado_pago_financiamiento === "pagado" || oc?.estado_pago_financiamiento === "no_aplica";
export const tieneVendedor = (oc) => !!oc?.vendedor_id;
export const estaCerrada = (oc) => estaCobrada(oc) && financiamientoPagado(oc);
export const etapasCompletadas = (oc) =>
  [estaComprada(oc), estaEntregada(oc), estaFacturada(oc), estaCobrada(oc), financiamientoPagado(oc)].filter(Boolean).length;

// Vale vista o cheque que el cliente entregó y que aún no se cobra en el banco.
export const valeVistasPendientes = (oc) =>
  (oc?.eventos_pago_cliente || []).filter(esValeVistaPendiente);

// Vencimiento de la factura vigente (null si no hay factura o no tiene fecha).
export const vencimientoFactura = (oc) => {
  const evF = facturaVigente(oc || {});
  if (!evF?.fecha) return null;
  const dias = fmt.diasDesde(String(evF.fecha).slice(0, 10));
  if (dias === null || dias === undefined || Number.isNaN(dias)) return null;
  const plazo = plazoPago(oc);
  return { evF, dias, plazo, ...estadoVencimiento(dias, plazo) };
};
export const facturaPorCobrar = (oc) => esVenta(oc) && estaFacturada(oc) && !estaCobrada(oc);
export const facturaVencida = (oc) => facturaPorCobrar(oc) && !!vencimientoFactura(oc)?.vencida;
export const facturaPorVencer = (oc) => facturaPorCobrar(oc) && !!vencimientoFactura(oc)?.porVencer;

// Entrega estimada (la que se puso al registrar la compra) ya pasada y sin entregar.
export const fechaEntregaEstimada = (oc) => (oc?.eventos_compra || [])[0]?.fecha_entrega_estimada || null;
export const diasAtrasoEntrega = (oc) => {
  const f = fechaEntregaEstimada(oc);
  if (!f || estaEntregada(oc)) return null;
  const d = fmt.diasDesde(String(f).slice(0, 10));
  return d !== null && !Number.isNaN(d) && d > 0 ? d : null;
};
export const entregaAtrasada = (oc) => esVenta(oc) && diasAtrasoEntrega(oc) !== null;

// ── Fechas: la de la OC y la de la compra son datos distintos ──
// Fecha de la OC: la de emisión (Mercado Público, o la ingresada en una OC manual).
// Solo para registros antiguos sin esa fecha se usa la de compra o la de registro, y se indica.
export const fechaOC = (oc) => {
  if (oc?.fecha_hora_emision_mp) return { valor: String(oc.fecha_hora_emision_mp), origen: "emision" };
  if (oc?.fecha_emision_mp) return { valor: String(oc.fecha_emision_mp), origen: "emision" };
  const c = (oc?.eventos_compra || [])[0]?.fecha;
  if (c) return { valor: String(c), origen: "compra" };
  if (oc?.creadoEn) return { valor: String(oc.creadoEn), origen: "registro" };
  return { valor: "", origen: "ninguna" };
};
// Fecha real en que BFK compró al proveedor (evento de compra). Nunca la escribe Mercado Público.
export const fechaCompra = (oc) => (oc?.eventos_compra || [])[0]?.fecha || null;
// La fecha de la OC se edita a mano solo si no viene de Mercado Público.
export const fechaOCEditable = (oc) => !esCodigoMP(oc?.numero_oc) || !!oc?.no_en_mp;

// ── Accesos del Panel: el contador y la lista usan el mismo criterio ──
export const FILTROS_PANEL = {
  vale_vista: { etiqueta: "OC con vale vista o cheque por cobrar en el banco", pred: (oc) => valeVistasPendientes(oc).length > 0 },
  vencidas: { etiqueta: "Facturas vencidas sin cobrar", pred: facturaVencida },
  por_vencer: { etiqueta: "Facturas que vencen dentro de 5 días", pred: facturaPorVencer },
  entregadas_sin_factura: { etiqueta: "Entregadas sin facturar", pred: (oc) => esVenta(oc) && estaEntregada(oc) && !estaFacturada(oc) },
  compradas_sin_entregar: { etiqueta: "Compradas sin entregar", pred: (oc) => esVenta(oc) && estaComprada(oc) && !estaEntregada(oc) },
  mp_sin_comprar: { etiqueta: "OC de Mercado Público sin compra registrada", pred: (oc) => esVenta(oc) && esCodigoMP(oc?.numero_oc) && !estaComprada(oc) },
  sin_vendedor: { etiqueta: "OC sin vendedor (no entran en ninguna comisión)", pred: (oc) => esVenta(oc) && !tieneVendedor(oc) },
  mp_cancelada: { etiqueta: "OC cancelada en Mercado Público (no cobrada)", pred: (oc) => esVenta(oc) && ocCanceladaEnMP(oc) },
};
export const filtrarPanel = (ocs, clave) => {
  const f = FILTROS_PANEL[clave];
  return f ? (ocs || []).filter(f.pred) : [];
};
export const esFiltroPanel = (clave) => !!FILTROS_PANEL[clave];

// ── Fase 4C: estado operativo único (lista de OCs, Panel, Alertas y Agenda) ──
// Un solo texto/tono por OC. `tono` lo traduce cada pantalla a sus colores:
// ok | warn | danger | info | transit | purple | muted.
// La foto de Mercado Público (oc.mp, caché) solo agrega "cancelada" o "sin aceptar".
export const MP_CANCELADA = 9;
export const ocCanceladaEnMP = (oc) => Number(oc?.mp?.codigo_estado) === MP_CANCELADA && !estaCobrada(oc);
export function estadoOperativo(oc) {
  const comprada = estaComprada(oc), entregada = estaEntregada(oc), facturada = estaFacturada(oc);
  const cobrada = estaCobrada(oc), finPagado = financiamientoPagado(oc);
  if (ocCanceladaEnMP(oc)) return { clave: "mp_cancelada", tono: "danger", texto: "Cancelada en Mercado Público" };
  if (facturada && !entregada) return { clave: "facturada_sin_entrega", tono: "warn", texto: "Facturada sin registrar la entrega" };
  if (cobrada && !facturada) return { clave: "cobrada_sin_factura", tono: "warn", texto: "Cobrada sin registrar la factura" };
  if (cobrada && valeVistasPendientes(oc).length) return { clave: "vale_vista", tono: "warn", texto: "Cobrada · vale vista/cheque sin cobrar en el banco" };
  if (cobrada && finPagado) return { clave: "cerrada", tono: "ok", texto: "Cerrada" };
  if (cobrada) return { clave: "falta_financiamiento", tono: "purple", texto: "Cobrada · falta pagar financiamiento" };
  if (facturada) {
    const v = vencimientoFactura(oc);
    if (v?.reclamar) return { clave: "reclamar", tono: "danger", texto: `Reclamar pago · ${v.dias} de ${v.plazo} días` };
    if (v?.vencida) return { clave: "vencida", tono: "danger", texto: `Vencida · ${v.dias} de ${v.plazo} días` };
    if (v?.porVencer) return { clave: "por_vencer", tono: "warn", texto: `Por vencer · quedan ${v.plazo - v.dias} días` };
    const parcial = oc?.estado_pago_cliente === "parcial";
    if (v) return { clave: "facturada", tono: "warn", texto: `${parcial ? "Abono parcial" : "Facturada"} · ${v.dias} de ${v.plazo} días` };
    return { clave: "facturada", tono: "warn", texto: parcial ? "Abono parcial · falta el resto" : "Facturada · esperando pago" };
  }
  if (entregada) return { clave: "entregada", tono: "info", texto: "Entregada · falta facturar" };
  if (comprada) return { clave: "comprada", tono: "transit", texto: "Comprada · falta entregar" };
  if (Number(oc?.mp?.codigo_estado) === 4 || Number(oc?.mp?.codigo_estado) === 5) return { clave: "mp_sin_aceptar", tono: "muted", texto: "Sin aceptar en Mercado Público" };
  return { clave: "sin_compra", tono: "muted", texto: "Sin compra registrada" };
}

// ── Fase 4C: plata real vs. plata por llegar (Panel) ──
// Cobrado que ya está en el banco: un vale vista o cheque entregado y no cobrado todavía no es caja,
// y un cobro fuera de banco (retención del cliente, cobro directo del vendedor) nunca lo es.
export const cobradoEnBanco = (oc) =>
  (oc?.eventos_pago_cliente || []).filter(cobroEnCaja).reduce((s, e) => s + (Number(e.monto) || 0), 0);
// Cobrado que salda lo que el cliente debe (incluye retenciones y cobros fuera de banco).
export const cobradoDelCliente = (oc) =>
  (oc?.eventos_pago_cliente || []).filter(cobroSaldaCliente).reduce((s, e) => s + (Number(e.monto) || 0), 0);
// Lo que falta que entre a la cuenta por una venta: contra la factura vigente si ya se facturó
// (es el documento que se cobra), o contra el monto adjudicado si todavía no. Los cobros parciales
// se descuentan una sola vez y un vale vista sin cobrar se cuenta aquí (aún no es caja).
export const ingresoPendienteOC = (oc) => {
  if (!esVenta(oc)) return 0;
  const facturado = Number(oc?.monto_facturado) || 0;
  const base = facturado > 0 ? facturado : (Number(oc?.monto_total) || 0);
  return Math.max(0, base - cobradoDelCliente(oc));
};

