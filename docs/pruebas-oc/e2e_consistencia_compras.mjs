// Consistencia compras ↔ productos ↔ financiamiento (15/10/2026). Supabase simulado (nada sale a la red).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_consistencia_compras.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { compradoEnOC, pedidosDeOC, planCorreccion, filaProtegida, idFilaCompra } from "../../src/lib/compraCotizacion.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const clon = (x) => JSON.parse(JSON.stringify(x));

const COT = { id: "cz1", id_externo: "5602-77-COT26", nombre: "Monitores y teclados", institucion: "Municipalidad Ficticia 5", estado: "adjudicada", oc_codigo: "2005-105-SE26",
  fecha: "2026-10-01", recargo: 0.3, direccion_entrega: "Balmaceda 292", comuna: "Laja", total: 1700000, actualizado_en: "2026-10-01" };
const ITEMS = [
  { id: "it-a1", cotizacion_id: "cz1", orden: 1, especificaciones_aprobadas: { nombre: "Monitor 24 pulgadas", marca: "LG", modelo: "24MK430" }, ficha_aprobada: true, enlace: "https://falabella.com/monitor", proveedor: "Falabella", cantidad: 2, precio_origen: 450000, precio_incluye_iva: true, con_factura: true, envio_clave: "e1" },
  { id: "it-b2", cotizacion_id: "cz1", orden: 2, especificaciones_aprobadas: { nombre: "Teclado inalámbrico", marca: "Logitech", modelo: "K270" }, ficha_aprobada: true, enlace: "https://falabella.com/teclado", proveedor: "Falabella", cantidad: 4, precio_origen: 90000, precio_incluye_iva: true, con_factura: true, envio_clave: "e1" },
];
const ENVIOS = [{ id: "en1", cotizacion_id: "cz1", clave: "e1", proveedor: "Falabella", monto: 11990, con_factura: true, estado_confirmacion: "confirmado", destino: "Balmaceda 292, Laja", evidencia: "Simulación", fecha_cotizacion: "2026-10-01" }];
const COSTO_TOTAL = 900000 + 360000 + 11990;
function datos(extra = () => {}) {
  const d = crearDatos();
  const o5 = d.ordenes_compra_v2.find((o) => o.id === "oc5"); Object.assign(o5, { monto_total: 2380000, financiador_id: "f1" });
  d.financiadores.find((f) => f.id === "f1").nombre = "Byron Vegas";
  d.oc_productos_link.push({ id: "v5a", oc_id: "oc5", descripcion: "Monitor 24 pulgadas", cantidad: 2, precio_venta: 1200000, origen: "venta", orden: 0, url: "sin-link" },
    { id: "v5b", oc_id: "oc5", descripcion: "Teclado inalámbrico", cantidad: 4, precio_venta: 800000, origen: "venta", orden: 1, url: "sin-link" });
  d.cotizaciones = [clon(COT)]; d.cotizacion_items = clon(ITEMS); d.cotizacion_envios = clon(ENVIOS);
  extra(d); return d;
}
// ── Verificador de consistencia (lo que exige el pedido) ──
const ocDe = (b, id = "oc5") => { const o = clon(b.db.ordenes_compra_v2.find((x) => x.id === id)); o.eventos_compra = b.db.eventos_compra.filter((e) => e.oc_id === id); o.oc_productos_link = b.db.oc_productos_link.filter((l) => l.oc_id === id); return o; };
function consistente(b, id = "oc5") {
  const oc = ocDe(b, id); const probs = [];
  for (const p of pedidosDeOC(oc)) { const s = [...p.productos, ...p.despachos].reduce((a, l) => a + (Number(l.precio_compra) || 0), 0); if (s !== Number(p.evento.costo_compra)) probs.push(`pedido ${p.clave}: filas ${s} ≠ compra ${p.evento.costo_compra}`); }
  const c = compradoEnOC(oc); for (const it of ITEMS) if ((c.porItem[it.id.replace(/[^A-Za-z0-9]/g, "")] || 0) > it.cantidad) probs.push(`${it.id}: comprado de más`);
  const costo = oc.eventos_compra.reduce((a, e) => a + e.costo_compra, 0); if (oc.costo_total !== costo) probs.push(`costo OC ${oc.costo_total} ≠ compras ${costo}`);
  const pagado = b.db.eventos_pago_financiamiento.filter((e) => e.oc_id === id).reduce((a, e) => a + e.monto, 0); if (oc.monto_pagado_fin !== pagado) probs.push("pagado no cuadra");
  return probs;
}
const deudaOC = (b, id = "oc5") => { const o = b.db.ordenes_compra_v2.find((x) => x.id === id); return o.costo_total - o.monto_pagado_fin; };

