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

// ── Subsanación de factura (15/10/2026) ──────────────────────
// Es un seguimiento de categoría «facturacion» (permitida por la base: sin migración) cuya descripción lleva los
// datos de la solicitud en texto legible y, al final, una marca con la referencia a la factura (su id en
// eventos_factura y su folio). El monto, la fecha y el estado SII NO se copian: se leen del registro de la factura.
// Registrar una subsanación no toca la factura, el SII, cobros, IVA ni finanzas.
const MARCA_SUB = /\n?⟦subsanacion factura=([^ ⟧]*) numero=([^ ⟧]*) solicitud=([^ ⟧]*)⟧\s*$/;
const ROTULOS = ["Motivo", "Fecha de solicitud", "Solicitado por", "Observaciones"];
const fechaTxt = (iso) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
export function descripcionSubsanacion({ facturaId, numero, motivo, fechaSolicitud, solicitante, observaciones }) {
  const lineas = [`Subsanación de factura N.º ${String(numero || "").trim() || "s/n"}`, `Motivo: ${String(motivo || "").trim()}`];
  if (fechaSolicitud) lineas.push(`Fecha de solicitud: ${fechaTxt(fechaSolicitud)}`);
  if (String(solicitante || "").trim()) lineas.push(`Solicitado por: ${String(solicitante).trim()}`);
  if (String(observaciones || "").trim()) lineas.push(`Observaciones: ${String(observaciones).trim()}`);
  lineas.push(`⟦subsanacion factura=${encodeURIComponent(facturaId || "")} numero=${encodeURIComponent(String(numero || "").trim())} solicitud=${fechaSolicitud || "-"}⟧`);
  return lineas.join("\n");
}
export function leerSubsanacion(s) {
  if (!s || s.categoria !== "facturacion") return null;
  const d = String(s.descripcion || ""); const m = MARCA_SUB.exec(d);
  if (!m) return null;
  const cuerpo = d.slice(0, m.index).split("\n").slice(1).join("\n");
  const campos = {}; let actual = null;
  for (const l of cuerpo.split("\n")) {
    const r = ROTULOS.find((k) => l.startsWith(k + ": "));
    if (r) { actual = r; campos[r] = l.slice(r.length + 2); } else if (actual) campos[actual] += "\n" + l;
  }
  return { facturaId: decodeURIComponent(m[1]), numero: decodeURIComponent(m[2]), fechaSolicitud: m[3] === "-" ? null : m[3],
    motivo: (campos.Motivo || "").trim(), solicitante: (campos["Solicitado por"] || "").trim() || null, observaciones: (campos.Observaciones || "").trim() || null };
}
export const esSubsanacion = (s) => !!leerSubsanacion(s);
export const etiquetaSeguimiento = (s) => { const sub = leerSubsanacion(s); return sub ? `Subsanación de factura N.º ${sub.numero || "s/n"}` : etiquetaCategoria(s?.categoria); };
export const subsanacionesAbiertas = (oc, facturaId) => seguimientosAbiertos(oc).filter((s) => { const x = leerSubsanacion(s); return x && (facturaId == null || x.facturaId === facturaId); });
// Evita registrar dos veces la MISMA solicitud (misma factura, misma fecha de solicitud y mismo motivo, aún abierta).
// Gestiones distintas sobre la misma factura (otro motivo u otra fecha) sí se permiten.
const norm = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
export const subsanacionDuplicada = (oc, { facturaId, fechaSolicitud, motivo }) => subsanacionesAbiertas(oc, facturaId)
  .some((s) => { const x = leerSubsanacion(s); return (x.fechaSolicitud || null) === (fechaSolicitud || null) && norm(x.motivo) === norm(motivo); });

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
      titulo: vencida ? `Seguimiento atrasado · ${etiquetaSeguimiento(s)}` : `Seguimiento prioridad alta · ${etiquetaSeguimiento(s)}`,
      detalle: [leerSubsanacion(s) ? `Motivo: ${leerSubsanacion(s).motivo}`.slice(0, 90) : String(s.descripcion || "").slice(0, 90), s.responsable_nombre ? `Responsable: ${s.responsable_nombre}` : "Sin responsable", vencida ? `${leerSubsanacion(s) ? "Fecha límite" : "Revisión prevista"} ${fechaTxt(String(s.fecha_revision).slice(0, 10))}` : ""].filter(Boolean).join(" · ") };
  });
}
