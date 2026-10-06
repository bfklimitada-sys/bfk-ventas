// Pruebas de interfaz de la Fase 4B (integridad financiera de OCs). Chromium + Playwright con Supabase simulado CON ESTADO:
// la base simulada calcula los totales desde los eventos (como la base real tras la migración), congela las diferencias
// históricas iniciales y ejecuta las mismas operaciones atómicas (RPC). Nada sale a la red.
// Uso: node docs/pruebas-financieras/e2e_fase4b.mjs http://127.0.0.1:4178/   (build servido con vite preview)
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const SOLO = process.env.SOLO ? new Set(process.env.SOLO.split(",")) : null;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const R = {}; const F = [];
const ok = (k, v, detalle) => { R[k] = !!v; if (!v) { F.push(k); console.log("FALLA " + k + (detalle !== undefined ? " :: " + JSON.stringify(detalle).slice(0, 500) : "")); } else console.log("OK    " + k); };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const desde = (b, n) => b.escr.slice(n);
const cuenta = (ws, metodo, tabla, f = () => true) => ws.filter((w) => w.metodo === metodo && w.tabla === tabla && f(w)).length;
const texto = async (p) => p.evaluate(() => document.body.innerText);
const escritorio = { ancho: 1440, alto: 900, movil: false };
const DERIVADAS = ["costo_total", "estado_compra", "monto_pagado_fin", "estado_pago_financiamiento", "monto_facturado", "estado_factura_propia", "monto_cobrado", "estado_pago_cliente"];
// Ninguna escritura del navegador fija totales: ni saldo del financiador ni totales/estados financieros de la OC.
const sinTotalesDelNavegador = (ws) => cuenta(ws, "PATCH", "financiadores") === 0
  && ws.filter((w) => w.tabla === "ordenes_compra_v2" && (w.metodo === "PATCH" || w.metodo === "POST") && DERIVADAS.some((k) => w.cuerpo && k in w.cuerpo)).length === 0
  && cuenta(ws, "PATCH", "eventos_compra") === 0 && cuenta(ws, "PATCH", "eventos_pago_financiamiento") === 0;
