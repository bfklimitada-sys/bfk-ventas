// Fase 1 de compatibilidad con ventas exentas (20/10/2026). Datos ficticios; no toca Supabase.
//  · Comisión de venta propia: DTE 33 e historial (sin tipo) idénticos al cálculo anterior (monto − monto/1,19);
//    DTE 34 descuenta el IVA registrado en el documento o 0.
//  · Rentabilidad (gananciaReal), utilidad y monto tributario no cambian.
//  · Pantallas: una OC con factura exenta vigente se muestra exenta (sin dividir por 1,19); las afectas, igual que antes.
//  · No hay camino para crear una factura exenta: el formulario registra DTE 33 y bloquea reemitir sobre una OC con DTE 34.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_exentas_fase1.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { calcularPagoVendedor, gananciaReal, facturasVigentes } from "../../src/lib/calculos.js";
import { ivaDeDocumento, tipoVentaPorDocumentos, ventaExentaPorDocumentos, bloqueoFacturaPorExenta, montoTributarioVigente } from "../../src/lib/tributario.js";
import { ventaDeOC } from "../../src/lib/productosOC.js";
import { facturaVisibleOC } from "../../src/lib/vistaCompras.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);

// Fecha de facturas en el mes anterior para que todas caigan en el mismo período de comisión.
const FECHA = dias(35);
function datos() {
  const d = crearDatos();
  const base = d.ordenes_compra_v2[0];
  const oc = (id, numero, o) => ({ ...base, id, numero_oc: numero, cliente: "CLIENTE " + id.toUpperCase(), vendedor_id: "v1", estado_entrega: "confirmada", estado_factura_propia: "emitida", ...o });
  d.ordenes_compra_v2.push(
    // Venta propia exenta: factura DTE 34 sin IVA registrado.
    oc("ocX", "7001-1-OC26", { es_venta_propia: true, monto_total: 1000000, costo_total: 700000, monto_facturado: 1000000 }),
    // Venta propia exenta con IVA registrado (dato hipotético): se usa el registrado.
    oc("ocXi", "7002-2-OC26", { es_venta_propia: true, monto_total: 1000000, costo_total: 600000, monto_facturado: 1000000 }),
    // Venta propia afecta DTE 33 explícita, con monto_iva distinto al 19%: el cálculo sigue siendo el histórico.
    oc("ocY", "7003-3-OC26", { es_venta_propia: true, monto_total: 1190000, costo_total: 800000, monto_facturado: 1190000 }),
    // Venta propia histórica (sin tipo_dte), refacturada: 500 anulada por NC 61 código 1 y 501 vigente.
    oc("ocH", "7004-4-OC26", { es_venta_propia: true, monto_total: 2380000, costo_total: 1500000, monto_facturado: 2380000 }),
    // Exenta con NC código 1 sobre la DTE 34 (ref_tipo_dte 34) y nueva DTE 34 vigente.
    oc("ocN", "7005-5-OC26", { monto_total: 500000, costo_total: 300000, monto_facturado: 500000 }),
    // Exenta con NC código 3 (corrige monto) sobre la DTE 34.
    oc("ocN3", "7006-6-OC26", { monto_total: 800000, costo_total: 500000, monto_facturado: 700000 }),
    // Exenta, compra pendiente: para revisar el formulario de compra.
    oc("ocZ", "7007-7-OC26", { monto_total: 900000, costo_total: 0, estado_compra: "pendiente", estado_entrega: "pendiente", monto_facturado: 900000 }),
  );
  d.eventos_factura.push(
    { id: "fx", oc_id: "ocX", fecha: FECHA, numero_factura: "3401", monto: 1000000, tipo_dte: 34 },
    { id: "fxi", oc_id: "ocXi", fecha: FECHA, numero_factura: "3402", monto: 1000000, tipo_dte: 34, monto_iva: 12345, monto_exento: 1000000 },
    { id: "fy", oc_id: "ocY", fecha: FECHA, numero_factura: "3301", monto: 1190000, tipo_dte: 33, monto_iva: 150000, monto_neto: 1040000 },
    { id: "fh0", oc_id: "ocH", fecha: dias(40), numero_factura: "500", monto: 2380000 },
    { id: "nch", oc_id: "ocH", fecha: dias(38), numero_factura: "70", monto: 2380000, tipo_dte: 61, ref_tipo_dte: 33, ref_folio: "500", ref_codigo: 1, ref_motivo: "Anula" },
    { id: "fh1", oc_id: "ocH", fecha: FECHA, numero_factura: "501", monto: 2380000 },
    { id: "fn0", oc_id: "ocN", fecha: dias(40), numero_factura: "3410", monto: 500000, tipo_dte: 34 },
    { id: "ncn", oc_id: "ocN", fecha: dias(38), numero_factura: "71", monto: 500000, tipo_dte: 61, ref_tipo_dte: 34, ref_folio: "3410", ref_codigo: 1, ref_motivo: "Anula" },
    { id: "fn1", oc_id: "ocN", fecha: FECHA, numero_factura: "3411", monto: 500000, tipo_dte: 34 },
    { id: "fn3", oc_id: "ocN3", fecha: FECHA, numero_factura: "3420", monto: 800000, tipo_dte: 34 },
    { id: "nc3", oc_id: "ocN3", fecha: FECHA, numero_factura: "72", monto: 100000, tipo_dte: 61, ref_tipo_dte: 34, ref_folio: "3420", ref_codigo: 3, ref_motivo: "Descuento" },
    { id: "fz", oc_id: "ocZ", fecha: FECHA, numero_factura: "3430", monto: 900000, tipo_dte: 34 },
  );
  // Líneas vendidas (Mercado Público): exenta = monto total; afecta = neto (monto/1,19).
  d.oc_productos_link.push(
    { id: "lxv", oc_id: "ocX", descripcion: "Servicio de capacitación", url: "sin-link", orden: 0, origen: "venta", cantidad: 1, precio_venta: 1000000 },
    { id: "lzv", oc_id: "ocZ", descripcion: "Curso exento", url: "sin-link", orden: 0, origen: "venta", cantidad: 2, precio_venta: 900000 },
    { id: "l2v", oc_id: "oc2", descripcion: "Escritorio", url: "sin-link", orden: 0, origen: "venta", cantidad: 1, precio_venta: Math.round(1210000 / 1.19) },
  );
  return d;
}
const conHijos = (D, id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), eventos_factura: D.eventos_factura.filter((f) => f.oc_id === id), oc_productos_link: D.oc_productos_link.filter((l) => l.oc_id === id) });
// Cálculo ANTERIOR de la venta propia (calculos.js antes de este cambio), para comparar.
const pagoVentaPropiaAnterior = (o) => {
  const m = facturasVigentes(o).reduce((s, f) => s + (Number(f.monto) || 0), 0);
  return Math.max(0, Math.round((Number(o.monto_total) || 0) - (Number(o.costo_total) || 0) - (m - m / 1.19)));
};
const periodo = (() => { const x = new Date(FECHA + "T12:00:00"); return { anio: x.getFullYear(), mes: x.getMonth() + 1 }; })();
const pago = (ocs) => calcularPagoVendedor({ vendedorId: "v1", ocs, ...periodo, ivaMensual: [], pagosVendedor: [] });

