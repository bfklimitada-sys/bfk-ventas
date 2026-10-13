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
const IMG_ALTO_STD = 56, IMG_ALTO_MIN = 34, IMG_IZQ = [CX0, 82.3], IMG_DER = [103, 96.7];
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
  const imagenes = (y, imgs, IMG_ALTO = IMG_ALTO_STD) => {
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

  // ── Renglones etiqueta/valor (corrección 13/10/2026, caso 5602-269-COT26) ──
  // · Breves: etiqueta y valor lado a lado. · Extensos: etiqueta arriba y valor debajo con todo el ancho.
  // · Siempre alineados desde arriba; el alto de cada renglón se ajusta al texto real (sin superposiciones).
  // · Párrafos muy largos se dividen en bloques legibles y pueden continuar en la página siguiente
  //   (sin truncar ni alterar el texto: solo se reparten los saltos de línea).
  const FS = 10.3, FS_TXT = 9.4;                 // etiqueta/valor breve · valor extenso
  const lh = (fs) => fs * 0.3528 * 1.2;          // interlineado en mm
  const PAD_SUP = 5.0, PAD_INF = 2.3, GAP_ETQ = 1.0, GAP_PAR = 0.45; // GAP_PAR: fracción de línea entre bloques
  // Avance hasta la línea i: "" marca separación entre bloques (no se dibuja; suma media línea extra).
  const paso = (lineas, i, fs) => (i === 0 || lineas[i] === "" ? 0 : lh(fs) + (lineas[i - 1] === "" ? lh(fs) * GAP_PAR : 0));
  const altoLineas = (lineas, fs) => lineas.reduce((a, l, i) => a + paso(lineas, i, fs), 0);

  // Bloques legibles: respeta los saltos de línea originales; un párrafo muy largo sin saltos se reparte
  // en bloques de frases completas (no se cambia ni se omite ninguna palabra).
  const bloquesTexto = (s) => textoPDF(s).replace(/\r/g, "").split(/\n+/).map((x) => x.trim()).filter(Boolean).flatMap((par) => {
    if (par.length <= 420) return [par];
    const frases = par.split(/(?<=[.;])\s+(?=[A-ZÁÉÍÓÚÑ0-9•·(¿¡-])/);
    const out = []; let act = "";
    frases.forEach((f) => { if (act && (act + " " + f).length > 380) { out.push(act); act = f; } else act = act ? act + " " + f : f; });
    if (act) out.push(act);
    return out;
  });
  const lineasValor = (valor, ancho, fs) => {
    doc.setFont("helvetica", "normal"); doc.setFontSize(fs);
    const out = [];
    bloquesTexto(valor).forEach((b, i) => { if (i) out.push(""); out.push(...doc.splitTextToSize(b, ancho)); });
    return out;
  };

  // geo: { x, w, etq } — etq: ancho fijo de la columna de etiqueta (modo ancho completo) o null (columnas de la plantilla).
  const medirFila = (p, geo) => {
    const etiqueta = textoPDF(p.etiqueta), valor = textoPDF(p.valor);
    const multi = /\n/.test(valor);
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS);
    const anchoEtq = geo.etq || Math.min(doc.getTextWidth(etiqueta) + 0.5, geo.w * 0.52);
    const anchoMaxEtq = geo.etq ? geo.etq - 2 : geo.w * 0.52;
    const le = etiqueta ? doc.splitTextToSize(etiqueta, anchoMaxEtq) : [];
    const palabraCortada = etiqueta.split(/\s+/).some((w) => doc.getTextWidth(w) > anchoMaxEtq); // nunca partir una palabra
    if (etiqueta && !multi && le.length <= 2 && !palabraCortada) {
      const anchoVal = geo.w - anchoEtq - 3;
      const va = lineasValor(valor, anchoVal, FS);
      if (va.length <= (geo.etq ? 4 : 3)) {
        const n = Math.max(le.length, va.length, 1);
        return { tipo: "lado", le, va, fsV: FS, anchoEtq, h: Math.max(RENGLON, PAD_SUP + (n - 1) * lh(FS) + PAD_INF) };
      }
    }
    // Apilada: etiqueta completa arriba, valor debajo con todo el ancho disponible.
    const leA = etiqueta ? (doc.setFont("helvetica", "bold"), doc.setFontSize(FS), doc.splitTextToSize(etiqueta, geo.w)) : [];
    const fsV = valor.length > 140 || multi ? FS_TXT : FS;
    const va = lineasValor(valor, geo.w, fsV);
    return { tipo: "apilada", le: leA, va, fsV, h: altoApilada(leA, va, fsV) };
  };
  function altoApilada(le, va, fsV) {
    const hEtq = le.length ? (le.length - 1) * lh(FS) + GAP_ETQ + lh(fsV) : 0;
    return Math.max(RENGLON, PAD_SUP + hEtq + altoLineas(va, fsV) + PAD_INF);
  }
  // Divide una fila apilada para que su primera parte quepa en «disp» mm (mínimo 3 líneas de valor).
  const partirFila = (pt, disp) => {
    if (pt.tipo !== "apilada") return null;
    let k = 0;
    while (k < pt.va.length && altoApilada(pt.le, pt.va.slice(0, k + 1), pt.fsV) <= disp) k++;
    while (k > 0 && pt.va[k - 1] === "") k--;
    if (k < Math.min(3, pt.va.length) || k >= pt.va.length) return null;
    const resto = pt.va.slice(k); while (resto[0] === "") resto.shift();
    const etq = pt.le.length ? pt.le.join(" ").replace(/ \(continuación\)$/, "") + " (continuación)" : "";
    doc.setFont("helvetica", "bold"); doc.setFontSize(FS);
    const leR = etq ? doc.splitTextToSize(etq, pt.anchoTotal) : [];
    const a = { ...pt, va: pt.va.slice(0, k) }; a.h = altoApilada(a.le, a.va, a.fsV);
    const b = { ...pt, le: leR, va: resto }; b.h = altoApilada(b.le, b.va, b.fsV);
    return [a, b];
  };
  const dibujarLineas = (lineas, x, y, fs, opc) => { // y = línea base de la primera
    let yy = y;
    lineas.forEach((l, i) => {
      yy += paso(lineas, i, fs);
      if (l !== "") doc.text(l, x, yy, opc);
    });
  };
  const dibujarFila = (geo, yTop, pt, alinearDer) => {
    const { x, w } = geo; const yBase = yTop + PAD_SUP;
    doc.setFontSize(FS); doc.setFont("helvetica", "bold"); doc.setTextColor(0);
    if (pt.tipo === "lado") {
      dibujarLineas(pt.le, x, yBase, FS);
      doc.setFont("helvetica", "normal"); doc.setFontSize(pt.fsV); doc.setTextColor(...GRIS_VALOR);
      if (alinearDer) dibujarLineas(pt.va, x + w, yBase, pt.fsV, { align: "right" });
      else dibujarLineas(pt.va, x + pt.anchoEtq + 3, yBase, pt.fsV);
    } else {
      dibujarLineas(pt.le, x, yBase, FS);
      const yVal = yBase + (pt.le.length ? (pt.le.length - 1) * lh(FS) + GAP_ETQ + lh(pt.fsV) : 0);
      doc.setFont("helvetica", "normal"); doc.setFontSize(pt.fsV); doc.setTextColor(...GRIS_VALOR);
      dibujarLineas(pt.va, x, yVal, pt.fsV);
    }
    doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(x, yTop + pt.h, x + w, yTop + pt.h);
  };
  const renglonVacio = (c, yFin) => { doc.setDrawColor(...LINEA); doc.setLineWidth(0.2); doc.line(COLS[c].x, yFin, COLS[c].x + COLS[c].w, yFin); };
  const tituloSeccion = (x, w, yTop, texto) => {
    doc.setDrawColor(0); doc.setLineWidth(0.3); doc.line(x, yTop, x + w, yTop); doc.line(x, yTop + 7.5, x + w, yTop + 7.5);
    doc.setFont("helvetica", "bold"); doc.setFontSize(13.5); doc.setTextColor(0);
    doc.text(texto, x + w / 2, yTop + 5.4, { align: "center" });
    return yTop + 7.5;
  };
  const TIT = ["Características Generales", "Especificaciones"];
  const GEO_COL = COLS.map((c) => ({ x: c.x, w: c.w, etq: null }));
  const GEO_ANCHO = { x: COLS[0].x, w: COLS[1].x + COLS[1].w - COLS[0].x, etq: 58 };

  // ¿Caben ambas columnas (plantilla) en esta página sin filas extensas? Si no, se usa el modo de ancho completo.
  const caben2Columnas = (y, izq, der, limite) => {
    const yIni = y + 4 + 7.5 + 3.8;
    return [izq, der].every((lista, c) => {
      let yy = yIni;
      for (const p of lista) { const pt = medirFila(p, GEO_COL[c]); if (pt.tipo === "apilada" && pt.va.length > 8) return false; yy += pt.h; }
      return yy <= limite;
    });
  };
  // Plantilla: dos columnas con renglones de relleno hasta «limiteRelleno».
  const columnas = (y, izq, der, limiteRelleno) => {
    const yCab = y + 4 + 7.5; let yFin = yCab;
    [izq, der].forEach((lista, c) => {
      tituloSeccion(COLS[c].x, COLS[c].w, y + 4, TIT[c]);
      let yy = yCab + 3.8; // separación inicial de la plantilla
      lista.forEach((p) => { const pt = medirFila(p, GEO_COL[c]); dibujarFila(GEO_COL[c], yy, pt, true); yy += pt.h; });
      while (yy + RENGLON <= limiteRelleno) { yy += RENGLON; renglonVacio(c, yy); }
      yFin = Math.max(yFin, yy);
    });
    return yFin + 3;
  };
  const altoFlujo = (izq, der) => [izq, der].reduce((a, lista) => a + (lista.length ? 4 + 7.5 + 2 + 3 + lista.reduce((b, p) => b + medirFila(p, GEO_ANCHO).h, 0) : 0), 0);
  // Ancho completo: «Características Generales» y luego «Especificaciones», cada una a todo el ancho,
  // continuando en páginas siguientes solo cuando es necesario (orden y contenido originales).
  const flujo = (y, izq, der, limite, nuevaPagina) => {
    const g = GEO_ANCHO;
    [izq, der].forEach((lista, c) => {
      if (!lista.length) return;
      const cola = lista.map((p) => ({ ...medirFila(p, g), anchoTotal: g.w }));
      let primeraFila = true;
      // Título + primera fila (o sus 3 primeras líneas) deben quedar juntos.
      const minimo = (pt) => pt.tipo === "apilada" ? Math.min(pt.h, altoApilada(pt.le, pt.va.slice(0, 3), pt.fsV)) : pt.h;
      if (y + 4 + 7.5 + 2 + minimo(cola[0]) > limite) y = nuevaPagina();
      y = tituloSeccion(g.x, g.w, y + 4, TIT[c]) + 2;
      while (cola.length) {
        const pt = cola[0];
        if (y + pt.h <= limite) { dibujarFila(g, y, pt, false); y += pt.h; cola.shift(); primeraFila = false; continue; }
        const partes = partirFila(pt, limite - y);
        if (partes) { dibujarFila(g, y, partes[0], false); cola[0] = { ...partes[1], anchoTotal: g.w }; }
        else if (primeraFila) { dibujarFila(g, y, pt, false); y += pt.h; cola.shift(); continue; } // seguridad: nunca ciclar
        y = nuevaPagina();
        y = tituloSeccion(g.x, g.w, y + 4, `${TIT[c]} (continuación)`) + 2;
        primeraFila = true;
      }
      y += 3;
    });
    return y;
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
    const generales = [
      ...(f.marca ? [{ etiqueta: "MARCA", valor: f.marca }] : []),
      ...(f.modelo ? [{ etiqueta: "MODELO", valor: f.modelo }] : []),
      ...(f.color ? [{ etiqueta: "COLOR", valor: f.color }] : []),
      ...f.generales.filter((p) => !/^(marca|modelo|color)$/i.test(p.etiqueta.trim())),
    ];
    const desc = f.descripcion ? lineasDescripcion(f.descripcion) : [];
    const reservaDesc = desc.length ? 16 + Math.min(desc.length, 12) * 3.9 : 0;
    const limite = LIM - reservaElab;
    const continuar = () => franja(paginaNueva(false) + 3.5, `${f.nombre || "Producto"} (continuación)`) + 0.5;
    // Altura de las fotografías: si la ficha excede la página por poco, se reducen (sin deformarlas,
    // mínimo 34 mm) para no dejar una página casi vacía con uno o dos renglones. Se calcula ANTES de dibujar.
    const yTrasImg = (alto) => y + (f.imagenes.length ? alto + 3.8 : 0) + 10.3; // + franja «CARACTERÍSTICAS»
    let altoImg = IMG_ALTO_STD;
    if (f.imagenes.length && !caben2Columnas(yTrasImg(IMG_ALTO_STD), generales, f.especificaciones, limite)) {
      const exceso = yTrasImg(IMG_ALTO_STD) + altoFlujo(generales, f.especificaciones) - limite;
      if (exceso > 0 && exceso <= IMG_ALTO_STD - IMG_ALTO_MIN) altoImg = IMG_ALTO_STD - exceso - 0.5;
    }
    if (f.imagenes.length) y = imagenes(y, f.imagenes, altoImg) + 3.8;
    y = franja(y, "CARACTERÍSTICAS");
    let yAct;
    if (caben2Columnas(y, generales, f.especificaciones, limite)) yAct = columnas(y, generales, f.especificaciones, limite - reservaDesc);
    else yAct = flujo(y, generales, f.especificaciones, limite, continuar);
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
