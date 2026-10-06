// Fase 4B · Prueba de punta a punta con DOS USUARIOS en DOS DISPOSITIVOS: navegador real (Chromium) → PostgREST →
// base PostgreSQL DESECHABLE con la migración 4B. Nunca contra producción.
// Requiere: PostgREST en PGRST_URL con JWT_SECRET; base preparada con e2e_postgrest_preparar.sql; PG* para verificar;
// URL_NUEVA (build 4B) y, opcional, URL_ANTERIOR (build anterior, para probar que un cliente viejo no pisa saldos).
// Variables: ADM y USR (uuid de un administrador y de un usuario normal existentes en perfiles).
// Imprime RESULT|nombre|OK o FALLA|nombre|detalle (sin datos de clientes).
import { chromium } from "playwright-core";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const { PGRST_URL, JWT_SECRET, URL_NUEVA, URL_ANTERIOR, ADM, USR } = process.env;
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let fallas = 0;
const ok = (n, c, d = "") => { if (c) console.log(`RESULT|${n}|OK`); else { fallas++; console.log(`FALLA|${n}|${String(d).slice(0, 300)}`); } };
const sql = (q) => execFileSync("psql", ["-XAtq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const saldo = () => Number(sql("select saldo_deuda from public.financiadores where id='e2e4b_fin'"));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => { const h = b64({ alg: "HS256", typ: "JWT" }); const p = b64({ sub, role: "authenticated", aud: "authenticated", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7200 });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const espera = (p, ms) => p.waitForTimeout(ms);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
async function dispositivo(url, uid, movil) {
  const ctx = await browser.newContext({ viewport: movil ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); const errs = []; const escr = []; const token = jwt(uid);
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/api/oc")) return route.fulfill({ status: 404, json: { ok: false, ocs: [] } });
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: token, refresh_token: "r", expires_in: 7200, user: { id: uid } } });
    if (u.pathname.includes("/auth/v1/")) return route.fulfill({ json: { id: uid } });
    if (u.pathname.startsWith("/storage/") || u.pathname.startsWith("/realtime/")) return route.fulfill({ json: [] });
    if (req.method() !== "GET") escr.push(`${req.method()} ${u.pathname.replace("/rest/v1/", "")} ${req.postData() || ""}`);
    const destino = PGRST_URL + u.pathname.replace("/rest/v1", "") + u.search;
    const headers = { ...req.headers(), authorization: `Bearer ${token}` }; delete headers.apikey; delete headers.host;
    try { const r = await route.fetch({ url: destino, headers }); return route.fulfill({ response: r }); }
    catch (e) { return route.fulfill({ status: 502, json: { message: "proxy: " + e.message } }); }
  });
  await page.addInitScript(([id, t]) => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: t, refresh_token: "r", user: { id, email: "prueba@prueba.cl" } })); }, [uid, token]);
  await page.goto(url, { waitUntil: "load" }); await espera(page, 4500);
  return { page, ctx, errs, escr };
}
async function abrirOC(p, numero, movil) {
  await p.locator('[data-nav="compras"]').first().click(); await espera(p, 900);
  await p.getByPlaceholder(/Buscar OC/).first().fill(numero); await espera(p, 700);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1400);
  for (let i = 0; i < 30 && /Verificando disponibilidad de edición/.test(await p.locator(`[data-oc="${numero}"]`).innerText()); i++) await espera(p, 500);
  void movil;
}
async function etapa(p, numero, key) {
  const fila = p.locator(`[data-oc="${numero}"]`); const det = fila.locator(`[data-detalle-etapa="${key}"]`);
  if (!(await det.count())) { await fila.locator(`[data-etapa="${key}"]`).click(); await espera(p, 400); }
  return det;
}
async function registrarCompra(p, numero, costo) {
  await abrirOC(p, numero);
  await p.locator(`[data-oc="${numero}"]`).getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(p, 600);
  const m = p.locator("[role=dialog]").last();
  await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 300);
  await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Producto E2E");
  const nums = m.locator("input[type=number]"); await nums.nth(1).fill(String(costo)); await nums.nth(2).fill(String(costo * 2));
  await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 400);
  const sel = m.locator("select").filter({ has: p.locator("option", { hasText: "Financiador E2E 4B" }) }).first();
  await sel.selectOption({ label: (await sel.locator("option", { hasText: "Financiador E2E 4B" }).first().innerText()).trim() });
  await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 400);
  await m.getByRole("button", { name: /Registrar compra/ }).click(); await espera(p, 3500);
}

