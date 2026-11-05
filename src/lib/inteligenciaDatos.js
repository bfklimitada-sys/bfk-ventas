// ═══════════════════════════════════════════════════════════════
// Datos de Inteligencia Comercial (04/11/2026). SOLO LECTURA desde el navegador; la sincronización con ChileCompra
// ocurre en el servidor (/api/inteligencia) y escribe solo en las tablas ic_ (por función).
//  · Modo "base": funciones ic_resumen_v2 / ic_detalle_v2 (05/11/2026: criterio de fecha de presentación o de
//    adjudicación, indicadores de cobertura). Si aún no están instaladas → modo "base_v1": ic_resumen / ic_detalle del
//    04/11 (solo criterio de presentación). Si tampoco → modo "local": se calcula en el navegador con los estados de las
//    cotizaciones (sin resultados de ChileCompra), con la MISMA lógica (lib/inteligenciaComercial.js).
// Caché por período y criterio (60 s) y cancelación de consultas obsoletas (AbortSignal).
// Sincronización (05/11/2026): continúa sola tras las pausas que pide ChileCompra, se puede cancelar y reanudar (lo
// consultado queda guardado en la base), informa el avance real y tiene topes para no repetir sin fin.
// ═══════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";
import { construirOportunidades, filtrarOportunidades, resumenConCriterio, ordenarPaginar, ESTADOS_PRESENTADOS, criterioDe } from "./inteligenciaComercial.js";

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
const parametrosV2 = (f) => ({ ...parametros(f), p_criterio: criterioDe(f.criterio) });
const detalleParams = (o) => ({ p_q: o.q || "", p_orden: o.orden || "fecha_presentacion", p_desc: o.desc !== false, p_limite: o.porPagina || 15, p_offset: (o.pagina || 0) * (o.porPagina || 15) });

