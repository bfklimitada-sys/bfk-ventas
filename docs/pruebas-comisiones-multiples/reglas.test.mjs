// Etapa 4 — comisión ordinaria del PERÍODO con varios vendedores (regla común). Datos ficticios.
// Ejecutar: node docs/pruebas-comisiones-multiples/ejecutar.mjs
// Compara además con la regla anterior congelada (./anterior/calculos.js): con un solo vendedor debe ser idéntica.
import * as N from "../../src/lib/calculos.js";
import * as A from "./anterior/calculos.js";
import { comisionesPorPagar } from "../../src/lib/caja.js";
import { resultadoMes } from "../../src/lib/informes.js";
import { evaluarPagoVendedor, prepararPagoVendedor, repartirTransferencia } from "../../src/lib/pagosVendedor.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
let nid = 0;
const venta = (vend, fecha, util, o = {}) => { const id = `oc${++nid}`; return { id, numero_oc: id, tipo_registro: "venta", vendedor_id: vend, estado_factura_propia: "emitida",
  monto_total: 1000000 + util, costo_total: 1000000, eventos_factura: [{ id: "f" + id, numero_factura: id, fecha, monto: 1000000 + util }], ...o }; };
const iva = (anio, mes, ventas, compras, pagado) => ({ anio, mes, iva_ventas: ventas, iva_compras: compras, ...(pagado != null ? { iva_pagado: pagado } : {}) });
const calc = (ocs, v, anio, mes, ivaMensual = [], pagosVendedor = []) => N.calcularPagoVendedor({ vendedorId: v, ocs, anio, mes, ivaMensual, pagosVendedor });
const viejo = (ocs, v, anio, mes, ivaMensual = [], pagosVendedor = []) => A.calcularPagoVendedor({ vendedorId: v, ocs, anio, mes, ivaMensual, pagosVendedor });
const per = (ocs, anio, mes, ivaMensual = []) => N.comisionOrdinariaPeriodo({ ocs, anio, mes, ivaMensual });
const partes = (p) => Object.fromEntries([...p.partes.entries()]);
const OCT = [2026, 10], NOV = [2026, 11], SEP = [2026, 9];
// Octubre 2026: IVA neto 100.000 + PPM 60.000 = descuento tributario 160.000 (total del F29 registrado = 160.000).
const ivaOct = [iva(2026, 10, 150000, 50000, 160000)];

// 1. Ejemplo de la regla (Kevin, 28/10/2026)
const ej = [venta("A", "2026-10-05", 600000), venta("B", "2026-10-12", 400000)];
eq("ejemplo: total = (1.000.000 − 160.000) / 2 = 420.000", per(ej, ...OCT, ivaOct).total, 420000);
eq("ejemplo: A recibe 252.000 y B 168.000", partes(per(ej, ...OCT, ivaOct)), { A: 252000, B: 168000 });
eq("ejemplo: cada vendedor ve su parte como comisión", [calc(ej, "A", ...OCT, ivaOct).pagoCalculado, calc(ej, "B", ...OCT, ivaOct).pagoCalculado], [252000, 168000]);
eq("ejemplo: la regla anterior descontaba 160.000 dos veces (220.000 + 120.000 = 340.000)", [viejo(ej, "A", ...OCT, ivaOct).pagoCalculado, viejo(ej, "B", ...OCT, ivaOct).pagoCalculado], [220000, 120000]);
eq("ejemplo: desglose del período en el resultado", (({ vendedores, utilidadTotal, descuentoF29, total, metodo, peso, pesoTotal }) => ({ vendedores, utilidadTotal, descuentoF29, total, metodo, peso, pesoTotal }))(calc(ej, "A", ...OCT, ivaOct).periodo),
  { vendedores: 2, utilidadTotal: 1000000, descuentoF29: 160000, total: 420000, metodo: "proporcional", peso: 600000, pesoTotal: 1000000 });

