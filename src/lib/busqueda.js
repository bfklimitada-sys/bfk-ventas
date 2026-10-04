// Misma regla de búsqueda de OC para Compras y para el buscador rápido del Panel.
import { facturaVigente } from "./calculos";

export function coincideBusqueda(oc, texto) {
  const q = String(texto || "").trim().toLowerCase();
  if (!q) return true;
  const numFactura = facturaVigente(oc)?.numero_factura;
  return (
    oc.numero_oc.toLowerCase().includes(q) ||
    (oc.cliente || "").toLowerCase().includes(q) ||
    (oc.comuna || "").toLowerCase().includes(q) ||
    (oc.entidad || "").toLowerCase().includes(q) ||
    (oc.rut_cliente || "").toLowerCase().includes(q) ||
    String(numFactura || "").toLowerCase().includes(q) ||
    String(oc.monto_facturado || "").includes(q)
  );
}
