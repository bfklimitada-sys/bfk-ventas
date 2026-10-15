// Compra desde la cotización adjudicada (15/10/2026). Supabase simulado (nada sale a la red).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_compra_cotizacion.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { baseCotizacion, compradoEnOC, estadoLineas, filasIniciales, armarPedidos, comparar, validarCompra, cotizacionesVinculadas, leerIdCompra, idFilaCompra } from "../../src/lib/compraCotizacion.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const clon = (x) => JSON.parse(JSON.stringify(x));

// ── Cotización adjudicada de prueba (vinculada por código, con mayúsculas/espacios distintos) ──
const COT = { id: "cz1", id_externo: "5602-77-COT26", nombre: "Monitores y teclados", institucion: "Municipalidad Ficticia 5", estado: "adjudicada", oc_codigo: " 2005-105-se26 ",
  fecha: "2026-10-01", recargo: 0.3, direccion_entrega: "Balmaceda 292", comuna: "Laja", total: 1700000, actualizado_en: "2026-10-01" };
const ITEMS = [
  { id: "it-a1", cotizacion_id: "cz1", orden: 1, especificaciones_aprobadas: { nombre: "Monitor 24 pulgadas", marca: "LG", modelo: "24MK430" }, ficha_aprobada: true, enlace: "https://falabella.com/monitor", proveedor: "Falabella", cantidad: 2, precio_origen: 450000, precio_incluye_iva: true, con_factura: true, envio_clave: "e1", recargo: null },
  { id: "it-b2", cotizacion_id: "cz1", orden: 2, especificaciones_aprobadas: { nombre: "Teclado inalámbrico", marca: "Logitech", modelo: "K270" }, ficha_aprobada: true, enlace: "https://falabella.com/teclado", proveedor: "Falabella", cantidad: 4, precio_origen: 90000, precio_incluye_iva: true, con_factura: true, envio_clave: "e1", recargo: null },
];
const ENVIOS = [{ id: "en1", cotizacion_id: "cz1", clave: "e1", proveedor: "Falabella", monto: 11990, con_factura: true, estado_confirmacion: "confirmado", destino: "Balmaceda 292, Laja", evidencia: "Simulación de compra", fecha_cotizacion: "2026-10-01" }];
function datos({ cotizaciones = [COT], extra = () => {} } = {}) {
  const d = crearDatos();
  const o5 = d.ordenes_compra_v2.find((o) => o.id === "oc5"); o5.monto_total = 2380000;
  d.oc_productos_link.push({ id: "v5a", oc_id: "oc5", descripcion: "Monitor 24 pulgadas", cantidad: 2, precio_venta: 1200000, origen: "venta", orden: 0, url: "sin-link" },
    { id: "v5b", oc_id: "oc5", descripcion: "Teclado inalámbrico", cantidad: 4, precio_venta: 800000, origen: "venta", orden: 1, url: "sin-link" });
  d.cotizaciones = clon(cotizaciones); d.cotizacion_items = clon(ITEMS); d.cotizacion_envios = clon(ENVIOS);
  extra(d); return d;
}
// Cotización como la entrega cargarCotizacion (para las unitarias).
const cotCargada = () => ({ ...COT, items: ITEMS.map((it) => ({ key: it.id, ficha: it.especificaciones_aprobadas, enlace: it.enlace, proveedor: it.proveedor, cantidad: it.cantidad, precio_origen: it.precio_origen, precio_incluye_iva: true, con_factura: true, envio_key: it.envio_clave, recargo: null })),
  envios: ENVIOS.map((e) => ({ key: e.clave, proveedor: e.proveedor, monto: e.monto, con_factura: true, estado: "confirmado", destino: e.destino, evidencia: e.evidencia })) });

