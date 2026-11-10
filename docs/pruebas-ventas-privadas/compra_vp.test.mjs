// Compra de Ventas privadas desde la cotización aprobada (10/11/2026): cálculo puro (sin base ni navegador).
// IVA de la compra (factura / boleta / venta exenta), despacho una vez por pedido, compra parcial y filas para la base.
import assert from "node:assert/strict";
import { baseVenta, compradoEnVenta, estadoLineas, filasIniciales, armarPedidos, compararVP, filasParaGuardar, costoReal, validarCompraVP } from "../../src/lib/compraVentaPrivada.js";

let n = 0; const t = (nombre, f) => { f(); n++; console.log("OK   ", nombre); };
const venta = (extra = {}) => ({ id: "v1", neto: 159980, afecta_iva: true, direccion_entrega: "Av. Prat 100, Laja", cotizacion_folio: "CP-2026-0009", ...extra });
const d = ({ conFactura = true, despFactura = true, incluyeIva = true, compras = [] } = {}) => ({
  items: [{ id: "it-1", orden: 1, descripcion: "Taladro", unidad: "UN", cantidad: 2, ficha: { nombre: "Taladro", marca: "Bosch", modelo: "GSB" } },
          { id: "it-2", orden: 2, descripcion: "Brocas", unidad: "UN", cantidad: 3, ficha: { nombre: "Brocas" } }],
  costos: [{ item_id: "it-1", costo_unitario_estimado: 50000, proveedor: "Ferretería Sur", enlace: "https://a", precio_compra: incluyeIva ? 59990 : 50412, precio_incluye_iva: incluyeIva, con_factura: conFactura,
             despacho: { key: "e1", proveedor: "Ferretería Sur", monto: 5990, con_factura: despFactura } },
           { item_id: "it-2", costo_unitario_estimado: 2000, proveedor: "Ferretería Sur", enlace: "https://b", precio_compra: 2380, precio_incluye_iva: true, con_factura: conFactura,
             despacho: { key: "e1", proveedor: "Ferretería Sur", monto: 5990, con_factura: despFactura } }],
  compras, margen: { costo_estimado: 106000, costo_real: 0 } });
const calcular = (v, dd, mod = (fs) => fs, docs = {}) => {
  const base = baseVenta(v, dd); const comprado = compradoEnVenta(dd); const lineas = estadoLineas(base, comprado);
  const filas = mod(filasIniciales(base, lineas)); const grupos = armarPedidos({ filas, base, comprado });
  return { base, lineas, filas, grupos, comp: compararVP({ base, lineas, grupos, ventaNeta: v.neto, costoEstimado: dd.margen.costo_estimado, costoPrevio: dd.margen.costo_real, comprado, docs }) };
};

