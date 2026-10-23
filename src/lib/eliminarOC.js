// Eliminación definitiva de OC duplicadas (23/10/2026). Solo presentación y apoyo: TODAS las reglas las aplica la base
// (oc_eliminacion_revisar / oc_eliminar_definitivamente). Aquí: sugerir la OC original, textos y errores en lenguaje simple.

const norm = (s) => String(s || "").toUpperCase().replace(/\s+/g, "").trim();

// OC original candidata: el código de la duplicada empieza con el código de la original (p. ej. «…-AG26-B» → «…-AG26»),
// o comparte una factura (folio y monto). Primero las de código, luego las de factura. Nunca la misma OC.
export function sugerirOriginales(oc, todas) {
  if (!oc) return [];
  const n = norm(oc.numero_oc);
  const folios = new Set((oc.eventos_factura || []).map((f) => `${norm(f.numero_factura)}|${Number(f.monto) || 0}`).filter((k) => !k.startsWith("|")));
  const res = [];
  for (const o of todas || []) {
    if (!o || o.id === oc.id) continue;
    const m = norm(o.numero_oc);
    const porCodigo = m && n !== m && n.startsWith(m) && /^[-_ .]?[A-Z0-9]{1,3}$/.test(n.slice(m.length));
    const porFactura = (o.eventos_factura || []).some((f) => folios.has(`${norm(f.numero_factura)}|${Number(f.monto) || 0}`));
    if (porCodigo || porFactura) res.push({ oc: o, motivo: porCodigo ? "el código de esta OC es el de la original con una letra agregada" : "comparte una factura (mismo folio y monto)", peso: porCodigo ? 0 : 1 });
  }
  return res.sort((a, b) => a.peso - b.peso || String(a.oc.numero_oc).localeCompare(String(b.oc.numero_oc)));
}

export const NOMBRE_REGISTRO = {
  eventos_pago_cliente: "cobros", eventos_factura: "facturas", eventos_compra: "compras", eventos_pago_financiamiento: "devoluciones al financiador",
  eventos_entrega: "entregas", eventos_postventa: "postventa", oc_productos_link: "productos", oc_comentarios: "comentarios", oc_reclamos: "reclamos",
  oc_responsables: "responsables", oc_bloqueos: "bloqueos de edición", notificaciones: "notificaciones", trib_clasificaciones: "clasificaciones tributarias",
  contactos_institucionales_oc: "contactos", contactos_institucionales_historial: "historial de contactos", oc_seguimientos: "seguimientos",
  correos_bfk: "correos", historial_cambios: "historial de cambios",
};
export const NOMBRE_MOVIMIENTO = { cobro: "Cobro", factura: "Factura", compra: "Compra", devolucion: "Devolución al financiador" };

// Se puede pedir la eliminación: la base dice que es eliminable, el código escrito coincide y hay motivo.
export const puedeEliminar = (rev, codigo, motivo) =>
  !!rev?.eliminable && norm(codigo) !== "" && norm(codigo) === norm(rev?.oc?.numero_oc) && String(motivo || "").trim().length >= 5;

export function mensajeErrorEliminar(e) {
  const t = String(e?.rpcCuerpo?.message || e?.message || e || "");
  if (/PGRST202|Could not find the function/i.test(t)) return "La base aún no tiene la eliminación definitiva instalada (actualización pendiente). No se eliminó nada.";
  if (/PGRST205|oc_eliminaciones/i.test(t) && /find|exist/i.test(t)) return "La base aún no tiene la auditoría de eliminaciones (actualización pendiente).";
  return t.replace(/^OCE:\s*/, "") || "No se pudo eliminar. No se eliminó nada.";
}