// ═════ Unitarias ═════
const BASE = baseCotizacion(cotCargada());
{
  ok("U1_vinculo_explicito_por_codigo", cotizacionesVinculadas([COT, { ...COT, id: "x", oc_codigo: "2005-105-SE266" }, { ...COT, id: "y", estado: "presentada" }, { ...COT, id: "z", oc_codigo: "" }], "2005-105-SE26").map((c) => c.id).join() === "cz1");
  const lin = estadoLineas(BASE, { porItem: {}, despachos: new Set() });
  const fil = filasIniciales(BASE, lin);
  const g = armarPedidos({ filas: fil, base: BASE, comprado: { despachos: new Set() } });
  ok("U2_despacho_compartido_una_vez", g.length === 1 && g[0].despachos.length === 1 && g[0].costo === Math.round(BASE.costoTotal), { costo: g[0].costo, total: BASE.costoTotal });
  const fil2 = fil.map((f, i) => (i === 1 ? { ...f, proveedor: "Paris" } : f));
  const g2 = armarPedidos({ filas: fil2, base: BASE, comprado: { despachos: new Set() } });
  ok("U3_dos_proveedores_despacho_no_se_duplica", g2.length === 2 && g2.flatMap((x) => x.despachos).length === 1);
  const parcial = fil.map((f, i) => (i === 0 ? { ...f, cantidad: 1 } : f));
  const c = comparar({ base: BASE, lineas: lin, grupos: armarPedidos({ filas: parcial, base: BASE, comprado: { despachos: new Set() } }), ventaOC: 2380000, comprado: { despachos: new Set() } });
  ok("U4_parcial_proyecta_sin_definitivo", c.parcial && c.costoActualizado === Math.round(BASE.costoTotal) && c.utilidadActualizada === c.utilidadOriginal, c);
  ok("U5_no_compra_mas_de_lo_pendiente", validarCompra({ opcion: "B", filas: [...fil, { ...fil[0], rid: "x", cantidad: 1 }], lineas: lin, base: BASE }).errores.some((e) => /no se duplican/.test(e)));
  ok("U6_id_fila_reversible", leerIdCompra(idFilaCompra("PABC", 2, "it-a1", 0))?.item === "ita1" && leerIdCompra("lnk_123") === null);
  ok("U7_ya_comprado_se_descuenta", estadoLineas(BASE, compradoEnOC({ oc_productos_link: [{ id: idFilaCompra("P1", 1, "it-a1", 0), origen: "compra", cantidad: 2 }] }))[0].pendiente === 0);
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const modal = (p) => p.locator('[role="dialog"]').last();
async function abrirCompra(p, numero = "2005-105-SE26", boton = /Registrar (otra )?compra/) {
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
  if (!(await p.getByRole("button", { name: boton }).count())) { await p.locator("[data-indice-ficha] button", { hasText: "Compra y financiamiento" }).first().click(); await espera(p, 500); }
  await p.getByRole("button", { name: boton }).first().click(); await espera(p, 1200);
  return modal(p);
}
const escr = (b, n, f = () => true) => b.escr.slice(n).filter(f);
const rpcCompras = (b, n) => escr(b, n, (w) => w.tabla === "historial_cambios" && false).length; // (no usado)
const comprasDe = (b, oc = "oc5") => b.db.eventos_compra.filter((e) => e.oc_id === oc);
const filasCompra = (b, oc = "oc5") => b.db.oc_productos_link.filter((l) => l.oc_id === oc && l.origen === "compra");
const intactos = (b, d0) => JSON.stringify([b.db.cotizaciones, b.db.cotizacion_items, b.db.cotizacion_envios]) === JSON.stringify([d0.cotizaciones, d0.cotizacion_items, d0.cotizacion_envios])
  && b.db.ordenes_compra_v2.find((o) => o.id === "oc5").monto_total === 2380000
  && JSON.stringify(b.db.oc_productos_link.filter((l) => l.oc_id === "oc5" && l.origen === "venta")) === JSON.stringify(d0.oc_productos_link.filter((l) => l.oc_id === "oc5" && l.origen === "venta"));
async function preparar(opts = {}) {
  const d0 = datos(opts); const b = crearBase(clon(d0), { mp: RESPUESTAS_MP });
  const r = await abrir(browser, b, { url: URL_APP, ancho: opts.movil ? 390 : 1440, alto: opts.movil ? 844 : 900, movil: !!opts.movil, espera: 2500 });
  return { ...r, p: r.page, b, d0 };
}
const total = (b) => comprasDe(b).reduce((s, e) => s + e.costo_compra, 0);

// 1. Compra idéntica a la cotización (varios productos y despacho compartido).
{
  const { p, ctx, errs, b, d0 } = await preparar();
  const m = await abrirCompra(p);
  ok("I01_detecta_cotizacion_vinculada", (await m.locator("[data-compra-cotizacion]").count()) === 1 && /5602-77-COT26/.test(await m.innerText()));
  await m.locator('[data-opcion="A"]').click(); await espera(p, 300);
  const t = await m.innerText();
  ok("I02_carga_productos_proveedor_enlace_despacho", /Monitor 24 pulgadas/.test(t) && /Teclado inalámbrico/.test(t) && /Falabella/.test(t) && /falabella\.com\/monitor/.test(t) && (await m.locator("[data-pedido]").count()) === 1);
  const n0 = b.escr.length;
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 600);
  ok("I03_exige_confirmar_vigencia", /siguen vigentes/.test(await m.locator("[data-errores-compra]").innerText()) && comprasDe(b).length === 0);
  await m.locator('[data-confirmar="vigencia"] input').check();
  await m.locator("[data-registrar-compra-cotizacion]").evaluate((x) => { x.click(); x.click(); }); await espera(p, 2500);
  const ev = comprasDe(b);
  ok("I04_una_sola_compra_con_costo_cotizado", ev.length === 1 && ev[0].costo_compra === Math.round(BASE.costoTotal) && ev[0].proveedor === "Falabella" && /Pedido P[A-Z0-9]+-1/.test(ev[0].notas), ev);
  const fc = filasCompra(b);
  ok("I05_productos_compra_y_despacho_una_vez", fc.length === 3 && fc.filter((l) => /^Despacho/.test(l.descripcion)).length === 1 && fc.every((l) => l.precio_venta === null), fc.map((l) => [l.id, l.descripcion, l.precio_compra]));
  ok("I06_cotizacion_monto_y_vendidos_intactos", intactos(b, d0) && escr(b, n0, (w) => /^cotizacion/.test(w.tabla)).length === 0);
  const oc = b.db.ordenes_compra_v2.find((o) => o.id === "oc5");
  ok("I07_deuda_y_costo_una_vez", oc.costo_total === Math.round(BASE.costoTotal));
  ok("I08_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 2. Solo el precio modificado (opción B).
{
  const { p, ctx, errs, b, d0 } = await preparar();
  const m = await abrirCompra(p);
  await m.locator('[data-opcion="B"]').click(); await espera(p, 300);
  const fila = m.locator("[data-fila-compra]").first();
  await fila.locator('[data-campo-compra="unitario"]').fill("480000"); await espera(p, 300);
  const t = await m.innerText();
  ok("P01_destaca_campo_modificado", (await fila.locator("[data-cotizado]").count()) === 1 && /Cotizado: \$450\.000/.test(await fila.innerText()));
  ok("P02_muestra_impacto_costo_y_utilidad", /\+\$60\.000/.test(await m.locator("[data-diferencia-total]").innerText()) && (await fila.locator("[data-aviso-costo]").count()) === 1);
  const uo = Number((await m.locator("[data-utilidad-original]").innerText()).replace(/\D/g, "")), ua = Number((await m.locator("[data-utilidad-actualizada]").innerText()).replace(/\D/g, ""));
  ok("P03_utilidad_actualizada_baja_60000", uo - ua === 60000, { uo, ua });
  ok("P04_no_pide_vigencia_ni_especificaciones", !(await m.locator('[data-confirmar="vigencia"]').count()) && !(await m.locator('[data-confirmar="especificaciones"]').count()));
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  ok("P05_registra_costo_real", comprasDe(b).length === 1 && comprasDe(b)[0].costo_compra === Math.round(BASE.costoTotal) + 60000 && filasCompra(b).find((l) => /Monitor/.test(l.descripcion)).precio_compra === 960000);
  ok("P06_cotizacion_intacta", intactos(b, d0));
  ok("P07_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 3. Cambio de proveedor y enlace (un producto con otro proveedor → dos pedidos, despacho una vez).
{
  const { p, ctx, errs, b, d0 } = await preparar();
  const m = await abrirCompra(p);
  await m.locator('[data-opcion="B"]').click(); await espera(p, 300);
  const fila = m.locator("[data-fila-compra]").nth(1);
  await fila.locator('[data-campo-compra="proveedor"]').fill("Paris"); await fila.locator('[data-campo-compra="enlace"]').fill("https://paris.cl/teclado-k270"); await espera(p, 300);
  ok("V01_dos_pedidos_y_referencia_original_visible", (await m.locator("[data-pedido]").count()) === 2 && /Cotizado: Falabella/.test(await fila.innerText()) && /Cotizado: https:\/\/falabella\.com\/teclado/.test(await fila.innerText()));
  await m.locator('[data-despacho-extra="2"]').fill("4990"); await espera(p, 200);
  await fila.locator('[data-campo-compra="marca"]').fill("Genius"); await espera(p, 200);
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 600);
  ok("V01b_cambio_de_marca_advierte_especificaciones", (await fila.locator("[data-aviso-especificaciones]").count()) === 1 && /especificaciones ofertadas/.test(await m.locator("[data-errores-compra]").innerText()) && comprasDe(b).length === 0);
  await m.locator('[data-confirmar="especificaciones"] input').check();
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 3000);
  const ev = comprasDe(b);
  ok("V02_una_compra_por_proveedor", ev.length === 2 && ev.map((e) => e.proveedor).sort().join() === "Falabella,Paris" && total(b) === Math.round(BASE.costoTotal) + 4990, ev.map((e) => [e.proveedor, e.costo_compra]));
  const fc = filasCompra(b);
  ok("V03_enlace_nuevo_guardado_original_intacto", fc.some((l) => l.url === "https://paris.cl/teclado-k270") && intactos(b, d0) && fc.filter((l) => /^Despacho/.test(l.descripcion)).length === 2);
  ok("V04_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 4. Cambio de dirección y despacho: exige nueva verificación.
{
  const { p, ctx, errs, b } = await preparar();
  const m = await abrirCompra(p);
  await m.locator('[data-opcion="B"]').click(); await espera(p, 300);
  for (const f of await m.locator("[data-fila-compra]").all()) await f.locator('[data-campo-compra="direccion"]').fill("Bodega Municipal, Los Ángeles");
  await m.locator('[data-despacho-real="e1"]').fill("25990"); await m.locator('[data-campo-compra="fecha-entrega"]').fill("2026-10-25"); await espera(p, 300);
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 600);
  ok("D01_exige_verificar_despacho_nueva_direccion", /verificaste nuevamente el despacho/.test(await m.locator("[data-errores-compra]").innerText()) && comprasDe(b).length === 0);
  await m.locator('[data-confirmar="direccion"] input').check();
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  const ev = comprasDe(b)[0];
  ok("D02_registra_despacho_real_direccion_y_fecha", ev && ev.costo_compra === Math.round(BASE.costoTotal) - 11990 + 25990 && ev.fecha_entrega_estimada === "2026-10-25" && filasCompra(b).filter((l) => !/^Despacho/.test(l.descripcion)).every((l) => l.direccion_entrega === "Bodega Municipal, Los Ángeles"), ev);
  ok("D03_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 5 y 6. Compra parcial y segunda compra de la misma OC (con reintento tras una falla: sin segunda deuda).
{
  const { p, ctx, errs, b, d0 } = await preparar();
  let m = await abrirCompra(p);
  await m.locator('[data-opcion="B"]').click(); await espera(p, 300);
  await m.locator("[data-fila-compra]").nth(0).locator('[data-campo-compra="cantidad"]').fill("1");
  await m.locator("[data-fila-compra]").nth(1).locator('[data-campo-compra="cantidad"]').fill("0"); await espera(p, 300);
  ok("C01_parcial_rentabilidad_no_definitiva", (await m.locator("[data-aviso-parcial]").count()) === 1 && /proyectada/.test(await m.locator("[data-comparacion]").innerText()));
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  ok("C02_parcial_registra_solo_lo_comprado", comprasDe(b).length === 1 && comprasDe(b)[0].costo_compra === 450000 + 11990 && filasCompra(b).length === 2);
  // Segunda compra: pendientes y despacho ya registrado.
  m = await abrirCompra(p, "2005-105-SE26", /Registrar otra compra/);
  ok("C03_muestra_cotizadas_compradas_pendientes", /compradas 1/.test(await m.locator('[data-linea="it-a1"]').innerText()) && (await m.locator('[data-pendiente="it-a1"]').innerText()) === "1" && (await m.locator('[data-pendiente="it-b2"]').innerText()) === "4");
  await m.locator('[data-opcion="A"]').click(); await espera(p, 300);
  ok("C04_despacho_compartido_no_se_cobra_dos_veces", /ya registrado en una compra anterior/.test(await m.locator("[data-despachos]").innerText()));
  await m.locator('[data-confirmar="vigencia"] input').check();
  // Falla al guardar los productos (después de registrar la compra): el reintento NO crea otra compra.
  let fallar = true;
  await p.route("**/rest/v1/oc_productos_link", (r) => { if (fallar && r.request().method() === "POST") { fallar = false; return r.fulfill({ status: 500, json: { message: "falla simulada de red" } }); } return r.fallback(); });
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
  ok("C05_falla_informada_compra_registrada_una_vez", /Puedes reintentar/.test(await m.locator("[data-errores-compra]").innerText()) && comprasDe(b).length === 2);
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 3000);
  ok("C06_reintento_sin_segunda_compra_ni_deuda", comprasDe(b).length === 2 && total(b) === Math.round(BASE.costoTotal) && b.db.ordenes_compra_v2.find((o) => o.id === "oc5").costo_total === Math.round(BASE.costoTotal), comprasDe(b).map((e) => e.costo_compra));
  m = await abrirCompra(p, "2005-105-SE26", /Registrar otra compra/);
  ok("C07_todo_comprado_sin_duplicar", (await m.locator("[data-todo-comprado]").count()) === 1 && filasCompra(b).filter((l) => /^Despacho/.test(l.descripcion)).length === 1);
  ok("C08_cotizacion_intacta", intactos(b, d0));
  ok("C09_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 7. OC sin cotización vinculada → formulario actual. 8. Varias cotizaciones → elegir.
{
  const { p, ctx, errs } = await preparar({ cotizaciones: [{ ...COT, oc_codigo: "9999-9-SE26" }] });
  const m = await abrirCompra(p);
  ok("S01_sin_vinculo_formulario_actual", (await m.locator("[data-compra-normal]").count()) === 1 && !(await m.locator("[data-compra-cotizacion]").count()));
  ok("S02_sin_errores", !errs.length, errs);
  await ctx.close();
}
{
  const { p, ctx, errs } = await preparar({ cotizaciones: [COT, { ...COT, id: "cz2", id_externo: "5602-78-COT26" }], movil: true });
  await p.locator('[data-nav="compras"]').first().click(); await espera(p, 900);
  await p.locator('[data-oc="2005-105-SE26"] > div').first().click(); await espera(p, 1300);
  await p.getByRole("button", { name: /Registrar compra/ }).first().click(); await espera(p, 1200);
  const m = modal(p);
  ok("S03_varias_cotizaciones_pide_elegir", (await m.locator("[data-cotizacion-opcion]").count()) === 2);
  await m.locator('[data-cotizacion-opcion="cz1"]').click(); await espera(p, 1000);
  ok("S04_elegida_carga_flujo", (await m.locator("[data-compra-cotizacion]").count()) === 1);
  ok("S05_sin_errores", !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
