// Prueba de interfaz del registro único "IVA del mes" con Supabase simulado (sin datos reales).
// Requiere: npx vite build && npx vite preview --port 4177 ; playwright-core.
import { chromium } from "playwright-core";
const APP = "http://127.0.0.1:4177/";
const oc = { id: "oc1", numero_oc: "2000-1-SE26", cliente: "Cliente 1", vendedor_id: "v1", estado_compra: "comprado", estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente",
  monto_total: 7340493, costo_total: 7340493 - 1401405, monto_facturado: 7340493, monto_cobrado: 0, vendedor_pagado: false, financiador_id: "f1", creadoEn: "2026-01-01T00:00:00Z", vendedores: { nombre: "Vendedor Uno" }, financiadores: { nombre: "Financiador Uno" },
  eventos_compra: [{ id: "ec1", fecha: "2026-08-10", monto: 5939088 }], eventos_entrega: [], eventos_factura: [{ id: "fa1", fecha: "2026-08-14", numero_factura: "100", monto: 7340493 }], eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [], oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [] };
const TABLAS = { ordenes_compra_v2: [oc], iva_mensual: [{ id: "i7", anio: 2026, mes: 7, iva_ventas: 649597, iva_compras: 0, iva_pagado: 649597 }],
  perfiles: [{ id: "u1", nombre: "Admin", rol: "admin", email: "a@a.cl" }], vendedores: [{ id: "v1", nombre: "Vendedor Uno", comision_pct: 10 }], financiadores: [{ id: "f1", nombre: "Financiador Uno", saldo_deuda: 0 }],
  gastos_indirectos: [{ id: "g8", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 609830, mes: 8, anio: 2026, fecha: "2026-09-20" }, { id: "g7", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 649597, mes: 7, anio: 2026, fecha: "2026-08-20" }],
  pagos_vendedor: [], categorias_gasto: [{ id: "cat_impuesto", nombre: "Impuesto SII" }, { id: "cat_contador", nombre: "Contador" }] };
const res = {}; const escr = []; const errs = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Santiago" });
const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
await page.clock.setFixedTime(new Date("2026-10-06T22:30:00-03:00"));
await page.route("**/*", async (route) => { const u = new URL(route.request().url()); const m = route.request().method();
  if (u.hostname === "127.0.0.1") return route.continue();
  if (u.hostname.endsWith("supabase.co")) {
    if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" } } });
    if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: "u1" } });
    const t = u.pathname.split("/").pop();
    if (m !== "GET") { const body = route.request().postDataJSON(); escr.push({ m, t, q: u.search, body });
      if (m === "POST" && TABLAS[t]) TABLAS[t].push(body);
      if (m === "PATCH" && TABLAS[t]) { const id = u.searchParams.get("id")?.replace("eq.", ""); TABLAS[t] = TABLAS[t].map((r) => r.id === id ? { ...r, ...body } : r); }
      return route.fulfill({ json: [body] }); }
    return route.fulfill({ json: JSON.parse(JSON.stringify(TABLAS[t] || [])) }); }
  return route.abort(); });
await page.addInitScript(() => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1", email: "a@a.cl" } })); });
await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);
const ir = async (nombre) => { await page.mouse.click(348, 820); await page.waitForTimeout(500); await page.getByText(nombre, { exact: true }).first().click(); await page.waitForTimeout(900); };

// 1) Gastos: el historial de Impuesto SII marca agosto incompleto
await ir("Gastos");
await page.getByText("Impuesto SII", { exact: true }).first().click(); await page.waitForTimeout(400);
res.gastos_marca_agosto = (await page.locator("[data-iva-incompleto]").count()) === 1;
// el formulario de gasto con Impuesto SII deriva al formulario único
await page.getByText("+ Registrar gasto").click(); await page.waitForTimeout(400);
await page.locator("select").first().selectOption("cat_impuesto"); await page.waitForTimeout(300);
res.gasto_impuesto_deriva = (await page.getByText("Registrar IVA del mes", { exact: true }).count()) === 1;
await page.getByText("Registrar IVA del mes", { exact: true }).click(); await page.waitForTimeout(500);
res.form_abre_en_agosto = (await page.locator("select").first().inputValue()) === "8";
res.form_pagado_precargado = (await page.locator('input[type="number"]').nth(5).inputValue()) === "609830";
await page.keyboard.press("Escape"); await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);

