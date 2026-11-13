// Prueba de interfaz: comisión ligada a la OC y a su liquidación original (13/11/2026), con Supabase SIMULADO.
// Uso: npx vite build && npx vite preview --port 4181 ; node docs/pruebas-comision-liquidacion/e2e_ui.mjs http://127.0.0.1:4181/ [celular|escritorio]
import { chromium } from "playwright-core";
const APP = process.argv[2] || "http://127.0.0.1:4181/";
const MODO = process.argv[3] || "celular";
const fac = (id, numero, fecha, monto, anula = null) => ({ id, oc_id: "", numero_factura: numero, fecha, monto, factura_anulada_numero: anula });
const oc = (id, venta, costo, facturas, extra = {}) => ({ id, numero_oc: id, cliente: "Cliente " + id, vendedor_id: "v1", tipo_registro: "venta", estado_compra: "comprado", estado_entrega: "confirmada", estado_factura_propia: "emitida",
  estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", monto_total: venta, costo_total: costo, monto_facturado: venta, monto_cobrado: 0, vendedor_pagado: false, financiador_id: "f1",
  creadoEn: "2026-01-01T00:00:00Z", vendedores: { nombre: "Vendedor Uno" }, financiadores: { nombre: "Financiador Uno" }, eventos_compra: [], eventos_entrega: [],
  eventos_factura: facturas, eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [], oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [], ...extra });
const T = {
  ordenes_compra_v2: [
    // J: pagada en junio y refacturada dos veces (agosto y octubre)
    oc("OC-J", 300000, 200000, [fac("j1", "100", "2026-06-10", 300000), fac("j2", "150", "2026-08-05", 300000, "100"), fac("j4", "190", "2026-10-07", 300000, "150")],
      { vendedor_pagado: true, comision_anio: 2026, comision_mes: 6 }),
    oc("OC-H", 100000, 60000, [fac("h1", "110", "2026-06-20", 100000)], { vendedor_pagado: true, comision_anio: 2026, comision_mes: 6 }),
    // Octubre: K normal y P con abono parcial, refacturada en diciembre
    oc("OC-K", 200000, 150000, [fac("k1", "191", "2026-10-09", 200000)]),
    oc("OC-P", 500000, 300000, [fac("p1", "200", "2026-10-15", 500000), fac("p3", "230", "2026-12-03", 500000, "200")]),
    // R: liquidación de mayo (planilla verificada), no marcada, refacturada en noviembre → por revisar en noviembre
    oc("OC-R", 200000, 100000, [fac("r1", "500", "2026-05-12", 200000), fac("r2", "510", "2026-11-02", 200000, "500")]),
    oc("OC-M", 900000, 0, [fac("m1", "501", "2026-05-20", 900000)]),
    oc("OC-N", 300000, 200000, [fac("n1", "520", "2026-11-05", 300000)]),
  ],
  iva_mensual: [{ id: "i6", anio: 2026, mes: 6, iva_ventas: 0, iva_compras: 0, iva_pagado: 0 },
    { id: "i10", anio: 2026, mes: 10, iva_ventas: 0, iva_compras: 0, iva_pagado: 0, desglose_f29: true, remanente_anterior: 0, ppm: 0, otras_retenciones: 0 }],
  perfiles: [{ id: "u1", nombre: "Admin", rol: "admin", email: "a@a.cl" }], vendedores: [{ id: "v1", nombre: "Vendedor Uno", comision_pct: 10 }],
  financiadores: [{ id: "f1", nombre: "Financiador Uno", saldo_deuda: 0 }], gastos_indirectos: [], categorias_gasto: [],
  pagos_vendedor: [{ id: "pv6", vendedor_id: "v1", anio: 2026, mes: 6, monto_pagado: 70000, monto_transferido: 70000, monto_extra_gestion: 0, fecha: "2026-07-02", estado: "pagado" },
    { id: "pv10", vendedor_id: "v1", anio: 2026, mes: 10, monto_pagado: 40000, monto_transferido: 40000, monto_extra_gestion: 0, fecha: "2026-11-02", estado: "pagado" },
    { id: "pv5", vendedor_id: "v1", anio: 2026, mes: 5, monto_pagado: 450000, monto_verificado: 450000, fecha: "2026-05-31", estado: "pagado" }],
};
const res = {}; const escr = []; const errs = [];
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext(MODO === "celular" ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Santiago" } : { viewport: { width: 1440, height: 900 }, timezoneId: "America/Santiago" });
const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
page.on("dialog", (d) => d.accept());
await page.clock.setFixedTime(new Date("2026-11-13T11:00:00-03:00"));
await page.route("**/*", async (route) => { const u = new URL(route.request().url()); const m = route.request().method();
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
  if (u.hostname.endsWith("supabase.co")) {
    if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" } } });
    if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: "u1", email: "a@a.cl" } });
    if (u.pathname.includes("/rpc/")) return route.fulfill({ json: true });
    const t = u.pathname.split("/").pop();
    if (m !== "GET") { const body = route.request().postDataJSON(); escr.push({ m, t, q: u.search, body });
      if (m === "POST" && T[t]) { if (T[t].some((r) => r.id === body.id)) return route.fulfill({ status: 409, json: { code: "23505", message: "duplicate key value violates unique constraint" } }); T[t].push(body); }
      if (m === "PATCH" && T[t]) { const id = u.searchParams.get("id")?.replace("eq.", ""); T[t] = T[t].map((r) => (r.id === id ? { ...r, ...body } : r)); }
      return route.fulfill({ json: [body] }); }
    return route.fulfill({ json: JSON.parse(JSON.stringify(T[t] || [])) }); }
  if (/fonts\.(googleapis|gstatic)\.com|cdnjs|jsdelivr/.test(u.hostname)) return route.continue();
  return route.abort(); });
