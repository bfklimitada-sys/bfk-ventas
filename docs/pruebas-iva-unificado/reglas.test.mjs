// Pruebas del registro único "IVA del mes" (lib/ivaUnificado.js).
import { periodosIvaIncompletos, mesSugeridoIva, planGuardarIva, pagadoSiiDe } from "../../src/lib/ivaUnificado.js";
import { calcularPagoVendedor, retencionesPeriodo } from "../../src/lib/calculos.js";
import { periodoF29 } from "../../src/lib/f29.js";

let ok = 0, fallas = 0;
const eq = (n, real, esp) => { const b = JSON.stringify(real) === JSON.stringify(esp); b ? ok++ : fallas++;
  console.log((b ? "OK    " : "FALLA ") + n + (b ? "" : ` :: esperado ${JSON.stringify(esp)} obtenido ${JSON.stringify(real)}`)); };

const gasto = (id, anio, mes, monto, extra = {}) => ({ id, categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", anio, mes, monto, fecha: `${anio}-${String(mes + 1 > 12 ? 1 : mes + 1).padStart(2, "0")}-20`, ...extra });
const iva = (id, anio, mes, d, c) => ({ id, anio, mes, iva_ventas: d, iva_compras: c });

// Caso real reportado: agosto 2026 pagado como gasto, sin IVA mensual; julio completo.
const gastos = [gasto("g8", 2026, 8, 609830), gasto("g7", 2026, 7, 649597), gasto("g5", 2025, 5, 1000), { id: "x", categoria_id: "cat_contador", anio: 2026, mes: 9, monto: 20514 }];
const ivaMensual = [iva("i7", 2026, 7, 649597, 0)];

eq("incompletos: solo agosto 2026 (julio completo, 2025 fuera del corte, otras categorías no)", periodosIvaIncompletos({ gastos, ivaMensual }), [{ anio: 2026, mes: 8, pagado: 609830 }]);
eq("incompletos con mes/año como texto", periodosIvaIncompletos({ gastos: [{ ...gasto("a", 2026, 8, 5), anio: "2026", mes: "8" }], ivaMensual: [] }), [{ anio: 2026, mes: 8, pagado: 5 }]);
eq("sugerido = incompleto más antiguo", mesSugeridoIva({ gastos, ivaMensual, hoy: new Date(2026, 9, 6) }), { anio: 2026, mes: 8 });
eq("sugerido = mes anterior si falta", mesSugeridoIva({ gastos: [], ivaMensual: [], hoy: new Date(2026, 9, 6) }), { anio: 2026, mes: 9 });
eq("sugerido = mes anterior cruza año", mesSugeridoIva({ gastos: [], ivaMensual: [], hoy: new Date(2027, 0, 10) }), { anio: 2026, mes: 12 });
eq("sugerido = mes actual si el anterior está", mesSugeridoIva({ gastos: [], ivaMensual: [iva("i9", 2026, 9, 1, 0)], hoy: new Date(2026, 9, 6) }), { anio: 2026, mes: 10 });

// Completar agosto: inserta IVA, no duplica el gasto existente.
let p = planGuardarIva({ data: { anio: 2026, mes: 8, ivaVentas: 609830, ivaCompras: 0, pagadoSii: 609830, fechaPago: "2026-09-20" }, gastos, ivaMensual });
eq("agosto: inserta iva_mensual", [p.iva.accion, p.iva.fila.iva_ventas, p.iva.fila.iva_compras, p.iva.fila.iva_pagado], ["insertar", 609830, 0, 609830]);
eq("agosto: no toca el gasto ya registrado (mismo monto y fecha)", p.gasto, { accion: "ninguna" });
eq("agosto: sin aviso", p.aviso, null);
p = planGuardarIva({ data: { anio: 2026, mes: 8, ivaVentas: 700000, ivaCompras: 90170, pagadoSii: 609830 }, gastos, ivaMensual });
eq("agosto sin fecha: no cambia gasto", p.gasto, { accion: "ninguna" });

// Mes nuevo: inserta ambos.
p = planGuardarIva({ data: { anio: 2026, mes: 9, ventasNetas: "1000000", ivaVentas: "190000", comprasNetas: "", ivaCompras: "50000", pagadoSii: 140000, fechaPago: "2026-10-20" }, gastos, ivaMensual });
eq("septiembre: inserta iva", [p.iva.accion, p.iva.fila], ["insertar", { anio: 2026, mes: 9, ventas_netas: 1000000, iva_ventas: 190000, compras_netas: 0, iva_compras: 50000, iva_pagado: 140000 }]);
eq("septiembre: inserta gasto Impuesto SII", p.gasto, { accion: "insertar", fila: { categoria_id: "cat_impuesto", subcategoria: "IVA Mensual", monto: 140000, mes: 9, anio: 2026, fecha: "2026-10-20", detalle: null } });

// Edición: actualiza iva y gasto si cambió.
p = planGuardarIva({ data: { anio: 2026, mes: 7, ivaVentas: 700000, ivaCompras: 50403, pagadoSii: 649597, fechaPago: "2026-08-20" }, gastos, ivaMensual });
eq("julio: actualiza iva existente", [p.iva.accion, p.iva.id], ["actualizar", "i7"]);
eq("julio: gasto igual → nada", p.gasto, { accion: "ninguna" });
p = planGuardarIva({ data: { anio: 2026, mes: 7, ivaVentas: 700000, ivaCompras: 0, pagadoSii: 700000, fechaPago: "2026-08-21" }, gastos, ivaMensual });
eq("julio: gasto distinto → actualiza monto y fecha", p.gasto, { accion: "actualizar", id: "g7", fila: { monto: 700000, fecha: "2026-08-21" } });

// Neto negativo / sin pago: no crea gasto.
p = planGuardarIva({ data: { anio: 2026, mes: 9, ivaVentas: 10000, ivaCompras: 50000, pagadoSii: 0 }, gastos, ivaMensual });
eq("neto negativo sin pago: iva_pagado 0 y sin gasto", [p.iva.fila.iva_pagado, p.gasto.accion], [0, "ninguna"]);

// Varios pagos del período: no se tocan; avisa si no cuadra.
const varios = [...gastos, gasto("g8b", 2026, 8, 10000)];
p = planGuardarIva({ data: { anio: 2026, mes: 8, ivaVentas: 609830, ivaCompras: 0, pagadoSii: 609830 }, gastos: varios, ivaMensual });
eq("varios pagos: no se modifican y avisa", [p.gasto.accion, !!p.aviso], ["ninguna", true]);
p = planGuardarIva({ data: { anio: 2026, mes: 8, ivaVentas: 619830, ivaCompras: 0, pagadoSii: 619830 }, gastos: varios, ivaMensual });
eq("varios pagos que cuadran: sin aviso", p.aviso, null);
eq("pagadoSiiDe suma pagos", pagadoSiiDe(varios, 2026, 8), 619830);

// Comisión de agosto antes/después (regla de cálculo sin cambios).
const oc = { id: "o1", vendedor_id: "v1", estado_factura_propia: "emitida", monto_total: 7340493, costo_total: 7340493 - 1401405, eventos_factura: [{ id: "f1", fecha: "2026-08-14", numero_factura: "100", monto: 7340493 }] };
const antes = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc], anio: 2026, mes: 8, ivaMensual, pagosVendedor: [] });
eq("comisión agosto sin IVA (como hoy): $700.703 provisoria", [antes.pagoCalculado, antes.ivaRegistrado], [700703, false]);
p = planGuardarIva({ data: { anio: 2026, mes: 8, ivaVentas: 609830, ivaCompras: 0, pagadoSii: 609830 }, gastos, ivaMensual });
const despues = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc], anio: 2026, mes: 8, ivaMensual: [...ivaMensual, { id: "nuevo", ...p.iva.fila }], pagosVendedor: [] });
eq("comisión agosto con IVA neto 609.830: $395.788", [despues.pagoCalculado, despues.ivaRegistrado], [395788, true]);
eq("F29 agosto: determinado 609.830, pagado 609.830, pendiente 0", periodoF29([{ id: "n", ...p.iva.fila }], gastos, 2026, 8), { anio: 2026, mes: 8, det: 609830, pag: 609830, pend: 0 });

