// Contador de productos vendidos y subsanación de facturas en Seguimiento especial (15/10/2026). Supabase simulado.
// Cubre las 15 condiciones del encargo, en PC (E) y celular (M).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_subsanacion.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { productosVendidos } from "../../src/lib/productosOC.js";
import { descripcionSubsanacion, leerSubsanacion, subsanacionDuplicada, alertasSeguimiento, etiquetaSeguimiento } from "../../src/lib/seguimientos.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const FINANCIERAS = ["eventos_compra", "eventos_pago_financiamiento", "eventos_pago_cliente", "eventos_factura", "financiadores", "ajustes_saldo_financiador", "pagos_vendedor", "gastos_indirectos", "iva_mensual", "aportes_socios"];
// La revisión automática de Mercado Público (comportamiento previo) puede completar líneas de OTRAS OC; las de estas pruebas no se tocan.
const PROPIAS = ["ocP1", "ocP2", "ocP3", "ocP4", "ocP5", "ocP6", "oc2"];
const linksPropios = (db) => JSON.stringify(db.oc_productos_link.filter((x) => PROPIAS.includes(x.oc_id)));

const item = (n, d) => ({ n, descripcion: d, cantidad: 1, unidad: "Unidad", precio_unitario: 100000, total: 100000 });
const foto = (items) => ({ v: 1, revisado_en: new Date().toISOString(), codigo_estado: 6, estado: "Aceptada", aceptada: true, neto: 200000, iva: 38000, total: 238000, items });
function datos() {
  const d = crearDatos();
  const base = d.ordenes_compra_v2[0];
  const nueva = (id, numero) => ({ ...base, id, numero_oc: numero, cliente: "CLIENTE " + numero, estado_compra: "pendiente", costo_total: 0, estado_entrega: "pendiente" });
  // P1: caso real (1224953-754-AG26): los productos de MP quedaron como líneas «compra» + la compra real. Sin desglose de venta.
  // P2: desglose BFK (3 líneas venta), sin foto MP. P3: ambas fuentes (2 venta + 2 MP) → 2, no 4.
  // P4: solo compras, sin MP → sin productos. P5: nada. P6: línea «Producto por completar» + 1 ítem MP → 1.
  d.ordenes_compra_v2.push(nueva("ocP1", "5001-1-AG26"), nueva("ocP2", "5002-2-AG26"), nueva("ocP3", "5003-3-AG26"), nueva("ocP4", "5004-4-AG26"), nueva("ocP5", "5005-5-AG26"), nueva("ocP6", "5006-6-AG26"));
  const l = (id, oc, desc, origen, orden) => ({ id, oc_id: oc, descripcion: desc, url: "sin-link", orden, origen, cantidad: 1, precio_compra: origen === "compra" ? 50000 : null, precio_venta: origen === "venta" ? 100000 : null });
  d.oc_productos_link.push(
    l("p1a", "ocP1", "Adquisición de 1 proyector portátil", "compra", 0), l("p1b", "ocP1", "Adquisición de 1 telón manual", "compra", 1), l("p1c", "ocP1", "PROYECTOR PORTATIL × 1 | Compra: $158.910", "compra", 2),
    l("p2a", "ocP2", "Mesa", "venta", 0), l("p2b", "ocP2", "Silla", "venta", 1), l("p2c", "ocP2", "Pizarra", "venta", 2),
    l("p3a", "ocP3", "Proyector portátil", "venta", 0), l("p3b", "ocP3", "Telón manual", "venta", 1), l("p3c", "ocP3", "Proyector comprado", "compra", 2),
    l("p4a", "ocP4", "Compra suelta", "compra", 0), l("p4b", "ocP4", "Otra compra", "compra", 1),
    l("p6a", "ocP6", "Producto por completar", null, 0));
  d.mp_cache_avisos = [
    { id: "oc_mp:ocP1", datos: foto([item(1, "Adquisición de 1 proyector portátil"), item(2, "Adquisición de 1 telón manual")]) },
    { id: "oc_mp:ocP3", datos: foto([item(1, "Adquisición de 1 proyector portátil"), item(2, "Adquisición de 1 telón manual")]) },
    { id: "oc_mp:ocP6", datos: foto([item(1, "Escritorio")]) },
  ];
  d.oc_seguimientos = [];
  return d;
}

