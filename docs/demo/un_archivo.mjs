// Paso final de la versión de un solo archivo: el empaquetador repite el motor de la base (PGlite) en cada lugar que lo nombra
// (≈ 67 MB). Aquí cada bloque grande e idéntico (data:…) se deja una sola vez en una variable global definida antes del código,
// y cada aparición se reemplaza por esa variable. El resultado se comporta igual y pesa menos de la mitad.
// Uso: node docs/demo/un_archivo.mjs docs/demo/dist-archivo/index.html
import { readFileSync, writeFileSync } from "node:fs";
const ruta = process.argv[2]; let html = readFileSync(ruta, "utf8"); const antes = html.length;
const unicos = new Map(); const partes = []; let desde = 0, pos = 0;
// Recorrido manual (una expresión regular sobre bloques de varios MB agota la pila).
while ((pos = html.indexOf("data:", pos)) >= 0) {
  const q = html[pos - 1]; if (!"\"'`".includes(q)) { pos += 5; continue; }
  const fin = html.indexOf(q, pos); if (fin < 0) break;
  const url = html.slice(pos, fin);
  if (url.length >= 100000 && /^data:[a-z/+.-]+;base64,/.test(url.slice(0, 80))) {
    if (!unicos.has(url)) unicos.set(url, `__DEMO_BLOQUE_${unicos.size}`);
    partes.push(html.slice(desde, pos - 1), unicos.get(url)); desde = fin + 1;
  }
  pos = fin + 1;
}
partes.push(html.slice(desde)); html = partes.join("");
if (!unicos.size) throw new Error("no se encontraron bloques grandes: ¿cambió el empaquetado?");
const defs = [...unicos].map(([url, nombre]) => `<script>window.${nombre}="${url}";</script>`).join("\n");
const i = html.indexOf("<script type=\"module\""); if (i < 0) throw new Error("no se encontró el código de la app");
html = html.slice(0, i) + defs + "\n" + html.slice(i);
if (/supabase\.co/.test(html)) throw new Error("el archivo contiene una dirección de Supabase");
writeFileSync(ruta, html);
console.log(`un_archivo: ${unicos.size} bloques únicos · ${(antes / 1e6).toFixed(1)} MB → ${(html.length / 1e6).toFixed(1)} MB`);