// ── Regla 2026-10-06: se descuenta el total del F29 (IVA + retenciones) desde agosto 2026 ──
// F29 real de agosto: débito 1.552.920, crédito 983.956, IVA a pagar 568.964, PPM 40.866, total 609.830.
p = planGuardarIva({ data: { anio: 2026, mes: 8, ventasNetas: 8173269, ivaVentas: 1552920, comprasNetas: 5178704, ivaCompras: 983956, pagadoSii: 609830, fechaPago: "2026-09-17" }, gastos, ivaMensual });
eq("F29 agosto: iva_pagado guarda el total pagado", p.iva.fila.iva_pagado, 609830);
eq("F29 agosto: retenciones = 40.866 (PPM)", retencionesPeriodo(p.iva.fila), 40866);
const conRet = calcularPagoVendedor({ vendedorId: "v1", ocs: [oc], anio: 2026, mes: 8, ivaMensual: [...ivaMensual, { id: "n", ...p.iva.fila }], pagosVendedor: [] });
eq("comisión agosto con total F29 (IVA 568.964 + PPM 40.866): $395.788", [conRet.pagoCalculado, conRet.impIva, conRet.retenciones, conRet.descuentoF29], [395788, 568964, 40866, 609830]);
// Etapa 3 (autorizada 09/10/2026): desde agosto 2026 el F29 del Panel incluye IVA + PPM (antes solo IVA, 568.964).
eq("F29 agosto en Panel: determinado = IVA 568.964 + PPM 40.866 = 609.830, pagado 609.830, pendiente 0", periodoF29([{ id: "n", ...p.iva.fila }], gastos, 2026, 8), { anio: 2026, mes: 8, det: 609830, pag: 609830, pend: 0 });
// 10/10/2026: desde agosto 2026 el total del F29 no se presume igual al IVA a pagar: sin total escrito se guarda 0 (no registrado).
eq("sin total indicado (desde ago-2026): iva_pagado 0, no el IVA a pagar → retenciones 0", [planGuardarIva({ data: { anio: 2026, mes: 9, ivaVentas: 1000, ivaCompras: 0, pagadoSii: 0 }, gastos: [], ivaMensual: [] }).iva.fila.iva_pagado, retencionesPeriodo(planGuardarIva({ data: { anio: 2026, mes: 9, ivaVentas: 1000, ivaCompras: 0, pagadoSii: 0 }, gastos: [], ivaMensual: [] }).iva.fila)], [0, 0]);
eq("antes de ago-2026 sin total: sigue guardando el IVA a pagar (sin cambios)", planGuardarIva({ data: { anio: 2026, mes: 7, ivaVentas: 1000, ivaCompras: 0, pagadoSii: 0 }, gastos: [], ivaMensual: [] }).iva.fila.iva_pagado, 1000);
eq("editar débito/crédito sin total conserva el total ya registrado", planGuardarIva({ data: { anio: 2026, mes: 9, ivaVentas: 1200, ivaCompras: 0, pagadoSii: 0 }, gastos: [], ivaMensual: [{ id: "i9", anio: 2026, mes: 9, iva_ventas: 1000, iva_compras: 0, iva_pagado: 1500 }] }).iva.fila.iva_pagado, 1500);
eq("pago parcial menor al IVA: retenciones 0", retencionesPeriodo({ anio: 2026, mes: 9, iva_ventas: 1000, iva_compras: 0, iva_pagado: 400 }), 0);
eq("neto negativo con PPM: retenciones = todo lo pagado", retencionesPeriodo({ anio: 2026, mes: 9, iva_ventas: 1000, iva_compras: 5000, iva_pagado: 30000 }), 30000);
eq("julio 2026 (antes del corte): retenciones no aplican", retencionesPeriodo({ anio: 2026, mes: 7, iva_ventas: 100, iva_compras: 0, iva_pagado: 50000 }), 0);
eq("julio 2026: comisión no cambia aunque iva_pagado sea mayor", calcularPagoVendedor({ vendedorId: "v1", ocs: [{ ...oc, eventos_factura: [{ id: "f1", fecha: "2026-07-14", numero_factura: "100", monto: 7340493 }] }], anio: 2026, mes: 7, ivaMensual: [{ id: "i7", anio: 2026, mes: 7, iva_ventas: 649597, iva_compras: 0, iva_pagado: 900000 }], pagosVendedor: [] }).pagoCalculado, Math.round(1401405 / 2 - 649597 / 2));
eq("diciembre 2026 aplica (corte por año)", retencionesPeriodo({ anio: 2027, mes: 1, iva_ventas: 0, iva_compras: 0, iva_pagado: 7 }), 7);

console.log(`\n${ok} OK · ${fallas} fallas`);
if (fallas) process.exit(1);
