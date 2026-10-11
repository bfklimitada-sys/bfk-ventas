// ═══════════════════════════════════════════════════════════════
// Cotizaciones y EETT (módulo nuevo, octubre 2026). Funciones puras: no leen ni escriben datos.
// No usan ni modifican ningún cálculo financiero existente (OC, FIFO, IVA mensual, F29, comisiones).
//
// FÓRMULA CONFIRMADA por Kevin el 11/10/2026 (ver docs/cotizaciones/README.md §4): recargo sobre costo neto
// cuando el IVA es recuperable, 30% sugerido y editable, unitario neto redondeado hacia arriba, despacho
// compartido proporcional al valor, despacho $0 en Mercado Público (modalidad A).
// ═══════════════════════════════════════════════════════════════

export const IVA = 0.19;
export const RECARGO_SUGERIDO = 0.30; // sugerido por el Excel histórico (112 de 163 filas); nunca obligatorio

export const FORMULA = {
  confirmada: true,
  base: "neto",          // "neto": recargo sobre costo neto real (IVA no recuperable = costo) · "bruto": método histórico del Excel
  redondeo: "arriba",    // unitario neto para Mercado Público: "arriba" (nunca bajo el recargo) · "normal"
  prorrateo: "valor",    // envío compartido: "valor" (según subtotal de cada línea) · "cantidad"
};

export const ESTADOS_COTIZACION = {
  borrador: { label: "Borrador", tono: "neutro" },
  lista: { label: "Lista para ofertar", tono: "info" },
  presentada: { label: "Presentada", tono: "info" },
  adjudicada: { label: "Adjudicada", tono: "ok" },
  no_adjudicada: { label: "No adjudicada", tono: "neutro" },
  descartada: { label: "Descartada", tono: "neutro" },
};

