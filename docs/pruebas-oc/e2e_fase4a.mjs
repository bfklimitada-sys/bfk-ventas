// Pruebas de interfaz de la Fase 4A (Chromium + Playwright, Supabase y /api/oc simulados con estado).
// Uso: node docs/pruebas-oc/e2e_fase4a.mjs http://127.0.0.1:4178/   (build servido con vite preview)
// Cada escenario parte de datos limpios. Nada sale a la red: las escrituras quedan en la base simulada.
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { FILTROS_PANEL } from "../../src/lib/ocs.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const SOLO = process.env.SOLO ? new Set(process.env.SOLO.split(",")) : null;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const R = {}; const F = []; const ok = (k, v, detalle) => { R[k] = !!v; if (!v) { F.push(k); console.log("FALLA " + k + (detalle !== undefined ? " :: " + JSON.stringify(detalle).slice(0, 400) : "")); } else console.log("OK    " + k); };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const base0 = (borrado = {}) => crearBase(crearDatos(), { mp: RESPUESTAS_MP, borrado });
const desde = (b, n) => b.escr.slice(n);
const cuenta = (ws, metodo, tabla, f = () => true) => ws.filter((w) => w.metodo === metodo && w.tabla === tabla && f(w)).length;
const texto = async (p) => p.evaluate(() => document.body.innerText);
const escritorio = { ancho: 1440, alto: 900, movil: false };
async function irA(p, k) { await p.locator(`aside [data-nav="${k}"]`).click(); await espera(p, 700); }
async function abrirOC(p, numero) {
  // Si ya está abierta (misma pantalla), no se vuelve a tocar: tocarla la cerraría.
  if (await p.locator(`[data-oc="${numero}"] [data-testid="oc-campos"]`).count()) return;
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
const enModal = (p) => p.locator("[role=dialog]").last();
async function boton(p, nombre, ambito) { const l = (ambito || p).getByRole("button", { name: nombre }); await l.first().click(); }
const escenario = async (nombre, fn) => {
  if (SOLO && !SOLO.has(nombre)) return;
  try { await fn(); } catch (e) { ok(`${nombre}_sin_excepcion`, false, e.message); }
};

// ── S0: al abrir, la sincronización automática completa la OC sin tocar la fecha de compra ni lo comprado ──
await escenario("S0", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3500 });
  const ws = desde(b, 0);
  ok("S0_sync_completa_oc_con_datos_faltantes", cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc9" && w.cuerpo.rut_cliente) === 1, ws.filter((w) => w.metodo !== "RPC"));
  ok("S0_sync_no_toca_fecha_de_compra", cuenta(ws, "PATCH", "eventos_compra") === 0 && b.db.eventos_compra.find((e) => e.id === "ec9").fecha === dias(12));
  ok("S0_sync_no_reemplaza_producto_comprado", cuenta(ws, "PATCH", "oc_productos_link", (w) => w.id === "l9c") === 0 && b.db.oc_productos_link.find((l) => l.id === "l9c").origen === "compra");
  ok("S0_sync_completa_solo_lo_vendido", cuenta(ws, "PATCH", "oc_productos_link", (w) => w.id === "l9v") === 1);
  ok("S0_fecha_oc_desde_mp", b.db.ordenes_compra_v2.find((o) => o.id === "oc9").fecha_emision_mp === dias(31));
  ok("S0_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S1: "Actualizar fecha y datos desde Mercado Público" cambia la fecha de la OC, nunca la de compra ──
await escenario("S1", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2001-101-SE26");
  const n = b.escr.length;
  await boton(p, /Actualizar fecha y datos desde Mercado Público/); await espera(p, 1800);
  const ws = desde(b, n);
  ok("S1_actualiza_fecha_de_la_oc", cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc1" && w.cuerpo.fecha_emision_mp === dias(41)) === 1, ws);
  ok("S1_no_toca_fecha_de_compra", cuenta(ws, "PATCH", "eventos_compra") === 0 && b.db.eventos_compra.find((e) => e.id === "ec1").fecha === dias(30));
  ok("S1_historial_fecha_de_la_oc", cuenta(ws, "POST", "historial_cambios", (w) => w.cuerpo.accion === "Fecha de la OC actualizada desde Mercado Público") === 1);
  // Detalle: muestra las dos fechas por separado
  await p.getByRole("button", { name: /Productos y números/ }).first().click(); await espera(p, 400);
  const t = await texto(p);
  ok("S1_detalle_muestra_fecha_oc_y_compra", /Fecha de la OC/.test(t) && /Compra \(fecha real\)/.test(t));
  ok("S1_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S2: "Corregir fechas de todas contra MP" (Administración) no reemplaza ninguna fecha de compra ──
await escenario("S2", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "usuarios");
  const n = b.escr.length;
  await boton(p, /Corregir fechas de todas contra Mercado Público/); await espera(p, 4500);
  const ws = desde(b, n);
  ok("S2_revisa_oc_contra_mp", b.llamadasMP.length >= 8, b.llamadasMP);
  ok("S2_no_toca_ninguna_fecha_de_compra", cuenta(ws, "PATCH", "eventos_compra") === 0 && cuenta(ws, "POST", "eventos_compra") === 0);
  ok("S2_404_marca_no_en_mp", cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc2" && w.cuerpo.no_en_mp === true) === 1, ws.filter((w) => w.tabla === "ordenes_compra_v2"));
  ok("S2_texto_explica_fechas", /fecha real de compra/.test(await texto(p)));
  ok("S2_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S3: Editar datos: la fecha de la OC es fecha_emision_mp (solo editable si no viene de MP) ──
await escenario("S3", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2001-101-SE26");
  await boton(p, /Editar datos/); await espera(p, 500);
  const m = enModal(p);
  ok("S3_mp_fecha_oc_solo_lectura", (await m.locator("[data-fecha-oc-mp]").count()) === 1 && (await m.locator("input[type=date]").count()) === 0);
  let n = b.escr.length;
  await boton(p, /Guardar datos/, m); await espera(p, 1500);
  let ws = desde(b, n);
  ok("S3_mp_guardar_no_toca_fechas", cuenta(ws, "PATCH", "eventos_compra") === 0 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc1" && "fecha_emision_mp" in w.cuerpo) === 0 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc1") === 1, ws);
  // Venta directa: la fecha de la OC se edita y queda en fecha_emision_mp
  await irA(p, "compras"); await abrirOC(p, "VD-006");
  await boton(p, /Editar datos/); await espera(p, 500);
  const m2 = enModal(p);
  await m2.locator("input[type=date]").fill(dias(16));
  n = b.escr.length;
  await boton(p, /Guardar datos/, m2); await espera(p, 1500);
  ws = desde(b, n);
  ok("S3_manual_fecha_oc_en_fecha_emision", cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc6" && w.cuerpo.fecha_emision_mp === dias(16)) === 1, ws);
  ok("S3_manual_no_toca_fecha_compra", cuenta(ws, "PATCH", "eventos_compra") === 0 && b.db.eventos_compra.find((e) => e.id === "ec6").fecha === dias(15));
  ok("S3_historial_fecha_oc", cuenta(ws, "POST", "historial_cambios", (w) => w.cuerpo.accion === "Fecha de la OC corregida") === 1);
  // Código duplicado (normalizado) y archivado al editar
  await irA(p, "compras"); await abrirOC(p, "VD-006");
  await boton(p, /Editar datos/); await espera(p, 500);
  const m3 = enModal(p);
  const codigo = m3.locator("input").filter({ hasNot: p.locator("[type=date]") }).nth(0);
  await m3.getByText("Código de la OC").locator("..").locator("input").fill("2001 101 se26"); await espera(p, 300);
  ok("S3_editar_detecta_duplicado_normalizado", /ya está cargada/.test(await m3.innerText()));
  await m3.getByText("Código de la OC").locator("..").locator("input").fill("N° 2010-110-SE26"); await espera(p, 300);
  ok("S3_editar_detecta_duplicado_archivado", /archivada/.test(await m3.innerText()));
  n = b.escr.length; await boton(p, /Guardar datos/, m3); await espera(p, 800);
  ok("S3_duplicado_no_guarda", cuenta(desde(b, n), "PATCH", "ordenes_compra_v2") === 0);
  void codigo;
  ok("S3_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S4: Nueva OC desde Mercado Público: 404, caída, cancelada, no aceptada y duplicados ──
await escenario("S4", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const abrirNueva = async () => { await boton(p, /^\+ Nueva OC$/); await espera(p, 500); return enModal(p); };
  const buscar = async (m, cod) => { await m.locator("input").last().fill(cod); await boton(p, /Buscar OC/, m); await espera(p, 900); };
  let m = await abrirNueva();
  ok("S4_sin_vendedor_por_defecto_avisa", (await m.locator('[data-aviso="sin-vendedor"]').count()) === 1);
  await m.locator("select").first().selectOption("v1");
  await buscar(m, "4001-1-SE26");
  ok("S4_404_muestra_no_disponible", (await m.locator('[data-estado-mp="no_disponible"]').count()) === 1);
  await m.locator('input[placeholder="https://…"]').first().fill("https://tienda.cl/x");
  let n = b.escr.length;
  await boton(p, /Crear OC/, m); await espera(p, 1500);
  let ws = desde(b, n);
  ok("S4_404_guarda_pendiente", cuenta(ws, "POST", "ordenes_compra_v2", (w) => w.cuerpo.numero_oc === "4001-1-SE26" && w.cuerpo.sync_pendiente === true && w.cuerpo.vendedor_id === "v1") === 1, ws);
  m = await abrirNueva(); await m.locator("select").first().selectOption("v1");
  await buscar(m, "4002-2-SE26");
  ok("S4_502_muestra_error_sin_pendiente", /no respondió/.test(await m.innerText()) && (await m.locator("[data-estado-mp]").count()) === 0);
  await buscar(m, "4003-3-SE26");
  ok("S4_cancelada_muestra_aviso", (await m.locator('[data-estado-mp="cancelada"]').count()) === 1);
  await m.locator('input[placeholder="https://…"]').first().fill("https://tienda.cl/y");
  n = b.escr.length; await boton(p, /Crear OC/, m); await espera(p, 600);
  ok("S4_cancelada_exige_confirmacion", cuenta(desde(b, n), "POST", "ordenes_compra_v2") === 0 && /figura cancelada/.test(await m.innerText()));
  await m.locator('[data-estado-mp="cancelada"] input[type=checkbox]').check();
  n = b.escr.length; await boton(p, /Crear OC/, m); await espera(p, 1500);
  ok("S4_cancelada_confirmada_se_crea", cuenta(desde(b, n), "POST", "ordenes_compra_v2", (w) => w.cuerpo.numero_oc === "4003-3-SE26") === 1);
  m = await abrirNueva(); await m.locator("select").first().selectOption("v2");
  await buscar(m, "4004-4-SE26");
  ok("S4_no_aceptada_muestra_aviso", (await m.locator('[data-estado-mp="sin_aceptar"]').count()) === 1);
  await boton(p, /Atrás/, m); await espera(p, 300);
  const antes = b.llamadasMP.length;
  await buscar(m, "2001 101 se26");
  ok("S4_duplicado_activo_sin_consultar_mp", /ya está cargada/.test(await m.innerText()) && b.llamadasMP.length === antes);
  await buscar(m, "Nº 2010-110-SE26");
  ok("S4_duplicado_archivado", /archivada/.test(await m.innerText()) && b.llamadasMP.length === antes);
  ok("S4_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S5: carga masiva: vendedor obligatorio, venta propia, canceladas y no disponibles no se cargan ──
await escenario("S5", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await p.getByRole("button", { name: /^Mercado Público/ }).first().click(); await espera(p, 500);
  const t0 = await texto(p);
  ok("S5_lista_excluye_ya_cargadas", /3 OCs aceptadas en MP sin registrar/.test(t0), t0.match(/\d+ OCs? aceptadas?[^\n]*/)?.[0]);
  await boton(p, /Cargar las 3 de una vez/); await espera(p, 400);
  const form = p.locator("[data-carga-masiva]");
  const confirmar = form.getByRole("button", { name: /Cargar las 3 con este vendedor/ });
  ok("S5_exige_vendedor", (await confirmar.isDisabled()));
  await form.locator("select").selectOption("v2"); await espera(p, 200);
  await form.locator("input[type=checkbox]").check();
  const n = b.escr.length;
  await confirmar.click(); await espera(p, 3000);
  const ws = desde(b, n);
  const creadas = ws.filter((w) => w.metodo === "POST" && w.tabla === "ordenes_compra_v2");
  ok("S5_solo_carga_la_aceptada", creadas.length === 1 && creadas[0].cuerpo.numero_oc === "3001-1-SE26", creadas.map((c) => c.cuerpo.numero_oc));
  ok("S5_con_vendedor_y_venta_propia", creadas[0]?.cuerpo.vendedor_id === "v2" && creadas[0]?.cuerpo.es_venta_propia === true);
  ok("S5_resumen_informa_cancelada", /cancelada/.test(await texto(p)));
  ok("S5_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S6: contadores del Panel = listas exactas; OCs sin vendedor advertidas ──
await escenario("S6", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3500 });
  const ocsApp = () => {
    const filas = b.leer("ordenes_compra_v2", new URLSearchParams("select=*,eventos_compra(*)")).filter((o) => !o.archivada);
    return filas.map((o) => ({ ...o, eventos_postventa: b.db.eventos_postventa.filter((e) => e.oc_id === o.id) }));
  };
  const items = await p.locator("[data-prioridad]").evaluateAll((els) => els.map((e) => ({ k: e.getAttribute("data-prioridad"), n: Number(e.getAttribute("data-n")) })));
  ok("S6_panel_muestra_todos_los_contadores", ["vale_vista", "vencidas", "por_vencer", "entregadas_sin_factura", "compradas_sin_entregar", "mp_sin_comprar", "sin_vendedor"].every((k) => items.some((i) => i.k === k)), items);
  for (const it of items) {
    await irA(p, "panel");
    await p.locator(`[data-prioridad="${it.k}"]`).click(); await espera(p, 900);
    const banner = await p.locator(`[data-filtro-exacto="${it.k}"]`).count();
    const filas = await p.locator("[data-oc]").evaluateAll((els) => els.map((e) => e.getAttribute("data-oc")));
    const esperado = ocsApp().filter(FILTROS_PANEL[it.k].pred).map((o) => o.numero_oc).sort();
    ok(`S6_${it.k}_abre_exactamente_las_contadas`, banner === 1 && filas.length === it.n && JSON.stringify([...filas].sort()) === JSON.stringify(esperado), { n: it.n, filas, esperado });
  }
  await irA(p, "compras");
  ok("S6_fila_marca_sin_vendedor", (await p.locator('[data-oc="2005-105-SE26"] [data-aviso="sin-vendedor"]').count()) === 1 && (await p.locator('[data-oc="2001-101-SE26"] [data-aviso="sin-vendedor"]').count()) === 0);
  await irA(p, "notif");
  const ta = await texto(p);
  ok("S6_alerta_oc_abierta_sin_vendedor", /OC sin vendedor[\s\S]{0,200}2005-105-SE26/.test(ta) && !/OC sin vendedor[\s\S]{0,200}2008-108-SE26/.test(ta));
  await irA(p, "vendedores");
  ok("S6_vendedores_advierte", /2 OC sin vendedor/.test(await p.locator('[data-aviso="ocs-sin-vendedor"]').innerText()));
  await p.locator('[data-aviso="ocs-sin-vendedor"]').getByRole("button", { name: /Ver OCs/ }).click(); await espera(p, 900);
  ok("S6_vendedores_abre_lista_exacta", (await p.locator('[data-filtro-exacto="sin_vendedor"]').count()) === 1 && (await p.locator("[data-oc]").count()) === 2);
  ok("S6_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S7: criterio único de "entregada" (registros anteriores "entregado") en filtros, Agenda y Alertas ──
await escenario("S7", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  await p.getByRole("button", { name: /Filtros avanzados/ }).first().click(); await espera(p, 300);
  await p.getByRole("button", { name: /^Entregada$/ }).click(); await espera(p, 500);
  let filas = await p.locator("[data-oc]").evaluateAll((els) => els.map((e) => e.getAttribute("data-oc")));
  ok("S7_filtro_entregada_incluye_entregado", filas.includes("2003-103-SE26"), filas);
  await p.getByRole("button", { name: /^Entregada$/ }).click(); await p.getByRole("button", { name: /^Sin entregar$/ }).click(); await espera(p, 500);
  filas = await p.locator("[data-oc]").evaluateAll((els) => els.map((e) => e.getAttribute("data-oc")));
  ok("S7_filtro_sin_entregar_excluye_entregado", !filas.includes("2003-103-SE26") && filas.includes("2001-101-SE26"), filas);
  await irA(p, "agenda");
  const tg = await texto(p);
  ok("S7_agenda_cuenta_una_atrasada", /1 entrega atrasada/.test(tg), tg.match(/\d+ entregas? atrasadas?/)?.[0]);
  await p.getByRole("button", { name: /Ver alertas/ }).first().click(); await espera(p, 700);
  const tl = await texto(p);
  ok("S7_alertas_coinciden_con_agenda", (tl.match(/Entrega atrasada/g) || []).length === 1 && /2001-101-SE26/.test(tl) && !/2003-103-SE26/.test(tl));
  ok("S7_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S8: repartir la inversión solo cambia el precio de compra; editar sin cambios no escribe ──
await escenario("S8", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2001-101-SE26");
  await p.getByRole("button", { name: /Productos y números/ }).first().click(); await espera(p, 400);
  await boton(p, /repartir/i); await espera(p, 300);
  await p.locator('input[type=number]').last().fill("600000");
  const n = b.escr.length;
  await p.getByRole("button", { name: /^Repartir$/ }).click(); await espera(p, 2000);
  const ws = desde(b, n);
  const pats = ws.filter((w) => w.metodo === "PATCH" && w.tabla === "oc_productos_link");
  ok("S8_reparto_solo_precio_compra", pats.length === 2 && pats.every((w) => Object.keys(w.cuerpo).join() === "precio_compra"), pats);
  ok("S8_reparto_suma_total", pats.reduce((s, w) => s + w.cuerpo.precio_compra, 0) === 600000);
  const a = b.db.oc_productos_link.find((l) => l.id === "l1a");
  ok("S8_no_borra_cantidad_precio_venta_direccion", a.cantidad === 2 && a.precio_venta === 300000 && a.direccion_entrega === "Bodega Norte" && a.url === "https://tienda.cl/a", a);
  const hist = ws.filter((w) => w.metodo === "POST" && w.tabla === "historial_cambios");
  ok("S8_un_solo_registro_de_historial_real", hist.length === 1 && /Inversión repartida/.test(hist[0].cuerpo.accion), hist.map((h) => h.cuerpo.accion));
  // Editar un producto sin cambiar nada: no escribe
  await p.getByRole("button", { name: /^Editar$/ }).first().click(); await espera(p, 300);
  const n2 = b.escr.length;
  await p.getByRole("button", { name: /^Guardar$/ }).click(); await espera(p, 900);
  ok("S8_editar_sin_cambios_no_escribe", desde(b, n2).filter((w) => w.metodo !== "RPC").length === 0, desde(b, n2));
  ok("S8_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S9: Agenda: fijar una fecha nunca crea una compra ──
await escenario("S9", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "agenda");
  await p.locator("button").filter({ hasText: /^15$/ }).first().click(); await espera(p, 300);
  await boton(p, /Marcar entrega estimada/); await espera(p, 300);
  await p.locator('input[placeholder="ej: 2436-690-AG26"]').fill("2005-105-SE26");
  let n = b.escr.length;
  await p.getByRole("button", { name: /✓ Marcar entrega estimada/ }).click(); await espera(p, 900);
  ok("S9_sin_compra_no_crea_evento", desde(b, n).filter((w) => w.metodo !== "RPC").length === 0 && b.db.eventos_compra.filter((e) => e.oc_id === "oc5").length === 0);
  ok("S9_explica_que_falta_la_compra", /no tiene compra registrada/.test(await texto(p)));
  await p.locator('input[placeholder="ej: 2436-690-AG26"]').fill("VD-006");
  n = b.escr.length;
  await p.getByRole("button", { name: /✓ Marcar entrega estimada/ }).click(); await espera(p, 1200);
  const ws = desde(b, n).filter((w) => w.metodo === "PATCH");
  ok("S9_con_compra_solo_fija_entrega_estimada", ws.length === 1 && ws[0].tabla === "eventos_compra" && Object.keys(ws[0].cuerpo).join() === "fecha_entrega_estimada", ws);
  ok("S9_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S10: borrados: sin confirmación de la base no se ajustan estados ni saldos ──
async function borrar(b, numero, etapa, nombreBoton = /Eliminar/) {
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, numero);
  await p.locator(`[data-etapa="${etapa}"]`).click(); await espera(p, 300);
  const det = p.locator(`[data-detalle-etapa="${etapa}"]`);
  if (!(await det.count())) { await p.locator(`[data-etapa="${etapa}"]`).click(); await espera(p, 300); }
  const n = b.escr.length;
  await det.getByRole("button", { name: nombreBoton }).first().click(); await espera(p, 1800);
  const ws = desde(b, n); const t = await texto(p);
  await ctx.close();
  return { ws, t, errs };
}
await escenario("S10", async () => {
  let b = base0({ eventos_pago_financiamiento: "rls" });
  let r = await borrar(b, "2007-107-SE26", "financ");
  ok("S10_rls_no_ajusta_saldo_ni_estado", cuenta(r.ws, "DELETE", "eventos_pago_financiamiento") === 1 && cuenta(r.ws, "PATCH", "financiadores") === 0 && cuenta(r.ws, "PATCH", "ordenes_compra_v2") === 0 && cuenta(r.ws, "POST", "historial_cambios") === 0, r.ws);
  ok("S10_rls_avisa", /no eliminó el registro/.test(r.t) && b.db.financiadores[0].saldo_deuda === 2500000);
  b = base0({ eventos_pago_financiamiento: "error" });
  r = await borrar(b, "2007-107-SE26", "financ");
  ok("S10_error_no_ajusta", cuenta(r.ws, "PATCH", "financiadores") === 0 && cuenta(r.ws, "PATCH", "ordenes_compra_v2") === 0 && /rechazó la eliminación/.test(r.t), r.ws);
  b = base0();
  r = await borrar(b, "2007-107-SE26", "financ");
  ok("S10_confirmado_si_ajusta", cuenta(r.ws, "PATCH", "financiadores") === 1 && cuenta(r.ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc7") === 1 && cuenta(r.ws, "POST", "historial_cambios") === 1, r.ws);
  b = base0({ eventos_factura: "rls" });
  r = await borrar(b, "2004-104-SE26", "factura");
  ok("S10_factura_no_confirmada_no_ajusta", cuenta(r.ws, "PATCH", "ordenes_compra_v2") === 0 && b.db.ordenes_compra_v2.find((o) => o.id === "oc4").estado_factura_propia === "emitida", r.ws);
  b = base0();
  r = await borrar(b, "2004-104-SE26", "entrega");
  ok("S10_entrega_con_otra_registrada_sigue_entregada", cuenta(r.ws, "DELETE", "eventos_entrega") === 1 && cuenta(r.ws, "PATCH", "ordenes_compra_v2") === 0 && b.db.ordenes_compra_v2.find((o) => o.id === "oc4").estado_entrega === "confirmada", r.ws);
  b = base0();
  r = await borrar(b, "2011-111-SE26", "postventa");
  ok("S10_postventa_recalcula_estado", cuenta(r.ws, "PATCH", "ordenes_compra_v2", (w) => w.id === "oc11" && w.cuerpo.estado_postventa === "sin_incidencias") === 1, r.ws);
  for (const x of [r]) ok("S10_sin_errores", x.errs.length === 0, x.errs);
  // Producto y nota: sin confirmación no hay historial ni cambios
  b = base0({ oc_productos_link: "rls", oc_comentarios: "rls" });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2001-101-SE26");
  await p.getByRole("button", { name: /Productos y números/ }).first().click(); await espera(p, 400);
  let n = b.escr.length;
  await p.getByRole("button", { name: /^Eliminar$/ }).first().click(); await espera(p, 1200);
  ok("S10_producto_no_confirmado_sin_historial", cuenta(desde(b, n), "POST", "historial_cambios") === 0 && b.db.oc_productos_link.length === 5 && /no eliminó/.test(await texto(p)));
  await p.getByRole("button", { name: /Notas e historial/ }).click(); await espera(p, 300);
  n = b.escr.length;
  await p.getByRole("button", { name: "✕" }).last().click(); await espera(p, 1000);
  ok("S10_nota_no_confirmada_avisa", cuenta(desde(b, n), "DELETE", "oc_comentarios") === 1 && b.db.oc_comentarios.length === 1 && /no eliminó/.test(await texto(p)));
  ok("S10_sin_errores_ui", errs.length === 0, errs);
  await ctx.close();
});

// ── S11: alta manual: duplicado normalizado, vendedor explícito, venta propia, IVA claro ──
await escenario("S11", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const abrirManual = async () => { await boton(p, /^\+ Nueva OC$/); await espera(p, 400); await boton(p, /Ingresar manualmente/); await espera(p, 400); return enModal(p); };
  let m = await abrirManual();
  const selVend = m.locator("select").first();
  ok("S11_vendedor_no_preseleccionado", (await selVend.inputValue()) === "");
  const codigo = m.getByPlaceholder("ej: 2436-690-AG26");
  await codigo.fill("2001 101 se26"); await espera(p, 200);
  ok("S11_duplicado_aviso_inmediato", (await m.locator('[data-aviso="codigo-duplicado"]').count()) === 1);
  await boton(p, /Siguiente/, m); await espera(p, 300);
  ok("S11_duplicado_bloquea", /ya está cargada/.test(await m.innerText()) && (await m.getByPlaceholder("ej: 2436-690-AG26").count()) === 1);
  await codigo.fill("VD-NUEVA-1"); await m.getByPlaceholder("ej: Municipalidad de Concepción").fill("Cliente Manual");
  await boton(p, /Siguiente/, m); await espera(p, 300);
  ok("S11_exige_elegir_vendedor", /Elige el vendedor/.test(await m.innerText()));
  await selVend.selectOption("v2"); await espera(p, 200);
  await m.getByText("Es venta propia del vendedor").click();
  await boton(p, /Siguiente/, m); await espera(p, 300);
  const t2 = await m.innerText();
  ok("S11_precios_con_iva_explicito", /P\. Compra unit\. con IVA/i.test(t2) && /P\. Venta unit\. con IVA/i.test(t2) && /IVA incluido/.test(t2), t2.slice(0, 300));
  await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Mesa de reunión");
  const nums = m.locator("input[type=number]");
  await nums.nth(1).fill("100000"); await nums.nth(2).fill("238000"); await espera(p, 200);
  ok("S11_desglose_neto_iva", /neto \$200\.000 \+ IVA \$38\.000/.test(await m.locator("[data-desglose-iva]").innerText()));
  await boton(p, /Siguiente/, m); await espera(p, 300); await boton(p, /Siguiente/, m); await espera(p, 300);
  ok("S11_resumen_vendedor_y_fecha", /venta propia/.test(await m.innerText()) && /Fecha de la OC/.test(await m.innerText()));
  let n = b.escr.length;
  await boton(p, /Crear OC/, m); await espera(p, 1800);
  let ws = desde(b, n);
  const nueva = ws.find((w) => w.metodo === "POST" && w.tabla === "ordenes_compra_v2");
  ok("S11_crea_con_vendedor_venta_propia_y_fecha", nueva && nueva.cuerpo.vendedor_id === "v2" && nueva.cuerpo.es_venta_propia === true && nueva.cuerpo.fecha_emision_mp === new Date().toISOString().slice(0, 10) && nueva.cuerpo.monto_total === 238000, nueva?.cuerpo);
  ok("S11_venta_propia_no_suma_deuda", cuenta(ws, "PATCH", "financiadores") === 0 && cuenta(ws, "POST", "eventos_compra") === 1);
  ok("S11_historial_oc_creada", cuenta(ws, "POST", "historial_cambios", (w) => /OC creada/.test(w.cuerpo.accion)) === 1);
  // "Sin vendedor" elegido a propósito: se guarda sin vendedor y la compra suma deuda (regla de siempre)
  m = await abrirManual();
  await m.getByPlaceholder("ej: 2436-690-AG26").fill("VD-NUEVA-2"); await m.getByPlaceholder("ej: Municipalidad de Concepción").fill("Cliente Dos");
  await m.locator("select").first().selectOption({ label: "Sin vendedor (no entra en comisiones)" });
  await boton(p, /Siguiente/, m); await espera(p, 300);
  await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Lámpara");
  const nums2 = m.locator("input[type=number]"); await nums2.nth(1).fill("50000"); await nums2.nth(2).fill("119000");
  await boton(p, /Siguiente/, m); await espera(p, 300); await boton(p, /Siguiente/, m); await espera(p, 300);
  n = b.escr.length; await boton(p, /Crear OC/, m); await espera(p, 1800);
  ws = desde(b, n);
  const nueva2 = ws.find((w) => w.metodo === "POST" && w.tabla === "ordenes_compra_v2");
  ok("S11_sin_vendedor_explicito", nueva2 && nueva2.cuerpo.vendedor_id === null && nueva2.cuerpo.es_venta_propia === false && cuenta(ws, "PATCH", "financiadores") === 1, nueva2?.cuerpo);
  ok("S11_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── S12: regresión completa del ciclo de una OC (crear → comprar → entregar → facturar → cobrar → pagar → post-venta → notas → editar → archivar) ──
await escenario("S12", async () => {
  const b = base0();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const n0 = b.escr.length;
  await boton(p, /^\+ Nueva OC$/); await espera(p, 400);
  let m = enModal(p);
  await m.locator("select").first().selectOption("v1");
  await m.locator("input").last().fill("4005-5-SE26"); await boton(p, /Buscar OC/, m); await espera(p, 900);
  await m.locator('input[placeholder="https://…"]').first().fill("https://tienda.cl/monitor");
  await boton(p, /Crear OC/, m); await espera(p, 1800);
  const ocN = b.db.ordenes_compra_v2.find((o) => o.numero_oc === "4005-5-SE26");
  ok("S12_creada", !!ocN && ocN.vendedor_id === "v1");
  await irA(p, "compras"); await abrirOC(p, "4005-5-SE26");
  const paso = async (nombre, accion) => { const n = b.escr.length; await accion(); await espera(p, 1700); return desde(b, n); };
  let ws = await paso("compra", async () => {
    await boton(p, /Registrar compra/); await espera(p, 400); m = enModal(p);
    await boton(p, /Siguiente/, m); await espera(p, 200);
    await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Monitor 24");
    const nums = m.locator("input[type=number]"); await nums.nth(1).fill("700000"); await nums.nth(2).fill("1190000");
    await boton(p, /Siguiente/, m); await espera(p, 200); await boton(p, /Siguiente/, m); await espera(p, 200);
    await boton(p, /Registrar compra/, m);
  });
  ok("S12_compra", cuenta(ws, "POST", "eventos_compra") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_compra === "comprado") === 1 && cuenta(ws, "PATCH", "financiadores") === 1, ws);
  ws = await paso("entrega", async () => { await boton(p, /Confirmar entrega/); await espera(p, 400); m = enModal(p); await boton(p, /Confirmar entrega/, m); });
  ok("S12_entrega", cuenta(ws, "POST", "eventos_entrega") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_entrega === "confirmada") === 1, ws);
  ws = await paso("factura", async () => { await boton(p, /Emitir factura/); await espera(p, 400); m = enModal(p); await m.getByPlaceholder("ej: 215").fill("9001"); await boton(p, /Registrar factura/, m); });
  ok("S12_factura", cuenta(ws, "POST", "eventos_factura") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_factura_propia === "emitida") === 1, ws);
  ws = await paso("cobro", async () => { await boton(p, /Registrar cobro/); await espera(p, 400); m = enModal(p); await boton(p, /Registrar pago/, m); });
  ok("S12_cobro", cuenta(ws, "POST", "eventos_pago_cliente") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_pago_cliente === "pagado") === 1, ws);
  ws = await paso("financ", async () => { await boton(p, /Registrar pago/); await espera(p, 400); m = enModal(p); await m.locator("input[type=number]").fill("700000"); await boton(p, /Registrar pago a financiador/, m); });
  ok("S12_pago_financiador_por_rpc", cuenta(ws, "RPC", "registrar_pago_financiador") === 1, ws);
  ok("S12_cerrada", /Cerrada/.test(await p.locator('[data-oc="4005-5-SE26"]').innerText()));
  ws = await paso("postventa", async () => {
    await p.locator('[data-etapa="postventa"]').click(); await espera(p, 300);
    await boton(p, /Registrar incidencia/); await espera(p, 400); m = enModal(p);
    await m.getByPlaceholder("Qué informó el cliente").fill("Pantalla con pixel muerto"); await boton(p, /Registrar incidencia/, m);
  });
  ok("S12_postventa_abierta", cuenta(ws, "POST", "eventos_postventa") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_postventa === "con_incidencia") === 1, ws);
  ws = await paso("cierre", async () => {
    await p.locator('[data-etapa="postventa"]').click(); await espera(p, 300);
    if (!(await p.locator('[data-detalle-etapa="postventa"]').count())) { await p.locator('[data-etapa="postventa"]').click(); await espera(p, 300); }
    await p.locator('[data-detalle-etapa="postventa"]').getByRole("button", { name: /Cerrar incidente/ }).click(); await espera(p, 400); m = enModal(p);
    await m.getByPlaceholder("Qué se hizo para resolverlo").fill("Se cambió el monitor"); await boton(p, /Cerrar incidente/, m);
  });
  ok("S12_postventa_cerrada", cuenta(ws, "PATCH", "eventos_postventa") === 1 && cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.estado_postventa === "resuelta") === 1, ws);
  ws = await paso("nota", async () => { await p.getByRole("button", { name: /Notas e historial/ }).click(); await espera(p, 300); await p.getByPlaceholder("Agregar nota…").fill("Todo ok"); await p.keyboard.press("Enter"); });
  ok("S12_nota", cuenta(ws, "POST", "oc_comentarios") === 1, ws);
  ws = await paso("editar", async () => { await boton(p, /Editar datos/); await espera(p, 400); m = enModal(p); await m.locator("select").first().selectOption("v2"); await boton(p, /Guardar datos/, m); });
  ok("S12_editar_vendedor", cuenta(ws, "PATCH", "ordenes_compra_v2", (w) => w.cuerpo.vendedor_id === "v2") === 1 && cuenta(ws, "POST", "historial_cambios", (w) => w.cuerpo.accion === "Vendedor corregido") === 1, ws);
  ws = await paso("archivar", async () => { await boton(p, /Archivar esta OC/); });
  ok("S12_archivar_por_rpc", cuenta(ws, "RPC", "archivar_oc") === 1 && (await p.locator('[data-oc="4005-5-SE26"]').count()) === 0, ws);
  ok("S12_ninguna_escritura_a_fecha_de_compra_por_mp", cuenta(desde(b, n0), "PATCH", "eventos_compra") === 0);
  ok("S12_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

await browser.close();
const n = Object.keys(R).length;
console.log(`\nRESUMEN pruebas Fase 4A (interfaz): ${n - F.length} OK, ${F.length} FALLA(S)` + (F.length ? ` → ${F.join(", ")}` : ""));
process.exit(F.length ? 1 : 0);
