// ═══════════════════════════════════════════════════════════════════════════════════════════════
// PDF de Ventas privadas (jsPDF, texto vectorial). Dos documentos:
//   · Cotización privada: estructura del «Formato Cotización» de BFK (encabezado con logo y datos de la empresa,
//     recuadro COTIZACIÓN con folio, solicitante, contacto, tabla ÍTEM/CÓDIGO/CANTIDAD/UN./DETALLE/P. UNITARIO,
//     NETO / IVA (19%) / TOTAL, notas y condiciones) y el sello de página «Página X de Y».
//   · EETT (especificaciones técnicas): mismo lenguaje visual de la ficha técnica de BFK (banda azul con logo),
//     organizada por ítem con la numeración de la cotización.
// Privacidad por construcción: la cotización solo recibe documentoPublicoCotizacion() (lista blanca, sin costos ni
// márgenes) y la EETT solo el contenido validado (sin claves comerciales). El PDF se genera en el dispositivo; lo que
// se conserva en la base es el contenido congelado (revisión enviada / EETT emitida), desde el que el PDF se regenera igual.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
import { importarModulo } from "./cargaModulos.js";
import { textoPDF, fechaCL } from "./eettPdf.js";
import { documentoPublicoCotizacion, caracteristicasVisibles, tieneDatosComerciales, cantidadTxt, CUMPLIMIENTOS, NO_INFORMADO } from "./ventasPrivadas.js";

const AZUL = [54, 96, 146], TINTA = [15, 23, 42], GRIS = [90, 98, 112], LINEA = [190, 196, 206], FONDO = [242, 245, 249];
const W = 210, H = 297, MX = 14, ANCHO = W - 2 * MX;
const pesosPDF = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-CL");
const t = (s) => textoPDF(s);
const formatoImagen = (src) => (/^data:image\/png/i.test(src) ? "PNG" : "JPEG");

function contactoEmpresa(e = {}) {
  return [e.correo, e.telefonos, [e.direccion, e.comuna].filter(Boolean).join(", ")].filter(Boolean).join("  |  ");
}

