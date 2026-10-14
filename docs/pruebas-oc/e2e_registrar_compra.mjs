// «Registrar compra» en OCs existentes (14/10/2026): no se pide ni se modifica el precio de venta (viene de
// Mercado Público); la compra se guarda como productos «compra» sin duplicar lo vendido. La OC manual nueva
// conserva el ingreso de precios de venta. Supabase simulado. Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_registrar_compra.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { ventaDeOC } from "../../src/lib/productosOC.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);

// Datos: tres OCs de Mercado Público SIN compra registrada.
//  · 2005-105-SE26: dos productos vendidos con desglose confiable (suma neta = monto/1,19).
//  · 2015-115-SE26: un producto vendido con desglose confiable.
//  · 2025-125-SE26: solo una línea antigua de texto (sin desglose confiable).
function datos() {
  const d = crearDatos();
  const o5 = d.ordenes_compra_v2.find((o) => o.id === "oc5"); o5.monto_total = 2380000;
  const nueva = (id, numero, monto) => ({ ...o5, id, numero_oc: numero, monto_total: monto, cliente: "CLIENTE " + numero, rut_cliente: "" });
  d.ordenes_compra_v2.push(nueva("oc15", "2015-115-SE26", 595000), nueva("oc25", "2025-125-SE26", 1428000));
  d.oc_productos_link.push(
    { id: "v5a", oc_id: "oc5", descripcion: "Monitor 24 pulgadas", cantidad: 2, precio_venta: 1200000, origen: "venta", orden: 0, url: "sin-link" },
    { id: "v5b", oc_id: "oc5", descripcion: "Teclado inalámbrico", cantidad: 4, precio_venta: 800000, origen: "venta", orden: 1, url: "sin-link" },
    { id: "v15", oc_id: "oc15", descripcion: "Silla ergonómica", cantidad: 1, precio_venta: 500000, origen: "venta", orden: 0, url: "sin-link" },
    { id: "v25", oc_id: "oc25", descripcion: "Escritorio × 2 | Venta: $1.428.000", cantidad: null, origen: null, orden: 0, url: "sin-link" });
  return d;
}

// ── Unitarias ──
{
  const d = datos(); const con = (id) => ({ ...d.ordenes_compra_v2.find((o) => o.id === id), oc_productos_link: d.oc_productos_link.filter((l) => l.oc_id === id) });
  const v5 = ventaDeOC(con("oc5")), v25 = ventaDeOC(con("oc25"));
  ok("U1_desglose_confiable_varios_productos", v5.confiable && v5.base === "neto" && v5.lineas.length === 2 && v5.lineas[0].unitario === 600000 && v5.lineas[1].unitario === 200000);
  ok("U2_sin_desglose_no_inventa_unitarios", !v25.confiable && v25.lineas.every((l) => l.total === null && l.unitario === null) && v25.total === 1428000);
  ok("U3_ignora_lineas_de_compra", ventaDeOC({ monto_total: 1190000, oc_productos_link: [{ origen: "compra", descripcion: "x", precio_compra: 5, precio_venta: 1000000 }] }).lineas.length === 0);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const abrirOC = async (p, numero) => {
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
};
const modal = (p) => p.locator('[role="dialog"]').last();
const siguiente = async (p) => { await modal(p).getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 350); };
async function registrar(p, numero, productos) {
  await abrirOC(p, numero);
  await p.getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(p);
  await siguiente(p);
  const m = modal(p);
  const t2 = await m.innerText();
  for (let i = 0; i < productos.length; i++) {
    if (i > 0) { await m.getByRole("button", { name: /Agregar otro producto/ }).click(); await espera(p, 200); }
    const cards = m.locator("div").filter({ hasText: new RegExp(`^Producto ${i + 1}`) });
    const inputs = m.locator('input:not([type="hidden"])');
    const base = i * 4; // descripción, link, cantidad, precio compra
    await inputs.nth(base).fill(productos[i].desc); await inputs.nth(base + 1).fill(productos[i].link || "");
    await inputs.nth(base + 2).fill(String(productos[i].cant)); await inputs.nth(base + 3).fill(String(productos[i].compra));
  }
  const resumen2 = await m.locator("[data-resumen-paso2]").innerText().catch(() => "");
  await siguiente(p); // paso 3
  const err3 = await m.innerText();
  await siguiente(p); // paso 4
  const t4 = await m.innerText();
  return { t2, resumen2, err3, t4, m };
}
const escr = (b, n, tabla) => b.escr.slice(n).filter((w) => w.tabla === tabla);

