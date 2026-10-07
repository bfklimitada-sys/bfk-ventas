// Ficha de OC (expediente) y Facturación SII en escritorio y móvil, con Supabase simulado (sin datos reales).
// Requiere: npx vite build && npx vite preview --port 4178 ; playwright-core.
import { chromium } from "playwright-core";
const APP = "http://127.0.0.1:4178/";
const base = (i, extra) => ({ id: "oc" + i, numero_oc: `TEST-${i}-AG26`, cliente: "I MUNICIPALIDAD DE PRUEBA " + i, rut_cliente: "69.200.800-6", comuna: "La Unión", vendedor_id: "v1",
  estado_compra: "comprado", estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pagado",
  monto_total: 247000, costo_total: 150000, monto_facturado: 247000, monto_cobrado: 0, monto_pagado_fin: 150000, vendedor_pagado: false, financiador_id: "f1", es_venta_propia: false,
  creadoEn: "2026-06-01T00:00:00Z", fecha_emision_mp: "2026-06-01", vendedores: { nombre: "Vendedor Uno" }, financiadores: { nombre: "Financiador Uno" },
  eventos_compra: [{ id: "ec" + i, fecha: "2026-06-02", costo_compra: 150000, proveedor: "Proveedor X", financiador_id: "f1" }], eventos_entrega: [{ id: "ee" + i, fecha: "2026-06-03" }],
  eventos_pago_cliente: [], eventos_pago_financiamiento: [{ id: "pf" + i, fecha: "2026-06-20", monto: 150000, financiador_id: "f1" }], eventos_postventa: [],
  oc_productos_link: [{ id: "pl" + i, oc_id: "oc" + i, descripcion: "Producto A", cantidad: 2, precio_venta: 207563, orden: 0, origen: "venta" }, { id: "pc" + i, oc_id: "oc" + i, descripcion: "Producto A", cantidad: 2, precio_compra: 150000, proveedor: "Proveedor X", url: "sin-link", orden: 1, origen: "compra" }],
  oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [], ...extra });
const OCS = [
  base(1, { monto_cobrado: 247000, estado_pago_cliente: "pagado", eventos_pago_cliente: [{ id: "c1", fecha: "2026-08-05", monto: 247000 }],
    eventos_factura: [{ id: "f203", oc_id: "oc1", fecha: "2026-06-04", numero_factura: "203", monto: 247000, tipo_dte: 33, verificado_sii: true, origen: "sii_xml", rut_receptor: "69.200.800-6", evidencia_sii: "XML SII ref. 801" },
                      { id: "nc44", oc_id: "oc1", fecha: "2026-08-05", numero_factura: "44", monto: 0, tipo_dte: 61, ref_folio: "203", ref_codigo: 2, ref_motivo: "Corrección giro de factura 203", verificado_sii: true }] }),
  base(2, { eventos_factura: [{ id: "f100", oc_id: "oc2", fecha: "2026-06-04", numero_factura: "100", monto: 247000 }, { id: "n50", oc_id: "oc2", fecha: "2026-06-06", numero_factura: "50", monto: 247000, tipo_dte: 61, ref_folio: "100", ref_codigo: 1, ref_motivo: "Anula" },
                            { id: "f101", oc_id: "oc2", fecha: "2026-06-07", numero_factura: "101", monto: 247000 }] }),
  base(3, { monto_facturado: 228000, eventos_factura: [{ id: "f200", oc_id: "oc3", fecha: "2026-06-04", numero_factura: "200", monto: 247000 }, { id: "n60", oc_id: "oc3", fecha: "2026-06-08", numero_factura: "60", monto: 19000, tipo_dte: 61, ref_folio: "200", ref_codigo: 3, ref_motivo: "Descuento" }] }),
];
const TABLAS = () => ({ ordenes_compra_v2: JSON.parse(JSON.stringify(OCS)), perfiles: [{ id: "u1", nombre: "Admin", rol: "admin", email: "a@a.cl" }], vendedores: [{ id: "v1", nombre: "Vendedor Uno" }],
  financiadores: [{ id: "f1", nombre: "Financiador Uno", saldo_deuda: 0, tipo: "externo" }], categorias_gasto: [], gastos_indirectos: [], iva_mensual: [], pagos_vendedor: [] });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const res = {}; let falla = false;
