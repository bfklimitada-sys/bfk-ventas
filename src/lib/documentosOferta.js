// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// Documentación de la oferta (25/11/2026): Cotización económica, Información técnica de productos (EETT) y Oferta
// técnica y económica consolidada. UN SOLO generador para Mercado Público y Ventas privadas: solo cambian los datos.
//
// Diseño: referencias entregadas por Kevin (BFK_Ejemplo_Cotizacion.pdf, BFK_Ejemplo_EETT.pdf,
// BFK_Ejemplo_Oferta_Tecnica_Economica.pdf). Medidas, colores y tamaños tomados de esos PDF (A4, márgenes 9,9 mm,
// banda azul #355B85 con el título y logotipo a la derecha, barras gris oscuro #3E3E3E, filas de categoría celeste
// #E8EEF5, líneas finas #CFD3D8, pie con línea y banda azul). Son referencias de diseño: ningún texto, producto, precio
// ni condición de esos ejemplos se usa como valor predeterminado.
// Fuente: Liberation Sans (métricas de Arial), incorporada al PDF (lib/fuentesDocumento.js).
//
// Privacidad por construcción: el generador recibe SOLO el «modelo público» (modeloOferta*), que no contiene costos,
// márgenes, comisiones, proveedores, enlaces de compra, financiamiento ni datos internos. La EETT no imprime precios.
// Determinismo: con el mismo modelo, imágenes y fuentes el PDF es idéntico byte a byte (fecha de creación = fecha de
// emisión e identificador de archivo = huella del modelo): la vista previa es el documento que se emite y cualquier
// versión emitida se puede volver a descargar idéntica.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
import { FAMILIA, registrarFuentes } from "./fuentesDocumento.js";

export const GENERADOR = "oferta-1";
export const TIPOS_DOCUMENTO = {
  oferta: { prefijo: "OFERTA", titulo: "OFERTA TÉCNICA Y ECONÓMICA", subtitulo: "COTIZACIÓN", nombre: "Oferta técnica y económica" },
  cotizacion: { prefijo: "COT", titulo: "COTIZACIÓN ECONÓMICA", subtitulo: "BFK LIMITADA", nombre: "Cotización económica" },
  eett: { prefijo: "EETT", titulo: "INFORMACIÓN TÉCNICA", subtitulo: "DE PRODUCTOS", nombre: "Especificaciones técnicas (EETT)" },
};
export const CONTACTO_BFK = "bfklimitada@gmail.com  |  +56 9 97141822 / +56 9 57322538  |  Laja, Chile";

// ── Paleta y geometría (mm), según las referencias ──
const AZUL = [53, 91, 133], OSCURO = [62, 62, 62], CELESTE = [232, 238, 245], LINEA = [207, 211, 216];
const TINTA = [34, 34, 34], SUAVE = [92, 92, 92], BLANCO = [255, 255, 255];
const X0 = 9.9, X1 = 200.1, ANCHO = X1 - X0, PT = 0.3528;
const L_FINA = 0.45 * PT, L_PIE = 0.6 * PT, L_CAB = 0.8 * PT;
const Y_CONT = 44.6, Y_LIM = 266.5;                       // inicio del contenido y límite sobre el pie
const COL_VALOR = 90.7;                                    // columna de valores de las tablas «característica / valor»
const ASC = 0.80;                                          // posición de la línea base respecto del borde superior del texto (× tamaño en mm)

// ── Texto ──
export const textoDoc = (s) => String(s ?? "").normalize("NFC")
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200B}-\u{200D}\u{2060}\u{E000}-\u{F8FF}]/gu, "")   // emojis y símbolos sin glifo
  .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\t/g, " ").trim();
