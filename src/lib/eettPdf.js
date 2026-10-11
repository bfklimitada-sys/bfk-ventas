// ═══════════════════════════════════════════════════════════════
// PDF de EETT (Información técnica de productos), según el formato de referencia 1525570-33-COT26.pdf.
// Un único PDF con una ficha independiente por producto (cada ficha empieza en página nueva y, si sus
// características no caben, continúa en las páginas siguientes con la misma cabecera).
//
// Privacidad por construcción: solo recibe cabeceraPublica() y fichaPublica() (lib/cotizaciones.js);
// ningún precio, envío, enlace, proveedor ni recargo puede llegar aquí.
// Texto vectorial (jsPDF), no captura de pantalla: nítido, liviano y con texto seleccionable.
// ═══════════════════════════════════════════════════════════════
import { cabeceraPublica, fichaPublica } from "./cotizaciones.js";

export const CONTACTO_BFK = "bfklimitada@gmail.com  |  +56 9 97141822 / +56 9 57322538  |  Laja, Chile.";
const AZUL = [54, 96, 146];      // #366092 (cabecera y pie de la referencia)
const GRIS_BARRA = [64, 64, 64]; // #404040 (barras de título)
const GRIS_TEXTO = [96, 96, 96];
const LINEA = [170, 170, 170];

// Helvetica estándar (WinAnsi): se reemplazan los caracteres que no puede dibujar.
const REEMPLAZOS = { "“": '"', "”": '"', "„": '"', "‘": "'", "’": "'", "–": "-", "—": "-", "…": "...", "•": "·", "≥": ">=", "≤": "<=", "″": '"', "′": "'", "™": "(TM)", "€": "EUR", " ": " ", "​": "" };
export const textoPDF = (s) => String(s ?? "").replace(/[^\u0000-ÿ]/g, (c) => REEMPLAZOS[c] ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim();

const fechaCL = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : String(iso || ""); };

