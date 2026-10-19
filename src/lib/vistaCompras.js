// Datos de lectura para la vista general de Compras (19/10/2026): dirección de entrega y factura vigente.
// Solo presentación: no consulta servicios externos ni modifica registros.
import { facturaVigente, facturasVigentes } from "./calculos.js";
import { esFactura } from "./tributario.js";

const limpio = (t) => String(t || "").replace(/\s+/g, " ").trim();
const norm = (t) => limpio(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Dirección de entrega: 1) la registrada en la OC (BFK); 2) la indicada en las líneas de compra de la OC (BFK);
// 3) la que trae la foto de Mercado Público ya sincronizada, si la incluye. Nunca se inventa.
export function direccionEntregaOC(oc) {
  const conComuna = (d) => {
    const c = limpio(oc?.comuna);
    return c && !norm(d).includes(norm(c)) ? `${d}, ${c}` : d;
  };
  const propia = limpio(oc?.direccion_entrega);
  if (propia) return { texto: conComuna(propia), fuente: "oc" };
  const deLineas = [...new Set((oc?.oc_productos_link || []).map((l) => limpio(l.direccion_entrega)).filter(Boolean))];
  if (deLineas.length) return { texto: conComuna(deLineas[0]) + (deLineas.length > 1 ? ` (+${deLineas.length - 1} más)` : ""), fuente: "productos" };
  const mp = limpio(oc?.mp?.direccion || oc?.mp?.direccion_entrega);
  if (mp) return { texto: conComuna(mp), fuente: "mp" };
  return { texto: "Dirección no registrada", fuente: null };
}

// Factura a mostrar: la vigente (respeta NC que anulan y refacturaciones, misma regla que Facturación SII).
// Si hay más de una vigente se indica cuántas más; las anuladas se consultan en la ficha.
export function facturaVisibleOC(oc) {
  const vig = facturasVigentes(oc).filter((f) => limpio(f.numero_factura));
  const fv = facturaVigente(oc);
  const docs = (oc?.eventos_factura || []).filter((d) => esFactura(d) && limpio(d.numero_factura));
  if (fv && limpio(fv.numero_factura)) {
    const otras = vig.length - 1, anuladas = docs.length - vig.length;
    const extra = [otras > 0 ? `+${otras} vigente${otras > 1 ? "s" : ""}` : "", anuladas > 0 ? `${anuladas} anulada${anuladas > 1 ? "s" : ""}` : ""].filter(Boolean).join(" · ");
    return { texto: `Factura N.º ${limpio(fv.numero_factura)}`, extra, estado: "vigente", numero: limpio(fv.numero_factura) };
  }
  if (docs.length) return { texto: `Factura N.º ${limpio(docs[docs.length - 1].numero_factura)} anulada`, extra: "sin factura vigente", estado: "anulada", numero: null };
  if (oc?.estado_factura_propia === "emitida") return { texto: "Factura sin número", extra: "registro antiguo", estado: "sin_numero", numero: null };
  return { texto: "Sin factura", extra: "", estado: "sin", numero: null };
}
