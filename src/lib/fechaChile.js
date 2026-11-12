// Fecha de HOY en Chile (AAAA-MM-DD), sin importar la zona horaria del dispositivo.
// Se usa para los valores predeterminados de los formularios («Fecha de compra», «Fecha de pago», …).
// Antes se tomaba la fecha UTC (new Date().toISOString().slice(0,10)): entre las 21:00 (20:00 en horario de invierno) y la
// medianoche de Chile, UTC ya está en el día siguiente y el formulario proponía la fecha de mañana.
// No reemplaza marcas de tiempo (creado_en, etc.) ni claves diarias que el servidor lleva en UTC: esas siguen en UTC.
export const ZONA_CHILE = "America/Santiago";
const FORMATO = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_CHILE, year: "numeric", month: "2-digit", day: "2-digit" });
export function hoyChile(ahora = new Date()) {
  const p = FORMATO.formatToParts(ahora);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

// Aritmética de fechas puras (AAAA-MM-DD) sin pasar por la zona del equipo: se calcula en UTC a propósito, porque una fecha
// sin hora no tiene zona. diasISO("2026-11-12", -90) → "2026-08-14".
export function diasISO(iso, dias) {
  const [a, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Períodos rápidos de los filtros («Este mes», «Mes pasado», «90 días», «Este año») contados desde el hoy de Chile.
export function periodosChile(ahora = new Date()) {
  const h = hoyChile(ahora); const [a, m] = h.split("-").map(Number);
  const iso = (f) => f.toISOString().slice(0, 10);
  return {
    esteMes: [`${h.slice(0, 8)}01`, h],
    mesPasado: [iso(new Date(Date.UTC(a, m - 2, 1))), iso(new Date(Date.UTC(a, m - 1, 0)))],
    dias90: [diasISO(h, -90), h],
    esteAnio: [`${a}-01-01`, h],
  };
}
