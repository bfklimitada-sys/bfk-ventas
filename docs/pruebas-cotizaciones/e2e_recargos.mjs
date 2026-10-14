// Recargos controlados solo desde Precios (14/10/2026): unitarias del cálculo + interfaz con base SIMULADA.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_recargos.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "./modulo_simulado.mjs";
import { calcularCotizacion, aplicarRecargoGeneral, aplicarRecargoProducto } from "../../src/lib/cotizaciones.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const clon = (x) => JSON.parse(JSON.stringify(x));
const env = (key, monto) => ({ key, proveedor: "Prov", monto, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "Simulación" });
const item = (key, q, precio, envio_key, recargo = null) => ({ key, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, recargo, ficha: { nombre: "Producto " + key, marca: "M", modelo: "X1" } });
const base = { id: "c-r", version: 2, id_externo: "1234-5-COT26", nombre: "Prueba recargos", institucion: "Municipio", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja", estado: "borrador", fecha: "2026-10-14", plazo: "5 DIAS", recargo: 0.3, actualizado_en: "2026-10-14",
  envios: [env("e1", 5990), env("e2", 0)], items: [item("a", 3, 82865, "e1"), item("b", 2, 45990, "e2", 0.45)] };

// ── Unitarias ──
{
  const c0 = calcularCotizacion(clon(base));
  ok("U1_cada_producto_usa_solo_su_porcentaje", c0.lineas[0].recargo === 0.3 && c0.lineas[1].recargo === 0.45);
  const c1 = calcularCotizacion(aplicarRecargoGeneral(clon(base), 0.35));
  ok("U2_general_se_aplica_a_todos_incluido_el_ajustado", c1.lineas.every((l) => l.recargo === 0.35));
  ok("U3_costos_y_despachos_sin_cambios", c1.lineas.every((l, i) => l.costo_bruto === c0.lineas[i].costo_bruto && l.envio_asignado === c0.lineas[i].envio_asignado));
  const sinRecargo = calcularCotizacion(aplicarRecargoGeneral(clon(base), 0));
  const r2 = aplicarRecargoProducto(aplicarRecargoGeneral(clon(base), 0.35), "b", 0.2);
  const c2 = calcularCotizacion(r2);
  ok("U4_ajuste_individual_no_afecta_a_otros", c2.lineas[0].recargo === 0.35 && c2.lineas[1].recargo === 0.2 && c2.lineas[0].unitario_neto === c1.lineas[0].unitario_neto);
  // Nunca se suman: el unitario con 20% es el de 20% (no 35% + 20%).
  const solo20 = calcularCotizacion(aplicarRecargoGeneral(clon(base), 0.2));
  ok("U5_nunca_suma_dos_recargos", c2.lineas[1].unitario_neto === solo20.lineas[1].unitario_neto && c2.lineas[1].unitario_neto < calcularCotizacion(aplicarRecargoGeneral(clon(base), 0.55)).lineas[1].unitario_neto);
  ok("U6_igual_al_general_vuelve_a_general", aplicarRecargoProducto(clon(base), "b", 0.3).items[1].recargo === null && aplicarRecargoProducto(clon(base), "b", "").items[1].recargo === null);
  ok("U7_sin_recargo_vende_a_costo_neto", sinRecargo.lineas.every((l) => l.unitario_neto * l.cantidad >= l.costo_neto - l.cantidad));
}

// ── Interfaz ──
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const dinero = async (loc) => Number((await loc.innerText()).replace(/[^\d-]/g, ""));
const leer = async (p) => ({
  u1: await dinero(H(p).locator('[data-unitario="1"]')), u2: await dinero(H(p).locator('[data-unitario="2"]')),
  s1: await dinero(H(p).locator('[data-subtotal="1"]')), s2: await dinero(H(p).locator('[data-subtotal="2"]')),
  neto: await dinero(H(p).locator('[data-fila="neto"] > *').last()), total: await dinero(H(p).locator('[data-fila="total"] > *').last()),
  gan: await dinero(H(p).locator('[data-fila="utilidad"] > *').last()), costo: await dinero(H(p).locator('[data-fila="costo-adquisicion"] > *').last()),
  r1: await H(p).locator('[data-campo="recargo-producto-1"]').inputValue(), r2: await H(p).locator('[data-campo="recargo-producto-2"]').inputValue() });