export const ESTADOS_ENVIO = {
  pendiente: { label: "Por verificar", tono: "warn" },
  confirmado: { label: "Confirmado", tono: "ok" },
  sin_costo_confirmado: { label: "Sin costo (confirmado)", tono: "ok" },
  no_despacha: { label: "No despacha a la dirección", tono: "danger" },
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Dirección real del cliente a la que debe verificarse cada envío (dirección + comuna de la cotización).
export const destinoDe = (cot) => [cot?.direccion_entrega, cot?.comuna].map((x) => String(x || "").trim()).filter(Boolean).join(", ");
const mismoDestino = (a, b) => String(a || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  === String(b || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const envioConfirmado = (e) => e?.estado === "confirmado" || e?.estado === "sin_costo_confirmado";
const EPS = 1e-7;
const redondear = (x, modo) => (modo === "arriba" ? Math.ceil(x - EPS) : Math.round(x));

// Precio unitario con IVA (lo desembolsado por unidad) a partir de lo publicado por el proveedor.
export const precioBrutoUnit = (it) => (it?.precio_incluye_iva === false ? num(it.precio_origen) * (1 + IVA) : num(it?.precio_origen));

// Reparte cada envío entre las líneas que lo comparten; la última línea se lleva el resto exacto.
// Devuelve { [itemKey]: montoBrutoAsignado }. Líneas sin envío asignado no aparecen.
export function repartirEnvios(items, envios, prorrateo = FORMULA.prorrateo) {
  const out = {};
  for (const e of envios || []) {
    const ls = (items || []).filter((it) => it.envio_key === e.key);
    if (!ls.length) continue;
    const total = Math.round(num(e.monto));
    const peso = (it) => (prorrateo === "cantidad" ? num(it.cantidad) : num(it.cantidad) * precioBrutoUnit(it));
    const base = ls.reduce((s, it) => s + peso(it), 0);
    let acum = 0;
    ls.forEach((it, i) => {
      const parte = i === ls.length - 1 ? total - acum : base > 0 ? Math.round(total * (peso(it) / base)) : Math.round(total / ls.length);
      acum += parte; out[it.key] = parte;
    });
  }
  return out;
}

// Cálculo completo de la cotización con desglose explícito. recargo: fracción (0,30 = 30%).
export function calcularCotizacion(cot, formula = FORMULA) {
  const items = cot?.items || []; const envios = cot?.envios || [];
  const asignado = repartirEnvios(items, envios, formula.prorrateo);
  const recargoCot = cot?.recargo == null || cot.recargo === "" ? RECARGO_SUGERIDO : num(cot.recargo);
  const pendientes = []; const destino = destinoDe(cot);
  const lineas = items.map((it, idx) => {
    const n = idx + 1; const q = num(it.cantidad);
    const env = envios.find((e) => e.key === it.envio_key) || null;
    const recargo = it.recargo == null || it.recargo === "" ? recargoCot : num(it.recargo);
    const prodBruto = q * precioBrutoUnit(it);
    const prodNeto = it.con_factura === false ? prodBruto : prodBruto / (1 + IVA);
    const envBruto = env ? num(asignado[it.key]) : 0;
    const envNeto = env && env.con_factura === false ? envBruto : envBruto / (1 + IVA);
    const costoBruto = prodBruto + envBruto;
    const costoNeto = prodNeto + envNeto;
    const ivaCredito = costoBruto - costoNeto;
    const baseRecargo = formula.base === "bruto" ? costoBruto / (1 + IVA) : costoNeto;
    const ventaNetaTeorica = baseRecargo * (1 + recargo);
    const unitarioNeto = q > 0 ? redondear(ventaNetaTeorica / q, formula.redondeo) : 0;
    const netoLinea = unitarioNeto * q;
    const avisos = [];
    if (q <= 0) avisos.push(`Producto ${n}: falta la cantidad.`);
    if (num(it.precio_origen) <= 0) avisos.push(`Producto ${n}: falta el precio de compra.`);
    if (!env) avisos.push(`Producto ${n}: sin envío asignado. Nunca se asume despacho gratis: verifica el envío a la dirección del cliente.`);
    else if (!envioConfirmado(env)) avisos.push(`Producto ${n}: el envío de ${env.proveedor || "proveedor"} está ${ESTADOS_ENVIO[env.estado]?.label.toLowerCase() || "por verificar"}.`);
    else if (!destino) avisos.push(`Producto ${n}: falta la dirección de entrega del cliente; el envío de ${env.proveedor || "proveedor"} no puede darse por verificado.`);
    else if (!mismoDestino(env.destino, destino)) avisos.push(`Producto ${n}: el envío de ${env.proveedor || "proveedor"} se verificó para ${env.destino ? `"${env.destino}"` : "otra dirección"}, no para "${destino}". Vuelve a verificarlo.`);
    else if (!String(env.evidencia || "").trim()) avisos.push(`Producto ${n}: registra cómo se verificó el envío de ${env.proveedor || "proveedor"} (simulación de compra, captura, cotización del proveedor).`);
    if (recargo < 0) avisos.push(`Producto ${n}: recargo negativo (venta bajo costo).`);
    pendientes.push(...avisos);
    return { key: it.key, cantidad: q, recargo, costo_producto_bruto: prodBruto, envio_asignado: envBruto, costo_bruto: costoBruto, costo_neto: costoNeto,
      iva_credito: ivaCredito, venta_neta_teorica: ventaNetaTeorica, unitario_neto: unitarioNeto, neto_linea: netoLinea,
      utilidad_neta: netoLinea - costoNeto, avisos };
  });
  const s = (k) => lineas.reduce((a, l) => a + l[k], 0);
  const neto = s("neto_linea"); const ivaDebito = Math.round(neto * IVA);
  const costoNeto = s("costo_neto"); const ivaCredito = s("iva_credito");
  const envSinUso = envios.filter((e) => !items.some((it) => it.envio_key === e.key) && num(e.monto) > 0);
  for (const e of envSinUso) pendientes.push(`El envío de ${e.proveedor || "proveedor"} no está asignado a ningún producto.`);
  if (!items.length) pendientes.push("La cotización no tiene productos.");
  return {
    formula, lineas,
    totales: {
      costo_bruto: s("costo_bruto"), costo_neto: costoNeto, iva_credito: ivaCredito, envios: s("envio_asignado"),
      neto, iva_debito: ivaDebito, total: neto + ivaDebito,
      utilidad_neta: neto - costoNeto, iva_a_pagar: ivaDebito - ivaCredito,
      margen_sobre_venta: neto > 0 ? (neto - costoNeto) / neto : 0,
      recargo_efectivo: costoNeto > 0 ? neto / costoNeto - 1 : 0,
      despacho_mercado_publico: 0, // modalidad A: el envío va dentro de los unitarios
    },
    pendientes, listo: pendientes.length === 0,
  };
}

// Equivalencia recargo → margen sobre venta neta (30% de recargo = 23,1% de margen).
export const margenDeRecargo = (r) => (1 + num(r) > 0 ? num(r) / (1 + num(r)) : 0);

// Texto tabulado para copiar los unitarios a Mercado Público (o a Excel) desde el celular.
export function textoParaMercadoPublico(cot, calc) {
  const filas = [["N°", "Producto", "Cantidad", "Precio unitario neto", "Total neto"].join("\t")];
  (cot.items || []).forEach((it, i) => {
    const l = calc.lineas[i];
    filas.push([i + 1, (it.ficha?.nombre || "").replace(/\s+/g, " ").trim(), l.cantidad, l.unitario_neto, l.neto_linea].join("\t"));
  });
  filas.push(["", "Despacho (modalidad A)", "", "", 0].join("\t"));
  filas.push(["", "Total neto", "", "", calc.totales.neto].join("\t"));
  return filas.join("\n");
}

// ── Ficha técnica ──────────────────────────────────────────────

// Lista "Etiqueta: valor" (una por línea) ⇄ [{etiqueta, valor}] — edición rápida en el celular.
export function paresDeTexto(texto) {
  return String(texto || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^([^:\t]{1,80})[:\t]\s*(.*)$/);
    return m ? { etiqueta: m[1].trim(), valor: m[2].trim() } : { etiqueta: l, valor: "" };
  }).filter((p) => p.etiqueta || p.valor);
}
export const textoDePares = (pares) => (pares || []).map((p) => (p.valor ? `${p.etiqueta}: ${p.valor}` : p.etiqueta)).join("\n");

// Solo los campos técnicos de un producto. Es la ÚNICA entrada del PDF: precios, envíos, enlaces,
// proveedor y recargos no pueden llegar al documento externo porque esta función no los copia.
export function fichaPublica(ficha) {
  const f = ficha || {};
  const limpiar = (pares) => (pares || []).filter((p) => p && (String(p.etiqueta || "").trim() || String(p.valor || "").trim()))
    .map((p) => ({ etiqueta: String(p.etiqueta || "").trim(), valor: String(p.valor || "").trim() }));
  return {
    nombre: String(f.nombre || "").trim(), marca: String(f.marca || "").trim(), modelo: String(f.modelo || "").trim(), color: String(f.color || "").trim(),
    generales: limpiar(f.generales), especificaciones: limpiar(f.especificaciones),
    descripcion: String(f.descripcion || "").trim(),
    imagenes: (f.imagenes || []).filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, 4),
  };
}