// ═════ Unitarias ═════
{
  const ev = { id: "evc1", costo_compra: 371990, notas: "Pedido PX1-1 · desde cotización", proveedor: "Falabella" };
  const fila = (k, item, q, total) => ({ id: idFilaCompra("PX1", 1, item, k), origen: "compra", cantidad: q, precio_compra: total, descripcion: item, url: "sin-link" });
  const oc = { eventos_compra: [ev], oc_productos_link: [fila(0, "it-a1", 1, 360000), { id: "lnkcz-PX1-1-desp" + "e1-0", origen: "compra", cantidad: 1, precio_compra: 11990, descripcion: "Despacho" }, fila(1, "it-b2", 0, 0), { ...fila(0, "it-a1", 5, 1), id: idFilaCompra("PHUERFANO", 1, "it-a1", 0) }] };
  ok("U1_solo_cuentan_filas_con_compra", compradoEnOC(oc).porItem.ita1 === 1 && !filaProtegida(oc.oc_productos_link[3], oc) && !!filaProtegida(oc.oc_productos_link[0], oc));
  const ped = pedidosDeOC(oc)[0];
  const sinDinero = planCorreccion(ped, [{ id: oc.oc_productos_link[0].id, descripcion: "it-a1", url: "https://otro.cl", direccion_entrega: "", cantidad: 1, unitario: 360000 }], { proveedor: "Paris" });
  ok("U2_comercial_no_mueve_dinero", !sinDinero.financiero && sinDinero.cambiaProveedor && sinDinero.costoNuevo === 371990 && sinDinero.cambiosFilas[0].patch.url === "https://otro.cl");
  const baja = planCorreccion(ped, [{ id: oc.oc_productos_link[1].id, monto: 5990 }]);
  ok("U3_despacho_corrige_misma_compra", baja.financiero && baja.costoNuevo === 365990 && baja.delta === -6000);
  ok("U4_cantidad_solo_baja", planCorreccion(ped, [{ id: oc.oc_productos_link[0].id, descripcion: "it-a1", url: "", direccion_entrega: "", cantidad: 3, unitario: 360000 }]).errores.length === 1);
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const modal = (p) => p.locator('[role="dialog"]').last();
async function abrirOC(p, numero = "2005-105-SE26") {
  if (await p.locator('[role="dialog"]').count()) { await p.keyboard.press("Escape"); await espera(p, 300); }
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
const irSeccion = async (p, t) => { await p.locator("[data-indice-ficha] button", { hasText: t }).first().click(); await espera(p, 500); };
async function comprar(p, { opcion = "A", ajustes = async () => {} } = {}) {
  await abrirOC(p);
  let b = p.getByRole("button", { name: /Registrar (otra )?compra/ });
  if (!(await b.count())) { await irSeccion(p, "Compra y financiamiento"); b = p.getByRole("button", { name: /Registrar (otra )?compra/ }); }
  await b.first().click(); await espera(p, 1200);
  const m = modal(p);
  await m.locator(`[data-opcion="${opcion}"]`).click(); await espera(p, 300);
  await ajustes(m);
  if (opcion === "A") await m.locator('[data-confirmar="vigencia"] input').check();
  await m.locator("[data-registrar-compra-cotizacion]").click(); await espera(p, 2500);
}
async function abrirCorreccion(p) {
  await abrirOC(p); await irSeccion(p, "Compra y financiamiento");
  const bts = p.locator("[data-corregir-compra]");
  if (!(await bts.count())) { await p.getByText(/Compra registrada|Compra/).first().click().catch(() => {}); await espera(p, 400); }
  await p.locator("[data-corregir-compra]").first().click(); await espera(p, 800);
  return modal(p);
}
async function preparar(opts = {}) {
  const b = crearBase(datos(opts.extra), { mp: RESPUESTAS_MP });
  const r = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 1000, movil: false, espera: 2500, usuario: opts.usuario || "u1" });
  return { ...r, p: r.page, b };
}
const historial = (b, re) => b.db.historial_cambios.filter((h) => re.test(h.accion || ""));

