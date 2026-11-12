// Entrada de la DEMOSTRACIÓN: instala el servidor simulado (servidor.js) y recién después carga la app tal cual es.
// La app no se modifica: solo cambia quién responde sus solicitudes. Nada se envía a Supabase ni a ningún otro servidor.
import { atenderSolicitud, sesionDemo, estado, listo, depurar } from "./servidor.js";

// ── 1. Almacenamiento del navegador: si el alojamiento lo niega, se usa uno en memoria (la app guarda ahí la sesión y borradores) ──
function memoria() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } }; }
for (const nombre of ["localStorage", "sessionStorage"]) {
  let sirve = false; try { const a = window[nombre]; a.setItem("__demo", "1"); a.removeItem("__demo"); sirve = true; } catch { sirve = false; }
  if (!sirve) { try { Object.defineProperty(window, nombre, { configurable: true, value: memoria() }); } catch { /* sin almacenamiento: la app igual funciona */ } }
}
// Sesión ya iniciada con el usuario ficticio (administrador). Al cerrar sesión, cualquier correo y clave vuelven a entrar.
try { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(sesionDemo())); } catch { /* sin almacenamiento */ }

// ── 2. Todas las solicitudes de la app se responden dentro de la página ──
window.fetch = (entrada, opciones) => atenderSolicitud(entrada, opciones);

// ── 3. Avisos propios de la demostración ──
const caja = document.createElement("div");
caja.setAttribute("data-demo-avisos", ""); caja.setAttribute("role", "status"); caja.setAttribute("aria-live", "polite");
caja.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));z-index:2147483000;display:flex;flex-direction:column;gap:6px;align-items:center;width:min(92vw,520px);pointer-events:none";
const montar = () => document.body.appendChild(caja);
if (document.body) montar(); else document.addEventListener("DOMContentLoaded", montar);
export function aviso(texto, ms = 5200) {
  const d = document.createElement("div"); d.textContent = texto;
  d.style.cssText = "background:#0B1120;color:#fff;font:500 13px/1.4 Inter,system-ui,sans-serif;padding:10px 14px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.3);max-width:100%;text-align:center";
  caja.appendChild(d); setTimeout(() => d.remove(), ms);
}
window.addEventListener("bfk-demo-aviso", (e) => aviso(e.detail, 9000));

// ── 4. Diálogos del navegador: el alojamiento de la demostración no los muestra, así que se responden solos y se avisa ──
const linea = (m) => String(m ?? "").split("\n").map((x) => x.trim()).filter(Boolean)[0] || "";
window.confirm = (m) => { aviso(`Demostración: se aceptó la confirmación «${linea(m)}»`); return true; };
window.prompt = (m, defecto) => { const r = defecto || "Motivo de demostración"; aviso(`Demostración: se respondió «${r}» a «${linea(m)}»`); return r; };
window.alert = (m) => { aviso(String(m ?? ""), 8000); };