const normal = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
const tokensModelo = (s) => (normal(s).match(/[A-Z0-9][A-Z0-9-]*/g) || []).filter((t) => /\d/.test(t));

// Revisión previa a publicar: detecta, NO corrige. Cada aviso: { tipo, nivel: "bloqueo"|"revisar", mensaje }.
export function revisarFicha(ficha) {
  const f = fichaPublica(ficha); const av = [];
  if (!f.nombre) av.push({ tipo: "nombre", nivel: "bloqueo", mensaje: "Falta el nombre exacto del producto." });
  if (!f.marca) av.push({ tipo: "marca", nivel: "revisar", mensaje: "Falta la marca." });
  if (!f.modelo) av.push({ tipo: "modelo", nivel: "revisar", mensaje: "Falta el modelo." });
  if (!f.imagenes.length) av.push({ tipo: "imagenes", nivel: "revisar", mensaje: "El producto no tiene imágenes." });
  if (!f.especificaciones.length && !f.generales.length) av.push({ tipo: "especificaciones", nivel: "revisar", mensaje: "No hay características ni especificaciones." });
  // Modelo del encabezado vs modelo de características (caso de referencia: Smart Tank 520 vs 580).
  const enNombre = tokensModelo(f.nombre); const enModelo = tokensModelo(f.modelo);
  if (enModelo.length && enNombre.length && !enModelo.some((t) => enNombre.includes(t)))
    av.push({ tipo: "modelo_discrepante", nivel: "revisar", mensaje: `El nombre indica ${enNombre.join(" / ")} y el modelo dice ${enModelo.join(" / ")}. Verifica cuál es el correcto antes de publicar (no se corrige solo).` });
  const modeloAttr = [...f.generales, ...f.especificaciones].find((p) => /^modelo$/i.test(normal(p.etiqueta).trim()));
  if (modeloAttr && f.modelo && normal(modeloAttr.valor).replace(/\s/g, "") !== normal(f.modelo).replace(/\s/g, ""))
    av.push({ tipo: "modelo_atributo", nivel: "revisar", mensaje: `El atributo "Modelo" (${modeloAttr.valor}) no coincide con el modelo de la ficha (${f.modelo}).` });
  const marcaAttr = [...f.generales, ...f.especificaciones].find((p) => /^marca$/i.test(normal(p.etiqueta).trim()));
  if (marcaAttr && f.marca && normal(marcaAttr.valor).trim() !== normal(f.marca).trim())
    av.push({ tipo: "marca_atributo", nivel: "revisar", mensaje: `El atributo "Marca" (${marcaAttr.valor}) no coincide con la marca de la ficha (${f.marca}).` });
  // Datos comerciales colados en la ficha técnica (precios, enlaces, despacho): bloquean el PDF.
  const textos = [f.nombre, f.descripcion, ...[...f.generales, ...f.especificaciones].flatMap((p) => [p.etiqueta, p.valor])];
  const comercial = textos.find((t) => /\$\s?\d|https?:\/\/|www\.|\b(precio|despacho gratis|env[ií]o gratis|cuotas|descuento|oferta|stock)\b/i.test(t));
  if (comercial) av.push({ tipo: "dato_comercial", nivel: "bloqueo", mensaje: `La ficha contiene un dato comercial que no debe ir en la EETT: "${String(comercial).slice(0, 60)}".` });
  return av;
}

