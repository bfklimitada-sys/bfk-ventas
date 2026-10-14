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
export const mismoDestino = (a, b) => String(a || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
  === String(b || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Dirección de entrega utilizable para verificar despachos (no basta con un texto vacío o mínimo).
export const direccionValida = (cot) => String(cot?.direccion_entrega || "").trim().length >= 5;

// Si cambia la dirección del cliente, los despachos confirmados para OTRA dirección dejan de ser válidos:
// vuelven a «Por verificar» (sin destino ni evidencia anterior) para exigir una nueva verificación real.
// Devuelve cuántos se invalidaron. Muta la cotización recibida (usar sobre una copia). No toca montos.
export function invalidarDespachosPorDireccion(cot) {
  const destino = destinoDe(cot); let n = 0;
  for (const e of cot?.envios || []) {
    if ((e.estado === "confirmado" || e.estado === "sin_costo_confirmado") && !(destino && mismoDestino(e.destino, destino))) {
      e.estado = "pendiente"; e.destino = ""; e.evidencia = ""; n++;
    }
  }
  return n;
}

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

// Recargos (14/10/2026): se controlan SOLO desde Precios. Cada producto usa EXCLUSIVAMENTE su porcentaje efectivo
// (el propio si tiene uno; si no, el general); nunca se suman. Estas funciones no tocan costos ni despachos.
// Cambiar el recargo general lo aplica a TODOS los productos (los ajustes individuales previos se reemplazan).
export function aplicarRecargoGeneral(cot, recargo) {
  cot.recargo = recargo;
  for (const it of cot.items || []) it.recargo = null;
  return cot;
}
// Ajusta un solo producto. Vacío o igual al general → sigue al recargo general.
export function aplicarRecargoProducto(cot, key, recargo) {
  const it = (cot.items || []).find((x) => x.key === key); if (!it) return cot;
  const general = cot.recargo == null || cot.recargo === "" ? RECARGO_SUGERIDO : Number(cot.recargo);
  it.recargo = recargo === "" || recargo == null || Number(recargo) === general ? null : Number(recargo);
  return cot;
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
  // Cuenta también las imágenes guardadas que aún no se han cargado en pantalla (rutas del depósito).
  if (!(ficha?.imagenes || []).filter(Boolean).length) av.push({ tipo: "imagenes", nivel: "revisar", mensaje: "El producto no tiene imágenes." });
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
  return { porItem, faltan, advertencias: advertenciasEETT(cot), listo: items.length > 0 && !faltan.length && porItem.every((p) => p.aprobado) };
}

// Advertencias previas al PDF (13/10/2026): datos que faltan en el encabezado y posible discrepancia evidente
// entre la licitación y cada producto. Solo AVISAN para revisión manual: no bloquean ni corrigen nada.
const VACIAS = new Set("ADQUISICION ADQUISICIONES COMPRA COMPRAS PARA CON SIN DEL DE LA LAS LOS POR UNA UNO UNOS UNAS SEGUN OTROS OTRAS VARIOS VARIAS MATERIALES MATERIAL INSUMOS INSUMO PRODUCTOS PRODUCTO SERVICIO SERVICIOS SUMINISTRO SUMINISTROS ARTICULOS ARTICULO ELEMENTOS ELEMENTO EQUIPOS EQUIPO UNIDAD UNIDADES DEPARTAMENTO DIRECCION MUNICIPAL MUNICIPALIDAD ESCUELA LICEO HOSPITAL CESFAM OFICINA OFICINAS AREA SECCION PROGRAMA PROYECTO REQUERIMIENTO SOLICITUD COTIZACION GENERAL GENERALES NUEVO NUEVOS NUEVA NUEVAS TIPO SEGUN ADJUNTO ADJUNTA".split(" "));
const raices = (s) => (normal(s).match(/[A-Z0-9]+/g) || []).filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !VACIAS.has(w)).map((w) => w.slice(0, 5));
export function advertenciasEETT(cot) {
  const av = [];
  const faltaEnc = [["nombre", "nombre de la licitación"], ["fecha", "fecha de emisión"], ["plazo", "plazo de entrega"], ["rut", "RUT de la institución"]]
    .filter(([k]) => !String(cot?.[k] || "").trim()).map(([, t]) => t);
  if (faltaEnc.length) av.push({ tipo: "faltan_datos", mensaje: `Faltan datos del encabezado del PDF: ${faltaEnc.join(", ")}. Se omitirán o quedarán en blanco.` });
  const textoLic = [cot?.nombre, cot?.descripcion, ...(cot?.requerimientos || []).flatMap((r) => [r?.nombre, r?.descripcion])].filter(Boolean).join(" ");
  const lic = new Set(raices(textoLic));
  if (lic.size >= 2) (cot?.items || []).forEach((it, i) => {
    const f = it?.ficha || {};
    const prod = raices([f.nombre, f.marca, f.modelo].join(" "));
    if (prod.length && !prod.some((w) => lic.has(w)))
      av.push({ tipo: "discrepancia", item: i, mensaje: `Posible discrepancia: la licitación «${String(cot?.nombre || cot?.descripcion || "").trim().slice(0, 90)}» no comparte términos con el producto ${i + 1} «${String(f.nombre || "").trim().slice(0, 70)}». Revisa que el producto corresponda (no se cambia ningún dato).` });
  });
  return av;
}

// Bloque «Elaboración de especificaciones técnicas» del PDF: solo nombres, fecha y código (nunca montos).
// elaborado_por debe venir de la cuenta autenticada (perfil de la sesión), no de un campo editable.
export const elaboracionPublica = (e) => ({
  empresa: "BFK Limitada", vendedor: String(e?.vendedor || "").trim(), elaborado_por: String(e?.elaborado_por || "").trim(),
  fecha: String(e?.fecha || "").trim(), cotizacion: String(e?.cotizacion || "").trim(), version: Number(e?.version) > 0 ? String(Math.trunc(Number(e.version))) : "",
});

// Valor para pegar en Mercado Público: solo dígitos (sin signo peso ni separadores de miles).
export const digitosValor = (n) => String(Math.max(0, Math.round(Number(n) || 0)));

// Código de Compra Ágil desde un código o un enlace de Mercado Público (p. ej. 3390-246-COT26).
export function codigoCompraAgil(entrada) {
  let s = String(entrada || "").trim();
  try { s = decodeURIComponent(s); } catch { /* texto tal cual */ }
  const m = s.toUpperCase().match(/\b(\d{1,10}-\d{1,6}-COT\d{2})\b/);
  return m ? m[1] : "";
}

// Fecha/hora de ChileCompra → hora de Chile (America/Santiago) "AAAA-MM-DDTHH:MM", que es lo que muestra y guarda la
// cotización. Si la fecha trae zona (Z u offset) se convierte; si no la trae, se respeta tal cual.
export function fechaHoraChile(iso) {
  const t = String(iso || "").trim(); if (!t) return "";
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(t)) return t.slice(0, 16);
  const d = new Date(t); if (Number.isNaN(d.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// Campos de la cotización que propone una consulta de Compra Ágil (datos normalizados por /api/compra-agil).
// Cada campo: { campo, etiqueta, valor, actual, cambia, sobrescribe }. Lo que no viene no se propone (no se inventa).
// No toca la fecha de emisión de BFK, el estado ni precios: el presupuesto es del comprador y es solo referencial.
export function propuestaCompraAgil(cot, d) {
  const vacio = (v) => v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
  const plazo = d?.plazo_dias != null ? `${d.plazo_dias} DÍAS` : "";
  const pres = d?.presupuesto?.estimado ?? d?.presupuesto?.disponible ?? null;
  const filas = [
    ["id_externo", "Código Compra Ágil", d?.codigo],
    ["nombre", "Nombre", d?.nombre],
    ["descripcion", "Descripción", d?.descripcion],
    ["institucion", "Institución compradora", d?.institucion],
    ["unidad_compra", "Unidad solicitante", d?.unidad_compra],
    ["rut", "RUT", d?.rut],
    ["direccion_entrega", "Dirección de entrega", d?.direccion_entrega],
    ["region", "Región", d?.region],
    ["plazo", "Plazo de entrega", plazo],
    ["presupuesto_estimado", "Presupuesto del comprador (referencial)", pres],
    ["fecha_publicacion", "Fecha de publicación", fechaHoraChile(d?.fecha_publicacion)],
    ["fecha_cierre", "Fecha de cierre", fechaHoraChile(d?.fecha_cierre)],
    ["requerimientos", "Productos requeridos por el comprador", (d?.productos || []).filter((p) => p.nombre || p.descripcion)],
    ["documentos_mp", "Documentos adjuntos (referencia)", d?.documentos || []],
  ];
  return filas.filter(([, , v]) => !vacio(v)).map(([campo, etiqueta, valor]) => {
    const actual = cot?.[campo];
    // Comparación normalizada: fechas a minuto, números como número, textos sin espacios sobrantes.
    const norm = (v) => (campo.startsWith("fecha_") ? String(v ?? "").slice(0, 16) : campo === "presupuesto_estimado" ? (v == null || v === "" ? null : Number(v)) : typeof v === "string" ? v.trim() : v ?? null);
    const cambia = JSON.stringify(norm(actual)) !== JSON.stringify(norm(valor));
    return { campo, etiqueta, valor, actual, cambia, sobrescribe: cambia && !vacio(actual) };
  }).filter((f) => f.cambia);
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
export const cotizacionVacia = () => ({ id: null, id_externo: "", nombre: "", institucion: "", rut: "", direccion_entrega: "", comuna: "", fecha: hoyISO(), plazo: "", observaciones: "", estado: "borrador", recargo: RECARGO_SUGERIDO, version: 0, items: [], envios: [],
  // Datos de la Compra Ágil (requerimientos del comprador; opcionales y editables) y vendedor responsable.
  descripcion: "", unidad_compra: "", region: "", presupuesto_estimado: null, fecha_publicacion: null, fecha_cierre: null, requerimientos: [], documentos_mp: [], mp_consultado_en: null,
  vendedor_id: null, vendedor_nombre: "" });
export const fichaVacia = () => ({ nombre: "", marca: "", modelo: "", color: "", generales: [], especificaciones: [], descripcion: "", imagenes: [] });
export const itemVacio = () => ({ key: nuevaClave("i"), producto_id: null, ficha: fichaVacia(), ficha_aprobada: false, enlace: "", proveedor: "", cantidad: 1, precio_origen: "", precio_incluye_iva: true, con_factura: true, envio_key: null, recargo: null, disponibilidad: "", fecha_consulta: null, origen_datos: "manual", enlace_original: "" });
export const envioVacio = (proveedor = "") => ({ key: nuevaClave("e"), proveedor, monto: "", con_factura: true, estado: "pendiente", destino: "", evidencia: "", fecha_cotizacion: hoyISO() });

// Dominio legible del proveedor a partir del enlace.
export function proveedorDeEnlace(url) {
  try { const h = new URL(url).hostname.replace(/^www\./, ""); const m = h.match(/(falabella|mercadolibre|sodimac|paris|ripley|lider|pcfactory|easy|hites|abcdin|spdigital|tottus|lapolar)/i); return m ? m[1].replace(/^./, (c) => c.toUpperCase()).replace("Mercadolibre", "Mercado Libre").replace("Pcfactory", "PC Factory").replace("Spdigital", "SP Digital").replace("Lapolar", "La Polar").replace("Abcdin", "Abcdin") : h; } catch { return ""; }
}
