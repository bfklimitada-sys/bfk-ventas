// ═══════════════════════════════════════════════════════════════════════════════════════════════
// Cotización privada con la misma experiencia que la cotización de Mercado Público (08/11/2026).
// Funciones puras: convierten entre las filas de la base (vp_cotizacion_items + vp_cotizacion_item_costos) y el ítem
// del editor, que es el MISMO modelo de ítem de Mercado Público (ficha técnica + datos internos de compra y despacho)
// más los campos propios de la venta privada (tipo, unidad, código, precio unitario de venta y descuento).
//
// Cálculo (explícito; las diferencias con Mercado Público están señaladas):
//   · Costo de adquisición: IGUAL que Mercado Público (lib/cotizaciones.js): precio de compra con o sin IVA, compra con o
//     sin factura, despacho propio o compartido prorrateado por valor. El IVA de compras con factura es crédito fiscal
//     (costo real = costo neto); en una cotización EXENTA no se recupera (costo real = costo bruto), como en una
//     cotización de Mercado Público exenta.
//   · Costo unitario interno = costo real ÷ cantidad (2 decimales). Es el «costo_unitario» que ya usan los márgenes de
//     ventas privadas (vp_margen_revisiones): la fórmula de margen no cambia.
//   · Precio: DIFERENCIA con Mercado Público. En ventas privadas el precio unitario de venta lo fija el vendedor y la base
//     calcula la línea como siempre: neto = round(cantidad × precio × (100 − descuento %) / 100), IVA 19 % si es afecta.
//     El «recargo sobre costo» es solo una ayuda que, al usarse, escribe el precio unitario = costo unitario × (1 + recargo)
//     redondeado hacia arriba (mismo redondeo que Mercado Público). Nunca se recalcula solo ni cambia documentos guardados.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { IVA, ESTADOS_ENVIO, repartirEnvios, precioBrutoUnit, envioConfirmado, mismoDestino, fichaPublica, nuevaClave, itemVacio, envioVacio } from "./cotizaciones.js";
import { calcularLinea, calcularTotales, redondear, aNumero, TASA_IVA } from "./ventasPrivadas.js";

const num = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) ? n : 0; };
const txt = (v) => String(v ?? "").trim();
const vacio = (v) => v === "" || v == null;
const EPS = 1e-9;
const plano = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const TIPOS_ITEM = [{ v: "producto", l: "Producto" }, { v: "servicio", l: "Servicio" }];

// Ítem nuevo: el de Mercado Público + campos de la venta privada.
export const itemVacioVP = (extra = {}) => ({ ...itemVacio(), tipo: "producto", unidad: "UN", codigo: "", precio_unitario: "", descuento_pct: 0, costo_nota: "", ...extra });

// Texto de la línea (lista, PDF comercial, venta, entregas y facturas): nombre de la ficha + marca y modelo si no están en el nombre.
export function descripcionDeFicha(ficha) {
  const f = ficha || {}; const nombre = txt(f.nombre);
  const extra = [txt(f.marca), txt(f.modelo)].filter((x) => x && !plano(nombre).includes(plano(x)));
  return `${nombre}${extra.length ? ` · ${extra.join(" ")}` : ""}`.slice(0, 2000);
}

