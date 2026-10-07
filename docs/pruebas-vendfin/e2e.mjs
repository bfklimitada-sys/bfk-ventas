// Vendedor y financiador por OC: listado (chips, faltantes, filtros), ficha (ver/editar, Sin definir, avisos y bloqueos),
// escritorio y móvil, con Supabase simulado (sin datos reales). Uso: node docs/pruebas-vendfin/e2e.mjs http://127.0.0.1:4183/
import { chromium } from "playwright-core";
const APP = process.argv[2] || "http://127.0.0.1:4183/";
const base = (i, extra) => ({ id: "oc" + i, numero_oc: `TVF-${i}-AG26`, cliente: "CLIENTE " + i, rut_cliente: "69.200.800-6", comuna: "Laja",
  estado_compra: "pendiente", estado_entrega: "pendiente", estado_factura_propia: "pendiente", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente",
  monto_total: 119000, costo_total: 0, monto_facturado: 0, monto_cobrado: 0, monto_pagado_fin: 0, es_venta_propia: false, tipo_registro: "venta",
  creadoEn: `2026-09-0${i}T12:00:00Z`, fecha_emision_mp: `2026-09-0${i}`, vendedor_id: null, financiador_id: null, vendedores: null, financiadores: null,
  eventos_compra: [], eventos_entrega: [], eventos_factura: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [],
  oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [], ...extra });
const VEND = [{ id: "v1", nombre: "Matías Vegas", activo: true }, { id: "v2", nombre: "Juan Vergara", activo: true }];
const FIN = [{ id: "f1", nombre: "Kevin Vergara", tipo: "externo", saldo_deuda: 50000 }, { id: "f2", nombre: "Matías Vegas", tipo: "externo", saldo_deuda: 0 }, { id: "fb", nombre: "Cuenta BFK", tipo: "propio", saldo_deuda: 0 }];
const conNombres = (o) => ({ ...o, vendedores: VEND.find((v) => v.id === o.vendedor_id) ? { nombre: VEND.find((v) => v.id === o.vendedor_id).nombre } : null,
  financiadores: FIN.find((f) => f.id === o.financiador_id) ? { nombre: FIN.find((f) => f.id === o.financiador_id).nombre } : null });
