// Comprobaciones de maquetación comunes a los recorridos: desplazamiento horizontal de la página, elementos que sobresalen del
// ancho visible y botones/campos cortados o tapados dentro de una ventana. Se ignora lo que vive dentro de un contenedor que se
// desplaza a propósito en horizontal (chips, pestañas, tablas).
export const revisar = (page) => page.evaluate(() => {
  const W = document.documentElement.clientWidth; const fallas = [];
  if (document.documentElement.scrollWidth > W + 1) fallas.push(`la página se desplaza en horizontal (${document.documentElement.scrollWidth} > ${W})`);
  const deslizable = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
  const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0; };
  const nombre = (el) => `${el.tagName.toLowerCase()}«${(el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || "").trim().replace(/\s+/g, " ").slice(0, 40)}»`;
  for (const el of document.querySelectorAll("button, a, input, select, textarea, [role=tab]")) {
    if (!visible(el) || deslizable(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.right > W + 1 || r.left < -1) fallas.push(`${nombre(el)} sobresale del ancho (${Math.round(r.left)}–${Math.round(r.right)} de ${W})`);
  }
  // Texto cortado sin puntos suspensivos ni desplazamiento: contenedores con overflow oculto cuyo contenido es más ancho.
  for (const el of document.querySelectorAll("button, [role=tab], label, th, td")) {
    if (!visible(el) || deslizable(el)) continue; const s = getComputedStyle(el);
    if (s.overflow === "hidden" && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 2) fallas.push(`${nombre(el)} tiene contenido cortado`);
  }
  return [...new Set(fallas)];
});
// Dentro de una ventana u hoja abierta: todo botón/campo debe poder alcanzarse (queda dentro del cuerpo desplazable o a la vista).
export const revisarVentana = (page) => page.evaluate(() => {
  const v = [...document.querySelectorAll("[role=dialog]")].pop(); if (!v) return ["no hay ventana abierta"];
  const R = v.getBoundingClientRect(); const fallas = []; const H = window.innerHeight; const W = document.documentElement.clientWidth;
  if (R.left < -1 || R.right > W + 1) fallas.push(`la ventana sobresale del ancho (${Math.round(R.left)}–${Math.round(R.right)} de ${W})`);
  if (R.bottom > H + 1 || R.top < -1) fallas.push(`la ventana sobresale del alto (${Math.round(R.top)}–${Math.round(R.bottom)} de ${H})`);
  const cuerpos = [v, ...v.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY));
  for (const el of v.querySelectorAll("button, input, select, textarea")) {
    const s = getComputedStyle(el); const r = el.getBoundingClientRect(); if (s.display === "none" || s.visibility === "hidden" || !r.width) continue;
    const dentro = cuerpos.some((c) => c.contains(el));
    if (!dentro && (r.bottom > H + 1 || r.top < -1)) fallas.push(`«${(el.innerText || el.getAttribute("aria-label") || el.placeholder || "").trim().slice(0, 30)}» queda fuera de pantalla y no se puede desplazar hasta él`);
    if (r.right > Math.min(R.right, W) + 1 || r.left < Math.max(R.left, 0) - 1) { let h = false; for (let p = el.parentElement; p && p !== v.parentElement; p = p.parentElement) if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth + 1) h = true; if (!h) fallas.push(`«${(el.innerText || el.getAttribute("aria-label") || el.placeholder || "").trim().slice(0, 30)}» sobresale de la ventana`); }
  }
  for (const c of cuerpos) if (c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== "hidden" && c === v) fallas.push("la ventana se desplaza en horizontal");
  return [...new Set(fallas)];
});
