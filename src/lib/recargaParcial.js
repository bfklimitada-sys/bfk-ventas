// Consumo de Supabase — fase 1 (15/11/2026). Funciones puras de la recarga parcial.
// Antes, cada guardado, cada renovación de sesión y cada regreso a la pestaña volvían a descargar TODA la base
// (≈ 2,69 MB, ≈ 229 veces al día). Ahora tras un guardado se releen solo las OCs afectadas (con sus eventos, productos,
// comentarios, reclamos, responsables, post-venta, seguimientos y foto de Mercado Público) y las tablas pequeñas que
// la base recalcula (financiadores). Estas funciones arman el MISMO resultado que la carga completa para esas OCs,
// de modo que los cálculos (comisiones, F29, caja, cobranza, etc.) reciben exactamente los mismos datos.

export const INTERVALO_RECARGA_MS = 15 * 60 * 1000;   // al volver a la pestaña: recarga completa solo si pasaron 15 min
export const INTERVALO_CORREOS_MS = 5 * 60 * 1000;    // correos: solo los nuevos o gestionados, cada 5 min y con la app visible
export const LIMITE_HISTORIAL = 200;                  // igual que la carga completa (últimos 200 cambios)

// ¿Corresponde recargar? (nunca cargado → sí; si no, solo pasado el intervalo)
export const debeRecargar = (ultima, ahora = Date.now(), intervalo = INTERVALO_RECARGA_MS) => !ultima || ahora - ultima >= intervalo;

// Filtro PostgREST «campo en (…)», con cada valor entre comillas (admite cualquier carácter en los ids).
export const filtroIn = (campo, valores) => {
  const v = [...new Set((valores || []).filter((x) => x !== null && x !== undefined && x !== ""))];
  return v.length ? `&${campo}=in.(${v.map((x) => `"${encodeURIComponent(String(x))}"`).join(",")})` : null;
};

const agrupar = (filas, clave) => { const m = {}; for (const r of filas || []) (m[r[clave]] ||= []).push(r); return m; };

// Arma las OCs tal como la carga completa: eventos embebidos + reclamos, responsables, post-venta, seguimientos con su
// bitácora y foto de Mercado Público; y el enlace (url) de cada línea de producto: el de largo normal desde `urls`,
// el extenso desde `urlsExtensas` (solo si ya se abrió su OC). Una línea sin enlace conocido queda con url undefined.
export function componerOCs(ocsD, { reclamos = [], responsables = [], postventa = [], seguimientos = [], bitacora = [], fotos = {}, urls = [], urlsExtensas = {} } = {}) {
  const reclamosPorOC = agrupar(reclamos, "oc_id"), respPorOC = agrupar(responsables, "oc_id"), pvPorOC = agrupar(postventa, "oc_id");
  const bitacoraSeg = {}; for (const h of bitacora || []) { const k = String(h.campo || "").slice(12); if (k) (bitacoraSeg[k] ||= []).push(h); }
  const segPorOC = {}; for (const r of seguimientos || []) (segPorOC[r.oc_id] ||= []).push({ ...r, bitacora: bitacoraSeg[r.id] || [] });
  const urlDe = new Map((urls || []).map((u) => [u.id, u.url]));
  return (ocsD || []).map((oc) => ({
    ...oc,
    ...(Array.isArray(oc.oc_productos_link) ? { oc_productos_link: oc.oc_productos_link.map((l) => {
      if (l.url !== undefined) return l;   // la base devolvió la fila completa (compatibilidad)
      if (urlDe.has(l.id)) return { ...l, url: urlDe.get(l.id) };
      if (Object.prototype.hasOwnProperty.call(urlsExtensas, l.id)) return { ...l, url: urlsExtensas[l.id] };
      return l;
    }) } : {}),
    oc_reclamos: reclamosPorOC[oc.id] || [], oc_responsables: respPorOC[oc.id] || [], eventos_postventa: pvPorOC[oc.id] || [],
    oc_seguimientos: segPorOC[oc.id] || [], mp: fotos[oc.id] || null,
  }));
}

