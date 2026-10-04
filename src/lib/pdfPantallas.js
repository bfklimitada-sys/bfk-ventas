// Genera un PDF (A4) con las pantallas indicadas, dentro del navegador (iPhone incluido).
// Solo lee lo que ya está dibujado en pantalla: no consulta ni modifica datos.

// Zonas verticales (en px CSS, relativas al elemento) que conviene no partir entre dos páginas:
// tarjetas / filas / bloques con borde o sombra, y títulos de sección junto a lo que sigue.
function zonasProtegidas(el, altoPaginaCss) {
  const base = el.getBoundingClientRect().top;
  const zonas = [];
  for (const e of el.querySelectorAll("*")) {
    const r = e.getBoundingClientRect();
    if (r.height < 24 || r.height >= altoPaginaCss * 0.9) continue;
    const cs = getComputedStyle(e);
    if (cs.display === "inline" || cs.position === "fixed") continue;
    const radio = parseFloat(cs.borderTopLeftRadius) || 0;
    const conMarco = cs.boxShadow !== "none" || (parseFloat(cs.borderTopWidth) || 0) > 0 || (parseFloat(cs.borderBottomWidth) || 0) > 0;
    const conFondo = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent";
    if (radio >= 8 && (conMarco || conFondo)) zonas.push([r.top - base, r.bottom - base]);
  }
  // Títulos de sección: se mantienen junto al texto de apoyo y al inicio del contenido que sigue.
  for (const h of el.querySelectorAll("h2")) {
    const cab = h.parentElement || h;
    const top = cab.getBoundingClientRect().top - base;
    let fin = cab.getBoundingClientRect().bottom - base;
    const nota = cab.nextElementSibling;
    if (nota) fin = Math.max(fin, nota.getBoundingClientRect().bottom - base);
    const sig = nota && nota.nextElementSibling;
    if (sig) fin = Math.max(fin, Math.min(sig.getBoundingClientRect().bottom - base, fin + 70));
    else fin += 70;
    zonas.push([top, fin]);
  }
  return zonas;
}

// Devuelve las posiciones (px CSS) donde empieza cada página, evitando cortar zonas protegidas
// siempre que no se pierda más de la mitad de la página.
function calcularCortes(alto, altoPaginaCss, zonas) {
  const cortes = [0];
  let y0 = 0, guardia = 0;
  // Si lo que sobra es poco (hasta 10 %), se reduce un poco esa última página en vez de dejar una página casi vacía.
  while (alto - y0 > altoPaginaCss * 1.1 && guardia++ < 500) {
    let corte = y0 + altoPaginaCss;
    let cambio = true, vueltas = 0;
    while (cambio && vueltas++ < 20) {
      cambio = false;
      const dentro = zonas.filter(([t, b]) => t < corte - 1 && b > corte + 1 && t > y0 + altoPaginaCss * 0.5);
      if (dentro.length) {
        const nuevo = Math.min(...dentro.map(z => z[0]));
        if (nuevo < corte) { corte = nuevo - 2; cambio = true; }
      }
    }
    cortes.push(corte);
    y0 = corte;
  }
  return cortes;
}

export async function generarPdfPantallas(elementos, { fondo = "#F8FAFC", alMedida } = {}) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const M = 10, W = 210 - 2 * M, H = 297 - 2 * M;
  let primera = true;
  for (let i = 0; i < elementos.length; i++) {
    const el = elementos[i];
    alMedida && alMedida(i + 1, elementos.length);
    // iOS limita el lienzo (~16 millones de píxeles): bajamos la escala en pantallas muy largas.
    const alto = el.scrollHeight, ancho = el.scrollWidth;
    const altoPaginaCss = ancho * (H / W);
    const cortes = calcularCortes(alto, altoPaginaCss, zonasProtegidas(el, altoPaginaCss));
    if (typeof window !== "undefined" && Array.isArray(window.__bfkInformePdf)) window.__bfkInformePdf.push({ pantalla: i + 1, alto, altoPaginaCss, cortes });
    let escala = 2;
    while (escala > 0.75 && ancho * escala * alto * escala > 12e6) escala -= 0.25;
    const cv = await html2canvas(el, { scale: escala, backgroundColor: fondo, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const k = cv.width / ancho;
    for (let p = 0; p < cortes.length; p++) {
      const y = Math.max(0, Math.round(cortes[p] * k));
      const yFin = p + 1 < cortes.length ? Math.round(cortes[p + 1] * k) : cv.height;
      const h = Math.min(yFin, cv.height) - y;
      if (h <= 2) continue;
      const parte = document.createElement("canvas");
      parte.width = cv.width; parte.height = h;
      const ctx = parte.getContext("2d");
      ctx.fillStyle = fondo; ctx.fillRect(0, 0, parte.width, parte.height);
      ctx.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
      if (!primera) pdf.addPage();
      primera = false;
      let wMm = W, hMm = (h * W) / cv.width;
      if (hMm > H) { wMm = W * (H / hMm); hMm = H; } // última página levemente reducida
      pdf.addImage(parte.toDataURL("image/jpeg", 0.85), "JPEG", M + (W - wMm) / 2, M, wMm, hMm);
      parte.width = 0; parte.height = 0;
    }
    cv.width = 0; cv.height = 0;
  }
  return pdf.output("blob");
}
