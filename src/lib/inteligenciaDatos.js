// ═══════════════════════════════════════════════════════════════
// Datos de Inteligencia Comercial (04/11/2026). SOLO LECTURA desde el navegador; la sincronización con ChileCompra
// ocurre en el servidor (/api/inteligencia) y escribe solo en las tablas ic_ (por función).
//  · Modo "base": funciones ic_resumen / ic_detalle (agregados y paginación en PostgreSQL).
//  · Modo "local": la migración aún no está instalada → se calcula en el navegador con los estados de las
//    cotizaciones (sin resultados de ChileCompra), con la MISMA lógica (lib/inteligenciaComercial.js).
// Caché por período (60 s) y cancelación de consultas obsoletas (AbortSignal).
// ═══════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";
import { construirOportunidades, filtrarOportunidades, resumirOportunidades, ordenarPaginar, ESTADOS_PRESENTADOS } from "./inteligenciaComercial.js";

const cab = (t, extra = {}) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });
const SIN_FUNCION = ["PGRST202", "42883"]; const SIN_TABLA = ["PGRST205", "42P01"];
export const TTL_MS = 60_000;

async function rpc(token, fn, body, signal) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: cab(token, { "Content-Type": "application/json" }), body: JSON.stringify(body), signal });
  const c = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(c?.message || `HTTP ${r.status}`), { status: r.status, codigo: c?.code });
  return c;
}
const parametros = (f) => ({ p_desde: f.desde || null, p_hasta: f.hasta || null, p_institucion: f.institucion || "", p_vendedor: f.vendedor || "", p_resultado: f.resultado || "" });

export function crearFuente(tokenFn) {
  const tk = () => (typeof tokenFn === "function" ? tokenFn() : tokenFn);
  let modo = null;                     // null (sin detectar) | "base" | "local"
  const cache = new Map();             // clave → { t, valor }
  let local = null;                    // { t, filas } (modo local)
  const enCache = async (clave, fn) => {
    const c = cache.get(clave); if (c && Date.now() - c.t < TTL_MS) return c.valor;
    const valor = await fn(); cache.set(clave, { t: Date.now(), valor }); return valor;
  };
  const leer = async (q, signal) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${q}`, { headers: cab(tk()), signal });
    const c = await r.json().catch(() => null);
    if (!r.ok) throw Object.assign(new Error(c?.message || `HTTP ${r.status}`), { status: r.status, codigo: c?.code });
    return c || [];
  };
  // Modo local: cotizaciones presentadas y la primera versión presentada de cada una (sin datos financieros).
  const oportunidadesLocales = async (signal) => {
    if (local && Date.now() - local.t < TTL_MS) return local.filas;
    const estados = ESTADOS_PRESENTADOS.join(",");
    let cot;
    try { cot = await leer(`cotizaciones?select=id,id_externo,nombre,institucion,rut,fecha,estado,subtotal_neto,impuestos,total,oc_codigo,vendedor_id,vendedor_nombre,actualizado_en&estado=in.(${estados})&limit=5000`, signal); }
    catch (e) { if (SIN_TABLA.includes(e.codigo)) return []; throw e; }
    const ids = cot.map((c) => c.id); const ver = [];
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150).join(",");
      ver.push(...await leer(`cotizacion_versiones?select=cotizacion_id,estado:contenido->>estado,guardado_en&cotizacion_id=in.(${lote})&contenido->>estado=in.(${estados})&limit=10000`, signal));
    }
    local = { t: Date.now(), filas: construirOportunidades(cot, ver, []) };
    return local.filas;
  };
  const conModo = async (base, enLocal) => {
    if (modo !== "local") {
      try { const v = await base(); modo = "base"; return v; }
      catch (e) { if (!SIN_FUNCION.includes(e.codigo)) throw e; modo = "local"; }   // función inexistente = migración no instalada
    }
    return enLocal();
  };
  return {
    get modo() { return modo; },
    invalidar() { cache.clear(); local = null; },
    async resumen(f, { signal } = {}) {
      return enCache("r" + JSON.stringify(f) + modo, () => conModo(
        () => rpc(tk(), "ic_resumen", parametros(f), signal),
        async () => resumirOportunidades(filtrarOportunidades(await oportunidadesLocales(signal), f), { desde: f.desde || null, hasta: f.hasta || null })));
    },
    async detalle(f, o, { signal } = {}) {
      return enCache("d" + JSON.stringify([f, o]) + modo, () => conModo(
        () => rpc(tk(), "ic_detalle", { ...parametros(f), p_q: o.q || "", p_orden: o.orden || "fecha_presentacion", p_desc: o.desc !== false, p_limite: o.porPagina || 15, p_offset: (o.pagina || 0) * (o.porPagina || 15) }, signal),
        async () => ordenarPaginar(filtrarOportunidades(await oportunidadesLocales(signal), f), o)));
    },
    // Todas las filas del período (exportación), en páginas de 1.000.
    async todas(f, { signal } = {}) {
      const out = []; let pagina = 0;
      for (;;) {
        const p = await this.detalle(f, { orden: "fecha_presentacion", desc: true, pagina, porPagina: 1000 }, { signal });
        out.push(...p.filas); if (p.filas.length < 1000 || out.length >= p.total) return out; pagina++;
      }
    },
    // Opciones de los filtros (instituciones y vendedores con oportunidades) desde la primera página amplia.
    async opciones({ signal } = {}) {
      const filas = await this.todas({}, { signal });
      const uniq = (xs) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
      return { instituciones: uniq(filas.map((o) => o.institucion)), vendedores: uniq(filas.map((o) => o.vendedor_nombre)), sinVendedor: filas.some((o) => !o.vendedor_nombre) };
    },
  };
}

// Sincronización manual o automática: llama a /api/inteligencia hasta terminar (o hasta un límite, error o cancelación).
// Nunca bloquea el Panel: la interfaz la ejecuta en segundo plano y muestra el progreso.
export async function sincronizarResultados(token, { forzar = false, origen = "manual", rondas = 30, onProgreso, signal } = {}) {
  const total = { procesados: 0, actualizados: 0, errores: 0, rondas: 0, limite_alcanzado: false };
  for (let i = 0; i < rondas; i++) {
    if (signal?.aborted) break;
    let r, c;
    try { r = await fetch("/api/inteligencia", { method: "POST", headers: { Authorization: `Bearer ${typeof token === "function" ? token() : token}`, "Content-Type": "application/json" }, body: JSON.stringify({ forzar: forzar && i === 0, origen }), signal }); c = await r.json().catch(() => null); }
    catch (e) { if (e?.name === "AbortError") break; throw new Error("Sin conexión con el servidor de BFK. Los resultados guardados siguen disponibles."); }
    if (!r.ok || !c?.ok) throw Object.assign(new Error(c?.error || (r.status === 404 ? "La sincronización no está disponible en este entorno." : `No se pudo sincronizar (HTTP ${r.status}).`)), { codigo: c?.codigo || "", parcial: total });
    total.rondas++; total.procesados += c.procesados || 0; total.actualizados += c.actualizados || 0; total.errores += c.errores || 0; total.limite_alcanzado = !!c.limite_alcanzado;
    onProgreso && onProgreso({ ...total, ultima: c });
    if (!c.hay_mas || c.limite_alcanzado || !c.procesados) break;
  }
  return total;
}
