// ═══════════════════════════════════════════════════════════════
// Capturas de pantalla de una publicación → propuesta de ficha (módulo Cotizaciones y EETT).
// Dos lectores posibles, el mismo resultado:
//   · OCR en el propio dispositivo (Tesseract.js, gratuito, sin credenciales; las imágenes no salen del equipo).
//   · IA (Claude) en el servidor, SOLO si está configurada una clave autorizada (api/interpretar.mjs).
// Reglas comunes (no inventar): solo lo que se lee en la imagen; con varios precios no se elige ninguno;
// la disponibilidad nunca se supone; los atributos comerciales no pasan a la ficha; el envío queda por verificar.
// ═══════════════════════════════════════════════════════════════
import { extraerProducto } from "./extraerProducto.js";

const RUIDO = /^(\d{1,2}[:.]\d{2}\b|vendido por|vendedor|ver m[aá]s|ver todas|agregar al carro|a[nñ]adir al carro|comprar ahora|comprar|compartir|favorito|opiniones|preguntas|calificaci|mercado ?libre|falabella|sodimac|paris|ripley|lider|inicio|buscar|categor[ií]as|nuevo\b|usado\b|reacondicionado|.*\bvendidos?\b|.*\bopiniones\b|.*\bcalificaciones\b|devoluci[oó]n|garant[ií]a de|llega|retira|retiro|env[ií]o|despacho|cuotas?|mismo precio|ahorra|descuento|oferta|cmr|tarjeta|stock|disponible|cantidad|unidad(es)?\b|lo que ten[eé]s que saber|caracter[ií]sticas del producto|caracter[ií]sticas principales|especificaciones|descripci[oó]n|informaci[oó]n adicional|publicaci[oó]n|denunciar)/i;
const ETIQUETAS = ["marca", "modelo", "color", "material", "peso", "dimensiones", "alto", "ancho", "largo", "profundidad", "capacidad", "potencia", "voltaje", "tensión", "frecuencia",
  "consumo", "garantía", "conectividad", "conexión", "resolución", "tamaño", "tamaño de pantalla", "pantalla", "procesador", "memoria", "memoria ram", "almacenamiento", "sistema operativo",
  "tipo", "tipo de impresión", "velocidad de impresión", "número de cartuchos", "funcionalidad", "funciones", "formato", "contenido", "incluye", "origen", "país de origen", "modelo detallado",
  "línea", "categoría", "largo del cable", "longitud", "diámetro", "temperatura", "batería", "autonomía", "compatibilidad", "certificación", "norma", "uso", "acabado", "forma", "cantidad de piezas"];
const ES_ETIQUETA = (l) => ETIQUETAS.some((e) => l.toLowerCase() === e);
// "$" (o "S" mal leído por OCR) + monto; el OCR suele leer el precio tachado con guion ("$219-990").
const PRECIO_RE = /(?:\$|\bS)\s?(\d{1,3}(?:[.,\-]\d{3})+|\d{4,})(?![\d.,]*\s?%)/g;

const limpiarLinea = (l) => String(l || "").replace(/[|•·»«]+/g, " ").replace(/\s+/g, " ").trim();
const letras = (s) => (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñü]/g) || []).length;

// Pares etiqueta/valor desde líneas de texto: "Etiqueta: valor", "Etiqueta  valor", etiqueta conocida + valor,
// o etiqueta conocida sola seguida de su valor en la línea siguiente (tablas leídas por OCR).
export function paresDeLineas(lineas) {
  const pares = [];
  for (let i = 0; i < lineas.length; i++) {
    const l = lineas[i];
    let m = l.match(/^([^:]{2,60}):\s*(.+)$/);
    if (m && letras(m[1]) >= 2) { pares.push({ etiqueta: m[1].trim(), valor: m[2].trim() }); continue; }
    const lc = l.toLowerCase();
    const et = [...ETIQUETAS].sort((a, b) => b.length - a.length).find((e) => lc.startsWith(e + " ") && l.length > e.length + 1);
    if (et) { pares.push({ etiqueta: l.slice(0, et.length), valor: l.slice(et.length).trim() }); continue; }
    if (ES_ETIQUETA(l) && i + 1 < lineas.length && !ES_ETIQUETA(lineas[i + 1]) && !RUIDO.test(lineas[i + 1])) { pares.push({ etiqueta: l, valor: lineas[i + 1] }); i++; }
  }
  return pares.filter((p) => p.valor && p.valor.length <= 300);
}

// Precios visibles (excluye cuotas y porcentajes). Devuelve valores únicos en orden de aparición.
export function preciosVisibles(lineas) {
  const out = [];
  for (const l of lineas) {
    if (/cuota|mensual|x\s?\d+\s?meses|ahorr/i.test(l)) continue;
    for (const m of l.matchAll(PRECIO_RE)) { if (!/\$/.test(m[0]) && !/[.,\-]/.test(m[1])) continue; const n = Number(m[1].replace(/[.,\-]/g, "")); if (n >= 100 && !out.includes(n)) out.push(n); }
  }
  return out;
}

