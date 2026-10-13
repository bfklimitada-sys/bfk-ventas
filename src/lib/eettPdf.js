// ═══════════════════════════════════════════════════════════════
// PDF de EETT (Información técnica de productos) — reproduce la plantilla oficial de BFK
// «Copia de INFORMACIÓN TÉCNICA DE PRODUCTOS BFK(1).xlsx», hoja «Pág.1» (octubre 2026):
//   · marco negro de página; banda azul #366092 con el título en blanco y recuadro blanco con el logotipo;
//   · tabla del proceso (ID / NOMBRE / FECHA EMISIÓN · PLAZO / INSTITUCIÓN / RUT) solo en la primera página,
//     igual que la plantilla;
//   · cada producto en página nueva: franja gris oscura #404040 con el nombre, dos fotografías lado a lado
//     (recuadro izquierdo más angosto, como la plantilla), franja «CARACTERÍSTICAS», columnas
//     «Características Generales» y «Especificaciones» con renglones (etiqueta en negrita, valor gris a la derecha);
//   · pie azul con el contacto de BFK en todas las páginas.
// Medidas tomadas de la plantilla renderizada (proporciones del Excel ajustadas al alto de una hoja A4).
// La tipografía de la plantilla (Franklin Gothic Medium Cond) es comercial y no puede incrustarse: se usa
// Helvetica (estándar del PDF) con tamaños equivalentes.
//
// Privacidad por construcción: solo recibe cabeceraPublica(), fichaPublica() y elaboracionPublica()
// (lib/cotizaciones.js); ningún precio, envío, enlace, proveedor, recargo, ganancia ni IVA puede llegar aquí.
// Texto vectorial (jsPDF): nítido, liviano y seleccionable. El PDF NO se guarda en el servidor.
// ═══════════════════════════════════════════════════════════════
import { cabeceraPublica, fichaPublica, elaboracionPublica } from "./cotizaciones.js";

export const CONTACTO_BFK = "bfklimitada@gmail.com  |  +56 9 97141822 / +56 9 57322538  |  Laja, Chile.";
const AZUL = [54, 96, 146];      // #366092 (banda de título y pie de la plantilla)
const GRIS_BARRA = [64, 64, 64]; // #404040 (franjas de nombre y CARACTERÍSTICAS)
const GRIS_VALOR = [89, 89, 89]; // valores (texto gris de la plantilla)
const LINEA = [64, 64, 64];      // renglones de las columnas
const LINEA_SUAVE = [150, 150, 150];

// Helvetica estándar (WinAnsi): se reemplazan los caracteres que no puede dibujar.
const REEMPLAZOS = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "...", "•": "·", "≥": ">=", "≤": "<=", "″": '"', "′": "'", "™": "(TM)", "€": "EUR", " ": " ", "​": "" };
export const textoPDF = (s) => String(s ?? "").replace(/[^\u0000-ÿ]/g, (c) => REEMPLAZOS[c] ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim();

// Fecha chilena DD/MM/AAAA.
export const fechaCL = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ""); };

// Geometría (mm). Hoja A4 210 × 297; marco a 5 mm del borde.
const W = 210, H = 297;
const MX0 = 5, MX1 = 205, MY0 = 5, MY1 = 292;
const CAB_ALTO = 24.3, LOGO_ANCHO = 48.9;              // banda azul 151,1 mm + recuadro del logo
const CX0 = 10.3, CX1 = 199.7, CANCHO = CX1 - CX0;     // ancho útil de franjas e imágenes
const PIE_ALTO = 11.3, PIE_Y = MY1 - PIE_ALTO;         // banda del pie
const IMG_ALTO = 56, IMG_IZQ = [CX0, 82.3], IMG_DER = [103, 96.7];
const COLS = [{ x: 15.6, w: 71.5 }, { x: 108.3, w: 84.1 }]; // columnas Características Generales / Especificaciones
const RENGLON = 7.5;                                    // alto de renglón de la plantilla
const ELAB_ALTO = 15;                                   // bloque «Elaboración de especificaciones técnicas»

