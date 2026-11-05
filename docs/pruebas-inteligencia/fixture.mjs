// Datos FICTICIOS de prueba de Inteligencia Comercial (04/11/2026). No contienen datos reales de BFK ni de producción.
// Se usan en las pruebas SQL (validar_sql.sh), en las unitarias y en la de interfaz (e2e_inteligencia.mjs).
// Cada cotización define su estado final, su fecha de presentación y la respuesta SIMULADA de ChileCompra
// (listado y, si corresponde, detalle) con la misma forma que la API oficial de Compra Ágil v2.
export const RUT_BFK = "77.322.317-3";
export const VENDEDORES = [{ id: "v1", nombre: "Vendedor Uno" }, { id: "v2", nombre: "Vendedora Dos" }];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sur = { rut: "76.111.111-1", nombre: "Comercial Sur SpA" }, norte = { rut: "77.888.999-K", nombre: "Distribuidora Norte Ltda" };
const q = (prov, neto, imp, desp = 0, sel = 0, extra = {}) => ({ id_cotizacion: Math.floor(neto / 7), rut_proveedor: prov.rut, razon_social: prov.nombre, valor_neto: neto, total_impuesto: imp,
  porcentaje_impuesto: imp > 0 ? 19 : 0, nombre_impuesto: imp > 0 ? "IVA" : "Exento", monto_despacho: desp, monto_total: neto + imp + desp, proveedor_seleccionado: sel, estado: 1, ...extra });
const bfk = (neto, imp, sel = 0) => q({ rut: RUT_BFK, nombre: "INGENIERIA Y SERVICIOS BFK LIMITADA" }, neto, imp, 0, sel);
// id_estado como los entrega la API real (observado el 05/11/2026): 2 publicada · 3 cerrada · 4 proveedor seleccionado ·
// 5 cancelada (CANCELADA_ID) · 6 desierta.
import { CANCELADA_ID } from "../../src/lib/inteligenciaComercial.js";
const est = { publicada: [2, "publicada", "Publicada"], cerrada: [3, "cerrada", "Cerrada"], proveedor_seleccionado: [4, "proveedor_seleccionado", "Proveedor seleccionado"], desierta: [6, "desierta", "Desierta"], cancelada: [CANCELADA_ID, "cancelada", "Cancelada"] };
// fuc: fecha_ultimo_cambio (fecha del resultado). Varía por proceso para probar el criterio «fecha de adjudicación»
// (adjudicadas en otro mes que el de presentación, horas cercanas a medianoche y un valor sin zona horaria).
const item = (codigo, e, extra = {}) => ({ codigo, nombre: "Compra ficticia " + codigo, estado: { id_estado: est[e][0], codigo: est[e][1], glosa: est[e][2] },
  fechas: { fecha_publicacion: "2026-10-01T10:00:00", fecha_cierre: "2026-10-04T15:00:00", fecha_ultimo_cambio: extra.fuc || "2026-10-20T11:30:00Z", ...(e === "cancelada" ? { fecha_cancelacion: "2026-10-19T09:00:00Z" } : {}) },
  montos: { moneda: "CLP", monto_disponible: 500000, monto_disponible_clp: 500000 }, institucion: { organismo_comprador: "Organismo ficticio", rut: "61.000.000-0" },
  resumen: { total_ofertas_recibidas: extra.ofertas ?? 3 }, motivos: { motivo_cancelacion: e === "cancelada" ? "Falta de presupuesto (ficticio)" : null, motivo_desierta: e === "desierta" ? "Ofertas fuera de presupuesto (ficticio)" : null, motivo_seleccion: e === "proveedor_seleccionado" ? "Menor precio (ficticio)" : null } });
const detalle = (codigo, e, cotizaciones, extra = {}) => ({ ...item(codigo, e, extra), presupuesto: { moneda: "CLP", presupuesto_estimado: 400000 }, proveedores_cotizando: cotizaciones, id_orden_compra: extra.oc ?? null });

