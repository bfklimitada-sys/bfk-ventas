// Inicio de sesión de BFK Datos (incidente 15/11/2026) — navegador real, Supabase SIMULADO (nada sale a la red; ninguna cuenta real).
// Comprueba: ingreso válido (admin y usuario, con sus permisos), credenciales incorrectas, servicio restringido (402
// exceed_egress_quota, la respuesta real observada en producción), servidor caído (5xx), sin conexión, persistencia de la sesión
// al recargar, que un 402 al renovar NO cierra la sesión, cierre de sesión, recuperación de contraseña y celular tipo iPhone.
// Uso: node docs/pruebas-ingreso/e2e_ingreso.mjs http://127.0.0.1:4330/        (también contra la versión publicada)
//      MOTOR=webkit → Safari (WebKit) con el perfil de iPhone para TODOS los casos; por omisión Chromium (+ un caso con perfil iPhone).
process.env.JWT_SECRET ||= "secreto-de-prueba-solo-local-0123456789abcdef";
const { crearAuth } = await import("../pruebas-ventas-privadas/arnes_vp.mjs");
const { crearBase, CHROME } = await import("../pruebas-oc/mock_estado.mjs");
const { crearDatos } = await import("../pruebas-oc/datos_oc.mjs");
const pw = await import("playwright-core");
const { MENSAJE_CREDENCIALES, MENSAJE_SERVICIO_RESTRINGIDO, MENSAJE_SERVIDOR, MENSAJE_SIN_CONEXION } = await import("../../src/lib/errorServicio.js");

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/"; const HOST_APP = new URL(URL_APP).hostname;
const MOTOR = process.env.MOTOR === "webkit" ? "webkit" : "chromium";
const LLAVE = "bfk_supabase_session_v2"; const CLAVE = "clave-correcta"; // clave de la cuenta SIMULADA (no es una contraseña real)
const IPHONE = pw.devices["iPhone 13"];
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 500)); } };
const cuerpo = (p) => p.locator("body").innerText().catch(() => "");
const ve = async (p, re, ms = 9000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await cuerpo(p))) return true; await p.waitForTimeout(120); } return false; };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RESTRINGIDO = { message: "Service for this project is restricted due to the following violations: exceed_egress_quota. The project owner must upgrade their plan or remove spend caps to restore service." };

const browser = MOTOR === "webkit" ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: CHROME });

async function abrir({ movil = MOTOR === "webkit" } = {}) {
  const A = crearAuth({ usuarios: ["u1", "u2"], clave: CLAVE }); const b = crearBase(crearDatos(), {});
  const S = { modoIngreso: "ok", modoRenovar: "ok", modoRecuperar: "ok", modoRest: "ok", pedidos: [], consola: [] };
  const ctx = await browser.newContext(movil ? { ...IPHONE, timezoneId: "America/Santiago" } : { viewport: { width: 1280, height: 900 }, timezoneId: "America/Santiago" });
  const p = await ctx.newPage(); p.setDefaultTimeout(9000);
  p.on("console", (m) => S.consola.push(m.text())); p.on("dialog", (d) => d.accept());
  await p.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname === HOST_APP) {
      if (u.pathname.startsWith("/api/oc")) { const r = b.respuestaMP(u); return route.fulfill({ status: r.status, json: r.body }); }
      if (u.pathname.startsWith("/api/")) return route.fulfill({ json: {} });
      return route.continue();
    }
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    let c = null; try { c = JSON.parse(req.postData() || "null"); } catch {}
    const yo = A.datos(req.headers().authorization)?.sub || null;
    S.pedidos.push({ m, ruta: u.pathname, g: u.searchParams.get("grant_type"), cuerpo: c, q: u.search });
    if (u.pathname.endsWith("/auth/v1/token")) {
      const g = u.searchParams.get("grant_type"); const modo = g === "password" ? S.modoIngreso : S.modoRenovar;
      if (modo === "red") return route.abort("failed");
      if (modo === "402") return route.fulfill({ status: 402, json: RESTRINGIDO });
      if (modo === "500") return route.fulfill({ status: 503, contentType: "text/html", body: "<html>Service Unavailable</html>" });
      const r = A.responder(u, c); return route.fulfill({ status: r.status, json: r.json });
    }
    if (u.pathname.endsWith("/auth/v1/recover")) {
      if (S.modoRecuperar === "402") return route.fulfill({ status: 402, json: RESTRINGIDO });
      return route.fulfill({ json: {} });
    }
    if (u.pathname.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204, body: "" });
    if (u.pathname.endsWith("/auth/v1/user")) return yo ? route.fulfill({ json: A.usuario(yo) }) : route.fulfill({ status: 401, json: { msg: "invalid JWT" } });
    if (S.modoRest === "402") return route.fulfill({ status: 402, json: RESTRINGIDO });
    if (!yo || A.vencido(req.headers().authorization)) return route.fulfill({ status: 401, json: { code: "PGRST301", message: "JWT expired" } });
    if (u.pathname.includes("/rest/v1/rpc/")) { const r = b.rpc(u.pathname.split("/").pop(), c || {}, yo); return route.fulfill({ status: r.status, json: r.json }); }
    const tabla = u.pathname.split("/").pop();
    if (m === "GET") return route.fulfill({ json: b.leer(tabla, u.searchParams) });
    const r = b.escribir(m, tabla, u.searchParams, c, yo); return route.fulfill({ status: r.status, json: r.json });
  });
  await p.goto(URL_APP); await p.locator('input[type="email"]').waitFor();
  return { A, S, ctx, p };
}
const ingresar = async (p, correo, clave) => {
  await p.locator('input[type="email"]').fill(correo); await p.locator('input[type="password"]').fill(clave);
  await p.getByRole("button", { name: "Ingresar", exact: true }).click();
};
const enApp = (p) => p.locator('[data-nav]').first().waitFor({ timeout: 12000 }).then(() => true, () => false);
const guardada = (p) => p.evaluate((k) => localStorage.getItem(k), LLAVE);
const sinSecretos = (S, x) => !S.consola.some((t) => t.includes(CLAVE) || /access_token|refresh_token|eyJ[\w-]{10,}\./.test(t)) && !String(x || "").includes(CLAVE);

