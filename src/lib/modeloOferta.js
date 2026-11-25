// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Modelo PÚBLICO de los documentos de la oferta (25/11/2026). Es la ÚNICA entrada de lib/documentosOferta.js.
// Lista blanca: identificación, cliente, productos (nombre, marca, modelo, cantidad, ficha técnica, fotos),
// precios de VENTA ya calculados por la app, totales, condiciones comerciales y matriz de cumplimiento.
// Nunca copia: costos de adquisición, recargos, márgenes, utilidades, comisiones, proveedores, enlaces de compra,
// despachos internos, financiamiento ni el texto original pegado (que puede traer precios o el nombre de la tienda).
// Los montos salen del cálculo existente (calcularCotizacion / totales de Ventas privadas): aquí no hay fórmulas.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { agruparPorCategoria, filasDeFicha } from "./especificaciones.js";
import { normalizarFichaEETT } from "./vpEETT.js";

const txt = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const multilinea = (s) => String(s ?? "").replace(/\r/g, "").split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n");
const esRefImagen = (x) => typeof x === "string" && x.length > 0;

// Condiciones comerciales generales (sin valores predeterminados: solo las que el vendedor completó).
export const CAMPOS_CONDICIONES = [
  { k: "plazo_entrega", titulo: "Plazo de entrega", ayuda: "Ej.: 5 días desde la aceptación de la OC" },
  { k: "tipo_dias", titulo: "Tipo de días", opciones: [["", "Sin indicar"], ["habiles", "Hábiles"], ["corridos", "Corridos"]] },
  { k: "garantia", titulo: "Garantía" },
  { k: "vigencia", titulo: "Vigencia de la oferta" },
  { k: "despacho", titulo: "Despacho" },
  { k: "forma_pago", titulo: "Forma de pago" },
  { k: "disponibilidad", titulo: "Disponibilidad", ayuda: "Solo si está confirmada" },
  { k: "observaciones", titulo: "Observaciones comerciales", multilinea: true },
];
// Condiciones particulares de un producto (en su ficha).
export const CAMPOS_CONDICIONES_PRODUCTO = [
  { k: "garantia", titulo: "Garantía" }, { k: "plazo_entrega", titulo: "Plazo de entrega" }, { k: "condiciones", titulo: "Condiciones particulares" },
];

export function condicionesDocumento(c = {}) {
  const out = [];
  const plazo = txt(c.plazo_entrega);
  if (plazo) out.push({ titulo: "Plazo de entrega", valor: c.tipo_dias && !/h[aá]bil|corrid/i.test(plazo) ? `${plazo} (días ${c.tipo_dias === "habiles" ? "hábiles" : "corridos"})` : plazo });
  for (const k of ["garantia", "vigencia", "despacho", "forma_pago", "disponibilidad"]) {
    const v = txt(c[k]); if (v) out.push({ titulo: CAMPOS_CONDICIONES.find((x) => x.k === k).titulo, valor: v });
  }
  const obs = multilinea(c.observaciones); if (obs) out.push({ titulo: "Observaciones", valor: obs });
  return out;
}

// Ficha técnica del editor → ficha del documento (categorías dinámicas, sin categorías vacías).
// Primero se aplica la MISMA interpretación de fichas que ya usan ambos canales (normalizarFichaEETT): líneas sin valor que
// son pares «Etiqueta: valor» pasan a características; las demás son textos descriptivos y van a «Descripción técnica».
export function fichaDocumento(ficha, condicionesProducto) {
  const f = ficha || {};
  const n = normalizarFichaEETT(f);
  const filas = filasDeFicha({ marca: n.marca, modelo: n.modelo, color: n.color, generales: n.generales, especificaciones: n.especificaciones });
  const categorias = agruparPorCategoria(filas).map((c) => ({ titulo: c.titulo, filas: c.filas.map((r) => ({ etiqueta: r.etiqueta, valor: r.valor, ...(r.contradictorio ? { contradictorio: true } : {}), ...(r.incompleto ? { incompleto: true } : {}) })) }));
  const cp = condicionesProducto || f.condiciones_producto || {};
  const condiciones = CAMPOS_CONDICIONES_PRODUCTO.map((c) => ({ titulo: c.titulo, valor: multilinea(cp[c.k]) })).filter((c) => c.valor);
  return { descripcion: multilinea(n.descripcion), categorias, imagenes: (f.imagenes || []).filter(esRefImagen).slice(0, 4), condiciones };
}

