// Interfaz: estados de la comisión en Vendedores y Panel (base simulada; nada sale a la red; datos ficticios).
// Fechas relativas a hoy: mes en curso, mes anterior sin IVA (por liquidar) y mes anterior a ese con IVA y F29 (exigible).
// Uso: node docs/pruebas-comisiones/e2e_estados.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const pesos = (s) => (/[-−]/.test(String(s || "")) ? -1 : 1) * Number(String(s || "").replace(/[^0-9]/g, ""));
const $ = (n) => "$" + n.toLocaleString("es-CL");
const espera = (p, ms) => p.waitForTimeout(ms);
// Opcional: CAPTURAS=/carpeta guarda capturas de Vendedores y Panel para revisión visual.
const captura = async (p, nombre) => { if (process.env.CAPTURAS) await p.screenshot({ path: `${process.env.CAPTURAS}/${nombre}.png`, fullPage: true }); };

// Períodos relativos a hoy (hora de Chile, como el navegador de la prueba).
const hoyCL = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
const mesRel = (k) => { const d = new Date(hoyCL.getFullYear(), hoyCL.getMonth() - k, 5); return { anio: d.getFullYear(), mes: d.getMonth() + 1, fecha: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-05` }; };
const m0 = mesRel(0), m1 = mesRel(1), m2 = mesRel(2);
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];   // etiqueta del mes en la app: «Sep/2026»
const etiquetaMes = (per) => `${MESES[per.mes - 1]}/${per.anio}`;

const d = crearDatos();
d.vendedores.push({ id: "va", nombre: "Ana Prueba", comision_pct: 0 }, { id: "vb", nombre: "Bruno Prueba", comision_pct: 0 });
const venta = (id, vend, per, util) => {
  d.ordenes_compra_v2.push({ id, numero_oc: `${id}-1-AG26`, cliente: "Municipalidad Ficticia", tipo_registro: "venta", vendedor_id: vend, financiador_id: "f1",
    monto_total: 1000000 + util, costo_total: 1000000, monto_facturado: 1000000 + util, monto_cobrado: 0, monto_pagado_fin: 0, estado_factura_propia: "emitida",
    estado_compra: "comprado", estado_entrega: "confirmada", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", dias_pago: 30,
    fecha_emision_mp: per.fecha, creadoEn: per.fecha + "T10:00:00Z" });
  d.eventos_compra.push({ id: "ev" + id, oc_id: id, fecha: per.fecha, costo_compra: 1000000, financiador_id: "f1" });
  d.eventos_factura.push({ id: "fa" + id, oc_id: id, fecha: per.fecha, numero_factura: "9" + id.length + id.charCodeAt(id.length - 1), tipo_documento: "factura", monto: 1000000 + util });
};
// Ana: al día en m2 (pagado), m1 sin IVA (por liquidar), m0 en curso. Bruno: m2 definitivo e impago (exigible), m0 en curso.
venta("ocA2", "va", m2, 400000); venta("ocA1", "va", m1, 600000); venta("ocA0", "va", m0, 300000);
venta("ocB2", "vb", m2, 500000); venta("ocB0", "vb", m0, 100000);
// IVA y total del F29 del mes m2 registrados (IVA 100.000, PPM 20.000) → comisiones definitivas de m2.
d.iva_mensual.push({ id: "ivm2", anio: m2.anio, mes: m2.mes, iva_ventas: 100000, iva_compras: 0, iva_pagado: 120000 });
d.iva_mensual = d.iva_mensual.filter((i) => !(i.anio === m1.anio && i.mes === m1.mes) && !(i.anio === m0.anio && i.mes === m0.mes));
// Comisiones del mes m2 (si el mes es desde agosto 2026 se descuenta también el PPM).
const desc2 = (m2.anio * 12 + m2.mes >= 2026 * 12 + 8) ? 120000 : 100000;
const comA2 = Math.round((400000 - desc2) / 2), comB2 = Math.round((500000 - desc2) / 2), comA1 = 300000, comA0 = 150000, comB0 = 50000;
d.pagos_vendedor.push({ id: "pva2", vendedor_id: "va", anio: m2.anio, mes: m2.mes, monto_calculado: comA2, monto_pagado: comA2, monto_extra_gestion: 0, monto_transferido: comA2, fecha: m1.fecha, estado: "pagado" });
const b = crearBase(d);
const n0 = () => b.escr.length;

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 390, alto: 844, movil: true, espera: 2500 });
const inicioEscr = n0();
const irA = async (k) => { const nav = p.locator(`[data-nav="${k}"]`).first(); if (await nav.count()) await nav.click(); else { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 300); await p.locator(`[data-nav="${k}"]`).first().click(); } await espera(p, 900); };

// ── Vendedores ──
await irA("vendedores");
const tarjeta = (nombre) => p.locator("div").filter({ has: p.getByText(nombre, { exact: true }) }).filter({ has: p.locator("[data-pagar-vendedor]") }).last();
const ana = tarjeta("Ana Prueba"), bruno = tarjeta("Bruno Prueba");
await captura(p, "vendedores");
ok("ana_al_dia_sin_falta_pagarle", (await p.getByRole("button", { name: /Ana Prueba.*Al día/ }).count()) === 1 && (await p.locator('[data-vendedor-exigible="va"]').count()) === 0);
ok("ana_por_liquidar_separado", pesos(await p.locator('[data-vendedor-por-liquidar="va"]').innerText()) === comA1, await p.locator('[data-vendedor-por-liquidar="va"]').innerText().catch(() => ""));
ok("ana_en_curso_separado", pesos(await p.locator('[data-vendedor-en-curso="va"]').innerText()) === comA0, await p.locator('[data-vendedor-en-curso="va"]').innerText().catch(() => ""));
const btnAna = p.locator('[data-pagar-vendedor="va"]');
ok("ana_boton_pagar_deshabilitado", await btnAna.isDisabled() && (await btnAna.innerText()).includes(etiquetaMes(m1)) && /por liquidar/.test(await btnAna.innerText()), await btnAna.innerText());
ok("ana_motivo_visible", /provisoria/i.test(await p.locator('[data-motivo-no-pagable="va"]').innerText()));
await btnAna.dispatchEvent("click").catch(() => {}); await espera(p, 300);   // un clic directo sobre el botón deshabilitado no debe abrir el pago
ok("ana_click_no_abre_pago", (await p.locator("[data-form-pago-vendedor]").count()) === 0);
ok("bruno_falta_pagarle_solo_exigible", pesos(await p.locator('[data-vendedor-exigible="vb"]').innerText()) === comB2, await p.locator('[data-vendedor-exigible="vb"]').innerText().catch(() => ""));
ok("bruno_en_curso_aparte", pesos(await p.locator('[data-vendedor-en-curso="vb"]').innerText()) === comB0);
const btnBruno = p.locator('[data-pagar-vendedor="vb"]');
ok("bruno_boton_pagar_habilitado_mes_exigible", !(await btnBruno.isDisabled()) && (await btnBruno.innerText()).includes(etiquetaMes(m2)), await btnBruno.innerText());
// Detalle mes a mes de Ana: estados por mes y botones deshabilitados
await p.getByRole("button", { name: /Ana Prueba/ }).first().click(); await espera(p, 400);
await captura(p, "vendedores_detalle_ana");
const estadosAna = await p.locator("[data-estado-comision]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-estado-comision")));
ok("ana_estados_por_mes", JSON.stringify(estadosAna) === JSON.stringify(["en_curso", "por_liquidar", "pagada"]), estadosAna);
ok("ana_badge_provisoria_unificado", (await p.locator("[data-comision-provisoria]").count()) === 1 && /IVA sin registrar/.test(await p.locator("[data-comision-provisoria]").first().innerText()));
const kA1 = `va|${m1.anio}|${m1.mes}`, kA0 = `va|${m0.anio}|${m0.mes}`;
ok("ana_pagar_mes_deshabilitado", await p.locator(`[data-pagar-mes="${kA1}"]`).isDisabled() && await p.locator(`[data-pagar-mes="${kA0}"]`).isDisabled());
// Pago de Bruno: el botón abre el formulario con el monto exigible (no se confirma)
await btnBruno.click(); await espera(p, 500);
ok("bruno_formulario_con_monto_exigible", (await p.locator("[data-monto-transferido]").inputValue()) === String(comB2) && (await p.locator("[data-aviso-provisoria]").count()) === 0 && (await p.locator("[data-aviso-en-curso]").count()) === 0);
await p.keyboard.press("Escape"); await espera(p, 300);
const cerrar = p.locator("[role=dialog] button").filter({ hasText: /×|Cerrar|✕/ }).first(); if (await cerrar.count()) await cerrar.click().catch(() => {});
await espera(p, 300);

// ── Panel ──
await irA("panel"); await p.waitForSelector("[data-resumen-caja]", { timeout: 8000 }).catch(() => {});
await p.locator("[data-resumen-caja]").first().scrollIntoViewIfNeeded().catch(() => {}); await captura(p, "panel");
const lineas = await p.$$eval("[data-resumen-caja] [data-linea]", (xs) => xs.map((x) => x.getAttribute("data-linea")));
ok("panel_tres_lineas_de_comisiones", ["comisiones", "comisiones_por_liquidar", "comisiones_en_curso"].every((k) => lineas.includes(k)) && lineas.indexOf("comisiones_en_curso") === lineas.indexOf("comisiones") + 2, lineas);
const nota = async (k) => p.locator(`[data-linea="${k}"]`).first().innerText();
const MES3 = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const etq = (n, per, m) => `${n} ${MES3[per.mes - 1]}-${per.anio} ${$(m)}`;
ok("panel_exigible_solo_definitivas", (await nota("comisiones")).includes(etq("Bruno", m2, comB2)) && !/Ana/.test(await nota("comisiones")), await nota("comisiones"));
ok("panel_por_liquidar_separado", (await nota("comisiones_por_liquidar")).includes(etq("Ana", m1, comA1)) && /No es deuda exigible/.test(await nota("comisiones_por_liquidar")), await nota("comisiones_por_liquidar"));
ok("panel_en_curso_separado", (await nota("comisiones_en_curso")).includes(etq("Ana", m0, comA0)) && (await nota("comisiones_en_curso")).includes(etq("Bruno", m0, comB0)), await nota("comisiones_en_curso"));
const monto = async (k) => pesos(await p.locator(`[data-monto="${k}"]`).first().innerText());
const [proy, banco, pc, pf, vv, fin, c1, c2, c3, f29] = await Promise.all(["proyectado", "banco", "por_cobrar", "por_facturar", "vale_vista", "deuda_fin", "comisiones", "comisiones_por_liquidar", "comisiones_en_curso", "f29"].map(async (k) => (await p.locator(`[data-monto="${k}"]`).count()) ? monto(k) : 0));
const caja = (await p.locator('[data-monto="caja"]').count()) ? await monto("caja") : 0;
const ext = (await p.locator('[data-monto="externos"]').count()) ? await monto("externos") : 0;
ok("panel_proyectado_cuadra_con_las_tres_lineas", proy === (banco || caja) + pc + pf + vv - fin - c1 - c2 - c3 - f29 - ext, { proy, banco, caja, pc, pf, vv, fin, c1, c2, c3, f29, ext });
ok("ninguna_escritura", b.escr.slice(inicioEscr).filter((w) => !["mp_cache_avisos", "mp_uso_diario"].includes(w.tabla)).length === 0, b.escr.slice(inicioEscr));
ok("sin_errores", errs.length === 0, errs);
await browser.close();
console.log(`\nRESUMEN e2e estados de comisión: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