const s0 = saldo();
ok("E0_preparada_saldo_inicial_600000", s0 === 600000, s0);
// Tres dispositivos abren la app ANTES de cualquier operación (pantallas que luego quedan desactualizadas).
const A = await dispositivo(URL_NUEVA, ADM, false);                       // administrador, escritorio
const B = await dispositivo(URL_NUEVA, USR, true);                        // usuario normal, teléfono
const C = URL_ANTERIOR ? await dispositivo(URL_ANTERIOR, USR, true) : null; // cliente con la versión ANTERIOR de la app
ok("E1_app_carga_datos_reales", (await A.page.locator("[data-nav]").count()) > 0 && A.errs.length === 0, A.errs.join(" | "));

// A registra un pago de 250.000 al financiador por la OC E2E4B-1.
await abrirOC(A.page, "E2E4B-1");
const det = await etapa(A.page, "E2E4B-1", "financ");
await det.getByRole("button", { name: /Registrar pago/ }).click(); await espera(A.page, 900);
if (process.env.DEPURAR) { console.log("DBG dialogs", await A.page.locator("[role=dialog]").count(), A.escr.join(","), A.errs.join("|")); await A.page.screenshot({ path: process.env.DEPURAR + "/a.png" }); console.log((await A.page.evaluate(() => document.body.innerText)).slice(0, 1500)); }
const mA = A.page.locator("[role=dialog]").last();
await mA.locator("input[type=number]").fill("250000");
await mA.getByRole("button", { name: /Registrar pago a financiador/ }).click(); await espera(A.page, 3500);
const s1 = saldo();
ok("E2_pago_de_A_aplicado_por_la_base", s1 === s0 - 250000, s1);

// B, con la pantalla desactualizada (no vio el pago), registra una compra de 400.000 en la OC E2E4B-2.
await registrarCompra(B.page, "E2E4B-2", 400000);
const s2 = saldo();
ok("E3_compra_de_B_no_pisa_el_pago", s2 === s0 - 250000 + 400000, `${s2}`);
const DERIV = /"(saldo_deuda|costo_total|estado_compra|monto_pagado_fin|estado_pago_financiamiento|monto_facturado|estado_factura_propia|monto_cobrado|estado_pago_cliente)"/;
ok("E3b_B_no_escribe_saldos_ni_totales", !B.escr.some((w) => /^PATCH financiadores/.test(w) || (/^(PATCH|POST) ordenes_compra_v2/.test(w) && DERIV.test(w))) && B.escr.some((w) => /rpc\/registrar_compra_oc/.test(w)), B.escr.filter((w) => DERIV.test(w)).join(", ").slice(0, 300));

// C (versión anterior de la app, pantalla desactualizada) registra una compra de 100.000 en E2E4B-3:
// intenta escribir el saldo calculado en su pantalla; la base lo ignora y recalcula desde los eventos.
if (C) {
  await registrarCompra(C.page, "E2E4B-3", 100000);
  const s3 = saldo();
  ok("E4_cliente_anterior_intenta_escribir_saldo", C.escr.some((w) => /^PATCH financiadores .*saldo_deuda/.test(w)), C.escr.map((w) => w.slice(0, 60)).join(", "));
  ok("E4b_la_base_ignora_el_saldo_del_navegador", s3 === s0 - 250000 + 400000 + 100000, `${s3}`);
}
const pagos = Number(sql("select count(*) from public.eventos_pago_financiamiento where financiador_id='e2e4b_fin' and monto=250000"));
ok("E5_pago_de_A_intacto", pagos === 1, pagos);
ok("E5b_totales_de_las_ocs", sql("select string_agg(numero_oc||':'||costo_total||'/'||monto_pagado_fin||'/'||estado_pago_financiamiento, ' ' order by numero_oc) from public.ordenes_compra_v2 where id like 'e2e4b_oc%'")
  === `E2E4B-1:600000/250000/parcial E2E4B-2:400000/0/pendiente${C ? " E2E4B-3:100000/0/pendiente" : " E2E4B-3:0/0/pendiente"}`,
  sql("select string_agg(numero_oc||':'||costo_total||'/'||monto_pagado_fin||'/'||estado_pago_financiamiento, ' ' order by numero_oc) from public.ordenes_compra_v2 where id like 'e2e4b_oc%'"));
ok("E6_consistencia_total", sql("select count(*) from public.fin_verificar_consistencia()") === "0");
ok("E7_sin_errores_de_interfaz", A.errs.length === 0 && B.errs.length === 0, [...A.errs, ...B.errs].join(" | "));
await browser.close();
console.log(`RESUMEN|e2e_postgrest|fallas=${fallas}`);
process.exit(fallas ? 1 : 0);
