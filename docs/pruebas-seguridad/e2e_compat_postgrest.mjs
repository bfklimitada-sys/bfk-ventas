// Compatibilidad REAL interfaz ↔ migración: la interfaz reconstruida contra PostgREST sobre una COPIA RESTAURADA con
// BORRADOR-2026-10-23-seguridad-perfil-bfk.sql instalada. Nunca contra producción. Solo se simula la autenticación
// (Supabase Auth): cada solicitud de datos va a la API REST real con un JWT de la cuenta indicada.
// Variables: URL_APP, PGRST_URL, JWT_SECRET, ADM, USR, NUEVA (sin perfil), AISLADA (bfk_tipo), CHROME (opcional).
// Escribe en la copia (autoriza NUEVA); quien lo ejecuta limpia después. Salida: OK/FALLA (sin datos de negocio).
import { createHmac } from "node:crypto";
import { chromium } from "playwright-core";

const { URL_APP = "http://127.0.0.1:4178/", PGRST_URL, JWT_SECRET, ADM, USR, NUEVA, AISLADA } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64({ sub, role: "authenticated", aud: "authenticated", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 300) : "")); } else { nOk++; console.log("OK    " + k); } };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ["--no-sandbox"] });

async function abrir(yo, correo, { hash = "", meta = {}, ancho = 1280, alto = 800, movil = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errs = []; const pedidos = [];
  page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => d.accept());
  const user = { id: yo, email: correo, app_metadata: { provider: "email", ...meta }, user_metadata: {} };
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { ok: false, error: "sin API en la prueba" } });
      return route.continue();
    }
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "x", refresh_token: "r", expires_in: 3600, user } });
    if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: user });
    if (u.pathname.includes("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    if (!u.pathname.startsWith("/rest/v1/")) return route.abort();
    const ruta = u.pathname.slice("/rest/v1".length) + u.search;
    const h = { ...req.headers(), authorization: `Bearer ${jwt(yo)}` }; for (const k of ["apikey", "host", "connection", "content-length", "origin", "referer"]) delete h[k];
    // Toda escritura de la app se ejecuta y se DESHACE (tx=rollback) salvo la autorización de la cuenta, que es lo probado.
    const obj = u.pathname.split("/").pop();
    if (!["GET", "HEAD"].includes(req.method()) && obj !== "bfk_autorizar_cuenta") h.prefer = [h.prefer, "tx=rollback"].filter(Boolean).join(", ");
    const r = await fetch(PGRST_URL + ruta, { method: req.method(), headers: h, body: ["GET", "HEAD"].includes(req.method()) ? undefined : req.postData() });
    const cuerpo = Buffer.from(await r.arrayBuffer());
    pedidos.push({ m: req.method(), obj: u.pathname.split("/").pop(), s: r.status, n: (() => { try { const j = JSON.parse(cuerpo.toString() || "null"); return Array.isArray(j) ? j.length : null; } catch { return null; } })() });
    return route.fulfill({ status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json" }, body: cuerpo });
  });
  await page.addInitScript((s) => { try { if (!sessionStorage.getItem("__i")) { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); sessionStorage.setItem("__i", "1"); } } catch {} },
    { access_token: "x", refresh_token: "r", user });
  await page.goto(URL_APP + hash, { waitUntil: "load" }); await page.waitForTimeout(5000);
  return { page, ctx, errs, pedidos };
}
const cuenta = async (p, sel) => p.locator(sel).count();
const attr = async (p, sel, a) => ((await p.locator(sel).count()) ? p.locator(sel).first().getAttribute(a) : null);

// 1. Cuenta nueva sin perfil, también por dirección directa: no se monta nada y solo se consulta su propio perfil.
for (const [k, hash, vista] of [["P01", "", {}], ["P02", "#/finanzas", {}], ["P03", "#/compras", { ancho: 390, alto: 844, movil: true }]]) {
  const r = await abrir(NUEVA, "nueva.ui@seguridad.invalid", { hash, ...vista });
  const datos = r.pedidos.filter((x) => x.obj !== "perfiles");
  ok(`${k}_sin_perfil_${hash || "inicio"}_bloqueada_y_sin_consultas`, (await attr(r.page, "[data-cuenta-por-autorizar]", "data-cuenta-por-autorizar")) === "sin_perfil"
    && datos.length === 0 && r.pedidos.every((x) => x.n === 0 || x.n === null) && (await cuenta(r.page, "[data-nav]")) === 0, { datos, errs: r.errs });
  await r.ctx.close();
}
// 2. Cuenta aislada: mensaje propio y sin consultas.
{ const r = await abrir(AISLADA, "aislada.ui@seguridad.invalid", { meta: { bfk_tipo: "respaldo_documental" } });
  ok("P04_aislada_sin_acceso", (await attr(r.page, "[data-cuenta-por-autorizar]", "data-cuenta-por-autorizar")) === "aislada" && r.pedidos.filter((x) => x.obj !== "perfiles").length === 0);
  await r.ctx.close(); }
