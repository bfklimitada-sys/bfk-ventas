// ═══════════════════════════════════════════════════════════════
// Compra desde la cotización adjudicada (15/10/2026). Funciones puras: no escriben datos.
//
// Modelo (sin migraciones; reutiliza lo existente):
//  · Vínculo EXPLÍCITO: cotizaciones.oc_codigo = código de la OC (comparación exacta, sin mayúsculas/espacios)
//    y estado «adjudicada». Nunca por parecido de nombres o montos.
//  · Cada pedido (un proveedor) = UNA compra en la base (registrar_compra_oc: evento de compra, costo y deuda del
//    financiador, como siempre). Sus notas llevan «Pedido <id>-<n>» para no registrarlo dos veces.
//  · Lo comprado se guarda en oc_productos_link como productos «compra» (distintos de lo vendido) con un id fijo:
//      lnkcz-<pedido>-<n>-<línea de la cotización>-<k>   y el despacho:   lnkcz-<pedido>-<n>-desp<envío>-0
//    Así se sabe qué se compró de cada línea (comprado / pendiente) y qué despacho compartido ya se registró,
//    y un reintento no duplica filas (la clave primaria lo impide).
//  · La cotización aceptada, el monto adjudicado y los productos vendidos NO se modifican.
//  · Montos con IVA (lo que se paga), igual base para lo cotizado y lo real: no se duplica IVA ni despacho.
// ═══════════════════════════════════════════════════════════════
import { calcularCotizacion, destinoDe } from "./cotizaciones.js";

const san = (s) => String(s ?? "").replace(/[^A-Za-z0-9]/g, "");
export const normalCodigo = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "");
const normal = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const r0 = (x) => Math.round(Number(x) || 0);

