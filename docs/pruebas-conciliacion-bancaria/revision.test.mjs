// Cartolas que no cuadran → «Solo revisión» (22/10/2026). Datos 100 % ficticios (réplica del caso real: el saldo del
// resumen es $910.000 menor que el saldo del último movimiento). Funciones puras: nada se escribe.
import * as XLSX from "xlsx";
import { leerCartolaBancoEstado, unirCartolas } from "../../src/lib/cartolas.js";
import { CIERRE_CONCILIACION, conciliarMovimientos, marcaCartola } from "../../src/lib/conciliacion.js";
import { verificarRegistro } from "../../src/lib/registroCartola.js";
import { cartolaEnLinea, cartolaHistorica, idaYVuelta } from "./cartolas_sinteticas.mjs";

const F = []; let n = 0;
const eq = (k, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) { F.push(k); console.log("FALLA " + k + " :: " + String(JSON.stringify(a)).slice(0, 500) + " ≠ " + String(JSON.stringify(b)).slice(0, 300)); } else { n++; console.log("OK    " + k); } };

// Cambia un valor del Resumen (columna E) como lo haría el banco al informar otro saldo o total.
export function conResumen(wb, clave, valor) {
  const ws = wb.Sheets.Resumen; const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  for (const f of filas) if (String(f[0]).trim() === clave) f[4] = valor;
  wb.Sheets.Resumen = XLSX.utils.aoa_to_sheet(filas); return wb;
}
const leer = (wb, nombre) => leerCartolaBancoEstado(idaYVuelta(wb), nombre);
const HIST = [
  { fecha: "2026-09-26", op: "7000005", desc: "TEF A PROVEEDOR ANTIGUO", cargo: 77000 },
  { fecha: "2026-10-01", op: "7000006", desc: "TEF DE CLIENTE ANTIGUO", abono: 50000 },
];
const LINEA = [
  { fecha: "2026-10-12", op: "8811", desc: "TEF A EJEMPLO SOTO LUIS", cargo: 480000 },
  { fecha: "2026-10-14", op: "8813", desc: "TEF A PROVEEDOR UNO", cargo: 250000 },
  { fecha: "2026-10-16", op: "8815", desc: "TEF DE 70000000-1 UNIVERSIDAD FICTICIA", abono: 800799 },
  { fecha: "2026-10-17", op: "8817", desc: "TEF A DESCONOCIDO", cargo: 33333 },
  { fecha: "2026-10-20", op: "8819", desc: "DEPOSITO CON DOCUMENTOS", abono: 910005 },
  { fecha: "2026-10-21", op: "0", desc: "OTROS ABONOS", abono: 183302 },
];
const hist = leer(cartolaHistorica(HIST, { saldoInicial: 3000000, numero: 9, desde: "2026-09-25", hasta: "2026-10-01" }), "historica.xlsx");
const S0 = 3000000 - 77000 + 50000;
const SF = LINEA.reduce((s, m) => s + (m.abono || 0) - (m.cargo || 0), S0);
const lineaOK = leer(cartolaEnLinea(LINEA, { saldoInicial: S0 }), "linea_corregida.xlsx");
// Caso real (réplica): el saldo contable del resumen es $910.000 menor que el del último movimiento.
const pesosL = (v) => "$ " + v.toLocaleString("es-CL");
const lineaMal = leer(conResumen(cartolaEnLinea(LINEA, { saldoInicial: S0 }), "Saldo Contable", pesosL(SF - 910000)), "linea_no_cuadra.xlsx");

eq("base: histórica y en línea corregida cuadran", [hist.errores, lineaOK.errores, hist.soloRevision, lineaOK.soloRevision], [[], [], false, false]);

// 1. Saldo del resumen inconsistente ($910.000): solo revisión, con sus movimientos para consultar y un diagnóstico simple.
eq("01 diferencia de $910.000 → Solo revisión (no se usa para conciliar)", [lineaMal.soloRevision, lineaMal.movs.length, lineaMal.movsRevision.length, lineaMal.errores.length > 0], [true, 0, LINEA.length, true]);
const dSF = lineaMal.diagnostico.find((d) => d.tipo === "saldo_final");
eq("01 diagnóstico: saldo del resumen vs último movimiento y la diferencia exacta", [dSF?.diferencia, dSF?.saldoResumen, dSF?.saldoMovimientos], [-910000, SF - 910000, SF]);
eq("01 mensaje simple con la diferencia, sin suponer qué operaciones la explican", /Diferencia: \$910\.000/.test(dSF?.texto) && /descarga la cartola de nuevo/.test(dSF?.texto) && !/op\.|operación \d|Matías|710\.000|200\.000/.test(dSF?.texto), true);
eq("01 se pueden consultar fecha, monto y N° de operación", lineaMal.movsRevision.map((m) => [m.fecha, m.operacion, m.cargo || m.abono]).slice(0, 2), [["2026-10-12", "8811", 480000], ["2026-10-14", "8813", 250000]]);

