// Inteligencia Comercial DESACTIVADA (06/11/2026): prueba de interfaz en escritorio y celular. Supabase y las funciones
// /api/* SIMULADAS (nada sale a la red). Cuenta TODAS las solicitudes del navegador y comprueba que iniciar sesión,
// abrir Inicio, navegar, recargar y abrir Administración no llaman a /api/inteligencia, a ChileCompra ni a ningún
// proveedor de IA, no descargan el módulo y no leen datos ic_ (salvo el estado del interruptor al elegir su pestaña).
// Uso: node docs/pruebas-inteligencia/e2e_ic_desactivada.mjs http://127.0.0.1:4302/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4302/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);

// Registro de TODA solicitud del navegador (incluidas las que el simulador general atiende).
function contar(page) {
  const c = { todas: [], api_ic: [], chilecompra: [], ia: [], interpretar: [], modulo_ic: [], rpc_ic: [], interruptor: [], cambiar: [] };
  page.on("request", (r) => {
    const u = r.url(); c.todas.push(u);
    if (/\/api\/inteligencia/.test(u)) c.api_ic.push(u);
    if (/mercadopublico\.cl/.test(u)) c.chilecompra.push(u);
    if (/anthropic\.com|openai\.com|generativelanguage/.test(u)) c.ia.push(u);
    if (/\/api\/interpretar/.test(u)) c.interpretar.push(u);
    if (/InteligenciaComercial-|Graficos-/.test(u)) c.modulo_ic.push(u);
    if (/\/rpc\/ic_interruptor_estado/.test(u)) c.interruptor.push(u);
    else if (/\/rpc\/ic_cambiar_interruptor/.test(u)) c.cambiar.push(u);
    else if (/\/rpc\/ic_|\/rest\/v1\/ic_/.test(u)) c.rpc_ic.push(u);
  });
  return c;
}
// Estado de producción hoy: las funciones del interruptor NO existen (404) y el servidor responde 423 a /api/inteligencia.
async function rutas(page, est) {
  await page.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname.endsWith("/api/inteligencia")) return route.fulfill({ status: 423, json: { ok: false, codigo: "IC_DESACTIVADA", error: "Inteligencia Comercial está desactivada." } });
    if (!u.hostname.endsWith("supabase.co")) return route.fallback();
    const fn = u.pathname.includes("/rpc/") ? u.pathname.split("/").pop() : null;
    if (fn === "ic_interruptor_estado") return est.interruptor === "ausente"
      ? route.fulfill({ status: 404, json: { code: "PGRST202", message: "Could not find the function public.ic_interruptor_estado" } })
      : route.fulfill({ json: est.interruptor });
    if (fn === "ic_cambiar_interruptor") return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Could not find the function public.ic_cambiar_interruptor" } });
    if (fn && fn.startsWith("ic_")) return route.fulfill({ status: 500, json: { message: "no debería llamarse" } });
    return route.fallback();
  });
}
const sinConsumo = (c) => c.api_ic.length === 0 && c.chilecompra.length === 0 && c.ia.length === 0 && c.interpretar.length === 0 && c.rpc_ic.length === 0;
const resumen = (c) => ({ api_ic: c.api_ic.length, chilecompra: c.chilecompra.length, ia: c.ia.length, interpretar: c.interpretar.length, modulo: c.modulo_ic.length, rpc_ic: c.rpc_ic, interruptor: c.interruptor.length });

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const vista of [{ n: "escritorio", ancho: 1280, alto: 900, movil: false }, { n: "celular", ancho: 390, alto: 844, movil: true }]) {
  const V = vista.n;
  for (const [interruptor, etq] of [["ausente", "funcion_ausente"], [{ habilitada: false }, "desactivada_explicita"], [{ habilitada: "true" }, "valor_invalido"]]) {
    const est = { interruptor }; const base = crearBase(crearDatos());
    // Iniciar sesión (sesión guardada) y abrir Inicio, como un administrador.
    const { page, errs, ctx } = await abrir(browser, base, { url: URL_APP, usuario: "u1", ancho: vista.ancho, alto: vista.alto, movil: vista.movil, espera: 0 });
    const c = contar(page); await rutas(page, est);
    await page.reload({ waitUntil: "load" }); await espera(page, 2500);
    ok(`${V}_${etq}_D01_inicio_carga`, !!(await page.$('[data-indicador="banco"]')));
    ok(`${V}_${etq}_D02_inicio_sin_IC`, !(await page.$('[data-desplegable="inteligencia"]')) && !/Inteligencia Comercial/.test(await page.textContent("main, body")));
    ok(`${V}_${etq}_D03_login_e_inicio_sin_consumo`, sinConsumo(c) && c.modulo_ic.length === 0 && c.interruptor.length === 0, resumen(c));
    // Navegar por la aplicación y volver a Inicio.
    for (const h of ["#/compras", "#/alertas", "#/agenda", "#/cotizaciones", "#/finanzas", "#/banco", "#/panel"]) { await page.evaluate((x) => { location.hash = x; }, h); await espera(page, 700); }
    ok(`${V}_${etq}_D04_navegacion_sin_consumo`, sinConsumo(c) && c.modulo_ic.length === 0 && c.interruptor.length === 0, resumen(c));
    // Recargar dos veces (nuevas sesiones de página).
    for (let i = 0; i < 2; i++) { await page.reload({ waitUntil: "load" }); await espera(page, 1800); }
    ok(`${V}_${etq}_D05_recargas_sin_consumo`, sinConsumo(c) && c.modulo_ic.length === 0, resumen(c));
    // Administración: abrir la página no lee nada de IC; elegir la pestaña lee SOLO el estado del interruptor.
    await page.evaluate(() => { location.hash = "#/administracion"; }); await page.waitForSelector('[data-tab="ic"]', { timeout: 10000 }); await espera(page, 600);
    ok(`${V}_${etq}_D06_administracion_sin_lecturas_IC`, c.interruptor.length === 0 && sinConsumo(c), resumen(c));
    await page.click('[data-tab="ic"]'); await page.waitForSelector("[data-ic-estado]", { timeout: 8000 }); await espera(page, 600);
    ok(`${V}_${etq}_D07_muestra_Desactivada`, (await page.getAttribute("[data-ic-estado]", "data-ic-estado")) === "desactivada" && /Desactivada/.test(await page.textContent("[data-ic-estado]")));
    ok(`${V}_${etq}_D08_una_sola_lectura_del_interruptor`, c.interruptor.length === 1, resumen(c));
    ok(`${V}_${etq}_D09_sin_boton_abrir_ni_modulo`, !(await page.$("[data-ic-abrir]")) && !(await page.$("[data-inteligencia]")) && c.modulo_ic.length === 0, resumen(c));
    if (interruptor === "ausente") ok(`${V}_${etq}_D10_informa_interruptor_no_instalado`, /no está instalado/.test(await page.textContent("[data-ic-admin]")));
    // Reactivar exige frase exacta y motivo; con la función ausente informa y sigue desactivada, sin consultar nada.
    await page.click("[data-ic-reactivar] summary"); await espera(page, 300);
    const btn = "[data-ic-confirmar-reactivar]";
    ok(`${V}_${etq}_D11_reactivar_bloqueado_sin_frase`, await page.$eval(btn, (b) => b.disabled));
    await page.fill("[data-ic-frase]", "reactivar"); await page.fill("[data-ic-motivo]", "prueba");
    ok(`${V}_${etq}_D12_reactivar_bloqueado_con_frase_incorrecta`, await page.$eval(btn, (b) => b.disabled));
    await page.fill("[data-ic-frase]", "REACTIVAR INTELIGENCIA COMERCIAL");
    ok(`${V}_${etq}_D13_reactivar_habilitado_con_frase_y_motivo`, !(await page.$eval(btn, (b) => b.disabled)));
    await page.click(btn); await page.waitForSelector('[data-aviso-linea="ic-admin-msj"]', { timeout: 8000 }); await espera(page, 700);
    ok(`${V}_${etq}_D14_sin_funcion_no_reactiva`, c.cambiar.length === 1 && /no está instalado/.test(await page.textContent('[data-aviso-linea="ic-admin-msj"]')) && (await page.getAttribute("[data-ic-estado]", "data-ic-estado")) === "desactivada");
    ok(`${V}_${etq}_D15_total_sin_consumo`, sinConsumo(c) && c.modulo_ic.length === 0, resumen(c));
    ok(`${V}_${etq}_D16_sin_desborde_horizontal`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    if (etq === "funcion_ausente") await page.screenshot({ path: `/tmp/ic-desactivada-${V}.png`, fullPage: false });
    ok(`${V}_${etq}_D17_sin_errores_de_pagina`, errs.length === 0, errs);
    await ctx.close();
  }
  // Usuario no administrador: no ve la pestaña ni consulta nada.
  {
    const est = { interruptor: "ausente" }; const base = crearBase(crearDatos());
    const { page, ctx } = await abrir(browser, base, { url: URL_APP, usuario: "u2", ancho: vista.ancho, alto: vista.alto, movil: vista.movil, espera: 0 });
    const c = contar(page); await rutas(page, est); await page.reload({ waitUntil: "load" }); await espera(page, 2000);
    await page.evaluate(() => { location.hash = "#/administracion"; }); await espera(page, 1000);
    ok(`${V}_D18_usuario_sin_pestana_ni_consumo`, !(await page.$('[data-tab="ic"]')) && sinConsumo(c) && c.interruptor.length === 0, resumen(c));
    await ctx.close();
  }
}
await browser.close();
console.log(`e2e_ic_desactivada: ${nOk}/${nOk + F.length} correctas`);
process.exit(F.length ? 1 : 0);