// Matriz de cumplimiento: solo requisitos reales del comprador; el estado lo decide el vendedor (por defecto «Por verificar»).
export const ESTADOS_CUMPLIMIENTO = [["por_verificar", "Por verificar"], ["cumple", "Cumple"], ["no_cumple", "No cumple"]];
export function matrizDocumento(matriz) {
  return (matriz || []).filter((r) => txt(r?.requisito)).map((r) => ({
    item: Number(r.item) > 0 ? Number(r.item) : null, requisito: txt(r.requisito), ofertado: txt(r.ofertado),
    estado: ESTADOS_CUMPLIMIENTO.some(([k]) => k === r.estado) ? r.estado : "por_verificar",
  }));
}
// Propuesta de matriz desde los requerimientos del comprador (Compra Ágil): requisito = lo solicitado; ofertado = el
// producto en la misma posición si existe; estado SIEMPRE «Por verificar» (nunca se declara que cumple automáticamente).
export function propuestaMatrizMP(cot) {
  const items = cot?.items || [];
  return (cot?.requerimientos || []).map((r, i) => {
    const requisito = [txt(r?.nombre), txt(r?.descripcion)].filter(Boolean).join(": ").slice(0, 400);
    const it = items[i];
    const ofertado = it ? [it.ficha?.nombre, [it.ficha?.marca, it.ficha?.modelo].filter(Boolean).join(" ")].map(txt).filter(Boolean).join(" · ") : "";
    return { item: it ? i + 1 : null, requisito, ofertado, estado: "por_verificar" };
  }).filter((r) => r.requisito);
}

const etiquetaId = (id) => (/COT\d{2}$/i.test(txt(id)) ? "ID Compra Ágil" : "ID Licitación");

// ── Mercado Público ──
// cot: cotización del editor; calc: calcularCotizacion(cot) (montos que ya usa la app); extra: { version, fecha, vendedor,
// empresa, condiciones, matriz }.
export function modeloOfertaMP(cot, calc, { version = 1, fecha, vendedor, empresa, condiciones, matriz } = {}) {
  const items = (cot?.items || []).map((it, i) => {
    const l = calc?.lineas?.[i] || {};
    const f = it.ficha || {};
    return {
      n: i + 1, nombre: txt(f.nombre) || `Producto ${i + 1}`, marca: txt(f.marca), modelo: txt(f.modelo),
      cantidad: Number(it.cantidad) || 0, unidad: "", unitario: Math.round(Number(l.unitario_neto) || 0), total: Math.round(Number(l.neto_linea) || 0),
      ficha: fichaDocumento(f),
    };
  });
  const t = calc?.totales || {};
  const destino = [txt(cot?.direccion_entrega), txt(cot?.comuna)].filter(Boolean).join(", ");
  return {
    generador: "oferta-1", canal: "mp", version: Math.max(1, Math.trunc(Number(version) || 1)), fecha: txt(fecha || cot?.fecha).slice(0, 10),
    referencia: txt(cot?.id_externo), operacion: txt(cot?.nombre),
    empresa: empresaPublica(empresa), vendedor: txt(vendedor ?? cot?.vendedor_nombre),
    cliente: { nombre: txt(cot?.institucion), rut: txt(cot?.rut), direccion: destino,
      filas: [["RUT", txt(cot?.rut)], ["Dirección de entrega", destino], [etiquetaId(cot?.id_externo), txt(cot?.id_externo)]] },
    items,
    totales: { neto: Math.round(t.neto || 0), iva: Math.round(t.iva_debito || 0), total: Math.round(t.total || 0), exenta: !!calc?.exenta, tasa_iva: 19,
      despacho_texto: "$0", nota: "Valores en pesos chilenos. Despacho incorporado en los precios unitarios." },
    condiciones: condicionesDocumento(condiciones || {}),
    matriz: matrizDocumento(matriz),
  };
}

