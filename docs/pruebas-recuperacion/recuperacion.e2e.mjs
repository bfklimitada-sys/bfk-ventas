// Prueba de extremo a extremo del flujo de recuperación de contraseña, con Supabase simulado
// (ninguna llamada sale a la red). Requiere la app compilada servida en BASE (npm run build && npx vite preview).
// Ejecutar: BASE=http://127.0.0.1:4173 node docs/pruebas-recuperacion/recuperacion.e2e.mjs
import { chromium } from "playwright-core";
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = (process.env.BASE || "http://127.0.0.1:4173").replace(/\/$/, "");
let ok = 0, fallas = 0;
const eq = (n, a, b) => { const v = JSON.stringify(a) === JSON.stringify(b); v ? ok++ : fallas++; console.log((v ? "OK    " : "FALLA ") + n + (v ? "" : ` :: esperado ${JSON.stringify(b)} obtenido ${JSON.stringify(a)}`)); };

// Servidor Auth simulado y configurable por escenario.
function simulado(cfg = {}) {
  const log = [];
  const handler = async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    const body = req.postData() || ""; const auth = req.headers()["authorization"] || "";
    log.push({ m, path: u.pathname, search: u.search, body, auth });
    const p = u.pathname;
    if (p.endsWith("/auth/v1/recover")) return cfg.recover ? route.fulfill(cfg.recover()) : route.fulfill({ json: {} });
    if (p.endsWith("/auth/v1/verify")) return route.fulfill(cfg.verify ? cfg.verify() : { json: { access_token: "AT_HASH", refresh_token: "RT_HASH", expires_in: 3600, user: { id: "u1", email: "kevin@bfk.cl" } } });
    if (p.endsWith("/auth/v1/user") && m === "GET") return route.fulfill(cfg.getUser ? cfg.getUser(auth) : { json: { id: "u1", email: "kevin@bfk.cl" } });
    if (p.endsWith("/auth/v1/user") && m === "PUT") return route.fulfill(cfg.putUser ? cfg.putUser(auth, body) : { json: { id: "u1", email: "kevin@bfk.cl" } });
    if (p.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    if (p.endsWith("/auth/v1/token")) {
      if (u.search.includes("refresh_token")) return route.fulfill(cfg.refresh ? cfg.refresh() : { json: { access_token: "AT_REFRESCADO", refresh_token: "RT2", expires_in: 3600, user: { id: "u1", email: "kevin@bfk.cl" } } });
      return route.fulfill(cfg.login ? cfg.login(body) : { json: { access_token: "AT_LOGIN", refresh_token: "RT_L", expires_in: 3600, user: { id: "u1", email: "kevin@bfk.cl" } } });
    }
    if (p.includes("/rest/v1/")) {
      if (p.endsWith("/perfiles")) return route.fulfill({ json: [{ id: "u1", nombre: "Kevin", rol: "admin" }] });
      if (m !== "GET") return route.fulfill({ json: cfg.rpc || [] });
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: {} });
  };
  return { log, handler };
}

