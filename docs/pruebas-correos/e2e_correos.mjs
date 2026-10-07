// Fase Correos: campana/contador, sección de correos en Alertas, filtros, marcar gestionado/reabrir,
// vínculo a la OC y sección Comunicaciones de la ficha. Escritorio y móvil, Supabase simulado (sin datos reales).
// Requiere: npx vite build && npx vite preview --port 4179 ; playwright-core.
import { chromium } from "playwright-core";
const APP = "http://127.0.0.1:4179/";
const hoy = new Date();
const iso = (dias, h = 10) => { const d = new Date(hoy); d.setDate(d.getDate() - dias); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const base = (i, extra) => ({ id: "oc" + i, numero_oc: `TEST-${i}-AG26`, cliente: "MUNICIPALIDAD DE PRUEBA " + i, rut_cliente: "69.200.800-6", comuna: "Laja", vendedor_id: "v1",
  estado_compra: "comprado", estado_entrega: "pendiente", estado_factura_propia: "pendiente", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "no_aplica",
  monto_total: 100000, costo_total: 60000, monto_facturado: 0, monto_cobrado: 0, monto_pagado_fin: 0, vendedor_pagado: false, es_venta_propia: true,
  creadoEn: iso(2), fecha_emision_mp: iso(2).slice(0, 10), vendedores: { nombre: "Vendedor Uno" }, financiadores: null,
  eventos_compra: [], eventos_entrega: [], eventos_factura: [], eventos_pago_cliente: [], eventos_pago_financiamiento: [], eventos_postventa: [],
  oc_productos_link: [], oc_comentarios: [], oc_reclamos: [], oc_responsables: [], items_oc: [], ...extra });
const correo = (id, extra) => ({ id, message_id: `<m${id}@x>`, buzon: "bfk@x", remitente_nombre: "Compras Muni", remitente_correo: "compras@muni.cl",
  asunto: `Asunto ${id}`, fecha: iso(id), resumen: `Resumen del correo ${id}`, categoria: "general", prioridad: 0, oc_id: null, asociacion: "ninguna",
  evidencia: null, rut_detectado: null, estado: "pendiente", gestionado_en: null, gestionado_por: null, gestionado_por_nombre: null, ...extra });
const CORREOS = () => [
  correo(1, { categoria: "reclamo", prioridad: 3, oc_id: "oc1", asociacion: "numero_oc", evidencia: "N° de OC TEST-1-AG26 citado en el correo", asunto: "Reclamo entrega OC TEST-1-AG26" }),
  correo(2, { categoria: "solicitud", prioridad: 1, rut_detectado: "69.200.800-6", asunto: "Solicitud de cotización" }),
  correo(3, { categoria: "facturacion", prioridad: 2, oc_id: "oc1", asociacion: "factura", estado: "gestionado", gestionado_en: iso(0), gestionado_por: "u1", gestionado_por_nombre: "Admin" }),
  correo(4, { categoria: "entrega", prioridad: 2, oc_id: "oc_archivada", asociacion: "rut_unico", asunto: "Despacho" }),
  correo(5, { categoria: "general", prioridad: 0, oc_id: "oc2", asociacion: "factura", asunto: "Acuse de recibo" }),
];
const TABLAS = (conCorreos) => ({ ordenes_compra_v2: [base(1), base(2)], perfiles: [{ id: "u1", nombre: "Admin", rol: "admin", email: "a@a.cl" }],
  vendedores: [{ id: "v1", nombre: "Vendedor Uno" }], financiadores: [], categorias_gasto: [], gastos_indirectos: [], iva_mensual: [], pagos_vendedor: [],
  ...(conCorreos ? { correos_bfk: CORREOS() } : {}) });

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
const res = {}; let falla = false;
const numAlertas = async (page) => { const l = await page.locator('[data-nav="notif"]').first().getAttribute("aria-label"); const m = /(\d+) pendiente/.exec(l || ""); return m ? Number(m[1]) : 0; };

for (const [modo, vp] of [["escritorio", { width: 1280, height: 900 }], ["movil", { width: 390, height: 844 }], ["sin_migracion", { width: 1280, height: 900 }]]) {
  const T = TABLAS(modo !== "sin_migracion"); const escr = []; const errs = [];
  const ctx = await browser.newContext({ viewport: vp, isMobile: modo === "movil", hasTouch: modo === "movil", timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/*", async (route) => { const u = new URL(route.request().url()); const m = route.request().method();
    if (u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname.endsWith("supabase.co")) {
      if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" } } });
      if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: "u1" } });
      const t = u.pathname.split("/").pop();
      if (u.pathname.includes("/rpc/")) {
        const body = route.request().postDataJSON(); escr.push({ m, t, body });
        if (t === "correo_bfk_marcar") { const c = T.correos_bfk.find((x) => x.id === body.p_id);
          Object.assign(c, { estado: body.p_estado, gestionado_en: body.p_estado === "gestionado" ? new Date().toISOString() : null, gestionado_por_nombre: body.p_estado === "gestionado" ? "Admin" : null });
          return route.fulfill({ json: { ...c } }); }
        return route.fulfill({ json: { ok: true } }); }
      if (m !== "GET") { const body = route.request().postDataJSON(); escr.push({ m, t, body }); return route.fulfill({ json: [body] }); }
      if (!(t in T) && t === "correos_bfk") return route.fulfill({ status: 404, json: { message: "relation does not exist" } });
      return route.fulfill({ json: JSON.parse(JSON.stringify(T[t] || [])) }); }
    return route.abort(); });
  await page.addInitScript(() => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t", refresh_token: "r", user: { id: "u1", email: "a@a.cl" } })); });
  await page.goto(APP, { waitUntil: "load" }); await page.waitForTimeout(1800);
  const r = {};
  const n0 = await numAlertas(page);
  await page.locator('[data-nav="notif"]').first().click(); await page.waitForTimeout(700);
  const sec = page.locator("[data-correos-pendientes]");
  if (modo === "sin_migracion") {
    r.app_carga_sin_tabla = (await page.locator("[data-ficha-oc], [data-nav]").count()) > 0 && errs.length === 0;
    r.sin_correos_pendientes = (await sec.getAttribute("data-correos-pendientes")) === "0" && /Sin correos pendientes/.test(await sec.innerText());
  } else {
    r.contador_incluye_correos = n0 >= 3;
    r.cuatro_pendientes_tres_accion = (await sec.getAttribute("data-correos-pendientes")) === "4" && (await sec.getAttribute("data-correos-accion")) === "3"
      && (await sec.locator("[data-correo]").count()) === 4 && /3 requieren acción · 1 informativo/.test(await sec.innerText());
    r.informativo_al_final = (await sec.locator("[data-correo]").last().getAttribute("data-correo")) === "5";
    r.urgente_primero = (await sec.locator("[data-correo]").first().getAttribute("data-correo")) === "1";
    r.muestra_remitente_asunto_resumen = await sec.locator('[data-correo="1"]').evaluate((el) => /Compras Muni/.test(el.innerText) && /Reclamo entrega OC TEST-1-AG26/.test(el.innerText) && /Resumen del correo 1/.test(el.innerText) && /Urgente/.test(el.innerText));
    r.vinculo_oc = /OC TEST-1-AG26/.test(await sec.locator('[data-correo="1"] [data-correo-abrir-oc]').innerText());
    r.general_sin_oc = /General · cliente RUT 69\.200\.800-6, sin OC única/.test(await sec.locator('[data-correo="2"]').innerText());
    r.oc_archivada_sin_enlace = /OC archivada/.test(await sec.locator('[data-correo="4"]').innerText()) && (await sec.locator('[data-correo="4"] [data-correo-abrir-oc]').count()) === 0;
    await sec.locator('[data-correos-filtro="oc"]').click(); r.filtro_con_oc = (await sec.locator("[data-correo]").count()) === 3;
    await sec.locator('[data-correos-filtro="general"]').click(); r.filtro_generales = (await sec.locator("[data-correo]").count()) === 1;
    await sec.locator('[data-correos-filtro="todos"]').click();
    // Marcar gestionado
    await sec.locator('[data-correo="1"] [data-correo-marcar]').click(); await page.waitForTimeout(700);
    const llamada = escr.find((e) => e.t === "correo_bfk_marcar");
    r.rpc_gestionado = !!llamada && llamada.body.p_id === 1 && llamada.body.p_estado === "gestionado";
    r.sale_de_pendientes = (await sec.getAttribute("data-correos-pendientes")) === "3" && (await sec.locator('[data-correo="1"]').count()) === 0;
    r.contador_baja = (await numAlertas(page)) === n0 - 1;
    await sec.locator("[data-correos-ver-gestionados]").click(); await page.waitForTimeout(300);
    r.ver_gestionados = (await sec.locator('[data-correo-estado="gestionado"]').count()) === 2 && /Gestionado por Admin/.test(await sec.locator('[data-correo="1"]').innerText());
    await sec.locator('[data-correo="1"] [data-correo-marcar]').click(); await page.waitForTimeout(700);
    r.reabrir = escr.filter((e) => e.t === "correo_bfk_marcar").at(-1)?.body.p_estado === "pendiente" && (await sec.getAttribute("data-correos-pendientes")) === "4";
    await sec.locator("[data-correos-ver-gestionados]").click(); await page.waitForTimeout(300);
    // Ir a la OC y ver la sección Comunicaciones
    await sec.locator('[data-correo="1"] [data-correo-abrir-oc]').click(); await page.waitForTimeout(1500);
    const f = page.locator('[data-ficha-oc="TEST-1-AG26"]');
    r.abre_ficha_oc = (await f.count()) === 1;
    const btn = f.locator("[data-indice-ficha] button", { hasText: "Comunicaciones" });
    if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(600); }
    const com = f.locator("[data-correos-oc]");
    r.ficha_correos_de_la_oc = (await com.getAttribute("data-correos-oc")) === "2" && (await com.locator('[data-correo="1"]').count()) === 1;
    r.ficha_pendiente_en_lista = /1 correo pendiente de gestión/.test(await f.locator("[data-comunicaciones]").innerText());
    r.ficha_gestionados_plegados = /Gestionados \(1\)/.test(await com.innerText());
    await f.locator("[data-comunicaciones]").screenshot({ path: `${process.env.SALIDA || "."}/ficha-comunicaciones-${modo}.png` }).catch(() => {});
    await com.locator('[data-correo="1"] [data-correo-marcar]').click(); await page.waitForTimeout(700);
    r.ficha_marca_gestionado = escr.filter((e) => e.t === "correo_bfk_marcar").at(-1)?.body.p_estado === "gestionado";
    // Fuera de la RPC de correos solo aparecen escrituras previas de la app (bloqueo de OC al abrir la ficha y la caché de uso de MP al cargar).
    r.solo_escribe_estado_correo = escr.every((e) => e.t === "correo_bfk_marcar" || e.t === "gestionar_bloqueo_oc" || e.t === "mp_cache_avisos");
    r.sin_errores = errs.length === 0;
    await page.locator('[data-nav="notif"]').first().click(); await page.waitForTimeout(500);
    await page.locator("[data-correos-pendientes]").screenshot({ path: `${process.env.SALIDA || "."}/alertas-correos-${modo}.png` }).catch(() => {});
  }
  for (const [k, v] of Object.entries(r)) { res[`${modo}.${k}`] = v; if (!v) falla = true; }
  if (errs.length) console.log(modo, "errores:", errs.slice(0, 3));
  if (modo !== "sin_migracion") console.log(modo, "escrituras:", escr.map((e) => e.t).join(","));
  await ctx.close();
}
await browser.close();
for (const [k, v] of Object.entries(res)) console.log(`${v ? "OK   " : "FALLA"} ${k}`);
console.log(falla ? "RESULTADO: FALLA" : `RESULTADO: ${Object.keys(res).length} OK`);
process.exit(falla ? 1 : 0);