// 1, 7. Compra completa con despacho compartido.
{
  const { p, ctx, errs, b } = await preparar();
  await comprar(p);
  ok("S1_compra_completa_consistente", b.db.eventos_compra.filter((e) => e.oc_id === "oc5").length === 1 && consistente(b).length === 0, consistente(b));
  ok("S7_despacho_compartido_una_vez", b.db.oc_productos_link.filter((l) => l.oc_id === "oc5" && /^Despacho/.test(l.descripcion)).length === 1);
  // 4. Intento de eliminar/editar una línea de la compra confirmada.
  await abrirOC(p); await irSeccion(p, "Productos");
  const prot = p.locator("[data-linea-protegida]");
  ok("S4_lineas_protegidas_sin_editar_ni_eliminar", (await prot.count()) === 3 && !(await p.locator("[data-ficha-oc] button", { hasText: /^Eliminar$/ }).count()) && (await p.locator("[data-corregir-desde-linea]").count()) === 3);
  ok("S4b_sin_repartir_inversion_sobre_compra", !(await p.getByRole("button", { name: /repartir/i }).count()));
  await irSeccion(p, "Compra y financiamiento");
  const sec = await p.locator("[data-ficha-oc]").innerText();
  ok("S4c_evento_sin_editar_ni_eliminar_sueltos", (await p.locator("[data-corregir-compra]").count()) >= 1 || /Corregir compra/.test(sec));
  ok("S1b_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 2, 3. Primera compra parcial y segunda compra; 5, 6. correcciones; 9. reintento.
{
  const { p, ctx, errs, b } = await preparar();
  await comprar(p, { opcion: "B", ajustes: async (m) => { await m.locator("[data-fila-compra]").nth(0).locator('[data-campo-compra="cantidad"]').fill("1"); await m.locator("[data-fila-compra]").nth(1).locator('[data-campo-compra="cantidad"]').fill("0"); } });
  ok("S2_primera_parcial_consistente", b.db.eventos_compra.filter((e) => e.oc_id === "oc5").length === 1 && consistente(b).length === 0 && compradoEnOC(ocDe(b)).porItem.ita1 === 1);
  await comprar(p);
  const evs = b.db.eventos_compra.filter((e) => e.oc_id === "oc5");
  ok("S3_segunda_compra_consistente", evs.length === 2 && consistente(b).length === 0 && evs.reduce((s, e) => s + e.costo_compra, 0) === COSTO_TOTAL, { evs: evs.map((e) => e.costo_compra), probs: consistente(b) });
  // 5. Proveedor y enlace sin dinero.
  let m = await abrirCorreccion(p);
  const deuda0 = deudaOC(b); const ev0 = clon(b.db.eventos_compra.filter((e) => e.oc_id === "oc5"));
  await m.locator('[data-corr="proveedor"]').fill("Falabella Empresas");
  await m.locator("[data-corr-fila]").first().locator('[data-corr="url"]').fill("https://falabella.com/monitor-nuevo"); await espera(p, 200);
  ok("S5a_comercial_sin_motivo_obligatorio", /Guardar datos comerciales/.test(await m.locator("[data-corr-guardar]").innerText()));
  await m.locator("[data-corr-guardar]").click(); await espera(p, 2000);
  const ev1 = b.db.eventos_compra.filter((e) => e.oc_id === "oc5");
  ok("S5_proveedor_y_enlace_sin_cambiar_dinero", ev1.length === 2 && ev1.some((e) => e.proveedor === "Falabella Empresas") && ev1.every((e, i) => e.costo_compra === ev0[i].costo_compra) && deudaOC(b) === deuda0
    && b.db.oc_productos_link.some((l) => l.url === "https://falabella.com/monitor-nuevo") && historial(b, /sin cambio de dinero/).length === 1 && consistente(b).length === 0, { ev1, deuda: deudaOC(b), deuda0 });
  // 6a. Aumentar cantidad: rechazado.
  m = await abrirCorreccion(p);
  const f0 = m.locator("[data-corr-cantidad]").first();
  await f0.fill("5"); await m.locator('[data-corr="motivo"]').fill("prueba"); await m.locator("[data-corr-guardar]").click(); await espera(p, 600);
  ok("S6a_no_aumenta_cantidad_desde_correccion", /solo puede disminuir/.test(await m.locator("[data-corr-errores]").innerText()) && consistente(b).length === 0);
  // 6b + 9. Bajar cantidad y precio con una falla al guardar los productos → reintento sin duplicar.
  await f0.fill("0"); await m.locator('[data-corr="motivo"]').fill("Un monitor no se compró"); await espera(p, 200);
  ok("S6b_muestra_impacto", /Costo de esta compra/.test(await m.locator("[data-corr-impacto]").innerText()));
  let fallar = true;
  await p.route("**/rest/v1/oc_productos_link?id=eq.*", (r) => { if (fallar && r.request().method() === "PATCH") { fallar = false; return r.fulfill({ status: 500, json: { message: "falla simulada" } }); } return r.fallback(); });
  const nEv = b.db.eventos_compra.length;
  await m.locator("[data-corr-guardar]").click(); await espera(p, 2000);
  ok("S9a_falla_informada", /No se guardó la corrección/.test(await m.locator("[data-corr-errores]").innerText()));
  await m.locator("[data-corr-guardar]").click(); await espera(p, 2500);
  ok("S9_reintento_sin_segunda_compra_ni_deuda", b.db.eventos_compra.length === nEv && consistente(b).length === 0 && b.db.eventos_compra.filter((e) => e.oc_id === "oc5").reduce((s, e) => s + e.costo_compra, 0) === COSTO_TOTAL - 450000, { probs: consistente(b), evs: b.db.eventos_compra.filter((e) => e.oc_id === "oc5").map((e) => e.costo_compra) });
  ok("S6c_cantidad_liberada_coherente_con_costo", compradoEnOC(ocDe(b)).porItem.ita1 === 1 && historial(b, /Compra corregida \(Pedido .*motivo: Un monitor no se compró/).length >= 1);
  ok("S6d_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 6 (usuario no administrador): no puede cambiar dinero.
{
  const { p, ctx, errs, b } = await preparar({ usuario: "u1" });
  await comprar(p);
  await ctx.close();
  // Mismo estado, ahora como usuario sin rol de administrador.
  const b2 = crearBase(clon(b.db), { mp: RESPUESTAS_MP });
  const r = await abrir(browser, b2, { url: URL_APP, ancho: 1440, alto: 1000, movil: false, espera: 2500, usuario: "u2" });
  const m = await abrirCorreccion(r.page);
  ok("S6e_no_admin_campos_financieros_bloqueados", await m.locator("[data-corr-cantidad]").first().isDisabled() && await m.locator("[data-corr-monto]").first().isDisabled() && !(await m.locator("[data-corr-anular]").count()));
  ok("S6f_sin_errores", !r.errs.length && !errs.length, [...r.errs, ...errs]);
  await r.ctx.close();
}

// 8. Financiada por Byron con devoluciones parciales FIFO.
{
  const { p, ctx, errs, b } = await preparar();
  await comprar(p);
  // Devolución de capital (FIFO global) que dejó 900.000 asignados a esta OC.
  b.escribir("POST", "eventos_pago_financiamiento", new URLSearchParams(), { id: "pf_fifo", oc_id: "oc5", financiador_id: "f1", fecha: "2026-10-14", monto: 900000 });
  const pagosAntes = clon(b.db.eventos_pago_financiamiento);
  await p.reload({ waitUntil: "load" }); await espera(p, 3000);
  let m = await abrirCorreccion(p);
  // Bajar el costo bajo lo ya devuelto: la base lo rechaza y nada cambia.
  await m.locator("[data-corr-cantidad]").nth(0).fill("0"); await m.locator("[data-corr-cantidad]").nth(1).fill("0");
  await m.locator('[data-corr="motivo"]').fill("prueba bajo lo pagado"); await espera(p, 200);
  const costoAntes = b.db.eventos_compra.find((e) => e.oc_id === "oc5").costo_compra; const filasAntes = clon(b.db.oc_productos_link.filter((l) => l.oc_id === "oc5"));
  await m.locator("[data-corr-guardar]").click(); await espera(p, 2000);
  ok("S8a_no_baja_bajo_lo_devuelto_y_nada_cambia", /no puede quedar bajo lo ya pagado/.test(await m.locator("[data-corr-errores]").innerText()) && b.db.eventos_compra.find((e) => e.oc_id === "oc5").costo_compra === costoAntes
    && JSON.stringify(b.db.oc_productos_link.filter((l) => l.oc_id === "oc5")) === JSON.stringify(filasAntes) && consistente(b).length === 0);
  await p.keyboard.press("Escape"); await espera(p, 300);
  m = await abrirCorreccion(p);
  await m.locator("[data-corr-monto]").first().fill("15990"); await m.locator('[data-corr="motivo"]').fill("Despacho real mayor"); await espera(p, 200);
  await m.locator("[data-corr-guardar]").click(); await espera(p, 2500);
  ok("S8b_corrige_misma_compra_deuda_recalculada", b.db.eventos_compra.filter((e) => e.oc_id === "oc5").length === 1 && deudaOC(b) === COSTO_TOTAL + 4000 - 900000 && consistente(b).length === 0, { deuda: deudaOC(b), probs: consistente(b) });
  ok("S8c_devoluciones_fifo_intactas", JSON.stringify(b.db.eventos_pago_financiamiento) === JSON.stringify(pagosAntes));
  ok("S8d_sin_errores", !errs.length, errs);
  await ctx.close();
}

// Anular una compra confirmada (administrador): se elimina la compra y sus productos; lo pendiente vuelve, coherente.
{
  const { p, ctx, errs, b } = await preparar();
  await comprar(p, { opcion: "B", ajustes: async (m) => { await m.locator("[data-fila-compra]").nth(1).locator('[data-campo-compra="cantidad"]').fill("0"); } });
  await comprar(p);
  const m = await abrirCorreccion(p);
  await m.locator('[data-corr="motivo"]').fill("Pedido duplicado por error"); await m.locator("[data-corr-anular]").click(); await espera(p, 2500);
  const evs = b.db.eventos_compra.filter((e) => e.oc_id === "oc5");
  ok("SA_anular_compra_coherente", evs.length === 1 && consistente(b).length === 0 && pedidosDeOC(ocDe(b)).length === 1 && historial(b, /Compra anulada .*Pedido duplicado/).length === 1, { evs: evs.map((e) => e.costo_compra), probs: consistente(b) });
  ok("SA_sin_errores", !errs.length, errs);
  await ctx.close();
}

// 10. OC histórica sin vínculos nuevos: sigue igual (editar, eliminar, repartir y editar compra normales).
{
  const { p, ctx, errs, b } = await preparar();
  const antes = clon(b.db);
  await abrirOC(p, "2001-101-SE26"); await irSeccion(p, "Productos");
  ok("S10_historica_lineas_editables", !(await p.locator("[data-linea-protegida]").count()) && (await p.locator("[data-ficha-oc] button", { hasText: /^Editar$/ }).count()) >= 2 && (await p.getByRole("button", { name: /repartir/i }).count()) === 1);
  await irSeccion(p, "Compra y financiamiento");
  ok("S10b_historica_compra_sin_corregir_compra", !(await p.locator("[data-corregir-compra]").count()));
  ok("S10c_historica_sin_cambios", JSON.stringify(antes.eventos_compra) === JSON.stringify(b.db.eventos_compra) && JSON.stringify(antes.oc_productos_link) === JSON.stringify(b.db.oc_productos_link));
  ok("S10d_sin_errores", !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
