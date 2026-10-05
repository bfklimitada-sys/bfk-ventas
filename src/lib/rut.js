// Utilidad única de RUT chileno. Solo para comparar y validar: NO se usa para reformatear datos existentes.
// limpiarRut: quita puntos, espacios (incluidos los no separables) y guiones; K en mayúscula.
export function limpiarRut(valor) {
  return String(valor ?? "").replace(/[\s .\-‐-―]/g, "").toUpperCase();
}

export function digitoVerificador(cuerpo) {
  let suma = 0, factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * factor; factor = factor === 7 ? 2 : factor + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
}

// Devuelve { ok, normalizado, cuerpo, dv, motivo }. normalizado = "76123456-7" (sin puntos, con guion, K mayúscula).
// Cuerpo de 7 u 8 dígitos (RUT reales desde 1.000.000) y dígito verificador correcto.
export function analizarRut(valor) {
  const limpio = limpiarRut(valor);
  if (!limpio) return { ok: false, motivo: "RUT vacío" };
  if (!/^[0-9]+[0-9K]$/.test(limpio) || limpio.length < 2) return { ok: false, motivo: "RUT con caracteres no válidos" };
  const cuerpo = limpio.slice(0, -1), dv = limpio.slice(-1);
  if (!/^[0-9]{7,8}$/.test(cuerpo)) return { ok: false, motivo: "RUT con largo no válido (7 u 8 dígitos antes del dígito verificador)" };
  if (Number(cuerpo) < 1000000) return { ok: false, motivo: "RUT fuera de rango" };
  if (digitoVerificador(cuerpo) !== dv) return { ok: false, motivo: "dígito verificador incorrecto" };
  return { ok: true, normalizado: `${cuerpo}-${dv}`, cuerpo, dv };
}

// Clave de comparación tolerante (también para RUT históricos mal formados): solo dígitos y K, sin ceros a la izquierda.
export function claveComparacion(valor) {
  const l = limpiarRut(valor).replace(/[^0-9K]/g, "");
  return l.replace(/^0+(?=.)/, "");
}

// Formato de almacenamiento para entidades NUEVAS (mayoritario en la base: 76.123.456-7).
export function formatoAlmacenamiento(normalizado) {
  const [c, dv] = normalizado.split("-");
  return `${c.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
}

// ── Normalización única para toda la app: "76.123.456-0", "76123456-0" y "761234560" son el MISMO RUT. ──
// Solo compara por clave cuando el valor es un RUT completo y válido (evita autocompletar con un RUT a medio escribir);
// si no es válido, compara el texto exacto (RUT históricos con dígito errado).
export function mismoRut(a, b) {
  const ra = analizarRut(a), rb = analizarRut(b);
  if (ra.ok && rb.ok) return ra.normalizado === rb.normalizado;
  if (ra.ok || rb.ok) return ra.ok ? claveComparacion(b) === ra.cuerpo + ra.dv : claveComparacion(a) === rb.cuerpo + rb.dv;
  const ta = String(a ?? "").trim(), tb = String(b ?? "").trim();
  return !!ta && ta === tb;
}
// Todas las filas de una lista cuyo campo RUT es el mismo RUT que `rut`.
export function filtrarPorRut(lista, rut, campo = "rut") {
  if (!String(rut ?? "").trim()) return [];
  return (lista || []).filter(x => mismoRut(x?.[campo], rut));
}
// Entidad del catálogo para un RUT. ambigua=true si hay más de una (duplicados históricos pendientes de revisión).
export function entidadPorRut(catalogo, rut) {
  const m = filtrarPorRut(catalogo, rut);
  if (m.length <= 1) return { entidad: m[0] || null, ambigua: false };
  const exacta = m.find(e => String(e.rut).trim() === String(rut).trim());
  return { entidad: exacta || m[0], ambigua: true };
}
// Formato en que se guarda un RUT nuevo: 76.123.456-0 si es válido; si no, el texto tal cual (sin inventar dígito).
export function rutParaGuardar(valor) {
  const a = analizarRut(valor);
  return a.ok ? formatoAlmacenamiento(a.normalizado) : String(valor ?? "").trim();
}
