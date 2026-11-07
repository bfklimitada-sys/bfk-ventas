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
const esVP = (obj, search) => obj.startsWith("vp_") || obj.startsWith("rpc/vp_") || ["perfiles", "pi_clientes", "productos_catalogo"].includes(obj)
  || (obj === "gastos_indirectos" && /select=id%2Cfecha%2Cmonto%2Cdescripcion|select=id,fecha,monto,descripcion/.test(search));

export function crearMP() { return crearBase(crearDatos(), { mp: RESPUESTAS_MP }); }

export async function abrir(browser, { usuario, url, hash = "", ancho = 1440, alto = 900, movil = false, espera = 3500, mp = crearMP(), dialogos = "aceptar" }) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago", acceptDownloads: true });
  const page = await ctx.newPage(); page.setDefaultTimeout(9000);
  const errs = []; const dlg = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => { dlg.push(d.message().slice(0, 160)); dialogos === "aceptar" ? d.accept() : d.dismiss(); });
  const user = { id: usuario, email: usuario.slice(0, 4) + "@prueba.cl", app_metadata: { provider: "email" }, user_metadata: {} };
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      if (u.pathname.startsWith("/api/oc")) { registro.push({ t: Date.now(), yo: usuario, destino: "mp", m, obj: "api/oc" }); const r = mp.respuestaMP(u); return route.fulfill({ status: r.status, json: r.body }); }
      if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { ok: false } });
      return route.continue();
    }
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.startsWith("/auth/v1/")) {
      if (u.pathname.includes("/logout")) return route.fulfill({ status: 204, body: "" });
      if (u.pathname.includes("/user")) return route.fulfill({ json: user });
      return route.fulfill({ json: { access_token: "x", refresh_token: "r", expires_in: 3600, user } });
    }
    const sto = /^\/storage\/v1\/object\/(authenticated\/)?(vp-documentos|cz-productos)\/(.+)$/.exec(u.pathname);
    if (sto) {
      const bucket = sto[2]; const ruta = sto[3].split("/").map(decodeURIComponent).join("/");
      registro.push({ t: Date.now(), yo: usuario, destino: "storage", m, obj: bucket });
      if (m === "POST" && !sto[1]) {
        if (archivos.has(bucket + "/" + ruta)) return route.fulfill({ status: 400, json: { statusCode: "409", error: "Duplicate", message: "The resource already exists" } });
        try { psql(`${comoUsuario(usuario)}insert into storage.objects (bucket_id, name, owner, metadata) values (${lit(bucket)}, ${lit(ruta)}, ${lit(usuario)}::uuid, jsonb_build_object('size', ${Number(req.postDataBuffer()?.length || 0)}));`); }
        catch { return route.fulfill({ status: 400, json: { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" } }); }
        archivos.set(bucket + "/" + ruta, Buffer.from(req.postDataBuffer() || []));
        return route.fulfill({ json: { Key: `${bucket}/${ruta}` } });
      }
      if (m === "GET" && sto[1]) {
        const visto = psql(`${comoUsuario(usuario)}select count(*) from storage.objects where bucket_id = ${lit(bucket)} and name = ${lit(ruta)};`).split("\n").pop();
        if (visto !== "1" || !archivos.has(bucket + "/" + ruta)) return route.fulfill({ status: 400, json: { statusCode: "404", error: "not_found", message: "Object not found" } });
        return route.fulfill({ status: 200, headers: { "content-type": "application/octet-stream" }, body: archivos.get(bucket + "/" + ruta) });
      }
      return route.fulfill({ status: 400, json: { message: "operación no permitida en el depósito" } });
    }
    if (!u.pathname.startsWith("/rest/v1/")) return route.abort();
    const obj = u.pathname.replace(/^\/rest\/v1\//, "");
    let cuerpo = null; try { cuerpo = JSON.parse(req.postData() || "null"); } catch {}
    if (esVP(obj, u.search)) {
      registro.push({ t: Date.now(), yo: usuario, destino: "vp", m, obj });
      const h = { ...req.headers(), authorization: `Bearer ${jwt(usuario)}` };
      for (const k of ["apikey", "host", "connection", "content-length", "origin", "referer"]) delete h[k];
      let r; try { r = await fetch(PGRST_URL + "/" + obj + u.search, { method: m, headers: h, body: ["GET", "HEAD"].includes(m) ? undefined : req.postData() }); }
      catch (e) { return route.fulfill({ status: 502, json: { message: "PostgREST de prueba no disponible: " + e.message } }); }
      return route.fulfill({ status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json" }, body: Buffer.from(await r.arrayBuffer()) });
    }
    registro.push({ t: Date.now(), yo: usuario, destino: "mp", m, obj });
    if (obj.startsWith("rpc/")) { const r = mp.rpc(obj.slice(4), cuerpo || {}, usuario); return route.fulfill({ status: r.status, json: r.json }); }
    if (m === "GET") return route.fulfill({ json: mp.leer(obj, u.searchParams) });
    const r = mp.escribir(m, obj, u.searchParams, cuerpo, usuario); return route.fulfill({ status: r.status, json: r.json });
  });
  await page.addInitScript((s) => { try { if (!sessionStorage.getItem("__i")) { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); sessionStorage.setItem("__i", "1"); } } catch {} },
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