// cot: cotización (se usa SOLO cabeceraPublica); items: [{ ficha }]; opciones: { jsPDF, logo (dataURL), fechaGeneracion }
export function crearPdfEETT(cot, items, { jsPDF, logo } = {}) {
  if (!jsPDF) throw new Error("Falta jsPDF");
  const cab = cabeceraPublica(cot);
  const fichas = (items || []).map((it) => fichaPublica(it.ficha || it));
  if (!fichas.length) throw new Error("La cotización no tiene productos para la EETT.");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `EETT ${cab.id_externo || cab.nombre || cab.institucion}`.trim(), subject: "Información técnica de productos", author: "BFK Ingeniería y Servicios", creator: "BFK Datos" });
  const W = 210, H = 297, X0 = 10, X1 = 200, ANCHO = X1 - X0;
  const PIE_Y = 279; // inicio de la banda del pie
  const paginasFicha = []; // [{ ficha: n, pagina }]

  const marco = () => { doc.setDrawColor(40); doc.setLineWidth(0.3); doc.rect(5, 5, W - 10, H - 10); };

  const cabecera = () => {
    marco();
    const altoCab = 28, anchoLogo = 52;
    doc.setFillColor(...AZUL); doc.rect(5, 5, W - 10 - anchoLogo, altoCab, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(20);
    const cx = 5 + (W - 10 - anchoLogo) / 2;
    doc.text("INFORMACIÓN TÉCNICA DE", cx, 17, { align: "center" });
    doc.text("PRODUCTOS", cx, 26.5, { align: "center" });
    if (logo) {
      try { const p = doc.getImageProperties(logo); const wMax = anchoLogo - 6, hMax = altoCab - 6; const k = Math.min(wMax / p.width, hMax / p.height);
        doc.addImage(logo, "JPEG", W - 5 - anchoLogo + (anchoLogo - p.width * k) / 2, 5 + (altoCab - p.height * k) / 2, p.width * k, p.height * k); } catch { /* sin logo */ }
    }
    doc.setDrawColor(40); doc.line(5, 5 + altoCab, W - 5, 5 + altoCab);
    // Tabla de identificación (2 filas de títulos + valores), como la referencia.
    // Sin ID de Mercado Público, la primera fila omite esa columna y el nombre ocupa su espacio.
    const conId = !!cab.id_externo;
    const fila = (y, titulos, valores, colorPrimero, cols = [X0, X0 + 42, X0 + 150], anchos = [42, 108, 40]) => {
      doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.line(X0, y - 4, X1, y - 4); doc.line(X0, y + 1.5, X1, y + 1.5);
      doc.setFont("helvetica", "bold"); doc.setFontSize(6.8); doc.setTextColor(20);
      titulos.forEach((t, i) => doc.text(t, cols[i], y));
      doc.setFont("helvetica", "normal"); doc.setFontSize(7.2);
      valores.forEach((v, i) => {
        const txt = doc.splitTextToSize(textoPDF(v) || "-", anchos[i] - 2)[0];
        doc.setTextColor(...(i === 0 && colorPrimero ? [30, 60, 200] : [20, 20, 20]));
        doc.text(txt, cols[i] + anchos[i] / 2, y + 6.2, { align: "center" });
      });
    };
    if (conId) fila(42, ["ID LICITACIÓN", "NOMBRE LICITACIÓN", "FECHA EMISIÓN"], [cab.id_externo, cab.nombre, fechaCL(cab.fecha)], true);
    else fila(42, ["NOMBRE LICITACIÓN", "FECHA EMISIÓN"], [cab.nombre, fechaCL(cab.fecha)], false, [X0, X0 + 150], [150, 40]);
    fila(53, ["PLAZO ENTREGA", "INSTITUCIÓN SOLICITANTE", "RUT"], [cab.plazo, cab.institucion, cab.rut], false);
    doc.setDrawColor(...LINEA); doc.line(X0, 60.2, X1, 60.2);
    return 64; // y disponible
  };

  const pie = () => {
    doc.setFillColor(...AZUL); doc.rect(5, PIE_Y, W - 10, H - 5 - PIE_Y, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.text(CONTACTO_BFK, W / 2, PIE_Y + 8, { align: "center" });
  };

  const barra = (y, texto, { tam = 9 } = {}) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(tam);
    const lineas = doc.splitTextToSize(textoPDF(texto).toUpperCase(), ANCHO - 8).slice(0, 3);
    const alto = 4 + lineas.length * (tam * 0.42);
    doc.setFillColor(...GRIS_BARRA); doc.rect(X0, y, ANCHO, alto + 3, "F");
    doc.setTextColor(255); lineas.forEach((l, i) => doc.text(l, W / 2, y + 5 + i * (tam * 0.42), { align: "center" }));
    return y + alto + 3;
  };

  const imagenes = (y, imgs) => {
    const alto = 58; const n = Math.min(imgs.length, 2);
    if (!n) return y;
    const gap = 8; const ancho = n === 1 ? 110 : (ANCHO - gap) / 2;
    imgs.slice(0, 2).forEach((src, i) => {
      const x = n === 1 ? X0 + (ANCHO - ancho) / 2 : X0 + i * (ancho + gap);
      doc.setDrawColor(130); doc.setLineWidth(0.3); doc.rect(x, y, ancho, alto);
      try {
        const p = doc.getImageProperties(src); const k = Math.min((ancho - 6) / p.width, (alto - 6) / p.height);
        const fmt = /^data:image\/png/i.test(src) ? "PNG" : "JPEG";
        doc.addImage(src, fmt, x + (ancho - p.width * k) / 2, y + (alto - p.height * k) / 2, p.width * k, p.height * k);
      } catch { doc.setFontSize(7); doc.setTextColor(150); doc.text("Imagen no disponible", x + ancho / 2, y + alto / 2, { align: "center" }); }
    });
    return y + alto + 5;
  };

  // Dos columnas de pares etiqueta/valor; devuelve las filas que no cupieron (para la página siguiente).
  const COLW = 88, COL_X = [X0 + 2, X0 + 100];
  const altoFila = (p) => {
    doc.setFontSize(7.6);
    const le = doc.splitTextToSize(textoPDF(p.etiqueta), COLW * 0.48).length;
    const va = doc.splitTextToSize(textoPDF(p.valor), COLW * 0.5).length;
    return Math.max(6.4, 3 + Math.max(le, va) * 3.3);
  };
  const dibujarFila = (x, y, p, h) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.6); doc.setTextColor(20);
    doc.text(doc.splitTextToSize(textoPDF(p.etiqueta), COLW * 0.48), x, y + 4);
    doc.setFont("helvetica", "normal"); doc.setTextColor(...GRIS_TEXTO);
    doc.text(doc.splitTextToSize(textoPDF(p.valor), COLW * 0.5), x + COLW, y + 4, { align: "right" });
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.25); doc.line(x, y + h - 0.6, x + COLW, y + h - 0.6);
  };
  // primera: página inicial de la ficha (títulos de ambas columnas y líneas de relleno, como la referencia).
  // En las continuaciones solo se titula y dibuja la columna que aún tiene filas.
  const columnas = (y, izq, der, primera) => {
    const TIT = ["Características Generales", "Especificaciones"];
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.setTextColor(20); doc.setDrawColor(40); doc.setLineWidth(0.35);
    [izq, der].forEach((lista, c) => {
      if (!primera && !lista.length) return;
      doc.text(TIT[c], COL_X[c] + COLW / 2, y + 5, { align: "center" });
      doc.line(COL_X[c], y, COL_X[c] + COLW, y); doc.line(COL_X[c], y + 7.5, COL_X[c] + COLW, y + 7.5);
    });
    y += 9;
    const limite = PIE_Y - 4; const resto = [[], []]; let yFin = y;
    [izq, der].forEach((lista, c) => {
      let yy = y;
      lista.forEach((p) => {
        const h = altoFila(p);
        if (resto[c].length || yy + h > limite) { resto[c].push(p); return; }
        dibujarFila(COL_X[c], yy, p, h); yy += h;
      });
      // Líneas vacías de relleno (aspecto de la referencia), solo si la columna terminó en esta página.
      if (primera && !resto[c].length) for (let k = lista.length; k < 7 && yy + 6.4 <= limite; k++) { doc.setDrawColor(...LINEA); doc.line(COL_X[c], yy + 5.8, COL_X[c] + COLW, yy + 5.8); yy += 6.4; }
      yFin = Math.max(yFin, yy);
    });
    return { y: yFin + 3, resto };
  };

  const descripcion = (y, texto) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
    const lineas = doc.splitTextToSize(textoPDF(texto), ANCHO - 4);
    const limite = PIE_Y - 4; const caben = Math.max(0, Math.floor((limite - y - 9) / 3.6));
    if (caben <= 0) return { y, resto: lineas };
    y = barra(y, "DESCRIPCIÓN", { tam: 8.5 }) + 3;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(40);
    const ahora = lineas.slice(0, caben); doc.text(ahora, X0 + 2, y + 1);
    return { y: y + ahora.length * 3.6 + 2, resto: lineas.slice(caben) };
  };

  fichas.forEach((f, idx) => {
    if (idx > 0) doc.addPage();
    let y = cabecera(); pie();
    paginasFicha.push({ ficha: idx + 1, pagina: doc.getNumberOfPages() });
    y = barra(y, f.nombre || "Producto sin nombre") + 4;
    y = imagenes(y, f.imagenes);
    y = barra(y, "CARACTERÍSTICAS") + 2;
    const generales = [
      ...(f.marca ? [{ etiqueta: "MARCA", valor: f.marca }] : []),
      ...(f.modelo ? [{ etiqueta: "MODELO", valor: f.modelo }] : []),
      ...(f.color ? [{ etiqueta: "COLOR", valor: f.color }] : []),
      ...f.generales.filter((p) => !/^(marca|modelo|color)$/i.test(p.etiqueta.trim())),
    ];
    let r = columnas(y, generales, f.especificaciones, true);
    while (r.resto[0].length || r.resto[1].length) {
      doc.addPage(); let y2 = cabecera(); pie();
      y2 = barra(y2, `${f.nombre || "Producto"} (continuación)`) + 4;
      r = columnas(y2, r.resto[0], r.resto[1], false);
    }
    if (f.descripcion) {
      let d = descripcion(r.y, f.descripcion); let descLineas = d.resto;
      while (descLineas.length) {
        doc.addPage(); let y3 = cabecera(); pie();
        y3 = barra(y3, `${f.nombre || "Producto"} (continuación)`) + 4;
        d = descripcion(y3, descLineas.join(" ")); descLineas = d.resto;
        if (descLineas.length && d.y === y3) break; // seguridad: no ciclar
      }
    }
  });

  // Numeración discreta en el pie: "Producto x de n · página".
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const fi = [...paginasFicha].reverse().find((x) => x.pagina <= p)?.ficha || 1;
    doc.setFont("helvetica", "normal"); doc.setFontSize(6.5); doc.setTextColor(225);
    doc.text(`Producto ${fi} de ${fichas.length}  ·  Página ${p} de ${total}`, X1, PIE_Y + 13, { align: "right" });
  }
  return doc;
}

// Nombre del archivo: el ID si existe; si no, fecha + institución (sin ID no queda "undefined" ni vacío).
export const nombreArchivoEETT = (cot) => {
  const c = cabeceraPublica(cot);
  const base = c.id_externo || [c.fecha, c.institucion].filter(Boolean).join("_") || "cotizacion";
  const limpio = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
  return `EETT_${limpio || "cotizacion"}.pdf`;
};

// Navegador: carga jsPDF bajo demanda, genera y descarga. Devuelve { blob, nombre, paginas }.
export async function descargarPdfEETT(cot, items, { logo } = {}) {
  const { jsPDF } = await import("jspdf");
  const doc = crearPdfEETT(cot, items, { jsPDF, logo });
  const nombre = nombreArchivoEETT(cot);
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { blob, nombre, paginas: doc.getNumberOfPages() };
}

// Huella SHA-256 del PDF (para eett_documentos.hash).
export async function huellaPDF(blob) {
  const buf = await blob.arrayBuffer(); const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
