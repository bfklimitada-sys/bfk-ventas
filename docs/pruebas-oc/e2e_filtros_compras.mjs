// Filtros «Financiamiento pendiente» y «Vale vista pendiente» de Compras (15/10/2026). Supabase simulado.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_filtros_compras.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "./datos_oc.mjs";
import { financiamientoPendiente, saldoFinanciamientoOC, tieneValeVistaPendiente, resumenFinanciamiento, documentosPendientes } from "../../src/lib/filtrosCompras.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 600) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);

// ── Datos: OCs nuevas con totales coherentes (como los calcula la base) ──
function datos() {
  const d = crearDatos();
  d.financiadores.push({ id: "fb", nombre: "Byron Vegas", tipo: "externo" }, { id: "fk", nombre: "Kevin Vergara", tipo: "externo" }, { id: "fp", nombre: "Cuenta BFK Propia", tipo: "propio" });
  const base = d.ordenes_compra_v2[0];
  const nueva = (id, numero, o) => ({ ...base, id, numero_oc: numero, cliente: "CLIENTE " + numero, vendedor_id: "v1", estado_entrega: "pendiente", estado_factura_propia: "pendiente", estado_pago_cliente: "pendiente", monto_facturado: 0, monto_cobrado: 0, ...o });
  const compra = (oc, monto, fecha) => d.eventos_compra.push({ id: "evc_" + oc, oc_id: oc, fecha, costo_compra: monto, monto_venta: 1000000, proveedor: "Prov" });
  const pagoFin = (id, oc, fin, monto) => d.eventos_pago_financiamiento.push({ id, oc_id: oc, financiador_id: fin, fecha: dias(1), monto });
  // Byron: devolución de 1.000.000 repartida por FIFO (la más antigua primero) → B1 pagada, B2 parcial; B3 sin devolución.
  d.ordenes_compra_v2.push(nueva("ocB1", "3001-1-SE26", { financiador_id: "fb", fecha_emision_mp: dias(30) }), nueva("ocB2", "3002-2-SE26", { financiador_id: "fb", fecha_emision_mp: dias(20) }), nueva("ocB3", "3003-3-SE26", { financiador_id: "fb", fecha_emision_mp: dias(10) }));
  compra("ocB1", 600000, dias(30)); compra("ocB2", 800000, dias(20)); compra("ocB3", 300000, dias(10));
  pagoFin("pfB1", "ocB1", "fb", 600000); pagoFin("pfB2", "ocB2", "fb", 400000);
  // Kevin: un pago suelto (sin OC) → su saldo global difiere de la suma por OC.
  d.ordenes_compra_v2.push(nueva("ocK1", "3011-1-SE26", { financiador_id: "fk" })); compra("ocK1", 500000, dias(5)); pagoFin("pfK0", null, "fk", 100000);
  // Fondos propios (no corresponde devolución) y compra con costo 0.
  d.ordenes_compra_v2.push(nueva("ocP1", "3021-1-SE26", { financiador_id: "fp" }), nueva("ocZ1", "3031-1-SE26", { financiador_id: "fb" }));
  compra("ocP1", 200000, dias(5)); compra("ocZ1", 0, dias(5));
  // Vale vista: pendiente, cobrado, mixto (uno cobrado y otro pendiente) y solo transferencia.
  d.ordenes_compra_v2.push(nueva("ocV1", "3041-1-SE26", { financiador_id: "fb" }), nueva("ocV2", "3042-2-SE26", { financiador_id: "fb" }), nueva("ocV3", "3043-3-SE26", { financiador_id: "fb" }), nueva("ocV4", "3044-4-SE26", { financiador_id: "fb" }));
  for (const v of ["ocV1", "ocV2", "ocV3", "ocV4"]) { compra(v, 100000, dias(8)); pagoFin("pf" + v, v, "fb", 100000); }
  d.eventos_pago_cliente.push({ id: "pcV1", oc_id: "ocV1", fecha: dias(3), monto: 300000, medio_pago: "vale_vista", cobrado_en_banco: false, institucion: "BancoEstado" },
    { id: "pcV2", oc_id: "ocV2", fecha: dias(6), monto: 250000, medio_pago: "vale_vista", cobrado_en_banco: true, institucion: "BancoEstado" },
    { id: "pcV3a", oc_id: "ocV3", fecha: dias(4), monto: 100000, medio_pago: "cheque", cobrado_en_banco: false, institucion: "Banco de Chile" },
    { id: "pcV3b", oc_id: "ocV3", fecha: dias(9), monto: 200000, medio_pago: "vale_vista", cobrado_en_banco: true, institucion: "BancoEstado" },
    { id: "pcV4", oc_id: "ocV4", fecha: dias(2), monto: 400000, medio_pago: "transferencia", cobrado_en_banco: true });
  // Totales coherentes (como los recalcula la base) para que no queden diferencias congeladas.
  const tipo = (o) => (d.financiadores.find((f) => f.id === o.financiador_id)?.tipo === "propio" ? "fondos_propios" : "externo");
  for (const o of d.ordenes_compra_v2.filter((x) => /^oc[BKPZV]/.test(x.id))) {
    const costo = d.eventos_compra.filter((e) => e.oc_id === o.id).reduce((s, e) => s + e.costo_compra, 0);
    const pagado = d.eventos_pago_financiamiento.filter((e) => e.oc_id === o.id).reduce((s, e) => s + e.monto, 0);
    const cobrado = d.eventos_pago_cliente.filter((e) => e.oc_id === o.id).reduce((s, e) => s + e.monto, 0);
    Object.assign(o, { costo_total: costo, monto_pagado_fin: pagado, monto_cobrado: cobrado, estado_compra: "comprado", estado_pago_cliente: cobrado > 0 ? "parcial" : "pendiente",
      estado_pago_financiamiento: tipo(o) !== "externo" ? "no_aplica" : costo <= 0 ? "pendiente" : pagado >= costo ? "pagado" : pagado > 0 ? "parcial" : "pendiente" });
  }
  for (const f of d.financiadores.filter((x) => ["fb", "fk", "fp"].includes(x.id))) {
    if (f.tipo === "propio") { f.saldo_deuda = 0; continue; }
    const compras = d.ordenes_compra_v2.filter((o) => o.financiador_id === f.id).reduce((s, o) => s + d.eventos_compra.filter((e) => e.oc_id === o.id).reduce((a, e) => a + e.costo_compra, 0), 0);
    f.saldo_deuda = compras - d.eventos_pago_financiamiento.filter((e) => e.financiador_id === f.id).reduce((s, e) => s + e.monto, 0);
  }
  return d;
}

