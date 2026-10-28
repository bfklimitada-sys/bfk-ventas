// Interfaz: comisión ordinaria del PERÍODO con varios vendedores (Etapa 4). Base simulada; nada sale a la red; datos ficticios.
// Mes en curso (≥ octubre 2026) con dos vendedores ordinarios y un tercero con solo una venta propia:
//   utilidad 600.000 + 400.000, IVA neto 100.000 + PPM 60.000 → comisión total 420.000 → 252.000 y 168.000 (no 220.000 y 120.000).
// Uso: node docs/pruebas-comisiones-multiples/e2e_periodo.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const pesos = (s) => (/[-−]/.test(String(s || "")) ? -1 : 1) * Number(String(s || "").replace(/[^0-9]/g, ""));
const $ = (n) => "$" + n.toLocaleString("es-CL");
const espera = (p, ms) => p.waitForTimeout(ms);
const hoyCL = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
const m0 = { anio: hoyCL.getFullYear(), mes: hoyCL.getMonth() + 1, fecha: `${hoyCL.getFullYear()}-${String(hoyCL.getMonth() + 1).padStart(2, "0")}-05` };

const d = crearDatos();
// Las OC de la base de prueba común no participan: este escenario controla todos los vendedores del período.
d.ordenes_compra_v2.forEach((o) => { o.vendedor_id = null; });
d.vendedores.push({ id: "va", nombre: "Ana Prueba", comision_pct: 0 }, { id: "vb", nombre: "Bruno Prueba", comision_pct: 0 }, { id: "vc", nombre: "Carla Prueba", comision_pct: 0 });
const venta = (id, vend, util, extra = {}) => {
  d.ordenes_compra_v2.push({ id, numero_oc: `${id}-1-AG26`, cliente: "Municipalidad Ficticia", tipo_registro: "venta", vendedor_id: vend, financiador_id: "f1",
    monto_total: 1000000 + util, costo_total: 1000000, monto_facturado: 1000000 + util, monto_cobrado: 0, monto_pagado_fin: 0, estado_factura_propia: "emitida",
    estado_compra: "comprado", estado_entrega: "confirmada", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", dias_pago: 30,
    fecha_emision_mp: m0.fecha, creadoEn: m0.fecha + "T10:00:00Z", ...extra });
  d.eventos_compra.push({ id: "ev" + id, oc_id: id, fecha: m0.fecha, costo_compra: 1000000, financiador_id: "f1" });
  d.eventos_factura.push({ id: "fa" + id, oc_id: id, fecha: m0.fecha, numero_factura: "8" + id.length + id.charCodeAt(id.length - 1), tipo_documento: "factura", monto: 1000000 + util });
};
venta("ocPA", "va", 600000); venta("ocPB", "vb", 400000); venta("ocPC", "vc", 419000, { es_venta_propia: true });
d.iva_mensual = d.iva_mensual.filter((i) => !(i.anio === m0.anio && i.mes === m0.mes));
d.iva_mensual.push({ id: "ivm0", anio: m0.anio, mes: m0.mes, iva_ventas: 150000, iva_compras: 50000, iva_pagado: 160000 });
const vpC = Math.max(0, Math.round(419000 - (1419000 - 1419000 / 1.19)));   // 100% de la utilidad − IVA de su factura (> 0)
const b = crearBase(d);
const n0 = () => b.escr.length;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [ancho, alto, movil] of [[1366, 900, false], [390, 844, true]]) {
  const sufijo = movil ? "movil" : "escritorio";
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  const inicioEscr = n0();
  const irA = async (k) => { if (["finanzas","financiamiento","vendedores","gastos","impuestos","banco"].includes(k) && !(await p.locator(`[data-tab="${k}"]`).count())) { await p.locator('[data-nav="finanzas"]').first().click(); await espera(p, 500); } const nav = p.locator(`[data-nav="${k}"]`).first(); if (await nav.count()) await nav.click(); else { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 300); await p.locator(`[data-nav="${k}"]`).first().click(); } await espera(p, 900); };
  await irA("vendedores");
  ok(`${sufijo}_ana_en_curso_252000`, pesos(await p.locator('[data-vendedor-en-curso="va"]').innerText().catch(() => "")) === 252000, await p.locator('[data-vendedor-en-curso="va"]').innerText().catch(() => ""));
  ok(`${sufijo}_bruno_en_curso_168000`, pesos(await p.locator('[data-vendedor-en-curso="vb"]').innerText().catch(() => "")) === 168000, await p.locator('[data-vendedor-en-curso="vb"]').innerText().catch(() => ""));
  ok(`${sufijo}_carla_solo_venta_propia`, vpC > 0 && pesos(await p.locator('[data-vendedor-en-curso="vc"]').innerText().catch(() => "")) === vpC, await p.locator('[data-vendedor-en-curso="vc"]').innerText().catch(() => ""));
  // Desglose de Ana: período con dos vendedores, descuento una sola vez, su parte.
  await p.getByRole("button", { name: /Ana Prueba/ }).first().click(); await espera(p, 400);
  const des = p.locator('[data-comision-periodo="proporcional"]').first();
  const tx = (await des.innerText().catch(() => "")).replace(/\s+/g, " ");
  ok(`${sufijo}_desglose_del_periodo_visible`, (await des.count()) === 1, tx);
  ok(`${sufijo}_desglose_utilidad_del_periodo`, tx.includes("Utilidad ordinaria del período (2 vendedores)") && tx.includes($(1000000)), tx);
  ok(`${sufijo}_desglose_descuento_una_vez_y_total`, tx.includes("una sola vez") && tx.includes($(420000)), tx);
  ok(`${sufijo}_desglose_su_parte`, tx.includes($(252000)) && tx.includes("60%"), tx);
  ok(`${sufijo}_comision_del_mes_ana`, /= Comisión del mes: \$252\.000/.test((await p.locator("text=/= Comisión del mes/").first().innerText().catch(() => "")).replace(/\s+/g, " ")));
  await p.getByRole("button", { name: /Ana Prueba/ }).first().click(); await espera(p, 300);
  await p.getByRole("button", { name: /Carla Prueba/ }).first().click(); await espera(p, 400);
  ok(`${sufijo}_carla_sin_ventas_ordinarias`, (await p.locator('[data-comision-periodo="solo_ventas_propias"]').count()) === 1);
  // Panel: comisiones en curso del período = 420.000 + venta propia de Carla (sin duplicar el descuento).
  await irA("panel");
  if (!(await p.locator("[data-resumen-caja]").count())) { await p.locator('[data-desplegable="caja"] > button').first().click().catch(() => {}); await espera(p, 400); }
  await p.waitForSelector("[data-resumen-caja]", { timeout: 8000 }).catch(() => {});
  const enCurso = pesos(await p.locator('[data-monto="comisiones_en_curso"]').first().innerText().catch(() => ""));
  ok(`${sufijo}_panel_en_curso_420000_mas_venta_propia`, enCurso === 420000 + vpC, enCurso);
  ok(`${sufijo}_ninguna_escritura`, b.escr.slice(inicioEscr).filter((w) => !["mp_cache_avisos", "mp_uso_diario"].includes(w.tabla)).length === 0, b.escr.slice(inicioEscr));
  ok(`${sufijo}_sin_errores`, errs.length === 0, errs);
  await p.close();
}
await browser.close();
console.log(`\nRESUMEN e2e comisión del período: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
