// Sesión de BFK (Supabase Auth) — renovación, sincronización entre pestañas y sesiones vencidas (09/11/2026).
// Alcance: SOLO autenticación. No cambia formularios, cálculos, flujos comerciales ni PDF.
//
// · Renueva antes del vencimiento (faltando menos de 5 minutos) y al volver a una pestaña que estuvo inactiva, al recuperar la
//   conexión o al despertar el equipo (el vencimiento se calcula con la hora del servidor, corrigiendo el desfase del reloj).
// · Una sola renovación a la vez en TODO el navegador (Web Locks; respaldo con arriendo en localStorage). Dentro del bloqueo se
//   relee la sesión guardada: si otra pestaña ya la renovó, se adopta sin volver a renovar (Supabase rota el refresh token y
//   un token ya usado se rechaza). Cada pestaña adopta la sesión vigente que guarda otra (evento «storage»).
// · Toda solicitud a la base (REST), al depósito (Storage) y a /api con el token de la cuenta de la sesión:
//     – antes de enviarla, si el token está por vencer o vencido, se renueva y se envía con el vigente;
//     – si la respuesta es un rechazo CONFIRMADO por token vencido («JWT expired»: el servidor no ejecutó nada), se renueva y se
//       reintenta UNA sola vez;
//     – una falla de conexión (respuesta incierta) NUNCA se repite aquí: quien guarda, emite o crea comprueba el resultado.
// · Si la renovación es rechazada (no por falta de conexión), queda «vencida»: la app pide volver a ingresar con la MISMA cuenta
//   sin cerrar la pantalla, así nada de lo escrito se pierde (y la copia de recuperación local se conserva).
import { SUPABASE_URL, SUPABASE_ANON_KEY, SESSION_KEY, supaSignIn } from "./supabase";

const MARGEN_RENOVAR = 5 * 60 * 1000;   // renovar cuando falte menos que esto
const MARGEN_ENVIO = 30 * 1000;         // antes de enviar: si falta menos que esto, renovar primero
const MARGEN_ADOPTAR = 30 * 1000;       // adoptar la sesión de otra pestaña si le queda al menos esto
const REVISION_MS = 20 * 1000;          // revisión periódica (los navegadores la frenan en segundo plano: también hay eventos)
const NOMBRE_BLOQUEO = "bfk-sesion-renovar";
const LLAVE_ARRIENDO = "bfk_sesion_renovando";

let actual = null;          // sesión vigente en esta pestaña
let estado = "sin_sesion";  // sin_sesion | vigente | vencida | cerrada
let motivo = "";
let enCurso = null;         // renovación en curso en esta pestaña
let fetchOriginal = null;
const oyentes = new Set();
const pestana = Math.random().toString(36).slice(2, 10);
const diag = { renovaciones: 0, adopciones: 0, reintentos: 0, fallas: 0, ultima: null };