// 2. Un solo vendedor elegible: idéntico a la regla anterior (muchos casos, IVA positivo, negativo y cero, PPM, sin IVA)
let difUno = 0, casos = 0;
const utils = [-300000, -1, 0, 1, 2, 3, 99999, 100001, 333333, 1234567];
const ivas = [null, iva(2026, 10, 0, 0, 0), iva(2026, 10, 50000, 10000, 0), iva(2026, 10, 50000, 10000, 70001), iva(2026, 10, 10000, 50000, 0), iva(2026, 10, 12345, 12345, 0)];
for (const u of utils) for (const i of ivas) for (const vp of [0, 250000]) {
  const o = [venta("U", "2026-10-03", u)]; if (vp) o.push(venta("U", "2026-10-04", vp, { es_venta_propia: true }));
  const im = i ? [i] : []; casos++;
  const a = viejo(o, "U", ...OCT, im), n = calc(o, "U", ...OCT, im);
  for (const k of ["pagoCalculado", "deuda", "estado", "sumaUtilidad", "pagoVentasPropias", "impIva", "retenciones", "descuentoF29", "f29Incompleto", "ivaRegistrado"]) if (a[k] !== n[k]) difUno++;
}
eq(`un vendedor: ${casos} casos idénticos a la regla anterior`, difUno, 0);
const abr = [venta("U", "2025-04-10", 50000), venta("V", "2025-04-11", 30000)];
eq("abril 2025 (sin IVA) y antes de la vigencia: regla anterior intacta", [calc(abr, "U", 2025, 4, [iva(2025, 4, 9000, 0)]).pagoCalculado, calc(abr, "V", 2025, 4, [iva(2025, 4, 9000, 0)]).pagoCalculado], [25000, 15000]);

// 3. Dos, tres y más vendedores; suma exacta y sin negativos (propiedad con muchos casos)
const tres = [venta("A", "2026-10-01", 500000), venta("B", "2026-10-02", 300000), venta("C", "2026-10-03", 200000)];
const iva100 = [iva(2026, 10, 100000, 0, 100000)];
eq("tres vendedores: total (1.000.000 − 100.000)/2 = 450.000 → 225.000 / 135.000 / 90.000", partes(per(tres, ...OCT, iva100)), { A: 225000, B: 135000, C: 90000 });
const cinco = ["V1", "V2", "V3", "V4", "V5"].map((v, i) => venta(v, "2026-10-0" + (i + 1), 100001 + i * 7));
const p5 = per(cinco, ...OCT, [iva(2026, 10, 3, 0, 3)]);
eq("cinco vendedores: las partes suman exactamente el total", Object.values(partes(p5)).reduce((s, x) => s + x, 0), p5.total);
let malSuma = 0, negativos = 0, sobreTotal = 0, nprop = 0;
for (let k = 0; k < 400; k++) {
  const n = 2 + (k % 6); const o = [];
  for (let j = 0; j < n; j++) o.push(venta("v" + j, "2026-10-1" + (j % 9), ((k * 7919 + j * 104729) % 2000003) - 400000));
  const im = [iva(2026, 10, (k * 31337) % 500000, (k * 7) % 600000, k % 3 ? (k * 31337) % 900000 : 0)];
  const p = per(o, ...OCT, im); const s = Object.values(partes(p)); nprop++;
  if (s.reduce((a, b) => a + b, 0) !== p.total) malSuma++;
  if (s.some((x) => x < 0 || !Number.isInteger(x))) negativos++;
  if (s.some((x) => x > p.total)) sobreTotal++;
}
eq(`${nprop} períodos aleatorios de 2 a 7 vendedores: suma exacta, enteros, sin negativos`, [malSuma, negativos, sobreTotal], [0, 0, 0]);