export function crearFuente(tokenFn) {
  const tk = () => (typeof tokenFn === "function" ? tokenFn() : tokenFn);
  let modo = null;                     // null (sin detectar) | "base" (v2) | "base_v1" | "local"
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
  // v2 → v1 → local: una función inexistente significa que esa migración aún no está instalada.
  const conModo = async (v2, v1, enLocal) => {
    if (modo === null || modo === "base") {
      try { const v = await v2(); modo = "base"; return v; }
      catch (e) { if (!SIN_FUNCION.includes(e.codigo)) throw e; modo = "base_v1"; }
    }
    if (modo === "base_v1") {
      try { return await v1(); }
      catch (e) { if (!SIN_FUNCION.includes(e.codigo)) throw e; modo = "local"; }
    }
    return enLocal();
  };
  // Sin las funciones v2 no hay criterio de adjudicación: se responde con presentación y se informa.
  const soloPresentacion = (f) => ({ ...f, criterio: "presentacion" });
  return {
    get modo() { return modo; },
    get criterioAdjudicacionDisponible() { return modo === "base"; },
    invalidar() { cache.clear(); local = null; },
    async resumen(f, { signal } = {}) {
      return enCache("r" + JSON.stringify(f) + modo, () => conModo(
        () => rpc(tk(), "ic_resumen_v2", parametrosV2(f), signal),
        async () => ({ ...(await rpc(tk(), "ic_resumen", parametros(f), signal)), criterio: "presentacion" }),
        async () => resumenConCriterio(await oportunidadesLocales(signal), soloPresentacion(f))));
    },
    async detalle(f, o, { signal } = {}) {
      return enCache("d" + JSON.stringify([f, o]) + modo, () => conModo(
        () => rpc(tk(), "ic_detalle_v2", { ...parametrosV2(f), ...detalleParams(o) }, signal),
        () => rpc(tk(), "ic_detalle", { ...parametros(f), ...detalleParams({ ...o, orden: o.orden === "fecha_adjudicacion" ? "fecha_presentacion" : o.orden }) }, signal),
        async () => ordenarPaginar(filtrarOportunidades(await oportunidadesLocales(signal), soloPresentacion(f)), o)));
    },
    // Todas las filas del período (exportación), en páginas de 1.000.
    async todas(f, { signal } = {}) {
      const out = []; let pagina = 0;
      for (;;) {
        const p = await this.detalle(f, { orden: criterioDe(f.criterio) === "adjudicacion" ? "fecha_adjudicacion" : "fecha_presentacion", desc: true, pagina, porPagina: 1000 }, { signal });
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

// ── Sincronización con ChileCompra ───────────────────────────────────────────
// Llama a /api/inteligencia ronda tras ronda hasta que no quede nada por consultar ahora. Si ChileCompra pide bajar la
// velocidad (pausa_ms) espera y continúa; si BFK limita las llamadas seguidas o hay otra sincronización en curso,
// espera y reintenta. Termina siempre: cancelación, topes de rondas y de tiempo, pausas seguidas o rondas sin avance.
// Nunca descarta lo ya hecho: cada código consultado queda guardado en la base al momento (reanudar = volver a llamar).
// esperaReintentoMaxMs: si no queda nada por consultar AHORA pero hay detalles «por verificar» o errores con reintento
// dentro de ese plazo (1–4 min tras una falla temporal), se espera y se continúa (máx. maxEsperasReintento veces).
export const SINC = { maxRondas: 150, maxMinutos: 45, maxPausasSeguidas: 6, maxSinAvance: 3, maxFallasRed: 2, maxEnCurso: 3,
  pausaMaxMs: 120_000, esperaRedMs: 5_000, esperaEnCursoMs: 15_000, esperaReintentoMaxMs: 180_000, maxEsperasReintento: 5 };
export function esperaCancelable(ms, signal) {
  return new Promise((ok) => {
    if (signal?.aborted) return ok(false);
    const t = setTimeout(() => { signal?.removeEventListener?.("abort", fin); ok(true); }, Math.max(0, ms));
    const fin = () => { clearTimeout(t); ok(false); };
    signal?.addEventListener?.("abort", fin, { once: true });
  });
}
const sumar = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + (Number(v) || 0); return o; };
export async function sincronizarResultados(token, { forzar = false, origen = "manual", onProgreso, signal, f = (...a) => fetch(...a), esperar = esperaCancelable, lim = SINC, ahora = Date.now } = {}) {
  const t0 = ahora();
  const total = { procesados: 0, actualizados: 0, errores: 0, rondas: 0, respuestas_429: 0, pausas: 0, conteo: {}, ganadas_nuevas: [], cola: null,
    limite_alcanzado: false, completo: false, motivo_fin: "", error: null, codigo: "" };
  const avisar = (extra = {}) => { try { onProgreso && onProgreso({ ...total, conteo: { ...total.conteo }, ganadas_nuevas: [...total.ganadas_nuevas], ...extra }); } catch { /* la interfaz no frena la sincronización */ } };
  let ritmo, primera = true, pausasSeguidas = 0, sinAvance = 0, fallasRed = 0, enCurso = 0, esperasReintento = 0;
  const pausar = async (ms, motivo) => { total.pausas++; avisar({ fase: "pausa", motivo_pausa: motivo, pausa_ms: ms, pausa_hasta: ahora() + ms }); return esperar(ms, signal); };
  for (;;) {
    if (signal?.aborted) { total.motivo_fin = "cancelado"; break; }
    if (total.rondas >= lim.maxRondas) { total.motivo_fin = "tope_rondas"; break; }
    if (ahora() - t0 > lim.maxMinutos * 60_000) { total.motivo_fin = "tope_tiempo"; break; }
    avisar({ fase: "consultando" });
    let r, c;
    try {
      r = await f("/api/inteligencia", { method: "POST", headers: { Authorization: `Bearer ${typeof token === "function" ? token() : token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ forzar: forzar && primera, origen, ...(ritmo ? { ritmo_ms: ritmo } : {}) }), signal });
      c = await r.json().catch(() => null); fallasRed = 0;
    } catch (e) {
      if (e?.name === "AbortError" || signal?.aborted) { total.motivo_fin = "cancelado"; break; }
      if (++fallasRed <= lim.maxFallasRed && await pausar(lim.esperaRedMs, "red")) continue;
      if (signal?.aborted) { total.motivo_fin = "cancelado"; break; }
      total.error = "Sin conexión con el servidor de BFK. Lo ya consultado quedó guardado: presiona «Actualizar resultados» para reanudar."; total.motivo_fin = "error"; break;
    }
    if (r.status === 429 && c?.codigo === "LIMITE_BFK") {   // límite propio de BFK (llamadas seguidas): esperar y seguir
      if (++pausasSeguidas > lim.maxPausasSeguidas) { total.motivo_fin = "limite_persistente"; break; }
      if (!(await pausar(Math.min(lim.pausaMaxMs, Number(c.reintentar_ms) || 60_000), "bfk"))) { total.motivo_fin = "cancelado"; break; }
      continue;
    }
    if (r.status === 409 && c?.codigo === "EN_CURSO") {
      if (++enCurso > lim.maxEnCurso) { total.error = "Hay otra sincronización en curso. Espera a que termine e inténtalo de nuevo."; total.codigo = "EN_CURSO"; total.motivo_fin = "error"; break; }
      if (!(await pausar(lim.esperaEnCursoMs, "en_curso"))) { total.motivo_fin = "cancelado"; break; }
      continue;
    }
    if (!r.ok || !c?.ok) {
      total.error = c?.error || (r.status === 404 ? "La sincronización no está disponible en este entorno." : `No se pudo sincronizar (HTTP ${r.status}).`);
      total.codigo = c?.codigo || ""; total.motivo_fin = "error"; break;
    }
    primera = false; enCurso = 0; total.rondas++;
    total.procesados += c.procesados || 0; total.actualizados += c.actualizados || 0; total.errores += c.errores || 0;
    total.respuestas_429 += c.respuestas_429 || 0; total.limite_alcanzado = total.limite_alcanzado || !!c.limite_alcanzado;
    total.conteo = sumar(total.conteo, c.conteo); total.ganadas_nuevas.push(...(c.ganadas_nuevas || []));
    if (c.cola) total.cola = c.cola; if (c.ritmo_ms) ritmo = c.ritmo_ms;
    avisar({ fase: "consultando", ultima: c });
    if (!c.hay_mas) {
      // Nada listo ahora. Si hay fallas temporales con reintento próximo (detalle por verificar o listado con error), se
      // espera hasta entonces y se continúa; si el próximo intento es lejano, se termina (se retoma en otra actualización).
      const q = c.cola; const prox = q?.proximo_reintento ? Date.parse(q.proximo_reintento) - ahora() : null;
      if (q && (q.por_verificar > 0 || q.con_error > 0) && prox !== null && prox <= lim.esperaReintentoMaxMs && esperasReintento < lim.maxEsperasReintento) {
        esperasReintento++;
        if (!(await pausar(Math.max(1_000, prox + 2_000), "reintento"))) { total.motivo_fin = "cancelado"; break; }
        continue;
      }
      total.completo = true; total.motivo_fin = "completo"; break;
    }
    if (c.pausa_ms > 0) {   // ChileCompra pidió bajar la velocidad: pausa y continúa (sin detenerse definitivamente)
      if (++pausasSeguidas > lim.maxPausasSeguidas) { total.motivo_fin = "limite_persistente"; break; }
      if (!(await pausar(Math.min(lim.pausaMaxMs, c.pausa_ms), "chilecompra"))) { total.motivo_fin = "cancelado"; break; }
      continue;
    }
    pausasSeguidas = 0;
    if (!(c.procesados > 0)) { if (++sinAvance >= lim.maxSinAvance) { total.motivo_fin = "sin_avance"; break; } } else sinAvance = 0;
  }
  avisar({ fase: "fin" });
  return total;
}

// Una sola sincronización a la vez en la pestaña, independiente de la pantalla: si se cierra el desplegable o se cambia
// de módulo, sigue en segundo plano y al volver se ve su avance (y se puede cancelar).
export function crearControlSincronizacion(sinc = sincronizarResultados) {
  let estado = { activa: false, progreso: null, resultado: null, origen: null, iniciada: null }; let ctrl = null; let promesa = null; const subs = new Set();
  const emitir = () => { for (const fn of subs) { try { fn(estado); } catch { /* suscriptor */ } } };
  return {
    get estado() { return estado; },
    suscribir(fn) { subs.add(fn); fn(estado); return () => subs.delete(fn); },
    iniciar(token, opciones = {}) {
      if (estado.activa) return promesa;
      ctrl = new AbortController();
      estado = { activa: true, progreso: { fase: "consultando", procesados: 0, rondas: 0, conteo: {} }, resultado: null, origen: opciones.origen || "manual", iniciada: Date.now() }; emitir();
      promesa = sinc(token, { ...opciones, signal: ctrl.signal, onProgreso: (p) => { estado = { ...estado, progreso: p }; emitir(); } })
        .catch((e) => ({ error: e?.message || "No se pudo sincronizar.", motivo_fin: "error", procesados: 0, conteo: {} }))
        .then((r) => { estado = { ...estado, activa: false, resultado: r }; emitir(); return r; });
      return promesa;
    },
    cancelar() { ctrl?.abort(); },
  };
}
export const controlSincronizacion = crearControlSincronizacion();
