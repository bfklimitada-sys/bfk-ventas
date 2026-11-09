// Ventas privadas — EETT con el MISMO formato de las EETT de Mercado Público (06/11/2026).
// Solo cambia la fuente de datos: este adaptador convierte el contenido congelado de una EETT privada (vp_eett.contenido)
// en la cabecera, las fichas y las opciones que recibe crearPdfEETT() de lib/eettPdf.js (banda azul con logo, tabla de
// la primera página, una página por producto con fotografías, «Características Generales» / «Especificaciones»,
// descripción técnica, «Elaboración de especificaciones técnicas» y pie con el contacto).
// Diferencias propias del canal privado (sin campos que solo aplican a Mercado Público):
//   · tabla de la primera página: COTIZACIÓN (folio y revisión), CLIENTE, RUT, FECHA EMISIÓN, PLAZO ENTREGA, EETT y
//     OC DEL CLIENTE solo cuando existe (nunca «ID LICITACIÓN» ni «INSTITUCIÓN SOLICITANTE»);
//   · «Objeto del suministro» y «Alcance» tras esa tabla;
//   · por producto, a continuación de sus características: condiciones de operación e instalación, accesorios,
//     exclusiones, garantía, normas con su respaldo y, APARTE, «Requisitos del cliente» (requisito pedido, lo ofrecido y
//     el cumplimiento solo si fue declarado con respaldo).
// Las características excluidas o «No informado» no se imprimen. Ningún costo, margen ni precio llega al PDF.
//
// ── Formato «mp» (09/11/2026): la EETT privada se genera con el MISMO recorrido de Mercado Público ──────────────────
// Desde esta fecha la EETT privada ya no se arma en una ventana propia (objeto, alcance, requisitos, emisión): la pestaña
// EETT de la cotización revisa las fichas, muestra la vista previa y «Generar y descargar EETT» la emite y la descarga,
// igual que en Mercado Público. El contenido nuevo lleva `formato: "mp"` y se imprime con la plantilla de Mercado Público
// sin secciones adicionales; solo cambian las referencias del canal (cotización privada, EETT, cliente y RUT en la tabla de
// la primera página). Los contenidos anteriores (sin `formato`) se siguen imprimiendo como se emitieron.
// Ficha → EETT (normalizarFichaEETT): los pares «característica: valor» van como características; los textos descriptivos
// (entradas sin valor que no son un par) van a la descripción técnica. No se inventa ni se descarta ningún dato.
import { importarModulo } from "./cargaModulos.js";
import { crearPdfEETT, CONTACTO_BFK, nombreArchivoEETT, fechaCL } from "./eettPdf.js";
import { tieneDatosComerciales, caracteristicasVisibles, CUMPLIMIENTOS, NO_INFORMADO, cantidadTxt, folioRevision } from "./ventasPrivadas.js";

const txt = (v) => String(v ?? "").trim();
const plano = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const informado = (v) => txt(v) && plano(v) !== plano(NO_INFORMADO);
const folioRev = (folio, rev) => `${folio}${Number(rev) > 0 ? ` Rev. ${rev}` : ""}`;
const lista = (xs) => (xs || []).map(txt).filter(Boolean).map((x) => `· ${x}`).join("\n");

export const FORMATO_EETT_MP = "mp";
export const esFormatoMP = (contenido) => contenido?.formato === FORMATO_EETT_MP;

// ¿Es «Etiqueta: valor»? Etiqueta breve (hasta 60 caracteres y 8 palabras, con alguna letra, sin punto final) y valor no
// vacío. Un texto largo con dos puntos en medio de una frase (p. ej. «…incluido: listo para equipar…») NO es un par.
const VINETA = /^\s*(?:[-–—•·*▪►✓✔]+|\d{1,2}[.)])\s+/;
export function parCaracteristica(s) {
  const linea = txt(s).replace(VINETA, "");
  const m = linea.match(/^([^:\n]{1,60}?)\s*[:：]\s*(\S[^\n]*)$/);
  if (!m) return null;
  const etq = m[1].trim(); const valor = m[2].trim();
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(etq) || /[.;!?]$/.test(etq) || /[.;!?]\s/.test(etq) || etq.split(/\s+/).length > 8 || /^https?$/i.test(etq) || valor.startsWith("//")) return null;
  return { etiqueta: etq, valor };
}