// 2. Movimiento omitido dentro del archivo: el saldo salta; se ubica dónde y por cuánto.
const sinUno = LINEA.filter((m) => m.op !== "8813");
const wbOm = cartolaEnLinea(LINEA, { saldoInicial: S0 });
{ const ws = wbOm.Sheets.Registros; const filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }).filter((f) => !String(f[2]).endsWith("8813")); wbOm.Sheets.Registros = XLSX.utils.aoa_to_sheet(filas); }
const omit = leer(wbOm, "omitido.xlsx");
const saltos = omit.diagnostico.filter((d) => d.tipo === "salto");
eq("02 movimiento omitido → Solo revisión, un salto de −$250.000 antes del movimiento siguiente", [omit.soloRevision, saltos.length, saltos[0]?.diferencia, saltos[0]?.fecha, omit.movsRevision.length], [true, 1, -250000, "2026-10-16", sinUno.length]);
eq("02 el saldo final sí calza tras el salto (no se inventan más diferencias)", omit.diagnostico.some((d) => d.tipo === "saldo_final"), false);

// 3. Totales del resumen que no calzan con las filas (en línea).
const tot = leer(conResumen(cartolaEnLinea(LINEA, { saldoInicial: S0 }), "Total Abonos", pesosL(1)), "totales.xlsx");
eq("03 totales del resumen distintos → Solo revisión con el detalle", [tot.soloRevision, tot.diagnostico.map((d) => d.tipo)], [true, ["totales"]]);
// 4. Histórica: cantidad declarada distinta.
const cant = leer(cartolaHistorica(HIST, { saldoInicial: 3000000, numero: 9, desde: "2026-09-25", hasta: "2026-10-01", nDeclarados: 5 }), "cantidad.xlsx");
eq("04 histórica con cantidad declarada distinta → Solo revisión", [cant.soloRevision, cant.diagnostico.some((d) => d.tipo === "cantidad" && /informa 5 movimientos y el archivo trae 2/.test(d.texto))], [true, true]);
// 5. Archivo que no se puede leer: rechazado, sin nada para revisar.
const rota = leerCartolaBancoEstado(idaYVuelta(cartolaHistorica(HIST, { saldoInicial: 3000000, sinColumna: "Saldo" })), "sin_columna.xlsx");
eq("05 archivo ilegible (falta una columna) → rechazado, sin movimientos para revisar", [rota.soloRevision, rota.movsRevision.length, rota.errores.length > 0], [false, 0, true]);

// 6. Correctos e incorrectos juntos: se separan; la conciliación usa solo los que cuadran.
const datos = { ocs: [], financiadores: [{ id: "f1", nombre: "Ana Ficticia Rojas", tipo: "externo" }], vendedores: [{ id: "v1", nombre: "Luis Ejemplo Soto" }], gastos: [], pagosVendedor: [], pagoFinSueltos: [], aportes: [], decisiones: [] };
const Um = unirCartolas([hist, lineaMal]);
eq("06 mezcla: solo la histórica entra; la en línea queda en solo revisión", [Um.movs.length, Um.soloRevision.map((c) => c.nombre), Um.rechazadas.map((r) => [r.nombre, r.soloRevision])], [HIST.length, ["linea_no_cuadra.xlsx"], [["linea_no_cuadra.xlsx", true]]]);
const Cm = conciliarMovimientos(Um.movs, datos), Ch = conciliarMovimientos(unirCartolas([hist]).movs, datos);
eq("06 sin contaminación: la conciliación es idéntica a cargar solo la cartola válida", JSON.stringify(Cm.movimientos.map((x) => [x.marca, x.estado, x.registrable])), JSON.stringify(Ch.movimientos.map((x) => [x.marca, x.estado, x.registrable])));
eq("06 ninguna marca de cartola sale de la cartola que no cuadra", Cm.movimientos.some((x) => x.m.fecha >= "2026-10-12"), false);
eq("06 nada registrable con la cartola que no cuadra (todo lo válido es anterior al cierre)", Cm.movimientos.filter((x) => x.registrable).length, 0);

// 7. Superpuestos: la buena y la que no cuadra del mismo período → solo la buena, mismas marcas que sola.
const Us = unirCartolas([lineaMal, hist, lineaOK]);
eq("07 superpuestas: se usa la que cuadra; mismas marcas que cargándola sola", Us.movs.map((_, i) => marcaCartola(Us.movs, i)), unirCartolas([hist, lineaOK]).movs.map((_, i) => marcaCartola(unirCartolas([hist, lineaOK]).movs, i)));

// 8. Corrección posterior: al cargar la cartola corregida se vuelve a validar todo y se habilita lo que corresponde.
const antes = conciliarMovimientos(unirCartolas([hist, lineaMal]).movs, datos);
const despues = conciliarMovimientos(unirCartolas([hist, lineaMal, lineaOK]).movs, datos);
const reg = despues.movimientos.filter((x) => x.registrable).map((x) => x.m.operacion);
eq("08 antes de corregir: nada registrable; después: solo lo posterior al cierre sin registro", [antes.movimientos.filter((x) => x.registrable).length, reg], [0, ["8811", "8813", "8815", "8817", "8819", "0"]]);
const Uc = unirCartolas([hist, lineaMal, lineaOK]);
eq("08 la verificación previa con datos frescos también aprueba lo corregido", verificarRegistro(Uc.movs, Uc.movs.findIndex((m) => m.operacion === "8817"), datos).ok, true);

// 9. Fecha de cierre intacta y datos de entrada sin cambios.
eq("09 cierre histórico sin cambios (07/10/2026)", CIERRE_CONCILIACION, "2026-10-07");
const copia = JSON.stringify(datos); conciliarMovimientos(Uc.movs, datos);
eq("09 la revisión no modifica datos", JSON.stringify(datos), copia);

console.log(`\nRESUMEN cartolas en solo revisión: ${n} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