async function abrir(browser, ruta, cfg, { sesionGuardada } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));
  const sim = simulado(cfg); await page.route("**/*", sim.handler);
  if (sesionGuardada) await page.addInitScript((s) => { try { if (!sessionStorage.getItem("_x")) { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); sessionStorage.setItem("_x", "1"); } } catch {} }, sesionGuardada);
  await page.goto(BASE + ruta, { waitUntil: "load" }); await page.waitForTimeout(900);
  return { ctx, page, log: sim.log, errores };
}
const limpia = async (page) => { const h = await page.evaluate(() => location.href); return h.startsWith(BASE + "/") && !/token|error|flujo|type=/.test(h); };
const texto = (page) => page.evaluate(() => document.body.innerText);
const LINK = "/?flujo=recuperacion#access_token=AT_REC&refresh_token=RT_REC&expires_in=3600&expires_at=2000000000&token_type=bearer&type=recovery";

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  // 1. Inicio de sesión existente intacto.
  { const { ctx, page, log, errores } = await abrir(browser, "/", {});
    await page.fill('input[type=email]', "kevin@bfk.cl"); await page.fill('input[type=password]', "clave-actual");
    await page.click("text=Ingresar"); await page.waitForTimeout(1200);
    const t = log.find((l) => l.path.endsWith("/auth/v1/token") && l.search.includes("grant_type=password"));
    eq("1 login: usa grant_type=password con las credenciales", t && JSON.parse(t.body), { email: "kevin@bfk.cl", password: "clave-actual" });
    eq("1 login: entra a la app (sale de la pantalla de acceso)", (await texto(page)).includes("Ingresar"), false);
    eq("1 login: sesión guardada", await page.evaluate(() => JSON.parse(localStorage.getItem("bfk_supabase_session_v2")||"{}").access_token), "AT_LOGIN");
    eq("1 sin errores de página", errores, []); await ctx.close(); }

  // 2. Solicitar recuperación: redirect_to de producción, nunca localhost.
  { const { ctx, page, log } = await abrir(browser, "/", {});
    await page.click("text=¿Olvidaste tu contraseña?");
    await page.fill('input[type=email]', "kevin@"); await page.click("text=Enviar correo de recuperación"); await page.waitForTimeout(300);
    eq("2 correo mal escrito: no llama a Supabase", log.filter((l) => l.path.endsWith("/recover")).length, 0);
    eq("2 correo mal escrito: mensaje", (await texto(page)).includes("no tiene un formato válido"), true);
    await page.fill('input[type=email]', "kevin@bfk.cl"); await page.click("text=Enviar correo de recuperación"); await page.waitForTimeout(600);
    const r = log.find((l) => l.path.endsWith("/auth/v1/recover"));
    const rt = r && new URLSearchParams(r.search).get("redirect_to");
    eq("2 redirect_to exacto", rt, "https://bfk-ventas.vercel.app/?flujo=recuperacion");
    eq("2 ninguna llamada menciona localhost", log.some((l) => /localhost|127\.0\.0\.1/.test(decodeURIComponent(l.search + l.body))), false);
    eq("2 cuerpo solo con el correo", JSON.parse(r.body), { email: "kevin@bfk.cl" });
    eq("2 mensaje neutro (no revela si existe la cuenta)", (await texto(page)).includes("Si el correo está registrado"), true);
    await ctx.close(); }

  // 3. Límite de envíos (429).
  { const { ctx, page } = await abrir(browser, "/", { recover: () => ({ status: 429, json: { code: 429, error_code: "over_email_send_rate_limit", msg: "For security purposes, you can only request this after 42 seconds." } }) });
    await page.click("text=¿Olvidaste tu contraseña?"); await page.fill('input[type=email]', "kevin@bfk.cl");
    await page.click("text=Enviar correo de recuperación"); await page.waitForTimeout(500);
    eq("3 límite de envíos traducido", (await texto(page)).includes("debes esperar 42 segundos"), true); await ctx.close(); }

  // 4. Enlace válido: tokens fuera de la dirección, validaciones y cambio exitoso.
  { const { ctx, page, log, errores } = await abrir(browser, LINK, {});
    eq("4 dirección limpia (sin tokens)", await limpia(page), true);
    eq("4 tokens no quedan en localStorage", await page.evaluate(() => JSON.stringify(localStorage).includes("AT_REC")), false);
    const t0 = await texto(page);
    eq("4 muestra pantalla de nueva contraseña con la cuenta", t0.includes("Nueva contraseña") && t0.includes("kevin@bfk.cl"), true);
    eq("4 valida el token con GET /user", log.some((l) => l.m === "GET" && l.path.endsWith("/auth/v1/user") && l.auth === "Bearer AT_REC"), true);
    const [p1, p2] = await page.$$('input[autocomplete="new-password"]');
    const intento = async (a, b) => { await p1.fill(a); await p2.fill(b); await page.click("text=Guardar nueva contraseña"); await page.waitForTimeout(250); return texto(page); };
    eq("4 corta", (await intento("ab1", "ab1")).includes("al menos 8"), true);
    eq("4 sin números", (await intento("abcdefgh", "abcdefgh")).includes("letras y números"), true);
    eq("4 no coinciden", (await intento("Laja2026x", "Laja2026y")).includes("no coinciden"), true);
    eq("4 inválidas no llegan a Supabase", log.filter((l) => l.m === "PUT").length, 0);
    await intento("Laja2026x", "Laja2026x"); await page.waitForTimeout(500);
    const put = log.find((l) => l.m === "PUT" && l.path.endsWith("/auth/v1/user"));
    eq("4 PUT /user con la sesión de recuperación", put && [put.auth, JSON.parse(put.body)], ["Bearer AT_REC", { password: "Laja2026x" }]);
    const lo = log.find((l) => l.path.endsWith("/auth/v1/logout"));
    eq("4 cierra todas las sesiones (scope=global)", lo && [lo.search, lo.auth], ["?scope=global", "Bearer AT_REC"]);
    eq("4 confirma el cambio", (await texto(page)).includes("Tu contraseña se cambió correctamente"), true);
    await page.click("text=Ir a iniciar sesión"); await page.waitForTimeout(300);
    eq("4 vuelve al login con el correo prellenado", await page.inputValue('input[type=email]'), "kevin@bfk.cl");
    eq("4 aviso en el login", (await texto(page)).includes("Inicia sesión con tu nueva contraseña"), true);
    eq("4 no entra a la app con la sesión de recuperación", !!(await page.evaluate(() => localStorage.getItem("bfk_supabase_session_v2"))), false);
    eq("4 historial sin tokens (atrás)", await page.evaluate(() => { const h=location.href; return /access_token/.test(h); }), false);
    eq("4 sin errores de página", errores, []); await ctx.close(); }

  // 5. Misma contraseña y contraseña débil (respuesta de Supabase).
  { let n = 0;
    const { ctx, page } = await abrir(browser, LINK, { putUser: () => (++n === 1 ? { status: 422, json: { code: 422, error_code: "same_password", msg: "New password should be different from the old password." } } : { status: 422, json: { code: 422, error_code: "weak_password", msg: "Password is known to be weak and easy to guess", weak_password: { reasons: ["pwned"] } } }) });
    const [p1, p2] = await page.$$('input[autocomplete="new-password"]');
    await p1.fill("Laja2026x"); await p2.fill("Laja2026x"); await page.click("text=Guardar nueva contraseña"); await page.waitForTimeout(400);
    eq("5 misma contraseña", (await texto(page)).includes("distinta de la anterior"), true);
    await page.click("text=Guardar nueva contraseña"); await page.waitForTimeout(400);
    const t = await texto(page);
    eq("5 débil: sigue en el formulario con mensaje", t.includes("requisitos de seguridad") && t.includes("Guardar nueva contraseña"), true); await ctx.close(); }

  // 6. Enlace expirado o ya usado: pantalla clara y nuevo envío.
  { const { ctx, page, log } = await abrir(browser, "/?flujo=recuperacion#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired", {});
    eq("6 dirección limpia", await limpia(page), true);
    const t = await texto(page);
    eq("6 mensaje de enlace expirado", t.includes("expiró o ya fue utilizado"), true);
    eq("6 no intenta validar ningún token", log.filter((l) => l.path.endsWith("/auth/v1/user")).length, 0);
    await page.fill('input[type=email]', "kevin@bfk.cl"); await page.click("text=Enviar nuevo correo de recuperación"); await page.waitForTimeout(500);
    const r = log.find((l) => l.path.endsWith("/recover"));
    eq("6 reenvío con redirect_to de producción", r && new URLSearchParams(r.search).get("redirect_to"), "https://bfk-ventas.vercel.app/?flujo=recuperacion");
    eq("6 confirma reenvío", (await texto(page)).includes("Si el correo está registrado"), true);
    await page.click("text=← Volver a iniciar sesión"); await page.waitForTimeout(200);
    eq("6 vuelve al login", (await texto(page)).includes("Ingresar"), true); await ctx.close(); }

  // 7. Token revocado y refresh rechazado → enlace inválido.
  { const { ctx, page } = await abrir(browser, LINK, { getUser: () => ({ status: 401, json: { code: 401, error_code: "bad_jwt", msg: "invalid JWT" } }), refresh: () => ({ status: 400, json: { error_code: "refresh_token_not_found" } }) });
    eq("7 sesión expirada informada", (await texto(page)).includes("La sesión de recuperación expiró"), true);
    eq("7 no muestra el formulario", (await texto(page)).includes("Guardar nueva contraseña"), false); await ctx.close(); }

  // 8. Token vencido al guardar (usuario esperó) → renueva una vez y guarda.
  { const { ctx, page, log } = await abrir(browser, LINK, { putUser: (auth) => (auth === "Bearer AT_REC" ? { status: 401, json: { code: 401, msg: "invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired" } } : { json: { id: "u1" } }) });
    const [p1, p2] = await page.$$('input[autocomplete="new-password"]');
    await p1.fill("Laja2026x"); await p2.fill("Laja2026x"); await page.click("text=Guardar nueva contraseña"); await page.waitForTimeout(700);
    eq("8 reintenta con el token renovado", log.filter((l) => l.m === "PUT").map((l) => l.auth), ["Bearer AT_REC", "Bearer AT_REFRESCADO"]);
    eq("8 cambio exitoso", (await texto(page)).includes("Tu contraseña se cambió correctamente"), true); await ctx.close(); }

  // 9. Plantilla con token_hash: se canjea una sola vez.
  { const { ctx, page, log } = await abrir(browser, "/?token_hash=TH123&type=recovery", {});
    const v = log.filter((l) => l.path.endsWith("/auth/v1/verify"));
    eq("9 verify una sola vez con token_hash", v.map((l) => JSON.parse(l.body)), [{ type: "recovery", token_hash: "TH123" }]);
    eq("9 muestra formulario", (await texto(page)).includes("Guardar nueva contraseña"), true);
    eq("9 dirección limpia", await limpia(page), true); await ctx.close(); }

  // 10. Token_hash vencido.
  { const { ctx, page } = await abrir(browser, "/?token_hash=TH_VIEJO&type=recovery", { verify: () => ({ status: 403, json: { code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" } }) });
    eq("10 token_hash vencido informado", (await texto(page)).includes("expiró"), true); await ctx.close(); }

  // 11. Sesión guardada del mismo usuario: tras el cambio se descarta (fue revocada).
  { const { ctx, page } = await abrir(browser, LINK, {}, { sesionGuardada: { access_token: "AT_VIEJO", refresh_token: "RT_V", user: { id: "u1", email: "kevin@bfk.cl" } } });
    eq("11 pantalla de recuperación tiene prioridad sobre la sesión guardada", (await texto(page)).includes("Guardar nueva contraseña"), true);
    const [p1, p2] = await page.$$('input[autocomplete="new-password"]');
    await p1.fill("Laja2026x"); await p2.fill("Laja2026x"); await page.click("text=Guardar nueva contraseña"); await page.waitForTimeout(500);
    await page.click("text=Ir a iniciar sesión"); await page.waitForTimeout(300);
    eq("11 sesión guardada eliminada", await page.evaluate(() => localStorage.getItem("bfk_supabase_session_v2")), "");
    eq("11 muestra login", (await texto(page)).includes("Ingresar"), true); await ctx.close(); }

  // 12. Cancelar desde el formulario no cambia nada.
  { const { ctx, page, log } = await abrir(browser, LINK, {});
    await page.click("text=Cancelar y volver a iniciar sesión"); await page.waitForTimeout(200);
    eq("12 cancelar: sin PUT ni logout", log.filter((l) => l.m === "PUT" || l.path.endsWith("/logout")).length, 0);
    eq("12 cancelar: vuelve al login", (await texto(page)).includes("Ingresar"), true); await ctx.close(); }

  // 13. Sin conexión al validar.
  { const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.route("**/*", (r) => { const h = new URL(r.request().url()).hostname; return h === "127.0.0.1" ? r.continue() : r.abort("internetdisconnected"); });
    await page.goto(BASE + LINK); await page.waitForTimeout(800);
    eq("13 sin conexión: mensaje claro", (await texto(page)).includes("sin conexión con el servidor"), true); await ctx.close(); }
} finally { await browser.close(); }
console.log(`\n${ok} correctas, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