// ── Utilidades ──────────────────────────────────────────────────────────────────────────────────────────────
export function datosToken(t) {
  try { const p = String(t || "").split(".")[1]; if (!p) return null; return JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); } catch { return null; }
}
const ahora = () => Date.now();
// Vencimiento en la hora LOCAL: exp del token corregido por el desfase medido al recibirlo (iat del servidor vs reloj local).
export function venceEnMs(s) {
  const d = datosToken(s?.access_token); if (!d?.exp) return Infinity;   // sin fecha legible: decide el servidor (rechazo → renovar)
  const desfase = Number.isFinite(s?.bfk_desfase) ? s.bfk_desfase : 0;
  return d.exp * 1000 - desfase;
}
export const restanteMs = (s) => venceEnMs(s) - ahora();
const sello = (s) => { const d = datosToken(s?.access_token); return { ...s, bfk_recibido: ahora(), bfk_desfase: d?.iat ? d.iat * 1000 - ahora() : 0 }; };
function leerGuardada() { try { const raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function guardar(s) { try { localStorage.setItem(SESSION_KEY, s ? JSON.stringify(s) : ""); } catch { /* almacenamiento no disponible */ } }
const usuarioDe = (s) => s?.user?.id || datosToken(s?.access_token)?.sub || null;
function notificar() { const info = { sesion: actual, estado, motivo }; oyentes.forEach((f) => { try { f(info); } catch { /* oyente */ } }); }
function adoptar(s, origen) {
  actual = s; estado = "vigente"; motivo = "";
  if (origen === "otra_pestana") diag.adopciones++; else if (origen === "renovada") diag.renovaciones++;
  diag.ultima = { origen, en: new Date().toISOString() };
  notificar();
}

// ── Bloqueo entre pestañas ──────────────────────────────────────────────────────────────────────────────────
async function conBloqueo(fn) {
  if (typeof navigator !== "undefined" && navigator.locks?.request) return navigator.locks.request(NOMBRE_BLOQUEO, { mode: "exclusive" }, fn);
  // Respaldo (navegadores sin Web Locks): arriendo breve en localStorage; quien llega después espera y luego relee.
  const limite = ahora() + 10_000;
  for (;;) {
    let a = null; try { a = JSON.parse(localStorage.getItem(LLAVE_ARRIENDO) || "null"); } catch { a = null; }
    if (!a || a.hasta < ahora() || a.pestana === pestana || ahora() > limite) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  try { localStorage.setItem(LLAVE_ARRIENDO, JSON.stringify({ pestana, hasta: ahora() + 8_000 })); } catch { /* sin almacenamiento */ }
  try { return await fn(); } finally { try { const a = JSON.parse(localStorage.getItem(LLAVE_ARRIENDO) || "null"); if (a?.pestana === pestana) localStorage.removeItem(LLAVE_ARRIENDO); } catch { /* nada */ } }
}

// Renovación con el refresh token. Falla de conexión → { red: true } (se reintentará); rechazo del servidor → { red: false }.
async function pedirRenovacion(rt) {
  const f = fetchOriginal || fetch;
  let r;
  try { r = await f(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY }, body: JSON.stringify({ refresh_token: rt }) }); }
  catch { throw Object.assign(new Error("Sin conexión para renovar la sesión"), { red: true }); }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d?.access_token) {
    if (r.status >= 500 || r.status === 429) throw Object.assign(new Error("El servicio de sesión no respondió"), { red: true });
    throw Object.assign(new Error(d?.error_description || d?.msg || "La sesión no se pudo renovar"), { red: false, status: r.status });
  }
  return d;
}

// ── API ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const sesionActual = () => actual;
export const estadoSesion = () => ({ estado, motivo, sesion: actual });
export function suscribirSesion(f) { oyentes.add(f); return () => oyentes.delete(f); }

// Al iniciar sesión (pantalla de ingreso) o al reingresar.
export function fijarSesion(s) { const x = sello(s); guardar(x); adoptar(x, "ingreso"); return x; }
// Al cerrar sesión en esta pestaña (las demás lo ven por el evento «storage»).
export function cerrarSesionLocal() { actual = null; estado = "sin_sesion"; motivo = ""; guardar(null); notificar(); }

