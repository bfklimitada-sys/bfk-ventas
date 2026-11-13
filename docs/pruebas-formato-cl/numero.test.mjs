// Formato numérico chileno en Cotizaciones (13/11/2026): lectura, presentación y cálculos.
// Uso: node docs/pruebas-formato-cl/numero.test.mjs
import { leerNumeroCL, formatoCL, fraccionAPorcentaje, porcentajeAFraccion, esInvalido } from "../../src/lib/numeroCL.js";
import { calcularCotizacion, camposNumericosInvalidos } from "../../src/lib/cotizaciones.js";
import { calcularCotizacionVP, validarItemsVP } from "../../src/lib/vpCotizacion.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };
const v = (t, o) => leerNumeroCL(t, o).valor;
const rechaza = (t, o) => leerNumeroCL(t, o).error != null && leerNumeroCL(t, o).valor == null;

// ── 1. Pruebas obligatorias ──
eq("25.990 → 25990", v("25.990"), 25990);
eq("1.250.000 → 1250000", v("1.250.000"), 1250000);
eq("1250,50 → 1250.50", v("1250,50"), 1250.5);
eq("25.990,90 → 25990.90", v("25.990,90"), 25990.9);
eq("1250.50 → rechazado por formato incorrecto", [rechaza("1250.50"), /coma: 1250,50/.test(leerNumeroCL("1250.50").error)], [true, true]);
eq("1.250.000,75 → 1250000.75", v("1.250.000,75"), 1250000.75);

// ── 2. Pegado desde tiendas (Mercado Libre, Falabella, Sodimac…) ──
eq("pegado «$25.990»", v("$25.990"), 25990);
eq("pegado «$ 1.250.000»", v("$ 1.250.000"), 1250000);
eq("pegado con espacio duro «$ 25.990»", v("$ 25.990"), 25990);
eq("pegado «CLP 9.990» y «9.990 CLP»", [v("CLP 9.990"), v("9.990 CLP")], [9990, 9990]);
eq("pegado con espacios alrededor «  25.990  »", v("  25.990  "), 25990);
eq("pegado con decimales «$25.990,90»", v("$25.990,90"), 25990.9);

// ── 3. Estructura validada (no se borran puntos «a ciegas») ──
for (const t of ["25.99", "1.25.000", "12.3456", "0.500", "1.2", "1250.5", ".990", "25.990.", "1,250,000", "1,2,3", "25 990", "12,345", "1250,", ",50", "abc", "25.990,9.0", "1e3"])
  eq(`rechaza «${t}»`, rechaza(t), true);
eq("vacío → sin valor y sin error", leerNumeroCL("   "), { valor: null, error: null });
eq("sin separadores «25990» y «0,5» válidos", [v("25990"), v("0,5")], [25990, 0.5]);
eq("1.250 es mil doscientos cincuenta (el punto nunca es decimal)", v("1.250"), 1250);
eq("negativo rechazado salvo que el campo lo permita", [rechaza("-5"), v("-5", { negativo: true }), v("-12,5", { negativo: true })], [true, -5, -12.5]);
eq("campo sin decimales (despacho): «5.990» sí, «5.990,5» no", [v("5.990", { decimales: 0 }), rechaza("5.990,5", { decimales: 0 })], [5990, true]);
eq("cantidad con 3 decimales: «12,5» y «1.000,125»", [v("12,5", { decimales: 3 }), v("1.000,125", { decimales: 3 }), rechaza("1,1234", { decimales: 3 })], [12.5, 1000.125, true]);
eq("porcentaje «32,5 %» y «32.5» (rechazado)", [v("32,5 %", { porcentaje: true }), rechaza("32.5", { porcentaje: true })], [32.5, true]);

// ── 4. Presentación y conservación (la base guarda el número; el formato es solo para mostrar) ──
eq("muestra 1250000.75 → 1.250.000,75", formatoCL(1250000.75), "1.250.000,75");
eq("muestra 25990 → 25.990 · 1250.5 → 1.250,5 · 0 → 0", [formatoCL(25990), formatoCL(1250.5), formatoCL(0)], ["25.990", "1.250,5", "0"]);
eq("muestra 999 → 999 · 1000 → 1.000 · -1500 → -1.500", [formatoCL(999), formatoCL(1000), formatoCL(-1500)], ["999", "1.000", "-1.500"]);
eq("ruido de coma flotante (0,1 + 0,2) se muestra 0,3", formatoCL(0.1 + 0.2), "0,3");
eq("un valor guardado con más decimales que el campo se muestra completo (no se redondea)", formatoCL(25.995, { decimales: 2 }), "25,995");
let ida = 0; const valores = [0, 1, 999, 1000, 25990, 25990.9, 1250000.75, 99999999.99, 0.5, 12.5, 100000000000];
for (const x of valores) if (leerNumeroCL(formatoCL(x)).valor === x) ida++;
eq(`ida y vuelta mostrar → leer sin cambios (${valores.length} valores)`, ida, valores.length);
eq("porcentaje: 0,325 ↔ 32,5 y 0,3255 ↔ 32,55 sin error de coma flotante", [fraccionAPorcentaje(0.325), porcentajeAFraccion(32.5), fraccionAPorcentaje(0.3255), porcentajeAFraccion(32.55)], [32.5, 0.325, 32.55, 0.3255]);
eq("esInvalido solo para NaN (no para vacío ni cero)", [esInvalido(NaN), esInvalido(""), esInvalido(null), esInvalido(0)], [true, false, false, false]);

