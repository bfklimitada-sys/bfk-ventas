// Correos de reclamo y avisos (14/10/2026): en PC se abre la redacción de Gmail (pestaña nueva, cuenta
// bfklimitada@gmail.com) con todo completado; nada se envía ni se registra hasta que el usuario confirma.
// Supabase simulado (nada sale a la red). Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_correos.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { construirGmail, construirMailto, CUENTA_REMITENTE } from "../../src/lib/correos.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

// ── Unitarias: enlaces ──
{
  const d = { correo: " pagos@muni.cl ", cc: "a@x.cl; b@y.cl", asunto: "OC 1-1-SE26 — Consulta por pago factura N°55", cuerpo: "Estimados,\n\nLínea 2 & más: 100% ñ\nBanco Estado" };
  const g = new URL(construirGmail(d));
  ok("U1_gmail_redaccion_con_cuenta_prevista", g.origin === "https://mail.google.com" && g.searchParams.get("view") === "cm" && g.searchParams.get("authuser") === CUENTA_REMITENTE);
  ok("U2_gmail_completa_todo_sin_alterar", g.searchParams.get("to") === "pagos@muni.cl" && g.searchParams.get("cc") === "a@x.cl,b@y.cl" && g.searchParams.get("su") === d.asunto && g.searchParams.get("body") === d.cuerpo, Object.fromEntries(g.searchParams));
  const m = construirMailto(d);
  ok("U3_mailto_telefono_se_mantiene", m.startsWith("mailto:pagos%40muni.cl?cc=") && decodeURIComponent(m.split("body=")[1]) === d.cuerpo);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const escrituras = (b, n) => b.escr.slice(n).filter((w) => ["oc_reclamos", "historial_cambios", "ordenes_compra_v2", "contactos_clientes"].includes(w.tabla));
async function abrirOC(p, numero) {
  await p.locator('aside [data-nav="compras"], [data-nav="compras"]').first().click(); await espera(p, 900);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
const irSeccion = async (p, titulo) => { await p.locator("[data-indice-ficha] button", { hasText: titulo }).first().click(); await espera(p, 450); };

// ═════ A. Computador: reclamo de pago ═════
{
  const b = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2500 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(URL_APP).origin });
  await ctx.route("https://mail.google.com/**", (r) => r.fulfill({ body: "<html><title>Gmail</title>Gmail simulado</html>", contentType: "text/html" }));
  await abrirOC(p, "2002-102-SE26"); await irSeccion(p, "Cobranza");
  await p.getByRole("button", { name: /Reclamar pago de factura/ }).first().click(); await espera(p);
  const modal = p.locator('[role="dialog"]').last();
  ok("A01_boton_dice_abrir_en_gmail", /Abrir en Gmail/.test(await modal.locator("[data-abrir-correo]").innerText()) && new RegExp(CUENTA_REMITENTE).test(await modal.innerText()));
  const inputs = modal.locator("input");
  await inputs.nth(1).fill("Municipalidad de Prueba"); await inputs.nth(2).fill("pagos@muni.cl"); await inputs.nth(3).fill("jefatura@muni.cl");
  const asunto = (await modal.innerText()).match(/OC 2002-102-SE26 — Consulta por pago factura N°\S*/)?.[0];
  const n0 = b.escr.length;
  const [pop] = await Promise.all([ctx.waitForEvent("page"), modal.locator("[data-abrir-correo]").click()]);
  await pop.waitForLoadState().catch(() => {});
  const u = new URL(pop.url());
  ok("A02_abre_redaccion_gmail_en_pestana_nueva", u.host === "mail.google.com" && u.searchParams.get("view") === "cm" && u.searchParams.get("authuser") === CUENTA_REMITENTE, pop.url());
  ok("A03_completa_destinatario_cc_asunto_cuerpo", u.searchParams.get("to") === "pagos@muni.cl" && u.searchParams.get("cc") === "jefatura@muni.cl" && u.searchParams.get("su") === asunto && /no hemos recibido el comprobante de pago/.test(u.searchParams.get("body")) && /Orden de Compra 2002-102-SE26/.test(u.searchParams.get("body")) && /Chequera Electrónica: 54970259913/.test(u.searchParams.get("body")), Object.fromEntries(u.searchParams));
  ok("A04_bfk_sigue_abierto", !p.isClosed() && p.url().startsWith(URL_APP) && await modal.isVisible());
  ok("A05_estado_correo_preparado_no_enviado", (await modal.locator("[data-correo-estado]").getAttribute("data-correo-estado")) === "preparado" && /aún no registrado como enviado/.test(await modal.innerText()));
  ok("A06_abrir_no_registra_nada", escrituras(b, n0).length === 0, escrituras(b, n0));
  // Reabrir varias veces tampoco registra.
  const [pop2] = await Promise.all([ctx.waitForEvent("page"), modal.locator("[data-reabrir-gmail]").click()]); await pop2.close();
  await pop.close();
  ok("A07_reabrir_no_duplica_ni_registra", escrituras(b, n0).length === 0);
  // Alternativa visible: copiar.
  await modal.locator('[data-copiar-correo="para"]').click(); await espera(p, 200);
  const c1 = await p.evaluate(() => navigator.clipboard.readText());
  await modal.locator('[data-copiar-correo="cuerpo"]').click(); await espera(p, 200);
  const c2 = await p.evaluate(() => navigator.clipboard.readText());
  await modal.locator('[data-copiar-correo="asunto"]').click(); await espera(p, 200);
  const c3 = await p.evaluate(() => navigator.clipboard.readText());
  ok("A08_copiar_destinatario_asunto_cuerpo", c1 === "pagos@muni.cl" && c3 === asunto && /Datos para transferencia/.test(c2) && (await modal.locator('[data-copiar-correo="cc"]').count()) === 1);
  // Confirmar: una sola vez aunque se toque varias veces.
  const btn = modal.locator("[data-confirmar-envio]");
  await btn.evaluate((b) => { b.click(); b.click(); b.click(); }); // tres toques seguidos antes de que la pantalla cambie
  await espera(p, 2000);
  const w = escrituras(b, n0);
  ok("A09_confirmar_registra_un_solo_reclamo", w.filter((x) => x.tabla === "oc_reclamos" && x.metodo === "POST").length === 1 && w.filter((x) => x.tabla === "historial_cambios" && /Correo enviado \(confirmado por el usuario\): reclamo de pago/.test(x.cuerpo?.accion || "")).length === 1, w.map((x) => [x.metodo, x.tabla, x.cuerpo?.accion]));
  ok("A10_reclamo_con_datos_de_factura_y_oc", w.some((x) => x.tabla === "ordenes_compra_v2" && x.cuerpo?.ultimo_reclamo_fecha && x.cuerpo?.correo_cliente === "pagos@muni.cl") && w.some((x) => x.tabla === "oc_reclamos" && x.cuerpo?.cc === "jefatura@muni.cl" && x.cuerpo?.oc_numero === "2002-102-SE26"));
  ok("A11_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ B. Computador: Gmail bloqueado por el navegador → alternativa de copiar; otros botones de correo ═════
{
  const b = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2500 });
  await p.evaluate(() => { window.open = () => null; });
  await abrirOC(p, "2002-102-SE26"); await irSeccion(p, "Entrega");
  await p.getByRole("button", { name: /Entrega fallida/ }).first().click(); await espera(p);
  const modal = p.locator('[role="dialog"]').last();
  await modal.locator('input[type="email"]').fill("bodega@muni.cl");
  const n0 = b.escr.length;
  await modal.locator("[data-abrir-correo]").click(); await espera(p, 400);
  ok("B01_bloqueo_muestra_alternativa_copiar", await modal.locator("[data-correo-bloqueado]").isVisible() && (await modal.locator("[data-copiar-correo]").count()) >= 3);
  ok("B02_sin_registro_al_preparar", escrituras(b, n0).length === 0);
  await modal.locator("[data-confirmar-envio]").click(); await espera(p, 1500);
  const w = escrituras(b, n0);
  ok("B03_entrega_fallida_registra_solo_al_confirmar", w.filter((x) => x.tabla === "historial_cambios" && /Correo enviado \(confirmado por el usuario\): entrega fallida/.test(x.cuerpo?.accion || "")).length === 1, w.map((x) => [x.tabla, x.cuerpo?.accion]));
  // Fecha de entrega: cerrar sin confirmar no deja nada registrado.
  await p.getByRole("button", { name: /Fecha de entrega/ }).first().click(); await espera(p);
  const m2 = p.locator('[role="dialog"]').last();
  await m2.locator('input[type="email"]').fill("bodega@muni.cl"); await m2.locator('input[type="date"]').fill("2026-10-20");
  const n1 = b.escr.length;
  await m2.locator("[data-abrir-correo]").click(); await espera(p, 300);
  await p.keyboard.press("Escape"); await m2.locator('button[aria-label="Cerrar"]').click().catch(() => {}); await espera(p, 500);
  ok("B04_cerrar_sin_confirmar_no_registra", escrituras(b, n1).length === 0);
  ok("B05_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ C. iPhone: se mantiene la app de correo (mailto) ═════
{
  const b = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, ua: UA_IPHONE, espera: 2500 });
  await p.evaluate(() => { window.__abiertos = []; const o = window.open; window.open = (...a) => { window.__abiertos.push(a[0]); return null; }; });
  await p.locator('[data-nav="compras"]').first().click(); await espera(p, 900);
  await p.locator('[data-oc="2002-102-SE26"] > div').first().click(); await espera(p, 1300);
  await irSeccion(p, "Cobranza");
  await p.getByRole("button", { name: /Reclamar pago de factura/ }).first().click(); await espera(p);
  const modal = p.locator('[role="dialog"]').last();
  ok("C01_telefono_ofrece_app_de_correo", /Abrir en la app de correo/.test(await modal.locator("[data-abrir-correo]").innerText()));
  const inputs = modal.locator("input");
  await inputs.nth(1).fill("Municipalidad de Prueba"); await inputs.nth(2).fill("pagos@muni.cl");
  const n0 = b.escr.length;
  const nav = [];
  p.on("request", (r) => { if (r.url().startsWith("mailto:")) nav.push(r.url()); });
  await modal.locator("[data-abrir-correo]").click(); await espera(p, 600);
  ok("C02_telefono_no_abre_gmail_web_y_prepara", (await p.evaluate(() => window.__abiertos.length)) === 0 && (await modal.locator("[data-correo-estado]").getAttribute("data-correo-estado")) === "preparado" && escrituras(b, n0).length === 0);
  ok("C03_sin_errores", !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
