// Pruebas de interfaz de la Fase 4C (Chromium + Playwright, Supabase y /api/oc simulados con estado).
// Uso: node docs/pruebas-4c/e2e_fase4c.mjs http://127.0.0.1:4178/   (build servido con vite preview; opcional SOLO=C1,C3)
// Reutiliza la base simulada y los datos ficticios de la Fase 4A. Nada sale a la red.
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "../pruebas-oc/datos_oc.mjs";
import * as XLSX from "xlsx";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const SOLO = process.env.SOLO ? new Set(process.env.SOLO.split(",")) : null;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, detalle) => { if (!v) { F.push(k); console.log("FALLA " + k + (detalle !== undefined ? " :: " + JSON.stringify(detalle).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const texto = async (p) => p.evaluate(() => document.body.innerText);
const escritorio = { ancho: 1440, alto: 900, movil: false };
const desde = (b, n) => b.escr.slice(n);
async function irA(p, k) { await p.locator(`aside [data-nav="${k}"]`).click(); await espera(p, 700); }
async function abrirOC(p, numero) {
  if (await p.locator(`[data-oc="${numero}"] [data-testid="oc-campos"]`).count()) return;
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
const escenario = async (nombre, fn) => {
  if (SOLO && !SOLO.has(nombre)) return;
  try { await fn(); } catch (e) { ok(`${nombre}_sin_excepcion`, false, e.message); }
};
const hace = (h) => new Date(Date.now() - h * 3600_000).toISOString();
// Datos base: sin OCs a medio completar (así corre la revisión automática y no la de "faltan datos").
const datos = ({ marcaRevision = hace(1), fotos = {}, extra } = {}) => {
  const d = crearDatos();
  const o9 = d.ordenes_compra_v2.find((o) => o.id === "oc9"); o9.rut_cliente = "69.109.000-9"; o9.fecha_hora_emision_mp = dias(31) + "T08:00:00";
  if (marcaRevision) d.mp_cache_avisos.push({ id: "revision_auto", datos: { ultima: marcaRevision }, actualizado_en: marcaRevision });
  for (const [ocId, foto] of Object.entries(fotos)) d.mp_cache_avisos.push({ id: "oc_mp:" + ocId, datos: foto, actualizado_en: hace(2) });
  if (extra) extra(d);
  return d;
};
const fotoCancelada = { v: 1, revisado_en: hace(24), codigo_estado: 9, estado: "Cancelada", aceptada: false, neto: 1000000, iva: 190000, total: 1190000, items: [] };

// ── C1: "Actualizar desde Mercado Público" no pisa datos manuales, guarda la foto y la muestra ──
await escenario("C1", async () => {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2001-101-SE26");
  const n = b.escr.length;
  await p.locator('[data-oc="2001-101-SE26"]').getByRole("button", { name: /Actualizar fecha y datos desde Mercado Público/ }).click(); await espera(p, 2500);
  const ws = desde(b, n);
  const patchOC = ws.find((w) => w.metodo === "PATCH" && w.tabla === "ordenes_compra_v2" && w.id === "oc1");
  ok("C1_no_pisa_cliente_ni_contacto_manual", patchOC && !("cliente" in patchOC.cuerpo) && !("rut_cliente" in patchOC.cuerpo) && b.db.ordenes_compra_v2.find((o) => o.id === "oc1").cliente === "MUNICIPALIDAD FICTICIA 1", patchOC?.cuerpo);
  ok("C1_fecha_de_la_oc_desde_mp", b.db.ordenes_compra_v2.find((o) => o.id === "oc1").fecha_emision_mp === dias(41));
  const foto = b.db.mp_cache_avisos.find((f) => f.id === "oc_mp:oc1");
  ok("C1_guarda_foto_mp_con_items_estructurados", foto && foto.datos.items.length === 1 && foto.datos.items[0].cantidad === 2 && foto.datos.total === 2380000, foto?.datos);
  ok("C1_producto_editado_no_se_pisa", b.db.oc_productos_link.find((l) => l.id === "l1v").descripcion.startsWith("Silla ergonómica"));
  ok("C1_comprados_no_se_tocan", ws.filter((w) => w.tabla === "oc_productos_link" && ["l1a", "l1b"].includes(w.id)).length === 0);
  await p.locator('[data-oc="2001-101-SE26"]').getByRole("button", { name: /Productos y números/ }).click(); await espera(p, 500);
  const det = await p.locator("[data-mp-detalle]").innerText().catch(() => "");
  ok("C1_detalle_muestra_neto_iva_aceptacion_recepcion", /Mercado Público/i.test(det) && /Neto/.test(det) && /IVA/.test(det) && /Aceptación/.test(det) && /Recepción/.test(det), det);
  ok("C1_responsable_oculto", (await p.locator('[data-oc="2001-101-SE26"] select option', { hasText: "Sin asignar" }).count()) === 0 && !/Responsable/.test(await p.locator('[data-oc="2001-101-SE26"]').innerText()));
  ok("C1_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C2: revisión automática prudente: pocas OCs, una vez, y no se repite al recargar ──
await escenario("C2", async () => {
  const mp = { ...RESPUESTAS_MP, "2003-103-SE26": { status: 200, body: { ok: true, oc: { ...RESPUESTAS_MP["2001-101-SE26"].body.oc, numero_oc: "2003-103-SE26", codigo_estado: 9, estado_mp: "Cancelada" } } } };
  const b = crearBase(datos({ marcaRevision: hace(7) }), { mp });
  const a1 = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 6000 });
  const consultas1 = b.llamadasMP.length;
  const abiertasMP = ["2001-101-SE26", "2002-102-SE26", "2003-103-SE26", "2004-104-SE26", "2005-105-SE26", "2007-107-SE26", "2009-109-SE26", "2011-111-SE26"];
  ok("C2_revisa_solo_ocs_abiertas_de_mp", consultas1 > 0 && consultas1 <= 12 && b.llamadasMP.every((c) => abiertasMP.includes(c)), b.llamadasMP);
  ok("C2_no_revisa_cerradas_ni_archivadas_ni_manuales", !b.llamadasMP.some((c) => ["2008-108-SE26", "2010-110-SE26", "VD-006"].includes(c)));
  const marca = b.db.mp_cache_avisos.find((f) => f.id === "revision_auto");
  ok("C2_marca_compartida_actualizada", marca && Date.now() - new Date(marca.datos.ultima).getTime() < 60_000);
  ok("C2_fotos_guardadas", b.db.mp_cache_avisos.some((f) => f.id === "oc_mp:oc1") && b.db.mp_cache_avisos.some((f) => f.id === "oc_mp:oc3"));
  ok("C2_registra_uso_diario", (b.db.mp_uso_diario || []).reduce((s, r) => s + (r.solicitudes || 0), 0) >= consultas1);
  // Cancelada en MP: Panel, lista, Alertas y Agenda con el mismo criterio.
  const prior = await a1.page.locator('[data-prioridad="mp_cancelada"]').getAttribute("data-n").catch(() => null);
  ok("C2_panel_prioridad_cancelada", prior === "1", prior);
  await a1.page.locator('[data-prioridad="mp_cancelada"]').click(); await espera(a1.page, 900);
  const filas = await a1.page.locator("[data-oc]").evaluateAll((els) => els.map((e) => e.getAttribute("data-oc")));
  ok("C2_lista_exacta_y_estado_unico", JSON.stringify(filas) === JSON.stringify(["2003-103-SE26"]) && /Cancelada en Mercado Público/.test(await a1.page.locator('[data-oc="2003-103-SE26"]').innerText()), filas);
  await irA(a1.page, "notif");
  ok("C2_alerta_cancelada", /Cancelada en Mercado Público[\s\S]{0,200}2003-103-SE26|2003-103-SE26[\s\S]{0,200}Cancelada en Mercado Público/.test(await texto(a1.page)));
  await a1.ctx.close();
  const a2 = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3500 });
  ok("C2_no_repite_consultas_al_recargar", b.llamadasMP.length === consultas1, { antes: consultas1, despues: b.llamadasMP.length });
  ok("C2_sin_errores", a1.errs.length === 0 && a2.errs.length === 0, [...a1.errs, ...a2.errs]);
  await a2.ctx.close();
});

// ── C3: filtros por vendedor, financiador, proveedor, producto y vale vista + Excel de la vista ──
await escenario("C3", async () => {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras");
  await p.getByRole("button", { name: /Filtros avanzados/ }).first().click(); await espera(p, 300);
  const filas = () => p.locator("[data-oc]").evaluateAll((els) => els.map((e) => e.getAttribute("data-oc")).sort());
  await p.locator('[data-filtro="vendedor"]').selectOption("v2"); await espera(p, 400);
  ok("C3_vendedor", JSON.stringify(await filas()) === JSON.stringify(["2002-102-SE26", "2011-111-SE26"]), await filas());
  await p.locator('[data-filtro="vendedor"]').selectOption(""); await p.locator('[data-filtro="proveedor"]').selectOption("Proveedor 3"); await espera(p, 400);
  ok("C3_proveedor", JSON.stringify(await filas()) === JSON.stringify(["2003-103-SE26"]), await filas());
  await p.locator('[data-filtro="proveedor"]').selectOption(""); await p.locator('[data-filtro="producto"]').fill("silla modelo"); await espera(p, 400);
  ok("C3_producto", JSON.stringify(await filas()) === JSON.stringify(["2001-101-SE26"]), await filas());
  await p.locator('[data-filtro="producto"]').fill(""); await p.locator('[data-filtro="valeVista"]').selectOption("pendiente"); await espera(p, 400);
  ok("C3_vale_vista_sin_cobrar", JSON.stringify(await filas()) === JSON.stringify(["2007-107-SE26"]), await filas());
  await p.locator('[data-filtro="valeVista"]').selectOption(""); await p.locator('[data-filtro="financiador"]').selectOption("f1"); await espera(p, 400);
  const conF1 = await filas();
  ok("C3_financiador", conF1.length === b.db.ordenes_compra_v2.filter((o) => !o.archivada && o.financiador_id === "f1").length, conF1);
  // Excel: exactamente lo que se ve
  const [descarga] = await Promise.all([p.waitForEvent("download"), p.locator("[data-exportar-vista]").click()]);
  const ruta = path.join(os.tmpdir(), "vista4c.xlsx"); await descarga.saveAs(ruta);
  const wb = XLSX.read(fs.readFileSync(ruta));
  const hoja = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  ok("C3_excel_misma_vista", hoja.length === conF1.length && JSON.stringify(hoja.map((r) => r.OC).sort()) === JSON.stringify(conF1), hoja.map((r) => r.OC));
  ok("C3_excel_montos_numericos_y_resumen", typeof hoja[0]["Venta (monto OC)"] === "number" && wb.SheetNames.includes("_Resumen") && /financiador Financiador Uno/.test(JSON.stringify(XLSX.utils.sheet_to_json(wb.Sheets["_Resumen"]))));
  ok("C3_busqueda_por_proveedor", await (async () => { await p.getByRole("button", { name: /Limpiar todo/ }).click(); await p.locator('input[placeholder^="Buscar OC"]').fill("proveedor 4"); await espera(p, 400); return JSON.stringify(await filas()) === JSON.stringify(["2004-104-SE26"]); })());
  ok("C3_sin_escrituras", b.escr.filter((w) => w.metodo !== "RPC" && w.tabla !== "mp_uso_diario").length === 0, b.escr.filter((w) => w.metodo !== "RPC").map((w) => w.tabla));
  ok("C3_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C4: ficha PDF de la OC (también en modo consulta) ──
await escenario("C4", async () => {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "compras"); await abrirOC(p, "2007-107-SE26");
  const [descarga] = await Promise.all([p.waitForEvent("download"), p.locator('[data-oc="2007-107-SE26"] [data-ficha-pdf]').click()]);
  const ruta = path.join(os.tmpdir(), "ficha4c.pdf"); await descarga.saveAs(ruta);
  const buf = fs.readFileSync(ruta);
  ok("C4_pdf_valido", buf.slice(0, 5).toString() === "%PDF-" && buf.length > 2000 && /OC-2007-107-SE26\.pdf/.test(descarga.suggestedFilename()), [buf.length, descarga.suggestedFilename()]);
  ok("C4_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C5: saldo proyectado: abono parcial y vale vista se cuentan una sola vez, con desglose ──
await escenario("C5", async () => {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const t = await p.locator("[data-desglose-saldo]").innerText();
  // oc7: factura 1.260.000, abono de 500.000 en vale vista SIN cobrar en el banco → no es caja; queda todo por cobrar.
  ok("C5_desglose_visible_con_vale_vista", /Caja calculada/.test(t) && /Por cobrar/.test(t) && /vale vista\/cheque sin cobrar\s*\$?500\.000/.test(t.replace(/\n/g, " ")), t);
  const nums = (s) => Number(String(s).replace(/[^0-9-]/g, ""));
  const lineas = await p.locator("[data-desglose-saldo] > div").evaluateAll((els) => els.map((e) => e.innerText));
  const caja = nums(lineas[0].split("\n").pop()), cobrar = nums(lineas[1].split("\n").pop()), deudas = nums(lineas[lineas.length - 1].split("\n").pop());
  const proyectado = nums(await p.locator("text=Saldo proyectado").locator("xpath=following-sibling::div[1]").innerText());
  ok("C5_proyectado_cuadra_con_desglose", proyectado === caja + cobrar - deudas, { proyectado, caja, cobrar, deudas });
  // Por cobrar esperado (lib/ocs.js): por OC de venta, factura vigente (o monto) − cobros en el banco.
  const ocs = b.leer("ordenes_compra_v2", new URLSearchParams("select=*,eventos_compra(*)")).filter((o) => !o.archivada && o.tipo_registro === "venta");
  const esperado = ocs.reduce((s, o) => { const base = o.monto_facturado > 0 ? o.monto_facturado : o.monto_total; const enBanco = o.eventos_pago_cliente.filter((e) => !(e.medio_pago && e.medio_pago !== "transferencia" && !e.cobrado_en_banco)).reduce((a, e) => a + e.monto, 0); return s + Math.max(0, base - enBanco); }, 0);
  ok("C5_por_cobrar_correcto", cobrar === esperado, { cobrar, esperado });
  ok("C5_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C6: comisión: OCs que forman el cálculo mensual (solo factura vigente) ──
await escenario("C6", async () => {
  const b = crearBase(datos({ extra: (d) => {
    // oc4: factura anulada en otro mes y vigente en el mes de la 704 (no debe contar dos veces)
    d.eventos_factura.push({ id: "fa4x", oc_id: "oc4", fecha: dias(60), numero_factura: "690", monto: 1230000 });
    d.eventos_factura.find((f) => f.id === "fa4").factura_anulada_numero = "690";
  } }), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  await irA(p, "vendedores");
  await p.getByText("Vendedor Uno", { exact: false }).first().click(); await espera(p, 500);
  const botones = p.locator("[data-ver-ocs-comision]");
  const nMeses = await botones.count();
  let vistas = [];
  for (let i = 0; i < nMeses; i++) { await botones.nth(i).click(); await espera(p, 200); }
  vistas = await p.locator("[data-ocs-comision]").evaluateAll((els) => els.map((e) => e.innerText));
  const todas = vistas.join("\n");
  const apariciones = (todas.match(/2004-104-SE26/g) || []).length;
  ok("C6_lista_ocs_del_calculo", nMeses > 0 && /2004-104-SE26/.test(todas) && /Factura vigente N° 704/.test(todas), vistas);
  ok("C6_oc_con_factura_anulada_entra_una_sola_vez", apariciones === 1 && !/N° 690/.test(todas), apariciones);
  await p.locator("[data-ocs-comision] button", { hasText: "2004-104-SE26" }).first().click(); await espera(p, 1200);
  ok("C6_abre_la_oc", (await p.locator('[data-oc="2004-104-SE26"] [data-testid="oc-campos"]').count()) === 1);
  ok("C6_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C7: cartola: varias facturas del mismo RUT, abono parcial y depósito de vale vista ──
// Etapas 1-2 (autorizadas 09/10/2026): la cartola ya NO preselecciona; cada movimiento posterior al cierre se registra
// solo, con el destino elegido a mano y confirmación explícita. Cartola en el formato real de BancoEstado (en línea).
await escenario("C7", async () => {
  const rut2 = "69.102.000-2", rut7 = "69.107.000-7";
  const b = crearBase(datos({ extra: (d) => { d.ordenes_compra_v2.find((o) => o.id === "oc4").rut_cliente = rut2; } }), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ...escritorio, espera: 3000 });
  const hoy = new Date(); const f = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`; };
  const res = XLSX.utils.aoa_to_sheet([["Inicial", "", "", "", "$ 6.560.000"], ["Saldo Contable", "", "", "", "$ 9.600.000"]]);
  const ws = XLSX.utils.aoa_to_sheet([["Fecha", "Sucursal", "N° Operación", "Descripción", "Cargos", "Abonos", "Saldo"],
    [f(1), "STGO.PRINCIPAL ", "00007000001", `TRANSF DE ${rut2.replace(/\./g, "")} MUNICIPALIDAD FICTICIA`, "", "$ 2.440.000", "$ 9.000.000"],
    [f(1), "STGO.PRINCIPAL ", "00007000002", `TRANSF DE ${rut7.replace(/\./g, "")} MUNICIPALIDAD FICTICIA 7`, "", "$ 100.000", "$ 9.100.000"],
    [f(1), "STGO.PRINCIPAL ", "00004000003", `DEPOSITO VALE VISTA ${rut7}`, "", "$ 500.000", "$ 9.600.000"]]);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, res, "Resumen"); XLSX.utils.book_append_sheet(wb, ws, "Registros");
  const ruta = path.join(os.tmpdir(), "cartola4c.xlsx"); XLSX.writeFile(wb, ruta);
  const cargar = async () => { await p.locator("[role=dialog]").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
    await p.getByRole("button", { name: /^Cartola$/ }).first().click(); await p.locator("[role=dialog] [data-cartola-archivos]").waitFor({ state: "attached", timeout: 15000 });
    await p.locator("[role=dialog] [data-cartola-archivos]").setInputFiles(ruta); await p.locator("[data-cartola-conciliacion]").waitFor({ timeout: 15000 }); await espera(p, 400); };
  await cargar();
  ok("C7_tres_abonos_por_registrar", (await p.locator("[data-preparar]").count()) === 3);
  const opciones = async (k) => { await p.locator("[data-preparar]").nth(k).click(); await espera(p, 300);
    return p.locator("[data-opcion-abono]").evaluate((e) => ({ v: e.value, ops: [...e.options].map((o) => o.text) })); };
  let sel = await opciones(0);
  ok("C7_varias_facturas_ofrecida_sin_preseleccion", sel.v === "" && sel.ops.some((o) => /2 facturas/.test(o)), sel);
  const idVarias = await p.locator("[data-opcion-abono]").evaluate((e) => [...e.options].find((o) => /2 facturas/.test(o.text)).value);
  await p.locator("[data-opcion-abono]").selectOption(idVarias); await espera(p, 200);
  ok("C7_sin_confirmacion_no_registra", await p.locator("[data-registrar]").isDisabled());
  const n = b.escr.length;
  await p.locator("[data-confirmo]").check(); await p.locator("[data-registrar]").click(); await espera(p, 3000);
  const w = desde(b, n);
  const posts = w.filter((x) => x.metodo === "POST" && x.tabla === "eventos_pago_cliente");
  ok("C7_cobros_en_una_sola_solicitud", posts.length === 1 && Array.isArray(posts[0].cuerpo) && posts[0].cuerpo.length === 2, posts.map((x) => x.cuerpo));
  const oc = (id) => b.db.ordenes_compra_v2.find((o) => o.id === id);
  ok("C7_estados_recalculados", oc("oc2").estado_pago_cliente === "pagado" && oc("oc4").estado_pago_cliente === "pagado", ["oc2", "oc4"].map((i) => [oc(i).estado_pago_cliente, oc(i).monto_cobrado]));
  await cargar();
  ok("C7_abono_registrado_ya_no_se_ofrece", (await p.locator("[data-preparar]").count()) === 2);
  sel = await opciones(0);
  ok("C7_parcial_ofrecido_sin_preseleccion", sel.v === "" && sel.ops.some((o) => /Abono parcial/.test(o)), sel);
  await p.getByRole("button", { name: "Cancelar" }).click(); await espera(p, 200);
  sel = await opciones(1);
  ok("C7_vale_vista_ofrecido_sin_preseleccion", sel.v === "" && sel.ops.some((o) => /Vale vista/.test(o)), sel);
  const idVV = await p.locator("[data-opcion-abono]").evaluate((e) => [...e.options].find((o) => /Vale vista/.test(o.text)).value);
  await p.locator("[data-opcion-abono]").selectOption(idVV); await p.locator("[data-confirmo]").check(); await p.locator("[data-registrar]").click(); await espera(p, 3000);
  ok("C7_vale_vista_marcado_cobrado_sin_duplicar", b.escr.some((x) => x.metodo === "PATCH" && x.tabla === "eventos_pago_cliente" && x.id === "pc7" && x.cuerpo.cobrado_en_banco === true) && b.db.eventos_pago_cliente.filter((e) => e.oc_id === "oc7" && e.monto === 500000).length === 1);
  ok("C7_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

// ── C8: teléfono (390 px): filtros, Excel y ficha sin desbordar la pantalla ──
await escenario("C8", async () => {
  const b = crearBase(datos({ fotos: { oc3: fotoCancelada } }), { mp: RESPUESTAS_MP });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, espera: 3000 });
  await p.getByRole("button", { name: /Compras|OCs/ }).first().click().catch(() => {}); await espera(p, 800);
  await p.goto(URL_APP + "#compras"); await espera(p, 1500);
  await p.getByRole("button", { name: /Filtros avanzados/ }).first().click(); await espera(p, 400);
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth);
  ok("C8_sin_desborde_horizontal", ancho <= 392, ancho);
  ok("C8_filtros_y_excel_visibles", (await p.locator('[data-filtro="producto"]').isVisible()) && (await p.locator("[data-exportar-vista]").isVisible()));
  ok("C8_estado_cancelada_en_lista", /Cancelada en Mercado Público/.test(await p.locator('[data-oc="2003-103-SE26"]').innerText()));
  ok("C8_sin_errores", errs.length === 0, errs);
  await ctx.close();
});

await browser.close();
console.log(`\nRESUMEN pruebas Fase 4C (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