// ¿Se puede generar el PDF? Bloqueos impiden; avisos "revisar" requieren aprobación explícita del usuario.
export function estadoParaPDF(cot) {
  const items = cot?.items || [];
  const porItem = items.map((it, i) => {
    const av = revisarFicha(it.ficha);
    const bloqueos = av.filter((a) => a.nivel === "bloqueo");
    const revisar = av.filter((a) => a.nivel === "revisar");
    return { key: it.key, n: i + 1, avisos: av, bloqueos, revisar, aprobado: !bloqueos.length && (!revisar.length || !!it.ficha_aprobada) };
  });
  const faltan = [];
  // El ID de Mercado Público es opcional: si falta, se omite del encabezado del PDF (11/10/2026).
  if (!String(cot?.institucion || "").trim()) faltan.push("institución");
  return { porItem, faltan, listo: items.length > 0 && !faltan.length && porItem.every((p) => p.aprobado) };
}

// Datos de la cabecera del PDF: solo identificación del proceso (nunca montos).
export const cabeceraPublica = (cot) => ({
  id_externo: String(cot?.id_externo || "").trim(), nombre: String(cot?.nombre || "").trim(),
  fecha: String(cot?.fecha || "").trim(), plazo: String(cot?.plazo || "").trim(),
  institucion: String(cot?.institucion || "").trim(), rut: String(cot?.rut || "").trim(),
});

// Cotización vacía y producto vacío (claves locales estables para la interfaz).
let sec = 0;
export const nuevaClave = (p = "k") => `${p}${Date.now().toString(36)}${(sec++).toString(36)}`;
export const hoyISO = () => { const d = new Date(); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
export const cotizacionVacia = () => ({ id: null, id_externo: "", nombre: "", institucion: "", rut: "", direccion_entrega: "", comuna: "", fecha: hoyISO(), plazo: "", observaciones: "", estado: "borrador", recargo: RECARGO_SUGERIDO, version: 0, items: [], envios: [] });
export const fichaVacia = () => ({ nombre: "", marca: "", modelo: "", color: "", generales: [], especificaciones: [], descripcion: "", imagenes: [] });
export const itemVacio = () => ({ key: nuevaClave("i"), producto_id: null, ficha: fichaVacia(), ficha_aprobada: false, enlace: "", proveedor: "", cantidad: 1, precio_origen: "", precio_incluye_iva: true, con_factura: true, envio_key: null, recargo: null, disponibilidad: "", fecha_consulta: null, origen_datos: "manual" });
export const envioVacio = (proveedor = "") => ({ key: nuevaClave("e"), proveedor, monto: "", con_factura: true, estado: "pendiente", destino: "", evidencia: "", fecha_cotizacion: hoyISO() });

// Dominio legible del proveedor a partir del enlace.
export function proveedorDeEnlace(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ""); const m = h.match(/(falabella|mercadolibre|sodimac|paris|ripley|lider|pcfactory|easy|hites|abcdin|spdigital|tottus|lapolar)/i); return m ? m[1].replace(/^./, (c) => c.toUpperCase()).replace("Mercadolibre", "Mercado Libre").replace("Pcfactory", "PC Factory").replace("Spdigital", "SP Digital").replace("Lapolar", "La Polar").replace("Abcdin", "Abcdin") : h; } catch { return ""; }
}
