// Arnés de las pruebas de interfaz de Ventas privadas (SOLO base desechable local; nada sale a la red).
//   · Objetos vp_*, pi_clientes, productos_catalogo, perfiles y la búsqueda de gastos para vincular → PostgREST REAL sobre la base
//     desechable con la migración instalada, con un JWT firmado por usuario (RLS, disparadores y funciones se aplican de verdad).
//   · Depósito «vp-documentos» → se registra en storage.objects de la misma base con la sesión del usuario (deciden las políticas
//     vp_storage_*); el contenido del archivo queda en memoria.
//   · Mercado Público y el resto de Supabase → el simulador de siempre (docs/pruebas-oc/mock_estado.mjs), para comprobar que el
//     módulo no lo altera y que MP sigue funcionando.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { crearBase, chromium } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
export { chromium };
export const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
export const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333" };
const { PGRST_URL, JWT_SECRET, VP_DB_URL } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const jwt = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 7200 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
export const psql = (sql, db = VP_DB_URL) => execFileSync("psql", [db, "-X", "-At", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const lit = (s) => { const tag = "q" + Math.random().toString(36).slice(2, 8); return `$${tag}$${s}$${tag}$`; };
export const comoUsuario = (sub) => `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub, role: "authenticated" }))}, false) \\gset _\n`;
export const archivos = new Map();
export const registro = [];
// rpc/cz_guardar_producto: la biblioteca compartida de fichas (misma que usa Mercado Público) se guarda en la base desechable.
const esVP = (obj, search) => obj.startsWith("vp_") || obj.startsWith("rpc/vp_") || ["perfiles", "pi_clientes", "productos_catalogo", "rpc/cz_guardar_producto"].includes(obj)
  || (obj === "gastos_indirectos" && /select=id%2Cfecha%2Cmonto%2Cdescripcion|select=id,fecha,monto,descripcion/.test(search))
  // Catálogos que Ventas privadas lee para vendedor y financiamiento (11/11/2026); Mercado Público los lee con otra consulta.
  || (["vendedores", "financiadores"].includes(obj) && /order=nombre\.asc/.test(search));

// ── Servicio de sesión simulado (10/11/2026), con las reglas de Supabase Auth: tokens de acceso JWT reales con vencimiento, refresh
// token de UN solo uso (rotación: uno ya usado se rechaza), ingreso con contraseña y fallas provocadas (rechazo, sin conexión, 5xx).
//   A.sesion(usuario, { ttl, hace })  → sesión nueva (hace: segundos que lleva emitida; ttl: duración del token de acceso).
//   A.fallar = "rechazo" | "red" | "500" | null     A.cortes.push({ patron, modo: "antes" | "despues", veces })
//   «despues»: el servidor SÍ ejecuta la solicitud, pero la respuesta no llega al navegador (respuesta incierta).
export function crearAuth({ ttl = 3600, clave = "clave-correcta", usuarios = Object.values(U), secreto = JWT_SECRET } = {}) {
  const A = { ttl, clave, fallar: null, llamadas: [], vivos: new Map(), cortes: [], pedidos: [], n: 0 };
  const firma = (c) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64(c); return `${h}.${p}.${createHmac("sha256", secreto).update(`${h}.${p}`).digest("base64url")}`; };
  A.usuario = (sub) => ({ id: sub, email: sub.slice(0, 4) + "@prueba.cl", app_metadata: { provider: "email" }, user_metadata: {} });
  A.token = (sub, { ttl: t = A.ttl, hace = 0 } = {}) => { const iat = Math.floor(Date.now() / 1000) - hace; return firma({ sub, role: "authenticated", aud: "authenticated", iat, exp: iat + t, jti: `t${++A.n}` }); };
  A.sesion = (sub, opt) => { const rt = `rt-${++A.n}-${Math.random().toString(36).slice(2, 8)}`; A.vivos.set(rt, sub); return { access_token: A.token(sub, opt), refresh_token: rt, token_type: "bearer", expires_in: opt?.ttl ?? A.ttl, user: A.usuario(sub) }; };
  A.datos = (cab) => { try { return JSON.parse(Buffer.from(String(cab || "").replace(/^Bearer\s+/i, "").split(".")[1], "base64url").toString()); } catch { return null; } };
  // A.vencerAhora(): el servidor da por vencidos todos los tokens emitidos hasta ahora (el navegador no lo sabe: los cree vigentes).
  A.limite = 0; A.vencerAhora = () => { A.limite = A.n; };
  A.caducado = (cab) => { const d = A.datos(cab); return !!d?.jti && Number(String(d.jti).slice(1)) <= A.limite; };
  A.vencido = (cab) => { const d = A.datos(cab); return !d?.exp || d.exp * 1000 <= Date.now() || A.caducado(cab); };
  A.responder = (u, cuerpo) => {
    const g = u.searchParams.get("grant_type");
    if (g === "refresh_token") {
      const reg = { tipo: "renovar", t: Date.now(), rt: cuerpo?.refresh_token, resultado: "" }; A.llamadas.push(reg);
      if (A.fallar === "red") { reg.resultado = "red"; return "red"; }
      if (A.fallar === "500") { reg.resultado = "500"; return { status: 503, json: { msg: "servicio no disponible" } }; }
      const sub = A.vivos.get(cuerpo?.refresh_token);
      if (A.fallar === "rechazo" || !sub) { reg.resultado = sub ? "rechazo" : "reuso"; return { status: 400, json: { error: "invalid_grant", error_description: sub ? "Invalid Refresh Token: Refresh Token Not Found" : "Invalid Refresh Token: Already Used" } }; }
      A.vivos.delete(cuerpo.refresh_token); reg.resultado = "ok"; return { status: 200, json: A.sesion(sub) };
    }
    if (g === "password") {
      const sub = usuarios.find((id) => A.usuario(id).email === cuerpo?.email); A.llamadas.push({ tipo: "ingresar", t: Date.now(), email: cuerpo?.email, resultado: sub && cuerpo?.password === A.clave ? "ok" : "rechazo" });
      if (!sub || cuerpo?.password !== A.clave) return { status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } };
      return { status: 200, json: A.sesion(sub) };
    }
    return { status: 400, json: { error: "unsupported_grant_type" } };
  };
  A.renovaciones = (r = "ok") => A.llamadas.filter((x) => x.tipo === "renovar" && x.resultado === r).length;
  // ¿Corresponde cortar esta solicitud? (consume una vez)
  A.corte = (m, ruta) => { const c = A.cortes.find((x) => x.veces > 0 && x.patron.test(`${m} ${ruta}`)); if (c) c.veces--; return c?.modo || null; };
  return A;
}

