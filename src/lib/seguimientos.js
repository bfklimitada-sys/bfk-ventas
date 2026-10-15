// ═══════════════════════════════════════════════════════════════
// Seguimiento especial de OC (15/10/2026). Tabla public.oc_seguimientos (RLS: lectura/creación/edición para
// usuarios autenticados, eliminación solo administradores; un seguimiento resuelto queda como historial).
// El sobrecosto estimado es SOLO informativo: ninguna cuenta financiera lo usa (no es compra, gasto, deuda
// ni utilidad). Funciones puras: no escriben datos.
// ═══════════════════════════════════════════════════════════════
export const CATEGORIAS_SEGUIMIENTO = [
  { id: "postventa", etiqueta: "Postventa / Garantía" },
  { id: "sobrecosto", etiqueta: "Sobrecosto / Cargo adicional" },
  { id: "proveedor", etiqueta: "Proveedor" },
  { id: "producto", etiqueta: "Producto" },
  { id: "entrega", etiqueta: "Entrega / Despacho" },
  { id: "cliente", etiqueta: "Cliente" },
  { id: "facturacion", etiqueta: "Facturación / Cobranza" },
  { id: "otro", etiqueta: "Otro" },
];
export const PRIORIDADES_SEGUIMIENTO = [{ id: "alta", etiqueta: "Alta" }, { id: "media", etiqueta: "Media" }, { id: "baja", etiqueta: "Baja" }];
export const ESTADOS_SEGUIMIENTO = [{ id: "pendiente", etiqueta: "Pendiente" }, { id: "en_gestion", etiqueta: "En gestión" }, { id: "resuelto", etiqueta: "Resuelto" }];
export const etiquetaCategoria = (id) => CATEGORIAS_SEGUIMIENTO.find((c) => c.id === id)?.etiqueta || id || "";
export const etiquetaPrioridad = (id) => PRIORIDADES_SEGUIMIENTO.find((c) => c.id === id)?.etiqueta || id || "";
export const etiquetaEstado = (id) => ESTADOS_SEGUIMIENTO.find((c) => c.id === id)?.etiqueta || id || "";

const RANGO = { alta: 3, media: 2, baja: 1 };
const hoyLocal = () => { const d = new Date(); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

export const seguimientosDe = (oc) => oc?.oc_seguimientos || [];
export const estaAbierto = (s) => s?.estado === "pendiente" || s?.estado === "en_gestion";
// Abiertos primero por prioridad (alta → baja) y luego por fecha de revisión más próxima.
export const seguimientosAbiertos = (oc) => seguimientosDe(oc).filter(estaAbierto)
  .sort((a, b) => (RANGO[b.prioridad] || 0) - (RANGO[a.prioridad] || 0) || String(a.fecha_revision || "9999").localeCompare(String(b.fecha_revision || "9999")) || String(a.creado_en).localeCompare(String(b.creado_en)));
export const seguimientosResueltos = (oc) => seguimientosDe(oc).filter((s) => s.estado === "resuelto")
  .sort((a, b) => String(b.resuelto_en || "").localeCompare(String(a.resuelto_en || "")));
// Filtro «Seguimiento especial»: OC con al menos un seguimiento abierto (cuenta OC, no seguimientos).
export const tieneSeguimientoAbierto = (oc) => seguimientosDe(oc).some(estaAbierto);
export const prioridadMaxima = (oc) => seguimientosAbiertos(oc)[0]?.prioridad || null;
export const revisionVencida = (s, hoy = hoyLocal()) => estaAbierto(s) && !!s.fecha_revision && String(s.fecha_revision).slice(0, 10) < hoy;

// Alertas: UNA por seguimiento abierto que sea de prioridad alta o tenga la revisión vencida (nunca dos por el
// mismo seguimiento). Al resolverse, deja de cumplir la condición y la alerta desaparece; el registro se conserva.
export function alertasSeguimiento(oc, hoy = hoyLocal()) {
  return seguimientosAbiertos(oc).filter((s) => s.prioridad === "alta" || revisionVencida(s, hoy)).map((s) => {
    const vencida = revisionVencida(s, hoy);
    return { id: s.id, seguimiento: s, vencida, alta: s.prioridad === "alta",
      titulo: vencida ? `Seguimiento atrasado · ${etiquetaCategoria(s.categoria)}` : `Seguimiento prioridad alta · ${etiquetaCategoria(s.categoria)}`,
      detalle: [String(s.descripcion || "").slice(0, 90), s.responsable_nombre ? `Responsable: ${s.responsable_nombre}` : "Sin responsable", vencida ? `Revisión prevista ${String(s.fecha_revision).slice(0, 10)}` : ""].filter(Boolean).join(" · ") };
  });
}