await page.addInitScript(() => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1", email: "a@a.cl" } })); });
await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(2000);
const ir = async (r) => { await page.evaluate((x) => { location.hash = "#/" + x; }, r); await page.waitForTimeout(900); };
const foto = async (n) => { if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/liq-${MODO}-${n}.png` }); };
const bloque = async (etiqueta) => { const bt = await page.evaluate(() => document.body.innerText); const ini = Math.max(0, bt.search(/comisión mes a mes/i));
  const m = bt.slice(ini).search(new RegExp("(^|\\n)" + etiqueta.replace("/", "\\/") + "\\n")); const i0 = m < 0 ? -1 : ini + m + 1;
  return i0 < 0 ? "" : bt.slice(i0, bt.indexOf("Comisión pagada:", i0) + 120); };
await ir("vendedores");
await page.getByText("Vendedor Uno").first().click(); await page.waitForTimeout(900);
const oct = await bloque("Oct/2026"), jun = await bloque("Jun/2026"), ago = await bloque("Ago/2026"), dic = await bloque("Dic/2026"), nov = await bloque("Nov/2026");
// Junio (anterior a octubre): conserva su pago ($70.000) y su cálculo de siempre; J sigue apareciendo como pagada en esa liquidación.
res.junio_conserva_pago = /Comisión pagada: \$70\.000/.test(jun) && /Pagadas en esta liquidación y refacturadas después.*OC-J/.test(jun);
// Octubre: K + P con abono parcial; J no genera comisión.
res.octubre_sin_J = /= Comisión del mes: \$125\.000/.test(oct) && /OC-J → Jun\/2026 \(ya pagada\)/.test(oct);
res.octubre_parcial_saldo = /Comisión pagada: \$40\.000/.test(oct) && /Falta pagarle: \$85\.000/.test(oct);
res.agosto_y_diciembre_sin_comision = ago === "" && dic === "";
res.noviembre_por_revisar = /Por revisar · OC OC-R/.test(nov) && /No se incluye en esta comisión ni en ningún pago/.test(nov) && /= Comisión del mes: \$50\.000/.test(nov);
await page.locator('[data-liquidadas-aqui]').first().scrollIntoViewIfNeeded().catch(() => {}); await foto("1-junio");
// Pago de octubre: comisión $25.000, aviso de la refacturada, sin marcar J.
await page.locator('[data-pagar-mes="v1|2026|10"]').click().catch(() => {}); await page.waitForTimeout(500);
const formTxt = (await page.locator("[data-form-pago-vendedor]").count()) ? await page.locator("[data-form-pago-vendedor]").innerText() : "";
res.pago_octubre_comision = /\$125\.000/.test(formTxt) && /\$85\.000/.test(formTxt);
res.pago_octubre_aviso = (await page.locator("[data-aviso-refacturadas]").count()) === 1 && /OC-J → Jun\/2026 \(ya pagada\)/.test(formTxt);
await foto("2-pago-octubre");
await page.locator('[role="dialog"] button[aria-label="Cerrar"]').last().click().catch(() => {}); await page.waitForTimeout(300);
// Revisión de R (administrador): «no estaba pagada».
const antes = escr.length;
await page.locator('[data-revisada-pendiente="OC-R"]').click(); await page.waitForTimeout(1200);
const w = escr.slice(antes).find((e) => e.t === "ordenes_compra_v2");
res.revision_registrada = !!w && w.m === "PATCH" && w.body.comision_revision === "revisada" && /no estaba pagada/.test(w.body.comision_revision_motivo) && !("vendedor_pagado" in w.body);
res.errores = errs;
const claves = Object.keys(res).filter((k) => typeof res[k] === "boolean"); const fallas = claves.filter((k) => !res[k]);
console.log(JSON.stringify({ ...res, oct, jun, nov }, null, 1).slice(0, 3000));
console.log(`RESUMEN interfaz liquidación de comisión (${MODO}): ${claves.length - fallas.length} OK, ${fallas.length + (errs.length ? 1 : 0)} FALLA(S)${fallas.length ? " → " + fallas.join(", ") : ""}`);
await browser.close(); if (fallas.length || errs.length) process.exitCode = 1;