// Nombre probable: primera línea "de título" (varias palabras, mayoría letras, sin precio ni ruido de la página).
function nombreProbable(lineas) {
  const cand = (l) => l.length >= 12 && l.length <= 180 && l.split(" ").length >= 3 && letras(l) / l.length > 0.6 && !RUIDO.test(l) && !/[:$]/.test(l) && !ES_ETIQUETA(l.split(" ")[0] || "");
  const i = lineas.findIndex(cand);
  if (i < 0) return "";
  let n = lineas[i];
  const sig = lineas[i + 1];
  // Título en dos líneas: la segunda es una continuación corta (sin precio, ruido ni etiqueta) o empieza en minúscula.
  const continua = (l) => l && l.length <= 40 && letras(l) >= 2 && !RUIDO.test(l) && !/[:$]/.test(l) && !ES_ETIQUETA(l) && !/^\d+([.,]\d+)?\s*\(/.test(l);
  if (sig && !/[.!?]$/.test(n) && (continua(sig) || (cand(sig) && /^[a-záéíóúñ0-9]/.test(sig))) && (n + " " + sig).length <= 160) n += " " + sig;
  return n;
}

function descripcionVisible(lineas) {
  const i = lineas.findIndex((l) => /^descripci[oó]n\b/i.test(l));
  if (i < 0) return "";
  const out = [];
  for (const l of lineas.slice(i + 1)) { if (/^(preguntas|opiniones|caracter[ií]sticas|especificaciones|informaci[oó]n adicional)\b/i.test(l)) break; out.push(l); }
  return out.join(" ").slice(0, 1500);
}

// Datos leídos (por OCR o IA) → mismo resultado que el extractor de enlaces, con las mismas reglas.
// datos: { nombre, pares:[{etiqueta,valor}], precios:[n], descripcion, marca, modelo, color }
export function resultadoDesdeLectura(datos, { metodo = "ocr", enlace = "", ahora = new Date() } = {}) {
  const pares = [...(datos.pares || [])];
  for (const k of ["marca", "modelo", "color"]) if (datos[k]) pares.unshift({ etiqueta: k[0].toUpperCase() + k.slice(1), valor: String(datos[k]) });
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<title>${esc(datos.nombre || "")}</title><table>${pares.map((p) => `<tr><th>${esc(p.etiqueta)}</th><td>${esc(p.valor)}</td></tr>`).join("")}</table>`;
  const r = extraerProducto(html, enlace || "https://captura.local/", ahora); // mismas reglas: marca/modelo/color, sin atributos comerciales
  const precios = (datos.precios || []).filter((n) => Number.isFinite(n) && n > 0);
  const adv = [];
  if (!r.ficha.nombre) adv.push("No se pudo leer el nombre del producto: ingrésalo.");
  else adv.push("Revisa el nombre: fue leído de la captura.");
  if (precios.length === 1) adv.push("Precio leído de la captura: verifícalo antes de cotizar.");
  else if (precios.length > 1) adv.push(`Se leyeron varios precios (${precios.map((n) => "$" + n.toLocaleString("es-CL")).join(", ")}): ingresa el que corresponde.`);
  else adv.push("No se leyó un precio: ingrésalo manualmente.");
  if (!r.ficha.especificaciones.length) adv.push("No se leyeron especificaciones: complétalas o sube otra captura de la sección de características.");
  adv.push("Agrega las fotos del producto con «Agregar foto».");
  adv.push("El costo de envío no se obtiene de las capturas: verifícalo con la dirección real del cliente.");
  let fuente = "capturas de pantalla"; try { if (enlace) fuente = `${new URL(enlace).hostname.replace(/^www\./, "")} (capturas de pantalla)`; } catch { /* */ }
  return {
    ficha: { ...r.ficha, descripcion: String(datos.descripcion || "").slice(0, 3000), imagenes: [] },
    precio_origen: precios.length === 1 ? precios[0] : null, moneda: precios.length === 1 ? "CLP" : null, precio_incluye_iva: true,
    disponibilidad: "", // nunca se supone desde una captura
    fuente, fecha_consulta: ahora.toISOString(), metodos: [metodo], advertencias: adv, completo: false,
  };
}

// Texto reconocido por OCR → datos leídos.
export function lecturaDesdeTexto(texto) {
  const lineas = String(texto || "").split(/\r?\n/).map(limpiarLinea).filter((l) => l.length > 1 || /\d/.test(l));
  return { nombre: nombreProbable(lineas), pares: paresDeLineas(lineas), precios: preciosVisibles(lineas), descripcion: descripcionVisible(lineas) };
}
