// Vista general de Compras: dirección de entrega y factura vigente en cada fila (19/10/2026). Solo lectura.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_vista_compras.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { direccionEntregaOC, facturaVisibleOC } from "../../src/lib/vistaCompras.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const LARGA = "Avenida Libertador Bernardo O'Higgins 1234, Departamento de Administración y Finanzas, Bodega Central Edificio Consistorial Piso 3, Oficina de Partes, recepción de lunes a viernes de 08:30 a 13:30 horas";

function datos() {
  const d = crearDatos();
  const o = (id) => d.ordenes_compra_v2.find((x) => x.id === id);
  o("oc2").direccion_entrega = "Av. Siempre Viva 742";                       // con dirección y factura 702
  o("oc4").direccion_entrega = LARGA;                                       // dirección larga + factura 704
  o("oc5").direccion_entrega = "";                                          // sin dirección ni factura
  const base = d.ordenes_compra_v2[0];
  d.ordenes_compra_v2.push({ ...base, id: "ocR", numero_oc: "6001-1-AG26", cliente: "CLIENTE REFACTURADA", direccion_entrega: null, estado_entrega: "confirmada", estado_factura_propia: "emitida", monto_facturado: 1190000 },
    { ...base, id: "ocA", numero_oc: "6002-2-AG26", cliente: "CLIENTE ANULADA", direccion_entrega: null, estado_factura_propia: "pendiente", monto_facturado: 0 },
    { ...base, id: "ocL", numero_oc: "6003-3-AG26", cliente: "CLIENTE LINEAS", direccion_entrega: "", estado_factura_propia: "pendiente" });
  // Refacturación: 800 anulada por NC (código 1) y reemplazada por 801 (vigente).
  d.eventos_factura.push({ id: "f800", oc_id: "ocR", fecha: dias(20), numero_factura: "800", monto: 1190000, tipo_dte: 33 },
    { id: "nc55", oc_id: "ocR", fecha: dias(18), numero_factura: "55", monto: 1190000, tipo_dte: 61, ref_tipo_dte: 33, ref_folio: "800", ref_codigo: 1, ref_motivo: "Anula" },
    { id: "f801", oc_id: "ocR", fecha: dias(17), numero_factura: "801", monto: 1190000, tipo_dte: 33 },
    // Solo anulada: 900 con NC 60 (código 1), sin factura vigente.
    { id: "f900", oc_id: "ocA", fecha: dias(10), numero_factura: "900", monto: 500000, tipo_dte: 33 },
    { id: "nc60", oc_id: "ocA", fecha: dias(9), numero_factura: "60", monto: 500000, tipo_dte: 61, ref_tipo_dte: 33, ref_folio: "900", ref_codigo: 1, ref_motivo: "Anula" });
  // Dirección solo en las líneas de compra (registradas en BFK).
  d.oc_productos_link.push({ id: "lL1", oc_id: "ocL", descripcion: "Silla", url: "sin-link", orden: 0, origen: "compra", cantidad: 1, precio_compra: 1000, direccion_entrega: "Bodega Norte 55" });
  return d;
}