async function irA(p, k) { await p.locator(`aside [data-nav="${k}"]`).click(); await espera(p, 700); }
async function abrirOC(p, numero) {
  if (await p.locator(`[data-oc="${numero}"] [data-testid="oc-campos"]`).count()) return;
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
// Abre (sin cerrar si ya está abierto) el detalle de una etapa de la OC.
async function etapa(p, numero, key) {
  await abrirOC(p, numero);
  const fila = p.locator(`[data-oc="${numero}"]`);
  const det = fila.locator(`[data-detalle-etapa="${key}"]`);
  if (!(await det.count())) { await fila.locator(`[data-etapa="${key}"]`).click(); await espera(p, 350); }
  return det;
}
const enModal = (p) => p.locator("[role=dialog]").last();
const escenario = async (nombre, fn) => {
  if (SOLO && !SOLO.has(nombre)) return;
  try { await fn(); } catch (e) { ok(`${nombre}_sin_excepcion`, false, e.message); }
};

// ── Datos: los de la Fase 4A más los casos financieros de la Fase 4B ──
function datos4b() {
  const d = crearDatos();
  const modelo = d.ordenes_compra_v2.find((o) => o.id === "oc1");
  const nueva = (i, numero, o = {}) => ({ ...JSON.parse(JSON.stringify(modelo)), id: "oc" + i, numero_oc: numero, cliente: "MUNICIPALIDAD FICTICIA " + i,
    rut_cliente: `69.${100 + i}.000-${i % 10}`, monto_total: 1190000 + i * 10000, estado_entrega: "pendiente", estado_factura_propia: "pendiente",
    estado_pago_cliente: "pendiente", monto_facturado: 0, monto_cobrado: 0, monto_pagado_fin: 0, ...o });
  const compra = (i, costo, fin, o = {}) => ({ id: "ec" + i, oc_id: "oc" + i, fecha: dias(20 + i), monto_venta: 1190000 + i * 10000, costo_compra: costo, fecha_entrega_estimada: null, financiador_id: fin, proveedor: "Proveedor " + i, ...o });
  d.ordenes_compra_v2.push(
    nueva(12, "2012-112-SE26", { es_venta_propia: true, vendedor_id: "v1", financiador_id: "f1", costo_total: 300000, estado_pago_financiamiento: "no_aplica" }),   // venta propia
    nueva(13, "2013-113-SE26", { financiador_id: "f2", costo_total: 400000, estado_pago_financiamiento: "no_aplica" }),                                             // fondos propios (Cuenta BFK)
    nueva(14, "2014-114-SE26", { financiador_id: "f1", costo_total: 500000, estado_pago_financiamiento: "pagado" }),                                                // estado histórico sin pagos
    nueva(15, "2015-115-SE26", { financiador_id: "f1", costo_total: 450000, estado_entrega: "confirmada", estado_factura_propia: "emitida", monto_facturado: 600000 }), // factura repetida
    nueva(16, "2016-116-SE26", { financiador_id: "f4", costo_total: 100000, monto_pagado_fin: 100000, estado_pago_financiamiento: "pagado" }),                       // financiador con saldo a favor
  );
  d.eventos_compra.push(compra(12, 300000, "f1"), compra(13, 400000, "f2"), compra(14, 500000, "f1"), compra(15, 450000, "f1"), compra(16, 100000, "f4"));
  d.eventos_entrega.push({ id: "en15", oc_id: "oc15", fecha: dias(9) });
  d.eventos_factura.push({ id: "fa15a", oc_id: "oc15", fecha: dias(8), numero_factura: "715", monto: 600000 }, { id: "fa15b", oc_id: "oc15", fecha: dias(8), numero_factura: "715", monto: 600000 });
  d.eventos_pago_financiamiento.push(
    { id: "pf16", oc_id: "oc16", financiador_id: "f4", fecha: dias(6), monto: 100000 },
    { id: "pfs3", oc_id: null, financiador_id: "f3", fecha: dias(30), monto: 1000000 },   // pago suelto con saldo guardado 0 (diferencia histórica del financiador)
    { id: "pfs4", oc_id: null, financiador_id: "f4", fecha: dias(5), monto: 150000 },     // sobrepago: deja 150.000 a favor de BFK
  );
  d.financiadores.push({ id: "f3", nombre: "Financiador Tres", saldo_deuda: 0 }, { id: "f4", nombre: "Financiador Cuatro", saldo_deuda: -150000 });
  return d;
}
const base4b = (borrado = {}) => crearBase(datos4b(), { mp: RESPUESTAS_MP, borrado });
const oc = (b, id) => b.db.ordenes_compra_v2.find((o) => o.id === id);
const fin = (b, id) => b.db.financiadores.find((f) => f.id === id);

// ── B1: venta propia → financiamiento "no aplica", sin pago ficticio para cerrar, fuera de la deuda ──
await escenario("B1", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const det = await etapa(p, "2012-112-SE26", "financ");
  ok("B1_venta_propia_financiamiento_no_aplica", (await det.locator('[data-financiamiento="no_aplica"]').count()) === 1 && /Venta propia/.test(await det.innerText()), await det.innerText());
  ok("B1_venta_propia_sin_registrar_pago", (await det.getByRole("button", { name: /Registrar pago/ }).count()) === 0);
  ok("B1_etapa_financiamiento_cumplida", (await p.locator('[data-oc="2012-112-SE26"] [data-etapa="financ"]').innerText()).includes("✓"));
  const detC = await etapa(p, "2012-112-SE26", "compra");
  ok("B1_compra_muestra_tipo_venta_propia", (await detC.locator('[data-tipo-financiamiento="venta_propia"]').count()) === 1);
  // La cartola del financiador no incluye la venta propia (no genera deuda)
  await irA(p, "financiamiento");
  await p.getByText("Financiador Uno", { exact: true }).first().click(); await espera(p, 700);
  const t = await texto(p);
  ok("B1_cartola_sin_venta_propia", !/2012-112-SE26/.test(t) && /2001-101-SE26/.test(t));
  ok("B1_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B2: fondos propios (Cuenta BFK) → no es deuda, no recibe pagos ni abonos ──
await escenario("B2", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const det = await etapa(p, "2013-113-SE26", "financ");
  ok("B2_cuenta_bfk_financiamiento_no_aplica", (await det.locator('[data-financiamiento="no_aplica"]').count()) === 1 && (await det.getByRole("button", { name: /Registrar pago/ }).count()) === 0);
  const detC = await etapa(p, "2013-113-SE26", "compra");
  ok("B2_compra_muestra_fondos_propios", (await detC.locator('[data-tipo-financiamiento="fondos_propios"]').count()) === 1);
  // Pago a financiador desde una OC externa: Cuenta BFK no aparece como destino
  const detF = await etapa(p, "2001-101-SE26", "financ");
  await detF.getByRole("button", { name: /Registrar pago/ }).click(); await espera(p, 500);
  let opciones = await enModal(p).locator("select").first().locator("option").allInnerTexts();
  ok("B2_pago_financiador_sin_cuenta_bfk", opciones.length > 0 && !opciones.some((o) => /Cuenta BFK/.test(o)) && opciones.some((o) => /Financiador Uno/.test(o)), opciones);
  await p.keyboard.press("Escape"); await espera(p, 300);
  if (await p.locator("[role=dialog]").count()) { await enModal(p).getByRole("button", { name: /✕|Cerrar/ }).first().click().catch(() => {}); await espera(p, 300); }
  // Abono: tampoco
  await irA(p, "financiamiento");
  await p.getByRole("button", { name: /Abonar a un financiador/ }).click(); await espera(p, 500);
  opciones = await enModal(p).locator("select").first().locator("option").allInnerTexts();
  ok("B2_abono_sin_cuenta_bfk", !opciones.some((o) => /Cuenta BFK/.test(o)) && opciones.some((o) => /Financiador Cuatro/.test(o)), opciones);
  await p.keyboard.press("Escape"); await espera(p, 300);
  if (await p.locator("[role=dialog]").count()) { await enModal(p).getByRole("button", { name: /✕|Cerrar/ }).first().click().catch(() => {}); await espera(p, 300); }
  // Cartola de Cuenta BFK: explica que no es deuda y no ofrece abonar ni ajustar
  const sinDeuda = p.getByRole("button", { name: /financiadores? sin deuda/ });
  if (await sinDeuda.count()) { await sinDeuda.click(); await espera(p, 300); }
  await p.getByText("Cuenta BFK", { exact: true }).first().click(); await espera(p, 700);
  const t = await texto(p);
  ok("B2_cuenta_bfk_no_es_deuda", /Fondos propios \(Cuenta BFK\): no es deuda/.test(t) && (await p.getByRole("button", { name: /Abonar a Cuenta BFK/ }).count()) === 0
    && (await p.getByRole("button", { name: /Ajustar saldo manualmente/ }).count()) === 0);
  ok("B2_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B3: cambiar el financiamiento (M2) es una sola operación de la base que recalcula ambas deudas ──
await escenario("B3", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f1").saldo_deuda; const costo = oc(b, "oc1").costo_total;
  let det = await etapa(p, "2001-101-SE26", "compra");
  ok("B3_muestra_financiador_externo", (await det.locator('[data-tipo-financiamiento="externo"]').count()) === 1);
  await det.locator('[data-accion="cambiar-financiamiento"]').click(); await espera(p, 300);
  let f = p.locator('[data-form="cambiar-financiamiento"]');
  await f.locator("select").first().selectOption("fondos_propios"); await espera(p, 200);
  ok("B3_preselecciona_cuenta_propia", (await f.locator("select").nth(1).inputValue()) === "f2");
  let n = b.escr.length;
  await f.getByRole("button", { name: /Cambiar financiamiento/ }).click(); await espera(p, 1800);
  let ws = desde(b, n);
  ok("B3_una_rpc_cambiar_financiamiento", cuenta(ws, "RPC", "cambiar_financiamiento_oc", (w) => w.cuerpo.p_oc_id === "oc1" && w.cuerpo.p_tipo === "fondos_propios" && w.cuerpo.p_financiador_id === "f2") === 1, ws);
  ok("B3_navegador_no_escribe_totales", sinTotalesDelNavegador(ws) && cuenta(ws, "PATCH", "ordenes_compra_v2") === 0, ws);
  ok("B3_base_recalcula_deuda_y_etapa", oc(b, "oc1").estado_pago_financiamiento === "no_aplica" && oc(b, "oc1").financiador_id === "f2"
    && b.db.eventos_compra.find((e) => e.id === "ec1").financiador_id === "f2" && fin(b, "f1").saldo_deuda === s0 - costo, { s0, costo, ahora: fin(b, "f1").saldo_deuda });
  ok("B3_toast_explica_cambio", /Financiamiento actualizado: Fondos propios · Cuenta BFK/.test(await texto(p)));
  det = await etapa(p, "2001-101-SE26", "compra");
  ok("B3_ui_refleja_fondos_propios", (await det.locator('[data-tipo-financiamiento="fondos_propios"]').count()) === 1);
  // Vuelta a financiador externo: la deuda vuelve exactamente
  await det.locator('[data-accion="cambiar-financiamiento"]').click(); await espera(p, 300);
  f = p.locator('[data-form="cambiar-financiamiento"]');
  await f.locator("select").first().selectOption("externo"); await espera(p, 200);
  await f.locator("select").nth(1).selectOption("f1");
  n = b.escr.length;
  await f.getByRole("button", { name: /Cambiar financiamiento/ }).click(); await espera(p, 1800);
  ws = desde(b, n);
  ok("B3_vuelta_a_externo_restituye_deuda", cuenta(ws, "RPC", "cambiar_financiamiento_oc") === 1 && sinTotalesDelNavegador(ws)
    && fin(b, "f1").saldo_deuda === s0 && oc(b, "oc1").estado_pago_financiamiento === "pendiente", { s0, ahora: fin(b, "f1").saldo_deuda });
  ok("B3_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B4: con pagos registrados no se cambia el financiamiento (la base lo rechaza y no guarda nada) ──
await escenario("B4", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f1").saldo_deuda;
  const det = await etapa(p, "2007-107-SE26", "compra");
  await det.locator('[data-accion="cambiar-financiamiento"]').click(); await espera(p, 300);
  const f = p.locator('[data-form="cambiar-financiamiento"]');
  ok("B4_avisa_pagos_registrados", /200\.000 pagados al financiador/.test(await f.innerText()), await f.innerText());
  await f.locator("select").first().selectOption("venta_propia"); await espera(p, 200);
  const n = b.escr.length;
  await f.getByRole("button", { name: /Cambiar financiamiento/ }).click(); await espera(p, 1500);
  const ws = desde(b, n);
  ok("B4_rechazo_visible_en_el_formulario", /tiene pagos al financiador registrados/.test(await f.innerText()) && /No se registró ningún cambio|no se guardó nada/i.test(await f.innerText()), await f.innerText());
  ok("B4_nada_cambia", cuenta(ws, "RPC", "cambiar_financiamiento_oc") === 1 && sinTotalesDelNavegador(ws) && oc(b, "oc7").es_venta_propia === false && oc(b, "oc7").financiador_id === "f1" && fin(b, "f1").saldo_deuda === s0);
  ok("B4_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B5: corrección histórica pendiente → aviso y operaciones del dominio bloqueadas en esa OC ──
await escenario("B5", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  await abrirOC(p, "2014-114-SE26");
  const fila = p.locator('[data-oc="2014-114-SE26"]');
  ok("B5_aviso_correccion_pendiente", (await fila.locator("[data-diferencias-historicas]").count()) === 1 && /Estado de financiamiento/.test(await fila.locator("[data-diferencias-historicas]").innerText()));
  const detC = await etapa(p, "2014-114-SE26", "compra");
  ok("B5_compra_bloqueada", (await detC.locator('[data-bloqueo-historico="financiamiento"]').count()) === 1 && (await detC.getByRole("button", { name: /Editar/ }).count()) === 0
    && (await detC.getByRole("button", { name: /Eliminar/ }).count()) === 0 && (await detC.locator('[data-accion="cambiar-financiamiento"]').count()) === 0);
  const detF = await etapa(p, "2014-114-SE26", "financ");
  ok("B5_financiamiento_bloqueado_sin_pago", (await detF.locator('[data-bloqueo-historico="financiamiento"]').count()) === 1 && (await detF.getByRole("button", { name: /Registrar pago/ }).count()) === 0);
  // Facturas repetidas: la facturación de esa OC queda bloqueada hasta decidir
  const detFa = await etapa(p, "2015-115-SE26", "factura");
  ok("B5_facturacion_bloqueada", (await detFa.locator('[data-bloqueo-historico="facturacion"]').count()) === 1 && (await detFa.getByRole("button", { name: /Re-emitir|Emitir factura/ }).count()) === 0
    && (await detFa.getByRole("button", { name: /Eliminar/ }).count()) === 0 && (await detFa.getByRole("button", { name: /Editar/ }).count()) === 0);
  ok("B5_conserva_monto_facturado_guardado", oc(b, "oc15").monto_facturado === 600000);
  // El abono FIFO no incluye OCs bloqueadas, venta propia ni fondos propios
  await irA(p, "financiamiento");
  await p.getByRole("button", { name: /Abonar a un financiador/ }).click(); await espera(p, 500);
  const m = enModal(p);
  await m.locator("select").first().selectOption("f1");
  await m.locator("input[type=number]").first().fill("99000000"); await espera(p, 400);
  const tm = await m.innerText();
  ok("B5_abono_excluye_bloqueadas_y_no_aplica", /2001-101-SE26/.test(tm) && !/2014-114-SE26/.test(tm) && !/2012-112-SE26/.test(tm) && !/2013-113-SE26/.test(tm) && !/2008-108-SE26/.test(tm), tm.slice(0, 600));
  ok("B5_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B6: saldo con signo (a favor de BFK) y diferencia histórica del financiador ──
await escenario("B6", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "financiamiento");
  const tarjeta = p.locator("div").filter({ hasText: /^Financiador Cuatro/ }).first();
  const t0 = await texto(p);
  ok("B6_lista_a_favor_de_bfk", /Financiador Cuatro[\s\S]{0,120}A favor de BFK[\s\S]{0,40}\$150\.000/.test(t0), t0.match(/Financiador Cuatro[\s\S]{0,140}/)?.[0]);
  void tarjeta;
  await p.getByText("Financiador Cuatro", { exact: true }).first().click(); await espera(p, 700);
  ok("B6_cartola_saldo_negativo", (await p.locator('[data-saldo-financiador="-150000"]').count()) === 1 && /Saldo a favor de BFK/.test(await texto(p)));
  await p.getByRole("button", { name: /← Volver/ }).click(); await espera(p, 400);
  const sinDeuda = p.getByRole("button", { name: /financiadores? sin deuda/ });
  if (await sinDeuda.count()) { await sinDeuda.click(); await espera(p, 300); }
  await p.getByText("Financiador Tres", { exact: true }).first().click(); await espera(p, 700);
  ok("B6_diferencia_historica_financiador", (await p.locator('[data-diferencia-financiador="f3"]').count()) === 1 && (await p.locator('[data-saldo-financiador="0"]').count()) === 1
    && /sería -\$1\.000\.000|sería \$-1\.000\.000|sería −\$1\.000\.000/.test(await texto(p)), (await texto(p)).match(/Corrección histórica[^\n]*/)?.[0]);
  ok("B6_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B7: Administración muestra las correcciones históricas pendientes (solo lectura) ──
await escenario("B7", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "usuarios");
  const filas = b.leer("fin_diferencias_historicas", new URLSearchParams("estado=eq.pendiente"));
  const el = p.locator("[data-correcciones-pendientes]");
  ok("B7_cuenta_exacta", (await el.count()) === 1 && Number(await el.getAttribute("data-correcciones-pendientes")) === filas.length && filas.length > 0, { ui: await el.getAttribute("data-correcciones-pendientes"), base: filas.length });
  const n = b.escr.length;
  await p.locator("#adm-correcciones").getByRole("button", { name: /Ver detalle/ }).click(); await espera(p, 400);
  const t = await p.locator("#adm-correcciones").innerText();
  ok("B7_detalle_lista_ocs_y_financiadores", /2014-114-SE26/.test(t) && /2015-115-SE26/.test(t) && /Financiador Tres/.test(t) && /Saldo del financiador/.test(t), t.slice(0, 500));
  ok("B7_solo_lectura", desde(b, n).filter((w) => w.metodo !== "RPC").length === 0);
  ok("B7_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B8: corregir una compra es una operación atómica de la base (costo ≥ lo ya pagado) ──
await escenario("B8", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f1").saldo_deuda;
  let det = await etapa(p, "2001-101-SE26", "compra");
  await det.getByRole("button", { name: /Editar/ }).first().click(); await espera(p, 400);
  let m = enModal(p);
  await m.locator("input[type=number]").nth(1).fill("900000");
  let n = b.escr.length;
  await m.getByRole("button", { name: /Guardar corrección/ }).click(); await espera(p, 1800);
  let ws = desde(b, n);
  ok("B8_editar_compra_por_rpc", cuenta(ws, "RPC", "editar_compra_oc", (w) => w.cuerpo.p_evento_id === "ec1" && w.cuerpo.p_costo === 900000) === 1 && sinTotalesDelNavegador(ws), ws);
  ok("B8_base_recalcula_costo_y_deuda", oc(b, "oc1").costo_total === 900000 && fin(b, "f1").saldo_deuda === s0 + 95000, { costo: oc(b, "oc1").costo_total, s0, ahora: fin(b, "f1").saldo_deuda });
  // Bajo lo ya pagado: rechazo visible y nada cambia
  det = await etapa(p, "2007-107-SE26", "compra");
  await det.getByRole("button", { name: /Editar/ }).first().click(); await espera(p, 400);
  m = enModal(p);
  await m.locator("input[type=number]").nth(1).fill("100000");
  n = b.escr.length; const s1 = fin(b, "f1").saldo_deuda;
  await m.getByRole("button", { name: /Guardar corrección/ }).click(); await espera(p, 1500);
  ws = desde(b, n);
  ok("B8_costo_bajo_lo_pagado_rechazado", /no puede quedar bajo lo ya pagado/.test(await m.innerText()) && oc(b, "oc7").costo_total === 835000 && fin(b, "f1").saldo_deuda === s1 && sinTotalesDelNavegador(ws), await m.innerText());
  ok("B8_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B9: corregir un pago al financiador (atómico; los pagos de la OC no pueden superar su costo) ──
await escenario("B9", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f1").saldo_deuda;
  let det = await etapa(p, "2007-107-SE26", "financ");
  await det.getByRole("button", { name: /Editar/ }).first().click(); await espera(p, 400);
  let m = enModal(p);
  await m.locator("input[type=number]").first().fill("150000");
  let n = b.escr.length;
  await m.getByRole("button", { name: /Guardar corrección/ }).click(); await espera(p, 1800);
  let ws = desde(b, n);
  ok("B9_editar_pago_por_rpc", cuenta(ws, "RPC", "editar_pago_financiador", (w) => w.cuerpo.p_evento_id === "pf7" && w.cuerpo.p_monto === 150000) === 1 && sinTotalesDelNavegador(ws), ws);
  ok("B9_base_recalcula_pagado_y_deuda", oc(b, "oc7").monto_pagado_fin === 150000 && oc(b, "oc7").estado_pago_financiamiento === "parcial" && fin(b, "f1").saldo_deuda === s0 + 50000);
  det = await etapa(p, "2007-107-SE26", "financ");
  await det.getByRole("button", { name: /Editar/ }).first().click(); await espera(p, 400);
  m = enModal(p);
  await m.locator("input[type=number]").first().fill("9000000");
  n = b.escr.length;
  await m.getByRole("button", { name: /Guardar corrección/ }).click(); await espera(p, 1500);
  ok("B9_pago_sobre_costo_rechazado", /superarían su costo/.test(await m.innerText()) && oc(b, "oc7").monto_pagado_fin === 150000 && sinTotalesDelNavegador(desde(b, n)), await m.innerText());
  ok("B9_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B10: eliminar una compra (atómico); la única compra de una OC con pagos no se elimina ──
await escenario("B10", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f1").saldo_deuda;
  let det = await etapa(p, "VD-006", "compra");
  let n = b.escr.length;
  await det.getByRole("button", { name: /Eliminar/ }).first().click(); await espera(p, 1800);
  let ws = desde(b, n);
  ok("B10_eliminar_compra_por_rpc", cuenta(ws, "RPC", "eliminar_compra_oc", (w) => w.cuerpo.p_evento_id === "ec6") === 1 && cuenta(ws, "DELETE", "eventos_compra") === 0 && sinTotalesDelNavegador(ws), ws);
  ok("B10_base_recalcula", !b.db.eventos_compra.some((e) => e.id === "ec6") && oc(b, "oc6").estado_compra === "pendiente" && oc(b, "oc6").costo_total === 0 && fin(b, "f1").saldo_deuda === s0 - 830000);
  det = await etapa(p, "2007-107-SE26", "compra");
  n = b.escr.length;
  await det.getByRole("button", { name: /Eliminar/ }).first().click(); await espera(p, 1500);
  ws = desde(b, n);
  ok("B10_unica_compra_con_pagos_no_se_elimina", cuenta(ws, "RPC", "eliminar_compra_oc") === 1 && b.db.eventos_compra.some((e) => e.id === "ec7") && /pagos al financiador registrados/.test(await texto(p)));
  ok("B10_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B11: re-emitir una factura: lo facturado es solo la factura vigente (regla 4) y lo recalcula la base ──
await escenario("B11", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const det = await etapa(p, "2002-102-SE26", "factura");
  await det.getByRole("button", { name: /Re-emitir/ }).click(); await espera(p, 500);
  const m = enModal(p);
  await m.getByPlaceholder("ej: 215").fill("9702");
  await m.getByPlaceholder("ej: 123").fill("55");
  const n = b.escr.length;
  await m.getByRole("button", { name: /Reemitir factura/ }).click(); await espera(p, 1800);
  const ws = desde(b, n);
  ok("B11_solo_inserta_la_factura", cuenta(ws, "POST", "eventos_factura", (w) => w.cuerpo.numero_factura === "9702" && w.cuerpo.factura_anulada_numero === "702" && w.cuerpo.nota_credito === "55") === 1
    && sinTotalesDelNavegador(ws) && cuenta(ws, "PATCH", "ordenes_compra_v2") === 0, ws);
  ok("B11_facturado_solo_vigente", oc(b, "oc2").monto_facturado === 1210000 && oc(b, "oc2").estado_factura_propia === "emitida", oc(b, "oc2").monto_facturado);
  ok("B11_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B12: pago mayor que lo adeudado por la OC: el resto queda como pago sin OC y el saldo baja sin tope en cero ──
await escenario("B12", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  const s0 = fin(b, "f4").saldo_deuda;
  // Compra nueva en Financiador Cuatro (saldo a favor) y pago mayor que la deuda
  const det = await etapa(p, "2016-116-SE26", "financ");
  ok("B12_oc_pagada_sin_boton", (await det.getByRole("button", { name: /Registrar pago/ }).count()) === 0);
  const detF = await etapa(p, "2001-101-SE26", "financ");
  await detF.getByRole("button", { name: /Registrar pago/ }).click(); await espera(p, 500);
  const m = enModal(p);
  await m.locator("input[type=number]").fill("1000000");
  const n = b.escr.length; const s1 = fin(b, "f1").saldo_deuda;
  await m.getByRole("button", { name: /Registrar pago a financiador/ }).click(); await espera(p, 1800);
  const ws = desde(b, n);
  ok("B12_rpc_asigna_lo_adeudado", cuenta(ws, "RPC", "registrar_pago_financiador", (w) => w.cuerpo.p_monto === 1000000 && w.cuerpo.p_asignaciones.length === 1 && w.cuerpo.p_asignaciones[0].oc_id === "oc1" && w.cuerpo.p_asignaciones[0].monto === 805000) === 1 && sinTotalesDelNavegador(ws), ws);
  ok("B12_base_descuenta_el_pago_completo", fin(b, "f1").saldo_deuda === s1 - 1000000 && oc(b, "oc1").estado_pago_financiamiento === "pagado"
    && b.db.eventos_pago_financiamiento.some((e) => e.oc_id === null && e.financiador_id === "f1" && e.monto === 195000));
  ok("B12_f4_sin_cambios", fin(b, "f4").saldo_deuda === s0);
  ok("B12_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── B13: dos usuarios en dos dispositivos: una compra con la pantalla desactualizada no pisa un pago recién registrado ──
await escenario("B13", async () => {
  const b = base4b();
  const A = await abrir(browser, b, { url: URL_APP, ...escritorio, usuario: "u1", espera: 3000 });
  const B = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, usuario: "u2", espera: 3000 });   // B queda con la pantalla cargada antes del pago
  const s0 = fin(b, "f1").saldo_deuda;
  // A (admin, escritorio) registra un pago de 300.000 a Financiador Uno por la OC 2004-104-SE26
  await irA(A.page, "compras");
  const detA = await etapa(A.page, "2004-104-SE26", "financ");
  await detA.getByRole("button", { name: /Registrar pago/ }).click(); await espera(A.page, 500);
  await enModal(A.page).locator("input[type=number]").fill("300000");
  await enModal(A.page).getByRole("button", { name: /Registrar pago a financiador/ }).click(); await espera(A.page, 1500);
  const sPago = fin(b, "f1").saldo_deuda;
  ok("B13_pago_de_A_aplicado", sPago === s0 - 300000, { s0, sPago });
  // B (usuario, teléfono) sin recargar: registra una compra de 700.000 con Financiador Uno en la OC 2005-105-SE26
  const n = b.escr.length;
  const pB = B.page;
  await pB.locator('[data-nav="compras"]').first().click(); await espera(pB, 700);   // barra inferior del teléfono
  await abrirOC(pB, "2005-105-SE26");
  await pB.locator('[data-oc="2005-105-SE26"]').getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(pB, 500);
  const m = enModal(pB);
  await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(pB, 300);
  await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Monitor 24");
  const nums = m.locator("input[type=number]"); await nums.nth(1).fill("700000"); await nums.nth(2).fill("1190000");
  await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(pB, 300); await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(pB, 300);
  await m.getByRole("button", { name: /Registrar compra/ }).click(); await espera(pB, 2000);
  const wsB = desde(b, n);
  ok("B13_B_solo_llama_a_la_rpc_de_compra", cuenta(wsB, "RPC", "registrar_compra_oc", (w) => w.cuerpo.p_oc_id === "oc5" && w.cuerpo.p_costo === 700000 && w.cuerpo.p_financiador_id === "f1") === 1 && sinTotalesDelNavegador(wsB), wsB);
  ok("B13_saldo_final_incluye_pago_y_compra", fin(b, "f1").saldo_deuda === s0 - 300000 + 700000, { s0, final: fin(b, "f1").saldo_deuda });
  ok("B13_pago_de_A_intacto", b.db.eventos_pago_financiamiento.some((e) => e.oc_id === "oc4" && e.monto === 300000) && oc(b, "oc4").monto_pagado_fin === 300000);
  ok("B13_sin_errores", A.errs.length === 0 && B.errs.length === 0, [...A.errs, ...B.errs]);
  await A.ctx.close(); await B.ctx.close();
});

// ── B14: teléfono (390 px): avisos y formulario de cambio de financiamiento sin desborde horizontal ──
await escenario("B14", async () => {
  const b = base4b();
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 3000 });
  await p.locator('[data-nav="compras"]').first().click(); await espera(p, 700);
  await abrirOC(p, "2014-114-SE26");
  const ancho1 = await p.evaluate(() => document.documentElement.scrollWidth);
  const det = await etapa(p, "2001-101-SE26", "compra");
  await det.locator('[data-accion="cambiar-financiamiento"]').click(); await espera(p, 300);
  const ancho2 = await p.evaluate(() => document.documentElement.scrollWidth);
  ok("B14_sin_desborde_horizontal", ancho1 <= 390 && ancho2 <= 390, { ancho1, ancho2 });
  ok("B14_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

await browser.close();
const total = Object.keys(R).length;
console.log(`\nRESUMEN pruebas Fase 4B (interfaz): ${total - F.length} OK, ${F.length} FALLA(S)` + (F.length ? ` → ${F.join(", ")}` : ""));
process.exit(F.length ? 1 : 0);
