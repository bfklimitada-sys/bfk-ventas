// ═══════════════════════════════════════════════════════════════
// Mercado Público (Fase 4C). Funciones puras: no leen ni escriben la base.
//  · Foto de la OC en Mercado Público (neto, IVA, estado, aceptación, recepción e
//    ítems estructurados). Se guarda como caché en mp_cache_avisos (id "oc_mp:<id OC>"):
//    son datos de Mercado Público que siempre se pueden volver a consultar.
//  · Qué completar en la OC y en sus productos SIN pisar datos manuales válidos.
//  · Qué OCs revisar automáticamente, sin consultas repetitivas ni innecesarias.
// ═══════════════════════════════════════════════════════════════
import { esCodigoMP, estaCerrada } from "./ocs.js";

export const PREFIJO_FOTO_MP = "oc_mp:";
export const claveFotoMP = (ocId) => `${PREFIJO_FOTO_MP}${ocId}`;
export const CLAVE_REVISION_AUTO = "revision_auto";

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const txt = (v) => (v === null || v === undefined ? "" : String(v).trim());
const vacio = (v) => !v || String(v).trim() === "" || String(v).toUpperCase().includes("POR COMPLETAR");

// Estado de recepción que informa Mercado Público (CodigoEstado).
export const RECEPCION_MP = {
  12: { clave: "conforme", texto: "Recepción conforme" },
  13: { clave: "pendiente", texto: "Pendiente de recepcionar" },
  14: { clave: "parcial", texto: "Recepcionada parcialmente" },
  15: { clave: "conforme_incompleta", texto: "Recepción conforme incompleta" },
};
export const recepcionMP = (codigo) => RECEPCION_MP[Number(codigo)] || null;
export const ACEPTADA_MP = new Set([6, 12, 13, 14, 15]);
export const mpCancelada = (foto) => Number(foto?.codigo_estado) === 9;
export const mpSinAceptar = (foto) => [4, 5].includes(Number(foto?.codigo_estado));

// Foto compacta de la respuesta normalizada de /api/oc (lo que se guarda en caché).
export function fotoMP(d, ahoraIso = new Date().toISOString()) {
  if (!d) return null;
  const codigo = Number(d.codigo_estado) || null;
  return {
    v: 1,
    revisado_en: ahoraIso,
    codigo_estado: codigo,
    estado: txt(d.estado_mp),
    aceptada: ACEPTADA_MP.has(codigo),
    recepcion: recepcionMP(codigo)?.clave || null,
    neto: num(d.monto_neto),
    iva: num(d.impuestos),
    descuentos: num(d.descuentos),
    cargos: num(d.cargos),
    total: num(d.monto_total),
    moneda: txt(d.moneda) || "CLP",
    fecha_envio: txt(d.fecha_envio) || null,
    fecha_aceptacion: txt(d.fecha_aceptacion) || null,
    fecha_cancelacion: txt(d.fecha_cancelacion) || null,
    fecha_ultima_modificacion: txt(d.fecha_ultima_modificacion) || null,
    forma_pago: txt(d.forma_pago) || null,
    dias_pago: d.dias_pago ?? null,
    tipo_despacho: txt(d.tipo_despacho) || null,
    items: (d.productos || []).map((p, i) => ({
      n: i + 1,
      descripcion: txt(p.descripcion),
      especificacion_proveedor: txt(p.especificacion_proveedor) || null,
      codigo_producto: txt(p.codigo_producto) || null,
      categoria: txt(p.categoria) || null,
      cantidad: num(p.cantidad) || null,
      unidad: txt(p.unidad) || null,
      precio_unitario: num(p.precio_venta_unitario) || null,
      total: num(p.total_linea) || null,
    })),
  };
}

// Cambios a la OC desde Mercado Público. Solo rellena lo vacío (cliente, contacto, etc.).
// La fecha de emisión SIEMPRE se toma de Mercado Público (única fuente de verdad; regla de la Fase 4A).
// El monto adjudicado solo se completa si está en cero. Nunca toca etapas, montos derivados ni la fecha de compra.
export function cambiosOCDesdeMP(oc, d) {
  const c = { sync_pendiente: false, no_en_mp: false };
  if (vacio(oc.cliente)) c.cliente = d.cliente || "";
  if (vacio(oc.entidad)) c.entidad = d.entidad || "";
  if (vacio(oc.rut_cliente)) c.rut_cliente = d.rut_cliente || "";
  if (vacio(oc.comuna)) c.comuna = d.comuna || "";
  if (vacio(oc.contacto)) c.contacto = d.contacto || "";
  if (vacio(oc.correo_cliente)) c.correo_cliente = d.correo_cliente || "";
  if (vacio(oc.tipo_despacho) && d.tipo_despacho) c.tipo_despacho = d.tipo_despacho;
  const fechaHoraMP = d.fecha_envio || d.fecha_creacion || "";
  const fechaMP = String(fechaHoraMP).slice(0, 10);
  if (fechaMP && fechaMP !== oc.fecha_emision_mp) c.fecha_emision_mp = fechaMP;
  if (fechaHoraMP && fechaHoraMP !== oc.fecha_hora_emision_mp) c.fecha_hora_emision_mp = fechaHoraMP;
  if (!oc.dias_pago) c.dias_pago = d.dias_pago || 30;
  if (!Number(oc.monto_total) && Number(d.monto_total)) c.monto_total = Number(d.monto_total);
  return c;
}