// Renueva (o adopta la que dejó otra pestaña). forzar: el servidor dijo «vencido» aunque localmente no lo pareciera.
export function renovarSesion({ forzar = false } = {}) {
  if (!actual) return Promise.reject(new Error("Sin sesión"));
  if (enCurso) return enCurso;
  // Ya rechazada: no se insiste contra el servidor (se sale de «vencida» al reingresar, aquí o en otra pestaña).
  if (estado === "vencida") return Promise.reject(Object.assign(new Error(motivo || "Sesión vencida"), { red: false }));
  const yo = usuarioDe(actual); const tokenAntes = actual.access_token;
  enCurso = (async () => {
    try {
      return await conBloqueo(async () => {
        // Lo que guardó otra pestaña puede tardar un instante en verse desde esta: se espera antes de leer, para no renovar con
        // un refresh token que la otra ya usó.
        await new Promise((r) => setTimeout(r, 80));
        const g = leerGuardada();
        if (g && usuarioDe(g) && usuarioDe(g) !== yo) { estado = "cerrada"; motivo = "otra_cuenta"; notificar(); throw Object.assign(new Error("Se ingresó con otra cuenta en otra pestaña"), { red: false }); }
        // Otra pestaña ya renovó: se adopta sin volver a renovar.
        if (g?.access_token && g.access_token !== tokenAntes && restanteMs(g) > MARGEN_ADOPTAR) { adoptar(g, "otra_pestana"); return actual; }
        if (!forzar && actual.access_token !== tokenAntes && restanteMs(actual) > MARGEN_ADOPTAR) return actual;
        const rt = g?.refresh_token && usuarioDe(g) === yo ? g.refresh_token : actual.refresh_token;
        let nueva;
        try { nueva = await pedirRenovacion(rt); }
        catch (e) {
          if (e.red) throw e;
          // ¿La renovó otra pestaña entre medio (sin Web Locks)? Entonces vale la suya.
          const otra = leerGuardada();
          if (otra && usuarioDe(otra) === yo && otra.refresh_token !== rt && restanteMs(otra) > 0) { adoptar(otra, "otra_pestana"); return actual; }
          diag.fallas++; estado = "vencida"; motivo = e.message || "rechazada"; notificar(); throw e;
        }
        const x = sello(nueva); guardar(x); adoptar(x, "renovada"); return actual;
      });
    } finally { enCurso = null; }
  })();
  return enCurso;
}
// Renueva solo si hace falta (sin errores hacia afuera).
export function revisarSesion(margen = MARGEN_RENOVAR) {
  if (!actual || estado === "vencida" || estado === "cerrada") return Promise.resolve(actual);
  if (restanteMs(actual) > margen) return Promise.resolve(actual);
  return renovarSesion().catch(() => actual);
}

// Reingreso con la MISMA cuenta (la pantalla no se cierra: lo escrito sigue ahí para guardarlo).
export async function reingresar(email, password) {
  const yo = usuarioDe(actual);
  const s = await supaSignIn(email, password);
  if (yo && usuarioDe(s) !== yo) throw new Error("Para conservar los cambios, ingresa con la misma cuenta. Para usar otra cuenta, cierra sesión.");
  return fijarSesion(s);
}

// Inicio: sesión guardada (renovada si está por vencer). Nunca la descarta por una falla de conexión.
export async function iniciarSesion() {
  instalar();
  const g = leerGuardada(); if (!g?.access_token) return null;
  // Una sesión guardada por la versión anterior no trae el desfase del reloj: se usa el reloj local tal cual.
  actual = Number.isFinite(g.bfk_desfase) ? g : { ...g, bfk_desfase: 0 };
  estado = "vigente";
  if (restanteMs(actual) < MARGEN_RENOVAR) { try { await renovarSesion(); } catch { /* vencida o sin conexión: se informa por el estado */ } }
  return actual;
}

// ── Interceptor de solicitudes ──────────────────────────────────────────────────────────────────────────────
const esProtegida = (url) => {
  const u = String(url || "");
  if (u.startsWith(`${SUPABASE_URL}/rest/v1/`) || u.startsWith(`${SUPABASE_URL}/storage/v1/`) || u.startsWith(`${SUPABASE_URL}/functions/v1/`)) return true;
  const origen = typeof location !== "undefined" ? location.origin : "";
  return u.startsWith("/api/") || (!!origen && u.startsWith(`${origen}/api/`));
};
function tokenEn(headers) {
  if (!headers) return null;
  const v = headers instanceof Headers ? headers.get("Authorization") : headers.Authorization || headers.authorization;
  const m = /^Bearer\s+(.+)$/.exec(String(v || "")); return m ? m[1] : null;
}
function conToken(headers, token) {
  if (headers instanceof Headers) { const h = new Headers(headers); h.set("Authorization", `Bearer ${token}`); return h; }
  const h = { ...(headers || {}) }; delete h.authorization; h.Authorization = `Bearer ${token}`; return h;
}
// ¿Rechazo confirmado por token vencido? (PostgREST: 401 «JWT expired»; Storage: «exp» claim; /api: 401 con token vencido).
async function rechazoPorVencimiento(r, token, url) {
  if (![400, 401, 403].includes(r.status)) return false;
  let txt = ""; try { txt = await r.clone().text(); } catch { txt = ""; }
  if (/jwt expired|token is expired|"exp" claim|exp claim timestamp|token has expired/i.test(txt)) return true;
  return r.status === 401 && /\/api\//.test(String(url)) && restanteMs({ access_token: token, bfk_desfase: actual?.bfk_desfase || 0 }) <= 0;
}