// cot: cotización (se usa SOLO cabeceraPublica); items: [{ ficha }];
// opciones: { jsPDF, logo (dataURL), elaboracion: { vendedor, elaborado_por, fecha, cotizacion, version } }
export function crearPdfEETT(cot, items, { jsPDF, logo, elaboracion } = {}) {
  if (!jsPDF) throw new Error("Falta jsPDF");
  const cab = cabeceraPublica(cot);
  const elab = elaboracion ? elaboracionPublica(elaboracion) : null;
  const fichas = (items || []).map((it) => fichaPublica(it.ficha || it));
  if (!fichas.length) throw new Error("La cotización no tiene productos para la EETT.");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `EETT ${cab.id_externo || cab.nombre || cab.institucion}`.trim(), subject: "Información técnica de productos", author: "BFK Limitada", creator: "BFK Datos" });

  const marco = () => { doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(MX0, MY0, MX1 - MX0, MY1 - MY0); };

  // Banda azul con el título (2 líneas, centrado) y recuadro blanco con el logotipo.
  const encabezado = () => {
    marco();
    const anchoAzul = MX1 - MX0 - LOGO_ANCHO;
    doc.setFillColor(...AZUL); doc.rect(MX0, MY0, anchoAzul, CAB_ALTO, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold");
    let tam = 27; doc.setFontSize(tam);
    while (tam > 16 && doc.getTextWidth("INFORMACIÓN  TÉCNICA DE") > anchoAzul - 12) { tam -= 0.5; doc.setFontSize(tam); }
    const cx = MX0 + anchoAzul / 2;
    doc.text("INFORMACIÓN  TÉCNICA DE", cx, MY0 + 10.2, { align: "center" });
    doc.text("PRODUCTOS", cx, MY0 + 21.3, { align: "center" });
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(MX0 + anchoAzul, MY0, LOGO_ANCHO, CAB_ALTO);
    if (logo) {
      try { const p = doc.getImageProperties(logo); const wMax = LOGO_ANCHO - 4, hMax = CAB_ALTO - 4; const k = Math.min(wMax / p.width, hMax / p.height);
        doc.addImage(logo, /^data:image\/png/i.test(logo) ? "PNG" : "JPEG", MX0 + anchoAzul + (LOGO_ANCHO - p.width * k) / 2, MY0 + (CAB_ALTO - p.height * k) / 2, p.width * k, p.height * k); } catch { /* sin logo */ }
    }
    doc.line(MX0, MY0 + CAB_ALTO, MX1, MY0 + CAB_ALTO);
    return MY0 + CAB_ALTO;
  };

  // Tabla del proceso (solo primera página, como la plantilla). Sin ID de Mercado Público se omite esa
  // columna (nunca se muestran valores ficticios).
  const tablaProceso = (y0) => {
    const conId = !!cab.id_externo;
    const lineaH = (y) => { doc.setDrawColor(0); doc.setLineWidth(0.2); doc.line(CX0, y, CX1, y); };
    const fila = (y, titulos, valores, xs, anchos) => {
      lineaH(y);
      doc.setFont("helvetica", "bold"); doc.setFontSize(8.8); doc.setTextColor(0);
      titulos.forEach((t, i) => doc.text(t, xs[i], y + 4.2));
      lineaH(y + 6);
      doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0);
      valores.forEach((v, i) => {
        const t = doc.splitTextToSize(textoPDF(v), anchos[i] - 2)[0] || "";
        if (t) doc.text(t, xs[i] + anchos[i] / 2, y + 10.8, { align: "center" });
      });
      return y + 13;
    };
    const X = [CX0, CX0 + 33.6, CX0 + 146.2]; const A = [33.6, 112.6, CANCHO - 146.2];
    let y = y0 + 3.8;
    y = conId
      ? fila(y, ["ID LICITACIÓN", "NOMBRE LICITACIÓN", "FECHA EMISIÓN"], [cab.id_externo, cab.nombre, fechaCL(cab.fecha)], X, A)
      : fila(y, ["NOMBRE LICITACIÓN", "FECHA EMISIÓN"], [cab.nombre, fechaCL(cab.fecha)], [CX0, X[2]], [A[0] + A[1], A[2]]);
    lineaH(y);
    y = fila(y, ["PLAZO ENTREGA", "INSTITUCIÓN SOLICITANTE", "RUT"], [cab.plazo, cab.institucion, cab.rut], X, A);
    return y + 5;
  };

  const pie = () => {
    doc.setFillColor(...AZUL); doc.rect(MX0, PIE_Y, MX1 - MX0, PIE_ALTO, "F");
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.rect(MX0, PIE_Y, MX1 - MX0, PIE_ALTO);
    doc.setTextColor(255); doc.setFont("helvetica", "normal"); doc.setFontSize(11.5);
    doc.text(CONTACTO_BFK, W / 2, PIE_Y + 7, { align: "center" });
  };

  // Franja gris oscura con texto blanco centrado (nombre del producto / CARACTERÍSTICAS).
  const franja = (y, texto, { tam = 12, alto = 10.3 } = {}) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(tam);
    const lineas = doc.splitTextToSize(textoPDF(texto).toUpperCase(), CANCHO - 8).slice(0, 3);
    const h = Math.max(alto, 4.6 + lineas.length * tam * 0.42);
    doc.setFillColor(...GRIS_BARRA); doc.rect(CX0, y, CANCHO, h, "F");
    doc.setTextColor(255);
    const y0 = y + h / 2 - ((lineas.length - 1) * tam * 0.42) / 2 + tam * 0.14;
    lineas.forEach((l, i) => doc.text(l, W / 2, y0 + i * tam * 0.42, { align: "center" }));
    return y + h;
  };

  // Dos fotografías lado a lado (proporción conservada, sin deformar). Con una sola, se centra.
  const imagenes = (y, imgs) => {
    const lista = imgs.slice(0, 2);
    if (!lista.length) return y;
    const cajas = lista.length === 1 ? [[CX0 + (CANCHO - IMG_DER[1]) / 2, IMG_DER[1]]] : [IMG_IZQ, IMG_DER];
    lista.forEach((src, i) => {
      const [x, ancho] = cajas[i];
      doc.setDrawColor(...LINEA_SUAVE); doc.setLineWidth(0.25); doc.rect(x, y, ancho, IMG_ALTO);
      try {
        const p = doc.getImageProperties(src); const k = Math.min((ancho - 4) / p.width, (IMG_ALTO - 4) / p.height);
        doc.addImage(src, /^data:image\/png/i.test(src) ? "PNG" : "JPEG", x + (ancho - p.width * k) / 2, y + (IMG_ALTO - p.height * k) / 2, p.width * k, p.height * k);
      } catch { doc.setFontSize(7); doc.setTextColor(150); doc.text("Imagen no disponible", x + ancho / 2, y + IMG_ALTO / 2, { align: "center" }); }
    });
    return y + IMG_ALTO;
  };

  // Renglones etiqueta/valor. Alto mínimo = renglón de la plantilla; crece si el texto se envuelve.
  const TAM_FILA = 10.3;
  const partes = (p, c) => {
    doc.setFontSize(TAM_FILA);
    doc.setFont("helvetica", "bold"); const le = doc.splitTextToSize(textoPDF(p.etiqueta), COLS[c].w * 0.5);
    doc.setFont("helvetica", "normal"); const va = doc.splitTextToSize(textoPDF(p.valor), COLS[c].w * 0.48);
    return { le, va, h: Math.max(RENGLON, 3.6 + Math.max(le.length, va.length) * 4) };
  };
  const dibujarFila = (c, yFin, p, pt) => {
    const { x, w } = COLS[c];
    const base = yFin - 1.6 - (Math.max(pt.le.length, pt.va.length) - 1) * 4;
    doc.setFontSize(TAM_FILA); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
    doc.text(pt.le, x, base + (Math.max(pt.le.length, pt.va.length) - pt.le.length) * 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...GRIS_VALOR);
    doc.text(pt.va, x + w, base + (Math.max(pt.le.length, pt.va.length) - pt.va.length) * 4, { align: "right" });
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(x, yFin, x + w, yFin);
  };
  const renglonVacio = (c, yFin) => { doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(COLS[c].x, yFin, COLS[c].x + COLS[c].w, yFin); };

  // Encabezado de columnas + renglones. Devuelve las filas que no cupieron (para la página siguiente).
  // relleno: dibuja renglones vacíos hasta «limiteRelleno» (aspecto de la plantilla).
  const columnas = (y, izq, der, limite, limiteRelleno, primera) => {
    const TIT = ["Características Generales", "Especificaciones"];
    const yTop = y + 4, yCab = yTop + 7.5;
    [izq, der].forEach((lista, c) => {
      if (!primera && !lista.length) return;
      const { x, w } = COLS[c];
      doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(x, yTop, x + w, yTop); doc.line(x, yCab, x + w, yCab);
      doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(0);
      doc.text(TIT[c], x + w / 2, yTop + 5.4, { align: "center" });
    });
    const resto = [[], []]; let yFin = yCab;
    [izq, der].forEach((lista, c) => {
      let yy = yCab + 3.8; // separación inicial de la plantilla
      lista.forEach((p) => {
        const pt = partes(p, c);
        if (resto[c].length || yy + pt.h > limite) { resto[c].push(p); return; }
        yy += pt.h; dibujarFila(c, yy, p, pt);
      });
      if (primera || lista.length) {
        if (!resto[c].length) while (yy + RENGLON <= limiteRelleno) { yy += RENGLON; renglonVacio(c, yy); }
      }
      yFin = Math.max(yFin, yy);
    });
    return { y: yFin + 3, resto };
  };

  const lineasDescripcion = (texto) => { doc.setFont("helvetica", "normal"); doc.setFontSize(9); return doc.splitTextToSize(textoPDF(texto), CANCHO - 6); };
  const descripcion = (y, lineas, limite) => {
    const caben = Math.max(0, Math.floor((limite - y - 16) / 3.9));
    if (caben <= 0) return { y, resto: lineas };
    y = franja(y + 1, "DESCRIPCIÓN TÉCNICA", { alto: 8.5, tam: 10 }) + 5;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(40);
    const ahora = lineas.slice(0, caben); doc.text(ahora, CX0 + 3, y);
    return { y: y + ahora.length * 3.9, resto: lineas.slice(caben) };
  };

  // Bloque discreto «ELABORACIÓN DE ESPECIFICACIONES TÉCNICAS» (última página, sobre el pie).
  const bloqueElaboracion = () => {
    if (!elab) return;
    const y = PIE_Y - ELAB_ALTO + 1;
    doc.setDrawColor(...LINEA_SUAVE); doc.setLineWidth(0.2); doc.line(CX0, y, CX1, y);
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.2); doc.setTextColor(70);
    doc.text("ELABORACIÓN DE ESPECIFICACIONES TÉCNICAS", CX0, y + 3.8);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.2); doc.setTextColor(90);
    const l1 = [`Empresa: ${elab.empresa}`, elab.vendedor && `Vendedor responsable: ${elab.vendedor}`, elab.elaborado_por && `Elaborado por: ${elab.elaborado_por}`].filter(Boolean).join("     ");
    const l2 = [elab.fecha && `Fecha: ${fechaCL(elab.fecha)}`, elab.cotizacion && `Cotización: ${elab.cotizacion}`, elab.version && `Versión ${elab.version}`].filter(Boolean).join("     ");
    doc.text(textoPDF(l1), CX0, y + 7.6); if (l2) doc.text(textoPDF(l2), CX0, y + 11.2);
  };

  const paginaNueva = (primera) => { if (!primera) doc.addPage(); const y = encabezado(); pie(); return y; };
  const LIM = PIE_Y - 3;

  fichas.forEach((f, idx) => {
    const ultima = idx === fichas.length - 1;
    const reservaElab = ultima && elab ? ELAB_ALTO : 0;
    let y = paginaNueva(idx === 0);
    y = idx === 0 ? tablaProceso(y) : y + 3.5;
    y = franja(y, f.nombre || "Producto sin nombre") + 3.8;
    if (f.imagenes.length) y = imagenes(y, f.imagenes) + 3.8;
    y = franja(y, "CARACTERÍSTICAS");
    const generales = [
      ...(f.marca ? [{ etiqueta: "MARCA", valor: f.marca }] : []),
      ...(f.modelo ? [{ etiqueta: "MODELO", valor: f.modelo }] : []),
      ...(f.color ? [{ etiqueta: "COLOR", valor: f.color }] : []),
      ...f.generales.filter((p) => !/^(marca|modelo|color)$/i.test(p.etiqueta.trim())),
    ];
    const desc = f.descripcion ? lineasDescripcion(f.descripcion) : [];
    const reservaDesc = desc.length ? 16 + Math.min(desc.length, 12) * 3.9 : 0;
    const limite = LIM - reservaElab;
    let r = columnas(y, generales, f.especificaciones, limite, limite - reservaDesc, true);
    let yAct = r.y;
    while (r.resto[0].length || r.resto[1].length) {
      let y2 = paginaNueva(false) + 3.5;
      y2 = franja(y2, `${f.nombre || "Producto"} (continuación)`) + 0.5;
      r = columnas(y2, r.resto[0], r.resto[1], limite, limite - reservaDesc, false);
      yAct = r.y;
    }
    let pendientes = desc; let fresca = false;
    while (pendientes.length) {
      const d = descripcion(yAct, pendientes, limite);
      if (d.resto.length === pendientes.length) { if (fresca) break; } // seguridad: no ciclar
      else { pendientes = d.resto; yAct = d.y; }
      if (pendientes.length) { const y3 = paginaNueva(false) + 3.5; yAct = franja(y3, `${f.nombre || "Producto"} (continuación)`) + 2; fresca = true; }
    }
  });
  bloqueElaboracion();

  // Numeración discreta en el pie.
  const total = doc.getNumberOfPages();
  if (total > 1) for (let p = 1; p <= total; p++) {
    doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(215);
    doc.text(`${p} / ${total}`, MX1 - 3, PIE_Y + 10, { align: "right" });
  }
  return doc;
}

