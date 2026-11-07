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
import { importarModulo } from "./cargaModulos.js";
import { crearPdfEETT, CONTACTO_BFK } from "./eettPdf.js";
import { tieneDatosComerciales, caracteristicasVisibles, CUMPLIMIENTOS, NO_INFORMADO, cantidadTxt } from "./ventasPrivadas.js";

const txt = (v) => String(v ?? "").trim();
const plano = (s) => txt(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const informado = (v) => txt(v) && plano(v) !== plano(NO_INFORMADO);
const folioRev = (folio, rev) => `${folio}${Number(rev) > 0 ? ` Rev. ${rev}` : ""}`;
const lista = (xs) => (xs || []).map(txt).filter(Boolean).map((x) => `· ${x}`).join("\n");

// Pie con el contacto configurado en Administración (correo | teléfonos | comuna). Sin configuración: el de BFK.
export function contactoDe(empresa) {
  const e = empresa || {};
  if (!txt(e.correo) && !txt(e.telefonos)) return CONTACTO_BFK;
  return [txt(e.correo), txt(e.telefonos), txt(e.comuna) ? `${txt(e.comuna)}, Chile.` : ""].filter(Boolean).join("  |  ");
}

export function datosPdfEETTVP(eett, { empresa: empresaActual = {}, imagenes = {}, logo } = {}) {
  let empresa = empresaActual || {};
  const c = eett?.contenido || {};
  if (c.empresa && Object.keys(c.empresa).length) empresa = c.empresa;   // la EETT conserva los datos con que se preparó
  if (tieneDatosComerciales(c)) throw new Error("El contenido de la EETT incluye datos comerciales; no se genera.");
  if (!c.items?.length) throw new Error("La EETT no tiene ítems.");
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
    const generales = [
      { etiqueta: "ÍTEM", valor: String(it.orden) },
      { etiqueta: "CANTIDAD", valor: `${cantidadTxt(it.cantidad)} ${txt(it.unidad)}`.trim() },
      ...(informado(it.codigo) ? [{ etiqueta: "CÓDIGO", valor: txt(it.codigo) }] : []),
      ...(esServicio ? [{ etiqueta: "TIPO", valor: "Servicio" }] : []),
    ];
    items.push({ ficha: {
      nombre: `${it.orden}. ${txt(it.nombre)}`,
      marca: esServicio ? "" : (informado(it.marca) ? txt(it.marca) : NO_INFORMADO),
      modelo: esServicio ? "" : (informado(it.modelo) ? txt(it.modelo) : NO_INFORMADO),
      generales,
      especificaciones: car.map((k) => ({ etiqueta: txt(k.caracteristica), valor: [txt(k.valor), txt(k.unidad)].filter(Boolean).join(" ") })),
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

export const nombreArchivoEETTVP = (eett) => `EETT ${eett.folio} Rev${eett.revision}${eett.estado === "borrador" ? " (borrador)" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");

export function crearPdfEETTVP(eett, { jsPDF, ...resto } = {}) {
  const { cot, items, opciones } = datosPdfEETTVP(eett, resto);
  return crearPdfEETT(cot, items, { jsPDF, ...opciones });
}
export async function generarPdfEETTVP(eett, opciones = {}) {
  const { jsPDF } = await importarModulo(() => import("jspdf"));
  const doc = crearPdfEETTVP(eett, { ...opciones, jsPDF });
  return { blob: doc.output("blob"), nombre: nombreArchivoEETTVP(eett), paginas: doc.getNumberOfPages(), doc };
}
