// ═══════════════════════════════════════════════════════════════
// «Nueva OC» con la cotización BFK (03/11/2026). Funciones puras: no leen ni escriben datos.
//
//  · Sugerencias: puntaje por señales verificables (vínculo ya registrado, código de la compra en Mercado Público, RUT,
//    monto, nombre, institución y productos). Solo SUGIEREN: nunca se vincula una cotización sin que el usuario la elija.
//  · Vínculo: se reutiliza cz_guardar_cotizacion_v2, la misma función con que el módulo Cotizaciones vincula una OC
//    (estado «adjudicada» + oc_codigo). Se reenvía EXACTAMENTE lo guardado (líneas con su identificador, cantidades,
//    precios de origen, costos, unitarios de venta, despachos, fórmula y totales): solo cambian el estado y el código de
//    la OC. No se recalcula ningún precio, por lo que el precio de venta original no puede cambiar.
//  · La compra real se registra con la lógica existente (lib/compraCotizacion.js y registrar_compra_oc).
// ═══════════════════════════════════════════════════════════════
import { normalCodigo } from "./compraCotizacion.js";

const sinTildes = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const VACIAS = new Set(["de", "del", "la", "las", "el", "los", "y", "en", "para", "por", "con", "al", "un", "una", "sus", "que", "segun", "tipo", "unidad", "unidades", "und", "otros"]);
// Palabras que casi todas las instituciones comparten: no sirven para reconocer una.
const GENERICAS_INST = new Set(["municipalidad", "ilustre", "servicio", "gobierno", "regional", "departamento", "depto", "direccion", "chile", "comuna",
  "region", "abastecimiento", "compras", "adquisiciones", "oficina", "unidad", "subdireccion", "administracion", "finanzas", "central"]);