// ── Base → editor ─────────────────────────────────────────────────────────────────────────────
// linea: fila de vp_cotizacion_items; costo: fila de vp_cotizacion_item_costos (o undefined si no hay o no se puede ver).
// Líneas anteriores a esta versión (sin ficha): la ficha parte del texto de la línea. Si solo tenían costo unitario
// (sin precio de compra), ese costo se conserva tal cual como precio de compra neto con factura (mismo costo unitario).
export function itemDesdeLinea(linea, costo) {
  const f = linea.ficha && typeof linea.ficha === "object" ? linea.ficha : null;
  const ficha = { nombre: f ? txt(f.nombre) : txt(linea.descripcion), marca: txt(f?.marca), modelo: txt(f?.modelo), color: txt(f?.color),
    generales: Array.isArray(f?.generales) ? f.generales.map((p) => ({ etiqueta: txt(p.etiqueta), valor: txt(p.valor) })) : [],
    especificaciones: Array.isArray(f?.especificaciones) ? f.especificaciones.map((p) => ({ etiqueta: txt(p.etiqueta), valor: txt(p.valor) })) : [],
    descripcion: txt(f?.descripcion), imagenes: Array.isArray(f?.imagenes) ? f.imagenes.filter((x) => typeof x === "string").slice(0, 4) : [] };
  const k = costo || null;
  const heredado = !!k && k.precio_compra == null && k.costo_unitario != null;
  const desp = k?.despacho && typeof k.despacho === "object" ? k.despacho : null;
  return {
    key: linea.id || nuevaClave("i"), id: linea.id || null, producto_id: linea.producto_id || null, ficha, ficha_aprobada: !!linea.ficha_aprobada,
    tipo: linea.tipo === "servicio" ? "servicio" : "producto", unidad: txt(linea.unidad) || "UN", codigo: txt(linea.codigo),
    cantidad: Number(linea.cantidad), precio_unitario: linea.precio_unitario == null ? "" : Number(linea.precio_unitario), descuento_pct: Number(linea.descuento_pct || 0),
    enlace: txt(k?.enlace), enlace_original: txt(k?.enlace_original), proveedor: txt(k?.proveedor),
    precio_origen: k?.precio_compra != null ? Number(k.precio_compra) : heredado ? Number(k.costo_unitario) : "",
    precio_incluye_iva: heredado ? false : k?.precio_incluye_iva !== false, con_factura: heredado ? true : k?.con_factura !== false,
    envio_key: desp?.key || null, costo_nota: txt(k?.nota), costo_heredado: heredado,
    recargo: null, disponibilidad: "", fecha_consulta: null, origen_datos: f ? "ficha" : "linea", _despacho: desp,
  };
}
// Despachos (propios o compartidos) reconstruidos desde los ítems: cada costo guarda su despacho con la misma clave.
export function enviosDesdeItems(items) {
  const out = new Map();
  for (const it of items || []) {
    const d = it._despacho; if (!d?.key || out.has(d.key)) continue;
    out.set(d.key, { ...envioVacio(d.proveedor || it.proveedor), key: d.key, proveedor: txt(d.proveedor), monto: d.monto == null ? "" : Number(d.monto), con_factura: d.con_factura !== false,
      estado: ESTADOS_ENVIO[d.estado] ? d.estado : "pendiente", destino: txt(d.destino), evidencia: txt(d.evidencia), fecha_cotizacion: d.fecha_cotizacion || null });
  }
  return [...out.values()];
}
// Cotización completa para el editor desde leerCotizacion() (revisión indicada).
export function cotizacionParaEditor(datos, revisionId) {
  const rev = datos.revisiones.find((r) => r.id === revisionId) || {};
  const costos = new Map((datos.costos || []).map((k) => [k.item_id, k]));
  const items = (datos.items || []).filter((i) => i.revision_id === revisionId).sort((a, b) => a.orden - b.orden).map((l) => itemDesdeLinea(l, costos.get(l.id)));
  const envios = enviosDesdeItems(items);
  for (const it of items) delete it._despacho;
  return { rev, items, envios };
}

