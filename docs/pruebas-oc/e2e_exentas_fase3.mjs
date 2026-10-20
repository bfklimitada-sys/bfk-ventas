// Fase 3 de ventas exentas (20/10/2026): facturación DTE 34 en OC exentas aprobadas, cotización exenta en pantalla,
// rentabilidad y comisiones. Datos y documentos FICTICIOS; base simulada; no toca Supabase.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_exentas_fase3.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";
import { calcularCotizacion } from "../../src/lib/cotizaciones.js";
import { calcularPagoVendedor, gananciaReal, facturasVigentes } from "../../src/lib/calculos.js";
import { validarRegistroFactura, tipoFacturaDeOC, camposFacturaExenta, ventaExenta, bloqueoFacturaPorExenta, montoTributarioVigente, ivaDeDocumento } from "../../src/lib/tributario.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const TRIB = ["tratamiento_iva", "fundamento_iva", "respaldo_iva", "tratamiento_aprobado_por", "tratamiento_aprobado_en", "clasificacion_id"];
const EXENTA = { tratamiento_iva: "exenta_fora", fundamento_iva: "Art. 101 de la Ley N.º 18.948 (FO.R.A.)", respaldo_iva: "Certificado DGS ficticio · Oficio 1", tratamiento_aprobado_por: "u1", tratamiento_aprobado_en: "2026-10-20T05:00:00Z" };

function datos() {
  const d = crearDatos();
  const o = (id) => d.ordenes_compra_v2.find((x) => x.id === id);
  Object.assign(o("oc3"), EXENTA, { clasificacion_id: "tc-oc3", monto_total: 2704000, costo_total: 2080000 });   // exenta aprobada, entregada, sin factura
  Object.assign(o("oc9"), EXENTA, { clasificacion_id: "tc-oc9" });                                                // exenta aprobada (sincronización MP)
  d.eventos_compra.find((e) => e.oc_id === "oc3").costo_compra = 2080000;
  d.trib_clasificaciones = [
    { id: "tc-oc3", ambito: "oc", oc_id: "oc3", codigo: "2003-103-SE26", tratamiento: "exenta_fora", fundamento_legal: EXENTA.fundamento_iva, respaldo_descripcion: "Certificado DGS ficticio", respaldo_documento: "Oficio 1", estado: "aprobada", solicitado_por: "u1", solicitado_por_nombre: "Admin Prueba", solicitado_en: "2026-10-20T04:00:00Z", resuelto_por: "u1", resuelto_por_nombre: "Admin Prueba", resuelto_en: "2026-10-20T05:00:00Z" },
    { id: "tc-oc9", ambito: "oc", oc_id: "oc9", codigo: "2009-109-SE26", tratamiento: "exenta_fora", fundamento_legal: EXENTA.fundamento_iva, respaldo_descripcion: "Certificado DGS ficticio", respaldo_documento: "Oficio 2", estado: "aprobada", solicitado_por: "u1", solicitado_en: "2026-10-20T04:00:00Z", resuelto_por: "u1", resuelto_en: "2026-10-20T05:00:00Z" },
    { id: "tc-cz1", ambito: "cotizacion", cotizacion_id: "c-ex", codigo: "3160-69-COT26", tratamiento: "exenta_fora", fundamento_legal: EXENTA.fundamento_iva, respaldo_descripcion: "Certificado DGS ficticio", respaldo_documento: "Oficio 3", estado: "aprobada", solicitado_por: "u1", solicitado_en: "2026-10-20T04:00:00Z", resuelto_por: "u1", resuelto_en: "2026-10-20T05:00:00Z" },
  ];
  return d;
}
const conHijos = (D, id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), eventos_factura: D.eventos_factura.filter((f) => f.oc_id === id) });