// ── 5. Cálculos: lo ingresado en formato chileno da exactamente lo mismo que el número ──
const env = (key, monto) => ({ key, proveedor: "Prov", monto, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "Simulación" });
const item = (key, q, precio, envio_key, extra = {}) => ({ key, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, recargo: null, ficha: { nombre: "P" + key }, ...extra });
const cot = (precios, envio, recargo = 0.3) => ({ direccion_entrega: "Calle 1", comuna: "Laja", recargo, envios: [env("e1", envio)], items: [item("a", 3, precios[0], "e1"), item("b", 2, precios[1], "e1", { precio_incluye_iva: false })] });
const conNumeros = calcularCotizacion(cot([25990.9, 1250000.75], 5990, 0.325));
const desdeTexto = calcularCotizacion(cot([v("25.990,90"), v("1.250.000,75")], v("5.990", { decimales: 0 }), porcentajeAFraccion(v("32,5", { porcentaje: true }))));
eq("Mercado Público: costos, IVA crédito, unitarios, neto, IVA, total y utilidad idénticos", JSON.stringify(desdeTexto.totales) === JSON.stringify(conNumeros.totales) && JSON.stringify(desdeTexto.lineas) === JSON.stringify(conNumeros.lineas), true);
eq("Mercado Público: sin avisos con valores válidos", conNumeros.listo, true);
const vp = (it) => ({ direccion_entrega: "Calle 1", afecta_iva: true, envios: [{ ...env("e1", 5990), destino: "Calle 1" }], items: [{ key: "a", tipo: "producto", cantidad: 12.5, precio_origen: 2100.5, precio_incluye_iva: false, con_factura: true, envio_key: "e1", precio_unitario: 3200.75, descuento_pct: 5.5, ficha: { nombre: "Manguera" }, ...it }] });
const vpNum = calcularCotizacionVP(vp({}));
const vpTxt = calcularCotizacionVP(vp({ cantidad: v("12,5", { decimales: 3 }), precio_origen: v("2.100,50"), precio_unitario: v("3.200,75"), descuento_pct: v("5,5") }));
eq("Ventas privadas: costo unitario, neto, IVA, total y utilidad idénticos", JSON.stringify(vpTxt.totales) === JSON.stringify(vpNum.totales) && JSON.stringify(vpTxt.lineas) === JSON.stringify(vpNum.lineas), true);

// ── 6. Un valor con formato incorrecto nunca se calcula ni se guarda ──
const mal = calcularCotizacion({ ...cot([NaN, 45990], 5990), recargo: 0.3 });
eq("MP: precio con formato incorrecto → pendiente (no se calcula como 0) y no listo", [mal.listo, mal.lineas[0].avisos.some((a) => /formato incorrecto/.test(a))], [false, true]);
const malEnv = calcularCotizacion(cot([25990, 45990], NaN));
eq("MP: despacho con formato incorrecto → pendiente", [malEnv.listo, malEnv.lineas.every((l) => l.avisos.some((a) => /despacho .*formato incorrecto/.test(a)))], [false, true]);
const malRec = calcularCotizacion(cot([25990, 45990], 5990, NaN));
eq("MP: recargo general con formato incorrecto → pendiente en cada producto", [malRec.listo, malRec.lineas.every((l) => l.avisos.some((a) => /recargo tiene formato incorrecto/.test(a)))], [false, true]);
eq("MP: no se guarda (campos informados)", camposNumericosInvalidos({ ...cot([NaN, 45990], NaN, NaN), presupuesto_estimado: NaN }),
  ["el recargo general", "el presupuesto del comprador", "el precio de compra del producto 1", "el costo del despacho de Prov"]);
eq("MP: valores válidos → nada que corregir", camposNumericosInvalidos(cot([25990, 45990], 5990)), []);
const vpMal = calcularCotizacionVP(vp({ precio_unitario: NaN, descuento_pct: NaN }));
eq("VP: precio y descuento con formato incorrecto → aviso, totales sin NaN", [vpMal.listo, /formato incorrecto/.test(vpMal.lineas[0].avisos.join(" ")), Number.isFinite(vpMal.totales.total)], [false, true, true]);
eq("VP: no se guarda", /corrige el formato de el precio unitario de venta, el descuento/.test(validarItemsVP(vp({ precio_unitario: NaN, descuento_pct: NaN }).items).join(" ")), true);
eq("VP: valores válidos → sin errores de formato", validarItemsVP(vp({}).items), []);

// ── 7. Precisión: sumas de montos con decimales sin errores de coma flotante visibles ──
const lista = ["0,10", "0,20", "1.250.000,75", "25.990,90", "33,33", "33,33", "33,34"].map((t) => v(t));
eq("suma en centavos exacta (1.276.091,95)", Math.round(lista.reduce((s, x) => s + Math.round(x * 100), 0)) / 100, 1276091.95);

console.log(`RESUMEN formato numérico chileno (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