// Ficha de la cotización (la misma ventana «Ingresar/Editar producto» de Mercado Público) → datos técnicos de la EETT.
// · entrada con etiqueta y valor → característica (en su grupo: generales o especificaciones);
// · entrada sin valor cuyo texto es «Etiqueta: valor» → característica (en su grupo);
// · cualquier otro texto sin valor (títulos, párrafos, viñetas de beneficios) → descripción técnica, en su orden;
// · líneas «Etiqueta: valor» de la descripción → especificaciones; el resto de la descripción se conserva como texto.
// Se eliminan solo repeticiones exactas (misma etiqueta y valor) y la marca/modelo/color repetidos con el mismo valor.
export function normalizarFichaEETT(ficha) {
  const f = ficha || {};
  const marca = txt(f.marca), modelo = txt(f.modelo), color = txt(f.color);
  const generales = [], especificaciones = [], textosGen = [], textosEsp = [], textosDesc = [];
  const vistos = new Set();
  const propio = { marca, modelo, color };
  const agregar = (lista, par) => {
    const k = `${plano(par.etiqueta)}|${plano(par.valor)}`;
    if (vistos.has(k)) return;
    const campo = plano(par.etiqueta);
    if (["marca", "modelo", "color"].includes(campo) && propio[campo] && plano(propio[campo]).replace(/\s/g, "") === plano(par.valor).replace(/\s/g, "")) return;
    vistos.add(k); lista.push(par);
  };
  const tratar = (p, lista, textos) => {
    const e = txt(p?.etiqueta), v = txt(p?.valor);
    if (!e && !v) return;
    if (e && v) { agregar(lista, { etiqueta: e, valor: v }); return; }
    const s = e || v; const par = parCaracteristica(s);
    if (par) agregar(lista, par); else textos.push(s);
  };
  (f.generales || []).forEach((p) => tratar(p, generales, textosGen));
  (f.especificaciones || []).forEach((p) => tratar(p, especificaciones, textosEsp));
  String(f.descripcion || "").replace(/\r/g, "").split("\n").forEach((l) => {
    if (!txt(l)) return;
    const par = parCaracteristica(l);
    if (par) agregar(especificaciones, par); else textosDesc.push(txt(l));
  });
  return {
    nombre: txt(f.nombre), marca, modelo, color, generales, especificaciones,
    // Bloques en su orden (textos de las características generales, descripción, textos de las especificaciones), separados
    // por una línea en blanco para que se lean como párrafos.
    descripcion: [textosGen, textosDesc, textosEsp].filter((b) => b.length).map((b) => b.join("\n")).join("\n\n"),
    imagenes: (f.imagenes || []).filter((x) => typeof x === "string" && x).slice(0, 4),
  };
}

// Campos que solo existían en la ventana anterior de la EETT privada. Si un borrador o una emisión anterior los tenía, se
// conservan tal cual (nada se pierde). Los que no cumplen las reglas de emisión (norma sin respaldo, cumplimiento sin
// respaldo) quedan guardados aparte en «legado» para no bloquear la emisión ni imprimirse.
const TEXTOS_ITEM = ["condiciones_operacion", "condiciones_instalacion", "garantia"];
const LISTAS_ITEM = ["accesorios", "exclusiones", "anexos"];
function anterioresDelItem(prev) {
  if (!prev) return {};
  const out = {};
  TEXTOS_ITEM.forEach((k) => { if (txt(prev[k])) out[k] = prev[k]; });
  LISTAS_ITEM.forEach((k) => { if (Array.isArray(prev[k]) && prev[k].length) out[k] = prev[k]; });
  const normas = (prev.normas || []).filter((n) => txt(n?.norma) || txt(n?.respaldo_texto) || n?.respaldo_documento_id);
  const requisitos = (prev.requisitos || []).filter((r) => txt(r?.requisito) || txt(r?.ofrecido));
  const normaOk = (n) => txt(n.respaldo_texto) || n.respaldo_documento_id;
  const reqOk = (r) => ["sin_declarar", "cumple", "no_cumple", "equivalente", undefined, null, ""].includes(r.cumplimiento) && !((r.cumplimiento === "cumple" || r.cumplimiento === "equivalente") && !txt(r.respaldo));
  if (normas.filter(normaOk).length) out.normas = normas.filter(normaOk);
  if (requisitos.filter(reqOk).length) out.requisitos = requisitos.filter(reqOk);
  const legado = { ...(normas.some((n) => !normaOk(n)) ? { normas: normas.filter((n) => !normaOk(n)) } : {}), ...(requisitos.some((r) => !reqOk(r)) ? { requisitos: requisitos.filter((r) => !reqOk(r)) } : {}) };
  // Características que se completaron a mano en la ventana anterior y que la ficha no tiene: se conservan aparte.
  const aMano = (prev.caracteristicas || []).filter((k) => !k.excluir && k.origen?.tipo !== "ficha" && informado(k.valor));
  if (aMano.length) legado.caracteristicas = aMano;
  if (Object.keys(legado).length) out.legado = legado;
  return out;
}

