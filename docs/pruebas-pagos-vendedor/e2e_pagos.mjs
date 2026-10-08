// Interfaz: pago a vendedor con extra por gestión (base simulada; nada sale a la red).
// Uso: node docs/pruebas-pagos-vendedor/e2e_pagos.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const pesos = (s) => Number(String(s || "").replace(/[^0-9]/g, ""));
const espera = (p, ms) => p.waitForTimeout(ms);

const d = crearDatos();
d.vendedores.push({ id: "vm", nombre: "Matías Vegas", comision_pct: 0 });
d.ordenes_compra_v2.push({ id: "ocm", numero_oc: "9001-1-AG26", cliente: "Municipalidad Prueba", tipo_registro: "venta", vendedor_id: "vm", financiador_id: "f1",
  monto_total: 2000000, costo_total: 944266, monto_facturado: 2000000, monto_cobrado: 0, monto_pagado_fin: 0, estado_factura_propia: "emitida",
  estado_compra: "comprado", estado_entrega: "confirmada", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", dias_pago: 30,
  fecha_emision_mp: "2026-08-01", creadoEn: "2026-08-01T10:00:00Z" });
d.eventos_compra.push({ id: "evcm", oc_id: "ocm", fecha: "2026-08-02", costo_compra: 944266, financiador_id: "f1" });
d.eventos_factura.push({ id: "fam", oc_id: "ocm", fecha: "2026-08-10", numero_factura: "9300", tipo_documento: "factura", monto: 2000000 });
d.iva_mensual.push({ id: "iva8", anio: 2026, mes: 8, iva_ventas: 0, iva_compras: 0, iva_pagado: 0 });
const b = crearBase(d);
// Llave primaria simulada: un segundo POST con el mismo id se rechaza como lo haría la base.
const escribirOrig = b.escribir;
b.escribir = (m, t, params, cuerpo) => {
  if (m === "POST" && t === "pagos_vendedor") { const f = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo; if (b.db?.pagos_vendedor?.some?.((x) => x.id === f.id) || vistos.has(f.id)) return { status: 409, json: { message: 'duplicate key value violates unique constraint "pagos_vendedor_pkey"' } }; vistos.add(f.id); }
  return escribirOrig(m, t, params, cuerpo);
};
const vistos = new Set();

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 2500 });
const irA = async (k) => { const nav = p.locator(`[data-nav="${k}"]`).first(); if (await nav.count()) await nav.click(); else { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 300); await p.locator(`[data-nav="${k}"]`).first().click(); } await espera(p, 900); };
await irA("vendedores");
const tarjetaM = () => p.locator("div").filter({ has: p.getByText("Matías Vegas", { exact: true }) }).filter({ has: p.getByRole("button", { name: /Pagar/ }) }).last();
const boton = tarjetaM().getByRole("button", { name: /Pagar Ago\/2026|Pagar Agosto/i }).first();
ok("boton_pagar_agosto", (await boton.count()) === 1, await p.locator("body").innerText().then((t) => t.slice(0, 300)));
await boton.click(); await espera(p, 500);
const val = async (k) => pesos(await p.locator(`[data-desglose="${k}"]`).first().innerText());
ok("muestra_comision_pagada_pendiente", (await val("comision")) === 527867 && (await val("pagada")) === 0 && (await val("pendiente")) === 527867, [await val("comision"), await val("pagada"), await val("pendiente")]);
ok("monto_sugerido_es_el_pendiente", (await p.locator("[data-monto-transferido]").inputValue()) === "527867");
await p.locator("[data-monto-transferido]").fill("550000"); await espera(p, 150);
ok("desglose_inmediato_550000", (await val("pago_comision")) === 527867 && (await val("extra_gestion")) === 22133 && (await val("pendiente_despues")) === 0, [await val("pago_comision"), await val("extra_gestion")]);
await p.locator("[data-monto-transferido]").fill("300000"); await espera(p, 150);
ok("desglose_parcial_300000", (await val("pago_comision")) === 300000 && (await val("extra_gestion")) === 0 && (await val("pendiente_despues")) === 227867);
await p.locator("[data-monto-transferido]").fill("550000");
await p.locator('input[placeholder="Opcional"]').first().fill("TEF 12345");
await p.locator("[data-revisar-pago]").click(); await espera(p, 200);
const vista = await p.locator("[data-vista-previa]").innerText();
ok("vista_previa_antes_de_confirmar", /550\.000/.test(vista) && /527\.867/.test(vista) && /22\.133/.test(vista) && b.escr.filter((w) => w.tabla === "pagos_vendedor").length === 0, vista);
// Doble toque en confirmar: un solo pago
const conf = p.locator("[data-confirmar-pago]");
await conf.dblclick().catch(() => {}); await espera(p, 1500);
const filas = b.escr.filter((w) => w.metodo === "POST" && w.tabla === "pagos_vendedor").map((w) => Array.isArray(w.cuerpo) ? w.cuerpo[0] : w.cuerpo);
const unica = [...new Set(filas.map((f) => f.id))];
ok("un_solo_pago_aunque_se_toque_dos_veces", unica.length === 1, filas.map((f) => f.id));
const f0 = filas[0] || {};
ok("fila_guardada_con_dos_componentes", f0.monto_transferido === 550000 && f0.monto_pagado === 527867 && f0.monto_extra_gestion === 22133 && f0.referencia_bancaria === "TEF 12345" && f0.mes === 8 && f0.anio === 2026, f0);
ok("oc_del_periodo_marcada_pagada", b.escr.some((w) => w.metodo === "PATCH" && w.tabla === "ordenes_compra_v2" && w.id === "ocm" && w.cuerpo?.vendedor_pagado === true));
ok("no_toca_compras_facturas_cobros_financiamiento", !b.escr.some((w) => ["eventos_compra", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "financiadores"].includes(w.tabla)));
// Detalle del mes
await p.getByRole("button", { name: /Matías Vegas/ }).first().click(); await espera(p, 400);
const extra = await p.locator("[data-extra-gestion]").first().innerText().catch(() => "");
ok("vendedores_muestra_extra_aparte", /22\.133/.test(extra) && /550\.000/.test(extra), extra);
ok("comision_agosto_saldada", (await p.getByRole("button", { name: /Matías Vegas.*Al día/ }).count()) === 1);
// Anulación (administrador)
await p.locator("[data-anular-pago]").first().click(); await espera(p, 300);
await p.locator("[data-confirmar-anulacion]").click(); await espera(p, 200);
ok("anular_exige_motivo", /Indica el motivo/.test(await p.locator("[role=dialog]").last().innerText()));
await p.locator("[data-motivo-anulacion]").fill("Prueba de anulación"); await p.locator("[data-confirmar-anulacion]").click(); await espera(p, 1200);
const an = b.escr.find((w) => w.metodo === "PATCH" && w.tabla === "pagos_vendedor");
ok("anulacion_es_actualizacion_no_borrado", !!an && an.cuerpo.motivo_anulacion === "Prueba de anulación" && !!an.cuerpo.anulado_en && !b.escr.some((w) => w.metodo === "DELETE" && w.tabla === "pagos_vendedor"), an);
ok("anulacion_vuelve_oc_a_pendiente", b.escr.some((w) => w.metodo === "PATCH" && w.tabla === "ordenes_compra_v2" && w.id === "ocm" && w.cuerpo?.vendedor_pagado === false));
ok("tras_anular_agosto_vuelve_a_pendiente", (await tarjetaM().getByRole("button", { name: /Pagar Ago\/2026|Pagar Agosto/i }).count()) >= 1);
ok("sin_errores", errs.length === 0, errs);
await browser.close();
console.log(`\nRESUMEN e2e pagos a vendedores: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