// ═════ Unitarias ═════
{
  const D = datos(); const O = (id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), oc_productos_link: D.oc_productos_link.filter((x) => x.oc_id === id), mp: D.mp_cache_avisos.find((c) => c.id === "oc_mp:" + id)?.datos || null });
  const n = (id) => productosVendidos(O(id)).n;
  ok("U1_contador_fuentes", n("ocP1") === 2 && productosVendidos(O("ocP1")).fuente === "mp" && n("ocP2") === 3 && n("ocP3") === 2 && productosVendidos(O("ocP3")).fuente === "bfk" && n("ocP4") === 0 && n("ocP5") === 0 && n("ocP6") === 1,
    ["ocP1", "ocP2", "ocP3", "ocP4", "ocP5", "ocP6"].map(n));
  const desc = descripcionSubsanacion({ facturaId: "fa2", numero: "702", motivo: "Falta N.º de OC en la glosa", fechaSolicitud: "2026-10-14", solicitante: "Depto. Finanzas" });
  const sub = leerSubsanacion({ categoria: "facturacion", descripcion: desc });
  ok("U2_subsanacion_ida_y_vuelta", sub.facturaId === "fa2" && sub.numero === "702" && sub.motivo === "Falta N.º de OC en la glosa" && sub.fechaSolicitud === "2026-10-14" && sub.solicitante === "Depto. Finanzas"
    && leerSubsanacion({ categoria: "otro", descripcion: desc }) === null && etiquetaSeguimiento({ categoria: "facturacion", descripcion: desc }) === "Subsanación de factura N.º 702");
  const ocS = { oc_seguimientos: [{ id: "x", categoria: "facturacion", descripcion: desc, estado: "pendiente", prioridad: "alta", fecha_revision: dias(1) }] };
  ok("U3_duplicado_y_alerta_unica", subsanacionDuplicada(ocS, { facturaId: "fa2", fechaSolicitud: "2026-10-14", motivo: "falta n.º de oc en la  GLOSA" }) && !subsanacionDuplicada(ocS, { facturaId: "fa2", fechaSolicitud: "2026-10-14", motivo: "Otro motivo" })
    && alertasSeguimiento(ocS).length === 1 && /Seguimiento atrasado · Subsanación de factura N\.º 702/.test(alertasSeguimiento(ocS)[0].titulo));
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
const busc = (p) => p.getByPlaceholder(/Buscar/i).first();
const abrirOC = async (p, numero) => { await busc(p).fill(numero); await espera(p, 500); await p.locator(`[data-oc="${numero}"] > div[role="button"]`).first().click(); await espera(p, 1400); };
const cerrarFicha = async (p) => { await p.keyboard.press("Escape"); await espera(p, 500); if (await p.locator("[data-ficha-oc]").count()) { await p.locator("[data-cerrar-hoja]").last().click(); await espera(p, 500); } await busc(p).fill(""); await espera(p, 400); };
const ficha = (p) => p.locator("[data-ficha-oc]").last();
const resumenSec = async (p, id, ocId) => p.locator(`[data-seccion-ficha="${id}-${ocId}"]`).first().locator("button").first().innerText();
const abrirSec = async (p, texto) => { await ficha(p).locator("[data-indice-ficha] button", { hasText: texto }).first().click(); await espera(p, 500); };