// n, código, estado de la cotización, vendedor, institución, neto, IVA, fecha de presentación (Chile), API.
// api: { e: estado del listado, det: arreglo de cotizaciones del detalle | "falla" (504) | undefined (no se pide) }
export const COTIZACIONES = [
  { n: 1, codigo: "1001-1-COT26", estado: "adjudicada", v: "v1", inst: "Municipalidad de Laja", neto: 100000, iva: 19000, fp: "2026-10-03", api: { e: "proveedor_seleccionado", fuc: "2026-10-06T14:00:00Z", det: [bfk(100000, 19000, 1), q(sur, 105000, 19950)] } },
  { n: 2, codigo: "1001-2-COT26", estado: "presentada", v: "v2", inst: "Hospital de Los Ángeles", neto: 200000, iva: 38000, fp: "2026-10-05", items: 3, api: { e: "proveedor_seleccionado", fuc: "2026-11-02T13:00:00Z", det: [bfk(200000, 38000), q(sur, 180000, 34200, 0, 1)] } },
  { n: 3, codigo: "1001-3-COT26", estado: "presentada", v: "v1", inst: "Liceo Bicentenario Laja", neto: 50000, iva: 9500, fp: "2026-10-10", api: { e: "publicada" } },
  { n: 4, codigo: "1001-4-COT26", estado: "presentada", v: "v1", inst: "Municipalidad de Laja", neto: 80000, iva: 15200, fp: "2026-10-12", api: { e: "cerrada" } },
  { n: 5, codigo: "1001-5-COT26", estado: "presentada", v: "v2", inst: "Hospital de Los Ángeles", neto: 70000, iva: 13300, fp: "2026-10-15", api: { e: "desierta", fuc: "2026-10-28T12:00:00Z" } },
  { n: 6, codigo: "1001-6-COT26", estado: "presentada", v: "v2", inst: "Servicio de Salud Biobío", neto: 40000, iva: 7600, fp: "2026-10-16", api: { e: "cancelada" } },
  { n: 7, codigo: "1001-7-COT26", estado: "presentada", v: "v1", inst: "Escuela Rural El Peral", neto: 60000, iva: 0, fp: "2026-10-20", api: { e: "proveedor_seleccionado", fuc: "2026-10-31T23:30:00Z", det: [bfk(60000, 0), q(norte, 50000, 9500, 0, 1)] } },
  { n: 8, codigo: "1001-8-COT26", estado: "presentada", v: "v2", inst: "Municipalidad de Laja", neto: 90000, iva: 17100, fp: "2026-10-22", api: { e: "proveedor_seleccionado", det: "falla" } },
  { n: 9, codigo: "1001-9-COT26", estado: "no_adjudicada", v: "v1", inst: "Hospital de Los Ángeles", neto: 100000, iva: 19000, fp: "2026-10-25", api: { e: "proveedor_seleccionado", fuc: "2026-11-01T02:00:00Z", det: [bfk(100000, 19000), q(sur, 90000, 17100, 0, 1)] } },
  { n: 10, codigo: "1001-10-COT26", estado: "presentada", v: "v1", inst: "Liceo Bicentenario Laja", neto: 30000, iva: 5700, fp: "2026-11-02", api: { e: "proveedor_seleccionado", fuc: "2026-11-04T15:00:00", det: [bfk(30000, 5700, 1), q(norte, 31000, 5890)] } },
  { n: 11, codigo: "1001-11-COT26", estado: "presentada", v: "v2", inst: "Servicio de Salud Biobío", neto: 45000, iva: 8550, fp: "2026-11-03", api: { e: "proveedor_seleccionado", fuc: "2026-11-04T16:00:00Z", det: [q(sur, 40000, 7600, 0, 1), q(norte, 44000, 8360)] } },
  { n: 12, codigo: "1001-12-COT26", estado: "presentada", v: "v1", inst: "Municipalidad de Laja", neto: 55000, iva: 10450, fp: "2026-10-08", actualizado: "2026-10-09T10:00:00Z" },
  { n: 13, codigo: "1001-12-COT26", estado: "adjudicada", v: "v1", inst: "Municipalidad de Laja", neto: 56000, iva: 10640, fp: "2026-10-09", actualizado: "2026-10-11T10:00:00Z", api: { e: "proveedor_seleccionado", fuc: "2026-10-12T12:00:00Z" } },
  { n: 14, codigo: null, estado: "presentada", v: "v2", inst: "Junta de Vecinos Ficticia", neto: 25000, iva: 4750, fp: "2026-10-28" },
  { n: 15, codigo: "1234-56-LE26", estado: "presentada", v: "v1", inst: "Gobierno Regional Ficticio", neto: 900000, iva: 171000, fp: "2026-10-29" },
  { n: 16, codigo: "1001-13-COT26", estado: "borrador", v: "v1", inst: "Municipalidad de Laja", neto: 10000, iva: 1900, fp: null },
  { n: 17, codigo: "1001-16-COT26", estado: "descartada", v: "v2", inst: "Municipalidad de Laja", neto: 10000, iva: 1900, fp: null },
  { n: 18, codigo: "1001-14-COT26", estado: "adjudicada", v: "v2", inst: "Hospital de Los Ángeles", neto: 120000, iva: 22800, fp: "2026-10-18", api: { e: "proveedor_seleccionado", fuc: "2026-10-21T12:00:00Z", det: [bfk(120000, 22800), q(norte, 110000, 20900, 0, 1)] } },
  { n: 19, codigo: "1001-15-COT26", estado: "presentada", v: "v1", inst: "Municipalidad de Laja", neto: 300000, iva: 57000, fp: "2026-10-30", items: 4, api: { e: "proveedor_seleccionado", fuc: "2026-11-03T12:00:00Z", det: [bfk(300000, 57000), q(norte, 252100, 47899, 1, 1)] } },
  { n: 20, codigo: "1001-17-COT26", estado: "presentada", v: "v2", inst: "Liceo Bicentenario Laja", neto: 20000, iva: 3800, fp: null, fecha: "2026-10-31" },  // sin historial de versiones
  { n: 21, codigo: "1001-18-COT26", estado: "lista", v: "v2", inst: "Liceo Bicentenario Laja", neto: 20000, iva: 3800, fp: null },
].map((c) => ({ ...c, id: id(c.n) }));

