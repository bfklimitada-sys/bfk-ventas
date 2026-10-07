// Misma regla de búsqueda de OC para Compras y para el buscador rápido del Panel.
import { facturaVigente } from "./calculos";
import { claveComparacion } from "./rut";
import { pasaFiltroFinanciador, pasaFiltroVendedor } from "./asignaciones.js";
import { esDocumentoBancario, esValeVistaPendiente } from "./mediosPago.js";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Productos de la OC (vendidos y comprados) y proveedores (de las compras y de los productos comprados).
export const productosDe = (oc) => (oc?.oc_productos_link || []).map((l) => l.descripcion).filter(Boolean);
export const proveedoresDe = (oc) => [...new Set([
  ...(oc?.eventos_compra || []).map((e) => e.proveedor),
  ...(oc?.oc_productos_link || []).map((l) => l.proveedor),
].map((p) => String(p || "").trim()).filter(Boolean))];
export const tieneValeVista = (oc) => (oc?.eventos_pago_cliente || []).some(esDocumentoBancario);
export const valeVistaPendienteDe = (oc) => (oc?.eventos_pago_cliente || []).some(esValeVistaPendiente);

export function coincideBusqueda(oc, texto) {
  const q = norm(String(texto || "").trim());
  if (!q) return true;
  const numFactura = facturaVigente(oc)?.numero_factura;
  const enTexto = (v) => norm(v).includes(q);
  return (
    enTexto(oc.numero_oc) ||
    enTexto(oc.cliente) ||
    enTexto(oc.comuna) ||
    enTexto(oc.entidad) ||
    enTexto(oc.rut_cliente) ||
    (/^[0-9.\-\skK]{5,}$/.test(q) && claveComparacion(oc.rut_cliente).includes(claveComparacion(q))) ||
    String(numFactura || "").toLowerCase().includes(q) ||
    (oc.eventos_factura || []).some((f) => String(f.numero_factura || "").toLowerCase() === q) ||
    String(oc.monto_facturado || "").includes(q) ||
    // Fase 4C: producto, proveedor, vendedor, financiador e institución del vale vista.
    productosDe(oc).some(enTexto) ||
    proveedoresDe(oc).some(enTexto) ||
    enTexto(oc.vendedores?.nombre) ||
    enTexto(oc.financiadores?.nombre) ||
    (oc.eventos_pago_cliente || []).some((e) => e.institucion && enTexto(e.institucion))
  );
}

// Filtros avanzados de Compras (Fase 4C). Criterio vacío = no filtra.
//  vendedor: id | "__sin__"   financiador: id   proveedor: texto exacto (sin mayúsculas)
//  producto: texto contenido  valeVista: "pendiente" | "cualquiera"
export function cumpleCriterios(oc, c = {}) {
  // Vendedor / financiador: "__sin__" = sin definir (misma regla que la marca "Falta …" del listado).
  if (!pasaFiltroVendedor(oc, c.vendedor)) return false;
  if (!pasaFiltroFinanciador(oc, c.financiador)) return false;
  if (c.proveedor && !proveedoresDe(oc).some((p) => norm(p) === norm(c.proveedor))) return false;
  if (c.producto && !productosDe(oc).some((p) => norm(p).includes(norm(c.producto)))) return false;
  if (c.valeVista === "pendiente" && !valeVistaPendienteDe(oc)) return false;
  if (c.valeVista === "cualquiera" && !tieneValeVista(oc)) return false;
  return true;
}

// Proveedores distintos (para el selector), con el nombre tal como se escribió la primera vez.
export const listaProveedores = (ocs) => {
  const m = new Map();
  for (const oc of ocs || []) for (const p of proveedoresDe(oc)) if (!m.has(norm(p))) m.set(norm(p), p);
  return [...m.values()].sort((a, b) => a.localeCompare(b, "es"));
};