export const palabras = (s, excluir = null) => [...new Set(sinTildes(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
  .filter((w) => w.length >= 3 && !VACIAS.has(w) && !(excluir && excluir.has(w))))];
// Coeficiente de solapamiento (comunes / menor conjunto): una descripción larga de Mercado Público contiene el nombre corto
// de la cotización. 0 a 1.
export function similitud(a, b, excluir = null) {
  const A = palabras(a, excluir), B = new Set(palabras(b, excluir));
  if (!A.length || !B.size) return 0;
  return A.filter((w) => B.has(w)).length / Math.min(A.length, B.size);
}
export const normalRut = (s) => String(s ?? "").toUpperCase().replace(/[^0-9K]/g, "").replace(/^0+/, "");

export const ESTADOS_VINCULABLES = ["presentada", "adjudicada"];
const ETIQUETA_ESTADO = { borrador: "Borrador", lista: "Lista para ofertar", presentada: "Presentada", adjudicada: "Adjudicada", no_adjudicada: "No adjudicada", descartada: "Descartada" };

// ¿Se puede vincular esta cotización a la OC? Mismas reglas que la base (cz_guardar_cotizacion_v2 y el vendedor responsable):
//  · vinculada a OTRA OC → no (solo un administrador cambia ese vínculo, en Cotizaciones);
//  · solo presentadas (pasan a adjudicada) o adjudicadas;
//  · adjudicar exige vendedor responsable.
export function elegibilidad(cot, numeroOC) {
  if (!cot) return { ok: false, motivo: "Cotización no encontrada." };
  const cod = normalCodigo(cot.oc_codigo);
  if (cod && cod !== normalCodigo(numeroOC)) return { ok: false, motivo: `Ya está vinculada a la OC ${String(cot.oc_codigo).trim()}. Solo un administrador cambia ese vínculo, en Cotizaciones.` };
  if (!ESTADOS_VINCULABLES.includes(cot.estado)) return { ok: false, motivo: `Está en estado «${ETIQUETA_ESTADO[cot.estado] || cot.estado || "sin estado"}»: solo se vinculan cotizaciones presentadas o adjudicadas. Si corresponde, cambia su estado en Cotizaciones.` };
  if (cot.estado === "presentada" && !String(cot.vendedor_id ?? "").trim()) return { ok: false, motivo: "No tiene vendedor responsable: no se puede adjudicar. Asígnalo en Cotizaciones." };
  return { ok: true, yaVinculada: !!cod, adjudicar: cot.estado !== "adjudicada" };
}

const textoItem = (it) => { const f = it?.especificaciones_aprobadas || it?.ficha || {}; return [it?.nombre ?? f.nombre, it?.marca ?? f.marca, it?.modelo ?? f.modelo].filter(Boolean).join(" "); };
const textoMP = (p) => [p?.descripcion, p?.producto, p?.especificacion_proveedor].filter(Boolean).join(" ");
// Fracción de productos de la OC que se reconocen en la cotización (por nombre, marca y modelo).
export function coberturaProductos(productosMP, items) {
  const ps = (productosMP || []).filter((p) => textoMP(p)); const its = (items || []).map(textoItem).filter(Boolean);
  if (!ps.length || !its.length) return 0;
  return ps.filter((p) => its.some((t) => similitud(t, textoMP(p)) >= 0.5)).length / ps.length;
}

// Puntaje de una cotización frente a la OC de Mercado Público. items (opcional): líneas de la cotización.
export function puntuar(ocMP, cot, items = null) {
  const motivos = []; let puntaje = 0;
  const numero = normalCodigo(ocMP?.numero_oc);
  if (numero && normalCodigo(cot?.oc_codigo) === numero) { puntaje += 200; motivos.push("Ya vinculada a esta OC en Cotizaciones"); }
  const lic = normalCodigo(ocMP?.codigo_licitacion);
  if (lic && normalCodigo(cot?.id_externo) === lic) { puntaje += 120; motivos.push("Mismo código de la compra en Mercado Público"); }
  const rO = normalRut(ocMP?.rut_cliente), rC = normalRut(cot?.rut);
  if (rO && rC && rO === rC) { puntaje += 40; motivos.push("Mismo RUT del comprador"); }
  const total = Number(ocMP?.monto_total) || 0, tc = Number(cot?.total) || 0;
  if (total > 0 && tc > 0) {
    const d = Math.abs(total - tc) / total;
    if (d <= 0.005) { puntaje += 35; motivos.push("Mismo monto total"); }
    else if (d <= 0.05) { puntaje += 15; motivos.push(`Monto similar (diferencia ${(d * 100).toFixed(1).replace(".", ",")}%)`); }
  }
  const sn = similitud(ocMP?.nombre_oc, cot?.nombre);
  if (sn >= 0.5) { puntaje += Math.round(30 * sn); motivos.push("Nombre de la compra similar"); }
  const si = Math.max(similitud(ocMP?.cliente, cot?.institucion, GENERICAS_INST), similitud(ocMP?.entidad, cot?.institucion, GENERICAS_INST));
  if (si >= 0.5) { puntaje += Math.round(20 * si); motivos.push("Misma institución"); }
  if (items && items.length) {
    const f = coberturaProductos(ocMP?.productos, items);
    if (f >= 0.5) { puntaje += Math.round(30 * f); motivos.push(`Productos coinciden (${Math.round(f * 100)}%)`); }
  }
  return { puntaje, motivos, confianza: puntaje >= 120 ? "alta" : puntaje >= 70 ? "media" : "baja" };
}

export const UMBRAL_SUGERENCIA = 40;   // p. ej. mismo RUT, o mismo monto con nombre parecido
export const UMBRAL_PRELIMINAR = 15;   // para decidir de qué cotizaciones se leen los productos
// Cotizaciones sugeridas (sin elegir ninguna): presentadas o adjudicadas, sin OC o ya vinculadas a ESTA OC.
// itemsPor: { [cotizacionId]: líneas } (las leídas). Devuelve [{ cot, puntaje, motivos, confianza, eleg }].
export function sugerirCotizaciones(ocMP, lista, itemsPor = {}, { max = 5 } = {}) {
  const numero = normalCodigo(ocMP?.numero_oc); const vistos = new Set();
  return (lista || []).filter((c) => c && !vistos.has(c.id) && vistos.add(c.id))
    .filter((c) => { const cod = normalCodigo(c.oc_codigo); return !cod || cod === numero; })
    .filter((c) => ESTADOS_VINCULABLES.includes(c.estado))
    .map((c) => ({ cot: c, ...puntuar(ocMP, c, itemsPor[c.id]), eleg: elegibilidad(c, ocMP?.numero_oc) }))
    .filter((s) => s.puntaje >= UMBRAL_SUGERENCIA)
    .sort((a, b) => b.puntaje - a.puntaje || String(b.cot.actualizado_en || "").localeCompare(String(a.cot.actualizado_en || "")))
    .slice(0, max);
}
// Cuáles leer con sus productos (las de mejor puntaje preliminar).
export const preliminares = (ocMP, lista, n = 12) => (lista || []).map((c) => ({ id: c.id, p: puntuar(ocMP, c).puntaje }))
  .filter((x) => x.p >= UMBRAL_PRELIMINAR).sort((a, b) => b.p - a.p).slice(0, n).map((x) => x.id);

// Diferencias entre la OC y la cotización que conviene revisar antes de vincular (no bloquean).
export function diferenciasOC(ocMP, cot, base = null) {
  const avisos = [];
  const rO = normalRut(ocMP?.rut_cliente), rC = normalRut(cot?.rut);
  if (rO && rC && rO !== rC) avisos.push(`El RUT del comprador de la OC (${ocMP.rut_cliente}) no coincide con el de la cotización (${cot.rut}).`);
  const total = Math.round(Number(ocMP?.monto_total) || 0), tc = Math.round(Number(cot?.total) || 0);
  if (total > 0 && tc > 0 && total !== tc) avisos.push(`El monto de la OC (${pesos(total)}) es distinto del total cotizado (${pesos(tc)}). La utilidad se calcula con el monto de la OC.`);
  if (base) {
    const qOC = (ocMP?.productos || []).reduce((s, p) => s + (Number(p.cantidad) || 0), 0), qC = base.lineas.reduce((s, l) => s + l.cantidad, 0);
    if (qOC > 0 && qC > 0 && qOC !== qC) avisos.push(`La OC pide ${qOC} unidad${qOC === 1 ? "" : "es"} en total y la cotización tiene ${qC}. Revisa las cantidades antes de comprar.`);
  }
  return avisos;
}
const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");

// Enlace de compra para cada producto VENDIDO de la OC, tomado de la línea de la cotización que le corresponde
// (por nombre; si no se reconoce y la cantidad de líneas coincide, la misma posición; si no, el primer enlace).
export function enlacesParaProductos(productosMP, lineas) {
  const conEnlace = (lineas || []).filter((l) => String(l.enlace || "").trim());
  if (!conEnlace.length) return [];
  const ps = productosMP || [];
  if (!ps.length) return [...new Set(conEnlace.map((l) => l.enlace.trim()))];
  return ps.map((p, i) => {
    let mejor = null, s0 = 0;
    for (const l of conEnlace) { const s = similitud(textoItem(l), textoMP(p)); if (s > s0) { s0 = s; mejor = l; } }
    if (mejor && s0 >= 0.34) return mejor.enlace.trim();
    if (ps.length === (lineas || []).length && String(lineas[i]?.enlace || "").trim()) return lineas[i].enlace.trim();
    return conEnlace[0].enlace.trim();
  });
}

// Parámetro de cz_guardar_cotizacion_v2 para VINCULAR: la cotización tal como está guardada (filas leídas de la base),
// con estado «adjudicada» y el código de la OC. Claves opcionales del esquema 2 (vendedor, datos de Compra Ágil) se
// omiten: la función conserva el valor guardado. La fórmula se omite si está vacía (queda vacía).
export function payloadVinculo(c, items, envios, numeroOC) {
  const p = {
    id: c.id, version: c.version, id_externo: c.id_externo ?? null, nombre: c.nombre ?? null, institucion: c.institucion ?? null, rut: c.rut ?? null,
    direccion_entrega: c.direccion_entrega ?? null, comuna: c.comuna ?? null, fecha: c.fecha ?? null, plazo: c.plazo ?? null, observaciones: c.observaciones ?? null,
    estado: "adjudicada", recargo: c.recargo, subtotal_neto: c.subtotal_neto, impuestos: c.impuestos, total: c.total, costo_neto: c.costo_neto, iva_credito: c.iva_credito,
    oc_codigo: String(numeroOC || "").trim(),
    envios: (envios || []).map((e) => ({ key: e.clave, proveedor: e.proveedor ?? null, origen_publicacion: e.origen_publicacion ?? null, destino: e.destino ?? null, monto: e.monto,
      con_factura: e.con_factura, cobertura: e.cobertura ?? null, fecha_cotizacion: e.fecha_cotizacion ?? null, estado: e.estado_confirmacion, evidencia: e.evidencia ?? null })),
    items: [...(items || [])].sort((a, b) => Number(a.orden) - Number(b.orden)).map((it) => ({ key: it.id, producto_id: it.producto_id ?? null, envio_key: it.envio_clave ?? null,
      enlace: it.enlace ?? null, enlace_original: it.enlace_original ?? null, proveedor: it.proveedor ?? null, disponibilidad: it.disponibilidad ?? null,
      fecha_consulta: it.fecha_consulta ?? null, origen_datos: it.origen_datos ?? null, cantidad: it.cantidad, precio_origen: it.precio_origen,
      precio_incluye_iva: it.precio_incluye_iva, con_factura: it.con_factura, iva_compra: it.iva_compra, envio_asignado: it.envio_asignado,
      costo_bruto: it.costo_bruto, costo_neto: it.costo_neto, recargo: it.recargo ?? null, unitario_venta_neto: it.unitario_venta_neto,
      ficha: it.especificaciones_aprobadas ?? {}, ficha_aprobada: it.ficha_aprobada })),
  };
  if (c.formula !== null && c.formula !== undefined) p.formula = c.formula;
  return p;
}