// ═════ A. OC con varios productos (desglose confiable) ═════
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2500 });
  const n0 = b.escr.length; const linksAntes = b.db.oc_productos_link.filter((l) => l.oc_id === "oc5").map((l) => JSON.stringify(l));
  const r = await registrar(p, "2005-105-SE26", [{ desc: "Monitor LG 24MK430", link: "https://tienda.cl/monitor", cant: 2, compra: 450000 }, { desc: "Teclado Logitech K270", link: "", cant: 4, compra: 90000 }]);
  ok("A01_no_pide_precio_de_venta", !/P\. Venta unit/i.test(r.t2) && /Producto adquirido/i.test(r.t2));
  ok("A02_muestra_venta_por_producto_desde_mp", /Monitor 24 pulgadas × 2/.test(r.t2) && /unit\. \$600\.000/.test(r.t2) && /Teclado inalámbrico × 4/.test(r.t2) && /unit\. \$200\.000/.test(r.t2) && /\$2\.380\.000/.test(r.t2), r.t2.slice(0, 600));
  ok("A03_sin_validacion_de_precio_de_venta", !/deben tener precio de venta/.test(r.err3) && /Financiador/.test(r.err3));
  // Utilidad = venta real de la OC (2.380.000) − costo (2×450.000 + 4×90.000 = 1.260.000) = 1.120.000.
  ok("A04_utilidad_con_monto_real_y_costo", /\$1\.260\.000/.test(r.resumen2) && /\$2\.380\.000/.test(r.resumen2) && /\$1\.120\.000/.test(r.resumen2), r.resumen2);
  ok("A05_resumen_sin_venta_inventada", /Monitor LG 24MK430 × 2/.test(r.t4) && !/Venta: \$0/.test(r.t4) && /\$1\.120\.000/.test(r.t4));
  await r.m.getByRole("button", { name: /Registrar compra/ }).click(); await espera(p, 1800);
  const ins = escr(b, n0, "oc_productos_link");
  ok("A06_compra_guardada_como_productos_compra", ins.length === 2 && ins.every((w) => w.cuerpo.origen === "compra" && w.cuerpo.precio_venta === null && !/Venta:/.test(w.cuerpo.descripcion)) && ins[0].cuerpo.precio_compra === 900000 && ins[0].cuerpo.cantidad === 2 && ins[1].cuerpo.precio_compra === 360000, ins.map((w) => w.cuerpo));
  ok("A07_no_duplica_ni_toca_lo_vendido", JSON.stringify(b.db.oc_productos_link.filter((l) => l.oc_id === "oc5" && l.origen !== "compra").map((l) => JSON.stringify(l))) === JSON.stringify(linksAntes) && b.escr.slice(n0).filter((w) => w.tabla === "oc_productos_link" && w.metodo !== "POST").length === 0);
  const oc5 = b.db.ordenes_compra_v2.find((o) => o.id === "oc5");
  const rpc = b.escr.slice(n0).filter((w) => w.tabla === "registrar_compra_oc" || /registrar_compra/.test(w.tabla || ""));
  ok("A08_monto_adjudicado_intacto_y_compra_registrada", oc5.monto_total === 2380000 && b.escr.slice(n0).filter((w) => w.tabla === "ordenes_compra_v2" && w.cuerpo && "monto_total" in w.cuerpo).length === 0 && (rpc.length === 1 || oc5.estado_compra === "comprado"), { monto: oc5.monto_total, rpc: rpc.map((w) => w.cuerpo) });
  ok("A09_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ B. OC con un producto; C. OC sin desglose confiable (teléfono) ═════
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2500 });
  const n0 = b.escr.length;
  const r = await registrar(p, "2015-115-SE26", [{ desc: "Silla Rhino", link: "https://tienda.cl/silla", cant: 1, compra: 320000 }]);
  ok("B01_un_producto_venta_desde_mp", /Silla ergonómica × 1/.test(r.t2) && /unit\. \$500\.000/.test(r.t2) && !/P\. Venta unit/i.test(r.t2));
  ok("B02_utilidad_un_producto", /\$275\.000/.test(r.resumen2), r.resumen2); // 595.000 − 320.000
  await r.m.getByRole("button", { name: /Registrar compra/ }).click(); await espera(p, 1800);
  const ins = escr(b, n0, "oc_productos_link");
  ok("B03_un_producto_compra_sin_duplicar", ins.length === 1 && ins[0].cuerpo.origen === "compra" && ins[0].cuerpo.precio_compra === 320000 && b.db.oc_productos_link.filter((l) => l.oc_id === "oc15" && (l.origen || "venta") === "venta").length === 1);
  ok("B04_sin_errores", !errs.length, errs);
  await ctx.close();
}
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 2500 });
  await p.locator('[data-nav="compras"]').first().click(); await espera(p, 900);
  await p.locator('[data-oc="2025-125-SE26"] > div').first().click(); await espera(p, 1300);
  await p.getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(p);
  await siguiente(p);
  const t2 = await modal(p).innerText();
  ok("C01_sin_desglose_muestra_monto_total_sin_inventar", (await modal(p).locator("[data-venta-sin-desglose]").count()) === 1 && /monto adjudicado total/.test(t2) && /\$1\.428\.000/.test(t2) && !/unit\. \$/.test(t2) && !/P\. Venta unit/i.test(t2));
  ok("C02_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ D. OC manual nueva: conserva el precio de venta ═════
{
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 2500 });
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  const btn = p.getByRole("button", { name: /Nueva OC|manual/i }).first();
  await btn.click(); await espera(p, 500);
  const manual = p.getByRole("button", { name: /manual/i }).first();
  if (await manual.count()) { await manual.click(); await espera(p, 500); }
  const m = modal(p);
  await m.getByPlaceholder("ej: 2436-690-AG26").fill("9999-1-SE26");
  await m.locator("select").first().selectOption({ index: 1 });
  await m.getByPlaceholder("ej: Municipalidad de Concepción").fill("Municipalidad Manual");
  await siguiente(p);
  const t2 = await m.innerText();
  ok("D01_oc_manual_conserva_precio_de_venta", /P\. Venta unit\. con IVA/i.test(t2) && !(await m.locator("[data-venta-oc]").count()));
  const inputs = m.locator("input"); await inputs.nth(0).fill("Producto manual"); await inputs.nth(2).fill("1"); await inputs.nth(3).fill("100000");
  await siguiente(p);
  ok("D02_oc_manual_sigue_exigiendo_precio_de_venta", /deben tener precio de venta/.test(await m.innerText()));
  ok("D03_sin_errores", !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