// ═════ Unitarias ═════
{
  const D = datos(); const O = (id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), eventos_factura: D.eventos_factura.filter((f) => f.oc_id === id), oc_productos_link: D.oc_productos_link.filter((l) => l.oc_id === id) });
  ok("U1_direccion_y_factura", direccionEntregaOC(O("oc2")).texto === "Av. Siempre Viva 742, LAJA" && facturaVisibleOC(O("oc2")).texto === "Factura N.º 702");
  ok("U2_sin_direccion_sin_factura", direccionEntregaOC(O("oc5")).texto === "Dirección no registrada" && facturaVisibleOC(O("oc5")).texto === "Sin factura");
  ok("U3_refacturacion_muestra_vigente", facturaVisibleOC(O("ocR")).texto === "Factura N.º 801" && /1 anulada/.test(facturaVisibleOC(O("ocR")).extra));
  ok("U4_solo_anulada", facturaVisibleOC(O("ocA")).estado === "anulada" && /900 anulada/.test(facturaVisibleOC(O("ocA")).texto));
  ok("U5_direccion_desde_lineas", direccionEntregaOC(O("ocL")).texto === "Bodega Norte 55, LAJA" && direccionEntregaOC(O("ocL")).fuente === "productos");
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const chip = (p, t) => p.locator("button", { hasText: new RegExp(`^${t}( \\d+)?$`) }).first();
const visibles = async (p) => (await p.locator("[data-oc]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-oc")))]));
for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const ancho = movil ? 390 : 1440;
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto: movil ? 844 : 900, movil, espera: 2500 });
  const n0 = b.escr.filter((w) => w.metodo !== "RPC").length;
  await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 1000);
  const fila = (num) => p.locator(`[data-oc="${num}"]`);
  const txt = async (num, sel) => (await fila(num).locator(sel).first().innerText()).replace(/\s+/g, " ").trim();
  ok(`${pref}01_con_direccion_y_factura`, /Av\. Siempre Viva 742, LAJA/.test(await txt("2002-102-SE26", "[data-fila-direccion]")) && /Factura N\.º 702/.test(await txt("2002-102-SE26", "[data-fila-factura]")));
  ok(`${pref}02_sin_direccion`, /Dirección no registrada/.test(await txt("2005-105-SE26", "[data-fila-direccion]")));
  ok(`${pref}03_sin_factura`, /Sin factura/.test(await txt("2005-105-SE26", "[data-fila-factura]")));
  ok(`${pref}04_refacturacion_y_nota_credito`, /Factura N\.º 801/.test(await txt("6001-1-AG26", "[data-fila-factura]")) && /1 anulada/.test(await txt("6001-1-AG26", "[data-fila-factura]"))
    && /900 anulada/.test(await txt("6002-2-AG26", "[data-fila-factura]")) && !/Factura N\.º 800\b(?! anulada)/.test(await txt("6001-1-AG26", "[data-fila-factura]")));
  ok(`${pref}04b_direccion_desde_lineas_de_compra`, /Bodega Norte 55/.test(await txt("6003-3-AG26", "[data-fila-direccion]")));
  // Dirección larga: una sola línea recortada, sin desbordar la tarjeta ni la pantalla.
  const m = await fila("2004-104-SE26").locator("[data-fila-direccion]").first().evaluate((el) => {
    const r = el.getBoundingClientRect(), card = el.closest("[data-oc]").getBoundingClientRect();
    return { alto: r.height, derecha: r.right, cardDerecha: card.right, recortada: el.scrollWidth > el.clientWidth, completa: el.getAttribute("title") };
  });
  const scrollX = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(`${pref}05_direccion_larga_compacta`, m.alto < 24 && m.derecha <= m.cardDerecha + 1 && m.recortada && m.completa.includes("Oficina de Partes") && scrollX <= 0, { m, scrollX });
  // Se mantienen OC, cliente, monto y estado en la fila.
  const t2 = await fila("2002-102-SE26").innerText();
  ok(`${pref}06_conserva_datos_principales`, /2002-102-SE26/.test(t2) && /MUNICIPALIDAD FICTICIA 2/.test(t2) && /\$/.test(t2));
  // Búsqueda y filtros siguen igual.
  const busc = p.getByPlaceholder(/Buscar/i).first();
  await busc.fill("801"); await espera(p, 500);
  const v801 = await visibles(p);
  await busc.fill("800"); await espera(p, 500);
  const v800 = await visibles(p);
  await busc.fill(""); await espera(p, 400);
  ok(`${pref}07_busqueda_por_factura_igual_que_antes`, v801.length === 1 && v801[0] === "6001-1-AG26" && v800.includes("6001-1-AG26"), { v801, v800 });
  await chip(p, "Por facturar").click(); await espera(p, 500);
  const vf = await visibles(p);
  await chip(p, "Todas").click(); await espera(p, 400);
  ok(`${pref}08_filtros_siguen_funcionando`, vf.length > 0 && vf.every((n) => n !== "2002-102-SE26") && (await chip(p, "Financiamiento pendiente").count()) === 1 && (await chip(p, "Vale vista pendiente").count()) === 1, vf);
  ok(`${pref}09_solo_lectura_sin_escrituras`, b.escr.filter((w) => w.metodo !== "RPC" && !["mp_cache_avisos", "mp_uso_diario", "ordenes_compra_v2", "oc_productos_link"].includes(w.tabla)).length === 0
    && !b.escr.slice(n0).some((w) => ["eventos_factura", "eventos_compra", "eventos_pago_financiamiento", "eventos_pago_cliente", "financiadores"].includes(w.tabla)));
  if (process.env.CAPTURA) await p.screenshot({ path: `${process.env.CAPTURA}/vista-${pref}.png` });
  ok(`${pref}10_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
