// Interfaz: enlace «Registrar IVA de <mes>» del detalle de comisiones (Vendedores) → Finanzas · Impuestos.
// Antes lanzaba ReferenceError (setEditandoIvaExistente no existe en PanelVendedores). Ahora navega a Impuestos con la
// navegación de BFK y abre el formulario ÚNICO de IVA (FormIvaMensual) con el mes y año del período, sin guardar nada.
// Base simulada; nada sale a la red; datos ficticios. Escritorio y celular.
// Uso: node docs/pruebas-enlace-iva/e2e_enlace_iva.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms) => p.waitForTimeout(ms);
const hoyCL = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
const m0 = { anio: hoyCL.getFullYear(), mes: hoyCL.getMonth() + 1, fecha: `${hoyCL.getFullYear()}-${String(hoyCL.getMonth() + 1).padStart(2, "0")}-05` };

const d = crearDatos();
d.ordenes_compra_v2.forEach((o) => { o.vendedor_id = null; });
d.vendedores.push({ id: "va", nombre: "Ana Prueba", comision_pct: 0 });
d.ordenes_compra_v2.push({ id: "ocIV", numero_oc: "ocIV-1-AG26", cliente: "Municipalidad Ficticia", tipo_registro: "venta", vendedor_id: "va", financiador_id: "f1",
  monto_total: 1500000, costo_total: 1000000, monto_facturado: 1500000, monto_cobrado: 0, monto_pagado_fin: 0, estado_factura_propia: "emitida",
  estado_compra: "comprado", estado_entrega: "confirmada", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", dias_pago: 30,
  fecha_emision_mp: m0.fecha, creadoEn: m0.fecha + "T10:00:00Z" });
d.eventos_compra.push({ id: "evIV", oc_id: "ocIV", fecha: m0.fecha, costo_compra: 1000000, financiador_id: "f1" });
d.eventos_factura.push({ id: "faIV", oc_id: "ocIV", fecha: m0.fecha, numero_factura: "9901", tipo_documento: "factura", monto: 1500000 });
// El mes en curso SIN IVA registrado: es el caso en que aparece el enlace.
d.iva_mensual = d.iva_mensual.filter((i) => !(i.anio === m0.anio && i.mes === m0.mes));
const b = crearBase(d);
const ivaAntes = JSON.stringify(b.db?.iva_mensual ?? null);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [ancho, alto, movil] of [[1366, 900, false], [390, 844, true]]) {
  const s = movil ? "movil" : "escritorio";
  const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  const inicioEscr = b.escr.length;
  const irA = async (k) => { if (["finanzas","financiamiento","vendedores","gastos","impuestos","banco"].includes(k) && !(await p.locator(`[data-tab="${k}"]`).count())) { await p.locator('[data-nav="finanzas"]').first().click(); await espera(p, 500); } const nav = p.locator(`[data-nav="${k}"]`).first(); if (await nav.count()) await nav.click(); else { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 300); await p.locator(`[data-nav="${k}"]`).first().click(); } await espera(p, 900); };
  await irA("vendedores");
  await p.getByRole("button", { name: /Ana Prueba/ }).first().click(); await espera(p, 500);
  const enlace = p.locator(`[data-ir-iva-periodo="${m0.anio}-${m0.mes}"]`).first();
  ok(`${s}_enlace_visible`, (await enlace.count()) === 1);
  await enlace.scrollIntoViewIfNeeded().catch(() => {});
  await enlace.click(); await espera(p, 900);
  ok(`${s}_navega_a_impuestos`, /#\/impuestos/.test(p.url()), p.url());
  ok(`${s}_pestana_iva_mensual`, (await p.locator('[data-tab="impuestos"]').count()) > 0 || /Impuestos/.test(await p.title()), await p.title());
  const dlg = p.locator("[role=dialog]").first();
  ok(`${s}_abre_formulario_unico_de_iva`, (await dlg.count()) === 1 && /IVA mensual/.test(await dlg.innerText().catch(() => "")));
  ok(`${s}_un_solo_formulario`, (await p.locator("[role=dialog]").count()) === 1);
  const mesSel = await dlg.locator("select").first().inputValue().catch(() => null);
  const anioIn = await dlg.locator('input[type="number"]').first().inputValue().catch(() => null);
  ok(`${s}_mes_preseleccionado`, Number(mesSel) === m0.mes, mesSel);
  ok(`${s}_anio_preseleccionado`, Number(anioIn) === m0.anio, anioIn);
  // Cerrar sin guardar: no se escribe nada. Volver a Impuestos por el menú normal no reabre el formulario.
  await p.keyboard.press("Escape"); await espera(p, 300);
  const cerrar = p.locator("[role=dialog] button").filter({ hasText: /×|Cerrar|✕/ }).first(); if (await cerrar.count()) await cerrar.click().catch(() => {});
  await espera(p, 300);
  ok(`${s}_formulario_cerrado`, (await p.locator("[role=dialog]").count()) === 0);
  await irA("vendedores"); await irA("impuestos"); await espera(p, 600);
  ok(`${s}_ir_a_impuestos_normal_no_reabre`, (await p.locator("[role=dialog]").count()) === 0);
  // «Ir a Impuestos» general de Vendedores sigue funcionando (sin período).
  await irA("vendedores");
  await p.locator('[data-aviso="ir-impuestos"], [data-dato="ir-impuestos"], [data-aviso-linea="ir-impuestos"]').first().click().catch(async () => { await p.getByText("Ir a Impuestos").first().click(); });
  await espera(p, 800);
  ok(`${s}_ir_a_impuestos_general`, /#\/impuestos/.test(p.url()) && (await p.locator("[role=dialog]").count()) === 0, p.url());
  ok(`${s}_ninguna_escritura`, b.escr.slice(inicioEscr).filter((w) => !["mp_cache_avisos", "mp_uso_diario"].includes(w.tabla)).length === 0, b.escr.slice(inicioEscr));
  ok(`${s}_sin_errores`, errs.length === 0, errs);
  await p.close();
}
await browser.close();
console.log(`\nRESUMEN e2e enlace Registrar IVA → Impuestos: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
