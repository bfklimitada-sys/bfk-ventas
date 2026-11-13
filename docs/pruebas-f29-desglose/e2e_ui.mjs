// Prueba de interfaz del F29 con desglose (13/11/2026) con Supabase SIMULADO (sin datos reales).
// Uso: npx vite build && npx vite preview --port 4181 ; node docs/pruebas-f29-desglose/e2e_ui.mjs http://127.0.0.1:4181/ [celular|escritorio]
// CHROME=/ruta/a/chrome (por defecto /usr/bin/google-chrome).
import { chromium } from "playwright-core";
const APP = process.argv[2] || "http://127.0.0.1:4181/";
const MODO = process.argv[3] || "celular";
const oc = (id, numero, venta, costo, fecha) => ({ id, numero_oc: numero, cliente: "Cliente " + id, vendedor_id: "v1", tipo_registro: "venta", estado_compra: "comprado", estado_entrega: "confirmada", estado_factura_propia: "emitida",
  estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", monto_total: venta, costo_total: costo, monto_facturado: venta, monto_cobrado: 0, vendedor_pagado: false, financiador_id: "f1",
  creadoEn: "2026-01-01T00:00:00Z", vendedores: { nombre: "Vendedor Uno" }, financiadores: { nombre: "Financiador Uno" }, eventos_compra: [], eventos_entrega: [],
  eventos_factura: [{ id: "fa" + id, fecha, numero_factura: "F" + id, monto: venta }], eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [], oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [] });
