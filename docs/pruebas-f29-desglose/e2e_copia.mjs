// F29 con desglose sobre una COPIA RESTAURADA (datos reales, PostgREST real con RLS y permisos de producción). Nunca producción.
//   · *.supabase.co/rest/v1 → PostgREST local de la copia (JWT de un administrador de la copia); /auth/v1 → sesión simulada;
//     Storage/Functions → 404; /api/* y cualquier otro dominio (salvo fuentes) → bloqueados.
// Modos:
//   escribir (por defecto): registra en la copia el F29 de octubre 2026 del informe, su pago, vuelve a guardar, un F29 en $0
//     (noviembre 2026), un período con IVA a pagar (diciembre 2026, pago parcial) y edita un histórico en su formato.
//   lectura: SOLO LECTURA (verificación del sitio publicado): abre el formulario y escribe los datos de octubre SIN guardar,
//     revisa el desglose y la vista de un período histórico. Falla si hubo cualquier escritura.
// Uso: PGRST_URL=… JWT_SECRET=… USUARIO=… CHROME=… node e2e_copia.mjs <url-app> [escribir|lectura] [celular|escritorio]
import { chromium } from "playwright-core";
import { createHmac } from "node:crypto";
const URL_APP = process.argv[2].replace(/\/$/, "") + "/";
const MODO = process.argv[3] || "escribir"; const VISTA = process.argv[4] || "celular";
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
const ir = async (r) => { await page.evaluate((x) => { location.hash = "#/" + x; }, r); await page.waitForTimeout(1200); };
const cerrar = async () => { while (await page.locator('[role="dialog"] button[aria-label="Cerrar"]').count()) { await page.locator('[role="dialog"] button[aria-label="Cerrar"]').last().click(); await page.waitForTimeout(300); } };
const desg = async (d) => (await page.locator(`[data-desglose-f29] [data-desglose="${d}"]`).first().innerText()).replace(/\s+/g, " ");
const det = async (d) => (await page.locator(`[data-detalle-f29] [data-detalle="${d}"]`).first().innerText()).replace(/\s+/g, " ");
const tabF29 = async () => { await page.getByRole("tab", { name: /^F29/ }).first().click().catch(async () => page.getByText("F29", { exact: true }).first().click()); await page.waitForTimeout(500); };
const abrirForm = async (mes, anio) => { await page.getByRole("tab", { name: /^IVA mensual/ }).first().click().catch(async () => page.getByText("IVA mensual", { exact: true }).first().click()); await page.waitForTimeout(400);
  await page.getByText("+ Registrar IVA de otro mes").first().click(); await page.waitForTimeout(600);
  await page.locator("[data-form-f29] select").first().selectOption(String(mes)); await page.locator('[data-form-f29] input[type="number"]').first().fill(String(anio)); await page.waitForTimeout(300); };
const llenar = async (vals) => { for (const [k, v] of Object.entries(vals)) await page.locator(`[data-f29-campo="${k}"]`).fill(v); await page.waitForTimeout(200); };
const OCT = { vN: "$ 6.331.221", cN: "6.189.588", iV: "1.202.931", iC: "$ 1.176.028", rem: "149.951", ppm: "31.656", otras: "–" };