export const pesos = (n) => {
  const v = Math.round(Number(n) || 0); const s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${v < 0 ? "-" : ""}$${s}`;
};
export const fechaCL = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || ""); };
export const dosDigitos = (n) => String(Math.max(0, Math.trunc(Number(n) || 0))).padStart(2, "0");
const cantidadTexto = (q, unidad) => {
  const n = Number(q) || 0; const t = Number.isInteger(n) ? String(n) : String(n).replace(".", ",");
  const u = String(unidad || "").trim();
  if (!u || /^(un|und|unid|unidad|unidades|c\/u)$/i.test(u)) return `${t} ${n === 1 ? "unidad" : "unidades"}`;
  return `${t} ${u}`;
};

// ── Nombre de archivo: COT_<referencia>_v1.pdf · EETT_… · OFERTA_… ──
export function nombreArchivoOferta(tipo, modelo) {
  const ref = String(modelo?.referencia || "cotizacion").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "cotizacion";
  return `${TIPOS_DOCUMENTO[tipo]?.prefijo || "DOC"}_${ref}_v${Math.max(1, Math.trunc(Number(modelo?.version) || 1))}.pdf`;
}

// ── Fichas de la EETT: líneas con ficha técnica idéntica se presentan en UNA ficha con la cantidad total ──
const clavePublica = (it) => JSON.stringify([it.nombre, it.marca, it.modelo, it.ficha?.descripcion, it.ficha?.categorias, it.ficha?.imagenes, it.ficha?.condiciones]);
export function fichasEETT(modelo) {
  const grupos = [];
  for (const it of modelo?.items || []) {
    if (it.sin_ficha) continue;
    const k = clavePublica(it);
    const g = grupos.find((x) => x.clave === k && String(x.unidad || "") === String(it.unidad || ""));
    if (g) { g.items.push(it.n); g.cantidad += Number(it.cantidad) || 0; }
    else grupos.push({ clave: k, items: [it.n], cantidad: Number(it.cantidad) || 0, unidad: it.unidad, item: it });
  }
  return grupos;
}

// ── Avisos antes de emitir (datos faltantes, inconsistencias, formato). No bloquean salvo «bloqueo». ──
export function revisarModeloOferta(modelo, tipo = "oferta") {
  const av = []; const m = modelo || {};
  const falta = (cond, mensaje, nivel = "revisar") => { if (cond) av.push({ nivel, mensaje }); };
  falta(!m.items?.length, "La cotización no tiene productos.", "bloqueo");
  falta(!String(m.referencia || "").trim(), m.canal === "mp" ? "Falta el ID de la Compra Ágil o licitación: el documento usará la fecha como referencia." : "Falta el número de cotización.");
  falta(!String(m.cliente?.nombre || "").trim(), m.canal === "mp" ? "Falta la institución solicitante." : "Falta el nombre o razón social del cliente.", "bloqueo");
  if (m.canal === "mp") falta(!String(m.cliente?.rut || "").trim(), "Falta el RUT de la institución.");
  falta(!String(m.cliente?.direccion || "").trim(), "Falta la dirección de entrega.");
  if (tipo !== "eett") {
    (m.items || []).forEach((it) => falta(!(Number(it.unitario) > 0), `Ítem ${dosDigitos(it.n)}: falta el precio unitario.`, "bloqueo"));
    falta(!(m.condiciones || []).some((c) => /plazo/i.test(c.titulo)), "No se indicó el plazo de entrega.");
    falta(!(m.condiciones || []).some((c) => /vigencia/i.test(c.titulo)), "No se indicó la vigencia de la oferta.");
    falta(!String(m.vendedor || "").trim(), "Falta el vendedor responsable.");
  }
  if (tipo !== "cotizacion") {
    for (const it of m.items || []) {
      if (it.sin_ficha) continue;
      const f = it.ficha || {};
      falta(!(f.imagenes || []).length, `Ítem ${dosDigitos(it.n)}: sin fotografías.`);
      falta(!(f.categorias || []).some((c) => c.filas?.length), `Ítem ${dosDigitos(it.n)}: sin especificaciones técnicas.`);
      for (const c of f.categorias || []) for (const r of c.filas || []) {
        if (r.contradictorio) av.push({ nivel: "revisar", mensaje: `Ítem ${dosDigitos(it.n)}: «${r.etiqueta}» tiene valores distintos; elige uno antes de emitir.` });
        if (r.incompleto) av.push({ nivel: "revisar", mensaje: `Ítem ${dosDigitos(it.n)}: «${r.etiqueta}» no tiene un valor informado.` });
      }
    }
    const porVerificar = (m.matriz || []).filter((r) => r.estado === "por_verificar").length;
    falta(porVerificar > 0, `La matriz de cumplimiento tiene ${porVerificar} requisito${porVerificar === 1 ? "" : "s"} «Por verificar».`);
  }
  // Datos comerciales colados en textos técnicos (nunca deben ir al documento técnico).
  for (const it of m.items || []) {
    const textos = [it.nombre, it.ficha?.descripcion, ...(it.ficha?.categorias || []).flatMap((c) => (c.filas || []).flatMap((r) => [r.etiqueta, r.valor]))];
    const t = textos.find((x) => /\$\s?\d|https?:\/\/|www\./i.test(String(x || "")));
    if (t) av.push({ nivel: "bloqueo", mensaje: `Ítem ${dosDigitos(it.n)}: la información técnica contiene un precio o enlace («${String(t).slice(0, 50)}»). Quítalo antes de emitir.` });
  }
  return av;
}

// ═══════════════════════════════ Generador ═══════════════════════════════
// opciones: { jsPDF, fuentes: {normal, bold} (base64), logo (dataURL), imagenes: { ref → dataURL }, id: huella (hex) }
export function crearDocumentoOferta(tipo, modelo, opciones = {}) {
  if (!TIPOS_DOCUMENTO[tipo]) throw new Error(`Tipo de documento desconocido: ${tipo}`);
  if (!modelo?.items?.length) throw new Error("La cotización no tiene productos.");
  if (tipo !== "oferta") return componer(tipo, modelo, opciones, null).doc;
  // Oferta consolidada: primera pasada para conocer la página de cada ficha técnica (se cita en el detalle).
  const borrador = componer(tipo, modelo, opciones, {});
  return componer(tipo, modelo, opciones, borrador.paginasFicha).doc;
}

function componer(tipo, modelo, { jsPDF, fuentes, logo, imagenes = {}, id } = {}, paginasFicha) {
  if (!jsPDF) throw new Error("Falta jsPDF");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const conFuente = registrarFuentes(doc, fuentes);
  const FAM = conFuente ? FAMILIA : "helvetica";
  const T = TIPOS_DOCUMENTO[tipo];
  doc.setProperties({ title: `${T.nombre} ${modelo.referencia || ""}`.trim(), subject: T.nombre, author: "BFK Limitada", creator: `BFK Datos (${GENERADOR})`, keywords: `version ${modelo.version || 1}` });
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(String(modelo.fecha || "")) ? new Date(`${String(modelo.fecha).slice(0, 10)}T12:00:00Z`) : new Date(Date.UTC(2026, 0, 1));
  try { doc.setCreationDate(fecha); } catch { /* versiones antiguas de jsPDF */ }
  try { if (id) doc.setFileId(String(id).replace(/[^0-9a-f]/gi, "").slice(0, 32).padEnd(32, "0").toUpperCase()); } catch { /* idem */ }

  // ── Primitivas ──
  const fuente = (negrita, tam, color = TINTA) => { doc.setFont(FAM, negrita ? "bold" : "normal"); doc.setFontSize(tam); doc.setTextColor(...color); };
  const base = (top, tam) => top + tam * PT * ASC;                          // línea base desde el borde superior del texto
  const escribir = (s, x, top, tam, opc) => doc.text(textoDoc(s), x, base(top, tam), opc);
  const lineas = (s, ancho) => doc.splitTextToSize(textoDoc(s), ancho);
  const altoLinea = (tam) => tam * PT * 1.22;
  const rect = (x, y, w, h, relleno, borde = null) => {
    if (relleno) doc.setFillColor(...relleno);
    if (borde) { doc.setDrawColor(...borde); doc.setLineWidth(L_FINA); }
    doc.rect(x, y, w, h, relleno && borde ? "FD" : relleno ? "F" : "S");
  };
  const linea = (y, x0 = X0, x1 = X1, color = LINEA, grosor = L_FINA) => { doc.setDrawColor(...color); doc.setLineWidth(grosor); doc.line(x0, y, x1, y); };
  const imagen = (ref, x, y, w, h, alinear = "centro") => {
    const src = String(ref || "").startsWith("data:") ? ref : imagenes[ref];
    if (!src) return false;
    try {
      const p = doc.getImageProperties(src); const k = Math.min(w / p.width, h / p.height);
      const iw = p.width * k, ih = p.height * k;
      const ix = alinear === "centro" ? x + (w - iw) / 2 : x;
      doc.addImage(src, /^data:image\/png/i.test(src) ? "PNG" : "JPEG", ix, y + (h - ih) / 2, iw, ih, undefined, "FAST");
      return true;
    } catch { return false; }
  };

  // ── Página: encabezado y pie ──
  const ref = textoDoc(modelo.referencia || fechaCL(modelo.fecha));
  const version = dosDigitos(modelo.version || 1);
  let cabecera = { titulo: T.titulo, subtitulo: T.subtitulo };
  const encabezado = () => {
    rect(X0, 9.2, 143.7, 18.3, AZUL);
    fuente(true, 16, BLANCO); escribir(cabecera.titulo, 14.1, 12.5, 16);
    fuente(true, 11, BLANCO); escribir(cabecera.subtitulo, 14.1, 20.2, 11);
    if (logo) imagen(logo, X0 + 143.7 + 2.4, 9.2, X1 - (X0 + 143.7 + 2.4), 18.3);
    linea(27.5, X0, X1, AZUL, L_CAB);
    fuente(true, 8, SUAVE);
    escribir("REFERENCIA", X0, 30.9, 8); escribir("OPERACIÓN", 67.0, 30.9, 8); escribir("FECHA DE EMISIÓN", 128.0, 30.9, 8); escribir("VERSIÓN", 165.6, 30.9, 8);
    fuente(true, 10);
    const corta = (s, w) => { const ls = lineas(s, w); return ls.length > 1 ? `${ls[0].replace(/\s+\S*$/, "")}…` : ls[0] || ""; };
    doc.text(corta(ref, 55), X0, base(35.3, 10));
    doc.text(corta(modelo.operacion || "", 58), 67.0, base(35.3, 10));
    escribir(fechaCL(modelo.fecha), 128.0, 35.3, 10); escribir(version, 165.6, 35.3, 10);
    linea(40.9);
    return Y_CONT;
  };
  const pie = (n, total) => {
    linea(270.2, X0, X1, AZUL, L_PIE);
    fuente(false, 8, SUAVE);
    escribir(`BFK Limitada  |  ${T.nombre} ${ref}  |  Versión ${version}`, X0, 272.9, 8);
    rect(X0, 279.4, ANCHO, 8.8, AZUL);
    fuente(false, 8.5, BLANCO); escribir(CONTACTO_BFK, 13.1, 282.7, 8.5);
    escribir(`${n} / ${total}`, X1 - 3.2, 282.7, 8.5, { align: "right" });
  };

  let y = 0; let primera = true;
  const nuevaPagina = (cab) => { if (cab) cabecera = cab; if (!primera) doc.addPage(); primera = false; y = encabezado(); return y; };
  const cabe = (h) => y + h <= Y_LIM;
  const asegurar = (h) => { if (!cabe(h)) nuevaPagina(); };

  // ── Bloques ──
  const barra = (titulo, color = OSCURO) => { rect(X0, y, ANCHO, 7.8, color, LINEA); fuente(true, 11, BLANCO); escribir(String(titulo).toUpperCase(), 13.1, y + 2.2, 11); y += 7.8; };
  const filaCategoria = (titulo) => { rect(X0, y, ANCHO, 6.0, CELESTE); fuente(true, 10, AZUL); escribir(titulo, 12.7, y + 1.6, 10); y += 6.0; };
  // Fila «característica / valor»: la etiqueta y el valor nunca se separan; la fila crece con el texto.
  const medirPar = (etq, valor) => {
    fuente(true, 10); const le = lineas(etq, COL_VALOR - 12.7 - 3);
    fuente(false, 10); const lv = lineas(valor, X1 - COL_VALOR - 2);
    const n = Math.max(1, le.length, lv.length);
    return { le, lv, h: Math.max(6.3, 1.65 + n * altoLinea(10) + 0.6) };
  };
  const dibujarPar = (pt) => {
    fuente(true, 10); pt.le.forEach((l, i) => doc.text(l, 12.7, base(y + 1.65 + i * altoLinea(10), 10)));
    fuente(false, 10); pt.lv.forEach((l, i) => doc.text(l, COL_VALOR, base(y + 1.65 + i * altoLinea(10), 10)));
    y += pt.h; linea(y);
  };
  const medirParrafo = (texto, tam = 10) => { fuente(false, tam); const ls = lineas(texto, ANCHO - 5.6); return { ls, h: 1.65 + ls.length * altoLinea(tam) + 1.2 }; };
  const dibujarParrafo = (pt, tam = 10) => { fuente(false, tam); pt.ls.forEach((l, i) => doc.text(l, 12.7, base(y + 1.65 + i * altoLinea(tam), tam))); y += pt.h; linea(y); };

  const prepararSecciones = (secciones) => secciones.map((s) => ({ titulo: s.titulo, filas: s.filas.map((r) => (r.parrafo ? { parrafo: true, ...medirParrafo(r.valor) } : medirPar(r.etiqueta, r.valor))) })).filter((s) => s.filas.length);
  const altoTablaPares = (secciones) => { const secs = prepararSecciones(secciones); return secs.length ? 7.8 + secs.reduce((a, s) => a + (s.titulo ? 6.0 : 0) + s.filas.reduce((b, f) => b + f.h, 0), 0) + 4.4 : 0; };
  // Tabla de pares con secciones (categorías). Mantiene título de sección con al menos 2 filas y nunca deja una
  // sola fila al comienzo de la página siguiente; las secciones que continúan repiten su título «(continuación)».
  const tablaPares = (titulo, secciones, { colorBarra = AZUL } = {}) => {
    const secs = prepararSecciones(secciones);
    if (!secs.length) return;
    const minimoSec = (s) => (s.titulo ? 6.0 : 0) + s.filas.slice(0, 2).reduce((a, f) => a + f.h, 0);
    asegurar(7.8 + minimoSec(secs[0]));
    barra(titulo, colorBarra);
    secs.forEach((s) => {
      if (s.titulo) { if (!cabe(minimoSec(s))) { nuevaPagina(); barra(`${titulo} (continuación)`, colorBarra); } filaCategoria(s.titulo); }
      s.filas.forEach((f, i) => {
        const restantes = s.filas.length - i;
        // Evitar huérfanas: si después de esta fila quedaría solo una para la página siguiente, se pasan ambas.
        const necesita = restantes === 2 && !cabe(f.h + s.filas[i + 1].h) ? f.h + s.filas[i + 1].h : f.h;
        if (!cabe(necesita)) { nuevaPagina(); barra(`${titulo} (continuación)`, colorBarra); if (s.titulo) filaCategoria(`${s.titulo} (continuación)`); }
        if (f.parrafo) dibujarParrafo(f); else dibujarPar(f);
      });
    });
    y += 4.4;
  };

  // Tabla con encabezado de columnas (detalle de la oferta, matriz): el encabezado se repite en cada página.
  const tablaColumnas = (titulo, columnas, filas, { altoEnc = 8.1, despuesFila } = {}) => {
    const encabezadoTabla = (cont) => {
      if (titulo) barra(cont ? `${titulo} (continuación)` : titulo);
      rect(X0, y, ANCHO, altoEnc, CELESTE, LINEA); fuente(true, 9.5, AZUL);
      columnas.forEach((c) => escribir(c.titulo, c.alinear === "derecha" ? c.x + c.w : c.alinear === "centro" ? c.x + c.w / 2 : c.x, y + (altoEnc - 9.5 * PT) / 2 - 0.2, 9.5, c.alinear === "derecha" ? { align: "right" } : c.alinear === "centro" ? { align: "center" } : undefined));
      y += altoEnc;
    };
    asegurar((titulo ? 7.8 : 0) + altoEnc + (filas[0]?.h || 6.3));
    encabezadoTabla(false);
    filas.forEach((f) => {
      if (!cabe(f.h)) { nuevaPagina(); encabezadoTabla(true); }
      f.dibujar(y); y += f.h; linea(y);
      despuesFila?.(f);
    });
  };

  // ── Secciones del documento ──
  const datosPartes = () => {
    const caja = (x, titulo, filas) => {
      rect(x, y, 93.4, 7.1, CELESTE, LINEA); fuente(true, 10, AZUL); escribir(titulo, x + 2.8, y + 2.2, 10);
      let yy = y + 9.9;
      filas.filter((f) => String(f.texto || "").trim()).forEach((f) => {
        fuente(!!f.negrita, 10); const ls = lineas(f.texto, 90);
        ls.forEach((l) => { doc.text(l, x + 2.8, base(yy, 10)); yy += 5.3; });
      });
      return yy;
    };
    const e = modelo.empresa || {}; const c = modelo.cliente || {};
    const prov = [{ texto: e.nombre || "BFK Limitada", negrita: true }, { texto: e.rut && `RUT: ${e.rut}` }, { texto: e.giro && `Giro: ${e.giro}` },
      { texto: e.direccion && `Dirección: ${e.direccion}` }, { texto: e.correo && `Correo: ${e.correo}` }, { texto: e.telefono && `Teléfono: ${e.telefono}` },
      { texto: modelo.vendedor && `Vendedor responsable: ${modelo.vendedor}` }];
    const cli = [{ texto: c.nombre, negrita: true }, ...(c.filas || []).map(([t, v]) => ({ texto: v && `${t}: ${v}` }))];
    const alto = (fs) => 9.9 + fs.filter((f) => String(f.texto || "").trim()).reduce((a, f) => { fuente(!!f.negrita, 10); return a + lineas(f.texto, 90).length * 5.3; }, 0);
    asegurar(Math.max(alto(prov), alto(cli)) + 3);
    const y1 = caja(X0, "DATOS DEL PROVEEDOR", prov); const y2 = caja(106.8, "DATOS DEL CLIENTE", cli);
    y = Math.max(y1, y2) + 2.6;
  };

  const conImagenes = (modelo.items || []).some((it) => (it.ficha?.imagenes || []).length);
  const COLS_DET = [
    { titulo: "Ítem", x: 12.7, w: 10 },
    { titulo: "Producto ofertado", x: 25.4, w: 90 },
    { titulo: "Cant.", x: 112.1, w: 16, alinear: "derecha" },
    { titulo: "Unit. neto", x: 135.0, w: 28.0, alinear: "derecha" },
    { titulo: "Total neto", x: 166.0, w: 31.3, alinear: "derecha" },
  ];
  const detalle = () => {
    const xTexto = conImagenes ? 46.2 : 25.4; const anchoTexto = 113.5 - xTexto - 3;
    const filas = (modelo.items || []).map((it) => {
      fuente(true, 10); const ln = lineas(it.nombre, anchoTexto);
      fuente(false, 9.5); const sub = [it.marca, it.modelo].filter(Boolean).join(" ") ; const ls = sub ? lineas(sub, anchoTexto) : [];
      const pag = paginasFicha && paginasFicha[it.n];
      const alto = 2.5 + ln.length * altoLinea(10) + ls.length * altoLinea(9.5) + (paginasFicha ? altoLinea(8.5) + 0.6 : 0) + 2.6;
      const h = Math.max(conImagenes ? 17.3 : 9.5, alto);
      return { h, dibujar: (y0) => {
        const medio = y0 + h / 2;
        fuente(true, 10); escribir(dosDigitos(it.n), 12.7, medio - 3.25, 10);
        const img = (it.ficha?.imagenes || [])[0];
        if (conImagenes && img) imagen(img, 24.0, y0 + (h - 14.1) / 2, 19.8, 14.1);
        let yy = y0 + 2.5;
        fuente(true, 10); ln.forEach((l) => { doc.text(l, xTexto, base(yy, 10)); yy += altoLinea(10); });
        fuente(false, 9.5); ls.forEach((l) => { doc.text(l, xTexto, base(yy + 0.2, 9.5)); yy += altoLinea(9.5); });
        if (paginasFicha) { fuente(false, 8.5, SUAVE); escribir(pag ? `Ficha técnica: pág. ${pag}` : "Ficha técnica: sin ficha", xTexto, yy + 0.9, 8.5); }
        fuente(false, 10);
        escribir(String(it.cantidad).replace(".", ","), 128.1, medio - 3.25, 10, { align: "right" });
        escribir(pesos(it.unitario), 163.0, medio - 3.25, 10, { align: "right" });
        escribir(pesos(it.total), 197.3, medio - 3.25, 10, { align: "right" });
      } };
    });
    tablaColumnas("Detalle de la oferta", COLS_DET, filas);
  };

  const totales = () => {
    const t = modelo.totales || {};
    const filas = [["Subtotal neto", pesos(t.neto)], ...(t.despacho_texto != null ? [["Despacho", t.despacho_texto]] : []),
      [t.exenta ? "IVA (exento)" : `IVA ${t.tasa_iva ?? 19}%`, pesos(t.iva)]];
    const nota = textoDoc(t.nota || "");
    fuente(false, 9); const ln = nota ? lineas(nota, 96) : [];
    const h = filas.length * 8.5 + 8.5;
    asegurar(Math.max(h, ln.length * 3.8) + 3);
    const y0 = y + 2.4;
    fuente(false, 9, SUAVE); ln.forEach((l, i) => doc.text(l, X0, base(y0 + 1.6 + i * 3.7, 9)));
    let yy = y0;
    filas.forEach(([e, v]) => { fuente(false, 10.5); escribir(e, 116.8, yy + 2.7, 10.5); escribir(v, 197.3, yy + 2.7, 10.5, { align: "right" }); yy += 8.5; linea(yy, 113.9); });
    rect(113.9, yy, X1 - 113.9, 8.5, AZUL, LINEA); fuente(true, 10.5, BLANCO);
    escribir("TOTAL OFERTA", 116.8, yy + 2.7, 10.5); escribir(pesos(t.total), 197.3, yy + 2.7, 10.5, { align: "right" });
    y = Math.max(yy + 8.5, y0 + ln.length * 3.7) + 4.4;
  };

  const condiciones = () => {
    const cs = (modelo.condiciones || []).filter((c) => String(c.valor || "").trim());
    if (!cs.length) return;
    tablaPares("Condiciones comerciales", [{ titulo: "", filas: cs.map((c) => ({ etiqueta: c.titulo, valor: c.valor })) }], { colorBarra: OSCURO });
  };

  const ESTADO = { cumple: "Cumple", no_cumple: "No cumple", por_verificar: "Por verificar" };
  const filasMatriz = (filasM) => filasM.map((r) => {
    fuente(true, 10); const lr = lineas(r.requisito, 74); fuente(false, 10); const lo = lineas(r.ofertado || "—", 74);
    const n = Math.max(lr.length, lo.length, 1); const h = Math.max(6.3, 1.65 + n * altoLinea(10) + 0.6);
    return { h, dibujar: (y0) => {
      fuente(true, 10); lr.forEach((l, i) => doc.text(l, 12.3, base(y0 + 1.65 + i * altoLinea(10), 10)));
      fuente(false, 10); lo.forEach((l, i) => doc.text(l, 89.6, base(y0 + 1.65 + i * altoLinea(10), 10)));
      fuente(true, 9.5); escribir(ESTADO[r.estado] || "Por verificar", 166.6, y0 + 1.9, 9.5);
    } };
  });
  const altoMatriz = (filasM) => (filasM.length ? 7.8 + 6.0 + filasMatriz(filasM).reduce((a, f) => a + f.h, 0) + 4.4 : 0);
  const matrizTabla = (titulo, filasM) => {
    if (!filasM.length) return;
    const cols = [{ titulo: "Requisito", x: 12.3, w: 74 }, { titulo: "Ofertado", x: 89.6, w: 74 }, { titulo: "Estado", x: 166.6, w: 31 }];
    tablaColumnas(titulo, cols, filasMatriz(filasM), { altoEnc: 6.0 });
    y += 4.4;
  };

  // Ficha técnica de un producto (o de varias líneas idénticas). Se mantiene junta la cabecera con las fotografías y
  // el comienzo de las especificaciones; varias fichas comparten página cuando hay espacio.
  // Reglas: una ficha completa que cabe en el espacio restante comparte página; si no cabe ahí pero sí en una página
  // nueva, empieza en página nueva; si es más larga que una página, primero se reducen las fotografías (sin deformarlas,
  // mínimo 30 mm) y, si aún no cabe, continúa en la página siguiente con títulos «(continuación)».
  const ficha = (g, paginas) => {
    const it = g.item; const f = it.ficha || {};
    const imgs = (f.imagenes || []).slice(0, 4);
    const secciones = [];
    if (String(f.descripcion || "").trim()) secciones.push({ titulo: "Descripción técnica", filas: [{ parrafo: true, valor: f.descripcion }] });
    for (const c of f.categorias || []) if (c.filas?.length) secciones.push({ titulo: c.titulo, filas: c.filas.map((r) => ({ etiqueta: r.etiqueta, valor: r.valor })) });
    const cond = (f.condiciones || []).filter((c) => String(c.valor || "").trim());
    const req = (modelo.matriz || []).filter((r) => g.items.includes(r.item));
    const altoCuerpo = altoTablaPares(secciones) + (cond.length ? altoTablaPares([{ titulo: "", filas: cond.map((c) => ({ etiqueta: c.titulo, valor: c.valor })) }]) - 2.2 : 0) + (req.length ? altoMatriz(req) - 2.2 : 0);
    const altoCab = (hImg) => 7.8 + 8.8 + (imgs.length ? hImg + 2.2 : 0);
    let altoImg = imgs.length ? (imgs.length <= 2 ? 40.2 : 34.0) : 0;
    const disponiblePagina = Y_LIM - Y_CONT;
    if (imgs.length && altoCab(altoImg) + altoCuerpo > disponiblePagina) {
      const exceso = altoCab(altoImg) + altoCuerpo - disponiblePagina;
      if (exceso <= altoImg - 30) altoImg -= exceso + 0.3;          // cabe en una página con fotos algo menores
    }
    const total = altoCab(altoImg) + altoCuerpo;
    const enUso = y > Y_CONT + 0.1;
    if (enUso) {
      if (cabe(total + 2.2)) y += 2.2;
      else if (total <= disponiblePagina) nuevaPagina();
      else {
        const minimo = altoCab(altoImg) + 7.8 + (secciones[0] ? 6.0 + Math.min(2, secciones[0].filas.length) * 6.3 : 0);
        if (!cabe(minimo + 2.2)) nuevaPagina(); else y += 2.2;
      }
    }
    g.items.forEach((n) => { paginas[n] = doc.getNumberOfPages(); });
    barra(`${g.items.length > 1 ? "Ítems" : "Ítem"} ${g.items.map(dosDigitos).join(", ")} | ${it.nombre}`);
    fuente(true, 10);
    const ident = [[it.marca, it.modelo].filter(Boolean).join(" "), `Cantidad: ${cantidadTexto(g.cantidad, g.unidad)}`].filter(Boolean).join("  |  ");
    escribir(ident, 12.7, y + 2.5, 10);
    y += 8.8;
    if (imgs.length) {
      const colW = ANCHO / imgs.length; const maxW = imgs.length <= 2 ? 80 : colW - 6;
      imgs.forEach((ref, i) => imagen(ref, X0 + colW * i + (colW - maxW) / 2, y, maxW, altoImg));
      y += altoImg + 2.2;
    }
    tablaPares("Especificaciones técnicas", secciones);
    if (cond.length) { y -= 2.2; tablaPares("Condiciones del producto", [{ titulo: "", filas: cond.map((c) => ({ etiqueta: c.titulo, valor: c.valor })) }], { colorBarra: OSCURO }); }
    if (req.length) { y -= 2.2; matrizTabla("Cumplimiento técnico", req); }
  };

  const seccionFichas = (paginas) => {
    for (const g of fichasEETT(modelo)) ficha(g, paginas);
    const generales = (modelo.matriz || []).filter((r) => !r.item || !(modelo.items || []).some((it) => it.n === r.item && !it.sin_ficha));
    if (generales.length) matrizTabla("Cumplimiento técnico (requisitos generales)", generales);
  };

  // ── Composición por tipo ──
  const paginas = {};
  if (tipo === "cotizacion" || tipo === "oferta") {
    nuevaPagina({ titulo: T.titulo, subtitulo: T.subtitulo });
    datosPartes(); detalle(); totales(); condiciones();
  }
  if (tipo === "eett" || tipo === "oferta") {
    nuevaPagina({ titulo: TIPOS_DOCUMENTO.eett.titulo, subtitulo: TIPOS_DOCUMENTO.eett.subtitulo });
    if (tipo === "eett") {
      const c = modelo.cliente || {};
      const datos = [c.nombre, c.rut && `RUT ${c.rut}`].filter(Boolean).join(" · ");
      if (datos) { fuente(true, 8.5, SUAVE); escribir(`CLIENTE: ${datos}`.toUpperCase(), X0, y - 0.8, 8.5); y += 5.4; }
    }
    seccionFichas(paginas);
  }
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) { doc.setPage(p); pie(p, total); }
  return { doc, paginasFicha: paginas };
}

// ── Huella del modelo (identifica exactamente lo revisado en la vista previa) ──
const ordenado = (v) => (Array.isArray(v) ? v.map(ordenado) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenado(v[k])])) : v);
export const serializarModelo = (m) => JSON.stringify(ordenado(m));
export async function huellaTexto(texto) {
  const datos = new TextEncoder().encode(texto);
  const h = await globalThis.crypto.subtle.digest("SHA-256", datos);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export async function huellaBytes(buf) {
  const h = await globalThis.crypto.subtle.digest("SHA-256", buf instanceof ArrayBuffer ? buf : buf.buffer ? buf : new Uint8Array(buf));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Genera el PDF (Blob) con la huella del modelo como identificador del archivo.
export async function generarDocumentoOferta(tipo, modelo, { jsPDF, fuentes, logo, imagenes } = {}) {
  const id = await huellaTexto(`${GENERADOR}|${tipo}|${serializarModelo(modelo)}`);
  const doc = crearDocumentoOferta(tipo, modelo, { jsPDF, fuentes, logo, imagenes, id });
  const buf = doc.output("arraybuffer");
  return { blob: new Blob([buf], { type: "application/pdf" }), bytes: buf, paginas: doc.getNumberOfPages(), nombre: nombreArchivoOferta(tipo, modelo), huellaModelo: id, huellaPdf: await huellaBytes(buf) };
}