// ── 5. Descargas e impresión: el alojamiento las bloquea. Los PDF generados se muestran en un visor dentro de la página ──
const clicOriginal = HTMLAnchorElement.prototype.click;
async function verPDF(url, nombre) {
  const fondo = document.createElement("div"); fondo.setAttribute("data-demo-visor", nombre || "");
  fondo.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:rgba(11,17,32,.86);display:flex;flex-direction:column";
  const barra = document.createElement("div"); barra.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;color:#fff;font:600 14px Inter,system-ui,sans-serif";
  const titulo = document.createElement("span"); titulo.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"; titulo.textContent = `${nombre || "Documento"} · vista de la demostración (aquí no se descargan archivos)`;
  const cerrar = document.createElement("button"); cerrar.type = "button"; cerrar.textContent = "Cerrar"; cerrar.setAttribute("data-demo-visor-cerrar", "");
  cerrar.style.cssText = "min-height:40px;padding:8px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;font:600 14px Inter,system-ui,sans-serif;cursor:pointer";
  const hojas = document.createElement("div"); hojas.style.cssText = "flex:1;overflow:auto;-webkit-overflow-scrolling:touch;padding:0 10px 24px;display:flex;flex-direction:column;align-items:center;gap:12px";
  cerrar.onclick = () => fondo.remove(); barra.append(titulo, cerrar); fondo.append(barra, hojas); document.body.appendChild(fondo);
  try {
    const [lib, w] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.js?url")]);
    lib.GlobalWorkerOptions.workerSrc = w.default;
    const datos = await (await fetch(url)).arrayBuffer(); const pdf = await lib.getDocument({ data: datos }).promise;
    for (let i = 1; i <= pdf.numPages; i++) {
      const pagina = await pdf.getPage(i); const vista = pagina.getViewport({ scale: 1.6 }); const lienzo = document.createElement("canvas");
      lienzo.width = vista.width; lienzo.height = vista.height; lienzo.style.cssText = "width:min(100%,860px);height:auto;background:#fff;border-radius:4px";
      hojas.appendChild(lienzo); await pagina.render({ canvasContext: lienzo.getContext("2d"), viewport: vista }).promise;
    }
  } catch (e) { const p = document.createElement("p"); p.style.cssText = "color:#fff;font:14px Inter,system-ui,sans-serif"; p.textContent = "No se pudo mostrar el documento en la demostración: " + (e?.message || e); hojas.appendChild(p); }
}
async function descarga(a) {
  const nombre = a.download || "archivo"; let tipo = "";
  try { tipo = (await (await fetch(a.href)).blob()).type; } catch { tipo = ""; }
  if (/pdf/i.test(tipo) || /\.pdf$/i.test(nombre)) return verPDF(a.href, nombre);
  aviso(`Demostración: «${nombre}» se generó correctamente, pero aquí no se descargan archivos.`, 7000);
}
HTMLAnchorElement.prototype.click = function clic() { if (this.hasAttribute("download") && /^(blob|data):/.test(this.href)) { descarga(this); return; } return clicOriginal.call(this); };
// jsPDF y otras bibliotecas «descargan» con un enlace que no está en la página y un evento sintético.
const despacharOriginal = EventTarget.prototype.dispatchEvent;
EventTarget.prototype.dispatchEvent = function despachar(ev) { if (ev?.type === "click" && this instanceof HTMLAnchorElement && this.hasAttribute("download") && /^(blob|data):/.test(this.href)) { descarga(this); return true; } return despacharOriginal.call(this, ev); };
document.addEventListener("click", (e) => { const a = e.target?.closest?.("a[download]"); if (a && /^(blob|data):/.test(a.href)) { e.preventDefault(); descarga(a); } }, true);
const abrirOriginal = window.open;
window.open = function abrir(url, ...resto) {
  const u = String(url || "");
  if (/^blob:/.test(u)) { verPDF(u, "Documento"); return null; }
  if (/^https?:/.test(u)) { aviso("Demostración: aquí no se abren páginas externas (" + new URL(u).hostname + ")."); return null; }
  return abrirOriginal.call(window, url, ...resto);
};
window.print = () => aviso("Demostración: la impresión no está disponible aquí.");

// ── 6. Pantalla de preparación (la base de Ventas privadas y Proyectos tarda unos segundos en iniciar) ──
const espera = document.createElement("div"); espera.setAttribute("data-demo-espera", "");
espera.style.cssText = "position:fixed;inset:0;z-index:2147483500;background:#F6F7F9;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;font-family:Inter,system-ui,sans-serif;color:#0B1120";
espera.innerHTML = '<div style="font-size:20px;font-weight:700">BFK Ventas · Demostración</div><div style="font-size:14px;color:#475569;max-width:420px;line-height:1.5">Datos ficticios, sin conexión con la base real. Los cambios que hagas se pierden al recargar la página.</div><div data-demo-fase style="font-size:13px;color:#0F766E;font-weight:600;min-height:20px"></div>';
const ponerFase = (t) => { const f = espera.querySelector("[data-demo-fase]"); if (f) f.textContent = t; };
window.addEventListener("bfk-demo-fase", (e) => ponerFase(e.detail)); ponerFase(estado.fase);
const mostrar = () => document.body.appendChild(espera); if (document.body) mostrar(); else document.addEventListener("DOMContentLoaded", mostrar);
listo.then(() => { setTimeout(() => espera.remove(), 600); aviso("Demostración con datos ficticios · sin conexión con la base real · los cambios se pierden al recargar", 8000); });

window.__bfkDemo = { estado, depurar };
await import("../../src/main.jsx");