function instalarInterceptor() {
  if (fetchOriginal || typeof window === "undefined") return;
  fetchOriginal = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input?.url || "";
    if (!esProtegida(url) || input instanceof Request) return fetchOriginal(input, init);
    const opciones = { ...(init || {}) };
    const tok = tokenEn(opciones.headers);
    const mio = !!(tok && actual && datosToken(tok)?.sub && datosToken(tok).sub === usuarioDe(actual));
    if (mio) {
      if (restanteMs(actual) < MARGEN_ENVIO) { try { await renovarSesion(); } catch { /* se envía igual: el servidor decide */ } }
      if (actual?.access_token && actual.access_token !== tok) opciones.headers = conToken(opciones.headers, actual.access_token);
    }
    const r = await fetchOriginal(input, opciones);   // una falla de conexión se propaga: NUNCA se repite aquí
    if (!mio || !(await rechazoPorVencimiento(r, tokenEn(opciones.headers), url))) return r;
    // Rechazo confirmado: el servidor no ejecutó la operación. Se renueva y se reintenta UNA sola vez.
    // Si mientras tanto la sesión ya cambió (la renovó esta u otra pestaña), no se renueva de nuevo: se reintenta con la vigente.
    const usado = tokenEn(opciones.headers);
    if (!(actual?.access_token && actual.access_token !== usado && estado === "vigente")) { try { await renovarSesion({ forzar: true }); } catch { return r; } }
    if (!actual?.access_token || actual.access_token === usado) return r;
    diag.reintentos++;
    return fetchOriginal(input, { ...opciones, headers: conToken(opciones.headers, actual.access_token) });
  };
}

function instalar() {
  if (typeof window === "undefined" || window.__bfkSesionInstalada) return;
  window.__bfkSesionInstalada = true;
  instalarInterceptor();
  // Otra pestaña guardó una sesión: se adopta (misma cuenta) o se informa (cierre u otra cuenta).
  window.addEventListener("storage", (e) => {
    if (e.key !== SESSION_KEY || !actual) return;
    const g = leerGuardada();
    if (!g?.access_token) { actual = null; estado = "cerrada"; motivo = "otra_pestana"; notificar(); return; }
    if (usuarioDe(g) !== usuarioDe(actual)) { estado = "cerrada"; motivo = "otra_cuenta"; notificar(); return; }
    if (g.access_token !== actual.access_token && restanteMs(g) > 0) adoptar(g, "otra_pestana");
  });
  const alVolver = () => { if (document.visibilityState === "visible") revisarSesion(); };
  document.addEventListener("visibilitychange", alVolver);
  window.addEventListener("focus", () => revisarSesion());
  window.addEventListener("online", () => revisarSesion());
  window.addEventListener("pageshow", () => revisarSesion());
  setInterval(() => revisarSesion(), REVISION_MS);
  // Diagnóstico (sin tokens): estado de la renovación para verificar en producción.
  window.__bfkSesion = {
    estado: () => ({ estado, motivo, usuario: (usuarioDe(actual) || "").slice(0, 8), vence_en_s: actual ? Math.round(restanteMs(actual) / 1000) : null,
      desfase_s: actual ? Math.round((actual.bfk_desfase || 0) / 1000) : null, web_locks: !!navigator.locks?.request, ...diag }),
    renovarAhora: () => renovarSesion({ forzar: true }).then(() => window.__bfkSesion.estado()),
  };
}