// Contenido de la EETT privada (formato «mp») a partir de las líneas de la cotización y sus fichas.
// datos: { cotizacion: {folio, revision}, cliente: {razon_social, rut}, plazo_entrega, fecha, responsable, elaborado_por,
//          oc_cliente?, items: [{ id, orden, cantidad, unidad, tipo, codigo, producto_id, ficha }], previo? (contenido anterior) }
export function contenidoEETTVP(datos) {
  const prev = datos.previo || {};
  const prevItems = new Map((prev.items || []).map((x) => [x.item_id, x]));
  const items = (datos.items || []).map((l) => {
    const n = normalizarFichaEETT(l.ficha);
    const esServicio = l.tipo === "servicio";
    const car = (lista, grupo) => lista.map((p) => ({ caracteristica: p.etiqueta, valor: p.valor, unidad: "", grupo, origen: { tipo: "ficha" } }));
    return {
      item_id: l.id, orden: Number(l.orden), cantidad: Number(l.cantidad), unidad: l.unidad, tipo: l.tipo || "producto",
      producto_id: l.producto_id || null,
      nombre: n.nombre || txt(l.descripcion), marca: esServicio ? "" : n.marca, modelo: esServicio ? "" : n.modelo, ...(!esServicio && n.color ? { color: n.color } : {}),
      descripcion: n.descripcion,
      imagenes: n.imagenes.filter((x) => !x.startsWith("data:")).slice(0, 2), origen_ficha: "cotizacion",
      caracteristicas: [...car(n.generales, "generales"), ...car(n.especificaciones, "especificaciones")],
      normas: [], requisitos: [],
      ...anterioresDelItem(prevItems.get(l.id)),
    };
  });
  const globales = {};
  ["objeto", "alcance", "observaciones"].forEach((k) => { if (txt(prev[k])) globales[k] = prev[k]; });
  if (Array.isArray(prev.anexos) && prev.anexos.length) globales.anexos = prev.anexos;
  return {
    formato: FORMATO_EETT_MP, fecha: datos.fecha,
    cotizacion: { folio: txt(datos.cotizacion?.folio), revision: Number(datos.cotizacion?.revision) || 0 },
    cliente: { razon_social: txt(datos.cliente?.razon_social), rut: txt(datos.cliente?.rut) },
    plazo_entrega: txt(datos.plazo_entrega), responsable: txt(datos.responsable), elaborado_por: txt(datos.elaborado_por),
    ...(datos.oc_cliente && txt(datos.oc_cliente.numero) ? { oc_cliente: { numero: txt(datos.oc_cliente.numero), fecha: txt(datos.oc_cliente.fecha) } } : {}),
    ...globales, items,
  };
}

// ¿El contenido nuevo es igual al de una emisión anterior? (Se ignora la fecha de generación.) Si lo es, «Generar y
// descargar» vuelve a descargar esa emisión en lugar de emitir una revisión idéntica.
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
export function mismoContenidoEETT(a, b) {
  if (!a || !b) return false;
  const sinFecha = (c) => { const { fecha, elaborado_por, ...resto } = c; return resto; }; // eslint-disable-line no-unused-vars
  return JSON.stringify(canon(sinFecha(a))) === JSON.stringify(canon(sinFecha(b)));
}

