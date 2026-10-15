// Origen explícito de las líneas de producto (15/10/2026). La columna oc_productos_link.origen toma «compra» por
// defecto, así que toda línea se debe crear indicando si es lo VENDIDO (venta) o lo COMPRADO (compra).
//  A. OC pendiente de Mercado Público: el marcador «Producto por completar» nace como venta y, al sincronizar,
//     se completa en la misma línea (sin duplicar).
//  B. OC ingresada a mano: cada producto queda como venta (precio de venta) y como compra (precio de compra y enlace).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_origen_lineas.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { planProductosVenta } from "../../src/lib/mercadoPublico.js";
import { productosVendidos } from "../../src/lib/productosOC.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const modal = (p) => p.locator('[role="dialog"]').last();

// Unitaria: un marcador de venta se completa (no se agrega otra línea); un marcador «compra» provocaría duplicado.
{
  const prods = [{ descripcion: "Monitor 24 pulgadas", cantidad: 2, total_linea: 2000000, categoria: "Computación" }];
  const v = planProductosVenta([{ id: "x", origen: "venta", orden: 0, descripcion: "Producto por completar" }], prods);
  const c = planProductosVenta([{ id: "x", origen: "compra", orden: 0, descripcion: "Producto por completar" }], prods);
  ok("U1_marcador_venta_se_completa_sin_duplicar", v.insertar.length === 0 && v.actualizar.length === 1 && v.actualizar[0].patch.descripcion === "Monitor 24 pulgadas" && c.insertar.length === 1);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [pref, movil] of [["E", false], ["M", true]]) {
  // ── A. OC pendiente de Mercado Público ──
  {
    const mp = { ...RESPUESTAS_MP };
    const b = crearBase(crearDatos(), { mp });
    const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
    const v = p.locator('[data-nav="compras"]:visible'); await v.first().click(); await espera(p, 800);
    await p.getByRole("button", { name: /^\+ Nueva OC$/ }).first().click(); await espera(p, 500);
    const m = modal(p);
    await m.locator("select").first().selectOption("v1");
    await m.locator("input").last().fill("4001-1-SE26"); await m.getByRole("button", { name: /Buscar OC/ }).click(); await espera(p, 900);
    await m.locator('input[placeholder="https://…"]').first().fill("https://tienda.cl/monitor");
    await m.getByRole("button", { name: /Crear OC/ }).click(); await espera(p, 1800);
    const oc = b.db.ordenes_compra_v2.find((o) => o.numero_oc === "4001-1-SE26");
    const ls = () => b.db.oc_productos_link.filter((l) => l.oc_id === oc?.id);
    ok(`${pref}A1_marcador_pendiente_nace_como_venta`, !!oc && ls().length === 1 && ls()[0].origen === "venta" && ls()[0].descripcion === "Producto por completar" && ls()[0].url === "https://tienda.cl/monitor", ls());
    // Mercado Público ya la publica: sincronizar completa la misma línea.
    mp["4001-1-SE26"] = { status: 200, body: { ok: true, oc: RESPUESTAS_MP["3001-1-SE26"].body.oc && { ...RESPUESTAS_MP["3001-1-SE26"].body.oc, numero_oc: "4001-1-SE26" } } };
    await p.keyboard.press("Escape"); await espera(p, 300);
    await p.getByPlaceholder(/Buscar/i).first().fill("4001-1-SE26"); await espera(p, 500);
    await p.locator('[data-oc="4001-1-SE26"] > div[role="button"]').first().click(); await espera(p, 1500);
    const btn = p.getByRole("button", { name: /Actualizar fecha y datos desde Mercado Público/ }).last();
    await btn.scrollIntoViewIfNeeded(); await btn.click(); await espera(p, 2500);
    const l2 = ls();
    ok(`${pref}A2_al_sincronizar_se_completa_sin_duplicar`, l2.length === 1 && l2[0].origen === "venta" && l2[0].descripcion === "Monitor 24 pulgadas" && Number(l2[0].cantidad) === 2 && l2[0].url === "https://tienda.cl/monitor"
      && productosVendidos({ ...oc, oc_productos_link: l2 }).n === 1, l2);
    ok(`${pref}A3_sin_errores`, !errs.length, errs);
    await ctx.close();
  }
  // ── B. OC ingresada a mano (escritorio y celular) ──
  {
    const b = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
    const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
    const v = p.locator('[data-nav="compras"]:visible'); await v.first().click(); await espera(p, 800);
    await p.getByRole("button", { name: /Nueva OC|manual/i }).first().click(); await espera(p, 500);
    const manual = p.getByRole("button", { name: /manual/i }).first();
    if (await manual.count()) { await manual.click(); await espera(p, 500); }
    const m = modal(p);
    await m.getByPlaceholder("ej: 2436-690-AG26").fill("9999-1-SE26");
    await m.locator("select").first().selectOption({ index: 1 });
    await m.getByPlaceholder("ej: Municipalidad de Concepción").fill("Municipalidad Manual");
    await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 400);
    const inp = m.locator("input");
    await inp.nth(0).fill("Silla ergonómica"); await inp.nth(1).fill("https://tienda.cl/silla"); await inp.nth(2).fill("2"); await inp.nth(3).fill("40000"); await inp.nth(4).fill("60000");
    await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 400);
    const fin = m.locator("select").first(); if (await fin.count()) await fin.selectOption({ index: 1 });
    await m.getByRole("button", { name: /Siguiente/ }).click(); await espera(p, 400);
    await m.getByRole("button", { name: /Crear OC/ }).click(); await espera(p, 2500);
    const oc = b.db.ordenes_compra_v2.find((o) => o.numero_oc === "9999-1-SE26");
    const ls = b.db.oc_productos_link.filter((l) => l.oc_id === oc?.id);
    const vta = ls.filter((l) => l.origen === "venta"), cmp = ls.filter((l) => l.origen === "compra");
    ok(`${pref}B1_oc_manual_venta_y_compra_separadas`, !!oc && ls.length === 2 && vta.length === 1 && cmp.length === 1
      && vta[0].descripcion === "Silla ergonómica" && Number(vta[0].cantidad) === 2 && Number(vta[0].precio_venta) === 120000 && vta[0].precio_compra == null && vta[0].url === "sin-link"
      && Number(cmp[0].precio_compra) === 80000 && cmp[0].precio_venta == null && cmp[0].url === "https://tienda.cl/silla", { ls, err: await m.innerText().catch(() => "") });
    ok(`${pref}B2_compra_registrada_como_evento`, b.db.eventos_compra.some((e) => e.oc_id === oc?.id && Number(e.costo_compra) === 80000));
    ok(`${pref}B3_contador_un_producto`, productosVendidos({ ...oc, oc_productos_link: ls }).n === 1);
    ok(`${pref}B4_sin_errores`, !errs.length, errs);
    await ctx.close();
  }
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
