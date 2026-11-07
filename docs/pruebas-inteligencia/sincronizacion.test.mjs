// Inteligencia Comercial (05/11/2026): ciclo de sincronización del NAVEGADOR (src/lib/inteligenciaDatos.js) con el
// servidor REAL (api/inteligencia.mjs, crearManejador) y ChileCompra y la base SIMULADAS. Nada sale a la red.
// Comprueba: continúa sola tras la pausa que pide ChileCompra (429), espera el límite propio de BFK y otra
// sincronización en curso, cancela en cualquier momento, reanuda sin perder lo hecho, termina siempre (topes de pausas,
// rondas sin avance, rondas y tiempo), no se repite sin fin, informa el avance real y nunca descarta lo ya contado.
// Uso: node docs/pruebas-inteligencia/sincronizacion.test.mjs
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url)); const RAIZ = join(AQUI, "..", "..");
const D = mkdtempSync(join(tmpdir(), "ic-sinc-"));
// Empaqueta inteligenciaDatos.js reemplazando solo supabase.jsx (constantes de conexión) por un sustituto sin red.
const stub = { name: "stub-supabase", setup(b) { b.onResolve({ filter: /\/supabase\.jsx$/ }, () => ({ path: "stub", namespace: "stub" })); b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: 'export const SUPABASE_URL="https://simulado.invalid"; export const SUPABASE_ANON_KEY="anon";', loader: "js" })); } };
await build({ entryPoints: [join(RAIZ, "src/lib/inteligenciaDatos.js")], bundle: true, format: "esm", platform: "node", outfile: join(D, "datos.mjs"), plugins: [stub], logLevel: "silent" });
const { sincronizarResultados, crearControlSincronizacion, SINC, esperaCancelable } = await import(pathToFileURL(join(D, "datos.mjs")).href);
const { crearManejador, LIMITES } = await import(pathToFileURL(join(RAIZ, "api/inteligencia.mjs")).href);
const { respuestasMP } = await import(pathToFileURL(join(AQUI, "fixture.mjs")).href);
writeFileSync(join(D, "ok"), "");

let F = 0, N = 0;
const ok = (k, c, d) => { N++; if (c) console.log("OK    " + k); else { F++; console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } };

// ── Reloj simulado: las esperas avanzan el reloj (no se espera de verdad) ──
const reloj = { t: Date.parse("2026-11-05T12:00:00Z") }; const ahora = () => reloj.t;
const realST = globalThis.setTimeout, realCT = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms) => { reloj.t += Math.max(0, ms || 0); return realST(fn, 0); };
const esperas = [];
const esperar = async (ms, signal) => { esperas.push(ms); if (signal?.aborted) return false; reloj.t += ms; await new Promise((r) => realST(r, 0)); return !signal?.aborted; };

// ── Servidor real con base y ChileCompra simuladas ──
const mp = respuestasMP();
function entorno({ codigos, cola429 = {}, ticketMalo = false } = {}) {
  const res = new Map();   // codigo → { resultado, proximo }
  const llamadasMP = []; const llamadasAPI = [];
  const rpcDe = () => async (fn, body) => {
    if (fn === "ic_pendientes_sincronizar") return codigos.filter((c) => !res.has(c) || (res.get(c).proximo !== null && res.get(c).proximo <= reloj.t)).slice(0, body.p_limite).map((codigo) => ({ codigo, detalle_consultado: false }));
    if (fn === "ic_registrar_resultado") {
      const p = body.p; const ant = res.get(p.codigo);
      const proximo = ["ganada", "perdida", "desierta", "cancelada", "sin_oferta_bfk"].includes(p.resultado) ? null : p.resultado === "pendiente" ? reloj.t + 6 * 3600_000
        : p.reintento_detalle === "sin_tiempo" ? reloj.t : reloj.t + 60_000;
      res.set(p.codigo, { resultado: p.resultado, proximo }); return { resultado: p.resultado, cambio: !ant || ant.resultado !== p.resultado };
    }
    if (fn === "ic_estado_sincronizacion") {
      const sin = codigos.filter((c) => !res.has(c)).length; const elegibles = codigos.filter((c) => !res.has(c) || (res.get(c).proximo !== null && res.get(c).proximo <= reloj.t)).length;
      const pv = [...res.values()].filter((x) => x.resultado === "sin_informacion").length;
      const futuros = [...res.values()].map((x) => x.proximo).filter((x) => x && x > reloj.t);
      return { total: codigos.length, sin_consultar: sin, por_verificar: pv, en_proceso: 0, finales: 0, con_error: 0, elegibles_ahora: elegibles, proximo_reintento: futuros.length ? new Date(Math.min(...futuros)).toISOString() : null };
    }
    return 1;
  };
  const fMP = async (url) => {
    const det = !url.includes("?id="); const cod = decodeURIComponent(det ? url.split("/").pop() : url.split("?id=")[1]); llamadasMP.push({ url, t: reloj.t });
    if (ticketMalo) return { status: 401, json: async () => ({}) };
    const k = (det ? "D:" : "L:") + cod; if (cola429[k]?.length && cola429[k].shift()) return { status: 429, headers: { get: () => null }, json: async () => ({}) };
    const base = cod.replace(/^X\d+-/, "");   // códigos sintéticos «X<n>-1001-3-COT26» reutilizan la respuesta del fixture
    const r = mp[base] || mp["1001-3-COT26"];
    if (det) return { status: 200, json: async () => ({ payload: { ...r.detalle, codigo: cod } }) };
    return { status: 200, json: async () => ({ payload: { items: [{ ...r.listado, codigo: cod }] } }) };
  };
  const manejador = crearManejador({ interruptor: () => true, validar: async () => ({ uid: "adm", token: "tk", admin: true }), rpcDe, ticketDe: () => "T", f: fMP, lim: { ...LIMITES, llamadasPorMinuto: 1000 } });
  // fetch del navegador → manejador en proceso (misma forma que Vercel)
  const f = async (url, o) => {
    if (o?.signal?.aborted) throw Object.assign(new Error("abort"), { name: "AbortError" });
    const body = JSON.parse(o.body); llamadasAPI.push(body);
    const out = { code: 200, body: null };
    await manejador({ method: "POST", headers: { authorization: "Bearer tk" }, body }, { setHeader() {}, status(c) { out.code = c; return this; }, json(b) { out.body = b; return this; } });
    return { ok: out.code >= 200 && out.code < 300, status: out.code, json: async () => out.body };
  };
  return { f, res, llamadasMP, llamadasAPI };
}
const cods = (n, base = "1001-3-COT26") => Array.from({ length: n }, (_, i) => `X${i}-${base}`);
const lim = { ...SINC };