// 1–4 · Administrador: ingreso, permisos, persistencia, 402 al renovar, cierre de sesión.
{
  const { S, ctx, p } = await abrir();
  await ingresar(p, "  u1@prueba.cl ", CLAVE);
  ok(`[${MOTOR}] Ingreso válido (admin) abre la app`, await enApp(p), await cuerpo(p));
  ok("Admin ve Administración", await p.locator('[data-nav="usuarios"]').count() > 0 || await p.locator('[data-nav="mas"]').count() > 0);
  const pw0 = S.pedidos.find((x) => x.g === "password");
  ok("Se envía el correo sin espacios", pw0?.cuerpo?.email === "u1@prueba.cl");
  const g = await guardada(p);
  ok("Sesión guardada sin la contraseña", !!g && !g.includes(CLAVE));
  await p.reload();
  ok("Persistencia: al recargar sigue dentro (sin pedir contraseña)", await enApp(p) && S.pedidos.filter((x) => x.g === "password").length === 1);
  S.modoRenovar = "402";
  const r402 = await p.evaluate(() => window.__bfkSesion.renovarAhora().then(() => "ok", (e) => "error:" + e.message));
  const e402 = await p.evaluate(() => window.__bfkSesion.estado());
  ok("402 al renovar: falla informada como servicio restringido", r402 === "error:" + MENSAJE_SERVICIO_RESTRINGIDO, r402);
  ok("402 al renovar NO vence ni cierra la sesión", e402.estado === "vigente" && !!(await guardada(p)), JSON.stringify(e402));
  ok("402 al renovar: no se muestra la pantalla de ingreso", (await p.locator('input[type="password"]').count()) === 0);
  S.modoRenovar = "ok";
  const r2 = await p.evaluate(() => window.__bfkSesion.renovarAhora().then((e) => e.estado, (e) => "error:" + e.message));
  ok("Servicio restablecido: la misma sesión se renueva sola", r2 === "vigente", r2);
  // Cierre de sesión
  if (await p.locator('[data-nav="salir"]').isVisible().catch(() => false)) await p.locator('[data-nav="salir"]').click();
  else { await p.locator('[data-nav="mas"]').click(); await p.locator('[data-nav="salir"]').click(); }
  await p.locator('input[type="password"]').waitFor().catch(() => {});
  ok("Cerrar sesión vuelve a la pantalla de ingreso y borra la sesión local", (await p.locator('input[type="password"]').count()) === 1 && !(await guardada(p)));
  ok("Cerrar sesión avisa al servidor", S.pedidos.some((x) => x.ruta.endsWith("/auth/v1/logout")));
  ok("Ni la contraseña ni tokens aparecen en la consola", sinSecretos(S));
  await ctx.close();
}
// 5 · Usuario (rol «usuario»): entra, sin Administración.
{
  const { ctx, p } = await abrir();
  await ingresar(p, "u2@prueba.cl", CLAVE);
  ok("Ingreso válido (usuario) abre la app", await enApp(p), await cuerpo(p));
  if (await p.locator('[data-nav="mas"]').isVisible().catch(() => false)) await p.locator('[data-nav="mas"]').click();
  ok("Usuario NO ve Administración", (await p.locator('[data-nav="usuarios"]').count()) === 0);
  await ctx.close();
}
// 6–9 · Fallas: cada una con su mensaje; ninguna deja sesión guardada ni muestra el genérico «Error al ingresar».
for (const [modo, clave, msg, nombre] of [["ok", "otra-clave", MENSAJE_CREDENCIALES, "Credenciales incorrectas"], ["402", CLAVE, MENSAJE_SERVICIO_RESTRINGIDO, "Servicio restringido (402 exceed_egress_quota)"],
  ["500", CLAVE, MENSAJE_SERVIDOR, "Servidor no disponible (503 HTML)"], ["red", CLAVE, MENSAJE_SIN_CONEXION, "Sin conexión"]]) {
  const { S, ctx, p } = await abrir(); S.modoIngreso = modo;
  await ingresar(p, "u1@prueba.cl", clave);
  const visto = await ve(p, new RegExp(esc(msg)));
  ok(`${nombre}: mensaje propio`, visto, await cuerpo(p));
  ok(`${nombre}: sigue en el ingreso, sin sesión guardada`, (await p.locator('input[type="password"]').count()) === 1 && !(await guardada(p)));
  ok(`${nombre}: sin «Error al ingresar» ni detalle interno`, !/Error al ingresar|egress|spend cap|supabase/i.test(await cuerpo(p)));
  ok(`${nombre}: el botón vuelve a quedar disponible`, await p.getByRole("button", { name: "Ingresar", exact: true }).isEnabled());
  await ctx.close();
}
// 10 · Credenciales rechazadas y luego correctas en el mismo formulario.
{
  const { ctx, p } = await abrir();
  await ingresar(p, "u1@prueba.cl", "otra-clave"); await ve(p, new RegExp(esc(MENSAJE_CREDENCIALES)));
  await p.locator('input[type="password"]').fill(CLAVE); await p.getByRole("button", { name: "Ingresar", exact: true }).click();
  ok("Tras un rechazo, la clave correcta entra", await enApp(p));
  await ctx.close();
}
// 11 · Recuperación de contraseña (correo de recuperación) y con el servicio restringido.
{
  const { S, ctx, p } = await abrir();
  await p.getByRole("button", { name: /Olvidaste/ }).click();
  await p.locator('input[type="email"]').fill("u1@prueba.cl"); await p.getByRole("button", { name: /Enviar correo de recuperación/ }).click();
  ok("Recuperación: confirma el envío", await ve(p, /recibirás un enlace/));
  const rec = S.pedidos.find((x) => x.ruta.endsWith("/auth/v1/recover"));
  ok("Recuperación: vuelve a la dirección de producción", !!rec && decodeURIComponent(rec.q).includes("https://bfk-ventas.vercel.app/?flujo=recuperacion") && rec.cuerpo?.email === "u1@prueba.cl");
  S.modoRecuperar = "402"; await p.getByRole("button", { name: /Enviar correo de recuperación/ }).click();
  ok("Recuperación con servicio restringido: mensaje propio", await ve(p, new RegExp(esc(MENSAJE_SERVICIO_RESTRINGIDO))));
  await ctx.close();
}
// 12 · Ingreso correcto pero la base restringida al comprobar el perfil: no entra y lo dice (no «HTTP 402»).
{
  const { S, ctx, p } = await abrir(); S.modoRest = "402";
  await ingresar(p, "u1@prueba.cl", CLAVE);
  ok("Perfil con servicio restringido: mensaje propio, sin mostrar datos", await ve(p, new RegExp(esc(MENSAJE_SERVICIO_RESTRINGIDO))) && (await p.locator('[data-nav="usuarios"]').count()) === 0, await cuerpo(p));
  await ctx.close();
}
// 13 · Celular tipo iPhone (en Chromium se emula el iPhone; con MOTOR=webkit todo lo anterior ya corrió en WebKit/Safari).
if (MOTOR === "chromium") {
  const { S, ctx, p } = await abrir({ movil: true });
  await ingresar(p, "u1@prueba.cl", CLAVE);
  ok("iPhone (emulado): ingreso válido", await enApp(p), await cuerpo(p));
  await p.reload(); ok("iPhone (emulado): persiste al recargar", await enApp(p));
  await p.locator('[data-nav="mas"]').click(); await p.locator('[data-nav="salir"]').click();
  ok("iPhone (emulado): cerrar sesión desde «Más»", await p.locator('input[type="password"]').waitFor().then(() => true, () => false) && !(await guardada(p)));
  S.modoIngreso = "402"; await ingresar(p, "u1@prueba.cl", CLAVE);
  ok("iPhone (emulado): 402 muestra servicio restringido", await ve(p, new RegExp(esc(MENSAJE_SERVICIO_RESTRINGIDO))));
  await ctx.close();
}
await browser.close();
console.log(`\n[${MOTOR}] ${nOk} OK, ${F.length} fallas${F.length ? ": " + F.join(" | ") : ""}`); process.exit(F.length ? 1 : 0);