// Respuestas simuladas de ChileCompra por código: { listado: item, detalle: objeto | null, detalleFalla: bool }.
export function respuestasMP() {
  const r = {};
  for (const c of COTIZACIONES) if (c.api && c.codigo) {
    r[c.codigo] = { listado: item(c.codigo, c.api.e, c.api), detalle: Array.isArray(c.api.det) ? detalle(c.codigo, c.api.e, c.api.det, c.api) : null, detalleFalla: c.api.det === "falla" };
  }
  return r;
}
export const vendedorNombre = (v) => VENDEDORES.find((x) => x.id === v)?.nombre || null;
// Fila de la tabla cotizaciones (como la guarda la base).
export function filaCotizacion(c) {
  return { id: c.id, id_externo: c.codigo, nombre: "Compra ficticia " + (c.codigo || c.n), institucion: c.inst, rut: "61.000.000-0", fecha: c.fecha || (c.fp || "2026-10-01"), estado: c.estado,
    subtotal_neto: c.neto, impuestos: c.iva, total: c.neto + c.iva, oc_codigo: c.estado === "adjudicada" ? `OC-FICT-${c.n}` : null, vendedor_id: c.v, vendedor_nombre: vendedorNombre(c.v),
    actualizado_en: c.actualizado || `${c.fp || "2026-10-01"}T18:00:00Z`, version: 2 };
}
// Versiones: borrador (día anterior) y la primera presentada al mediodía de Chile (15:00 UTC en octubre/noviembre, UTC−3).
export function versionesDe(c) {
  if (!c.fp) return [];
  const dAnt = new Date(Date.parse(c.fp + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
  const v = [{ cotizacion_id: c.id, version: 1, estado: "borrador", guardado_en: `${dAnt}T15:00:00Z` }, { cotizacion_id: c.id, version: 2, estado: "presentada", guardado_en: `${c.fp}T15:00:00Z` }];
  if (c.estado !== "presentada") v.push({ cotizacion_id: c.id, version: 3, estado: c.estado, guardado_en: `${c.fp}T20:00:00Z` });
  return v;
}