// Líneas de producto de las OCs cuyo enlace aún no se descargó (enlace extenso).
export const lineasSinUrl = (ocs) => (ocs || []).flatMap((o) => (o.oc_productos_link || []).filter((l) => l.url === undefined).map((l) => l.id));

// Fotos de Mercado Público (filas de mp_cache_avisos) → { ocId: datos }
export function fotosPorOC(filas, prefijo) {
  const f = {};
  for (const r of filas || []) if (String(r?.id || "").startsWith(prefijo) && r.datos && !Array.isArray(r.datos)) f[String(r.id).slice(prefijo.length)] = r.datos;
  return f;
}

// Reemplaza en las listas (activas y archivadas) las OCs releídas, respetando el orden (creadoEn descendente, como la
// carga completa). Las OCs pedidas que ya no existen se quitan; una OC que cambió de archivo pasa a la otra lista.
export function mezclarOCs({ activas = [], archivadas = [] }, nuevas, idsPedidos) {
  const porId = new Map((nuevas || []).map((o) => [o.id, o]));
  const pedidas = new Set(idsPedidos || []);
  const aplicar = (lista, archivada) => {
    const r = [];
    for (const o of lista) {
      if (!pedidas.has(o.id)) { r.push(o); continue; }
      const n = porId.get(o.id);
      // Reemplazo en su lugar; si no cambió nada se conserva el mismo objeto (la pantalla no se vuelve a armar).
      if (n && !!n.archivada === archivada) r.push(JSON.stringify(n) === JSON.stringify(o) ? o : n);
    }
    // Las nuevas (o que cambiaron de lista) se insertan en su posición por fecha de creación.
    for (const n of nuevas || []) {
      if (!!n.archivada !== archivada || r.some((o) => o.id === n.id)) continue;
      const i = r.findIndex((o) => String(o.creadoEn || "") < String(n.creadoEn || ""));
      if (i < 0) r.push(n); else r.splice(i, 0, n);
    }
    return r;
  };
  return { activas: aplicar(activas, false), archivadas: aplicar(archivadas, true) };
}

// Historial: agrega los cambios nuevos a los ya cargados y deja los últimos `limite`, del más nuevo al más antiguo.
export function mezclarHistorial(actual, nuevas, limite = LIMITE_HISTORIAL) {
  const m = new Map(); for (const h of actual || []) m.set(h.id, h); for (const h of nuevas || []) m.set(h.id, h);
  return [...m.values()].sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || ""))).slice(0, limite);
}
export const ultimoHistorial = (lista) => (lista || []).reduce((mx, h) => (String(h.creadoEn || "") > mx ? String(h.creadoEn) : mx), "");

// Correos: punto de corte de la consulta incremental (lo más reciente sincronizado o gestionado que ya se tiene).
export function cursorCorreos(lista) {
  let s = "", g = "";
  for (const c of lista || []) { if (String(c.sincronizado_en || "") > s) s = String(c.sincronizado_en); if (String(c.gestionado_en || "") > g) g = String(c.gestionado_en); }
  return { sincronizado: s || "1970-01-01T00:00:00Z", gestionado: g || "1970-01-01T00:00:00Z" };
}
// Agrega o reemplaza los correos nuevos o modificados y aplica el mismo criterio que la carga completa
// (pendientes o de los últimos 30 días, del más nuevo al más antiguo, máximo 500).
export function mezclarCorreos(actual, nuevas, desdeIso, limite = 500) {
  const m = new Map(); for (const c of actual || []) m.set(c.id, c); for (const c of nuevas || []) m.set(c.id, { ...(m.get(c.id) || {}), ...c });
  return [...m.values()].filter((c) => c.estado === "pendiente" || String(c.fecha || "") >= String(desdeIso || ""))
    .sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || ""))).slice(0, limite);
}
