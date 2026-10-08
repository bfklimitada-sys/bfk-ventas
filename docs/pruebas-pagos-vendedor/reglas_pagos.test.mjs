// Pruebas: pago a vendedor = una transferencia con comisión + extra por gestión. Ejecutar: node docs/pruebas-pagos-vendedor/ejecutar.mjs
import { anularPagoVendedor, evaluarPagoVendedor, pagoParecido, registrarPagoVendedor, repartirTransferencia, esPagoDuplicado } from "../../src/lib/pagosVendedor.js";
import { calcularPagoVendedor } from "../../src/lib/calculos.js";
import { movimientosCaja, resumenCaja } from "../../src/lib/caja.js";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const lanza = async (f) => { try { await f(); return null; } catch (e) { return e.message; } };

// Base: Matías, agosto 2026, comisión verificada en 527.867 (equivale al caso real)
const ocAgo = { id: "o1", numero_oc: "1-1-AG26", tipo_registro: "venta", vendedor_id: "vm", estado_factura_propia: "emitida", monto_total: 2000000, costo_total: 944266,
  eventos_factura: [{ id: "f", numero_factura: "300", tipo_documento: "factura", fecha: "2026-08-10", monto: 2000000 }], eventos_compra: [{ fecha: "2026-08-01", costo_compra: 944266 }],
  eventos_pago_cliente: [], eventos_pago_financiamiento: [] };
const iva = [{ anio: 2026, mes: 8, iva_ventas: 0, iva_compras: 0, iva_pagado: 0 }];
const base = (pagos = []) => ({ vendedorId: "vm", mes: 8, anio: 2026, ocs: [ocAgo], ivaMensual: iva, pagosVendedor: pagos });
const comision = calcularPagoVendedor({ vendedorId: "vm", ocs: [ocAgo], anio: 2026, mes: 8, ivaMensual: iva, pagosVendedor: [] }).pagoCalculado;
eq("comisión del período de prueba = 527.867", comision, 527867);

// 1. Tabla obligatoria de reparto
for (const [t, c, x] of [[300000, 300000, 0], [527867, 527867, 0], [550000, 527867, 22133], [600000, 527867, 72133]]) {
  const e = evaluarPagoVendedor({ ...base(), monto: t });
  eq(`transferencia ${t}: comisión ${c} + gestión ${x} = total`, [e.pagoComision, e.extraGestion, e.pagoComision + e.extraGestion], [c, x, t]);
}
eq("ejemplo Matías: saldo de agosto después de 550.000 = 0", evaluarPagoVendedor({ ...base(), monto: 550000 }).pendiente, 0);
eq("repartir: nada negativo con monto 0 o negativo", [repartirTransferencia(-5, 100), repartirTransferencia(0, 100)], [{ total: 0, comision: 0, extra: 0 }, { total: 0, comision: 0, extra: 0 }]);

// 2. Persistencia: una fila, dos componentes; caja descuenta el total una sola vez
const filas = []; const marcadas = [];
const ins = async (t, tok, f) => { if (filas.some((x) => x.id === f.id)) throw new Error('duplicate key value violates unique constraint "pagos_vendedor_pkey"'); filas.push({ ...f }); return [f]; };
const upd = async (t, tok, id, cambios) => { if (t === "ordenes_compra_v2") marcadas.push([id, cambios.vendedor_pagado]); else Object.assign(filas.find((x) => x.id === id), cambios); return [{}]; };
const r = await registrarPagoVendedor({ ins, upd, token: "t", userId: "u", id: "pv_a", ...base(), monto: 550000, fecha: "2026-10-08", notas: "Ventas de Agosto/2026", referencia: " op 123 " });
eq("fila: comisión 527.867, extra 22.133, transferido 550.000, referencia", [filas[0].monto_pagado, filas[0].monto_extra_gestion, filas[0].monto_transferido, filas[0].referencia_bancaria], [527867, 22133, 550000, "op 123"]);
eq("pago completo marca la OC del período", marcadas, [["o1", true]]);
const calc = calcularPagoVendedor({ vendedorId: "vm", ocs: [ocAgo], anio: 2026, mes: 8, ivaMensual: iva, pagosVendedor: filas });
eq("comisión no cambia con el extra; pagado = comisión; deuda 0; extra aparte", [calc.pagoCalculado, calc.pagado, calc.deuda, calc.extraGestion, calc.transferido], [527867, 527867, 0, 22133, 550000]);
const movs = movimientosCaja({ ocs: [ocAgo], financiadores: [], gastos: [], pagosVendedor: filas, pagoFinSueltos: [], aportes: [] }).filter((m) => m.tipo === "pago_vendedor");
eq("caja: un solo movimiento por el total transferido", movs.map((m) => [m.monto, m.extraGestion]), [[-550000, 22133]]);
eq("utilidad de la OC intacta", ocAgo.monto_total - ocAgo.costo_total, 1055734);

// 3. Doble registro del mismo pago: la llave primaria lo rechaza y se reconoce como duplicado
const dup = await lanza(() => registrarPagoVendedor({ ins, upd, token: "t", userId: "u", id: "pv_a", ...base(filas), monto: 550000, fecha: "2026-10-08" }));
eq("mismo pago enviado dos veces: rechazado, una sola fila", [esPagoDuplicado(dup), filas.length], [true, 1]);
eq("aviso de pago parecido (mismo vendedor, período, fecha y total)", !!pagoParecido({ pagosVendedor: filas, vendedorId: "vm", mes: 8, anio: 2026, fecha: "2026-10-08", monto: 550000 }), true);