// Nombre del archivo: el ID si existe; si no, fecha + institución (sin ID no queda "undefined" ni vacío).
// Con versión: EETT_<base>_v3.pdf.
export const nombreArchivoEETT = (cot, version) => {
  const c = cabeceraPublica(cot);
  const base = c.id_externo || [c.fecha, c.institucion].filter(Boolean).join("_") || "cotizacion";
  const limpio = base.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
  return `EETT_${limpio || "cotizacion"}${version ? `_v${version}` : ""}.pdf`;
};

// Navegador: carga jsPDF bajo demanda y genera el PDF en memoria (sin descargar ni guardar).
// La vista previa y la descarga usan exactamente esta misma función.
export async function generarPdfEETT(cot, items, { logo, elaboracion, version } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = crearPdfEETT(cot, items, { jsPDF, logo, elaboracion });
  return { blob: doc.output("blob"), nombre: nombreArchivoEETT(cot, version), paginas: doc.getNumberOfPages() };
}

// Descarga local en el dispositivo (el PDF no se sube a ningún servidor).
export function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function descargarPdfEETT(cot, items, opciones = {}) {
  const r = await generarPdfEETT(cot, items, opciones);
  descargarBlob(r.blob, r.nombre);
  return r;
}

// Huella SHA-256 del PDF (para el registro de metadatos).
export async function huellaPDF(blob) {
  const buf = await blob.arrayBuffer(); const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
