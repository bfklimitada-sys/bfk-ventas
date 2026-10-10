// Interfaz (10/10/2026): (1) pago manual sobre una comisión provisoria o del mes en curso exige confirmación explícita,
// sin impedir registrar la transferencia; (2) desde agosto 2026 el total del F29 se escribe a mano: no se presume igual al
// IVA a pagar y nunca se guarda vacío (NULL), porque la columna es NOT NULL en producción.
// Base simulada; nada sale a la red; datos ficticios. Uso: node docs/pruebas-comisiones/e2e_confirmaciones.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms) => p.waitForTimeout(ms);
const hoyCL = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
const mesRel = (k) => { const d = new Date(hoyCL.getFullYear(), hoyCL.getMonth() - k, 5); return { anio: d.getFullYear(), mes: d.getMonth() + 1, fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-05` }; };
const m1 = mesRel(1);   // mes anterior: sin IVA → comisión provisoria
const d = crearDatos();
d.vendedores.push({ id: "va", nombre: "Ana Prueba", comision_pct: 0 });
d.ordenes_compra_v2.push({ id: "ocA1", numero_oc: "7001-1-AG26", cliente: "Municipalidad Ficticia", tipo_registro: "venta", vendedor_id: "va", financiador_id: "f1",
  monto_total: 1600000, costo_total: 1000000, monto_facturado: 1600000, monto_cobrado: 0, monto_pagado_fin: 0, estado_factura_propia: "emitida",
  estado_compra: "comprado", estado_entrega: "confirmada", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", dias_pago: 30,
  fecha_emision_mp: m1.fecha, creadoEn: m1.fecha + "T10:00:00Z" });
d.eventos_compra.push({ id: "evA1", oc_id: "ocA1", fecha: m1.fecha, costo_compra: 1000000, financiador_id: "f1" });
d.eventos_factura.push({ id: "faA1", oc_id: "ocA1", fecha: m1.fecha, numero_factura: "97001", tipo_documento: "factura", monto: 1600000 });
d.iva_mensual = d.iva_mensual.filter((i) => !(i.anio === m1.anio && i.mes === m1.mes));
const b = crearBase(d);
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 2500 });
const irA = async (k) => { const nav = p.locator(`[data-nav="${k}"]`).first(); if (await nav.count()) await nav.click(); else { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 300); await p.locator(`[data-nav="${k}"]`).first().click(); } await espera(p, 900); };
const escrituras = (t, m) => b.escr.filter((w) => w.tabla === t && (!m || w.metodo === m)).map((w) => (Array.isArray(w.cuerpo) ? w.cuerpo[0] : w.cuerpo));

// ── 1. Pago manual de un período provisorio ──
await irA("vendedores");
await p.getByRole("button", { name: "+ Pago a vendedor" }).first().click(); await espera(p, 500);
const form = p.locator("[data-form-pago-vendedor]");
await form.locator("select").nth(0).selectOption("va");
await form.locator("select").nth(1).selectOption(String(m1.mes));
await form.locator('input[type="number"]').first().fill(String(m1.anio)); await espera(p, 200);
ok("aviso_provisoria_en_formulario", (await p.locator("[data-aviso-provisoria]").count()) === 1);
await p.locator("[data-monto-transferido]").fill("300000");
await p.locator("[data-revisar-pago]").click(); await espera(p, 300);
const conf = p.locator("[data-confirmar-pago]");
ok("pide_confirmacion_explicita", (await p.locator("[data-confirmar-provisoria]").count()) === 1 && await conf.isDisabled());
await conf.click({ force: true }).catch(() => {}); await conf.dispatchEvent("click").catch(() => {}); await espera(p, 600);
ok("sin_confirmar_no_registra", escrituras("pagos_vendedor", "POST").length === 0);
await p.locator('[data-confirmar-provisoria] input[type="checkbox"]').check(); await espera(p, 150);
ok("confirmado_habilita_registro", !(await conf.isDisabled()));
await conf.click(); await espera(p, 1500);
const pv = escrituras("pagos_vendedor", "POST");
ok("transferencia_real_se_registra", pv.length === 1 && pv[0].monto_transferido === 300000 && pv[0].mes === m1.mes && pv[0].anio === m1.anio, pv);
ok("nota_deja_constancia", /Pagado sobre comisión provisoria \(IVA sin registrar\): confirmado por el usuario/.test(pv[0]?.notas || ""), pv[0]?.notas);
ok("calculo_del_pago_sin_cambios", pv[0]?.monto_pagado === 300000 && pv[0]?.monto_extra_gestion === 0, pv[0]);

// ── 2. Total del F29 escrito a mano (desde agosto 2026) ──
await irA("vendedores");
const abrirIva = async () => { await p.getByRole("button", { name: /Registrar IVA de otro mes/ }).first().click(); await espera(p, 400);
  const dlg = p.locator("[role=dialog]").last();
  await dlg.locator("select").first().selectOption(String(m1.mes)); await dlg.locator('input[type="number"]').first().fill(String(m1.anio)); await espera(p, 200);
  const nums = dlg.locator('input[type="number"]');   // año, ventas netas, IVA débito, compras netas, IVA crédito, total F29
  await nums.nth(2).fill("50000"); await nums.nth(4).fill("10000"); await espera(p, 200); return { dlg, nums }; };
let { dlg, nums } = await abrirIva();
ok("total_no_se_precarga_con_el_iva", (await nums.nth(5).inputValue()) === "" && (await dlg.locator("[data-f29-sin-total]").count()) === 1);
await dlg.getByRole("button", { name: /Guardar IVA del mes/ }).click(); await espera(p, 1200);
let iv = escrituras("iva_mensual");
ok("sin_total_guarda_0_nunca_null", iv.length === 1 && iv[0].iva_pagado === 0 && iv[0].iva_ventas === 50000 && iv[0].iva_compras === 10000, iv);
ok("sin_total_no_crea_gasto", escrituras("gastos_indirectos").length === 0);
({ dlg, nums } = await abrirIva());
await nums.nth(5).fill("30000"); await espera(p, 150);
ok("avisa_total_menor_que_iva", (await dlg.locator("[data-f29-total-menor]").count()) === 1);
await nums.nth(5).fill("45000"); await espera(p, 150);
await dlg.getByRole("button", { name: /Guardar IVA del mes/ }).click(); await espera(p, 1200);
iv = escrituras("iva_mensual");
ok("total_escrito_se_guarda", iv.length === 2 && iv[1].iva_pagado === 45000, iv);
ok("sin_errores", errs.length === 0, errs);
await browser.close();
console.log(`\nRESUMEN e2e confirmaciones (pago provisorio y total del F29): ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