// ═════ Unitarias: documentos y comisiones ═════
{
  const D = datos(); const O = (id) => conHijos(D, id);
  // Documentos
  ok("U01_iva_dte33_igual_al_historico", Math.abs(ivaDeDocumento({ tipo_dte: 33, monto: 1190000, monto_iva: 150000 }) - 190000) < 1e-6);
  ok("U02_iva_sin_tipo_igual_al_historico", Math.abs(ivaDeDocumento({ monto: 2380000 }) - 380000) < 1e-6);
  ok("U03_iva_dte34_sin_registro_es_0", ivaDeDocumento({ tipo_dte: 34, monto: 1000000 }) === 0 && ivaDeDocumento({ tipo_dte: 34, monto: 1000000, monto_iva: null }) === 0);
  ok("U04_iva_dte34_usa_el_registrado", ivaDeDocumento({ tipo_dte: 34, monto: 1000000, monto_iva: 12345 }) === 12345);
  ok("U05_tipo_venta", tipoVentaPorDocumentos(O("ocX")) === "exenta" && tipoVentaPorDocumentos(O("ocY")) === "afecta" && tipoVentaPorDocumentos(O("ocH")) === "afecta"
    && tipoVentaPorDocumentos(O("oc5")) === null && tipoVentaPorDocumentos(O("ocN")) === "exenta" && tipoVentaPorDocumentos(O("ocN3")) === "exenta");
  ok("U06_mixta", tipoVentaPorDocumentos({ eventos_factura: [{ numero_factura: "1", monto: 1, tipo_dte: 33 }, { numero_factura: "2", monto: 1, tipo_dte: 34 }] }) === "mixta");
  // Comisión venta propia
  const pX = pago([O("ocX")]), pXi = pago([O("ocXi")]), pY = pago([O("ocY")]), pH = pago([O("ocH")]);
  const lin = (r) => r?.detalle?.[0]?.pagoVentaPropia;
  ok("U07_venta_propia_dte34_sin_iva", lin(pX) === 300000, pX?.detalle);                     // 1.000.000 − 700.000 − 0
  ok("U08_venta_propia_dte34_iva_registrado", lin(pXi) === 400000 - 12345, pXi?.detalle);    // usa monto_iva del documento
  ok("U09_venta_propia_dte33_igual_que_antes", lin(pY) === pagoVentaPropiaAnterior(O("ocY")) && lin(pY) === 200000, pY?.detalle); // 1.190.000 − 800.000 − 190.000 (no usa monto_iva 150.000)
  ok("U10_venta_propia_historica_refacturada_igual", lin(pH) === pagoVentaPropiaAnterior(O("ocH")) && lin(pH) === 500000 && pH.detalle[0].factura === "501", pH?.detalle);
  // Todas las OCs del juego base (historial sin tipo) dan exactamente el mismo resultado con y sin la corrección.
  const todas = D.ordenes_compra_v2.map((o) => conHijos(D, o.id)).filter((o) => !["ocX", "ocXi", "ocN", "ocN3", "ocZ"].includes(o.id));
  const comoPropias = todas.map((o) => ({ ...o, es_venta_propia: true }));
  const difs = comoPropias.filter((o) => { const r = pago([o]); return r && lin(r) !== pagoVentaPropiaAnterior(o); }).map((o) => o.id);
  ok("U11_historial_sin_cambios_en_venta_propia", difs.length === 0, difs);
  // Comisión general (no venta propia): no depende del tipo de documento (utilidad − IVA del F29 del período).
  const g1 = pago([O("ocN")]), g0 = pago([{ ...O("ocN"), eventos_factura: O("ocN").eventos_factura.map((f) => ({ ...f, tipo_dte: f.tipo_dte === 34 ? 33 : f.tipo_dte, ref_tipo_dte: f.ref_tipo_dte === 34 ? 33 : f.ref_tipo_dte })) }]);
  ok("U12_comision_general_no_cambia", g1 && g0 && g1.sumaUtilidad === g0.sumaUtilidad && JSON.stringify({ ...g1, detalle: null }) === JSON.stringify({ ...g0, detalle: null }), { g1, g0 });
  // NC sobre DTE 34
  ok("U13_nc_codigo1_sobre_dte34_deja_vigente_la_nueva", facturasVigentes(O("ocN")).map((f) => f.numero_factura).join() === "3411" && facturaVisibleOC(O("ocN")).texto === "Factura exenta N.º 3411" && /1 anulada/.test(facturaVisibleOC(O("ocN")).extra));
  ok("U14_nc_codigo3_sobre_dte34_resta_monto", montoTributarioVigente(O("ocN3")) === 700000);
  // Rentabilidad: no depende del tipo de documento.
  const oX = O("ocX"), oX33 = { ...oX, eventos_factura: oX.eventos_factura.map((f) => ({ ...f, tipo_dte: 33 })) };
  ok("U15_rentabilidad_no_cambia", JSON.stringify(gananciaReal(oX)) === JSON.stringify(gananciaReal(oX33)) && gananciaReal(oX).pesos === 300000);
  // Venta por productos
  ok("U16_venta_por_productos_exenta", ventaDeOC(O("ocX")).base === "exento" && ventaDeOC(O("ocX")).confiable && ventaDeOC(O("oc2")).base === "neto");
  // Vista: afecta e historial igual que antes.
  ok("U17_vista_afecta_igual", facturaVisibleOC(O("oc2")).texto === "Factura N.º 702" && facturaVisibleOC(O("ocY")).texto === "Factura N.º 3301" && facturaVisibleOC(O("ocH")).texto === "Factura N.º 501");
  // Bloqueo de reemisión
  ok("U18_bloqueo_solo_con_dte34_vigente", !!bloqueoFacturaPorExenta(O("ocX")) && !!bloqueoFacturaPorExenta(O("ocN")) && bloqueoFacturaPorExenta(O("ocY")) === null && bloqueoFacturaPorExenta(O("oc3")) === null && bloqueoFacturaPorExenta(O("ocH")) === null);
  ok("U19_monto_mp_cero_no_basta", tipoVentaPorDocumentos({ monto_total: 1000000, mp_impuestos: 0, eventos_factura: [] }) === null && bloqueoFacturaPorExenta({ mp_impuestos: 0, eventos_factura: [] }) === null);
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const enModal = (p) => p.locator("[role=dialog]").last();
for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 1000);
  const busc = p.getByPlaceholder(/Buscar/i).first();
  const abrirOC = async (num) => {
    if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
    await busc.fill(num); await espera(p, 500);
    await p.locator(`[data-oc="${num}"] > div`).first().click(); await espera(p, 1400);
  };
  const seccion = async (t) => { await p.locator("[data-indice-ficha] button", { hasText: t }).first().click(); await espera(p, 500); };
  const txtFila = async (num, sel) => (await p.locator(`[data-oc="${num}"]`).locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  ok(`${pref}01_fila_factura_exenta`, /Factura exenta N\.º 3401/.test(await txtFila("7001-1-OC26", "[data-fila-factura]")));
  ok(`${pref}02_fila_afecta_igual`, /^Factura N\.º 702/.test(await txtFila("2002-102-SE26", "[data-fila-factura]")) && /^Factura N\.º 501/.test(await txtFila("7004-4-OC26", "[data-fila-factura]")));

  // Ficha exenta: Total vendido como exento, sin aviso de diferencia.
  await abrirOC("7001-1-OC26"); await seccion("Productos");
  const hoja = p.locator("[data-hoja-lateral]").last();
  const baseX = (await hoja.locator("[data-total-vendido-base]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  ok(`${pref}03_total_vendido_exento`, /exento \(sin IVA\)/.test(baseX) && !(await hoja.getByText(/la OC dice/).count()), baseX);
  // Emitir / re-emitir: bloqueado, sin escritura.
  const n0 = b.escr.length; await seccion("Facturación SII");
  await hoja.getByRole("button", { name: /Emitir \/ re-emitir factura/ }).first().click(); await espera(p, 500);
  let m = enModal(p);
  const bloqueo = await m.locator("[data-bloqueo-exenta]").count(), dis = await m.getByRole("button", { name: /Reemitir factura/ }).first().isDisabled();
  await m.getByPlaceholder("ej: 215").fill("9999").catch(() => {});
  await m.getByRole("button", { name: /Reemitir factura/ }).first().click({ force: true }).catch(() => {}); await espera(p, 800);
  ok(`${pref}04_reemitir_sobre_dte34_bloqueado`, bloqueo === 1 && dis && !b.escr.slice(n0).some((w) => w.tabla === "eventos_factura"), { bloqueo, dis, escr: b.escr.slice(n0) });
  await p.keyboard.press("Escape"); await espera(p, 400);

  // Ficha afecta: igual que antes («con IVA»).
  await abrirOC("2002-102-SE26"); await seccion("Productos");
  const base2 = (await p.locator("[data-hoja-lateral]").last().locator("[data-total-vendido-base]").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  ok(`${pref}05_total_vendido_afecta_igual`, /con IVA \$1\.210\.000/.test(base2), base2);

  // OC sin factura: se registra como siempre (DTE 33 implícito), con la nota de fase 2.
  await abrirOC("2003-103-SE26"); await seccion("Facturación SII");
  const n1 = b.escr.length;
  await p.locator("[data-hoja-lateral]").last().getByRole("button", { name: /^.*Emitir factura$/ }).first().click(); await espera(p, 500);
  m = enModal(p);
  const nota = await m.locator("[data-nota-dte33]").innerText().catch(() => "");
  ok(`${pref}06_nota_dte33_sin_bloqueo`, /DTE 33/.test(nota) && /Mercado Público no basta/.test(nota) && !(await m.locator("[data-bloqueo-exenta]").count()), nota);
  await m.getByPlaceholder("ej: 215").fill("8801");
  await m.getByRole("button", { name: /Registrar factura/ }).first().click(); await espera(p, 1800);
  const posts = b.escr.slice(n1).filter((w) => w.tabla === "eventos_factura" && w.metodo === "POST");
  const cuerpo = posts[0] && (Array.isArray(posts[0].cuerpo) ? posts[0].cuerpo[0] : posts[0].cuerpo);
  ok(`${pref}07_factura_afecta_se_registra_igual`, posts.length === 1 && cuerpo && !("tipo_dte" in cuerpo) && cuerpo.numero_factura === "8801" && Number(cuerpo.monto) === 1220000, cuerpo);
  if (await p.locator("[role=dialog]").count()) { await p.keyboard.press("Escape"); await espera(p, 300); }

  // Formulario de compra de una OC exenta: venta mostrada sin IVA (sin desglose neto + IVA).
  await abrirOC("7007-7-OC26"); await seccion("Compra y financiamiento");
  await p.locator("[data-hoja-lateral]").last().getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(p, 600);
  m = enModal(p);
  await m.getByRole("button", { name: /Siguiente/ }).first().click(); await espera(p, 300);
  const adj = (await m.locator("[data-venta-oc]").innerText().catch(() => "")).replace(/\s+/g, " ");
  await m.getByPlaceholder("ej: Silla ergonómica negra 3C").fill("Material curso");
  await m.locator("input[type=number]").nth(1).fill("500000"); await espera(p, 300);
  const desg = (await m.locator("[data-desglose-iva]").innerText().catch(() => "")).replace(/\s+/g, " ");
  ok(`${pref}08_compra_venta_exenta_sin_iva`, /exento, sin IVA/.test(adj) && /exentos \(sin IVA\)/.test(adj) && /Venta exenta \$900\.000: sin IVA/.test(desg) && !/neto/.test(desg), { adj, desg });
  await p.keyboard.press("Escape"); await espera(p, 400);

  ok(`${pref}09_sin_escrituras_de_finanzas`, !b.escr.some((w) => ["iva_mensual", "pagos_vendedor", "eventos_pago_financiamiento", "financiadores", "fifo", "asignaciones_fifo"].includes(w.tabla)));
  ok(`${pref}10_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