const TABLAS = () => ({
  ordenes_compra_v2: [
    base(1, { vendedor_id: "v1", financiador_id: "f1" }),                                     // ambos definidos
    base(2),                                                                                 // ambos sin definir (OC recién creada)
    base(3, { vendedor_id: "v1", financiador_id: "f1", estado_factura_propia: "emitida", monto_facturado: 119000,   // comisión ya pagada
      eventos_factura: [{ id: "fx3", oc_id: "oc3", numero_factura: "300", fecha: "2026-05-10", monto: 119000, tipo_dte: 33 }] }),
    base(4, { vendedor_id: "v2", financiador_id: "f1", estado_compra: "comprado", costo_total: 50000,           // con compra (deuda)
      eventos_compra: [{ id: "c4", oc_id: "oc4", fecha: "2026-09-04", costo_compra: 50000, monto_venta: 119000, financiador_id: "f1" }] }),
    base(5, { vendedor_id: "v1", financiador_id: "f1", estado_compra: "comprado", costo_total: 50000, monto_pagado_fin: 50000, estado_pago_financiamiento: "pagado",   // financiamiento pagado
      eventos_compra: [{ id: "c5", oc_id: "oc5", fecha: "2026-09-05", costo_compra: 50000, monto_venta: 119000, financiador_id: "f1" }],
      eventos_pago_financiamiento: [{ id: "p5", oc_id: "oc5", fecha: "2026-09-06", monto: 50000, financiador_id: "f1" }] }),
    base(6, { vendedor_id: "v1", financiador_id: "f2" }),                                     // misma persona
    base(7, { vendedor_id: null, financiador_id: "fb", capitalizacion_bfk: true }),            // capitalización BFK Ltda.
    base(8, { vendedor_id: "v1", financiador_id: "f1", comision_excluida: true }),             // vendedor histórico, mes cerrado
  ].map(conNombres),
  perfiles: [{ id: "u1", nombre: "Admin", rol: "admin" }], vendedores: VEND, financiadores: FIN,
  pagos_vendedor: [{ id: "pv1", vendedor_id: "v1", anio: 2026, mes: 5, monto_pagado: 1000, fecha: "2026-05-31", estado: "pagado" }],
  categorias_gasto: [], gastos_indirectos: [], iva_mensual: [], aportes_socios: [],
});
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const res = {}; let falla = false;
for (const [modo, vp] of [["escritorio", { width: 1280, height: 900 }], ["movil", { width: 390, height: 844 }]]) {
  const T = TABLAS(); const rpcs = []; const errs = [];
  const ctx = await browser.newContext({ viewport: vp, isMobile: modo === "movil", hasTouch: modo === "movil", timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/*", async (route) => { const u = new URL(route.request().url()); const m = route.request().method();
    if (u.hostname === "127.0.0.1") return route.continue();
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.includes("/auth/v1/")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" }, id: "u1" } });
    const t = u.pathname.split("/").pop();
    if (u.pathname.includes("/rpc/")) { const body = route.request().postDataJSON() || {}; rpcs.push({ t, body });
      if (t === "gestionar_bloqueo_oc") return route.fulfill({ json: { ok: true } });
      if (t === "asignar_vendedor_oc") { const o = T.ordenes_compra_v2.find((x) => x.id === body.p_oc_id); o.capitalizacion_bfk = body.p_vendedor_id === "__capitalizacion__"; o.vendedor_id = o.capitalizacion_bfk ? null : body.p_vendedor_id; Object.assign(o, conNombres(o)); return route.fulfill({ json: { ok: true, despues: o.vendedores?.nombre || "Sin definir" } }); }
      if (t === "asignar_financiador_oc") { const o = T.ordenes_compra_v2.find((x) => x.id === body.p_oc_id); o.financiador_id = body.p_financiador_id; for (const c of o.eventos_compra) c.financiador_id = body.p_financiador_id; Object.assign(o, conNombres(o)); return route.fulfill({ json: { ok: true, despues: o.financiadores?.nombre || "Sin definir" } }); }
      return route.fulfill({ json: [] }); }
    if (m !== "GET") return route.fulfill({ json: [] });
    return route.fulfill({ json: JSON.parse(JSON.stringify(T[t] || [])) }); });
  await page.addInitScript(() => localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1" } })));
  await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);
  await page.locator('[data-nav="compras"]').first().click(); await page.waitForTimeout(900);
  const r = {};
  const fila = (n) => page.locator(`[data-oc="TVF-${n}-AG26"]`);
  r.lista_chips_v_f = /V: Matías/.test(await fila(1).innerText()) && /F: Kevin/.test(await fila(1).innerText());
  r.lista_falta_vendedor = (await fila(2).locator('[data-aviso="sin-vendedor"]').count()) === 1 && (await fila(1).locator('[data-aviso="sin-vendedor"]').count()) === 0;
  r.lista_falta_financiador = (await fila(2).locator('[data-aviso="sin-financiador"]').count()) === 1;
  // Filtros (siempre visibles)
  const contar = async () => page.locator("[data-oc]").count();
  await page.locator('[data-filtro="vendedor"]').selectOption("v1"); await page.waitForTimeout(300);
  r.filtro_vendedor = (await contar()) === 5;
  await page.locator('[data-filtro="vendedor"]').selectOption("__sin__"); await page.waitForTimeout(300);
  r.filtro_falta_vendedor = (await contar()) === 1 && (await fila(2).count()) === 1;
  await page.locator('[data-filtro="vendedor"]').selectOption(""); await page.locator('[data-filtro="financiador"]').selectOption("f2"); await page.waitForTimeout(300);
  r.filtro_financiador = (await contar()) === 1 && (await fila(6).count()) === 1;
  await page.locator('[data-filtro="financiador"]').selectOption("__sin__"); await page.waitForTimeout(300);
  r.filtro_falta_financiador = (await contar()) === 1 && (await fila(2).count()) === 1;
  await page.locator('[data-filtro="financiador"]').selectOption(""); await page.waitForTimeout(300);
  r.filtros_limpios = (await contar()) === 8;
  await page.locator('[data-filtro="vendedor"]').selectOption("__capitalizacion__"); await page.waitForTimeout(300);
  r.filtro_capitalizacion = (await contar()) === 1 && (await fila(7).count()) === 1;
  await page.locator('[data-filtro="vendedor"]').selectOption(""); await page.waitForTimeout(300);
  r.lista_capitalizacion = (await fila(7).locator("[data-chip-capitalizacion]").count()) === 1 && (await fila(7).locator('[data-aviso="sin-vendedor"]').count()) === 0
    && /BFK Ltda\. · Capitalización/.test(await fila(7).innerText()) && /F: Cuenta/.test(await fila(7).innerText());

  const abrir = async (n) => { await fila(n).locator("> div").first().click(); await page.waitForTimeout(900); return page.locator(`[data-ficha-oc="TVF-${n}-AG26"]`); };
  const cerrar = async (n) => { await fila(n).locator("> div").first().click(); await page.waitForTimeout(400); };
  // OC 2 (nueva, sin definir): asignar vendedor y financiador; luego volver a Sin definir
  let f = await abrir(2);
  const bloque = f.locator("[data-asignaciones-oc]");
  r.ficha_visible_sin_definir = (await bloque.count()) === 1 && (await bloque.locator('[data-asignacion="vendedor"]').innerText()).includes("Sin definir")
    && (await bloque.locator('[data-asignacion="financiador"]').innerText()).includes("Sin definir");
  r.cabecera_v_f = /V: Sin definir · F: Sin definir/.test(await f.locator("[data-cabecera-asignaciones]").innerText());
  await bloque.locator('[data-asignacion="vendedor"] [data-asignacion-editar]').click();
  await bloque.locator('[data-asignacion="vendedor"] [data-asignacion-select]').selectOption("v2");
  await bloque.locator('[data-asignacion="vendedor"] [data-asignacion-guardar]').click(); await page.waitForTimeout(1200);
  r.editar_vendedor = rpcs.some((x) => x.t === "asignar_vendedor_oc" && x.body.p_oc_id === "oc2" && x.body.p_vendedor_id === "v2")
    && /Juan Vergara/.test(await page.locator('[data-ficha-oc="TVF-2-AG26"] [data-asignacion="vendedor"]').innerText());
  f = page.locator('[data-ficha-oc="TVF-2-AG26"]');
  await f.locator('[data-asignacion="financiador"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="financiador"] [data-asignacion-select]').selectOption("f1");
  r.financiador_sin_compra_sin_confirmacion = /Guardar/.test(await f.locator('[data-asignacion="financiador"] [data-asignacion-guardar]').innerText());
  await f.locator('[data-asignacion="financiador"] [data-asignacion-guardar]').click(); await page.waitForTimeout(1200);
  r.editar_financiador = rpcs.some((x) => x.t === "asignar_financiador_oc" && x.body.p_oc_id === "oc2" && x.body.p_financiador_id === "f1");
  f = page.locator('[data-ficha-oc="TVF-2-AG26"]');
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-select]').selectOption("");
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-guardar]').click(); await page.waitForTimeout(1200);
  r.volver_sin_definir = rpcs.some((x) => x.t === "asignar_vendedor_oc" && x.body.p_oc_id === "oc2" && x.body.p_vendedor_id === null)
    && /Sin definir/.test(await page.locator('[data-ficha-oc="TVF-2-AG26"] [data-asignacion="vendedor"]').innerText());
  await page.locator('[data-ficha-oc="TVF-2-AG26"]').screenshot({ path: `${process.env.SALIDA || "."}/vendfin-ficha-${modo}.png` }).catch(() => {});
  await cerrar(2);
  // OC 3: comisión de mayo ya pagada al vendedor → bloqueo
  f = await abrir(3);
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-select]').selectOption("v2");
  r.vendedor_bloqueado_comision_pagada = /ya se pagó/.test(await f.locator("[data-asignacion-bloqueo]").innerText())
    && await f.locator('[data-asignacion="vendedor"] [data-asignacion-guardar]').isDisabled();
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-cancelar]').click(); await cerrar(3);
  // OC 4: con compra → aviso y confirmación; no puede quedar sin definir
  f = await abrir(4);
  await f.locator('[data-asignacion="financiador"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="financiador"] [data-asignacion-select]').selectOption("");
  r.financiador_con_compra_no_sin_definir = (await f.locator("[data-asignacion-bloqueo]").count()) === 1;
  await f.locator('[data-asignacion="financiador"] [data-asignacion-select]').selectOption("f2");
  r.financiador_con_compra_advierte = /\$50\.000/.test(await f.locator("[data-asignacion-aviso]").first().innerText())
    && /Confirmar cambio/.test(await f.locator('[data-asignacion="financiador"] [data-asignacion-guardar]').innerText());
  await f.locator('[data-asignacion="financiador"] [data-asignacion-guardar]').click(); await page.waitForTimeout(1200);
  r.financiador_con_compra_cambia = rpcs.some((x) => x.t === "asignar_financiador_oc" && x.body.p_oc_id === "oc4" && x.body.p_financiador_id === "f2");
  await cerrar(4);
  // OC 5: financiamiento pagado → bloqueado
  f = await abrir(5);
  await f.locator('[data-asignacion="financiador"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="financiador"] [data-asignacion-select]').selectOption("f2");
  r.financiamiento_pagado_bloqueado = /pagados al financiador/.test(await f.locator("[data-asignacion-bloqueo]").innerText());
  await f.locator('[data-asignacion="financiador"] [data-asignacion-cancelar]').click(); await cerrar(5);
  // OC 7: capitalización · OC 8: comisión excluida
  f = await abrir(7);
  r.ficha_capitalizacion = /BFK Ltda\. · Capitalización/.test(await f.locator('[data-asignacion="vendedor"]').innerText())
    && /No genera comisión/.test(await f.locator('[data-asignacion="vendedor"]').innerText())
    && (await f.locator('[data-asignacion="vendedor"]').getAttribute("data-asignacion-valor")) === "__capitalizacion__"
    && /Cuenta BFK/.test(await f.locator('[data-asignacion="financiador"]').innerText());
  await cerrar(7);
  f = await abrir(8);
  r.ficha_comision_excluida = /Matías Vegas/.test(await f.locator('[data-asignacion="vendedor"]').innerText()) && /No genera comisión/.test(await f.locator('[data-asignacion="vendedor"]').innerText());
  await cerrar(8);
  // Marcar una OC sin vendedor como capitalización desde la ficha
  f = await abrir(2);
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-editar]').click();
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-select]').selectOption("__capitalizacion__");
  r.capitalizacion_aviso = /no genera comisión/i.test(await f.locator("[data-asignacion-aviso]").first().innerText());
  await f.locator('[data-asignacion="vendedor"] [data-asignacion-guardar]').click(); await page.waitForTimeout(1200);
  r.marcar_capitalizacion = rpcs.some((x) => x.t === "asignar_vendedor_oc" && x.body.p_oc_id === "oc2" && x.body.p_vendedor_id === "__capitalizacion__")
    && /BFK Ltda\. · Capitalización/.test(await page.locator('[data-ficha-oc="TVF-2-AG26"] [data-asignacion="vendedor"]').innerText());
  await cerrar(2);
  // OC 6: la misma persona vende y financia
  f = await abrir(6);
  r.misma_persona = (await f.locator("[data-misma-persona]").count()) === 1;
  await cerrar(6);
  r.sin_rpc_indebidas = !rpcs.some((x) => (x.t === "asignar_vendedor_oc" && x.body.p_oc_id === "oc3") || (x.t === "asignar_financiador_oc" && x.body.p_oc_id === "oc5"));
  r.sin_desborde_horizontal = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  r.sin_errores = errs.length === 0;
  await page.locator("[data-oc]").first().screenshot({ path: `${process.env.SALIDA || "."}/vendfin-fila-${modo}.png` }).catch(() => {});
  for (const [k, v] of Object.entries(r)) { res[`${modo}.${k}`] = v; if (!v) falla = true; }
  if (errs.length) console.log(modo, "errores:", errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
for (const [k, v] of Object.entries(res)) console.log(`${v ? "OK   " : "FALLA"} ${k}`);
console.log(falla ? "RESULTADO: FALLA" : `RESULTADO: ${Object.keys(res).length} OK`);
process.exit(falla ? 1 : 0);
