import { ventaExentaPorDocumentos } from "./tributario.js";
// ═══════════════════════════════════════════════════════════════
// Productos de una OC (oc_productos_link): edición parcial y reparto
// de la inversión (Fase 4A). Funciones puras: no escriben datos.
// ═══════════════════════════════════════════════════════════════

// Campos editables de un producto y cómo se nombran en el historial.
export const CAMPOS_PRODUCTO = {
  descripcion: { accion: "Producto editado", campo: "descripción" },
  url: { accion: "Link de compra cambiado", campo: "link" },
  direccion_entrega: { accion: "Dirección de despacho del producto", campo: "dirección" },
  cantidad: { accion: "Cantidad del producto", campo: "cantidad" },
  precio_compra: { accion: "Precio de compra del producto", campo: "precio de compra" },
  precio_venta: { accion: "Precio de venta del producto", campo: "precio de venta" },
};

// Valor comparable: vacío, null y "sin-link" son "sin dato"; números se comparan como números.
const comparable = (campo, v) => {
  if (v === undefined || v === null) return null;
  if (campo === "url") { const s = String(v).trim(); return s === "" || s === "sin-link" ? null : s; }
  if (campo === "cantidad" || campo === "precio_compra" || campo === "precio_venta") {
    if (v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null;
  }
  const s = String(v).trim(); return s === "" ? null : s;
};

// Construye el cambio a guardar SOLO con los campos que vienen (los que no vienen no se tocan)
// y que realmente cambiaron. Devuelve { patch, cambios } — patch vacío = nada que guardar.
export function cambiosProducto(antes, nuevos) {
  const patch = {}; const cambios = [];
  for (const k of Object.keys(CAMPOS_PRODUCTO)) {
    if (!nuevos || !Object.prototype.hasOwnProperty.call(nuevos, k) || nuevos[k] === undefined) continue;
    const a = comparable(k, antes?.[k]); const n = comparable(k, nuevos[k]);
    if (a === n) continue;
    patch[k] = nuevos[k];
    cambios.push({ ...CAMPOS_PRODUCTO[k], anterior: antes?.[k] ?? null, nuevo: nuevos[k] ?? null });
  }
  return { patch, cambios };
}

// Reparte un total invertido entre los productos comprados, a prorrata del precio de venta
// de cada uno (o en partes iguales si ninguno lo tiene). El último se lleva el resto exacto.
// Devuelve [{ id, precio_compra }] — SOLO el precio de compra; ningún otro dato cambia.
export function repartirInversion(total, lineas) {
  const t = Math.round(Number(total) || 0);
  const ls = (lineas || []).filter(Boolean);
  if (t <= 0 || !ls.length) return [];
  const base = ls.reduce((s, l) => s + (Number(l.precio_venta) || 0), 0);
  let acumulado = 0;
  return ls.map((l, i) => {
    let parte;
    if (i === ls.length - 1) parte = t - acumulado;
    else if (base > 0) parte = Math.round(t * ((Number(l.precio_venta) || 0) / base));
    else parte = Math.round(t / ls.length);
    acumulado += parte;
    return { id: l.id, precio_compra: parte };
  });
}

// Venta de una OC existente (14/10/2026), solo lectura: lo vendido viene de Mercado Público (líneas «venta»).
// El desglose por producto es CONFIABLE solo si todas las líneas vendidas tienen precio y su suma calza con el
// monto adjudicado (neto = monto/1,19, o el monto con IVA). Si no, se usa el monto total como referencia y
// nunca se inventan precios unitarios. precio_venta de cada línea es el total de la línea (como lo entrega MP).
export function ventaDeOC(oc) {
  const exenta = ventaExentaPorDocumentos(oc);   // fase 1: venta exenta reconocida por sus facturas DTE 34
  const total = Number(oc?.monto_total) || 0;
  const vendidas = (oc?.oc_productos_link || []).filter((l) => (l.origen || "venta") === "venta" && String(l.descripcion || "").trim() && l.descripcion !== "Producto por completar")
    .slice().sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
  const conPrecio = vendidas.length > 0 && vendidas.every((l) => Number(l.precio_venta) > 0);
  const suma = conPrecio ? vendidas.reduce((s, l) => s + Number(l.precio_venta), 0) : 0;
  const tol = Math.max(2, total * 0.005);
  const base = !conPrecio || !total ? null : exenta ? (Math.abs(suma - total) <= tol ? "exento" : null)
    : Math.abs(suma - total / 1.19) <= tol ? "neto" : Math.abs(suma - total) <= tol ? "con IVA" : null;
  const lineas = vendidas.map((l) => {
    const cantidad = Number(l.cantidad) > 0 ? Number(l.cantidad) : null;
    const totalLinea = base ? Number(l.precio_venta) : null;
    return { id: l.id, descripcion: l.descripcion, cantidad, total: totalLinea, unitario: totalLinea && cantidad ? totalLinea / cantidad : null };
  });
  return { total, confiable: !!base, base, lineas };
}

// Productos VENDIDOS de una OC (15/10/2026), solo lectura. Dos fuentes, sin sumarlas:
//  1) desglose estructurado en BFK: líneas «venta» identificables (con nombre real);
//  2) si no hay desglose, los ítems de la foto de Mercado Público (oc.mp.items).
// Nunca cuenta líneas «compra» (lo que compramos no es lo que vendemos) ni crea, importa o modifica productos.
const PLACEHOLDER = "Producto por completar";
export function productosVendidos(oc) {
  const estructurados = (oc?.oc_productos_link || []).filter((l) => (l.origen || "venta") === "venta" && String(l.descripcion || "").trim() && l.descripcion !== PLACEHOLDER);
  const mp = (oc?.mp?.items || []).filter((it) => String(it?.descripcion || "").trim());
  if (estructurados.length) return { n: estructurados.length, fuente: "bfk", nMP: mp.length };
  if (mp.length) return { n: mp.length, fuente: "mp", nMP: mp.length };
  return { n: 0, fuente: null, nMP: 0 };
}
export const textoProductosVendidos = (oc) => { const { n } = productosVendidos(oc); return n ? `${n} producto${n > 1 ? "s" : ""}` : "sin productos"; };