// Encabezado común: logo, datos de BFK y recuadro con el tipo de documento y su folio.
function encabezado(doc, { logo, empresa = {}, titulo, folio, lineasDerecha = [] }) {
  let y = 12;
  if (logo) {
    try { const p = doc.getImageProperties(logo); const k = Math.min(34 / p.width, 22 / p.height); doc.addImage(logo, formatoImagen(logo), MX, y, p.width * k, p.height * k); } catch { /* sin logo */ }
  }
  const x = MX + 40;
  doc.setTextColor(...TINTA); doc.setFont("helvetica", "bold"); doc.setFontSize(11.5);
  doc.text(t((empresa.razon_social || "").toUpperCase()), x, y + 4);
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.6); doc.setTextColor(...GRIS);
  const datos = [empresa.lema, empresa.giro ? `Giro: ${empresa.giro}` : null, empresa.rut ? `RUT: ${empresa.rut}` : null,
    [empresa.direccion, empresa.comuna].filter(Boolean).join(", ") || null, empresa.correo ? `Email: ${empresa.correo}` : null, empresa.telefonos ? `Fono: ${empresa.telefonos}` : null].filter(Boolean);
  datos.forEach((d, i) => doc.text(t(d), x, y + 9 + i * 3.9, { maxWidth: 92 }));
  // Recuadro del documento
  const bx = W - MX - 52, bw = 52;
  doc.setDrawColor(...AZUL); doc.setLineWidth(0.5); doc.rect(bx, y, bw, 28);
  doc.setFillColor(...AZUL); doc.rect(bx, y, bw, 8, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(t(titulo), bx + bw / 2, y + 5.6, { align: "center" });
  doc.setTextColor(...TINTA); doc.setFontSize(12); doc.text(t(folio), bx + bw / 2, y + 14.5, { align: "center" });
  doc.setFont("helvetica", "normal"); doc.setFontSize(8.2); doc.setTextColor(...GRIS);
  lineasDerecha.forEach((l, i) => doc.text(t(l), bx + bw / 2, y + 19.5 + i * 3.8, { align: "center" }));
  return Math.max(y + 32, y + 9 + datos.length * 3.9 + 3);
}
function pies(doc, texto) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(MX, H - 13, W - MX, H - 13);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.6); doc.setTextColor(...GRIS);
    if (texto) doc.text(t(texto), MX, H - 8.5, { maxWidth: ANCHO - 30 });
    doc.text(`Página ${i} de ${n}`, W - MX, H - 8.5, { align: "right" });
  }
}
// Bloque de dos columnas etiqueta/valor con recuadro.
function bloqueDatos(doc, y, titulo, filas, { columnas = 2 } = {}) {
  const visibles = filas.filter(([, v]) => String(v ?? "").trim());
  if (!visibles.length) return y;
  doc.setFillColor(...FONDO); doc.rect(MX, y, ANCHO, 6, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.6); doc.setTextColor(...AZUL); doc.text(t(titulo), MX + 2, y + 4.2);
  y += 8;
  const colW = ANCHO / columnas; let col = 0; let filaY = y; let maxH = 0;
  for (const [k, v] of visibles) {
    const x = MX + 2 + col * colW;
    doc.setFont("helvetica", "bold"); doc.setFontSize(8); doc.setTextColor(...GRIS); doc.text(t(k), x, filaY);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...TINTA);
    const lineas = doc.splitTextToSize(t(v), colW - 30);
    doc.text(lineas, x + 27, filaY);
    maxH = Math.max(maxH, lineas.length * 4);
    col++;
    if (col >= columnas) { col = 0; filaY += Math.max(5, maxH + 1); maxH = 0; }
  }
  if (col !== 0) filaY += Math.max(5, maxH + 1);
  return filaY + 1;
}
function nuevaPaginaSiFalta(doc, y, alto, alPasar) {
  if (y + alto <= H - 18) return y;
  doc.addPage();
  return alPasar ? alPasar() : 18;
}