// ═════ Unitarias ═════
const D = datos(); const O = (id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), eventos_compra: D.eventos_compra.filter((e) => e.oc_id === id), eventos_pago_cliente: D.eventos_pago_cliente.filter((e) => e.oc_id === id) });
ok("U1_pendiente_parcial_fifo", financiamientoPendiente(O("ocB2")) && saldoFinanciamientoOC(O("ocB2")) === 400000 && financiamientoPendiente(O("ocB3")));
ok("U2_pagada_propia_y_costo_cero_no", !financiamientoPendiente(O("ocB1")) && !financiamientoPendiente(O("ocP1")) && !financiamientoPendiente(O("ocZ1")));
ok("U3_vale_vista", tieneValeVistaPendiente(O("ocV1")) && !tieneValeVistaPendiente(O("ocV2")) && tieneValeVistaPendiente(O("ocV3")) && !tieneValeVistaPendiente(O("ocV4")) && documentosPendientes([O("ocV3")]).length === 1);
const todas = ["ocB1", "ocB2", "ocB3", "ocK1", "ocP1", "ocZ1"].map(O);
const rs = resumenFinanciamiento(todas, todas, D.financiadores);
ok("U4_resumen_byron_coincide_kevin_difiere", rs.find((g) => g.id === "fb").pendiente === 700000 && rs.find((g) => g.id === "fb").cuadra === true && rs.find((g) => g.id === "fk").cuadra === false && rs.find((g) => g.id === "fk").saldoGlobal === 400000, rs);

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const chip = (p, t) => p.locator("button", { hasText: new RegExp(`^${t}( \\d+)?$`) }).first();
const nChip = async (p, t) => Number(((await chip(p, t).innerText()).match(/(\d+)$/) || [0, 0])[1]);
const visibles = async (p) => (await p.locator("[data-oc]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-oc")))]));
const conteo = async (p) => Number(((await p.getByText(/^\d+ órdenes ·/).first().innerText()).match(/^(\d+)/) || [0, -1])[1]);