// 4. Redondeo en pesos enteros (mayor resto, empate por id del vendedor)
eq("tres partes iguales de $100 → 34 / 33 / 33", Object.values(Object.fromEntries(N.repartirComision(100, [{ id: "c", peso: 1 }, { id: "a", peso: 1 }, { id: "b", peso: 1 }]))), [34, 33, 33]);
eq("empate de restos: gana el primer id", Object.fromEntries(N.repartirComision(1, [{ id: "z", peso: 5 }, { id: "y", peso: 5 }])), { y: 1, z: 0 });
eq("mitad impar (utilidad 1.000.001, sin IVA) → 500.001 como la regla anterior", per([venta("A", "2026-10-01", 600001), venta("B", "2026-10-02", 400000)], ...OCT).total, Math.max(0, Math.round(1000001 / 2)));
eq("montos grandes sin pérdida de precisión", Object.values(Object.fromEntries(N.repartirComision(987654321, [{ id: "a", peso: 123456789012 }, { id: "b", peso: 98765432109 }]))).reduce((s, x) => s + x, 0), 987654321);

// 5. IVA positivo, negativo y cero; F29 pendiente; IVA sin registrar
const dos = [venta("A", "2026-10-05", 600000), venta("B", "2026-10-12", 400000)];
eq("IVA neto negativo (−50.000): suma una sola vez → total 525.000", per(dos, ...OCT, [iva(2026, 10, 10000, 60000, 1)]).total, 525000);
eq("IVA neto cero y sin PPM → total 500.000", per(dos, ...OCT, [iva(2026, 10, 30000, 30000, 1)]).total, 500000);
const pend = calc(dos, "A", ...OCT, [iva(2026, 10, 150000, 50000)]);
eq("F29 pendiente (sin total): descuenta solo el IVA neto y queda provisoria", [pend.descuentoF29, pend.f29Incompleto, N.comisionProvisoria(pend), pend.pagoCalculado], [100000, true, true, 270000]);
const sinIva = calc(dos, "B", ...OCT, []);
eq("IVA sin registrar: descuento 0, provisoria", [sinIva.descuentoF29, sinIva.ivaRegistrado, N.comisionProvisoria(sinIva), sinIva.pagoCalculado], [0, false, true, 200000]);
eq("antes de ago-2026 las retenciones no se descuentan (regla vigente)", N.descuentoTributarioPeriodo([iva(2026, 7, 10000, 0, 50000)], 2026, 7).descuentoF29, 10000);

// 6. Utilidades negativas o nulas y suma global no positiva
eq("un vendedor con pérdida: entra en la utilidad total y su parte es $0", partes(per([venta("A", "2026-10-01", 600000), venta("B", "2026-10-02", -100000)], ...OCT, ivaOct)), { A: 170000, B: 0 });
eq("un vendedor con utilidad cero: parte $0", partes(per([venta("A", "2026-10-01", 600000), venta("B", "2026-10-02", 0)], ...OCT, ivaOct)), { A: 220000, B: 0 });
const nulos = per([venta("A", "2026-10-01", 0), venta("B", "2026-10-02", 0)], ...OCT, [iva(2026, 10, 0, 100000, 1)]);
eq("ninguno con utilidad positiva y total > 0 (IVA negativo): partes iguales", [nulos.metodo, partes(nulos)], ["partes_iguales", { A: 25000, B: 25000 }]);
const neg = per([venta("A", "2026-10-01", -50000), venta("B", "2026-10-02", 20000)], ...OCT, ivaOct);
eq("suma global no positiva: total $0, nadie recibe", [neg.total, neg.metodo, partes(neg)], [0, "sin_comision", { A: 0, B: 0 }]);
eq("utilidad menor que el descuento: total $0", per([venta("A", "2026-10-01", 100000), venta("B", "2026-10-02", 50000)], ...OCT, ivaOct).total, 0);

