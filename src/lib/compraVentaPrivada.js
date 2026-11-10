// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// «Registrar compra» de una orden de venta privada desde su cotización aprobada (10/11/2026). Funciones puras.
// Reutiliza SIN cambios las funciones de Mercado Público (lib/compraCotizacion.js): filas iniciales, cambios destacados,
// pedidos por proveedor con el despacho cotizado UNA sola vez por pedido y validaciones. Lo propio de Ventas privadas:
//   · la base sale de la orden de venta (vp_venta_items + vp_venta_item_costos, copia de la cotización aprobada: proveedor,
//     enlace, precio de compra, IVA, factura y despacho), no de la cotización de Mercado Público;
//   · lo comprado sale de vp_compras (filas con concepto «producto»/«despacho», solo vigentes);
//   · la utilidad es NETA, como en todo Ventas privadas: venta neta − costo real, donde el costo de una compra con factura es
//     su neto (IVA crédito fiscal) y sin factura —o en una venta exenta— es el total pagado. Precios ingresados con IVA.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
import { itemDesdeLinea, enviosDesdeItems, descripcionDeFicha } from "./vpCotizacion.js";
import { precioBrutoUnit, IVA } from "./cotizaciones.js";
import { estadoLineas, filasIniciales, filaDesde, cambiosFila, armarPedidos, validarCompra, nuevoPedido } from "./compraCotizacion.js";

export { estadoLineas, filasIniciales, filaDesde, cambiosFila, armarPedidos, nuevoPedido };
const san = (s) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "");
const r0 = (x) => Math.round(Number(x) || 0);
const txt = (v) => String(v ?? "").trim();

// ¿La orden puede registrar la compra desde su cotización? (origen cotización y al menos una línea con datos de compra)
export const tieneBaseCotizacion = (v, d) => !!v?.cotizacion_id && (d?.costos || []).some((k) => k.precio_compra != null || txt(k.proveedor));

// Base (solo lectura) en montos con IVA, con la forma que esperan las funciones de Mercado Público.
export function baseVenta(v, d) {
  const costos = new Map((d.costos || []).map((k) => [k.item_id, k]));
  const items = (d.items || []).slice().sort((a, b) => a.orden - b.orden).map((i) => {
    const k = costos.get(i.id);
    return itemDesdeLinea(i, k ? { ...k, costo_unitario: k.costo_unitario_estimado, enlace_original: null } : undefined);
  });
  const envios = enviosDesdeItems(items);
  const lineas = items.map((it, idx) => {
    const i = d.items.find((x) => x.id === it.key) || {};
    return { key: it.key, san: san(it.key), orden: i.orden ?? idx + 1, nombre: txt(it.ficha?.nombre) || txt(i.descripcion), marca: txt(it.ficha?.marca), modelo: txt(it.ficha?.modelo),
      descripcion: txt(i.descripcion) || descripcionDeFicha(it.ficha), unidad: txt(i.unidad) || "UN", cantidad: Number(i.cantidad) || 0,
      unitario: it.precio_origen === "" ? 0 : precioBrutoUnit(it), proveedor: it.proveedor, enlace: it.enlace, envio_key: it.envio_key || null,
      con_factura: it.con_factura !== false, sinPrecio: it.precio_origen === "" };
  });
  const env = envios.map((e) => ({ key: e.key, san: san(e.key), proveedor: e.proveedor || "", monto: r0(e.monto), con_factura: e.con_factura !== false }));
  for (const it of items) delete it._despacho;
  return { lineas, envios: env, direccion: txt(v.direccion_entrega), exenta: v.afecta_iva === false, codigo: v.cotizacion_folio || v.folio || "" };
}

// Lo ya comprado desde la cotización: cantidades por línea y despachos cotizados registrados (solo filas vigentes).
export function compradoEnVenta(d) {
  const porItem = {}; const despachos = new Set(); const pedidos = new Set();
  for (const k of d.compras || []) {
    if (k.estado !== "vigente" || !k.concepto) continue;
    if (k.pedido) pedidos.add(k.pedido);
    if (k.concepto === "producto" && k.venta_item_id) porItem[san(k.venta_item_id)] = (porItem[san(k.venta_item_id)] || 0) + (Number(k.cantidad) || 0);
    if (k.concepto === "despacho" && k.envio_clave) despachos.add(san(k.envio_clave));
  }
  return { porItem, despachos, pedidos };
}

// Costo real de un monto pagado (con IVA) según el documento: con factura el IVA es crédito fiscal, salvo venta exenta.
// Igual que la base (vp_registrar_compras_cotizacion): con factura neto = round(total / 1,19); el costo se redondea por fila.
export const costoReal = (bruto, conFactura, exenta) => r0(conFactura && !exenta ? r0(bruto) / (1 + IVA) : bruto);

// ¿El pedido se compra con factura? docs: { [clave del pedido]: 'factura'|'boleta' } (opción B). Por defecto, lo cotizado.
const docPedido = (g, base, docs) => docs?.[g.clave] || (g.filas.every((f) => base.lineas.find((l) => l.key === f.itemKey)?.con_factura !== false) ? "factura" : "boleta");

