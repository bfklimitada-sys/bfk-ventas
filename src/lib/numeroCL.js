// Formato numérico chileno (es-CL) para lo que se ESCRIBE o PEGA en Cotizaciones (13/11/2026, Kevin).
//  · El punto (.) es SOLO separador de miles, en grupos de 3 dígitos: 25.990 · 1.250.000.
//  · La coma (,) es SOLO separador decimal: 1250,50 · 25.990,90 · 1.250.000,75.
//  · Un punto nunca es decimal: «1250.50» o «25.99» se rechazan (no se adivina) y se informa por qué.
//  · Se valida la estructura completa antes de convertir: no se borran puntos «a ciegas».
// La base guarda el número (1250.5); el formato chileno es solo para mostrarlo.
// No usar para datos de máquina (JSON-LD, precios de una página leída automáticamente): esos vienen con punto decimal.

const ESPACIOS = /[\s    ]/g;
const ENTERO_SIMPLE = /^\d+$/;
const ENTERO_MILES = /^[1-9]\d{0,2}(?:\.\d{3})+$/;

const ejemplo = (decimales) => (decimales > 0 ? "1.250.000,75" : "1.250.000");

// Lee un texto en formato chileno. Devuelve { valor, error }:
//   vacío → { valor: null, error: null } · válido → { valor: número, error: null } · inválido → { valor: null, error: "…" }.
// opciones: decimales (máximo permitido; 0 = solo enteros), negativo (permite «-»), porcentaje (admite «%» al final).
export function leerNumeroCL(texto, { decimales = 2, negativo = false, porcentaje = false } = {}) {
  let s = String(texto ?? "").normalize("NFKC").trim();
  // Símbolos de moneda o porcentaje que se pegan junto al número (solo al inicio o al final).
  s = s.replace(/^(?:CLP|\$)\s*/i, "").replace(/\s*(?:CLP|\$)$/i, "");
  if (porcentaje) s = s.replace(/\s*%$/, "");
  s = s.trim();
  if (s === "") return { valor: null, error: null };
  let signo = 1;
  if (/^[-−–]/.test(s)) {
    if (!negativo) return { valor: null, error: "No se admiten valores negativos." };
    signo = -1; s = s.replace(/^[-−–]\s*/, "");
  }
  if (/\d[\s    ]+\d/.test(s)) return { valor: null, error: `Formato incorrecto: no uses espacios dentro del número (ej.: ${ejemplo(decimales)}).` };
  s = s.replace(ESPACIOS, "");
  if (!/^[\d.,]+$/.test(s)) return { valor: null, error: `Formato incorrecto: escribe solo dígitos, punto para miles y coma para decimales (ej.: ${ejemplo(decimales)}).` };
  const partes = s.split(",");
  if (partes.length > 2) return { valor: null, error: "Formato incorrecto: la coma es el separador decimal y solo puede aparecer una vez." };
  const [ent, dec] = partes;
  if (dec != null) {
    if (decimales === 0) return { valor: null, error: "Este valor no admite decimales: ingresa pesos enteros (ej.: 25.990)." };
    if (!/^\d+$/.test(dec) || ent === "") return { valor: null, error: `Formato incorrecto: después de la coma van los decimales (ej.: ${ejemplo(decimales)}).` };
    if (dec.length > decimales) return { valor: null, error: `Máximo ${decimales} decimal${decimales === 1 ? "" : "es"} (con coma).` };
  }
  if (!(ENTERO_SIMPLE.test(ent) || ENTERO_MILES.test(ent))) {
    // Punto usado como decimal (1250.50, 25.99) o grupos de miles mal formados (1.25.000, 0.500, 12.3456).
    const pareceDecimal = /^\d+\.\d{1,2}$/.test(ent) && dec == null;
    return { valor: null, error: pareceDecimal
      ? `Formato incorrecto: el punto separa miles (grupos de 3 dígitos); para decimales usa coma: ${ent.replace(".", ",")}.`
      : `Formato incorrecto: el punto separa miles en grupos de 3 dígitos (ej.: ${ejemplo(decimales)}).` };
  }
  // Conversión exacta desde el texto (sin pasar por cálculos con decimales).
  const valor = signo * Number(`${ent.replace(/\./g, "")}${dec ? `.${dec}` : ""}`);
  if (!Number.isFinite(valor)) return { valor: null, error: "Número demasiado grande." };
  return { valor: Object.is(valor, -0) ? 0 : valor, error: null };
}

// Muestra un número en formato chileno: miles con punto, decimales con coma (solo los que tiene, hasta `decimales`).
// Un valor guardado con más decimales que los del campo se muestra completo (nunca se redondea al mostrar).
export function formatoCL(valor, { decimales = 2, minimoDecimales = 0 } = {}) {
  if (valor === "" || valor == null) return "";
  const n = Number(valor);
  if (!Number.isFinite(n)) return "";
  // Hasta 6 decimales (quita solo el ruido de coma flotante, p. ej. 0,30000000000000004); nunca menos de los guardados reales.
  const [eRaw, dRaw = ""] = Math.abs(n).toFixed(Math.max(decimales, 6)).replace(/0+$/, "").replace(/\.$/, "").split(".");
  const miles = eRaw.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  let dec = dRaw;
  if (dec.length < minimoDecimales) dec = dec.padEnd(minimoDecimales, "0");
  return `${n < 0 ? "-" : ""}${miles}${dec ? `,${dec}` : ""}`;
}

// Porcentaje guardado como fracción (0,325) ↔ texto en % (32,5). Sin errores de coma flotante (0,3255 → 32,55).
export const fraccionAPorcentaje = (f) => (f === "" || f == null || !Number.isFinite(Number(f)) ? null : Math.round(Number(f) * 1e6) / 1e4);
export const porcentajeAFraccion = (p) => (p == null ? null : Math.round(p * 100) / 10000);

// Un valor numérico del estado de un formulario que quedó inválido (el campo informa el error y entrega NaN).
export const esInvalido = (v) => typeof v === "number" && Number.isNaN(v);