await ir("impuestos");
ok("carga_impuestos", (await page.locator('[data-dato="f29-pendiente"], [data-indicador="f29-pendiente"]').count()) + (await page.getByText("IVA mensual").count()) > 0);
const ivaAntes = await rest("iva_mensual?select=*&order=anio,mes");
ok("copia_sin_f29_octubre_2026", !ivaAntes.some((r) => r.anio === 2026 && r.mes === 10), "la copia ya tenía octubre");
await abrirForm(10, 2026);
ok("formulario_con_desglose", (await page.locator('[data-form-f29="desglose"]').count()) === 1);
await llenar(OCT);
const vals = { neto: await desg("iva-neto"), aPagar: await desg("iva-a-pagar"), remSig: await desg("remanente-siguiente"), total: await desg("total-f29"), desc: await desg("descuento-comisiones") };
ok("formulario_desglose_octubre", /\$26\.903/.test(vals.neto) && /\$0$/.test(vals.aPagar) && /\$123\.048/.test(vals.remSig) && /\$31\.656/.test(vals.total) && /\$58\.559/.test(vals.desc), JSON.stringify(vals));
if (MODO === "lectura") {
  await cerrar(); await tabF29();
  const legacy = ivaAntes.filter((r) => !r.desglose_f29 && Number(r.anio) * 12 + Number(r.mes) >= 2026 * 12 + 8).slice(-1)[0];
  if (legacy) { await page.locator(`[data-f29="${legacy.anio}-${legacy.mes}"]`).click(); await page.waitForTimeout(500);
    ok("historico_vista_anterior", (await page.locator("[data-detalle-f29] [data-f29-anterior]").count()) === 1); await cerrar(); }
} else {
  await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(2500);
  const oct = (await rest("iva_mensual?select=*&anio=eq.2026&mes=eq.10"))[0] || {};
  ok("guardado_octubre_en_la_copia", Number(oct.ventas_netas) === 6331221 && Number(oct.compras_netas) === 6189588 && Number(oct.iva_ventas) === 1202931 && Number(oct.iva_compras) === 1176028
    && Number(oct.remanente_anterior) === 149951 && Number(oct.ppm) === 31656 && Number(oct.otras_retenciones) === 0 && oct.desglose_f29 === true && Number(oct.iva_pagado) === 31656, JSON.stringify(oct));
  let gOct = await rest("gastos_indirectos?select=*&anio=eq.2026&mes=eq.10&categoria_id=eq.cat_impuesto");
  ok("sin_pago_no_hay_gasto", gOct.length === 0, JSON.stringify(gOct));
  await tabF29();
  await page.locator('[data-f29="2026-10"]').click(); await page.waitForTimeout(600);
  ok("declarado_pendiente_31656", /Declarado · pendiente de pago \$31\.656/.test(await page.locator("[data-estado-f29]").innerText()) && (await page.locator("[data-saldo-f29]").getAttribute("data-saldo-f29")) === "31656");
  ok("vista_periodo_desglose", /\$123\.048/.test(await det("remanente-siguiente")) && /\$58\.559/.test(await det("descuento-comisiones")) && /\$31\.656/.test(await det("total-f29")));
  await page.locator("[data-f29-registrar-pago]").click(); await page.waitForTimeout(300);
  await page.locator("[data-pago-fecha]").fill("2026-11-12");
  await page.locator("[data-pago-confirmar]").dblclick(); await page.waitForTimeout(3000);
  gOct = await rest("gastos_indirectos?select=*&anio=eq.2026&mes=eq.10&categoria_id=eq.cat_impuesto");
  ok("pago_una_salida_de_caja", gOct.length === 1 && Number(gOct[0].monto) === 31656 && gOct[0].fecha === "2026-11-12" && gOct[0].subcategoria === "IVA Mensual", JSON.stringify(gOct));
  ok("saldo_cero_tras_pago", (await page.locator("[data-saldo-f29]").getAttribute("data-saldo-f29")) === "0");
  for (let i = 0; i < 2; i++) { await page.locator("[data-f29-editar]").click(); await page.waitForTimeout(500); await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(2200); }
  gOct = await rest("gastos_indirectos?select=*&anio=eq.2026&mes=eq.10&categoria_id=eq.cat_impuesto");
  ok("volver_a_guardar_no_duplica", gOct.length === 1 && (await page.locator("[data-saldo-f29]").getAttribute("data-saldo-f29")) === "0", gOct.length);
  await cerrar();
  // F29 en $0 (noviembre 2026) y período con IVA a pagar (diciembre 2026, pago parcial).
  await abrirForm(11, 2026); await llenar({ vN: "0", cN: "0", iV: "0", iC: "0", rem: "123.048", ppm: "0", otras: "0" });
  await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(2200);
  const nov = (await rest("iva_mensual?select=*&anio=eq.2026&mes=eq.11"))[0] || {};
  ok("f29_cero_guardado", nov.desglose_f29 === true && Number(nov.ppm) === 0 && Number(nov.otras_retenciones) === 0 && Number(nov.iva_pagado) === 0, JSON.stringify(nov));
  await tabF29(); ok("f29_cero_listado", /\$0 a pagar/.test(await page.locator('[data-f29="2026-11"]').innerText()));
  await abrirForm(12, 2026); await llenar({ vN: "5.263.158", cN: "3.157.895", iV: "1.000.000", iC: "600.000", rem: "123.048", ppm: "26.316", otras: "5.000" });
  ok("iva_a_pagar_desglose", /\$276\.952/.test(await desg("iva-a-pagar")) && /\$308\.268/.test(await desg("total-f29")) && /\$431\.316/.test(await desg("descuento-comisiones")));
  await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(2200);
  await tabF29(); await page.locator('[data-f29="2026-12"]').click(); await page.waitForTimeout(500);
  await page.locator("[data-f29-registrar-pago]").click(); await page.waitForTimeout(300);
  await page.locator("[data-pago-monto]").fill("200.000"); await page.locator("[data-pago-confirmar]").click(); await page.waitForTimeout(2500);
  ok("iva_a_pagar_pago_parcial", (await page.locator("[data-saldo-f29]").getAttribute("data-saldo-f29")) === "108268");
  await cerrar();
  // Histórico sin desglose: editar en su formato deja las columnas anteriores idénticas y las nuevas en NULL.
  const legacy = ivaAntes.filter((r) => !r.desglose_f29 && Number(r.anio) * 12 + Number(r.mes) >= 2026 * 12 + 8).slice(-1)[0];
  if (legacy) {
    await tabF29(); await page.locator(`[data-f29="${legacy.anio}-${legacy.mes}"]`).click(); await page.waitForTimeout(500);
    ok("historico_vista_anterior", (await page.locator("[data-detalle-f29] [data-f29-anterior]").count()) === 1);
    await page.locator("[data-f29-editar]").click(); await page.waitForTimeout(500);
    ok("historico_formulario_anterior", (await page.locator('[data-form-f29="anterior"]').count()) === 1);
    await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(2200);
    const desp = (await rest(`iva_mensual?select=*&id=eq.${legacy.id}`))[0];
    const cols = ["anio", "mes", "ventas_netas", "iva_ventas", "compras_netas", "iva_compras", "iva_pagado", "remanente_anterior", "ppm", "otras_retenciones", "desglose_f29"];
    ok("historico_editado_identico", cols.every((c) => JSON.stringify(desp[c]) === JSON.stringify(legacy[c])), JSON.stringify({ antes: legacy, despues: desp }));
    await cerrar();
  }
}
ok("sin_errores_de_pagina", errs.length === 0, errs.join(" | "));
// Rechazos en las tablas del F29, de la caja y de las comisiones (otros módulos de la copia se informan aparte).
const CLAVE = /\b(iva_mensual|gastos_indirectos|ordenes_compra_v2|pagos_vendedor|vendedores|categorias_gasto|perfiles)$/;
ok("sin_rechazos_de_la_base", !err4.some((e) => CLAVE.test(e)), err4.filter((e) => CLAVE.test(e)).join(" | "));
if (err4.length) console.log("RECHAZOS_INFORMATIVOS|" + [...new Set(err4)].join(","));
if (MODO === "lectura") ok("sin_escrituras", escr.length === 0, escr.map((e) => `${e.m} ${e.t}`).join(", "));
else console.log("ESCRITURAS|" + escr.map((e) => `${e.m} ${e.t}`).join(","));
const n = Object.values(res); console.log(`RESUMEN F29 en copia (${MODO}, ${VISTA}): ${n.filter(Boolean).length} OK, ${n.filter((x) => !x).length} FALLA(S)`);
await browser.close(); if (n.some((x) => !x)) process.exitCode = 1;
