// «Seguimiento especial» de OC (15/10/2026): las 17 pruebas acordadas, en PC (E) y celular (M). Supabase simulado
// (mock_estado replica la función y las políticas de oc_seguimientos: autor y fechas fijados por la base, solución
// obligatoria para resolver, lo resuelto congelado para no administradores, solo un administrador elimina).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_seguimiento.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { alertasSeguimiento, tieneSeguimientoAbierto } from "../../src/lib/seguimientos.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const FINANCIERAS = ["eventos_compra", "eventos_pago_financiamiento", "eventos_pago_cliente", "eventos_factura", "financiadores", "ajustes_saldo_financiador", "ordenes_compra_v2", "pagos_vendedor", "gastos_indirectos"];

const seg = (id, oc, o) => ({ id, oc_id: oc, categoria: "producto", descripcion: "Seguimiento " + id, prioridad: "media", estado: "pendiente", responsable_id: null, responsable_nombre: null,
  fecha_revision: null, sobrecosto_estimado: null, solucion: null, resuelto_por: null, resuelto_por_nombre: null, resuelto_en: null,
  creado_por: "u2", creado_por_nombre: "Usuario Prueba", creado_en: new Date(Date.now() - 3 * 864e5).toISOString(), actualizado_por: "u2", actualizado_en: new Date().toISOString(), ...o });
function datos() {
  const d = crearDatos();
  d.oc_seguimientos = [
    seg("sA", "oc1", { prioridad: "alta", responsable_id: "u2", responsable_nombre: "Usuario Prueba", descripcion: "Producto llegó con falla" }),
    seg("sB", "oc1", { categoria: "proveedor", fecha_revision: dias(3), descripcion: "Proveedor no confirma reposición" }),          // atrasado
    seg("sC", "oc3", { categoria: "postventa", prioridad: "alta", fecha_revision: dias(2), descripcion: "Garantía pendiente" }),        // alta + atrasado → UNA alerta
    seg("sD", "oc4", { categoria: "entrega", estado: "resuelto", solucion: "Se reenvió", resuelto_por: "u1", resuelto_por_nombre: "Admin Prueba", resuelto_en: new Date().toISOString() }),
    seg("sE", "oc7", { categoria: "cliente", prioridad: "baja", fecha_revision: dias(-5), descripcion: "Cliente pide copia de guía" }),  // sin alerta
  ];
  return d;
}

// ═════ Unitarias (reglas puras) ═════
{
  const D = datos(); const O = (id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), oc_seguimientos: D.oc_seguimientos.filter((s) => s.oc_id === id) });
  const a1 = alertasSeguimiento(O("oc1")), a3 = alertasSeguimiento(O("oc3"));
  ok("U1_alertas_alta_y_atrasado_sin_duplicar", a1.length === 2 && a3.length === 1 && /atrasado/.test(a3[0].titulo) && alertasSeguimiento(O("oc7")).length === 0 && alertasSeguimiento(O("oc4")).length === 0, { a1, a3 });
  ok("U2_filtro_cuenta_ocs", ["oc1", "oc3", "oc7"].every((x) => tieneSeguimientoAbierto(O(x))) && !tieneSeguimientoAbierto(O("oc4")) && !tieneSeguimientoAbierto(O("oc2")));
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const chip = (p, t) => p.locator("button", { hasText: new RegExp(`^${t}( \\d+)?$`) }).first();
const nChip = async (p, t) => Number(((await chip(p, t).innerText()).match(/(\d+)$/) || [0, 0])[1]);
const visibles = async (p) => (await p.locator("[data-oc]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-oc")))]));
async function irA(p, k) {
  const v = p.locator(`[data-nav="${k}"]:visible`);
  if (await v.count()) await v.first().click(); else { await p.locator('[data-nav="mas"]:visible').first().click(); await espera(p, 400); await p.locator(`[data-nav="${k}"]:visible`).first().click(); }
  await espera(p, 900);
}
const abrirOC = async (p, numero) => { await p.locator(`[data-oc="${numero}"] > div[role="button"]`).first().click(); await espera(p, 1300); };
const cerrarFicha = async (p) => {
  await p.keyboard.press("Escape"); await espera(p, 600);
  if (await p.locator("[data-ficha-oc]").count()) { await p.locator("[data-cerrar-hoja]").last().click(); await espera(p, 600); }
};
const ficha = (p) => p.locator("[data-ficha-oc]").last();
const irSeccion = async (p) => { const s = ficha(p).locator("[data-seguimiento-especial]"); if (!(await s.isVisible().catch(() => false))) { await ficha(p).locator("[data-indice-ficha] button", { hasText: /Seguimiento/ }).first().click(); await espera(p, 500); } return ficha(p).locator("[data-seguimiento-especial]"); };
const nAlertasSeg = async (p) => p.locator("[data-alerta-seguimiento]").count();