// 3. Usuario autorizado: carga sus datos como siempre (la base responde con filas).
{ const r = await abrir(USR, "usuario.ui@seguridad.invalid");
  const oc = r.pedidos.find((x) => x.obj === "ordenes_compra_v2");
  ok("P05_usuario_autorizado_carga_datos", (await cuenta(r.page, "[data-nav]")) > 0 && oc?.s === 200 && oc.n > 0 && r.errs.length === 0, { oc, errs: r.errs });
  ok("P06_usuario_sin_errores_de_permiso", !r.pedidos.some((x) => x.s === 401 || x.s === 403), r.pedidos.filter((x) => x.s >= 400));
  await r.ctx.close(); }
// 4. Administrador: ve la cuenta pendiente por la función real y la autoriza.
{ const r = await abrir(ADM, "admin.ui@seguridad.invalid", { hash: "#/administracion" }); const p = r.page;
  const oc = r.pedidos.find((x) => x.obj === "ordenes_compra_v2");
  ok("P07_admin_carga_datos", oc?.s === 200 && oc.n > 0, oc);
  ok("P08_admin_lista_por_funcion_real", (await attr(p, "[data-por-autorizar]", "data-por-autorizar")) === "ok"
    && (await cuenta(p, '[data-cuenta-pendiente="nueva.ui@seguridad.invalid"]')) === 1 && r.pedidos.some((x) => x.obj === "bfk_cuentas_por_autorizar" && x.s === 200));
  const ais = p.locator('[data-cuenta-pendiente="aislada.ui@seguridad.invalid"]');
  ok("P09_admin_ve_aislada_sin_boton", (await ais.count()) === 1 && (await ais.locator("[data-autorizar-abrir]").count()) === 0);
  if (await cuenta(p, '[data-cuenta-pendiente="nueva.ui@seguridad.invalid"] [data-autorizar-abrir]')) {
    await p.locator('[data-cuenta-pendiente="nueva.ui@seguridad.invalid"] [data-autorizar-abrir]').click();
    await p.locator("[data-autorizar-nombre]").fill("Cuenta UI Prueba"); await p.locator("[data-autorizar-confirmacion] input").check(); await p.locator("[data-autorizar-confirmar]").click(); await p.waitForTimeout(4000);
  }
  ok("P10_admin_autoriza_por_funcion_real", r.pedidos.some((x) => x.obj === "bfk_autorizar_cuenta" && x.s === 200)
    && (await cuenta(p, '[data-cuenta-pendiente="nueva.ui@seguridad.invalid"]')) === 0, r.pedidos.filter((x) => x.obj.startsWith("bfk_")));
  ok("P11_admin_ve_registro_de_autorizaciones", ((await p.locator("[data-registro-autorizaciones]").innerText().catch(() => "")) || "").includes("Cuenta UI Prueba")
    && r.pedidos.some((x) => x.obj === "perfiles_autorizaciones" && x.s === 200));
  ok("P12_admin_sin_errores", r.errs.length === 0, r.errs);
  await r.ctx.close(); }
// 5. La cuenta recién autorizada entra con datos.
{ const r = await abrir(NUEVA, "nueva.ui@seguridad.invalid");
  const oc = r.pedidos.find((x) => x.obj === "ordenes_compra_v2");
  ok("P13_cuenta_autorizada_entra_con_datos", (await cuenta(r.page, "[data-cuenta-por-autorizar]")) === 0 && oc?.s === 200 && oc.n > 0, oc);
  ok("P14_cuenta_autorizada_no_es_admin", (await cuenta(r.page, '[data-nav="usuarios"]')) === 0);
  await r.ctx.close(); }

await browser.close();
console.log(`\n${nOk} OK · ${F.length} FALLA`);
process.exit(F.length ? 1 : 0);