// 7. Ventas propias y ordinarias
const vp = [venta("A", "2026-10-01", 600000), venta("B", "2026-10-02", 400000), venta("A", "2026-10-03", 119000, { es_venta_propia: true })];
const cA = calc(vp, "A", ...OCT, ivaOct);
eq("venta propia aparte: 100% de su utilidad − IVA de su factura; no entra al total ordinario", [cA.comisionOrdinaria, cA.pagoVentasPropias, cA.periodo.utilidadTotal], [252000, Math.max(0, Math.round(119000 - (1119000 - 1119000 / 1.19))), 1000000]);
const soloVP = [venta("A", "2026-10-01", 600000), venta("B", "2026-10-02", 200000, { es_venta_propia: true })];
const ivaNeg = [iva(2026, 10, 10000, 60000, 1)];
eq("vendedor con SOLO ventas propias: sin parte ordinaria (antes recibía la mitad del IVA negativo)", [calc(soloVP, "B", ...OCT, ivaNeg).comisionOrdinaria, viejo(soloVP, "B", ...OCT, ivaNeg).pagoCalculado - viejo(soloVP, "B", ...OCT, ivaNeg).pagoVentasPropias], [0, 25000]);
eq("y el otro vendedor es el único ordinario: igual que antes", calc(soloVP, "A", ...OCT, ivaNeg).pagoCalculado, viejo(soloVP, "A", ...OCT, ivaNeg).pagoCalculado);

// 8. Exclusiones vigentes (no entran al período)
const ex = [venta("A", "2026-10-01", 600000), venta("B", "2026-10-02", 400000, { comision_excluida: true }), venta("C", "2026-10-03", 300000, { capitalizacion_bfk: true }),
  venta("D", "2026-10-04", 300000, { tipo_registro: "venta_externa" }), venta(null, "2026-10-05", 900000), venta("E", "2026-10-06", 300000, { estado_factura_propia: "pendiente" })];
eq("excluida, capitalización, venta externa, sin vendedor o sin factura: no entran", [per(ex, ...OCT, ivaOct).vendedores, per(ex, ...OCT, ivaOct).utilidadTotal], [1, 600000]);
const anulada = venta("B", "2026-10-02", 400000); anulada.eventos_factura.push({ id: "nc", tipo_dte: 61, ref_codigo: 1, ref_folio: anulada.numero_oc, fecha: "2026-10-20", monto: 1400000 });
eq("factura anulada por NC: no entra", per([venta("A", "2026-10-01", 600000), anulada], ...OCT, ivaOct).vendedores, 1);
const otroMes = venta("B", "2026-11-02", 400000);
eq("cada OC entra solo en el mes de su factura vigente", [per([venta("A", "2026-10-01", 600000), otroMes], ...OCT, ivaOct).vendedores, per([otroMes], ...NOV).vendedores], [1, 1]);

// 9. Comisiones verificadas y pagos (parciales, completos, anulados, extras)
const pagos = [{ id: "p1", vendedor_id: "A", anio: 2026, mes: 10, monto_pagado: 100000, monto_transferido: 100000, fecha: "2026-11-05" },
  { id: "p2", vendedor_id: "B", anio: 2026, mes: 10, monto_pagado: 168000, monto_extra_gestion: 32000, monto_transferido: 200000, fecha: "2026-11-05" },
  { id: "p3", vendedor_id: "A", anio: 2026, mes: 10, monto_pagado: 999999, fecha: "2026-11-06", anulado_en: "2026-11-07T00:00:00Z" }];
