// Formato numérico chileno en Cotizaciones (13/11/2026): escribir, PEGAR y editar, en escritorio y celular, con base SIMULADA.
// Uso: CHROME=… NODE_PATH=$PWD/node_modules node docs/pruebas-formato-cl/e2e_formato.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const clon = (x) => JSON.parse(JSON.stringify(x));
const env = (key, monto) => ({ key, proveedor: "Prov", monto, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "Simulación" });
const item = (key, q, precio, envio_key, recargo = null) => ({ key, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, recargo, ficha: { nombre: "Producto " + key, marca: "M", modelo: "X1" } });
// Cotización ya guardada (edición de una existente): montos correctos en la base, que al abrir no deben cambiar.
const base = { id: "c-f", version: 2, id_externo: "1234-6-COT26", nombre: "Prueba formato", institucion: "Municipio", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja",
  estado: "borrador", fecha: "2026-11-13", plazo: "5 DIAS", recargo: 0.3, presupuesto_estimado: 1250000, actualizado_en: "2026-11-13T12:00:00Z",
  envios: [env("e1", 5990)], items: [item("a", 3, 25990, "e1"), item("b", 2, 1250000.75, "e1", 0.45)] };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const espera = (p, ms = 350) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const ficha = (p) => p.locator("[data-editor-ficha]");
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 400));
const escribir = async (loc, t) => { await loc.click(); await loc.fill(""); await loc.pressSequentially(t, { delay: 15 }); };
// Pegado real: el texto va al portapapeles y se pega con el teclado (evento «paste» del navegador).
const pegar = async (p, loc, t) => { await loc.click(); await loc.fill(""); await p.evaluate((x) => navigator.clipboard.writeText(x), t); await p.keyboard.press("ControlOrMeta+V"); await espera(p, 150); };
const error = (loc) => loc.locator("xpath=..").locator("[data-error-numero]");