// Comparación (antes de guardar): total a pagar (con IVA) y utilidad neta actualizada. ventaNeta = neto de la orden;
// costoEstimado = costo estimado oficial (vp_margen_ventas); costoPrevio = costo real ya registrado (vp_margen_ventas).
export function compararVP({ base, lineas, grupos, ventaNeta, costoEstimado, costoPrevio = 0, comprado, docs = {} }) {
  const ex = base.exenta;
  const filas = grupos.flatMap((g) => g.filas.map((f) => {
    const l = base.lineas.find((x) => x.key === f.itemKey); const q = Number(f.cantidad) || 0;
    const original = r0((l?.unitario || 0) * q); const real = r0(f.unitario) * q;
    return { rid: f.rid, producto: f.producto, cantidad: q, original, real, diferencia: real - original, pedido: g.n };
  }));
  let costoCompra = 0;
  for (const g of grupos) {
    const fac = docPedido(g, base, docs) === "factura";
    for (const f of g.filas) costoCompra += costoReal(r0(f.unitario) * Number(f.cantidad), fac, ex);
    for (const dd of g.despachos) {
      const e = base.envios.find((x) => x.key === dd.envioKey);
      costoCompra += costoReal(dd.real, docs?.[g.clave] ? fac : e ? e.con_factura : fac, ex);
    }
    g.documento = docPedido(g, base, docs);
  }
  const productosOriginal = filas.reduce((s, f) => s + f.original, 0), productosReal = filas.reduce((s, f) => s + f.real, 0);
  const despachoOriginal = grupos.reduce((s, g) => s + g.despachos.reduce((a, x) => a + x.original, 0), 0);
  const despachoReal = grupos.reduce((s, g) => s + g.despachos.reduce((a, x) => a + x.real, 0), 0);
  const compradoAhora = {}; for (const f of grupos.flatMap((g) => g.filas)) compradoAhora[f.itemKey] = (compradoAhora[f.itemKey] || 0) + Number(f.cantidad);
  const pendientes = lineas.map((l) => ({ ...l, ahora: compradoAhora[l.key] || 0, queda: Math.max(0, l.pendiente - (compradoAhora[l.key] || 0)) }));
  const cubiertos = new Set(grupos.flatMap((g) => g.despachos.map((x) => x.envioSan)));
  const despPend = base.envios.filter((e) => !cubiertos.has(e.san) && !comprado.despachos.has(e.san) && pendientes.some((l) => l.envio_key === e.key && l.queda > 0));
  const costoPendiente = pendientes.reduce((s, l) => s + costoReal(l.unitario * l.queda, l.con_factura, ex), 0) + despPend.reduce((s, e) => s + costoReal(e.monto, e.con_factura, ex), 0);
  const parcial = pendientes.some((l) => l.queda > 0);
  const costoActualizado = r0(costoPrevio) + r0(costoCompra) + r0(costoPendiente);
  return { filas, productosOriginal, productosReal, despachoOriginal, despachoReal, totalOriginal: productosOriginal + despachoOriginal, totalReal: productosReal + despachoReal,
    diferencia: productosReal + despachoReal - productosOriginal - despachoOriginal, costoCompra: r0(costoCompra), costoPendiente: r0(costoPendiente), parcial, pendientes,
    utilidadOriginal: r0(ventaNeta) - r0(costoEstimado), utilidadActualizada: r0(ventaNeta) - costoActualizado, costoActualizado };
}

// Validaciones: las de Mercado Público, salvo que en Ventas privadas una línea puede tener cantidades con decimales (p. ej. metros).
export function validarCompraVP(args) {
  const r = validarCompra(args);
  const errores = r.errores.filter((e) => !/la cantidad debe ser un número entero/.test(e));
  for (const f of args.filas.filter((x) => Number(x.cantidad) > 0)) if (Math.round(Number(f.cantidad) * 100) !== Number(f.cantidad) * 100) errores.push(`«${f.producto || "Producto"}»: la cantidad admite hasta 2 decimales.`);
  return { ...r, errores: [...new Set(errores)] };
}

// Filas para vp_registrar_compras_cotizacion (una por producto comprado y una por despacho del pedido).
export function filasParaGuardar({ grupos, base, pedido, docs = {} }) {
  const out = [];
  for (const g of grupos) {
    const ped = `${san(pedido)}-${g.n}`; const doc = docPedido(g, base, docs); let k = 0;
    for (const f of g.filas) {
      const l = base.lineas.find((x) => x.key === f.itemKey);
      out.push({ clave: `${ped}-${l?.san || "extra"}-${k++}`, pedido: ped, concepto: "producto", venta_item_id: f.itemKey, cantidad: Number(f.cantidad), precio_unitario: r0(f.unitario),
        proveedor: txt(f.proveedor) || null, enlace: txt(f.enlace) || null, documento_tipo: doc,
        descripcion: `${txt(f.producto) || l?.nombre || "Producto"}${f.marca || f.modelo ? ` · ${[f.marca, f.modelo].filter(Boolean).join(" ")}` : ""} × ${f.cantidad} · Pedido ${ped}` });
    }
    for (const dd of g.despachos) {
      if (!(dd.real > 0)) continue;
      const e = base.envios.find((x) => x.key === dd.envioKey);
      out.push({ clave: `${ped}-desp${dd.envioSan}-0`, pedido: ped, concepto: "despacho", envio_clave: dd.adicional ? null : dd.envioKey, monto: dd.real,
        proveedor: txt(g.proveedor) || txt(e?.proveedor) || null, documento_tipo: docs?.[g.clave] ? doc : e ? (e.con_factura ? "factura" : "boleta") : doc,
        descripcion: `${dd.adicional ? "Despacho adicional" : "Despacho"} · Pedido ${ped}` });
    }
  }
  return out;
}
