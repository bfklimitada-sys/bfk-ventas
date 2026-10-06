// Pruebas de interfaz del cierre financiero (Panel). Base simulada de la Fase 4A; nada sale a la red.
// Uso: node docs/pruebas-cierre/e2e_panel.mjs http://127.0.0.1:4178/   (build servido con vite preview)
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, dias } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const pesos = (s) => (/[-−]/.test(String(s || "")) ? -1 : 1) * Number(String(s || "").replace(/[^0-9]/g, ""));

// Datos: caja = cobro oc8 1.270.000 − pagos fin 200.000 − 840.000 = 230.000. Banco 1.000.000 al corte (hace 10 días);
// después del corte solo el pago de 200.000 → esperado 800.000 → pendiente de conciliación −570.000.
const d = crearDatos();
d.saldo_banco.push({ id: "actual", saldo: 1000000, fecha_corte: dias(10) });
const b = crearBase(d);
const { page: p, errs } = await abrir(browser, b, { url: URL_APP, ancho: 1440, alto: 900, movil: false, espera: 3000 });
const n0 = b.escr.length;
await p.waitForSelector("[data-resumen-caja]", { timeout: 8000 }).catch(() => {});
const lineas = await p.$$eval("[data-resumen-caja] [data-linea]", (xs) => xs.map((x) => x.getAttribute("data-linea")));
ok("orden_de_conceptos", JSON.stringify(lineas) === JSON.stringify(["caja", "por_cobrar", "vale_vista", "deuda_fin", "comisiones", "f29"]), lineas);
const monto = async (k) => pesos(await p.locator(`[data-monto="${k}"]`).first().innerText());
ok("caja_230000", (await monto("caja")) === 230000, await monto("caja"));
ok("vale_vista_pendiente_500000", (await monto("vale_vista")) === 500000, await monto("vale_vista"));
ok("deuda_financiadores_2500000", (await monto("deuda_fin")) === 2500000, await monto("deuda_fin"));
const conc = await p.locator("[data-conciliacion]").innerText();
ok("conciliacion_pendiente_no_perdida", /Pendiente de conciliación bancaria/.test(conc) && /No es pérdida ni ganancia/.test(conc) && !/pérdida de|ganancia de/i.test(conc), conc);
ok("conciliacion_mismo_universo", /1\.000\.000/.test(conc) && /800\.000/.test(conc) && /230\.000/.test(conc) && /570\.000/.test(conc), conc);
ok("iva_pendiente_de_registrar_sin_monto", (await p.locator("[data-iva-sin-registrar]").count()) === 1 && /Sin el F29 real no se estima/.test(await p.locator("[data-iva-sin-registrar]").innerText()));
ok("proyectado_marcado_provisorio", (await p.locator("[data-proyectado-provisorio]").count()) === 1);
const proy = await monto("proyectado"), pc = await monto("por_cobrar"), com = await monto("comisiones"), f29 = await monto("f29");
ok("proyectado_cuadra", proy === 230000 + pc + 500000 - 2500000 - com - f29, { proy, pc, com, f29 });
ok("panel_no_escribe", b.escr.slice(n0).filter((w) => !["mp_cache_avisos", "mp_uso_diario"].includes(w.tabla)).length === 0, b.escr.slice(n0));
ok("sin_errores", errs.length === 0, errs);
await browser.close();
console.log(`\nRESUMEN e2e cierre financiero: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