for (const [pref, ancho, movil] of [["E", 1280, false], ["M", 390, true]]) {
  const b = crearBase(crearDatos(), {});
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto: movil ? 844 : 900, movil, espera: 2500 });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(URL_APP).origin });
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route));
  M.cots.set("c-f", clon(base));
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
  await p.locator('[data-cotizacion="1234-6-COT26"]').click(); await espera(p, 1500);

  // ── Edición de una cotización existente: lo guardado se muestra en formato chileno y no cambia al abrir ──
  await tab(p, "datos");
  ok(`${pref}01_presupuesto_guardado_se_muestra_1.250.000`, (await H(p).locator('[data-campo="presupuesto"]').inputValue()) === "1.250.000");
  await tab(p, "productos");
  await H(p).locator("[data-editar-item]").nth(1).click(); await espera(p);
  const precio = ficha(p).locator('[data-campo="precio"]'), despacho = ficha(p).locator('[data-campo="monto-despacho"]'), cantidad = ficha(p).locator('[data-campo="cantidad"]');
  ok(`${pref}02_precio_guardado_1.250.000,75_y_despacho_5.990`, (await precio.inputValue()) === "1.250.000,75" && (await despacho.inputValue()) === "5.990" && (await cantidad.inputValue()) === "2",
    [await precio.inputValue(), await despacho.inputValue()]);
  await ficha(p).getByText("Cancelar", { exact: true }).click(); await espera(p);
  ok(`${pref}03_abrir_no_modifica_lo_guardado`, (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "bfk");

  // ── Ingreso manual: escribir ──
  await H(p).locator("[data-editar-item]").first().click(); await espera(p);
  await escribir(precio, "25.990,90"); await precio.blur(); await espera(p, 150);
  ok(`${pref}04_escrito_25.990,90_sin_error`, (await precio.inputValue()) === "25.990,90" && !(await error(precio).count()));
  await escribir(precio, "1250.50"); await precio.blur(); await espera(p, 150);
  ok(`${pref}05_1250.50_rechazado_con_mensaje`, (await error(precio).count()) === 1 && /coma: 1250,50/.test(await error(precio).innerText()) && (await precio.getAttribute("aria-invalid")) === "true");
  await ficha(p).locator("[data-guardar-ficha]").click(); await espera(p, 300);
  ok(`${pref}06_producto_no_se_guarda_con_formato_incorrecto`, (await ficha(p).count()) === 1 && /Corrige el formato de el precio de compra/.test(await ficha(p).innerText()));
  // ── Pegar desde una tienda (Falabella/Mercado Libre muestran «$ 1.250.000» o «$25.990») ──
  await pegar(p, precio, "$ 1.250.000");
  ok(`${pref}07_pegado_$_1.250.000_aceptado`, !(await error(precio).count()) && /1\.250\.000/.test(await precio.inputValue()), await precio.inputValue());
  await pegar(p, precio, "25.99");
  ok(`${pref}08_pegado_25.99_rechazado_al_instante`, (await error(precio).count()) === 1 && /25,99/.test(await error(precio).innerText()));
  await pegar(p, precio, "1.250.000,75"); await precio.blur();
  ok(`${pref}09_pegado_1.250.000,75`, (await precio.inputValue()) === "1.250.000,75" && !(await error(precio).count()));
  await pegar(p, despacho, "$7.990"); await despacho.blur();
  await escribir(cantidad, "1.000"); await cantidad.blur();
  ok(`${pref}10_despacho_7.990_y_cantidad_1.000`, (await despacho.inputValue()) === "7.990" && (await cantidad.inputValue()) === "1.000");
  await escribir(despacho, "7.990,5"); await despacho.blur();
  ok(`${pref}11_despacho_sin_decimales`, (await error(despacho).count()) === 1 && /pesos enteros/.test(await error(despacho).innerText()));
  await escribir(despacho, "7.990"); await despacho.blur();
  await ficha(p).locator("[data-guardar-ficha]").click(); await espera(p, 500);
  ok(`${pref}12_producto_guardado`, (await ficha(p).count()) === 0);

  // ── Precios: recargo en % (coma decimal) y bloqueo de guardar con un valor incorrecto ──
  await tab(p, "precios");
  const rec = H(p).locator('[data-campo="recargo-producto-2"]'), gen = H(p).locator('[data-campo="recargo"]');
  await escribir(gen, "32.5"); await gen.blur(); await espera(p, 200);
  ok(`${pref}13_recargo_32.5_rechazado`, (await error(gen).count()) === 1 && /32,5/.test(await error(gen).innerText()));
  ok(`${pref}14_productos_que_siguen_al_general_quedan_pendientes_no_en_0`, (await rec.inputValue()) === "" && /recargo tiene formato incorrecto/.test(await H(p).innerText()));
  const antes = clon(M.cots.get("c-f"));
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1000);
  ok(`${pref}15_cotizacion_no_se_guarda_con_formato_incorrecto`, JSON.stringify(M.cots.get("c-f")) === JSON.stringify(antes) && /corrige el formato de el recargo general/i.test(await p.locator("body").innerText()));
  await escribir(gen, "30"); await gen.blur(); await espera(p, 200);
  await escribir(rec, "32,5"); await rec.blur(); await espera(p, 200);
  ok(`${pref}16_recargo_32,5_aceptado`, (await rec.inputValue()) === "32,5" && !(await error(rec).count()) && !(await error(gen).count()));
  await tab(p, "datos");
  const pres = H(p).locator('[data-campo="presupuesto"]');
  await pegar(p, pres, "$6.000.000"); await pres.blur();
  ok(`${pref}17_presupuesto_pegado_6.000.000`, (await pres.inputValue()) === "6.000.000");
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1500);
  const g = M.cots.get("c-f");
  ok(`${pref}18_guardado_con_numeros_correctos`, Number(g.items[0].precio_origen) === 1250000.75 && Number(g.items[0].cantidad) === 1000 && Number(g.envios.find((e) => e.key === g.items[0].envio_key)?.monto) === 7990
    && Number(g.items[1].precio_origen) === 1250000.75 && Number(g.items[1].recargo) === 0.325 && Number(g.recargo) === 0.3 && Number(g.presupuesto_estimado) === 6000000,
    { i0: g.items[0], i1: g.items[1], recargo: g.recargo, pres: g.presupuesto_estimado, envios: g.envios });
  ok(`${pref}19_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN formato chileno en pantalla: ${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