for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const facturasAntes = JSON.stringify(b.db.eventos_factura);
  const finAntes = JSON.stringify({ ocs: b.db.ordenes_compra_v2.map((o) => [o.id, o.costo_total, o.monto_pagado_fin, o.monto_cobrado, o.monto_facturado, o.estado_factura_propia, o.estado_pago_cliente]), fin: (b.db.financiadores || []).map((f) => [f.id, f.saldo_deuda]) });
  const linksAntes = linksPropios(b.db);
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await irA(p, "compras");

  // 1–3 · Contador de productos vendidos (fuentes, sin duplicar, sin contar compras).
  const conteos = {};
  for (const [id, num] of [["ocP1", "5001-1-AG26"], ["ocP2", "5002-2-AG26"], ["ocP3", "5003-3-AG26"], ["ocP4", "5004-4-AG26"], ["ocP5", "5005-5-AG26"], ["ocP6", "5006-6-AG26"]]) {
    await abrirOC(p, num);
    conteos[id] = (await resumenSec(p, "productos", id)).replace(/\s+/g, " ");
    if (id === "ocP1") { await abrirSec(p, /Productos/); conteos.notaP1 = await ficha(p).locator("[data-sin-desglose-venta]").count(); }
    await cerrarFicha(p);
  }
  ok(`${pref}01_contador_productos_vendidos`, /2 productos/.test(conteos.ocP1) && /3 productos/.test(conteos.ocP2) && /1 producto\b/.test(conteos.ocP6) && conteos.notaP1 === 1, conteos);
  ok(`${pref}02_sin_duplicar_bfk_y_mp`, /2 productos/.test(conteos.ocP3) && !/4 productos/.test(conteos.ocP3), conteos.ocP3);
  ok(`${pref}03_separa_vendidos_y_comprados`, /sin productos/.test(conteos.ocP4) && /sin productos/.test(conteos.ocP5) && !/3 productos/.test(conteos.ocP1) && linksPropios(b.db) === linksAntes, conteos);

  // 4–5 · Crear una subsanación desde la factura 702 de la OC 2002-102 (factura preseleccionada).
  await abrirOC(p, "2002-102-SE26");
  await abrirSec(p, /Facturación/);
  const fila702 = ficha(p).locator('[data-documento]').filter({ has: p.locator('[data-registrar-subsanacion="702"]') }).first();
  const pendSII = await fila702.innerText();
  await fila702.locator('[data-registrar-subsanacion="702"]').click(); await espera(p, 700);
  const form = ficha(p).locator("[data-seg-form]");
  ok(`${pref}04a_formulario_con_factura_preseleccionada`, (await form.count()) === 1 && (await form.locator('select[data-seg="categoria"]').inputValue()) === "subsanacion" && (await form.locator('select[data-seg="factura"]').inputValue()) === "fa2"
    && (await form.locator('input[data-seg="fecha_solicitud"]').inputValue()).length === 10 && (await form.locator('input[data-seg="sobrecosto"]').count()) === 0);
  const n0 = b.escr.length;
  await form.locator("[data-seg-guardar]").click(); await espera(p, 400);
  ok(`${pref}04b_motivo_obligatorio`, /motivo de la subsanación/.test(await form.locator("[data-seg-errores]").innerText()) && b.escr.length === n0);
  await form.locator('textarea[data-seg="motivo"]').fill("El organismo pide indicar el N.º de OC en la glosa");
  await form.locator('input[data-seg="fecha_solicitud"]').fill(dias(2));
  await form.locator('input[data-seg="solicitante"]').fill("Depto. Finanzas Municipalidad");
  await form.locator('select[data-seg="prioridad"]').selectOption("alta");
  await form.locator('select[data-seg="responsable"]').selectOption("u2");
  await form.locator('input[data-seg="fecha_revision"]').fill(dias(1));   // fecha límite ya vencida
  await form.locator("[data-seg-guardar]").click(); await espera(p, 1800);
  const s1 = b.db.oc_seguimientos.find((x) => x.oc_id === "oc2");
  const sub1 = leerSubsanacion(s1);
  ok(`${pref}04_crear_subsanacion_desde_factura`, !!s1 && s1.categoria === "facturacion" && s1.estado === "pendiente" && s1.prioridad === "alta" && s1.responsable_nombre === "Usuario Prueba" && s1.creado_por === "u1" && s1.fecha_revision === dias(1) && s1.sobrecosto_estimado == null, s1);
  ok(`${pref}05_asociada_a_la_factura_correcta`, sub1?.facturaId === "fa2" && sub1.numero === "702" && sub1.fechaSolicitud === dias(2) && sub1.solicitante === "Depto. Finanzas Municipalidad" && !/1\.210\.000|1210000/.test(s1.descripcion)
    && /Factura N\.º 702 · \$1\.210\.000/.test(await ficha(p).locator(`[data-seg-item="${s1.id}"] [data-seg-subsanacion]`).innerText()), s1?.descripcion);
  // Indicador junto a la factura, distinto de «Pendiente SII».
  await abrirSec(p, /Facturación/);
  const ind = ficha(p).locator('[data-subsanacion-abierta="702"]');
  ok(`${pref}05b_indicador_en_factura_distinto_de_SII`, (await ind.count()) === 1 && /Subsanación solicitada/.test(await ind.innerText()) && /Pendiente SII/.test(pendSII) && /Pendiente SII/.test(await fila702.innerText()));
  // Duplicado accidental (misma factura, fecha y motivo): se bloquea. Otra gestión sobre la misma factura: se permite.
  await fila702.locator('[data-registrar-subsanacion="702"]').click(); await espera(p, 700);
  const f2 = ficha(p).locator("[data-seg-form]");
  await f2.locator('textarea[data-seg="motivo"]').fill("el organismo pide indicar el n.º de OC en la glosa ");
  await f2.locator('input[data-seg="fecha_solicitud"]').fill(dias(2));
  const n1 = b.escr.length;
  await f2.locator("[data-seg-guardar]").click(); await espera(p, 500);
  const dupBloq = /Ya hay una subsanación abierta de la factura N\.º 702/.test(await f2.locator("[data-seg-errores]").innerText()) && b.escr.length === n1;
  await f2.locator('textarea[data-seg="motivo"]').fill("Corregir la dirección del receptor");
  await f2.locator("[data-seg-guardar]").click(); await espera(p, 1800);
  const subs = b.db.oc_seguimientos.filter((x) => x.oc_id === "oc2");
  ok(`${pref}08_varias_incidencias_y_sin_duplicar`, dupBloq && subs.length === 2 && subs.every((x) => leerSubsanacion(x)?.facturaId === "fa2"), subs.map((x) => x.descripcion));
  await abrirSec(p, /Facturación/);
  ok(`${pref}08b_indicador_cuenta_dos`, /\(2\)/.test(await ficha(p).locator('[data-subsanacion-abierta="702"]').innerText()));
  // El indicador lleva a la incidencia en la misma ficha.
  await ficha(p).locator('[data-subsanacion-abierta="702"]').click(); await espera(p, 800);
  ok(`${pref}05c_consultar_desde_la_ficha`, await ficha(p).locator(`[data-seg-item="${s1.id}"]`).isVisible());

  // 6–7 · En gestión, avance y resolución con solución obligatoria.
  const s2 = subs.find((x) => x.id !== s1.id);
  const it2 = ficha(p).locator(`[data-seg-item="${s2.id}"]`);
  await it2.locator("[data-seg-en-gestion]").click(); await espera(p, 1500);
  await it2.locator("[data-seg-avance-abrir]").click(); await it2.locator('textarea[data-seg="avance"]').fill("Se envió la consulta al organismo"); await it2.locator("[data-seg-confirmar]").click(); await espera(p, 1500);
  ok(`${pref}06_pendiente_y_en_gestion`, b.db.oc_seguimientos.find((x) => x.id === s1.id).estado === "pendiente" && b.db.oc_seguimientos.find((x) => x.id === s2.id).estado === "en_gestion"
    && b.db.historial_cambios.some((h) => h.campo === `seguimiento:${s2.id}` && /avance \(Subsanación de factura N\.º 702\)/.test(h.accion)));

  // 9–11 · Alerta (alta + vencida → una sola, «atrasado») y filtro.
  await cerrarFicha(p);
  await chip(p, "Seguimiento especial").click(); await espera(p, 500);
  const visS = await visibles(p);
  ok(`${pref}11_filtro_seguimiento_actualizado`, visS.includes("2002-102-SE26") && visS.filter((x) => x === "2002-102-SE26").length === 1 && (await nChip(p, "Seguimiento especial")) === visS.length, visS);
  await chip(p, "Todas").click(); await espera(p, 400);
  await irA(p, "notif");
  const al = await p.locator("[data-alerta-seguimiento]").allInnerTexts();
  ok(`${pref}09_prioridad_alta_y_fecha_vencida`, al.some((t) => /Seguimiento atrasado · Subsanación de factura N\.º 702/.test(t) && /Fecha límite/.test(t)), al);
  ok(`${pref}10_alertas_sin_duplicar`, al.length === 1, al);
  await irA(p, "compras");

  // 7 · Resolver: exige solución; al resolver se retira la alerta y se conserva el historial.
  await abrirOC(p, "2002-102-SE26");
  if (!(await ficha(p).locator(`[data-seg-item="${s1.id}"]`).isVisible().catch(() => false))) await abrirSec(p, /Seguimiento/);
  const it1 = ficha(p).locator(`[data-seg-item="${s1.id}"]`);
  await it1.locator("[data-seg-resolver-abrir]").click(); await it1.locator("[data-seg-confirmar]").click(); await espera(p, 400);
  const sinSol = /indica la solución/.test(await it1.locator("[data-seg-error]").innerText()) && b.db.oc_seguimientos.find((x) => x.id === s1.id).estado === "pendiente";
  await it1.locator('textarea[data-seg="solucion"]').fill("Se reenvió la factura con la glosa corregida por el procedimiento autorizado");
  await it1.locator("[data-seg-confirmar]").click(); await espera(p, 1800);
  const r1 = b.db.oc_seguimientos.find((x) => x.id === s1.id);
  await ficha(p).locator("[data-seg-ver-resueltos]").click(); await espera(p, 300);
  ok(`${pref}07_resolucion_con_solucion_obligatoria`, sinSol && r1.estado === "resuelto" && r1.resuelto_por_nombre === "Admin Prueba" && /glosa corregida/.test(await ficha(p).locator(`[data-seg-resuelto="${s1.id}"]`).innerText())
    && /Factura N\.º 702/.test(await ficha(p).locator(`[data-seg-resuelto="${s1.id}"]`).innerText()));
  await abrirSec(p, /Facturación/);
  ok(`${pref}07b_indicador_baja_a_una`, !/\(2\)/.test(await ficha(p).locator('[data-subsanacion-abierta="702"]').innerText()));
  await cerrarFicha(p);
  await irA(p, "notif");
  ok(`${pref}10b_alerta_retirada_al_resolver`, (await p.locator("[data-alerta-seguimiento]").count()) === 0);
  await irA(p, "compras");

  // 14–15 · Sin cambios financieros ni tributarios; filtros existentes intactos.
  const tablas = [...new Set(b.escr.filter((w) => w.metodo !== "RPC").map((w) => w.tabla))];
  const finDespues = JSON.stringify({ ocs: b.db.ordenes_compra_v2.map((o) => [o.id, o.costo_total, o.monto_pagado_fin, o.monto_cobrado, o.monto_facturado, o.estado_factura_propia, o.estado_pago_cliente]), fin: (b.db.financiadores || []).map((f) => [f.id, f.saldo_deuda]) });
  const ocW = b.escr.filter((w) => w.tabla === "ordenes_compra_v2").map((w) => Object.keys(w.cuerpo || {})).flat();
  ok(`${pref}14_sin_cambios_financieros`, JSON.stringify(b.db.eventos_factura) === facturasAntes && finAntes === finDespues && !tablas.some((t) => FINANCIERAS.includes(t))
    && !ocW.some((k) => /monto|costo|estado_factura|estado_pago|financiador/.test(k)) && linksPropios(b.db) === linksAntes, { tablas, ocW: [...new Set(ocW)] });
  ok(`${pref}15_filtros_existentes_intactos`, (await chip(p, "Financiamiento pendiente").count()) === 1 && (await chip(p, "Vale vista pendiente").count()) === 1);
  ok(`${pref}13_sin_errores_pc_celular_admin`, !errs.length, errs);
  await ctx.close();

  // 12 · Permisos (usuario normal), trazabilidad y bloqueo de edición simultánea.
  const u = await abrir(browser, b, { url: URL_APP, usuario: "u2", ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await irA(u.page, "compras"); await abrirOC(u.page, "2002-102-SE26");
  if (!(await ficha(u.page).locator("[data-seguimiento-especial]").isVisible().catch(() => false))) await abrirSec(u.page, /Seguimiento/);
  const noBorra = (await ficha(u.page).locator("[data-seg-eliminar]").count()) === 0 && b.escribir("DELETE", "oc_seguimientos", new URLSearchParams("id=eq." + s2.id), null, "u2").json.length === 0;
  const noEditaResuelto = b.escribir("PATCH", "oc_seguimientos", new URLSearchParams("id=eq." + s1.id), { solucion: "otra" }, "u2").status === 400;
  const traza = b.db.historial_cambios.filter((h) => String(h.campo || "").startsWith("seguimiento:"));
  await u.ctx.close();
  b.bloqueosOcupados["oc2"] = "Otro Usuario";
  const l = await abrir(browser, b, { url: URL_APP, usuario: "u1", ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await irA(l.page, "compras"); await abrirOC(l.page, "2002-102-SE26"); await espera(l.page, 800);
  await abrirSec(l.page, /Facturación/);
  const nL = b.escr.filter((w) => w.metodo !== "RPC").length;
  await ficha(l.page).locator('[data-registrar-subsanacion="702"]').click({ force: true }); await espera(l.page, 700);
  ok(`${pref}12_permisos_trazabilidad_y_bloqueo`, noBorra && noEditaResuelto && b.db.oc_seguimientos.length === 2
    && traza.some((h) => /creado \(Subsanación de factura N\.º 702/.test(h.accion) && !/⟦/.test(h.valor_nuevo || "")) && traza.some((h) => h.accion === "Seguimiento especial resuelto")
    && (await ficha(l.page).locator("[data-seg-form]").count()) === 0 && b.escr.filter((w) => w.metodo !== "RPC").length === nL, traza.map((h) => h.accion));
  ok(`${pref}13b_sin_errores_usuario_bloqueo`, !l.errs.length, l.errs);
  await l.ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