// Datos para crearPdfEETT() (plantilla de Mercado Público) desde un contenido «mp». eett: { folio, revision, estado,
// emitida_en, contenido }; en la vista previa folio puede venir vacío (la celda se omite; nunca un valor ficticio).
function datosPdfFormatoMP(eett, { imagenes = {}, logo } = {}) {
  const c = eett.contenido;
  const cl = c.cliente || {};
  const cotTxt = c.cotizacion ? folioRevision(c.cotizacion.folio, c.cotizacion.revision) : "";
  const eettTxt = txt(eett.folio) ? `${eett.folio}${eett.revision != null ? ` Rev. ${eett.revision}` : ""}` : "";
  const fecha = txt(String(eett.emitida_en || c.fecha || "").slice(0, 10));
  const oc = c.oc_cliente && txt(c.oc_cliente.numero) ? c.oc_cliente : null;
  // Misma tabla de Mercado Público (ID · NOMBRE · FECHA EMISIÓN / PLAZO · INSTITUCIÓN · RUT) con las referencias del canal.
  const proceso = [
    [{ titulo: "Cotización", valor: cotTxt }, { titulo: "Especificaciones técnicas", valor: eettTxt }, { titulo: "Fecha emisión", valor: fechaCL(fecha) }],
    // El nombre del cliente se escribe completo (opción «completo» del generador, solo canal privado).
    [{ titulo: "Plazo entrega", valor: c.plazo_entrega }, { titulo: "Cliente", valor: cl.razon_social, completo: true }, { titulo: "RUT", valor: cl.rut }],
    ...(oc ? [[{ titulo: "OC del cliente", valor: txt(oc.numero) }, { titulo: "Fecha OC", valor: fechaCL(oc.fecha) }]] : []),
  ];
  const cot = { id_externo: "", nombre: eettTxt || cotTxt, fecha, plazo: txt(c.plazo_entrega), institucion: txt(cl.razon_social), rut: txt(cl.rut) };
  const par = (k) => ({ etiqueta: txt(k.caracteristica), valor: [txt(k.valor), txt(k.unidad)].filter(Boolean).join(" ") });
  const items = [...c.items].sort((a, b) => Number(a.orden) - Number(b.orden)).map((it) => {
    const car = caracteristicasVisibles(it).filter((k) => informado(k.valor));
    const esServicio = it.tipo === "servicio";
    return { ficha: {
      nombre: `${it.orden}. ${txt(it.nombre)}`,
      marca: esServicio ? "" : txt(it.marca), modelo: esServicio ? "" : txt(it.modelo), color: esServicio ? "" : txt(it.color),
      // Solo la «Ficha técnica · va en la EETT» de la ventana del producto (código, unidad y cantidad son datos de la
      // cotización: igual que en Mercado Público, no se imprimen).
      generales: car.filter((k) => k.grupo === "generales").map(par),
      especificaciones: car.filter((k) => k.grupo !== "generales").map(par),
      descripcion: txt(it.descripcion),
      imagenes: (imagenes[it.item_id] || []).filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, 2),
    }, it };
  });
  // Solo si un contenido anterior traía estos datos (ventana anterior): se imprimen para no perderlos. En una EETT nueva
  // no existen y el PDF es exactamente la plantilla de Mercado Público.
  const introduccion = [
    { titulo: "Objeto del suministro", filas: [{ etiqueta: "", valor: c.objeto }] },
    { titulo: "Alcance", filas: [{ etiqueta: "", valor: c.alcance }] },
  ].filter((s) => txt(s.filas[0].valor));
  const extras = items.map(({ it }) => seccionesAnteriores(it));
  const finales = [
    { titulo: "Observaciones", filas: [{ etiqueta: "", valor: c.observaciones }] },
    { titulo: "Anexos", filas: (c.anexos || []).map((a, i) => ({ etiqueta: `${i + 1}.`, valor: txt(a.titulo || a.nombre_archivo) })) },
  ].map((s) => ({ ...s, filas: s.filas.filter((p) => txt(p.valor)) })).filter((s) => s.filas.length);
  if (finales.length) extras[extras.length - 1] = [...extras[extras.length - 1], ...finales];
  const opciones = {
    logo, proceso, introduccion, extras,
    elaboracion: { vendedor: txt(c.responsable), elaborado_por: txt(c.elaborado_por), fecha, cotizacion: cotTxt, version: eett.revision },
  };
  return { cot, items: items.map((x) => ({ ficha: x.ficha })), opciones };
}