// Línea de lo VENDIDO (origen venta) a partir de un ítem de Mercado Público.
export const lineaVentaDesdeMP = (p, i) => ({
  descripcion: txt(p.descripcion) || `Ítem ${i + 1}`,
  cantidad: Math.round(num(p.cantidad)) || null,
  precio_venta: num(p.total_linea) || null,
  categoria: txt(p.categoria) || null,
  origen: "venta",
  orden: i,
});

// Plan para los productos vendidos: completa SOLO los campos vacíos de las líneas existentes
// (una descripción editada a mano, una cantidad o un precio ya puestos no se tocan) y agrega
// las líneas que faltan sin duplicar. Los productos comprados (origen compra) nunca se tocan.
export function planProductosVenta(links, productos) {
  const vendidas = (links || []).filter((l) => (l.origen || "venta") === "venta").slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const actualizar = [], insertar = [];
  (productos || []).forEach((p, i) => {
    const nueva = lineaVentaDesdeMP(p, i);
    const l = vendidas[i];
    if (l) {
      const patch = {};
      if (!l.descripcion || l.descripcion === "Producto por completar") patch.descripcion = nueva.descripcion;
      if (l.cantidad === null || l.cantidad === undefined || l.cantidad === "") { if (nueva.cantidad) patch.cantidad = nueva.cantidad; }
      if (l.precio_venta === null || l.precio_venta === undefined || l.precio_venta === "") { if (nueva.precio_venta) patch.precio_venta = nueva.precio_venta; }
      if (!l.categoria && nueva.categoria) patch.categoria = nueva.categoria;
      if (Object.keys(patch).length) actualizar.push({ id: l.id, patch });
    } else {
      const yaEsta = vendidas.some((x) => x.descripcion === nueva.descripcion && Number(x.cantidad || 0) === Number(nueva.cantidad || 0));
      if (!yaEsta) insertar.push(nueva);
    }
  });
  return { actualizar, insertar };
}

// ── Revisión automática de estado (prudente) ──────────────────
// Como mucho cada REVISION_CADA_HORAS (entre todos los usuarios, con la marca guardada en la base),
// y como mucho MAX_POR_REVISION OCs por vez. Se revisan solo las OCs de Mercado Público abiertas
// cuyo estado puede cambiar y cuya última revisión tiene al menos DIAS_ENTRE_REVISIONES días.
export const REVISION_CADA_HORAS = 6;
export const MAX_POR_REVISION = 12;
export const DIAS_ENTRE_REVISIONES = 3;
export const LIMITE_USO_DIARIO = 8000;   // margen bajo el tope diario de 10.000 solicitudes de Mercado Público

export const toca = (ultimaIso, ahora = new Date(), horas = REVISION_CADA_HORAS) =>
  !ultimaIso || (ahora.getTime() - new Date(ultimaIso).getTime()) >= horas * 3600_000;

export function elegirRevisionAutomatica(ocs, fotos, ahora = new Date(), { max = MAX_POR_REVISION, dias = DIAS_ENTRE_REVISIONES } = {}) {
  const cand = [];
  for (const oc of ocs || []) {
    if (!esCodigoMP(oc.numero_oc) || oc.no_en_mp || oc.sync_pendiente || oc.archivada) continue;
    const f = fotos?.[oc.id] || null;
    // Estado final en Mercado Público (cancelada o recepción conforme): no cambia más.
    if (f && (mpCancelada(f) || Number(f.codigo_estado) === 12)) continue;
    // OC cerrada en BFK (cobrada y financiamiento resuelto): su estado en Mercado Público ya no cambia nada.
    if (estaCerrada(oc) || (oc.tipo_registro || "venta") !== "venta") continue;
    if (f && !toca(f.revisado_en, ahora, dias * 24)) continue;
    cand.push({ oc, ultima: f?.revisado_en || "" });
  }
  // Primero las nunca revisadas, luego las revisadas hace más tiempo.
  return cand.sort((a, b) => a.ultima.localeCompare(b.ultima)).slice(0, max).map((x) => x.oc);
}