// ── Cálculo ───────────────────────────────────────────────────────────────────────────────────
// cot: { items, envios, afecta_iva, direccion_entrega }. Devuelve líneas con costo (como Mercado Público) y venta (como siempre en VP).
export function calcularCotizacionVP(cot) {
  const items = cot?.items || []; const envios = cot?.envios || []; const exenta = cot?.afecta_iva === false;
  const asignado = repartirEnvios(items, envios);
  const destino = txt(cot?.direccion_entrega); const pendientes = [];
  const lineas = items.map((it, idx) => {
    const n = idx + 1; const q = num(it.cantidad); const servicio = it.tipo === "servicio";
    const env = envios.find((e) => e.key === it.envio_key) || null;
    const conPrecio = !vacio(it.precio_origen) && num(it.precio_origen) >= 0;
    const prodBruto = q * precioBrutoUnit(it);
    const prodNeto = it.con_factura === false ? prodBruto : prodBruto / (1 + IVA);
    const envBruto = env ? num(asignado[it.key]) : 0;
    const envNeto = env && env.con_factura === false ? envBruto : envBruto / (1 + IVA);
    const costoBruto = prodBruto + envBruto; const costoNeto = prodNeto + envNeto;
    const costoReal = exenta ? costoBruto : costoNeto;
    // Costo unitario interno (2 decimales): solo con precio de compra informado (si no, la línea queda «sin costo»).
    const costoUnit = conPrecio && q > 0 ? Math.round((costoReal / q) * 100) / 100 : null;
    const venta = calcularLinea({ cantidad: q, precio_unitario: it.precio_unitario, descuento_pct: it.descuento_pct, costo_unitario: costoUnit });
    const precio = vacio(it.precio_unitario) ? null : num(it.precio_unitario);
    const recargo = costoUnit > 0 && precio != null ? precio / costoUnit - 1 : null;
    const avisos = [];
    if (q <= 0) avisos.push(`Ítem ${n}: falta la cantidad.`);
    if (!conPrecio) avisos.push(`Ítem ${n}: falta el precio de compra (el margen no se puede calcular).`);
    if (!servicio) {
      if (!env) avisos.push(`Ítem ${n}: sin despacho registrado. Nunca se asume despacho gratis: verifícalo a la dirección del cliente.`);
      else if (!envioConfirmado(env)) avisos.push(`Ítem ${n}: el despacho de ${env.proveedor || "proveedor"} está ${ESTADOS_ENVIO[env.estado]?.label.toLowerCase() || "por verificar"}.`);
      else if (!destino) avisos.push(`Ítem ${n}: falta la dirección de entrega del cliente; el despacho de ${env.proveedor || "proveedor"} no puede darse por verificado.`);
      else if (!mismoDestino(env.destino, destino)) avisos.push(`Ítem ${n}: el despacho de ${env.proveedor || "proveedor"} se verificó para ${env.destino ? `"${env.destino}"` : "otra dirección"}, no para "${destino}". Vuelve a verificarlo.`);
      else if (!txt(env.evidencia)) avisos.push(`Ítem ${n}: registra cómo se verificó el despacho de ${env.proveedor || "proveedor"}.`);
    }
    if (precio == null) avisos.push(`Ítem ${n}: falta el precio unitario de venta.`);
    else if (costoUnit != null && venta.neto < venta.costo) avisos.push(`Ítem ${n}: el precio de venta (con descuento) queda bajo el costo.`);
    pendientes.push(...avisos);
    return { key: it.key, cantidad: q, costo_producto_bruto: prodBruto, envio_asignado: envBruto, costo_bruto: costoBruto, costo_neto: costoNeto, costo_real: costoReal,
      iva_credito: exenta ? 0 : costoBruto - costoNeto, iva_no_recuperable: exenta ? costoBruto - costoNeto : 0,
      costo_unitario: costoUnit, precio_unitario: precio, recargo, ...venta, avisos };
  });
  const tot = calcularTotales(items.map((it, i) => ({ cantidad: it.cantidad, precio_unitario: it.precio_unitario, descuento_pct: it.descuento_pct, costo_unitario: lineas[i].costo_unitario })),
    { afecta_iva: !exenta, tasa_iva: TASA_IVA });
  const s = (k) => lineas.reduce((a, l) => a + l[k], 0);
  for (const e of envios.filter((e) => !items.some((it) => it.envio_key === e.key) && num(e.monto) > 0)) pendientes.push(`El despacho de ${e.proveedor || "proveedor"} no está asignado a ningún ítem.`);
  if (!items.length) pendientes.push("La cotización no tiene ítems.");
  return { lineas, exenta, pendientes, listo: pendientes.length === 0,
    totales: { ...tot, costo_bruto: s("costo_bruto"), costo_neto: s("costo_neto"), envios: s("envio_asignado"), iva_credito: s("iva_credito"), iva_no_recuperable: s("iva_no_recuperable") } };
}