t("precarga: precio con IVA (o + 19 % si se cotizó sin IVA), proveedor, enlace, cantidad pendiente", () => {
  const { filas, base } = calcular(venta(), d());
  assert.deepEqual(filas.map((f) => [f.producto, f.cantidad, f.unitario, f.proveedor, f.enlace]), [["Taladro", 2, 59990, "Ferretería Sur", "https://a"], ["Brocas", 3, 2380, "Ferretería Sur", "https://b"]]);
  assert.equal(baseVenta(venta(), d({ incluyeIva: false })).lineas[0].unitario, 50412 * 1.19);
  assert.equal(base.envios.length, 1);
});
t("despacho compartido por dos líneas del mismo proveedor: una sola vez en el pedido", () => {
  const { grupos, comp } = calcular(venta(), d());
  assert.equal(grupos.length, 1); assert.equal(grupos[0].despachos.length, 1);
  assert.equal(comp.totalReal, 2 * 59990 + 3 * 2380 + 5990);
});
t("factura: costo = neto (IVA crédito fiscal), redondeado por fila como la base", () => {
  const { comp } = calcular(venta(), d());
  assert.equal(comp.costoCompra, Math.round(119980 / 1.19) + Math.round(7140 / 1.19) + Math.round(5990 / 1.19));
  assert.equal(comp.utilidadActualizada, 159980 - comp.costoCompra); assert.equal(comp.utilidadOriginal, 159980 - 106000);
});
t("boleta (sin factura): el IVA es costo (costo = total pagado)", () => {
  const { comp } = calcular(venta(), d({ conFactura: false, despFactura: false }));
  assert.equal(comp.costoCompra, 119980 + 7140 + 5990);
});
t("venta exenta: aun con factura, el IVA no se recupera (costo = total)", () => {
  const { comp } = calcular(venta({ afecta_iva: false }), d());
  assert.equal(comp.costoCompra, 119980 + 7140 + 5990);
});
t("opción B: el documento elegido para el pedido manda (boleta)", () => {
  const { comp, grupos } = calcular(venta(), d(), (fs) => fs, {}); const clave = grupos[0].clave;
  const b = calcular(venta(), d(), (fs) => fs, { [clave]: "boleta" });
  assert.equal(b.comp.costoCompra, 119980 + 7140 + 5990); assert.ok(comp.costoCompra < b.comp.costoCompra);
});
t("precio menor al cotizado: total a pagar y utilidad suben", () => {
  const { comp } = calcular(venta(), d(), (fs) => fs.map((f) => (f.producto === "Taladro" ? { ...f, unitario: 49990 } : f)));
  assert.equal(comp.diferencia, -20000); assert.ok(comp.utilidadActualizada > comp.utilidadOriginal);
});
t("compra parcial: lo comprado y lo pendiente; lo pendiente a costo cotizado en la proyección", () => {
  const { comp } = calcular(venta(), d(), (fs) => fs.map((f) => (f.producto === "Taladro" ? { ...f, cantidad: 1 } : f)));
  assert.equal(comp.parcial, true);
  assert.deepEqual(comp.pendientes.map((l) => [l.nombre, l.ahora, l.queda]), [["Taladro", 1, 1], ["Brocas", 3, 0]]);
  assert.equal(comp.costoPendiente, costoReal(59990, true, false));
});
t("lo ya comprado (vigente) descuenta pendientes y el despacho registrado no se repite", () => {
  const compras = [{ estado: "vigente", concepto: "producto", venta_item_id: "it-1", cantidad: 1, pedido: "P1-1" }, { estado: "vigente", concepto: "despacho", envio_clave: "e1", pedido: "P1-1" },
                   { estado: "anulada", concepto: "producto", venta_item_id: "it-2", cantidad: 3, pedido: "P0-1" }, { estado: "vigente", concepto: null, neto: 1000 }];
  const { lineas, grupos } = calcular(venta(), d({ compras }));
  assert.deepEqual(lineas.map((l) => [l.comprada, l.pendiente]), [[1, 1], [0, 3]]);
  assert.equal(grupos[0].despachos[0].yaRegistrado, true); assert.equal(grupos[0].costo, 59990 + 3 * 2380);
});
t("filas para la base: una por producto y una por despacho, misma clave en un reintento", () => {
  const { grupos, base } = calcular(venta(), d());
  const a = filasParaGuardar({ grupos, base, pedido: "PX1" }); const b = filasParaGuardar({ grupos, base, pedido: "PX1" });
  assert.deepEqual(a.map((f) => f.clave), b.map((f) => f.clave));
  assert.deepEqual(a.map((f) => [f.concepto, f.cantidad ?? null, f.precio_unitario ?? f.monto, f.documento_tipo]), [["producto", 2, 59990, "factura"], ["producto", 3, 2380, "factura"], ["despacho", null, 5990, "factura"]]);
  assert.equal(new Set(a.map((f) => f.pedido)).size, 1);
});
t("validación: no más de lo pendiente; decimales permitidos (hasta 2)", () => {
  const { base, lineas, filas } = calcular(venta(), d());
  assert.match(validarCompraVP({ opcion: "B", filas: filas.map((f) => ({ ...f, cantidad: 9 })), lineas, base }).errores.join(" "), /quedan 2 pendientes/);
  assert.equal(validarCompraVP({ opcion: "B", filas: filas.map((f) => ({ ...f, cantidad: 1.5 })), lineas, base }).errores.length, 0);
  assert.match(validarCompraVP({ opcion: "B", filas: filas.map((f) => ({ ...f, cantidad: 1.555 })), lineas, base }).errores.join(" "), /2 decimales/);
});
console.log(`RESUMEN compra_vp: ${n} OK, 0 fallas`);