// ── Ventas privadas ──
// documento: documentoDesdeEditor(...) / vp_documento_publico (ya filtrado por lista blanca); fichas: [ficha del ítem en
// el orden de documento.items] (la misma ventana de producto de Mercado Público); extra como en MP.
export function modeloOfertaVP(documento, fichas = [], { version = 1, fecha, vendedor, condiciones, matriz, operacion } = {}) {
  const d = documento || {};
  const cli = d.cliente || {}; const con = d.contacto || {};
  const direccion = txt(d.direccion_entrega) || [txt(cli.direccion), txt(cli.comuna)].filter(Boolean).join(", ");
  const items = (d.items || []).map((it, i) => {
    const f = fichas[i] || {};
    const servicio = it.tipo === "servicio";
    const nombre = txt(f.nombre) || txt(String(it.descripcion || "").split("\n")[0]) || `Ítem ${i + 1}`;
    const fd = fichaDocumento(f);
    // Solo un SERVICIO sin datos técnicos queda fuera de la EETT; un producto siempre tiene su ficha (con aviso si está vacía).
    const sinFicha = servicio && !fd.categorias.length && !fd.descripcion && !fd.imagenes.length && !fd.condiciones.length;
    return { n: i + 1, nombre, marca: txt(f.marca), modelo: txt(f.modelo), cantidad: Number(it.cantidad) || 0, unidad: txt(it.unidad),
      // Precio unitario de venta guardado (con su descuento de línea, si lo tiene); el total es el subtotal que calculó la app.
      unitario: Math.round((Number(it.precio_unitario) || 0) * (1 - (Number(it.descuento_pct) || 0) / 100)),
      total: Math.round(Number(it.subtotal_neto) || 0), ficha: fd, ...(sinFicha ? { sin_ficha: true } : {}), ...(servicio ? { servicio: true } : {}) };
  });
  const cond = { ...(condiciones || {}) };
  if (!txt(cond.plazo_entrega) && txt(d.plazo_entrega)) cond.plazo_entrega = d.plazo_entrega;
  if (!txt(cond.forma_pago) && txt(d.condiciones_pago)) cond.forma_pago = d.condiciones_pago;
  if (!txt(cond.vigencia) && txt(d.vigencia_hasta)) cond.vigencia = `Hasta el ${String(d.vigencia_hasta).slice(8, 10)}/${String(d.vigencia_hasta).slice(5, 7)}/${String(d.vigencia_hasta).slice(0, 4)}`;
  if (!txt(cond.observaciones)) cond.observaciones = [d.condiciones_comerciales, d.observaciones].map(multilinea).filter(Boolean).join("\n");
  const e = d.empresa || {};
  return {
    generador: "oferta-1", canal: "vp", version: Math.max(1, Math.trunc(Number(version) || 1)), fecha: txt(fecha || d.fecha_emision).slice(0, 10),
    referencia: txt(d.folio), operacion: txt(operacion) || txt(cli.razon_social),
    empresa: empresaPublica({ nombre: e.razon_social || e.nombre_corto, rut: e.rut, giro: e.giro, direccion: [e.direccion, e.comuna].map(txt).filter(Boolean).join(", "), correo: e.correo, telefono: Array.isArray(e.telefonos) ? e.telefonos.join(" / ") : e.telefonos }),
    vendedor: txt(vendedor ?? d.responsable?.nombre ?? d.responsable),
    cliente: { nombre: txt(cli.razon_social), rut: txt(cli.rut), direccion,
      filas: [["RUT", txt(cli.rut)], ["Contacto", [txt(con.nombre), txt(con.correo), txt(con.telefono)].filter(Boolean).join(" · ")], ["Dirección", direccion]] },
    items,
    totales: { neto: Math.round(d.neto || 0), iva: Math.round(d.iva || 0), total: Math.round(d.total || 0), exenta: d.afecta_iva === false, tasa_iva: Math.round((Number(d.tasa_iva) || 0.19) * 100),
      ...(Number(d.descuento) > 0 ? { descuento: Math.round(d.descuento) } : {}), nota: "Valores en pesos chilenos." },
    condiciones: condicionesDocumento(cond),
    matriz: matrizDocumento(matriz),
  };
}

function empresaPublica(e) {
  const x = e || {};
  return { nombre: txt(x.nombre) || "BFK Limitada", rut: txt(x.rut), giro: txt(x.giro), direccion: txt(x.direccion), correo: txt(x.correo) || "bfklimitada@gmail.com", telefono: txt(x.telefono) };
}
