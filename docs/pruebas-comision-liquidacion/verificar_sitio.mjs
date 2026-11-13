// Navegación de SOLO LECTURA de Comisiones (Vendedores) con los datos de una copia (PostgREST) — sitio local o de producción.
// Uso: PGRST_URL=… JWT_SECRET=… USUARIO=… CHROME=… ESPERADO="vend_matias=846880,vend_kevin=92637" node verificar_sitio.mjs <url> [celular|escritorio]
import { chromium } from "playwright-core";
import { createHmac } from "node:crypto";
const URL_APP = process.argv[2].replace(/\/$/, "") + "/";
const MODO = "lectura"; const VISTA = process.argv[3] || "celular";
const { PGRST_URL, JWT_SECRET, USUARIO } = process.env;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ahora = Math.floor(Date.now() / 1000);
const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub: USUARIO, role: "authenticated", aud: "authenticated", exp: ahora + 7200, iat: ahora });
const TOKEN = `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
const user = { id: USUARIO, aud: "authenticated", role: "authenticated", email: "verificacion@copia.invalid", app_metadata: { provider: "email" }, user_metadata: {} };
const sesion = { access_token: TOKEN, refresh_token: "r", token_type: "bearer", expires_in: 7200, expires_at: ahora + 7200, user };
const res = {}; const errs = []; const escr = []; const err4 = [];
const ok = (n, c, det = "") => { res[n] = !!c; console.log((c ? "OK    " : "FALLA ") + n + (c ? "" : " :: " + String(det).slice(0, 300))); };
const rest = async (ruta) => (await fetch(`${PGRST_URL}/${ruta}`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();

const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });
const ctx = await browser.newContext(VISTA === "celular" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Santiago", locale: "es-CL", serviceWorkers: "block" }
  : { viewport: { width: 1440, height: 900 }, timezoneId: "America/Santiago", locale: "es-CL", serviceWorkers: "block" });
await ctx.addInitScript((s) => { try { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); } catch {} }, sesion);
await ctx.route("**/*", async (route) => {
  const req = route.request(); const u = new URL(req.url()); const m = req.method();
  if (u.hostname.endsWith("supabase.co")) {
    if (u.pathname.startsWith("/auth/v1/")) {
      if (u.pathname.endsWith("/user") && m === "GET") return route.fulfill({ json: user });
      if (u.pathname.startsWith("/auth/v1/token")) return route.fulfill({ json: sesion });
      return route.fulfill({ status: 404, json: {} }); }
    if (!u.pathname.startsWith("/rest/v1/")) return route.fulfill({ status: 404, json: { message: "no disponible en la prueba" } });
    const obj = u.pathname.replace(/^\/rest\/v1\//, ""); const tabla = obj.split("?")[0];
    if (!["GET", "HEAD"].includes(m) && !obj.startsWith("rpc/") && tabla !== "mp_cache_avisos") escr.push({ m, t: tabla, q: u.search, body: req.postData() });
    if (MODO === "lectura" && !["GET", "HEAD"].includes(m) && tabla !== "mp_cache_avisos" && !obj.startsWith("rpc/")) return route.fulfill({ status: 403, json: { message: "escritura bloqueada en verificación" } });
    const hd = { ...req.headers(), authorization: `Bearer ${TOKEN}` };
    for (const k of ["apikey", "host", "connection", "content-length", "origin", "referer"]) delete hd[k];
    const r = await fetch(PGRST_URL + "/" + obj + u.search, { method: m, headers: hd, body: ["GET", "HEAD"].includes(m) ? undefined : req.postData() });
    if (r.status >= 400) err4.push(`${r.status} ${m} ${tabla}`);
    return route.fulfill({ status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length"].includes(k))), body: Buffer.from(await r.arrayBuffer()) }); }
  if (u.origin === new URL(URL_APP).origin) { if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "bloqueado en la prueba" } }); return route.continue(); }
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/.test(u.hostname)) return route.continue();
  return route.abort(); });
const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => d.accept());
await page.clock.setFixedTime(new Date("2026-11-13T12:00:00-03:00"));
await page.goto(URL_APP, { waitUntil: "load" }); await page.waitForTimeout(4000);
const ir = async (r) => { await page.evaluate((x) => { location.hash = "#/" + x; }, r); await page.waitForTimeout(1500); };
const bloque = (bt, etiqueta) => { const ini = Math.max(0, bt.search(/comisión mes a mes/i)); const m = bt.slice(ini).search(new RegExp("(^|\\n)" + etiqueta.replace("/", "\\/") + "\\n"));
  if (m < 0) return ""; const i0 = ini + m + 1; return bt.slice(i0, bt.indexOf("Comisión pagada:", i0) + 160); };
// Esperado (desde la copia): ESPERADO="vend_matias=846880,vend_kevin=92637"
const esperado = Object.fromEntries(String(process.env.ESPERADO || "").split(",").filter(Boolean).map((x) => x.split("=")));
const vend = await rest("vendedores?select=id,nombre&order=nombre");
await ir("vendedores");
for (const v of vend) {
  // El nombre puede aparecer en más de un lugar (p. ej. el usuario en la barra de escritorio): se prueba cada coincidencia
  // hasta que aparezca el detalle mes a mes de ese vendedor.
  const todos = page.getByText(v.nombre, { exact: true }); const nEl = await todos.count(); if (!nEl) continue;
  let bt = "", el = todos.first();
  for (let k = 0; k < nEl; k++) {
    el = todos.nth(k); if (!(await el.isVisible().catch(() => false))) continue;
    await el.click().catch(() => {}); await page.waitForTimeout(1500); bt = await page.evaluate(() => document.body.innerText);
    if (bloque(bt, "Oct/2026") || !esperado[v.id]) break;
    await el.click().catch(() => {}); await page.waitForTimeout(1200); bt = await page.evaluate(() => document.body.innerText);
    if (bloque(bt, "Oct/2026")) break;
  }
  const oct = bloque(bt, "Oct/2026");
  const m = oct.match(/= Comisión del mes: (\$[\d.]+)/); const d = oct.match(/Descuento tributario total: (\$[\d.]+)/);
  if (oct) console.log(`OCTUBRE_EN_PANTALLA|${v.id}|comisión ${m?.[1]}|descuento ${d?.[1]}|${/No incluidas en este mes[^\n]*/.exec(oct)?.[0] || "sin refacturadas fuera"}`);
  if (esperado[v.id]) ok(`octubre_${v.id}_${esperado[v.id]}`, m && Number(m[1].replace(/[$.]/g, "")) === Number(esperado[v.id]) && d?.[1] === "$31.656", oct.slice(0, 400));
  for (const mes of ["Jul/2026", "Ago/2026", "Sep/2026", "Nov/2026"]) { const b = bloque(bt, mes); if (b) console.log(`MES_EN_PANTALLA|${v.id}|${mes}|${(b.match(/= Comisión del mes: \$[\d.]+/) || b.match(/Comisión del mes: \$[\d.]+/) || [""])[0]}|${(b.match(/Comisión pagada: \$[\d.]+/) || [""])[0]}|${/Por revisar · OC [^ ]+/.exec(b)?.[0] || ""}|${/Pagadas en esta liquidación[^\n]*/.exec(b)?.[0] || ""}`); }
  await el.click().catch(() => {}); await page.waitForTimeout(500);
}
ok("sin_errores_de_pagina", errs.length === 0, errs.join(" | "));
ok("sin_escrituras", escr.length === 0, escr.map((e) => `${e.m} ${e.t}`).join(", "));
const n = Object.values(res); console.log(`RESUMEN comisiones en pantalla (${VISTA}): ${n.filter(Boolean).length} OK, ${n.filter((x) => !x).length} FALLA(S)`);
await browser.close(); if (n.some((x) => !x)) process.exitCode = 1;