for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = crearBase(datos(), { mp: RESPUESTAS_MP });
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1440, alto: movil ? 844 : 900, movil, espera: 2500 });
  if (movil) await p.locator('[data-nav="compras"]').first().click(); else await p.locator('aside [data-nav="compras"]').click();
  await espera(p, 1000);
  ok(`${pref}01_nombre_nuevo_sin_por_pagar`, (await chip(p, "Financiamiento pendiente").count()) === 1 && !(await p.locator("button", { hasText: /^Por pagar/ }).count()));
  // Financiamiento pendiente.
  const nFin = await nChip(p, "Financiamiento pendiente");
  await chip(p, "Financiamiento pendiente").click(); await espera(p, 600);
  const vis = await visibles(p);
  const esperadas = b.db.ordenes_compra_v2.filter((o) => !o.archivada && financiamientoPendiente({ ...o, eventos_compra: b.db.eventos_compra.filter((e) => e.oc_id === o.id) })).map((o) => o.numero_oc).sort();
  ok(`${pref}02_contador_igual_a_lista`, nFin === vis.length && (await conteo(p)) === vis.length && JSON.stringify([...vis].sort()) === JSON.stringify(esperadas), { nFin, vis: vis.length, esperadas: esperadas.length });
  ok(`${pref}03_pendiente_si_pagada_propia_cero_no`, vis.includes("3002-2-SE26") && vis.includes("3003-3-SE26") && vis.includes("3011-1-SE26") && !vis.includes("3001-1-SE26") && !vis.includes("3021-1-SE26") && !vis.includes("3031-1-SE26"));
  const res = p.locator("[data-resumen-financiamiento]");
  const gB = await res.locator('[data-fin-grupo="fb"]').innerText();
  ok(`${pref}04_byron_fifo_saldo_coincide`, /Byron Vegas/.test(gB) && /\$700\.000/.test(await res.locator('[data-fin-pendiente="fb"]').innerText()) && /coincide/.test(await res.locator('[data-fin-saldo-global="fb"]').innerText()), gB);
  ok(`${pref}05_kevin_saldo_global_difiere_sin_inventar`, /\$500\.000/.test(await res.locator('[data-fin-pendiente="fk"]').innerText()) && /\$400\.000/.test(await res.locator('[data-fin-saldo-global="fk"]').innerText()) && /no asignados/.test(await res.locator('[data-fin-saldo-global="fk"]').innerText()));
  ok(`${pref}06_explica_propio_no_corresponde_y_fifo`, /no corresponde devolución/.test(await res.innerText()) && /FIFO global/.test(await res.innerText()));
  ok(`${pref}07_fila_con_financiador_y_saldo`, /Byron Vegas · pendiente \$400\.000 \(costo \$800\.000 − devuelto \$400\.000\)/.test(await p.locator('[data-oc="3002-2-SE26"] [data-nota-vista]').innerText()));
  // Combinado: financiamiento pendiente + búsqueda.
  const busc = p.getByPlaceholder(/Buscar/i).first();
  await busc.fill("3002-2"); await espera(p, 600);
  ok(`${pref}08_combinado_con_busqueda`, (await visibles(p)).length === 1 && (await conteo(p)) === 1 && /\$400\.000/.test(await p.locator('[data-fin-pendiente="fb"]').innerText()));
  await busc.fill(""); await espera(p, 400);
  // Vale vista pendiente.
  const nVV = await nChip(p, "Vale vista pendiente");
  await chip(p, "Vale vista pendiente").click(); await espera(p, 600);
  const visV = await visibles(p);
  ok(`${pref}09_vale_vista_contador_y_lista`, nVV === visV.length && visV.includes("3041-1-SE26") && visV.includes("3043-3-SE26") && !visV.includes("3042-2-SE26") && !visV.includes("3044-4-SE26"), { nVV, visV });
  const rv = p.locator("[data-resumen-valevista]");
  ok(`${pref}10_documento_recibido_vs_abonado`, /Documento recibido · sin abonar en banco/.test(await rv.locator('[data-vv-doc="pcV1"]').innerText()) && /\$300\.000/.test(await rv.locator('[data-vv-doc="pcV1"]').innerText()) && /CLIENTE 3041-1-SE26/.test(await rv.innerText())
    && !(await rv.locator('[data-vv-doc="pcV3b"]').count()) && /1 ya abonado\(s\) en banco/.test(await p.locator('[data-oc="3043-3-SE26"] [data-nota-vista]').innerText()) && /no cuenta como caja/.test(await rv.innerText()));
  if (!movil) {
    // Confirmar el cobro del vale vista (flujo existente: editar el cobro y marcar abonado) → la OC sale del filtro.
    const n0 = b.escr.length;
    await p.locator('[data-oc="3041-1-SE26"] > div').nth(1).click(); await espera(p, 1300);
    await p.locator("[data-indice-ficha] button", { hasText: /Cobranza/ }).first().click(); await espera(p, 500);
    await p.locator("[data-ficha-oc] button", { hasText: /Editar/ }).last().click(); await espera(p, 600);
    const m = p.locator('[role="dialog"]').last();
    await m.locator('input[type="checkbox"]').first().check(); await m.getByRole("button", { name: /Guardar/ }).click(); await espera(p, 1800);
    await p.keyboard.press("Escape"); await espera(p, 600);
    await chip(p, "Vale vista pendiente").click(); await espera(p, 700);
    const visV2 = await visibles(p);
    ok(`${pref}11_al_confirmar_cobro_sale_del_filtro`, b.db.eventos_pago_cliente.find((e) => e.id === "pcV1").cobrado_en_banco === true && !visV2.includes("3041-1-SE26") && (await nChip(p, "Vale vista pendiente")) === nVV - 1, { visV2, escr: b.escr.slice(n0).map((w) => [w.metodo, w.tabla]) });
    ok(`${pref}12_no_toca_deuda_ni_compras`, b.escr.slice(n0).every((w) => !["eventos_compra", "eventos_pago_financiamiento", "financiadores", "ajustes_saldo_financiador"].includes(w.tabla)));
  }
  ok(`${pref}13_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