export const nuevoPedido = () => `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
export const idFilaCompra = (pedido, n, itemKey, k) => `lnkcz-${san(pedido)}-${n}-${san(itemKey) || "extra"}-${k}`;
export const idFilaDespacho = (pedido, n, envioKey) => `lnkcz-${san(pedido)}-${n}-desp${san(envioKey) || "extra"}-0`;
export const marcaPedido = (pedido, n) => `Pedido ${pedido}-${n}`;
export function leerIdCompra(id) {
  const m = /^lnkcz-([A-Za-z0-9]+)-(\d+)-([A-Za-z0-9]+)-(\d+)$/.exec(String(id || ""));
  if (!m) return null;
  const desp = m[3].startsWith("desp");
  return { pedido: m[1], n: Number(m[2]), item: desp ? null : m[3], envio: desp ? m[3].slice(4) : null };
}

// Cotizaciones adjudicadas vinculadas EXPLÍCITAMENTE a la OC (por su código).
export const cotizacionesVinculadas = (lista, numeroOC) =>
  (lista || []).filter((c) => c && c.estado === "adjudicada" && normalCodigo(c.oc_codigo) && normalCodigo(c.oc_codigo) === normalCodigo(numeroOC));

// Líneas y despachos de la cotización (solo lectura), en montos con IVA.
export function baseCotizacion(cot) {
  const calc = calcularCotizacion(cot);
  const lineas = (cot.items || []).map((it, i) => {
    const l = calc.lineas[i]; const q = Number(it.cantidad) || 0; const f = it.ficha || {};
    return { key: it.key, san: san(it.key), nombre: String(f.nombre || "").trim(), marca: String(f.marca || "").trim(), modelo: String(f.modelo || "").trim(),
      cantidad: q, unitario: q ? l.costo_producto_bruto / q : 0, proveedor: it.proveedor || "", enlace: it.enlace || "", envio_key: it.envio_key || null };
  });
  const envios = (cot.envios || []).map((e) => ({ key: e.key, san: san(e.key), proveedor: e.proveedor || "",
    monto: calc.lineas.reduce((s, l, i) => s + ((cot.items[i]?.envio_key === e.key) ? l.envio_asignado : 0), 0) }));
  const costoTotal = calc.lineas.reduce((s, l) => s + l.costo_bruto, 0);
  return { lineas, envios, direccion: destinoDe(cot), costoTotal, codigo: cot.id_externo || cot.nombre || String(cot.id || "").slice(0, 8) };
}

// ── Consistencia productos ↔ compras (15/10/2026) ──
// Una fila de pedido («lnkcz-…») solo es VÁLIDA si su compra existe: un evento de compra de la OC con la marca
// «Pedido <id>-<n>» en sus notas. Las filas válidas pertenecen a una compra confirmada: no se editan ni eliminan
// sueltas (se usa «Corregir compra»), y son las ÚNICAS que cuentan como compradas. Filas sin compra asociada
// (huérfanas) no cuentan y siguen las reglas normales de edición.
export const MARCA_PEDIDO = /Pedido ([A-Z0-9]+)-(\d+)/;
export function comprasConPedido(oc) {
  const m = new Map();
  for (const e of oc?.eventos_compra || []) { const r = MARCA_PEDIDO.exec(String(e.notas || "")); if (r) m.set(`${san(r[1])}-${r[2]}`, e); }
  return m;
}
export const esEventoDePedido = (e) => MARCA_PEDIDO.test(String(e?.notas || ""));
// ¿La fila pertenece a una compra confirmada? Devuelve { clave, pedido, n, evento } o null.
export function filaProtegida(l, oc, compras = comprasConPedido(oc)) {
  if (l?.origen !== "compra") return null;
  const r = leerIdCompra(l.id); if (!r) return null;
  const clave = `${r.pedido}-${r.n}`; const evento = compras.get(clave);
  return evento ? { clave, pedido: r.pedido, n: r.n, evento } : null;
}
// Pedidos confirmados de la OC con sus filas (productos y despachos).
export function pedidosDeOC(oc) {
  const compras = comprasConPedido(oc); const out = new Map();
  for (const [clave, evento] of compras) out.set(clave, { clave, evento, productos: [], despachos: [] });
  for (const l of oc?.oc_productos_link || []) {
    const f = filaProtegida(l, oc, compras); if (!f) continue;
    const r = leerIdCompra(l.id); (r.envio ? out.get(f.clave).despachos : out.get(f.clave).productos).push(l);
  }
  return [...out.values()];
}
export const pedidoDeEvento = (oc, evento) => pedidosDeOC(oc).find((p) => p.evento.id === evento?.id) || null;

// Lo ya comprado desde esta cotización en la OC: cantidades por línea y despachos registrados.
// Solo cuentan filas de compras CONFIRMADAS (con su evento de compra).
export function compradoEnOC(oc) {
  const porItem = {}; const despachos = new Set(); const pedidos = new Set(); const compras = comprasConPedido(oc);
  for (const l of oc?.oc_productos_link || []) {
    const f = filaProtegida(l, oc, compras); if (!f) continue;
    const r = leerIdCompra(l.id);
    pedidos.add(f.clave);
    if (r.envio) despachos.add(r.envio);
    else porItem[r.item] = (porItem[r.item] || 0) + (Number(l.cantidad) || 0);
  }
  return { porItem, despachos, pedidos };
}

// «Corregir compra»: separa lo comercial/operativo (no mueve dinero) de lo financiero (cantidad, precio, despacho).
// filas: [{ id, descripcion, url, direccion_entrega, cantidad, unitario | monto (despacho) }] con los valores nuevos.
// Las cantidades solo pueden bajar (para comprar más se usa «Registrar otra compra», que valida lo pendiente).
// Devuelve { cambiosFilas: [{ id, patch }], financiero, costoNuevo, errores, detalle }.
export function planCorreccion(pedido, nuevos, { proveedor, fechaEntrega } = {}) {
  const errores = []; const cambiosFilas = []; const detalle = []; let delta = 0; let financiero = false;
  const todas = [...pedido.productos, ...pedido.despachos];
  for (const l of todas) {
    const n = nuevos.find((x) => x.id === l.id); if (!n) continue;
    const esDesp = !!leerIdCompra(l.id)?.envio; const patch = {};
    const texto = (k, v) => { const a = k === "url" ? (l.url && l.url !== "sin-link" ? l.url : "") : String(l[k] || ""); const b = String(v ?? "").trim(); if (a.trim() !== b) { patch[k] = k === "url" ? (b || "sin-link") : (b || null); detalle.push(`${l.descripcion}: ${k === "url" ? "enlace" : k === "descripcion" ? "producto" : "dirección"} cambiado`); } };
    if (!esDesp) { texto("descripcion", n.descripcion); texto("url", n.url); texto("direccion_entrega", n.direccion_entrega); }
    const cantAntes = esDesp ? 1 : Number(l.cantidad) || 0;
    const cant = esDesp ? 1 : Number(n.cantidad);
    if (!esDesp && (!Number.isInteger(cant) || cant < 0)) errores.push(`«${l.descripcion}»: la cantidad debe ser un entero mayor o igual a 0.`);
    else if (!esDesp && cant > cantAntes) errores.push(`«${l.descripcion}»: la cantidad solo puede disminuir (${cantAntes} → ${cant}). Para comprar más usa «Registrar otra compra».`);
    const totalAntes = Number(l.precio_compra) || 0;
    const totalNuevo = esDesp ? Math.round(Number(n.monto)) : Math.round(Number(n.unitario) * cant);
    if (!(totalNuevo >= 0) || Number.isNaN(totalNuevo)) errores.push(`«${l.descripcion}»: monto inválido.`);
    if (!esDesp && cant !== cantAntes) { patch.cantidad = cant; financiero = true; detalle.push(`${l.descripcion}: cantidad ${cantAntes} → ${cant}`); }
    if (totalNuevo !== totalAntes && !Number.isNaN(totalNuevo)) { patch.precio_compra = totalNuevo; financiero = true; delta += totalNuevo - totalAntes; detalle.push(`${l.descripcion}: costo ${totalAntes} → ${totalNuevo}`); }
    if (Object.keys(patch).length) cambiosFilas.push({ id: l.id, patch });
  }
  const ev = pedido.evento;
  const cambiaProveedor = proveedor !== undefined && String(proveedor).trim() !== String(ev.proveedor || "").trim();
  const cambiaFecha = fechaEntrega !== undefined && String(fechaEntrega || "") !== String(ev.fecha_entrega_estimada || "").slice(0, 10) && !!fechaEntrega;
  if (cambiaProveedor) detalle.push(`proveedor ${ev.proveedor || "—"} → ${String(proveedor).trim()}`);
  if (cambiaFecha) detalle.push(`entrega estimada → ${fechaEntrega}`);
  const costoNuevo = financiero ? Math.max(0, Math.round((Number(ev.costo_compra) || 0) + delta)) : Number(ev.costo_compra) || 0;
  return { cambiosFilas, financiero: financiero && costoNuevo !== (Number(ev.costo_compra) || 0) || financiero, costoNuevo, delta, errores: [...new Set(errores)], detalle,
    cambiaEvento: cambiaProveedor || cambiaFecha || (financiero && costoNuevo !== (Number(ev.costo_compra) || 0)), cambiaProveedor, cambiaFecha,
    hayCambios: cambiosFilas.length > 0 || cambiaProveedor || cambiaFecha };
}

// Estado por línea: cotizada, comprada y pendiente.
export const estadoLineas = (base, comprado) => base.lineas.map((l) => {
  const c = comprado.porItem[l.san] || 0;
  return { ...l, comprada: c, pendiente: Math.max(0, l.cantidad - c) };
});

// Filas iniciales de la compra (opciones A y B): lo pendiente de cada línea, con los datos cotizados.
let sec = 0;
export const filaDesde = (l, base, extra = {}) => ({ rid: `r${++sec}`, itemKey: l.key, itemSan: l.san, producto: l.nombre, marca: l.marca, modelo: l.modelo,
  cantidad: l.pendiente, unitario: Math.round(l.unitario), proveedor: l.proveedor, enlace: l.enlace, direccion: base.direccion, ...extra });
export const filasIniciales = (base, lineas) => lineas.filter((l) => l.pendiente > 0).map((l) => filaDesde(l, base));

// Campos cambiados respecto de lo cotizado (para destacarlos).
export function cambiosFila(f, l, base) {
  if (!l) return {};
  return { producto: normal(f.producto) !== normal(l.nombre), marca: normal(f.marca) !== normal(l.marca), modelo: normal(f.modelo) !== normal(l.modelo),
    unitario: r0(f.unitario) !== r0(l.unitario), proveedor: normal(f.proveedor) !== normal(l.proveedor), enlace: String(f.enlace || "").trim() !== String(l.enlace || "").trim(),
    direccion: normal(f.direccion) !== normal(base.direccion), cantidad: Number(f.cantidad) !== l.pendiente };
}

// Agrupa las filas en pedidos (uno por proveedor) y asigna cada despacho cotizado UNA sola vez:
// al primer pedido que lleva alguna de sus líneas, salvo que ya se haya registrado en una compra anterior.
// despachosReales: { [grupoProveedor|envioKey]: monto } (opción B); extras: { [proveedor]: monto }.
export function armarPedidos({ filas, base, comprado, despachosReales = {}, extras = {} }) {
  const activas = filas.filter((f) => Number(f.cantidad) > 0);
  const grupos = [];
  for (const f of activas) {
    const clave = normal(f.proveedor) || "(sin proveedor)";
    let g = grupos.find((x) => x.clave === clave);
    if (!g) { g = { clave, n: grupos.length + 1, proveedor: String(f.proveedor || "").trim(), filas: [], despachos: [] }; grupos.push(g); }
    g.filas.push(f);
  }
  const asignados = new Set();
  for (const g of grupos) {
    for (const f of g.filas) {
      const l = base.lineas.find((x) => x.key === f.itemKey); const e = l?.envio_key && base.envios.find((x) => x.key === l.envio_key);
      if (!e || asignados.has(e.key)) continue;
      asignados.add(e.key);
      const yaRegistrado = comprado.despachos.has(e.san);
      const real = despachosReales[e.key];
      g.despachos.push({ envioKey: e.key, envioSan: e.san, proveedorCotizado: e.proveedor, original: yaRegistrado ? 0 : r0(e.monto), yaRegistrado,
        real: yaRegistrado ? 0 : real === undefined || real === "" ? r0(e.monto) : r0(real) });
    }
    const extra = r0(extras[g.clave]);
    if (extra > 0) g.despachos.push({ envioKey: null, envioSan: "extra", proveedorCotizado: "", original: 0, yaRegistrado: false, real: extra, adicional: true });
    g.costo = g.filas.reduce((s, f) => s + r0(f.unitario) * Number(f.cantidad), 0) + g.despachos.reduce((s, d) => s + d.real, 0);
  }
  return grupos;
}

// Comparación económica (montos con IVA). ventaOC = monto adjudicado con IVA; costoPrevio = compras ya registradas.
export function comparar({ base, lineas, grupos, ventaOC, costoPrevio = 0, comprado = { despachos: new Set() } }) {
  const filas = grupos.flatMap((g) => g.filas).map((f) => {
    const l = base.lineas.find((x) => x.key === f.itemKey);
    const original = l ? l.unitario * Number(f.cantidad) : 0; const real = r0(f.unitario) * Number(f.cantidad);
    return { rid: f.rid, producto: f.producto, cantidad: Number(f.cantidad), original: r0(original), real, diferencia: real - r0(original) };
  });
  const despachoOriginal = grupos.reduce((s, g) => s + g.despachos.reduce((a, d) => a + d.original, 0), 0);
  const despachoReal = grupos.reduce((s, g) => s + g.despachos.reduce((a, d) => a + d.real, 0), 0);
  const productosOriginal = filas.reduce((s, f) => s + f.original, 0), productosReal = filas.reduce((s, f) => s + f.real, 0);
  // Lo que queda pendiente DESPUÉS de esta compra, a costo cotizado (para la proyección de una compra parcial).
  const compradoAhora = {}; for (const f of grupos.flatMap((g) => g.filas)) compradoAhora[f.itemKey] = (compradoAhora[f.itemKey] || 0) + Number(f.cantidad);
  const pendientes = lineas.map((l) => ({ ...l, queda: Math.max(0, l.pendiente - (compradoAhora[l.key] || 0)) }));
  const despachosCubiertos = new Set(grupos.flatMap((g) => g.despachos.map((d) => d.envioSan)));
  const despachoPendiente = base.envios.filter((e) => !despachosCubiertos.has(e.san) && !comprado.despachos.has(e.san) && pendientes.some((l) => l.envio_key === e.key && l.queda > 0)).reduce((s, e) => s + r0(e.monto), 0);
  const costoPendiente = r0(pendientes.reduce((s, l) => s + l.unitario * l.queda, 0)) + despachoPendiente;
  const parcial = pendientes.some((l) => l.queda > 0);
  const costoOriginalTotal = r0(base.costoTotal);
  const costoActualizado = r0(costoPrevio) + productosReal + despachoReal + costoPendiente;
  return { filas, productosOriginal, productosReal, despachoOriginal, despachoReal,
    totalOriginal: productosOriginal + despachoOriginal, totalReal: productosReal + despachoReal, diferencia: productosReal + despachoReal - productosOriginal - despachoOriginal,
    utilidadOriginal: r0(ventaOC) - costoOriginalTotal, utilidadActualizada: r0(ventaOC) - costoActualizado, costoOriginalTotal, costoActualizado, costoPendiente, parcial, pendientes };
}

// Validaciones antes de registrar. Devuelve { errores: [], requiere: { vigencia, especificaciones, direccion } }.
export function validarCompra({ opcion, filas, lineas, base, confirmaciones = {} }) {
  const errores = []; const activas = filas.filter((f) => Number(f.cantidad) > 0);
  if (!activas.length) errores.push("Indica al menos un producto con cantidad a comprar.");
  for (const f of activas) {
    if (!String(f.producto || "").trim()) errores.push("Cada producto comprado debe tener nombre.");
    if (!(Number(f.unitario) > 0)) errores.push(`«${f.producto || "Producto"}»: falta el precio de compra.`);
    if (!Number.isInteger(Number(f.cantidad)) || Number(f.cantidad) < 0) errores.push(`«${f.producto || "Producto"}»: la cantidad debe ser un número entero.`);
  }
  const porItem = {}; for (const f of activas) if (f.itemKey) porItem[f.itemKey] = (porItem[f.itemKey] || 0) + Number(f.cantidad);
  for (const l of lineas) if ((porItem[l.key] || 0) > l.pendiente) errores.push(`«${l.nombre}»: se intentan comprar ${porItem[l.key]} y quedan ${l.pendiente} pendientes (no se duplican compras).`);
  const cambiaProducto = activas.some((f) => { const c = cambiosFila(f, base.lineas.find((x) => x.key === f.itemKey), base); return c.producto || c.marca || c.modelo; });
  const cambiaDireccion = activas.some((f) => cambiosFila(f, base.lineas.find((x) => x.key === f.itemKey), base).direccion);
  const requiere = { vigencia: opcion === "A", especificaciones: cambiaProducto, direccion: cambiaDireccion };
  if (requiere.vigencia && !confirmaciones.vigencia) errores.push("Confirma que los precios, la disponibilidad, las condiciones y el despacho siguen vigentes.");
  if (requiere.especificaciones && !confirmaciones.especificaciones) errores.push("Cambió el producto, la marca o el modelo: confirma que cumple las especificaciones ofertadas.");
  if (requiere.direccion && !confirmaciones.direccion) errores.push("Cambió la dirección de entrega: confirma que verificaste nuevamente el despacho.");
  return { errores: [...new Set(errores)], requiere };
}