for (const [modo, vp] of [["escritorio", { width: 1280, height: 900 }], ["movil", { width: 390, height: 844 }]]) {
  const T = TABLAS(); const escr = []; const errs = [];
  const ctx = await browser.newContext({ viewport: vp, isMobile: modo === "movil", hasTouch: modo === "movil", timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/*", async (route) => { const u = new URL(route.request().url()); const m = route.request().method();
    if (u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname.endsWith("supabase.co")) {
      if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" } } });
      if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: "u1" } });
      if (u.pathname.includes("/rpc/")) return route.fulfill({ json: { ok: true } });
      const t = u.pathname.split("/").pop();
      if (m !== "GET") { const body = route.request().postDataJSON(); escr.push({ m, t, body });
        if (m === "POST" && t === "eventos_factura") { const o = T.ordenes_compra_v2.find((x) => x.id === body.oc_id); o.eventos_factura.push(body); }
        return route.fulfill({ json: [body] }); }
      return route.fulfill({ json: JSON.parse(JSON.stringify(T[t] || [])) }); }
    return route.abort(); });
  await page.addInitScript(() => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1", email: "a@a.cl" } })); });
  await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);
  if (modo === "movil") { await page.getByText("Compras", { exact: true }).last().click(); } else { await page.getByText("Compras", { exact: true }).first().click(); }
  await page.waitForTimeout(900);
  const r = {};
  const abrir = async (n) => { await page.locator(`[data-oc="TEST-${n}-AG26"] > div`).first().click(); await page.waitForTimeout(900); };
  // OC 1: factura 203 + NC 44 código 2
  await abrir(1);
  const f = page.locator('[data-ficha-oc="TEST-1-AG26"]');
  r.cabecera = await f.locator("[data-ficha-cabecera]").count() === 1;
  r.resumen_6 = await f.locator("[data-resumen-financiero] [data-tile]").count() === 6;
  r.indice_8 = (await f.locator("[data-indice-ficha] button").count()) === 8;
  r.secciones_8 = (await f.locator("[data-seccion-ficha]").count()) === 8;
  if (modo === "movil") { r.movil_acordeon_cerrado = !(await f.locator('[data-seccion-ficha^="info-"] [data-ficha-pdf]').count()); }
  await f.locator("[data-indice-ficha] button", { hasText: "Facturación SII" }).click(); await page.waitForTimeout(600);
  const fact = f.locator("[data-facturacion-sii]");
  const tf = await fact.innerText();
  r.f203_vigente = (await fact.locator('[data-documento="Factura 203"]').getAttribute("data-estado")) === "vigente";
  r.nc44_texto = (await fact.locator('[data-documento="NC 44"]').getAttribute("data-estado")) === "nc_texto" && /Corrección de texto/.test(tf) && /Sin efecto monetario/.test(tf);
  r.verificada_sii = /Verificada SII/.test(tf);
  r.monto_trib_247000 = /Monto tributario vigente\s*\$247\.000/i.test(tf);
  r.cadena_orden = tf.indexOf("Factura 203") < tf.indexOf("NC 44");
  await f.locator('[data-seccion-ficha^="facturacion-"]').screenshot({ path: `${process.env.SALIDA || "."}/facturacion-${modo}.png` });
  // OC 2: código 1 + refacturación
  await abrir(1); await abrir(2);
  const f2 = page.locator('[data-ficha-oc="TEST-2-AG26"]');
  await f2.locator("[data-indice-ficha] button", { hasText: "Facturación SII" }).click(); await page.waitForTimeout(600);
  r.cod1_anulada = (await f2.locator('[data-documento="Factura 100"]').getAttribute("data-estado")) === "anulada"
    && (await f2.locator('[data-documento="Factura 101"]').getAttribute("data-estado")) === "vigente"
    && /Monto tributario vigente\s*\$247\.000/i.test(await f2.locator("[data-monto-tributario]").innerText());
  // Registrar NC código 3 desde la ficha (escritura simulada)
  await f2.locator('[data-accion="registrar-nc"]').click(); await page.waitForTimeout(500);
  const modal = page.locator("input[inputmode=numeric]").first(); await modal.fill("77");
  await page.getByText("Corrige montos", { exact: false }).first().click(); await page.waitForTimeout(200);
  await page.locator('input[type="number"]').last().fill("47000");
  await page.locator("input").filter({ hasNot: page.locator("x") }).last().fill("Descuento comercial");
  await page.getByText("✓ Registrar nota de crédito").click(); await page.waitForTimeout(1500);
  const nc = escr.find((e) => e.t === "eventos_factura");
  r.nc_registrada = !!nc && nc.body.tipo_dte === 61 && nc.body.ref_codigo === 3 && nc.body.monto === 47000 && nc.body.ref_folio === "101" && nc.body.numero_factura === "77";
  r.historial_nc = escr.some((e) => e.t === "historial_cambios" && /NC 77/.test(JSON.stringify(e.body)));
  // OC 3: código 3 (parcial)
  await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1500);
  if (modo === "movil") { await page.getByText("Compras", { exact: true }).last().click(); } else { await page.getByText("Compras", { exact: true }).first().click(); }
  await page.waitForTimeout(800); await abrir(3);
  const f3 = page.locator('[data-ficha-oc="TEST-3-AG26"]');
  await f3.locator("[data-indice-ficha] button", { hasText: "Facturación SII" }).click(); await page.waitForTimeout(600);
  r.cod3_parcial = (await f3.locator('[data-documento="NC 60"]').getAttribute("data-estado")) === "nc_monto" && /Monto tributario vigente\s*\$228\.000/i.test(await f3.locator("[data-monto-tributario]").innerText());
  await f3.locator("[data-indice-ficha] button", { hasText: "Cobranza" }).click(); await page.waitForTimeout(500);
  r.cabecera_fija_visible_al_bajar = await f3.locator("[data-ficha-cabecera]").evaluate((el) => {
    const r = el.getBoundingClientRect(); const h = [...document.querySelectorAll("header")].find((x) => getComputedStyle(x).position === "sticky");
    const tope = h ? h.getBoundingClientRect().bottom : 0; return window.scrollY > 200 && Math.abs(r.top - tope) <= 2;
  });
  r.cobranza_desde_tributario = /Por cobrar\s*\$228\.000/i.test(await f3.locator("[data-cobranza-ficha]").innerText());
  r.sin_desborde_horizontal = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  await page.screenshot({ path: `${process.env.SALIDA || "."}/ficha-${modo}.png`, fullPage: false });
  r.errores = errs;
  res[modo] = r;
  for (const [k, v] of Object.entries(r)) if (k !== "errores" && v !== true) falla = true;
  if (errs.length) falla = true;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(res, null, 1));
console.log(falla ? "RESUMEN e2e ficha SII: FALLA" : "RESUMEN e2e ficha SII: OK"); if (falla) process.exit(1);