const legacy = (id, anio, mes, vn, d, cn, c, p) => ({ id, anio, mes, ventas_netas: vn, iva_ventas: d, compras_netas: cn, iva_compras: c, iva_pagado: p, remanente_anterior: null, ppm: null, otras_retenciones: null, desglose_f29: null });
const T = {
  ordenes_compra_v2: [oc("o1", "2001-1-SE26", 1500000, 1000000, "2026-10-10")],
  iva_mensual: [legacy("i8", 2026, 8, 8173269, 1552920, 5178704, 983956, 609830), legacy("i9", 2026, 9, 3351431, 636771, 4290475, 815190, 16757)],
  perfiles: [{ id: "u1", nombre: "Admin", rol: "admin", email: "a@a.cl" }], vendedores: [{ id: "v1", nombre: "Vendedor Uno", comision_pct: 10 }],
  financiadores: [{ id: "f1", nombre: "Financiador Uno", saldo_deuda: 0 }],
  gastos_indirectos: [{ id: "g8", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 609830, mes: 8, anio: 2026, fecha: "2026-09-17" },
    { id: "g9", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 16757, mes: 9, anio: 2026, fecha: "2026-10-15" },
    // Pago sin débito/crédito (período incompleto): el aviso «Completar» abre el formulario y guardar no toca el pago.
    { id: "g6", categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 35033, mes: 6, anio: 2026, fecha: "2026-07-16" }],
  pagos_vendedor: [], categorias_gasto: [{ id: "cat_impuesto", nombre: "Impuesto SII", subcategorias: [{ nombre: "IVA Mensual" }, { nombre: "Multa" }] }, { id: "cat_contador", nombre: "Contador", subcategorias: [] }],
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
const texto = async (sel) => (await page.locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
const desg = async (dato) => (await page.locator(`[data-desglose-f29] [data-desglose="${dato}"]`).first().innerText()).replace(/\s+/g, " ");
const det = async (dato) => (await page.locator(`[data-detalle-f29] [data-detalle="${dato}"]`).first().innerText()).replace(/\s+/g, " ");
const foto = async (n) => { if (process.env.CAPTURAS) await page.screenshot({ path: `${process.env.CAPTURAS}/${MODO}-${n}.png`, fullPage: false }); };
const cerrar = async () => { while (await page.locator('[role="dialog"] button[aria-label="Cerrar"]').count()) { await page.locator('[role="dialog"] button[aria-label="Cerrar"]').last().click(); await page.waitForTimeout(300); } };
const escribir = async (k, v) => { await page.locator(`[data-f29-campo="${k}"]`).fill(v); };

// 0) Gastos › Impuesto SII deriva a Impuestos (el pago del F29 ya no se registra como gasto suelto ni desde el formulario).
await ir("gastos");
await page.getByText("+ Registrar gasto").first().click(); await page.waitForTimeout(400);
await page.locator('[role="dialog"] select').first().selectOption("cat_impuesto"); await page.waitForTimeout(300);
res.gastos_deriva_a_impuestos = (await page.locator("[data-gasto-ir-impuestos]").count()) === 1;
await page.locator("[data-gasto-ir-impuestos]").click(); await page.waitForTimeout(900);
res.gastos_navega_a_impuestos = /#\/impuestos/.test(page.url()) && (await page.locator('[role="dialog"]').count()) === 0;
// Período incompleto (junio 2026): completar abre el formulario con desglose en junio; guardar no crea ni cambia gastos.
res.aviso_incompleto = (await page.locator('[data-aviso="iva-incompleto"]').count()) === 1;
await page.getByText(/Completar Jun\/2026/).first().click(); await page.waitForTimeout(500);
res.completar_abre_junio = (await page.locator("[data-form-f29] select").first().inputValue()) === "6" && (await page.locator('[data-form-f29="desglose"]').count()) === 1;
for (const [k, v] of [["vN", "184.384"], ["cN", "0"], ["iV", "35.033"], ["iC", "0"], ["rem", "0"], ["ppm", "0"], ["otras", "0"]]) await page.locator(`[data-f29-campo="${k}"]`).fill(v);
await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(1300);
res.completar_sin_tocar_pago = escr.filter((e) => e.t === "gastos_indirectos").length === 0 && T.gastos_indirectos.find((g) => g.id === "g6").monto === 35033
  && (await page.locator('[data-aviso="iva-incompleto"]').count()) === 0 && T.iva_mensual.find((r) => r.mes === 6)?.iva_ventas === 35033;
escr.length = 0;

// 1) Registrar el F29 de octubre 2026 copiando el informe tal como aparece (puntos, $ y «–»).
await ir("impuestos");
await page.getByText("+ Registrar IVA de otro mes").click(); await page.waitForTimeout(500);
res.form_con_desglose = (await page.locator('[data-form-f29="desglose"]').count()) === 1;
await page.locator("[data-form-f29] select").first().selectOption("10"); await page.waitForTimeout(200);
await escribir("vN", "$ 6.331.221"); await escribir("cN", "6.189.588"); await escribir("iV", "1.202.931"); await escribir("iC", "$ 1.176.028");
await escribir("rem", "149.951"); await escribir("ppm", "31.656");
res.pendiente_visible = (await desg("otras")).includes("Pendiente") && (await desg("total-f29")).includes("Pendiente");
await escribir("otras", "–"); await page.waitForTimeout(200);
await page.locator("[data-desglose-f29]").scrollIntoViewIfNeeded(); await foto("1-formulario-octubre");
res.form_iva_neto = await desg("iva-neto"); res.form_iva_a_pagar = await desg("iva-a-pagar"); res.form_remanente_sig = await desg("remanente-siguiente");
res.form_total = await desg("total-f29"); res.form_descuento = await desg("descuento-comisiones");
res.form_ok = /\$26\.903/.test(res.form_iva_neto) && /\$0$/.test(res.form_iva_a_pagar) && /noviembre.*\$123\.048/.test(res.form_remanente_sig) && /Total a pagar F29.*\$31\.656/.test(res.form_total) && /\$31\.656/.test(res.form_descuento) && !/58\.559/.test(res.form_descuento);
await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(1500);
const post = escr.filter((e) => e.t === "iva_mensual");
const b = post[0]?.body || {};
res.guarda_una_declaracion = post.length === 1 && post[0].m === "POST" && b.anio === 2026 && b.mes === 10 && b.ventas_netas === 6331221 && b.compras_netas === 6189588 && b.iva_ventas === 1202931 && b.iva_compras === 1176028
  && b.remanente_anterior === 149951 && b.ppm === 31656 && b.otras_retenciones === 0 && b.desglose_f29 === true && b.iva_pagado === 31656;
res.sin_gasto_al_guardar = escr.filter((e) => e.t === "gastos_indirectos").length === 0;

// 2) F29: octubre declarado y pendiente de pago $31.656; Caja / resumen lo descuenta.
await page.getByRole("tab", { name: /F29/ }).first().click().catch(async () => { await page.getByText("F29", { exact: true }).first().click(); }); await page.waitForTimeout(500);
res.lista_octubre = (await texto('[data-f29="2026-10"]'));
res.lista_ok = /Pendiente \$31\.656/.test(res.lista_octubre) && /IVA a pagar \$0 \+ PPM \$31\.656 \+ otras \$0 = \$31\.656/.test(res.lista_octubre);
res.indicador_f29 = await texto('[data-indicador="f29-pendiente"], [data-dato="f29-pendiente"]').catch(() => "");
await page.locator('[data-f29="2026-10"]').click(); await page.waitForTimeout(500);
await foto("2-detalle-octubre");
res.detalle_estado = await texto("[data-estado-f29]");
res.detalle_ok = /Declarado · pendiente de pago \$31\.656/.test(res.detalle_estado) && (await page.locator("[data-detalle-f29] [data-saldo-f29]").getAttribute("data-saldo-f29")) === "31656"
  && /\$123\.048/.test(await det("remanente-siguiente")) && /Total a pagar F29.*\$31\.656/.test(await det("total-f29")) && /\$31\.656/.test(await det("descuento-comisiones")) && (await page.locator("[data-sin-pagos]").count()) === 1;

// 3) Registrar el pago (doble toque): una sola salida de caja; saldo $0.
await page.locator("[data-f29-registrar-pago]").click(); await page.waitForTimeout(300);
res.pago_precargado = (await page.locator("[data-pago-monto]").inputValue()) === "31656" && (await page.locator("[data-pago-fecha]").inputValue()) === "2026-11-13";
await page.locator("[data-pago-fecha]").fill("2026-11-12");
await page.locator("[data-pago-confirmar]").dblclick(); await page.waitForTimeout(1800);
const gPost = escr.filter((e) => e.t === "gastos_indirectos" && e.m === "POST");
res.pagos_enviados = gPost.length; res.pagos_guardados = T.gastos_indirectos.filter((g) => g.anio === 2026 && g.mes === 10).length;
const g = T.gastos_indirectos.find((x) => x.anio === 2026 && x.mes === 10) || {};
res.pago_ok = res.pagos_guardados === 1 && g.categoria_id === "cat_impuesto" && g.subcategoria === "IVA Mensual" && g.monto === 31656 && g.fecha === "2026-11-12";
res.saldo_cero = (await page.locator("[data-detalle-f29] [data-saldo-f29]").getAttribute("data-saldo-f29")) === "0" && /Pagado/.test(await texto("[data-estado-f29]"));
await foto("3-detalle-pagado");
res.sin_boton_pago = (await page.locator("[data-f29-registrar-pago]").count()) === 0;
// Volver a guardar el F29 dos veces: solo PATCH de iva_mensual, ningún gasto nuevo.
for (let i = 0; i < 2; i++) { await page.locator("[data-f29-editar]").click(); await page.waitForTimeout(400); await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(1300); }
res.reguardar_sin_duplicar = escr.filter((e) => e.t === "iva_mensual" && e.m === "PATCH").length === 2 && T.gastos_indirectos.filter((x) => x.anio === 2026 && x.mes === 10).length === 1
  && T.gastos_indirectos.length === 4 && T.iva_mensual.find((r) => r.mes === 10).ppm === 31656;
await cerrar();

// 4) Período histórico sin desglose (septiembre 2026): conserva su cálculo y su formato.
await page.locator('[data-f29="2026-9"]').click(); await page.waitForTimeout(400);
res.historico_detalle = (await page.locator("[data-detalle-f29] [data-f29-anterior]").count()) === 1 && /\$16\.757/.test(await det("total-f29")) && /Pagado/.test(await texto("[data-estado-f29]"));
await page.locator("[data-f29-editar]").click(); await page.waitForTimeout(400);
res.historico_form_anterior = (await page.locator('[data-form-f29="anterior"]').count()) === 1 && (await page.locator('[data-f29-campo="total"]').inputValue()) === "16.757";
const antesPatch = escr.length;
await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(1300);
const pt = escr.slice(antesPatch).filter((e) => e.t === "iva_mensual");
res.historico_guardado_igual = pt.length === 1 && pt[0].m === "PATCH" && JSON.stringify(pt[0].body) === JSON.stringify({ anio: 2026, mes: 9, ventas_netas: 3351431, iva_ventas: 636771, compras_netas: 4290475, iva_compras: 815190, iva_pagado: 16757 });
await cerrar(); await page.locator('[data-f29="2026-9"]').click(); await page.waitForTimeout(400);
await page.locator("[data-f29-editar]").click(); await page.waitForTimeout(400);
await page.locator("[data-f29-pasar-desglose]").click(); await page.waitForTimeout(200);
const antesConv = escr.length;
await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(600);
res.historico_no_se_completa_solo = escr.length === antesConv && /No se completan con valores supuestos/.test(await page.locator("[data-form-f29]").innerText());
await cerrar();

// 5) Comisiones de octubre: descuento único = Total a pagar F29 $31.656 (IVA a pagar $0 + PPM $31.656 + otras $0); NUNCA $58.559.
await ir("vendedores");
await page.getByText("Vendedor Uno").first().click(); await page.waitForTimeout(800);
await page.locator('[data-descuento-tributario="total-f29"]').first().scrollIntoViewIfNeeded().catch(() => {}); await foto("4-comisiones-octubre");
const bt = await page.evaluate(() => document.body.innerText);
const i0 = bt.indexOf("Oct/2026", bt.search(/comisión mes a mes/i)); const bloque = bt.slice(i0, bt.indexOf("= Comisión del mes", i0) + 40);
res.comision_descuento_texto = (bloque.match(/Descuento tributario total: \$[\d.]+/) || [])[0] || null;
res.comision_bloque_ok = res.comision_descuento_texto === "Descuento tributario total: $31.656" && !/58\.559/.test(bloque) && /IVA a pagar F29.*\$0/.test(bloque) && /PPM y otras retenciones del F29: −\$31\.656/.test(bloque);
res.comision_octubre = (bloque.match(/= Comisión del mes: (\$[\d.]+)/) || [])[1] || null;
res.comision_ok = res.comision_octubre === "$234.172";   // (500.000 − 31.656) / 2

// 6) F29 en $0 (noviembre) y dato pendiente distinguible.
await ir("impuestos");
await page.getByText("+ Registrar IVA de otro mes").click(); await page.waitForTimeout(500);
await page.locator("[data-form-f29] select").first().selectOption("11"); await page.waitForTimeout(200);
for (const k of ["vN", "cN", "iV", "iC", "rem", "ppm", "otras"]) await escribir(k, "0");
await page.locator("[data-f29-guardar]").click(); await page.waitForTimeout(1300);
const nov = T.iva_mensual.find((r) => r.mes === 11) || {};
res.cero_guardado = nov.ppm === 0 && nov.otras_retenciones === 0 && nov.remanente_anterior === 0 && nov.desglose_f29 === true;
await page.getByText("F29", { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(400);
res.cero_listado = /\$0 a pagar/.test(await texto('[data-f29="2026-11"]'));
res.errores = errs; res.escrituras = escr.map((e) => `${e.m} ${e.t}`);
const claves = Object.keys(res).filter((k) => typeof res[k] === "boolean");
const fallas = claves.filter((k) => !res[k]);
console.log(JSON.stringify(res, null, 1));
console.log(`RESUMEN interfaz F29 (${MODO}): ${claves.length - fallas.length} OK, ${fallas.length + (errs.length ? 1 : 0)} FALLA(S)${fallas.length ? " → " + fallas.join(", ") : ""}${errs.length ? " · errores de página" : ""}`);
await browser.close();
if (fallas.length || errs.length) process.exitCode = 1;
