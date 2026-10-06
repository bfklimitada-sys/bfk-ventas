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