export function crearMP() { return crearBase(crearDatos(), { mp: RESPUESTAS_MP }); }

// auth (opcional): servicio de sesión simulado (crearAuth). Con él, el token que envía la app llega TAL CUAL a PostgREST (que
// rechaza de verdad un token vencido) y el simulador de Mercado Público y el depósito también lo exigen vigente.
// ctx (opcional): abre otra pestaña en el MISMO navegador (misma sesión guardada y mismas copias locales). sesion: la sesión
// guardada al abrir (por defecto una nueva; false = sin sesión).
export async function abrir(browser, { usuario, url, hash = "", ancho = 1440, alto = 900, movil = false, espera = 3500, mp = crearMP(), dialogos = "aceptar", auth = null, ctx: ctxDado = null, sesion }) {
  const ctx = ctxDado || await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago", acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(9000);
  const errs = []; const dlg = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => { dlg.push(d.message().slice(0, 160)); dialogos === "aceptar" ? d.accept() : d.dismiss(); });
  const user = { id: usuario, email: usuario.slice(0, 4) + "@prueba.cl", app_metadata: { provider: "email" }, user_metadata: {} };
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    // Corte de conexión provocado: «antes» (la solicitud no sale) o «despues» (el servidor la ejecuta y la respuesta se pierde).
    const modoCorte = auth && (u.hostname.endsWith("supabase.co") || u.pathname.startsWith("/api/")) ? auth.corte(m, u.pathname) : null;
    if (modoCorte === "antes" || (auth?.sinConexion && (u.hostname.endsWith("supabase.co") || u.pathname.startsWith("/api/")))) return route.abort("internetdisconnected");
    const fin = (r) => (modoCorte === "despues" ? route.abort("connectionfailed") : route.fulfill(r));
    const cab = req.headers().authorization;
    const anota = (obj, status) => { if (auth) auth.pedidos.push({ t: Date.now(), yo: usuario, m, obj, status, jti: auth.datos(cab)?.jti ?? null }); };
    if (auth && u.hostname.endsWith("supabase.co") && u.pathname.startsWith("/auth/v1/token")) {
      let c = null; try { c = JSON.parse(req.postData() || "null"); } catch {}
      const r = auth.responder(u, c); return r === "red" ? route.abort("connectionfailed") : fin(r);
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      if (auth && u.pathname.startsWith("/api/oc") && auth.vencido(cab)) { anota("api/oc", 401); return fin({ status: 401, json: { ok: false, error: "Sesión vencida" } }); }
      if (u.pathname.startsWith("/api/oc")) { registro.push({ t: Date.now(), yo: usuario, destino: "mp", m, obj: "api/oc" }); const r = mp.respuestaMP(u); return fin({ status: r.status, json: r.body }); }
      if (u.pathname.startsWith("/api/")) return fin({ status: 503, json: { ok: false } });
      return route.continue();
    }
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.startsWith("/auth/v1/")) {
      if (u.pathname.includes("/logout")) return fin({ status: 204, body: "" });
      if (u.pathname.includes("/user")) return fin({ json: user });
      return fin({ json: { access_token: "x", refresh_token: "r", expires_in: 3600, user } });
    }
    const sto = /^\/storage\/v1\/object\/(authenticated\/)?(vp-documentos|cz-productos)\/(.+)$/.exec(u.pathname);
    if (sto && auth && auth.vencido(cab)) { anota("storage", 400); return fin({ status: 400, json: { statusCode: "403", error: "Unauthorized", message: '"exp" claim timestamp check failed' } }); }
    if (sto) {
      const bucket = sto[2]; const ruta = sto[3].split("/").map(decodeURIComponent).join("/");
      registro.push({ t: Date.now(), yo: usuario, destino: "storage", m, obj: bucket });
      if (m === "POST" && !sto[1]) {
        if (archivos.has(bucket + "/" + ruta)) return fin({ status: 400, json: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } });
        try { psql(`${comoUsuario(usuario)}insert into storage.objects (bucket_id, name, owner, metadata) values (${lit(bucket)}, ${lit(ruta)}, ${lit(usuario)}::uuid, jsonb_build_object('size', ${Number(req.postDataBuffer()?.length || 0)}));`); }
        catch { return fin({ status: 400, json: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } }); }
        archivos.set(bucket + "/" + ruta, Buffer.from(req.postDataBuffer() || []));
        return fin({ json: { Key: `${bucket}/${ruta}` } });
      }
      if (m === "GET" && sto[1]) {
        const visto = psql(`${comoUsuario(usuario)}select count(*) from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(ruta)};`).split("\n").pop();
        if (visto !== "1" || !archivos.has(bucket + "/" + ruta)) return fin({ status: 400, json: { statusCode: "404", error: "not_found", message: "Object not found" } });
        // Como Supabase Storage: las imágenes se sirven con su tipo (lo exige el PDF para incluir fotos).
        const tipo = /\.jpe?g$/i.test(ruta) ? "image/jpeg" : /\.png$/i.test(ruta) ? "image/png" : "application/octet-stream";
        return fin({ status: 200, headers: { "content-type": tipo }, body: archivos.get(bucket + "/" + ruta) });
      }
      return fin({ status: 400, json: { message: "operación no permitida en el depósito" } });
    }
    if (!u.pathname.startsWith("/rest/v1/")) return route.abort();
    const obj = u.pathname.replace(/^\/rest\/v1\//, "");
    let cuerpo = null; try { cuerpo = JSON.parse(req.postData() || "null"); } catch {}
    if (esVP(obj, u.search)) {
      registro.push({ t: Date.now(), yo: usuario, destino: "vp", m, obj });
      // Vencido por decisión del servidor de prueba: misma respuesta que PostgREST. (Vencido por fecha: lo rechaza PostgREST de verdad.)
      if (auth?.caducado(cab)) { anota(obj, 401); return fin({ status: 401, json: { code: "PGRST301", details: null, hint: null, message: "JWT expired" } }); }
      const h = { ...req.headers(), authorization: auth ? cab : `Bearer ${jwt(usuario)}` };
      for (const k of ["apikey", "host", "connection", "content-length", "origin", "referer"]) delete h[k];
      let r; try { r = await fetch(PGRST_URL + "/" + obj + u.search, { method: m, headers: h, body: ["GET", "HEAD"].includes(m) ? undefined : req.postData() }); }
      catch (e) { return fin({ status: 502, json: { message: "PostgREST de prueba no disponible: " + e.message } }); }
      anota(obj, r.status);
      return fin({ status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json" }, body: Buffer.from(await r.arrayBuffer()) });
    }
    if (auth && auth.vencido(cab)) { anota(obj, 401); return fin({ status: 401, json: { code: "PGRST301", details: null, hint: null, message: "JWT expired" } }); }
    anota(obj, 200);
    registro.push({ t: Date.now(), yo: usuario, destino: "mp", m, obj });
    if (obj.startsWith("rpc/")) { const r = mp.rpc(obj.slice(4), cuerpo || {}, usuario); return fin({ status: r.status, json: r.json }); }
    if (m === "GET") return fin({ json: mp.leer(obj, u.searchParams) });
    const r = mp.escribir(m, obj, u.searchParams, cuerpo, usuario); return fin({ status: r.status, json: r.json });
  });
  if (auth) { const s0 = sesion === undefined ? auth.sesion(usuario) : sesion;   // solo si el navegador aún no tiene sesión guardada
    if (s0) await page.addInitScript((s) => { try { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); if (!localStorage.getItem("bfk_supabase_session_v2")) localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); } } catch {} }, s0);
  } else await page.addInitScript((s) => { try { if (!sessionStorage.getItem("__i")) { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); sessionStorage.setItem("__i", "1"); } } catch {} },
    { access_token: "x", refresh_token: "r", user });
  await page.goto(url + hash, { waitUntil: "load" }); await page.waitForTimeout(espera);
  return { page, ctx, errs, dlg, mp };
}
export const sinDesborde = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
export const desde = (i, f = () => true) => registro.slice(i).filter(f);
// Espera a que la app termine su carga y sincronización inicial con Mercado Público (sin solicitudes «mp» durante «quieto» ms).
// Desde ahí, lo que se registre lo causa el trabajo en el módulo.
export async function calma(quieto = 2500, maximo = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maximo) {
    const ult = [...registro].reverse().find((x) => x.destino === "mp");
    if (!ult || Date.now() - ult.t >= quieto) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
export const marca = () => registro.length;
// Escrituras de negocio en Mercado Público (simulador) desde una marca: OCs, eventos, productos, gastos, pagos, entidades.
export const escriturasMP = (i) => desde(i, (x) => x.destino === "mp" && x.m !== "GET" && /^(ordenes_compra_v2|eventos_|oc_|gastos_indirectos|pagos_|rpc\/(registrar_|conciliar_|importar_|asignar_))/.test(x.obj));