const pa = calc(ej, "A", ...OCT, ivaOct, pagos), pb = calc(ej, "B", ...OCT, ivaOct, pagos);
eq("pago parcial: deuda = parte − pagado; anulado no cuenta", [pa.pagado, pa.deuda, pa.estado], [100000, 152000, "pendiente"]);
eq("pago completo con extra por gestión: pagada, extra aparte", [pb.pagado, pb.deuda, pb.estado, pb.extraGestion, pb.transferido], [168000, 0, "pagado", 32000, 200000]);
const verif = [{ id: "pv", vendedor_id: "A", anio: 2026, mes: 10, monto_pagado: 210000, monto_verificado: 210000, fecha: "2026-11-05" }];
eq("monto verificado: se respeta tal cual (no se recalcula)", [calc(ej, "A", ...OCT, ivaOct, verif).pagoCalculado, calc(ej, "A", ...OCT, ivaOct, verif).esVerificado, calc(ej, "B", ...OCT, ivaOct, verif).pagoCalculado], [210000, true, 168000]);
eq("verificado histórico (antes de la vigencia) sigue igual", calc([venta("A", "2026-09-01", 600000), venta("B", "2026-09-02", 400000)], "A", ...SEP, [], [{ vendedor_id: "A", anio: 2026, mes: 9, monto_pagado: 1, monto_verificado: 123456 }]).pagoCalculado, 123456);
const ev = evaluarPagoVendedor({ vendedorId: "A", mes: 10, anio: 2026, monto: 200000, ocs: ej, ivaMensual: ivaOct, pagosVendedor: pagos });
eq("registro de pago: usa la parte del período (152.000 pendiente) y el excedente es extra", [ev.comision, ev.pendienteAntes, ev.pagoComision, ev.extraGestion, ev.completo], [252000, 152000, 152000, 48000, true]);
const fila = prepararPagoVendedor({ vendedorId: "B", monto: 168000, fecha: "2026-11-10", mes: 10, anio: 2026, ocs: ej, ivaMensual: ivaOct, pagosVendedor: [] }).fila;
eq("fila de pago (manual y cartola): comisión 168.000 sin extra", [fila.monto_pagado, fila.monto_extra_gestion, fila.monto_transferido], [168000, 0, 168000]);
eq("reparto de transferencia sin cambios", repartirTransferencia(300000, 252000), { total: 300000, comision: 252000, extra: 48000 });

// 10. Una regla común: Vendedores, Panel (caja) e informe suman lo mismo, sin duplicar IVA ni PPM
const vendedores = [{ id: "A", nombre: "A" }, { id: "B", nombre: "B" }, { id: "C", nombre: "C" }];
const hoy = new Date(2026, 11, 2);
const cp = comisionesPorPagar({ vendedores, ocs: tres, ivaMensual: iva100, pagosVendedor: [], hoy });
eq("Panel: comisiones por pagar del período = total del período (450.000)", cp.total, 450000);
const rm = resultadoMes({ ocs: tres, gastos: [], pagosVendedor: [], ivaMensual: iva100, vendedores, categorias: [] }, 2026, 10);
eq("Informe: comisiones devengadas del mes = 450.000 (antes 3 × descuento)", rm.comisiones, 450000);
eq("antes: la regla anterior sumaba 350.000 (descuento de 100.000 tres veces: (1.000.000 − 300.000) / 2)", ["A", "B", "C"].reduce((s, v) => s + viejo(tres, v, ...OCT, iva100).pagoCalculado, 0), 350000);

// 11. Vigencia: antes de COMISION_PERIODO_DESDE se conserva el cálculo anterior por vendedor
eq("vigencia desde octubre 2026", N.COMISION_PERIODO_DESDE, { anio: 2026, mes: 10 });
const sep = [venta("A", "2026-09-05", 600000), venta("B", "2026-09-12", 400000)], ivaSep = [iva(2026, 9, 150000, 50000, 160000)];
eq("septiembre 2026 (antes de la vigencia): sin cambios", [calc(sep, "A", ...SEP, ivaSep).pagoCalculado, calc(sep, "B", ...SEP, ivaSep).pagoCalculado, calc(sep, "A", ...SEP, ivaSep).reglaPeriodo], [220000, 120000, false]);
eq("noviembre 2026 en adelante: regla del período", calc([venta("A", "2026-11-05", 600000), venta("B", "2026-11-12", 400000)], "A", ...NOV, [iva(2026, 11, 150000, 50000, 160000)]).pagoCalculado, 252000);

console.log(`\nRESUMEN comisiones de varios vendedores: ${ok} OK, ${fallas} FALLA(S)`);
if (fallas) process.exitCode = 1;