// 1) Varias rondas hasta terminar, con avance real informado
{
  const e = entorno({ codigos: [...cods(30, "1001-3-COT26"), ...cods(20, "1001-2-COT26")] }); const avances = [];
  const r = await sincronizarResultados("tk", { f: e.f, esperar, lim, ahora, onProgreso: (p) => avances.push(p) });
  ok("C01_completa_en_varias_rondas", r.motivo_fin === "completo" && r.completo && r.rondas >= 2 && r.procesados === 50 && e.res.size === 50, { m: r.motivo_fin, rondas: r.rondas, p: r.procesados });
  ok("C01_conteo_diferenciado", r.conteo.pendiente === 30 && r.conteo.perdida === 20 && !r.conteo.ganada, r.conteo);
  ok("C01_avance_real_con_cola", avances.some((a) => a.fase === "consultando" && a.cola && a.cola.elegibles_ahora > 0) && avances.at(-1).fase === "fin" && r.cola.elegibles_ahora === 0, avances.map((a) => a.cola?.elegibles_ahora));
  ok("C01_ritmo_se_pasa_entre_rondas", e.llamadasAPI.slice(1).every((b) => b.ritmo_ms >= LIMITES.pausaMinMs) && !("ritmo_ms" in e.llamadasAPI[0]));
  const e2 = entorno({ codigos: cods(45) }); await sincronizarResultados("tk", { f: e2.f, esperar, lim, ahora, forzar: true });
  ok("C01_forzar_solo_en_la_primera", e2.llamadasAPI.length >= 2 && e2.llamadasAPI[0].forzar === true && e2.llamadasAPI.slice(1).every((b) => b.forzar === false), e2.llamadasAPI.map((b) => b.forzar));
}
// 2) ChileCompra pide bajar la velocidad (429 insistente en un código) → pausa y CONTINÚA hasta completar
{
  const codigos = cods(6); const e = entorno({ codigos, cola429: { [`L:${codigos[2]}`]: [1, 1, 1, 1] } }); esperas.length = 0; const fases = [];
  const r = await sincronizarResultados("tk", { f: e.f, esperar, lim, ahora, onProgreso: (p) => fases.push(p.fase + ":" + (p.motivo_pausa || "")) });
  ok("C02_pausa_y_continua_hasta_completar", r.motivo_fin === "completo" && e.res.size === 6 && r.pausas >= 1 && esperas.includes(LIMITES.pausaSugeridaMs), { m: r.motivo_fin, n: e.res.size, esperas });
  ok("C02_pausa_informada_a_la_interfaz", fases.includes("pausa:chilecompra"), fases);
  ok("C02_429_contados", r.respuestas_429 === 4 && r.limite_alcanzado, r.respuestas_429);
}
// 3) ChileCompra insiste siempre → se detiene tras N pausas seguidas (sin ciclo infinito) y conserva lo hecho
{
  const codigos = cods(3); const cola = { [`L:${codigos[0]}`]: Array(500).fill(1) };
  const e = entorno({ codigos, cola429: cola });
  const r = await sincronizarResultados("tk", { f: e.f, esperar, lim: { ...lim, maxPausasSeguidas: 3 }, ahora });
  ok("C03_limite_persistente_termina", r.motivo_fin === "limite_persistente" && r.pausas === 3 && e.llamadasAPI.length === 4, { m: r.motivo_fin, pausas: r.pausas, api: e.llamadasAPI.length });
}
// 4) Cancelar durante una pausa: termina de inmediato, sin error y con lo contado
{
  const codigos = cods(4); const e = entorno({ codigos, cola429: { [`L:${codigos[1]}`]: [1, 1, 1, 1] } }); const ctrl = new AbortController();
  const esperarCancelando = async (ms, signal) => { ctrl.abort(); return esperar(ms, signal); };
  const r = await sincronizarResultados("tk", { f: e.f, esperar: esperarCancelando, lim, ahora, signal: ctrl.signal });
  ok("C04_cancelar_en_pausa", r.motivo_fin === "cancelado" && !r.error && r.procesados >= 1 && e.res.size === r.procesados, { m: r.motivo_fin, p: r.procesados });
  // Reanudar: una nueva sincronización consulta SOLO lo que faltaba y completa
  const antes = e.llamadasMP.length; const yaHechos = new Set(e.res.keys());
  const r2 = await sincronizarResultados("tk", { f: e.f, esperar, lim, ahora });
  const consultadosDeNuevo = e.llamadasMP.slice(antes).filter((x) => x.url.includes("?id=")).map((x) => decodeURIComponent(x.url.split("?id=")[1])).filter((c) => yaHechos.has(c));
  ok("C04_reanudar_sin_repetir_ni_perder", r2.motivo_fin === "completo" && e.res.size === 4 && consultadosDeNuevo.length === 0, { m: r2.motivo_fin, n: e.res.size, rep: consultadosDeNuevo });
}
// 5) Cancelar antes de empezar
{
  const e = entorno({ codigos: cods(3) }); const ctrl = new AbortController(); ctrl.abort();
  const r = await sincronizarResultados("tk", { f: e.f, esperar, lim, ahora, signal: ctrl.signal });
  ok("C05_cancelado_antes_de_empezar", r.motivo_fin === "cancelado" && e.llamadasAPI.length === 0);
}
// 6) Límite propio de BFK (429 LIMITE_BFK) y otra sincronización en curso (409): espera y reintenta
{
  let n = 0; const e = entorno({ codigos: cods(3) });
  const f = async (u, o) => { n++; if (n === 1) return { ok: false, status: 429, json: async () => ({ ok: false, codigo: "LIMITE_BFK", reintentar_ms: 12_000 }) }; if (n === 2) return { ok: false, status: 409, json: async () => ({ ok: false, codigo: "EN_CURSO" }) }; return e.f(u, o); };
  esperas.length = 0; const r = await sincronizarResultados("tk", { f, esperar, lim, ahora });
  ok("C06_espera_limite_bfk_y_en_curso", r.motivo_fin === "completo" && esperas[0] === 12_000 && esperas[1] === SINC.esperaEnCursoMs && e.res.size === 3, { m: r.motivo_fin, esperas });
  let m = 0; const f2 = async () => { m++; return { ok: false, status: 409, json: async () => ({ ok: false, codigo: "EN_CURSO" }) }; };
  const r2 = await sincronizarResultados("tk", { f: f2, esperar, lim, ahora });
  ok("C06_en_curso_insistente_termina_con_aviso", r2.motivo_fin === "error" && r2.codigo === "EN_CURSO" && m === SINC.maxEnCurso + 1, { m: r2.motivo_fin, n: m });
}
// 7) Sin conexión: reintenta dos veces; si sigue, termina con aviso y conserva el avance
{
  const e = entorno({ codigos: cods(45) }); let n = 0;
  const f = async (u, o) => { n++; if (n >= 2) throw new TypeError("Failed to fetch"); return e.f(u, o); };
  const r = await sincronizarResultados("tk", { f, esperar, lim, ahora });
  ok("C07_sin_conexion_reintenta_y_conserva", r.motivo_fin === "error" && /reanudar/.test(r.error) && r.procesados > 0 && r.procesados === e.res.size && n === 1 + 1 + SINC.maxFallasRed, { m: r.motivo_fin, p: r.procesados, n });
}
// 8) Error del servidor (ticket rechazado) tras rondas buenas: devuelve el error SIN descartar lo hecho
{
  const e = entorno({ codigos: cods(45) }); let n = 0;
  const f = async (u, o) => { n++; if (n === 2) return { ok: false, status: 502, json: async () => ({ ok: false, codigo: "TICKET_INVALIDO", error: "ChileCompra rechazó el ticket configurado (HTTP 401/403)." }) }; return e.f(u, o); };
  const r = await sincronizarResultados("tk", { f, esperar, lim, ahora });
  ok("C08_error_conserva_totales", r.motivo_fin === "error" && r.codigo === "TICKET_INVALIDO" && r.procesados > 0 && r.rondas === 1, { m: r.motivo_fin, p: r.procesados });
}
// 9) Rondas sin avance (el servidor dice que hay más pero no procesa nada) → termina tras maxSinAvance
{
  let n = 0; const f = async () => { n++; return { ok: true, status: 200, json: async () => ({ ok: true, procesados: 0, hay_mas: true, conteo: {} }) }; };
  const r = await sincronizarResultados("tk", { f, esperar, lim, ahora });
  ok("C09_sin_avance_termina", r.motivo_fin === "sin_avance" && n === SINC.maxSinAvance, { m: r.motivo_fin, n });
}
// 10) Topes de rondas y de tiempo
{
  const f = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, procesados: 1, hay_mas: true, conteo: { pendiente: 1 } }) });
  const r = await sincronizarResultados("tk", { f, esperar, lim: { ...lim, maxRondas: 5 }, ahora });
  ok("C10_tope_de_rondas", r.motivo_fin === "tope_rondas" && r.rondas === 5);
  const f2 = async () => { reloj.t += 10 * 60_000; return { ok: true, status: 200, json: async () => ({ ok: true, procesados: 1, hay_mas: true, conteo: {} }) }; };
  const r2 = await sincronizarResultados("tk", { f: f2, esperar, lim: { ...lim, maxMinutos: 25 }, ahora });
  ok("C10_tope_de_tiempo", r2.motivo_fin === "tope_tiempo" && r2.rondas === 3, { m: r2.motivo_fin, r: r2.rondas });
}
// 11) Detalle «por verificar» con reintento próximo: espera ese momento y continúa hasta verificarlo
{
  const codigos = ["X0-1001-2-COT26"]; const e = entorno({ codigos, cola429: { [`D:${codigos[0]}`]: [1, 1, 1, 1] } }); esperas.length = 0;
  const r = await sincronizarResultados("tk", { f: e.f, esperar, lim, ahora });
  ok("C11_por_verificar_se_reintenta_en_la_misma_sesion", r.motivo_fin === "completo" && e.res.get(codigos[0]).resultado === "perdida" && r.conteo.por_verificar === 1 && r.conteo.perdida === 1, { m: r.motivo_fin, res: e.res.get(codigos[0]), c: r.conteo, esperas });
}
// 12) Control único por pestaña: una sola activa, suscripción con avance y cancelación
{
  const e = entorno({ codigos: cods(3) }); const ctl = crearControlSincronizacion((tk, o) => sincronizarResultados(tk, { ...o, f: e.f, esperar, lim, ahora }));
  const vistos = []; const quitar = ctl.suscribir((s) => vistos.push(s));
  const p1 = ctl.iniciar("tk", { origen: "manual" }); const p2 = ctl.iniciar("tk", { origen: "manual" });
  const r = await p1;
  ok("C12_una_sola_a_la_vez", p1 === p2 && e.llamadasAPI.length >= 1 && r.motivo_fin === "completo");
  ok("C12_suscripcion_con_avance_y_fin", vistos.some((s) => s.activa && s.progreso?.fase === "consultando") && vistos.at(-1).activa === false && vistos.at(-1).resultado === r);
  quitar();
  const e2 = entorno({ codigos: cods(3), cola429: { "L:X0-1001-3-COT26": Array(50).fill(1) } });
  const ctl2 = crearControlSincronizacion((tk, o) => sincronizarResultados(tk, { ...o, f: e2.f, esperar: (ms, s) => { ctl2.cancelar(); return esperar(ms, s); }, lim, ahora }));
  const r2 = await ctl2.iniciar("tk", {});
  ok("C12_cancelar_desde_el_control", r2.motivo_fin === "cancelado" && ctl2.estado.activa === false);
}
// 13) esperaCancelable real (sin reloj simulado)
{
  globalThis.setTimeout = realST; globalThis.clearTimeout = realCT;
  const t0 = Date.now(); const a = await esperaCancelable(30); const c = new AbortController(); setTimeout(() => c.abort(), 10); const b = await esperaCancelable(5_000, c.signal);
  ok("C13_espera_cancelable", a === true && b === false && Date.now() - t0 < 1_000);
}
console.log(`sincronizacion: ${N - F}/${N} correctas`);
process.exit(F ? 1 : 0);