// ── Cotización privada ─────────────────────────────────────────────────────────────────────────────
export function crearPdfCotizacion(documento, { jsPDF, logo } = {}) {
  if (!jsPDF) throw new Error("Falta jsPDF");
  const d = documentoPublicoCotizacion(documento);          // lista blanca: ningún costo puede pasar
  if (!d?.items?.length) throw new Error("La cotización no tiene líneas.");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const folio = `${d.folio}${Number(d.revision) > 0 ? ` Rev. ${d.revision}` : ""}`;
  doc.setProperties({ title: `Cotización ${folio}`, subject: "Cotización", author: d.empresa?.razon_social || "", creator: "BFK Datos" });
  let y = encabezado(doc, { logo, empresa: d.empresa, titulo: "COTIZACIÓN", folio,
    lineasDerecha: [`Emisión: ${fechaCL(d.fecha_emision)}`, `Válida hasta: ${fechaCL(d.vigencia_hasta)}`] });
  const cl = d.cliente || {};
  y = bloqueDatos(doc, y, "SOLICITANTE", [["Cliente", cl.razon_social], ["RUT", cl.rut], ["Giro", cl.giro], ["Dirección", [cl.direccion, cl.comuna].filter(Boolean).join(", ")]]);
  const co = d.contacto || {};
  y = bloqueDatos(doc, y, "CONTACTO", [["Sr(a).", co.nombre], ["Teléfono", co.telefono], ["Email", co.correo]]);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...TINTA);
  doc.text("Estimado(a), se adjunta el detalle de la cotización de los artículos y servicios solicitados:", MX, y + 3); y += 7;

  // Tabla
  const hayDesc = d.items.some((it) => Number(it.descuento_pct) > 0);
  const cols = hayDesc
    ? [["ÍTEM", 11, "center"], ["CÓDIGO", 20, "left"], ["CANT.", 15, "right"], ["UN.", 11, "center"], ["DETALLE", 66, "left"], ["P. UNITARIO", 22, "right"], ["DESC.", 13, "right"], ["SUBTOTAL", 24, "right"]]
    : [["ÍTEM", 11, "center"], ["CÓDIGO", 22, "left"], ["CANT.", 16, "right"], ["UN.", 12, "center"], ["DETALLE", 76, "left"], ["P. UNITARIO", 22, "right"], ["SUBTOTAL", 23, "right"]];
  const xs = []; cols.reduce((x, c) => { xs.push(x); return x + c[1]; }, MX);
  const cabTabla = (yy) => {
    doc.setFillColor(...AZUL); doc.rect(MX, yy, ANCHO, 7, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(7.8);
    cols.forEach(([n, w, al], i) => doc.text(n, al === "right" ? xs[i] + w - 1.5 : al === "center" ? xs[i] + w / 2 : xs[i] + 1.5, yy + 4.7, { align: al === "left" ? undefined : al }));
    return yy + 7;
  };
  y = cabTabla(y);
  d.items.forEach((it, idx) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.4);
    const det = doc.splitTextToSize(t(it.descripcion), cols[4][1] - 3);
    const alto = Math.max(6, det.length * 3.7 + 2.4);
    if (y + alto > H - 18) { doc.addPage(); y = cabTabla(18); }
    if (idx % 2) { doc.setFillColor(250, 251, 253); doc.rect(MX, y, ANCHO, alto, "F"); }
    doc.setTextColor(...TINTA);
    const vals = hayDesc
      ? [String(it.orden), t(it.codigo || ""), cantidadTxt(it.cantidad), t(it.unidad), null, pesosPDF(it.precio_unitario), Number(it.descuento_pct) ? `${String(it.descuento_pct).replace(".", ",")}%` : "", pesosPDF(it.subtotal_neto)]
      : [String(it.orden), t(it.codigo || ""), cantidadTxt(it.cantidad), t(it.unidad), null, pesosPDF(it.precio_unitario), pesosPDF(it.subtotal_neto)];
    vals.forEach((v, i) => {
      const [, w, al] = cols[i];
      if (i === 4) { doc.text(det, xs[i] + 1.5, y + 4); return; }
      doc.text(v, al === "right" ? xs[i] + w - 1.5 : al === "center" ? xs[i] + w / 2 : xs[i] + 1.5, y + 4, { align: al === "left" ? undefined : al, maxWidth: w - 2 });
    });
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.15); doc.line(MX, y + alto, W - MX, y + alto);
    y += alto;
  });

  // Totales
  y = nuevaPaginaSiFalta(doc, y + 3, 34);
  const filasTot = [];
  if (Number(d.descuento) > 0) { filasTot.push(["SUBTOTAL ($)", d.bruto]); filasTot.push(["DESCUENTO ($)", -Number(d.descuento)]); }
  filasTot.push(["NETO ($)", d.neto]);
  filasTot.push([d.afecta_iva ? `IVA (${Math.round(Number(d.tasa_iva) * 100)}%)` : "EXENTO DE IVA", d.iva]);
  filasTot.push(["TOTAL ($)", d.total]);
  const tx = W - MX - 72;
  filasTot.forEach(([k, v], i) => {
    const ultimo = i === filasTot.length - 1;
    if (ultimo) { doc.setFillColor(...AZUL); doc.rect(tx, y - 1, 72, 7.5, "F"); doc.setTextColor(255); }
    else doc.setTextColor(...TINTA);
    doc.setFont("helvetica", ultimo ? "bold" : "normal"); doc.setFontSize(ultimo ? 10 : 9);
    doc.text(t(k), tx + 2, y + 4); doc.text(Number(v) < 0 ? `-${pesosPDF(-v)}` : pesosPDF(v), W - MX - 2, y + 4, { align: "right" });
    y += 7.5;
  });

  // Notas y condiciones
  y += 4;
  const notas = [
    ["", d.afecta_iva ? "Los precios unitarios son netos y no incluyen IVA." : "Operación exenta de IVA."],
    ["Plazo de entrega", d.plazo_entrega], ["Dirección de entrega", d.direccion_entrega], ["Validez de la oferta", `Hasta el ${fechaCL(d.vigencia_hasta)}`],
    ["Condiciones de pago", d.condiciones_pago], ["Observaciones", d.observaciones], ["Condiciones comerciales", d.condiciones_comerciales],
  ].filter(([, v]) => String(v ?? "").trim());
  y = nuevaPaginaSiFalta(doc, y, 10);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...AZUL); doc.text("NOTAS Y CONDICIONES", MX, y); y += 5;
  for (const [k, v] of notas) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.6); doc.setTextColor(...TINTA);
    const etq = k ? t(`${k}:`) : "";
    const lineas = doc.splitTextToSize(t(k ? `${k}: ${v}` : v), ANCHO - 2);
    y = nuevaPaginaSiFalta(doc, y, lineas.length * 3.9 + 1);
    lineas.forEach((l, i) => {
      if (i === 0 && etq && l.startsWith(etq)) {
        doc.setFont("helvetica", "bold"); doc.text(etq, MX, y); const w = doc.getTextWidth(etq + " ");
        doc.setFont("helvetica", "normal"); doc.text(l.slice(etq.length).trimStart(), MX + w, y);
      } else doc.text(l, MX, y);
      y += 3.9;
    });
    y += 1;
  }
  if (d.responsable) {
    y = nuevaPaginaSiFalta(doc, y + 4, 8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.6); doc.setTextColor(...GRIS);
    doc.text(t([d.responsable, d.empresa?.correo, d.empresa?.nombre_corto ? `Ventas ${d.empresa.nombre_corto}` : null].filter(Boolean).join(" | ")), MX, y + 4);
  }
  pies(doc, contactoEmpresa(d.empresa));
  return doc;
}
export async function generarPdfCotizacion(documento, opciones = {}) {
  const { jsPDF } = await importarModulo(() => import("jspdf"));
  const doc = crearPdfCotizacion(documento, { ...opciones, jsPDF });
  const nombre = `Cotizacion ${documento.folio}${Number(documento.revision) > 0 ? ` Rev${documento.revision}` : ""} - ${String(documento.cliente?.razon_social || "").slice(0, 40)}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  return { blob: doc.output("blob"), nombre, paginas: doc.getNumberOfPages(), doc };
}

// ── EETT ───────────────────────────────────────────────────────────────────────────────────────────
// eett: {folio, revision, estado, emitida_en, contenido}; cab: datos públicos de la cotización {folio, revision, cliente};
// imagenes: {item_id: [dataURL]}.
export function crearPdfEETT(eett, { jsPDF, logo, empresa = {}, imagenes = {} } = {}) {
  if (!jsPDF) throw new Error("Falta jsPDF");
  const c = eett?.contenido || {};
  if (tieneDatosComerciales(c)) throw new Error("El contenido de la EETT incluye datos comerciales; no se genera.");
  if (!c.items?.length) throw new Error("La EETT no tiene ítems.");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const folio = `${eett.folio} Rev. ${eett.revision}`;
  doc.setProperties({ title: `EETT ${folio}`, subject: "Especificaciones técnicas", author: empresa.razon_social || "", creator: "BFK Datos" });
  const borrador = eett.estado === "borrador";
  const marcaBorrador = () => {
    if (!borrador) return;
    doc.setTextColor(220, 38, 38); doc.setFont("helvetica", "bold"); doc.setFontSize(9);
    doc.text("BORRADOR — NO EMITIDO (vista previa)", W / 2, 8, { align: "center" });
  };
  let y = encabezado(doc, { logo, empresa, titulo: "ESPECIFICACIONES TÉCNICAS", folio,
    lineasDerecha: [`Fecha: ${fechaCL(String(eett.emitida_en || c.fecha || "").slice(0, 10))}`, c.cotizacion ? `Cotización ${c.cotizacion.folio}${Number(c.cotizacion.revision) > 0 ? ` Rev. ${c.cotizacion.revision}` : ""}` : ""].filter(Boolean) });
  marcaBorrador();
  const cl = c.cliente || {};
  y = bloqueDatos(doc, y, "CLIENTE Y REFERENCIA", [["Cliente", cl.razon_social], ["RUT", cl.rut], ["Referencia", c.cotizacion ? `Cotización ${c.cotizacion.folio}${Number(c.cotizacion.revision) > 0 ? ` Rev. ${c.cotizacion.revision}` : ""}` : ""], ["Revisión EETT", String(eett.revision)]]);
  const parrafo = (titulo, texto) => {
    if (!String(texto || "").trim()) return;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);
    const lineas = doc.splitTextToSize(t(texto), ANCHO);
    y = nuevaPaginaSiFalta(doc, y, 9 + Math.min(lineas.length, 6) * 4, () => { marcaBorrador(); return 18; });
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...AZUL); doc.text(t(titulo), MX, y); y += 4.5;
    doc.setFont("helvetica", "normal"); doc.setTextColor(...TINTA);
    for (const l of lineas) { y = nuevaPaginaSiFalta(doc, y, 4, () => { marcaBorrador(); return 18; }); doc.text(l, MX, y); y += 4; }
    y += 2;
  };
  parrafo("OBJETO DEL SUMINISTRO", c.objeto);
  parrafo("ALCANCE", c.alcance);

  for (const it of c.items) {
    doc.addPage(); marcaBorrador(); y = 16;
    doc.setFillColor(64, 64, 64); doc.rect(MX, y, ANCHO, 9, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(10.5);
    doc.text(t(`ÍTEM ${it.orden} — ${it.nombre || ""}`).slice(0, 110), MX + 3, y + 6);
    doc.text(t(`${cantidadTxt(it.cantidad)} ${it.unidad}`), W - MX - 3, y + 6, { align: "right" });
    y += 12;
    const ident = it.tipo === "servicio"
      ? [["Tipo", "Servicio"], ["Código", it.codigo]]
      : [["Marca", it.marca || NO_INFORMADO], ["Modelo", it.modelo || NO_INFORMADO], ["Código", it.codigo]];
    y = bloqueDatos(doc, y, "IDENTIFICACIÓN", ident, { columnas: 3 });
    const imgs = (imagenes[it.item_id] || []).slice(0, 2);
    if (imgs.length) {
      const hImg = 46; y = nuevaPaginaSiFalta(doc, y, hImg + 4, () => { marcaBorrador(); return 18; });
      const caja = imgs.length === 1 ? [[MX + ANCHO / 4, ANCHO / 2]] : [[MX, ANCHO / 2 - 2], [MX + ANCHO / 2 + 2, ANCHO / 2 - 2]];
      imgs.forEach((src, i) => {
        const [x, w] = caja[i]; doc.setDrawColor(...LINEA); doc.rect(x, y, w, hImg);
        try { const p = doc.getImageProperties(src); const k = Math.min((w - 4) / p.width, (hImg - 4) / p.height); doc.addImage(src, formatoImagen(src), x + (w - p.width * k) / 2, y + (hImg - p.height * k) / 2, p.width * k, p.height * k); } catch { /* imagen no legible */ }
      });
      y += hImg + 4;
    }
    parrafo("DESCRIPCIÓN TÉCNICA", it.descripcion);
    const car = caracteristicasVisibles(it);
    if (car.length) {
      y = nuevaPaginaSiFalta(doc, y, 14, () => { marcaBorrador(); return 18; });
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...AZUL); doc.text("CARACTERÍSTICAS DEL PRODUCTO OFRECIDO", MX, y); y += 2;
      const cab = (yy) => { doc.setFillColor(...FONDO); doc.rect(MX, yy, ANCHO, 6, "F"); doc.setTextColor(...GRIS); doc.setFontSize(8); doc.text("Característica", MX + 2, yy + 4.2); doc.text("Valor", MX + 82, yy + 4.2); doc.text("Unidad", MX + 150, yy + 4.2); return yy + 6; };
      y = cab(y);
      for (const k of car) {
        doc.setFont("helvetica", "normal"); doc.setFontSize(8.6);
        const lk = doc.splitTextToSize(t(k.caracteristica), 76), lv = doc.splitTextToSize(t(k.valor), 64);
        const alto = Math.max(lk.length, lv.length) * 3.8 + 2;
        if (y + alto > H - 18) { doc.addPage(); marcaBorrador(); y = cab(18); }
        doc.setTextColor(...TINTA); doc.setFont("helvetica", "bold"); doc.text(lk, MX + 2, y + 4); doc.setFont("helvetica", "normal"); doc.text(lv, MX + 82, y + 4); doc.text(t(k.unidad || ""), MX + 150, y + 4);
        doc.setDrawColor(...LINEA); doc.setLineWidth(0.15); doc.line(MX, y + alto, W - MX, y + alto); y += alto;
      }
      y += 3;
    }
    parrafo("CONDICIONES DE OPERACIÓN", it.condiciones_operacion);
    parrafo("CONDICIONES DE INSTALACIÓN", it.condiciones_instalacion);
    if ((it.accesorios || []).length) parrafo("ACCESORIOS INCLUIDOS", it.accesorios.map((a) => `· ${a}`).join("\n"));
    if ((it.exclusiones || []).length) parrafo("EXCLUSIONES", it.exclusiones.map((a) => `· ${a}`).join("\n"));
    parrafo("GARANTÍA", it.garantia);
    if ((it.normas || []).length) parrafo("NORMAS Y CERTIFICACIONES (CON RESPALDO)", it.normas.map((n) => `· ${n.norma}${n.respaldo_texto ? ` — respaldo: ${n.respaldo_texto}` : n.respaldo_nombre ? ` — respaldo: ${n.respaldo_nombre}${n.respaldo_pagina ? `, pág. ${n.respaldo_pagina}` : ""}` : ""}`).join("\n"));
    if ((it.requisitos || []).length) {
      const et = Object.fromEntries(CUMPLIMIENTOS.map((x) => [x.v, x.l.replace(/ \(.*\)$/, "")]));
      parrafo("REQUISITOS DEL CLIENTE / PRODUCTO OFRECIDO", it.requisitos.map((r) => `· Requisito: ${r.requisito}\n  Ofrecido: ${r.ofrecido || NO_INFORMADO}${r.cumplimiento && r.cumplimiento !== "sin_declarar" ? `\n  Cumplimiento: ${et[r.cumplimiento]}${r.respaldo ? ` (respaldo: ${r.respaldo})` : ""}` : ""}`).join("\n"));
    }
    if ((it.anexos || []).length) parrafo("ANEXOS DEL ÍTEM", it.anexos.map((a) => `· ${a.titulo || a.nombre_archivo}${a.pagina ? `, pág. ${a.pagina}` : ""}`).join("\n"));
  }
  if ((c.anexos || []).length || String(c.observaciones || "").trim()) {
    doc.addPage(); marcaBorrador(); y = 18;
    parrafo("OBSERVACIONES", c.observaciones);
    if ((c.anexos || []).length) parrafo("ANEXOS", c.anexos.map((a, i) => `${i + 1}. ${a.titulo || a.nombre_archivo}`).join("\n"));
  }
  pies(doc, `${eett.folio} Rev. ${eett.revision}${eett.hash ? ` · huella ${eett.hash.slice(0, 12)}` : ""}  |  ${contactoEmpresa(empresa)}`);
  return doc;
}
export async function generarPdfEETTPrivada(eett, opciones = {}) {
  const { jsPDF } = await importarModulo(() => import("jspdf"));
  const doc = crearPdfEETT(eett, { ...opciones, jsPDF });
  const nombre = `EETT ${eett.folio} Rev${eett.revision}${eett.estado === "borrador" ? " (borrador)" : ""}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
  return { blob: doc.output("blob"), nombre, paginas: doc.getNumberOfPages(), doc };
}