// Ayuda «recargo sobre costo»: precio unitario = costo unitario × (1 + recargo), redondeado hacia arriba (como Mercado Público).
export const precioConRecargo = (costoUnit, recargo) => (costoUnit > 0 && Number.isFinite(Number(recargo)) ? Math.max(0, Math.ceil(costoUnit * (1 + Number(recargo)) - EPS)) : null);

// ── Editor → base ─────────────────────────────────────────────────────────────────────────────
// imagenes: rutas ya subidas al depósito (cz-productos) para la ficha. conCostos: quien guarda puede ver los datos internos.
export function lineaParaGuardarVP(it, linea, { imagenes, envio, conCostos }) {
  const ficha = { ...fichaPublica(it.ficha), imagenes: (imagenes || []).filter((x) => typeof x === "string" && x && !x.startsWith("data:")).slice(0, 4) };
  const base = { tipo: it.tipo === "servicio" ? "servicio" : "producto", producto_id: it.producto_id || null, codigo: txt(it.codigo) || null,
    descripcion: descripcionDeFicha(ficha), unidad: txt(it.unidad) || "UN", cantidad: aNumero(it.cantidad), precio_unitario: aNumero(it.precio_unitario),
    descuento_pct: aNumero(it.descuento_pct) ?? 0, ficha, ficha_aprobada: !!it.ficha_aprobada };
  if (!conCostos) return base;
  const despacho = envio ? { key: envio.key, proveedor: txt(envio.proveedor) || null, monto: vacio(envio.monto) ? null : Math.round(num(envio.monto)), con_factura: envio.con_factura !== false,
    estado: envio.estado || "pendiente", destino: txt(envio.destino) || null, evidencia: txt(envio.evidencia) || null, fecha_cotizacion: envio.fecha_cotizacion || null } : null;
  return { ...base, costo_unitario: linea?.costo_unitario ?? null, costo_nota: txt(it.costo_nota) || null, proveedor: txt(it.proveedor) || null, enlace: txt(it.enlace) || null,
    enlace_original: txt(it.enlace_original) || null, precio_compra: vacio(it.precio_origen) ? null : num(it.precio_origen),
    precio_incluye_iva: it.precio_incluye_iva !== false, con_factura: it.con_factura !== false, despacho };
}
export function validarItemsVP(items) {
  const errores = [];
  if (!items?.length) errores.push("Agrega al menos un ítem.");
  (items || []).forEach((it, i) => {
    const n = i + 1; const c = aNumero(it.cantidad), pr = aNumero(it.precio_unitario), d = aNumero(it.descuento_pct) ?? 0, co = aNumero(it.precio_origen);
    if (!txt(it.ficha?.nombre)) errores.push(`Ítem ${n}: falta el nombre.`);
    if (!(c > 0)) errores.push(`Ítem ${n}: la cantidad debe ser mayor que cero.`);
    if (pr == null || !(pr >= 0)) errores.push(`Ítem ${n}: falta el precio unitario de venta (pestaña Precios).`);
    if (!(d >= 0 && d <= 100)) errores.push(`Ítem ${n}: el descuento debe estar entre 0 y 100 %.`);
    if (co != null && !(co >= 0)) errores.push(`Ítem ${n}: precio de compra inválido.`);
  });
  return errores;
}

// ── EETT: la ficha técnica del ítem alimenta la EETT privada (sin volver a escribirla): ver lib/vpEETT.js (normalizarFichaEETT, contenidoEETTVP).
export { caracteristicasDeFicha } from "./ventasPrivadas.js";
