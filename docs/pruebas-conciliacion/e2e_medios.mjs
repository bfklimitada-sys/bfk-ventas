// Smoke de interfaz (Supabase simulado): cobros por retención / fuera de banco no aparecen como vale vista
// pendiente, el formulario de cobro ofrece los medios nuevos y el Panel no suma esos montos a la caja.
// Uso: node docs/pruebas-conciliacion/e2e_medios.mjs http://127.0.0.1:4181/
import { chromium } from "playwright-core";
const APP = process.argv[2] || "http://127.0.0.1:4181/";
const oc = (i, cobros, extra = {}) => ({ id: "oc" + i, numero_oc: `TEST-${i}-AG26`, cliente: "CLIENTE " + i, rut_cliente: "69.200.800-6", vendedor_id: "v1",
  estado_compra: "comprado", estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", estado_pago_financiamiento: "no_aplica",
  monto_total: 400001, costo_total: 1, monto_facturado: 400001, monto_cobrado: 400001, monto_pagado_fin: 0, es_venta_propia: true, tipo_registro: "venta",
  creadoEn: "2026-08-01T00:00:00Z", fecha_emision_mp: "2026-08-01", vendedores: { nombre: "V" }, financiadores: null,
  eventos_compra: [], eventos_entrega: [{ id: "e" + i, fecha: "2026-08-02" }], eventos_factura: [{ id: "f" + i, oc_id: "oc" + i, fecha: "2026-08-03", numero_factura: String(900 + i), monto: 400001, tipo_dte: 33 }],
  eventos_pago_cliente: cobros, eventos_pago_financiamiento: [], eventos_postventa: [], oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], ...extra });
const T = { ordenes_compra_v2: [
    oc(1, [{ id: "c1", oc_id: "oc1", fecha: "2026-08-06", monto: 400001, medio_pago: "fuera_banco", cobrado_en_banco: false }], { tipo_registro: "externa" }),
    oc(2, [{ id: "c2", oc_id: "oc2", fecha: "2026-08-13", monto: 391297, medio_pago: "transferencia", cobrado_en_banco: true }, { id: "c3", oc_id: "oc2", fecha: "2026-08-13", monto: 8704, medio_pago: "retencion", cobrado_en_banco: false }]),
    oc(3, [{ id: "c4", oc_id: "oc3", fecha: "2026-08-20", monto: 400001, medio_pago: "vale_vista", cobrado_en_banco: false, institucion: "BancoEstado" }]) ],
  perfiles: [{ id: "u1", nombre: "Admin", rol: "admin" }], vendedores: [{ id: "v1", nombre: "V" }], financiadores: [], categorias_gasto: [], gastos_indirectos: [], iva_mensual: [], pagos_vendedor: [], aportes_socios: [] };
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Santiago" });
const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.route("**/*", (route) => { const u = new URL(route.request().url());
  if (u.hostname === "127.0.0.1") return route.continue();
  if (u.hostname.endsWith("supabase.co")) {
    if (u.pathname.includes("/auth/v1/")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" }, id: "u1" } });
    if (u.pathname.includes("/rpc/") || route.request().method() !== "GET") return route.fulfill({ json: [] });
    return route.fulfill({ json: JSON.parse(JSON.stringify(T[u.pathname.split("/").pop()] || [])) }); }
  return route.abort(); });
await page.addInitScript(() => localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1" } })));
await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);
const r = {};
await page.locator('[data-nav="notif"]').first().click(); await page.waitForTimeout(700);
const alertas = await page.locator("body").innerText();
r.solo_un_vale_vista_pendiente = (alertas.match(/sin cobrar en el banco/g) || []).length === 1 && alertas.includes("TEST-3-AG26");
r.retencion_y_externa_sin_alerta_vale_vista = !/TEST-1-AG26[\s\S]{0,80}sin cobrar|TEST-2-AG26[\s\S]{0,80}sin cobrar/.test(alertas);
await page.locator('[data-nav="panel"]').first().click(); await page.waitForTimeout(900);
const panel = await page.locator("body").innerText();
r.panel_caja_391297 = /\$391\.297/.test(panel);
r.panel_sin_400001_externo = !/fondos de ventas externas[^\n]*\$400\.001/i.test(panel);
r.sin_errores = errs.length === 0;
let falla = false; for (const [k, v] of Object.entries(r)) { console.log(`${v ? "OK   " : "FALLA"} ${k}`); if (!v) falla = true; }
if (!r.panel_caja_391297) console.log((panel.match(/Caja[^\n]*\n[^\n]*/g) || []).slice(0, 4));
await browser.close(); console.log(falla ? "RESULTADO: FALLA" : `RESULTADO: ${Object.keys(r).length} OK`); process.exit(falla ? 1 : 0);