const esperado = (cot) => { const c = calcularCotizacion(cot); return { u1: c.lineas[0].unitario_neto, u2: c.lineas[1].unitario_neto, neto: Math.round(c.totales.neto), total: Math.round(c.totales.total), gan: Math.round(c.totales.utilidad_neta) }; };
const coincide = (v, e) => v.u1 === e.u1 && v.u2 === e.u2 && v.neto === e.neto && v.total === e.total && Math.abs(v.gan - e.gan) <= 1 && v.s1 === e.u1 * 3 && v.s2 === e.u2 * 2;

for (const [pref, ancho, movil] of [["E", 1280, false], ["M", 390, true]]) {
  const b = crearBase(crearDatos(), {});
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto: movil ? 844 : 900, movil, espera: 2500 });
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route));
  M.cots.set("c-r", clon(base));
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
  await p.locator('[data-cotizacion="1234-5-COT26"]').click(); await espera(p, 1500);
  // Ventana del producto: ya no tiene recargo.
  await H(p).locator("[data-editar-item]").first().click(); await espera(p);
  ok(`${pref}01_ventana_producto_sin_recargo`, !(await p.locator('[data-editor-ficha] [data-campo="recargo-item"]').count()) && !/Recargo comercial/i.test(await p.locator("[data-editor-ficha]").innerText()));
  await p.locator("[data-editor-ficha]").getByText("Cancelar", { exact: true }).click(); await espera(p);
  await H(p).locator('[role="tab"][data-tab="precios"]').click(); await espera(p, 500);
  // Al abrir: porcentajes efectivos existentes conservados, sin cambios silenciosos.
  let v = await leer(p);
  ok(`${pref}02_conserva_porcentajes_existentes_al_abrir`, v.r1 === "30" && v.r2 === "45" && coincide(v, esperado(clon(base))) && (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "bfk", v);
  const costo0 = v.costo;
  // Recargo general → todos los productos (incluido el que tenía 45%), en tiempo real.
  await H(p).locator('[data-campo="recargo"]').fill("35"); await espera(p, 300);
  v = await leer(p);
  ok(`${pref}03_general_actualiza_todos_en_tiempo_real`, v.r1 === "35" && v.r2 === "35" && coincide(v, esperado(aplicarRecargoGeneral(clon(base), 0.35))), v);
  ok(`${pref}04_costo_compra_y_despacho_sin_cambios`, v.costo === costo0);
  // Ajuste individual del producto 2 sin afectar al 1 (con decimales).
  await H(p).locator('[data-campo="recargo-producto-2"]').fill("22,5"); await espera(p, 300);
  v = await leer(p);
  const e2 = esperado(aplicarRecargoProducto(aplicarRecargoGeneral(clon(base), 0.35), "b", 0.225));
  ok(`${pref}05_ajuste_individual_solo_ese_producto`, v.r1 === "35" && coincide(v, e2) && /Ajustado/.test(await H(p).locator('[data-recargo-producto="2"]').innerText()), { v, e2 });
  // Nuevo cambio general: vuelve a aplicarse a todos.
  await H(p).locator('[data-campo="recargo"]').fill("28"); await espera(p, 300);
  v = await leer(p);
  ok(`${pref}06_nuevo_general_reemplaza_ajuste`, v.r1 === "28" && v.r2 === "28" && coincide(v, esperado(aplicarRecargoGeneral(clon(base), 0.28))), v);
  // Guardar: lo guardado usa exactamente esos porcentajes.
  await H(p).locator('[data-campo="recargo-producto-1"]').fill("40"); await espera(p, 300);
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1200);
  const g = M.cots.get("c-r");
  ok(`${pref}07_guardado_con_porcentajes_efectivos`, Number(g.recargo) === 0.28 && Number(g.items[0].recargo) === 0.4 && g.items[1].recargo == null && g.items[0].precio_origen == 82865 && g.envios[0].monto == 5990);
  ok(`${pref}08_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