// Secciones de un ítem que solo existían en la ventana anterior (condiciones, accesorios, garantía, normas con respaldo,
// requisitos del cliente, anexos). Vacías → no se imprime nada.
function seccionesAnteriores(it) {
  const etqCump = Object.fromEntries(CUMPLIMIENTOS.map((x) => [x.v, x.l.replace(/ \(.*\)$/, "")]));
  return [
    { titulo: "Condiciones", filas: [
      { etiqueta: "OPERACIÓN", valor: it.condiciones_operacion }, { etiqueta: "INSTALACIÓN", valor: it.condiciones_instalacion },
      { etiqueta: "ACCESORIOS INCLUIDOS", valor: lista(it.accesorios) }, { etiqueta: "EXCLUSIONES", valor: lista(it.exclusiones) },
      { etiqueta: "GARANTÍA", valor: it.garantia }] },
    { titulo: "Normas y certificaciones", filas: (it.normas || []).filter((n) => txt(n.norma) && (txt(n.respaldo_texto) || n.respaldo_documento_id))
      .map((n) => ({ etiqueta: txt(n.norma), valor: `Respaldo: ${txt(n.respaldo_texto) || [txt(n.respaldo_nombre), n.respaldo_pagina ? `pág. ${n.respaldo_pagina}` : ""].filter(Boolean).join(", ") || "documento adjunto"}` })) },
    { titulo: "Requisitos del cliente", filas: (it.requisitos || []).filter((r) => txt(r.requisito)).map((r) => ({ etiqueta: txt(r.requisito),
      valor: [`Ofrecido: ${txt(r.ofrecido) || NO_INFORMADO}`, r.cumplimiento && r.cumplimiento !== "sin_declarar" && (r.cumplimiento === "no_cumple" || txt(r.respaldo)) ? `Cumplimiento: ${etqCump[r.cumplimiento]}${txt(r.respaldo) ? ` (respaldo: ${txt(r.respaldo)})` : ""}` : ""].filter(Boolean).join("\n") })) },
    { titulo: "Anexos del ítem", filas: (it.anexos || []).map((a, i) => ({ etiqueta: `ANEXO ${i + 1}`, valor: `${txt(a.titulo || a.nombre_archivo)}${a.pagina ? `, pág. ${a.pagina}` : ""}` })) },
  ].map((s) => ({ ...s, filas: s.filas.filter((p) => txt(p.valor)) })).filter((s) => s.filas.length);
}

// Pie con el contacto configurado en Administración (correo | teléfonos | comuna). Sin configuración: el de BFK.
export function contactoDe(empresa) {
  const e = empresa || {};
  if (!txt(e.correo) && !txt(e.telefonos)) return CONTACTO_BFK;
  return [txt(e.correo), txt(e.telefonos), txt(e.comuna) ? `${txt(e.comuna)}, Chile.` : ""].filter(Boolean).join("  |  ");
}