// 4. Comisión ya pagada completamente: todo nuevo pago es gestión
const e4 = evaluarPagoVendedor({ ...base(filas), monto: 50000 });
eq("comisión ya pagada: 50.000 → comisión 0 + gestión 50.000", [e4.pendienteAntes, e4.pagoComision, e4.extraGestion], [0, 0, 50000]);

// 5. Comisión pagada parcialmente antes (pago histórico con el formato antiguo, sin columnas nuevas)
const historico = [{ id: "pv_h", vendedor_id: "vm", anio: 2026, mes: 8, monto_pagado: 200000, monto_calculado: 200000, fecha: "2026-09-01" }];
const e5 = evaluarPagoVendedor({ ...base(historico), monto: 400000 });
eq("parcial previo 200.000 + transferencia 400.000 → comisión 327.867 + gestión 72.133", [e5.pendienteAntes, e5.pagoComision, e5.extraGestion, e5.pendiente], [327867, 327867, 72133, 0]);
eq("pago histórico: total transferido = monto_pagado (caja igual que antes)", movimientosCaja({ ocs: [], financiadores: [], gastos: [], pagosVendedor: historico, pagoFinSueltos: [], aportes: [] })[0].monto, -200000);
const e5b = evaluarPagoVendedor({ ...base(historico), monto: 100000 });
eq("pago parcial: no marca OC, queda pendiente", [e5b.pagoComision, e5b.extraGestion, e5b.pendiente, e5b.ocIds.length], [100000, 0, 227867, 0]);

// 6. Provisoria (sin IVA del mes) y cambio posterior del IVA
const e6 = evaluarPagoVendedor({ ...base(), ivaMensual: [], monto: 527867 });
eq("sin IVA registrado: el pago avisa que la comisión es provisoria", e6.provisoria, true);
const pagoProv = [{ id: "pv_p", vendedor_id: "vm", anio: 2026, mes: 8, monto_pagado: 527867, monto_extra_gestion: 22133, monto_transferido: 550000, fecha: "2026-10-08" }];
const ivaAlto = [{ anio: 2026, mes: 8, iva_ventas: 100000, iva_compras: 0, iva_pagado: 100000 }];
const c6 = calcularPagoVendedor({ vendedorId: "vm", ocs: [ocAgo], anio: 2026, mes: 8, ivaMensual: ivaAlto, pagosVendedor: pagoProv });
eq("IVA registrado después: comisión baja 50.000; pago intacto; diferencia = saldo por regularizar; gestión conservada",
  [c6.pagoCalculado, c6.pagado, c6.porRegularizar, c6.extraGestion, c6.deuda, pagoProv[0].monto_transferido], [477867, 527867, 50000, 22133, 0, 550000]);

// 7. Anulación controlada
const marc2 = []; const filas7 = [{ ...filas[0] }];
const upd7 = async (t, tok, id, c) => { if (t === "ordenes_compra_v2") marc2.push([id, c.vendedor_pagado]); else Object.assign(filas7.find((x) => x.id === id), c); return [{}]; };
eq("anular sin motivo: rechazado", await lanza(() => anularPagoVendedor({ upd: upd7, token: "t", pago: filas7[0], motivo: " ", ocs: [ocAgo], ivaMensual: iva, pagosVendedor: filas7 })), "Indica el motivo de la anulación");
const ocMarcada = { ...ocAgo, vendedor_pagado: true };
const a7 = await anularPagoVendedor({ upd: upd7, token: "t", pago: filas7[0], motivo: "Transferencia devuelta", ocs: [ocMarcada], ivaMensual: iva, pagosVendedor: filas7 });
eq("anulado: fila conservada con motivo; OC vuelve a pendiente", [filas7.length, !!filas7[0].anulado_en, filas7[0].motivo_anulacion, filas7[0].monto_transferido, marc2], [1, true, "Transferencia devuelta", 550000, [["o1", false]]]);
const c7 = calcularPagoVendedor({ vendedorId: "vm", ocs: [ocAgo], anio: 2026, mes: 8, ivaMensual: iva, pagosVendedor: filas7 });
eq("anulado: no cuenta en comisión ni en caja", [c7.pagado, c7.deuda, movimientosCaja({ ocs: [], financiadores: [], gastos: [], pagosVendedor: filas7, pagoFinSueltos: [], aportes: [] }).length], [0, 527867, 0]);
const updFalla = async () => { throw new Error("Error actualizando pagos_vendedor"); };
eq("anulación rechazada por la base (no admin / ya anulado): mensaje claro", /No se pudo anular/.test(await lanza(() => anularPagoVendedor({ upd: updFalla, token: "t", pago: filas[0], motivo: "x", ocs: [ocAgo], ivaMensual: iva, pagosVendedor: filas }))), true);

// 8. Panel: comisiones por pagar no cambian con el extra; la caja resta el total
const rz = resumenCaja({ ocs: [ocAgo], financiadores: [], gastos: [], pagosVendedor: filas, ivaMensual: iva, vendedores: [{ id: "vm", nombre: "Matías Vegas" }], pagoFinSueltos: [], aportes: [], saldoBanco: null, hoy: new Date(2026, 9, 8) });
eq("Panel: comisiones por pagar 0 y caja −550.000 (una vez)", [rz.comisiones.total, rz.caja], [0, -550000]);

console.log(`\nRESUMEN pruebas pagos a vendedores (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
