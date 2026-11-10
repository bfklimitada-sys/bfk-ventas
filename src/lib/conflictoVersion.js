// Conflicto de versiones (09/11/2026) — una pestaña desactualizada no sobrescribe lo guardado después.
// La base sigue rechazando un guardado con versión antigua (CZ409 / VP409). Al ocurrir, lo escrito NO se pierde: se compara en
// tres vías por campo:
//   · base: lo que esta pestaña cargó (o la copia de recuperación guardó como punto de partida);
//   · mío: lo escrito en esta pestaña;
//   · BFK: lo guardado después (la versión vigente).
// Resultado por campo: igual · solo_mio (se conserva lo tuyo) · solo_bfk (se toma lo de BFK) · conflicto (cambió en ambos:
// la persona elige; por defecto lo de BFK, nunca se sobrescribe solo). Sin base, todo campo distinto es conflicto.
// Nada se guarda al combinar: el resultado queda en el editor, marcado «sin guardar», con la versión vigente.

const normalizarValor = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (Array.isArray(v)) return v.map(normalizarValor);
  if (typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalizarValor(v[k])]));
  return v;
};
const canon = (v) => JSON.stringify(normalizarValor(v));
const clonar = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// Productos y despachos: las claves locales y los identificadores cambian al recargar (no son un cambio de contenido).
const VOLATILES = new Set(["key", "id", "revision_id", "cotizacion_id", "item_id", "creado_en", "actualizado_en", "consulta", "_idLocal"]);
export function normalizarProductos({ items = [], envios = [] } = {}) {
  const sinVol = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !VOLATILES.has(k) && k !== "envio_key"));
  const idx = new Map((envios || []).map((e, i) => [e.key, i]));
  return { items: (items || []).map((it) => ({ ...sinVol(it), envio: it.envio_key != null && idx.has(it.envio_key) ? sinVol(envios[idx.get(it.envio_key)]) : null })) };
}

// grupos: [{ k, etiqueta, claves: [campo, …], normalizar?(valores) , resumen?(valores) }]
export function combinarVersiones({ base, mio, bfk, grupos }) {
  const tomar = (o, g) => Object.fromEntries(g.claves.map((k) => [k, o ? o[k] : undefined]));
  return grupos.map((g) => {
    const n = (o) => (o == null ? null : canon(g.normalizar ? g.normalizar(tomar(o, g)) : tomar(o, g)));
    const M = n(mio), B = n(bfk), A = base ? n(base) : null;
    const estado = M === B ? "igual" : A !== null && M === A ? "solo_bfk" : A !== null && B === A ? "solo_mio" : "conflicto";
    const res = (o) => (g.resumen ? g.resumen(tomar(o, g)) : g.claves.map((k) => textoValor(o?.[k])).join(" · "));
    return { k: g.k, etiqueta: g.etiqueta, estado, resumenMio: res(mio), resumenBfk: res(bfk) };
  });
}

// Aplica la combinación sobre la versión de BFK: campos «solo_mio» y conflictos elegidos como «mio» toman lo escrito.
export function aplicarCombinacion({ mio, bfk, grupos, campos, elecciones = {} }) {
  const r = clonar(bfk);
  for (const c of campos) {
    const g = grupos.find((x) => x.k === c.k); if (!g) continue;
    if (c.estado === "solo_mio" || (c.estado === "conflicto" && elecciones[c.k] === "mio")) for (const k of g.claves) r[k] = clonar(mio[k]);
  }
  return r;
}

export function textoValor(v) {
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "boolean") return v ? "Sí" : "No";
  if (Array.isArray(v)) return v.length ? `${v.length} elemento${v.length === 1 ? "" : "s"}` : "—";
  if (typeof v === "object") return "(datos)";
  const s = String(v); return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

// Resumen legible de productos (nombre · cantidad), para comparar lo tuyo y lo de BFK.
export const resumenProductos = ({ items = [] } = {}) => (items || []).length
  ? (items || []).map((it, i) => `${i + 1}. ${String(it?.ficha?.nombre || it?.descripcion || "Producto").trim()} × ${it?.cantidad ?? "?"}`).join(" | ")
  : "Sin productos";
