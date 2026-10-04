// Genera un PDF (A4) con las pantallas indicadas, dentro del navegador (iPhone incluido).
// Solo lee lo que ya está dibujado en pantalla: no consulta ni modifica datos.
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
    let escala = 2;
    while (escala > 0.75 && ancho * escala * alto * escala > 12e6) escala -= 0.25;
    const cv = await html2canvas(el, { scale: escala, backgroundColor: fondo, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const pxPorPagina = Math.floor(cv.width * (H / W));
    for (let y = 0; y < cv.height; y += pxPorPagina) {
      const h = Math.min(pxPorPagina, cv.height - y);
      const parte = document.createElement("canvas");
      parte.width = cv.width; parte.height = h;
      const ctx = parte.getContext("2d");
      ctx.fillStyle = fondo; ctx.fillRect(0, 0, parte.width, parte.height);
      ctx.drawImage(cv, 0, y, cv.width, h, 0, 0, cv.width, h);
      if (!primera) pdf.addPage();
      primera = false;
      pdf.addImage(parte.toDataURL("image/jpeg", 0.85), "JPEG", M, M, W, (h * W) / cv.width);
      parte.width = 0; parte.height = 0;
    }
    cv.width = 0; cv.height = 0;
  }
  return pdf.output("blob");
}