// ═════ Unitarias: facturación, NC, rentabilidad y comisiones ═════
{
  const D = datos(); const ex = conHijos(D, "oc3"), af = conHijos(D, "oc11"), hist = conHijos(D, "oc4");
  ok("U01_tipo_por_clasificacion", tipoFacturaDeOC(ex) === 34 && tipoFacturaDeOC(af) === 33 && tipoFacturaDeOC(hist) === 33 && tipoFacturaDeOC({ tratamiento_iva: "exenta_fora" }) === 33);
  ok("U02_dte34_en_oc_afecta_bloqueado", /no tiene una clasificación exenta aprobada/.test(validarRegistroFactura(af, { tipoDte: 34, numero: "1", fecha: "2026-10-20", monto: 1, confirmaEmitida: true })));
  ok("U03_dte33_en_oc_exenta_bloqueado", /solo admite factura exenta/.test(validarRegistroFactura(ex, { tipoDte: 33, numero: "1", fecha: "2026-10-20", monto: 1 })));
  ok("U04_dte34_exige_numero_fecha_y_confirmacion", /número/.test(validarRegistroFactura(ex, { tipoDte: 34, numero: "", fecha: "2026-10-20", monto: 1, confirmaEmitida: true }))
    && /fecha/.test(validarRegistroFactura(ex, { tipoDte: 34, numero: "9", fecha: "", monto: 1, confirmaEmitida: true }))
    && /emitida en el SII/.test(validarRegistroFactura(ex, { tipoDte: 34, numero: "9", fecha: "2026-10-20", monto: 1, confirmaEmitida: false }))
    && validarRegistroFactura(ex, { tipoDte: 34, numero: "9", fecha: "2026-10-20", monto: 2704000, confirmaEmitida: true }) === null);
  ok("U05_dte33_afecta_igual_que_antes", validarRegistroFactura(af, { numero: "9", monto: 1 }) === null && validarRegistroFactura(af, { numero: "", monto: 1 }) === "Indica el número de factura");
  const c = camposFacturaExenta(ex, 2704000);
  ok("U06_campos_dte34", c.tipo_dte === 34 && c.monto_exento === 2704000 && c.monto_iva === 0 && /18\.948/.test(c.notas) && /tc-oc3/.test(c.notas));
  ok("U07_exenta_con_afecta_vigente_bloqueada", /factura afecta vigente/.test(bloqueoFacturaPorExenta({ ...ex, eventos_factura: [{ id: "x", numero_factura: "700", monto: 1, tipo_dte: 33 }] })));
  // NC y refacturación de DTE 34.
  const f1 = { id: "f1", oc_id: "oc3", fecha: dias(10), numero_factura: "3401", monto: 2704000, ...camposFacturaExenta(ex, 2704000) };
  const nc = { id: "n1", oc_id: "oc3", fecha: dias(9), numero_factura: "61", monto: 2704000, tipo_dte: 61, ref_tipo_dte: 34, ref_folio: "3401", ref_codigo: 1, ref_motivo: "Anula" };
  const f2 = { id: "f2", oc_id: "oc3", fecha: dias(8), numero_factura: "3402", monto: 2600000, ...camposFacturaExenta(ex, 2600000) };
  const n3 = { id: "n3", oc_id: "oc3", fecha: dias(7), numero_factura: "62", monto: 100000, tipo_dte: 61, ref_tipo_dte: 34, ref_folio: "3402", ref_codigo: 3, ref_motivo: "Descuento" };
  const exNc = { ...ex, eventos_factura: [f1, nc, f2, n3] };
  ok("U08_nc_y_refacturacion_dte34", facturasVigentes(exNc).map((f) => f.numero_factura).join() === "3402" && montoTributarioVigente(exNc) === 2500000 && validarRegistroFactura(exNc, { tipoDte: 34, numero: "3403", fecha: "2026-10-20", monto: 1, confirmaEmitida: true }) === null);
  // Rentabilidad: venta exenta − costo real con IVA (sin descontar dos veces el IVA).
  ok("U09_utilidad_exenta_positiva", gananciaReal(ex).pesos === 624000);
  ok("U10_utilidad_exenta_negativa_sin_ajuste", gananciaReal({ ...ex, monto_total: 2000000 }).pesos === -80000);
  ok("U11_ventaExenta_historial_y_clasificacion", ventaExenta(ex) && !ventaExenta(af) && !ventaExenta(hist));
  // Comisiones: DTE 34 sin IVA ficticio; general sin cambio.
  const p = (() => { const x = new Date(f2.fecha + "T12:00:00"); return { anio: x.getFullYear(), mes: x.getMonth() + 1 }; })();
  const pago = (ocs) => calcularPagoVendedor({ vendedorId: "v1", ocs, ...p, ivaMensual: [], pagosVendedor: [] });
  const vp = { ...exNc, estado_factura_propia: "emitida", es_venta_propia: true };
  ok("U12_venta_propia_exenta_sin_iva_ficticio", ivaDeDocumento(f2) === 0 && pago([vp])?.detalle?.[0]?.pagoVentaPropia === 624000, pago([vp])?.detalle);
  const gen = { ...exNc, estado_factura_propia: "emitida", es_venta_propia: false };
  const gen33 = { ...gen, eventos_factura: gen.eventos_factura.map((f) => ({ ...f, tipo_dte: f.tipo_dte === 34 ? 33 : f.tipo_dte, ref_tipo_dte: f.ref_tipo_dte === 34 ? 33 : f.ref_tipo_dte, monto_exento: undefined, monto_iva: undefined })) };
  ok("U13_comision_general_sin_cambio", JSON.stringify({ ...pago([gen]), detalle: null }) === JSON.stringify({ ...pago([gen33]), detalle: null }));
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [pref, movil] of [["E", false], ["M", true]]) {
  const ancho = movil ? 390 : 1440, alto = movil ? 844 : 900;
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 900);
  const abrirOC = async (num, seccion) => {
    if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
    await p.getByPlaceholder(/Buscar/i).first().fill(num); await espera(p, 500);
    await p.locator(`[data-oc="${num}"] > div`).first().click(); await espera(p, 1400);
    if (seccion) { await p.locator("[data-indice-ficha] button", { hasText: seccion }).first().click(); await espera(p, 500); }
  };
  const hoja = () => p.locator("[data-hoja-lateral]").last();
  // ── OC exenta aprobada: DTE 34 ──
  await abrirOC("2003-103-SE26", "Facturación SII");
  await hoja().getByRole("button", { name: /Emitir factura$/ }).first().click(); await espera(p, 500);
  let m = p.locator("[role=dialog]").last();
  ok(`${pref}01_formulario_dte34`, /Factura exenta \(DTE 34\) · IVA de venta \$0/.test(await m.locator("[data-factura-exenta]").innerText().catch(() => "")) && !(await m.locator("[data-nota-dte33]").count()) && !(await m.locator("[data-bloqueo-exenta]").count()));
  await m.getByPlaceholder("ej: 215").fill("3401");
  const n0 = b.escr.length;
  await m.getByRole("button", { name: /Registrar factura exenta/ }).click(); await espera(p, 600);
  ok(`${pref}02_exige_confirmar_emision_sii`, /emitida en el SII/.test(await m.innerText()) && !b.escr.slice(n0).some((w) => w.tabla === "eventos_factura"));
  await m.locator("[data-confirma-emitida]").check();
  await m.getByRole("button", { name: /Registrar factura exenta/ }).click(); await espera(p, 1800);
  const post = b.escr.slice(n0).filter((w) => w.tabla === "eventos_factura" && w.metodo === "POST").map((w) => (Array.isArray(w.cuerpo) ? w.cuerpo[0] : w.cuerpo));
  ok(`${pref}03_dte34_registrada`, post.length === 1 && post[0].tipo_dte === 34 && Number(post[0].monto_exento) === 2704000 && post[0].monto_iva === 0 && post[0].numero_factura === "3401" && /18\.948/.test(post[0].notas) && /tc-oc3/.test(post[0].notas), post);
  if (await p.locator("[role=dialog]").count()) { await p.keyboard.press("Escape"); await espera(p, 300); }
  await abrirOC("2003-103-SE26", "Facturación SII");
  const fila = (await p.locator(`[data-oc="2003-103-SE26"] [data-fila-factura]`).first().innerText().catch(() => "")).replace(/\s+/g, " ");
  ok(`${pref}04_vista_factura_exenta`, /Factura exenta N\.º 3401/.test(fila) || /Factura exenta N\.º 3401/.test(await hoja().innerText()), fila);
  // Reemisión: la NC anula la 3401 y la nueva también es DTE 34.
  await hoja().getByRole("button", { name: /Emitir \/ re-emitir factura/ }).first().click(); await espera(p, 500);
  m = p.locator("[role=dialog]").last();
  await m.getByPlaceholder("ej: 215").fill("3402"); await m.getByPlaceholder("ej: 123").fill("61"); await m.locator("[data-confirma-emitida]").check();
  const n1 = b.escr.length;
  await m.getByRole("button", { name: /Reemitir factura exenta/ }).click(); await espera(p, 1800);
  const post2 = b.escr.slice(n1).filter((w) => w.tabla === "eventos_factura" && w.metodo === "POST").map((w) => (Array.isArray(w.cuerpo) ? w.cuerpo[0] : w.cuerpo));
  const oc3 = { ...b.db.ordenes_compra_v2.find((o) => o.id === "oc3"), eventos_factura: b.db.eventos_factura.filter((f) => f.oc_id === "oc3") };
  ok(`${pref}05_refacturacion_dte34`, post2.length === 1 && post2[0].tipo_dte === 34 && post2[0].factura_anulada_numero === "3401" && facturasVigentes(oc3).map((f) => f.numero_factura).join() === "3402", { post2, vig: facturasVigentes(oc3).map((f) => f.numero_factura) });
  if (await p.locator("[role=dialog]").count()) { await p.keyboard.press("Escape"); await espera(p, 300); }
  // ── OC afecta: DTE 33 exactamente como antes ──
  await abrirOC("2011-111-SE26", "Facturación SII");
  await hoja().getByRole("button", { name: /Emitir factura$/ }).first().click(); await espera(p, 500);
  m = p.locator("[role=dialog]").last();
  ok(`${pref}06_formulario_dte33`, (await m.locator("[data-nota-dte33]").count()) === 1 && !(await m.locator("[data-factura-exenta]").count()) && !(await m.locator("[data-confirma-emitida]").count()));
  await m.getByPlaceholder("ej: 215").fill("8811");
  const n2 = b.escr.length;
  await m.getByRole("button", { name: /^✓ Registrar factura$/ }).click(); await espera(p, 1800);
  const post3 = b.escr.slice(n2).filter((w) => w.tabla === "eventos_factura" && w.metodo === "POST").map((w) => (Array.isArray(w.cuerpo) ? w.cuerpo[0] : w.cuerpo));
  ok(`${pref}07_dte33_fila_identica`, post3.length === 1 && JSON.stringify(Object.keys(post3[0]).sort()) === JSON.stringify(["creado_por", "factura_anulada_numero", "fecha", "id", "monto", "motivo_diferencia", "nota_credito", "numero_factura", "oc_id"]), post3);
  if (await p.locator("[role=dialog]").count()) { await p.keyboard.press("Escape"); await espera(p, 300); }
  // ── Sincronización con Mercado Público: la clasificación aprobada no viaja en ningún cambio ──
  await abrirOC("2009-109-SE26");
  const btn = hoja().getByRole("button", { name: /Actualizar fecha y datos desde Mercado Público/ });
  if (await btn.count()) { await btn.last().scrollIntoViewIfNeeded(); await btn.last().click(); await espera(p, 2500); }
  const pat = b.escr.filter((w) => w.tabla === "ordenes_compra_v2" && w.metodo === "PATCH");
  ok(`${pref}08_sincronizacion_no_toca_clasificacion`, pat.length > 0 && !pat.some((w) => TRIB.some((k) => k in (w.cuerpo || {}))) && b.db.ordenes_compra_v2.find((o) => o.id === "oc9").tratamiento_iva === "exenta_fora", pat.map((w) => Object.keys(w.cuerpo || {})));
  ok(`${pref}09_sin_escrituras_financieras`, !b.escr.some((w) => ["iva_mensual", "pagos_vendedor", "financiadores", "eventos_pago_financiamiento", "eventos_compra"].includes(w.tabla)));
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }

  // ── Cotizaciones: exenta aprobada y afecta ──
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route));
  const env = { key: "e1", proveedor: "Prov", monto: 80000, con_factura: true, estado: "confirmado", destino: "Prat 620, Valparaíso", evidencia: "Simulación" };
  const it = (key, q, precio) => ({ key, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, ficha: { nombre: "Producto " + key, marca: "M", modelo: "X" } });
  const cz = (id, codigo, extra) => ({ id, version: 1, id_externo: codigo, nombre: "Cotización " + codigo, institucion: "Armada de Chile", rut: "61.102.000-0", direccion_entrega: "Prat 620", comuna: "Valparaíso", estado: "borrador", fecha: "2026-10-20", plazo: "10 DIAS", recargo: 0.3, actualizado_en: "2026-10-20", envios: [env], items: [it("a", 1, 2000000)], ...extra });
  M.cots.set("c-ex", cz("c-ex", "3160-69-COT26", { tratamiento_iva: "exenta_fora", clasificacion_id: "tc-cz1" }));
  M.cots.set("c-af", cz("c-af", "3161-70-COT26", {}));
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p, 400); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
  const H = () => p.locator('[data-hoja-lateral="cotizacion"]');
  const valor = async (dato) => Number(((await H().locator(`[data-fila="${dato}"] > *`).last().innerText().catch(() => "")) || "").replace(/[^\d-]/g, ""));
  const leerCz = async (codigo) => {
    await p.locator(`[data-cotizacion="${codigo}"]`).click(); await espera(p, 1500);
    await H().locator('[role="tab"][data-tab="precios"]').click(); await espera(p, 500);
    const t = await H().innerText();
    const r = { t, unit: Number((await H().locator('[data-unitario="1"]').innerText()).replace(/[^\d-]/g, "")), neto: await valor("neto"), total: await valor("total"), iva: await valor("iva-venta"), gan: await valor("utilidad") };
    await p.keyboard.press("Escape"); await espera(p, 600); return r;
  };
  const ex = await leerCz("3160-69-COT26");
  ok(`${pref}10_cotizacion_exenta_en_pantalla`, ex.unit === 2704000 && ex.neto === 2704000 && ex.total === 2704000 && ex.iva === 0 && ex.gan === 624000 && /Total exento/.test(ex.t) && /IVA de venta/.test(ex.t) && /VALOR UNITARIO EXENTO/.test(ex.t) && !/Total con IVA \(19%\)/.test(ex.t), { ...ex, t: ex.t.slice(0, 300) });
  const af = await leerCz("3161-70-COT26");
  const esp = calcularCotizacion(cz("c-af", "x", {}));
  ok(`${pref}11_cotizacion_afecta_igual`, af.unit === esp.lineas[0].unitario_neto && af.neto === esp.totales.neto && af.total === esp.totales.total && af.unit === 2272269 && /Total con IVA \(19%\)/.test(af.t) && !/Total exento/.test(af.t), af);
  ok(`${pref}12_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