export function datosPdfEETTVP(eett, { empresa: empresaActual = {}, imagenes = {}, logo } = {}) {
  let empresa = empresaActual || {};
  const c = eett?.contenido || {};
  if (tieneDatosComerciales(c)) throw new Error("El contenido de la EETT incluye datos comerciales; no se genera.");
  if (!c.items?.length) throw new Error("La EETT no tiene ítems.");
  if (esFormatoMP(c)) return datosPdfFormatoMP(eett, { imagenes, logo });
  // Formato anterior (EETT preparadas en la ventana propia hasta el 09/11/2026): se imprime como se emitió.
  if (c.empresa && Object.keys(c.empresa).length) empresa = c.empresa;   // la EETT conserva los datos con que se preparó
  const cl = c.cliente || {};
  const cotTxt = c.cotizacion ? folioRev(c.cotizacion.folio, c.cotizacion.revision) : "";
  const eettTxt = `${eett.folio} Rev. ${eett.revision}`;
  const fecha = txt(String(eett.emitida_en || c.fecha || "").slice(0, 10));
  const oc = c.oc_cliente && txt(c.oc_cliente.numero) ? txt(c.oc_cliente.numero) : "";
  // Cabecera mínima (lib/cotizaciones.cabeceraPublica): solo el título del documento; la tabla la definen «proceso».
  const cot = { id_externo: "", nombre: eettTxt, fecha, plazo: txt(c.plazo_entrega), institucion: txt(cl.razon_social), rut: txt(cl.rut) };
  const proceso = [
    [{ titulo: "Cotización", valor: cotTxt }, { titulo: "Cliente", valor: cl.razon_social }, { titulo: "RUT", valor: cl.rut }],
    [{ titulo: "Plazo entrega", valor: c.plazo_entrega }, { titulo: "Especificaciones técnicas", valor: eettTxt }, { titulo: "Fecha emisión", valor: fecha.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1") }],
    ...(oc ? [[{ titulo: "OC del cliente", valor: oc }, { titulo: "Fecha OC", valor: txt(c.oc_cliente.fecha).replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1") }]] : []),
  ];
  const introduccion = [
    { titulo: "Objeto del suministro", filas: [{ etiqueta: "", valor: c.objeto }] },
    { titulo: "Alcance", filas: [{ etiqueta: "", valor: c.alcance }] },
  ];
  const items = [], extras = [];
  for (const it of c.items) {
    const car = caracteristicasVisibles(it).filter((k) => informado(k.valor));
    const esServicio = it.tipo === "servicio";
    // Ficha técnica de la cotización (08/11/2026): sus características generales van en «Características Generales» y sus
    // especificaciones en «Especificaciones», igual que en Mercado Público. Contenidos anteriores (sin grupo «generales»): sin cambios.
    const par = (k) => ({ etiqueta: txt(k.caracteristica), valor: [txt(k.valor), txt(k.unidad)].filter(Boolean).join(" ") });
    const generales = [
      { etiqueta: "ÍTEM", valor: String(it.orden) },
      { etiqueta: "CANTIDAD", valor: `${cantidadTxt(it.cantidad)} ${txt(it.unidad)}`.trim() },
      ...(informado(it.codigo) ? [{ etiqueta: "CÓDIGO", valor: txt(it.codigo) }] : []),
      ...(esServicio ? [{ etiqueta: "TIPO", valor: "Servicio" }] : []),
      ...car.filter((k) => k.grupo === "generales" && k.origen?.tipo === "ficha").map(par),
    ];
    items.push({ ficha: {
      nombre: `${it.orden}. ${txt(it.nombre)}`,
      marca: esServicio ? "" : (informado(it.marca) ? txt(it.marca) : NO_INFORMADO),
      modelo: esServicio ? "" : (informado(it.modelo) ? txt(it.modelo) : NO_INFORMADO),
      ...(!esServicio && informado(it.color) ? { color: txt(it.color) } : {}),
      generales,
      especificaciones: car.filter((k) => !(k.grupo === "generales" && k.origen?.tipo === "ficha")).map(par),
      descripcion: txt(it.descripcion),
      imagenes: (imagenes[it.item_id] || []).filter((x) => typeof x === "string" && x.startsWith("data:image/")).slice(0, 2),
    } });
    const etqCump = Object.fromEntries(CUMPLIMIENTOS.map((x) => [x.v, x.l.replace(/ \(.*\)$/, "")]));
    const sec = [
      { titulo: "Condiciones", filas: [
        { etiqueta: "OPERACIÓN", valor: it.condiciones_operacion }, { etiqueta: "INSTALACIÓN", valor: it.condiciones_instalacion },
        { etiqueta: "ACCESORIOS INCLUIDOS", valor: lista(it.accesorios) }, { etiqueta: "EXCLUSIONES", valor: lista(it.exclusiones) },
        { etiqueta: "GARANTÍA", valor: it.garantia }] },
      // Solo normas con respaldo (la emisión ya rechaza las que no lo tienen).
      { titulo: "Normas y certificaciones", filas: (it.normas || []).filter((n) => txt(n.norma) && (txt(n.respaldo_texto) || n.respaldo_documento_id))
        .map((n) => ({ etiqueta: txt(n.norma), valor: `Respaldo: ${txt(n.respaldo_texto) || [txt(n.respaldo_nombre), n.respaldo_pagina ? `pág. ${n.respaldo_pagina}` : ""].filter(Boolean).join(", ") || "documento adjunto"}` })) },
      // Lo pedido por el cliente va APARTE de las características ofrecidas. El cumplimiento solo se muestra si fue
      // declarado y tiene respaldo (sin respaldo la emisión lo rechaza).
      { titulo: "Requisitos del cliente", filas: (it.requisitos || []).filter((r) => txt(r.requisito)).map((r) => ({ etiqueta: txt(r.requisito),
        valor: [`Ofrecido: ${txt(r.ofrecido) || NO_INFORMADO}`, r.cumplimiento && r.cumplimiento !== "sin_declarar" && (r.cumplimiento === "no_cumple" || txt(r.respaldo)) ? `Cumplimiento: ${etqCump[r.cumplimiento]}${txt(r.respaldo) ? ` (respaldo: ${txt(r.respaldo)})` : ""}` : ""].filter(Boolean).join("\n") })) },
      { titulo: "Anexos del ítem", filas: (it.anexos || []).map((a, i) => ({ etiqueta: `ANEXO ${i + 1}`, valor: `${txt(a.titulo || a.nombre_archivo)}${a.pagina ? `, pág. ${a.pagina}` : ""}` })) },
    ].map((s) => ({ ...s, filas: s.filas.filter((p) => txt(p.valor)) })).filter((s) => s.filas.length);
    extras.push(sec);
  }
  // Observaciones y anexos generales: al final del último producto.
  const finales = [
    { titulo: "Observaciones", filas: [{ etiqueta: "", valor: c.observaciones }] },
    { titulo: "Anexos", filas: (c.anexos || []).map((a, i) => ({ etiqueta: `${i + 1}.`, valor: txt(a.titulo || a.nombre_archivo) })) },
  ].map((s) => ({ ...s, filas: s.filas.filter((p) => txt(p.valor)) })).filter((s) => s.filas.length);
  extras[extras.length - 1] = [...extras[extras.length - 1], ...finales];
  const opciones = {
    logo, proceso, introduccion, extras, contacto: contactoDe(empresa), empresa: txt(empresa.razon_social) || undefined,
    marcaAgua: eett.estado === "borrador" ? "BORRADOR - NO EMITIDO (vista previa)" : undefined,
    elaboracion: { vendedor: txt(c.responsable), fecha, cotizacion: cotTxt, version: eett.revision },
  };
  return { cot, items, opciones };
}

// Nombre del archivo. Formato «mp»: el mismo criterio de Mercado Público (EETT_<referencia>.pdf), con el folio de la
// cotización privada y el de la EETT como referencia. Formato anterior: sin cambios.
export const nombreArchivoEETTVP = (eett) => {
  const c = eett?.contenido || {};
  if (esFormatoMP(c)) return nombreArchivoEETT({ id_externo: [c.cotizacion?.folio, txt(eett.folio) ? `${eett.folio}${eett.revision != null ? ` Rev${eett.revision}` : ""}` : ""].filter(Boolean).join(" ") });
  return `EETT ${eett.folio} Rev${eett.revision}${eett.estado === "borrador" ? " (borrador)" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
};

export function crearPdfEETTVP(eett, { jsPDF, ...resto } = {}) {
  const { cot, items, opciones } = datosPdfEETTVP(eett, resto);
  return crearPdfEETT(cot, items, { jsPDF, ...opciones });
}
export async function generarPdfEETTVP(eett, opciones = {}) {
  const { jsPDF } = await importarModulo(() => import("jspdf"));
  const doc = crearPdfEETTVP(eett, { ...opciones, jsPDF });
  return { blob: doc.output("blob"), nombre: nombreArchivoEETTVP(eett), paginas: doc.getNumberOfPages(), doc };
}