// 2) Vendedores: aviso + completar agosto
await ir("Vendedores");
res.vendedores_aviso = (await page.locator('[data-aviso="iva-incompleto"]').count()) === 1;
await page.getByText(/Completar Ago\/2026/).first().click(); await page.waitForTimeout(500);
const nums = page.locator('input[type="number"]');
await nums.nth(2).fill("1552920"); await nums.nth(4).fill("983956");
await page.getByText("✓ Guardar IVA del mes").click(); await page.waitForTimeout(1500);
const ivaPost = escr.filter((e) => e.t === "iva_mensual");
res.escribe_un_iva = ivaPost.length === 1 && ivaPost[0].m === "POST" && ivaPost[0].body.anio === 2026 && ivaPost[0].body.mes === 8 && ivaPost[0].body.iva_ventas === 1552920 && ivaPost[0].body.iva_compras === 983956 && ivaPost[0].body.iva_pagado === 609830;
res.no_duplica_gasto = escr.filter((e) => e.t === "gastos_indirectos").length === 0;
res.aviso_desaparece = (await page.locator('[data-aviso="iva-incompleto"]').count()) === 0;
await page.getByText("Vendedor Uno").first().click(); await page.waitForTimeout(700);
const b = await page.evaluate(() => document.body.innerText);
const i = b.indexOf("Ago/2026", b.search(/comisión mes a mes/i)); const bloque = b.slice(i, b.indexOf("= Comisión del mes", i) + 40);
res.desglose_retenciones = /Retenciones del F29 \(PPM y otras\): −\$40\.866/.test(bloque) && /IVA neto del período \(débito \$1\.552\.920 − crédito \$983\.956\): −\$568\.964/.test(bloque);
res.comision_agosto = (bloque.match(/= Comisión del mes: (\$[\d.]+)/) || [])[1] || null;

// 3) Mes nuevo desde Vendedores: crea IVA + gasto en un paso (septiembre, sugerido)
await page.getByText("+ Registrar IVA de otro mes").click(); await page.waitForTimeout(500);
res.sugiere_septiembre = (await page.locator("select").last().inputValue()) === "9" || (await page.locator(".modal select, select").evaluateAll((s) => s.map((x) => x.value))).includes("9");
const n2 = page.locator('input[type="number"]');
const base = (await n2.count()) - 6;
await n2.nth(base + 2).fill("190000"); await n2.nth(base + 4).fill("50000");
await page.getByText("✓ Guardar IVA del mes").click(); await page.waitForTimeout(1500);
const sep = escr.filter((e) => e.body && e.body.mes === 9);
res.septiembre_iva_y_gasto = sep.some((e) => e.t === "iva_mensual" && e.body.iva_pagado === 140000) && sep.some((e) => e.t === "gastos_indirectos" && e.body.categoria_id === "cat_impuesto" && e.body.monto === 140000);
res.errores = errs; res.escrituras = escr.map((e) => `${e.m} ${e.t}`);
await browser.close();
console.log(JSON.stringify(res, null, 1));
const ok = res.gastos_marca_agosto && res.gasto_impuesto_deriva && res.form_abre_en_agosto && res.form_pagado_precargado && res.vendedores_aviso && res.escribe_un_iva && res.no_duplica_gasto && res.aviso_desaparece && res.comision_agosto === "$395.788" && res.desglose_retenciones && res.sugiere_septiembre && res.septiembre_iva_y_gasto && errs.length === 0;
console.log(ok ? "RESUMEN e2e IVA unificado: OK" : "RESUMEN e2e IVA unificado: FALLA"); if (!ok) process.exit(1);