for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const finAntes = JSON.stringify({ ocs: b.db.ordenes_compra_v2.map((o) => [o.id, o.costo_total, o.monto_pagado_fin, o.monto_cobrado, o.monto_facturado]), fin: (b.db.financiadores || []).map((f) => [f.id, f.saldo_deuda]) });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });

  // T04–T06 · Alertas: alta visible, revisión vencida = «Seguimiento atrasado», sin duplicados.
  await irA(p, "notif");
  const tit = await p.locator("[data-alerta-seguimiento]").allInnerTexts();
  ok(`${pref}T04_prioridad_alta_genera_alerta`, tit.some((t) => /Seguimiento prioridad alta · Producto/.test(t) && /2001-101-SE26/.test(t)), tit);
  ok(`${pref}T05_revision_vencida_seguimiento_atrasado`, tit.some((t) => /Seguimiento atrasado · Proveedor/.test(t)) && tit.some((t) => /Seguimiento atrasado · Postventa/.test(t) && /2003-103-SE26/.test(t)), tit);
  ok(`${pref}T06_sin_alertas_duplicadas`, tit.length === 3 && tit.filter((t) => /2003-103-SE26/.test(t)).length === 1 && !tit.some((t) => /2007-107|2004-104/.test(t)), tit);

  // T07–T09 · Filtro en Compras: cuenta OC (no seguimientos), indicador discreto, combina con búsqueda.
  await irA(p, "compras");
  ok(`${pref}T08_indicador_discreto_en_lista`, (await p.locator('[data-oc="2001-101-SE26"] [data-chip-seguimiento="alta"]').count()) === 1 && (await p.locator('[data-oc="2007-107-SE26"] [data-chip-seguimiento="baja"]').count()) === 1
    && (await p.locator('[data-oc="2004-104-SE26"] [data-chip-seguimiento]').count()) === 0 && /atrasado/.test(await p.locator('[data-oc="2003-103-SE26"] [data-chip-seguimiento]').innerText()));
  const nSeg = await nChip(p, "Seguimiento especial");
  await chip(p, "Seguimiento especial").click(); await espera(p, 600);
  const vis = await visibles(p);
  ok(`${pref}T07_filtro_cuenta_ocs_no_seguimientos`, nSeg === 3 && vis.length === 3 && ["2001-101-SE26", "2003-103-SE26", "2007-107-SE26"].every((x) => vis.includes(x)) && /2 seguimientos abiertos · prioridad máxima alta · 1 atrasado/.test(await p.locator('[data-oc="2001-101-SE26"] [data-nota-vista]').innerText()), { nSeg, vis });
  const busc = p.getByPlaceholder(/Buscar/i).first();
  await busc.fill("2003-103"); await espera(p, 600);
  const visB = await visibles(p);
  await busc.fill("2004-104"); await espera(p, 600);
  ok(`${pref}T09_combina_con_busqueda`, visB.length === 1 && visB[0] === "2003-103-SE26" && (await visibles(p)).length === 0, visB);
  await busc.fill(""); await espera(p, 400);
  // Filtros existentes intactos.
  ok(`${pref}T09b_filtros_existentes_intactos`, (await chip(p, "Financiamiento pendiente").count()) === 1 && (await chip(p, "Vale vista pendiente").count()) === 1);
  await chip(p, "Todas").click(); await espera(p, 500);

  // T01–T03 · Crear en una OC sin seguimientos (2005-105): validación, campos, autor y fecha automáticos.
  await abrirOC(p, "2005-105-SE26");
  let s = await irSeccion(p);
  ok(`${pref}T01a_seccion_en_ficha`, (await s.locator("[data-seg-sin-abiertos]").count()) === 1 && (await s.locator("[data-seg-agregar]").count()) === 1);
  await s.locator("[data-seg-agregar]").click(); await espera(p, 300);
  const n0 = b.escr.length;
  await s.locator("[data-seg-guardar]").click(); await espera(p, 400);
  const cats = await s.locator('select[data-seg="categoria"] option').allInnerTexts();
  ok(`${pref}T02_categorias_predefinidas`, cats.length === 10 && cats.includes("Subsanación de factura") && ["Postventa / Garantía", "Sobrecosto / Cargo adicional", "Proveedor", "Producto", "Entrega / Despacho", "Cliente", "Facturación / Cobranza", "Otro"].every((c) => cats.includes(c)), cats);
  ok(`${pref}T03_validacion_categoria_y_descripcion`, /Elige la categoría/.test(await s.locator("[data-seg-errores]").innerText()) && /Describe el seguimiento/.test(await s.locator("[data-seg-errores]").innerText()) && b.escr.length === n0);
  await s.locator('select[data-seg="categoria"]').selectOption("sobrecosto");
  await s.locator('textarea[data-seg="descripcion"]').fill("Proveedor cobra despacho adicional");
  await s.locator('select[data-seg="prioridad"]').selectOption("alta");
  await s.locator('select[data-seg="responsable"]').selectOption("u2");
  await s.locator('input[data-seg="fecha_revision"]').fill(dias(-7));
  await s.locator('input[data-seg="sobrecosto"]').fill("45000");
  await s.locator("[data-seg-guardar]").click(); await espera(p, 1800);
  const nuevo = (b.db.oc_seguimientos || []).find((x) => x.oc_id === "oc5");
  s = await irSeccion(p);
  ok(`${pref}T01_crear_con_autor_y_fecha_automaticos`, !!nuevo && nuevo.categoria === "sobrecosto" && nuevo.prioridad === "alta" && nuevo.estado === "pendiente" && nuevo.responsable_nombre === "Usuario Prueba"
    && nuevo.creado_por === "u1" && nuevo.creado_por_nombre === "Admin Prueba" && !!nuevo.creado_en && nuevo.sobrecosto_estimado === 45000 && nuevo.fecha_revision === dias(-7)
    && (await s.locator(`[data-seg-item="${nuevo?.id}"]`).count()) === 1 && /Registrado por Admin Prueba/.test(await s.locator(`[data-seg-item="${nuevo?.id}"]`).innerText())
    && b.db.historial_cambios.some((h) => h.campo === `seguimiento:${nuevo?.id}` && /creado/.test(h.accion)), nuevo);
  const it = s.locator(`[data-seg-item="${nuevo.id}"]`);
  ok(`${pref}T15a_sobrecosto_marcado_informativo`, /Sobrecosto estimado: \$45\.000 \(informativo\)/.test(await it.locator("[data-seg-sobrecosto]").innerText()));

  // T10 · Cambiar prioridad y responsable (queda en el historial).
  await it.locator("[data-seg-prioridad]").selectOption("media"); await espera(p, 1500);
  await it.locator("[data-seg-responsable]").selectOption("u1"); await espera(p, 1500);
  const r10 = b.db.oc_seguimientos.find((x) => x.id === nuevo.id);
  ok(`${pref}T10_cambiar_prioridad_y_responsable_con_traza`, r10.prioridad === "media" && r10.responsable_id === "u1" && r10.responsable_nombre === "Admin Prueba" && r10.actualizado_por === "u1"
    && b.db.historial_cambios.some((h) => h.campo === `seguimiento:${nuevo.id}` && /prioridad cambiado/.test(h.accion) && h.valor_anterior === "Alta" && h.valor_nuevo === "Media")
    && b.db.historial_cambios.some((h) => h.campo === `seguimiento:${nuevo.id}` && /responsable cambiado/.test(h.accion) && h.valor_nuevo === "Admin Prueba"), r10);
  // T12 · Pasar a En gestión.
  await it.locator("[data-seg-en-gestion]").click(); await espera(p, 1500);
  ok(`${pref}T12_pasar_a_en_gestion`, b.db.oc_seguimientos.find((x) => x.id === nuevo.id).estado === "en_gestion" && (await it.getAttribute("data-estado")) === "en_gestion" && (await it.locator("[data-seg-en-gestion]").count()) === 0);
  // T11 · Registrar avance.
  await it.locator("[data-seg-avance-abrir]").click(); await espera(p, 300);
  await it.locator('textarea[data-seg="avance"]').fill("Se pidió nota de crédito al proveedor");
  await it.locator("[data-seg-confirmar]").click(); await espera(p, 1600);
  ok(`${pref}T11_registrar_avance`, b.db.historial_cambios.some((h) => h.campo === `seguimiento:${nuevo.id}` && /avance/.test(h.accion) && h.valor_nuevo === "Se pidió nota de crédito al proveedor" && h.usuario_nombre === "Admin Prueba")
    && /Se pidió nota de crédito al proveedor/.test(await it.locator("[data-seg-bitacora]").innerText()));
  // T13 · Resolver exige solución (la interfaz no envía nada sin ella; la base también lo exige).
  const n13 = b.escr.length;
  await it.locator("[data-seg-resolver-abrir]").click(); await espera(p, 300);
  await it.locator("[data-seg-confirmar]").click(); await espera(p, 400);
  const sinSol = b.escribir("PATCH", "oc_seguimientos", new URLSearchParams("id=eq." + nuevo.id), { estado: "resuelto" }, "u1");
  ok(`${pref}T13_resolver_exige_solucion`, /indica la solución/.test(await it.locator("[data-seg-error]").innerText()) && b.escr.slice(n13).filter((w) => w.metodo !== "RPC").length === 1 && sinSol.status === 400 && b.db.oc_seguimientos.find((x) => x.id === nuevo.id).estado === "en_gestion");
  // T14 · Resolver con solución: queda como historial con quién y cuándo.
  await it.locator('textarea[data-seg="solucion"]').fill("Proveedor emitió nota de crédito por el despacho");
  await it.locator("[data-seg-confirmar]").click(); await espera(p, 1800);
  s = await irSeccion(p);
  const r14 = b.db.oc_seguimientos.find((x) => x.id === nuevo.id);
  await s.locator("[data-seg-ver-resueltos]").click(); await espera(p, 300);
  ok(`${pref}T14_resuelto_queda_como_historial`, r14.estado === "resuelto" && r14.solucion === "Proveedor emitió nota de crédito por el despacho" && r14.resuelto_por === "u1" && r14.resuelto_por_nombre === "Admin Prueba" && !!r14.resuelto_en
    && (await s.locator(`[data-seg-item="${nuevo.id}"]`).count()) === 0 && /Proveedor emitió nota de crédito/.test(await s.locator(`[data-seg-resuelto="${nuevo.id}"]`).innerText())
    && /Resuelto por Admin Prueba/.test(await s.locator(`[data-seg-resuelto="${nuevo.id}"]`).innerText())
    && b.db.historial_cambios.some((h) => h.campo === `seguimiento:${nuevo.id}` && h.accion === "Seguimiento especial resuelto"), r14);
  await cerrarFicha(p);

  // Resolver la garantía de 2003-103 (alta + atrasada): su alerta desaparece y la OC sale del filtro.
  await chip(p, "Seguimiento especial").click(); await espera(p, 500);
  await abrirOC(p, "2003-103-SE26");
  s = await irSeccion(p);
  const iC = s.locator('[data-seg-item="sC"]');
  ok(`${pref}T05b_atrasado_visible_en_ficha`, (await iC.locator("[data-seg-atrasado]").count()) === 1);
  await iC.locator("[data-seg-resolver-abrir]").click(); await espera(p, 300);
  await iC.locator('textarea[data-seg="solucion"]').fill("Se cambió el equipo por garantía"); await iC.locator("[data-seg-confirmar]").click(); await espera(p, 1800);
  await cerrarFicha(p);
  await chip(p, "Seguimiento especial").click(); await espera(p, 600);
  const vis2 = await visibles(p);
  ok(`${pref}T14b_resuelto_sale_del_filtro`, (await nChip(p, "Seguimiento especial")) === 2 && !vis2.includes("2003-103-SE26") && vis2.includes("2001-101-SE26"), vis2);
  await chip(p, "Todas").click(); await espera(p, 400);
  ok(`${pref}T14c_ficha_no_reaparece_al_cambiar_vista`, (await p.locator("[data-ficha-oc]").count()) === 0);
  await irA(p, "notif");
  const tit2 = await p.locator("[data-alerta-seguimiento]").allInnerTexts();
  ok(`${pref}T06b_alerta_desaparece_al_resolver`, tit2.length === 2 && !tit2.some((t) => /2003-103-SE26/.test(t)), tit2);

  // T15 · El sobrecosto no afecta utilidades, compras, deudas ni saldos.
  const finDespues = JSON.stringify({ ocs: b.db.ordenes_compra_v2.map((o) => [o.id, o.costo_total, o.monto_pagado_fin, o.monto_cobrado, o.monto_facturado]), fin: (b.db.financiadores || []).map((f) => [f.id, f.saldo_deuda]) });
  const tablas = [...new Set(b.escr.filter((w) => w.metodo !== "RPC").map((w) => w.tabla))];
  // Lo único que escribe la app en ordenes_compra_v2 al abrir una OC es la sincronización con Mercado Público (datos de la OC, nunca montos).
  const ocW = b.escr.filter((w) => w.tabla === "ordenes_compra_v2").map((w) => Object.keys(w.cuerpo || {})).flat();
  const MONTOS = ["costo_total", "monto_pagado_fin", "monto_cobrado", "monto_facturado", "monto_total", "estado_compra", "estado_pago_financiamiento", "financiador_id"];
  ok(`${pref}T15_sobrecosto_solo_informativo`, finAntes === finDespues && !tablas.some((t) => FINANCIERAS.filter((x) => x !== "ordenes_compra_v2").includes(t)) && !ocW.some((k) => MONTOS.includes(k))
    && b.escr.filter((w) => w.tabla === "oc_seguimientos").length >= 6, { tablas, ocW: [...new Set(ocW)] });
  ok(`${pref}T00_sin_errores_admin`, !errs.length, errs);
  await ctx.close();

  // T16 · Permisos: usuario normal gestiona abiertos, pero no elimina ni modifica lo resuelto (la base lo impide).
  const u = await abrir(browser, b, { url: URL_APP, usuario: "u2", ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await irA(u.page, "compras");
  await abrirOC(u.page, "2001-101-SE26");
  s = await irSeccion(u.page);
  const borrarU = b.escribir("DELETE", "oc_seguimientos", new URLSearchParams("id=eq.sA"), null, "u2");
  const editarResueltoU = b.escribir("PATCH", "oc_seguimientos", new URLSearchParams("id=eq.sD"), { solucion: "cambiada" }, "u2");
  const anon = b.escribir("POST", "oc_seguimientos", new URLSearchParams(), { id: "x", oc_id: "oc1", categoria: "otro", descripcion: "x" }, null);
  await s.locator('[data-seg-item="sB"] [data-seg-en-gestion]').click(); await espera(u.page, 1500);
  ok(`${pref}T16_permisos_usuario_y_sin_sesion`, (await s.locator("[data-seg-eliminar]").count()) === 0 && borrarU.json.length === 0 && b.db.oc_seguimientos.some((x) => x.id === "sA")
    && editarResueltoU.status === 400 && b.db.oc_seguimientos.find((x) => x.id === "sD").solucion === "Se reenvió" && anon.status === 401
    && b.db.oc_seguimientos.find((x) => x.id === "sB").estado === "en_gestion" && b.db.oc_seguimientos.find((x) => x.id === "sB").actualizado_por === "u2", { borrarU, editarResueltoU, anon });
  ok(`${pref}T00_sin_errores_usuario`, !u.errs.length, u.errs);
  await u.ctx.close();

  // T17 · Respeta el bloqueo de la OC: si otro usuario la está editando, la sección queda en solo lectura.
  b.bloqueosOcupados["oc7"] = "Otro Usuario";
  const l = await abrir(browser, b, { url: URL_APP, usuario: "u1", ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await irA(l.page, "compras");
  await abrirOC(l.page, "2007-107-SE26"); await espera(l.page, 800);
  s = await irSeccion(l.page);
  const n17 = b.escr.filter((w) => w.metodo !== "RPC").length;
  ok(`${pref}T17_respeta_bloqueo_de_la_oc`, (await s.locator('[data-seg-item="sE"]').count()) === 1 && (await s.locator("[data-seg-agregar]").count()) === 0 && (await s.locator("[data-seg-resolver-abrir]").count()) === 0
    && /Solo lectura/.test(await s.innerText()) && b.escr.filter((w) => w.metodo !== "RPC").length === n17);
  ok(`${pref}T00_sin_errores_bloqueo`, !l.errs.length, l.errs);
  await l.ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
