// ═══════════════════════════════════════════════════════════════
// Caja, compromisos y conciliación bancaria del Panel (cierre financiero).
// Funciones puras: solo leen lo cargado, no escriben.
//
// UN SOLO universo de movimientos de dinero (movimientosCaja). Con él se calculan:
//  · Caja calculada        = suma de todos los movimientos;
//  · Saldo esperado banco  = saldo informado a la fecha de corte + movimientos posteriores al corte;
//  · Pendiente de conciliación bancaria = caja − saldo esperado
//    (= movimientos hasta el corte − saldo del banco). No es pérdida ni ganancia.
// Compromisos: todos los pendientes, sin importar el mes en que nacieron. Lo que depende de un IVA
// todavía no registrado (F29 y comisiones de esos meses) se marca como PROVISORIO, nunca como definitivo.
// ═══════════════════════════════════════════════════════════════
import { calcularPagoVendedor, facturasVigentes, mesesConFactura, registroIvaDe } from "./calculos.js";
import { F29_DESDE, calcularF29 } from "./f29.js";
import { ingresoPendienteOC, valeVistasPendientes } from "./ocs.js";

const n = (v) => Number(v) || 0;
const f10 = (v) => (v ? String(v).slice(0, 10) : "");
const tipo = (oc) => oc?.tipo_registro || "venta";
const esCobroPendienteBanco = (e) => !!(e?.medio_pago && e.medio_pago !== "transferencia" && !e.cobrado_en_banco);
// OCs cuyo dinero pasa por la cuenta de BFK: ventas y ventas externas (estas últimas con su pasivo aparte).
const enCuenta = (oc) => !oc?.archivada && (tipo(oc) === "venta" || tipo(oc) === "externa" || tipo(oc) === "aporte_socio");

// Universo único de movimientos de dinero. Cada uno: { fecha, tipo, monto (+ entra / − sale), ref }.
export function movimientosCaja({ ocs, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes }) {
  const propio = new Set((financiadores || []).filter((f) => f.tipo === "propio").map((f) => f.id));
  const m = [];
  for (const oc of ocs || []) {
    if (!enCuenta(oc)) continue;
    for (const e of oc.eventos_pago_cliente || []) if (!esCobroPendienteBanco(e)) m.push({ fecha: f10(e.fecha), tipo: tipo(oc) === "externa" ? "cobro_externo" : "cobro", monto: n(e.monto), ref: oc.numero_oc });
    for (const e of oc.eventos_pago_financiamiento || []) m.push({ fecha: f10(e.fecha), tipo: tipo(oc) === "externa" ? "pago_externo" : "pago_financiador", monto: -n(e.monto), ref: oc.numero_oc });
    // Fondos propios (Cuenta BFK): la compra la pagó la cuenta de BFK.
    if (propio.has(oc.financiador_id) && !oc.es_venta_propia)
      for (const e of oc.eventos_compra || []) m.push({ fecha: f10(e.fecha), tipo: "compra_fondos_propios", monto: -n(e.costo_compra), ref: oc.numero_oc });
  }
  for (const e of pagoFinSueltos || []) m.push({ fecha: f10(e.fecha), tipo: "pago_financiador", monto: -n(e.monto), ref: e.financiador_id });
  for (const g of gastos || []) m.push({ fecha: f10(g.fecha), tipo: "gasto", monto: -n(g.monto), ref: g.categoria_id });
  for (const p of pagosVendedor || []) m.push({ fecha: f10(p.fecha), tipo: "pago_vendedor", monto: -n(p.monto_pagado), ref: p.vendedor_id });
  for (const a of aportes || []) m.push({ fecha: f10(a.fecha), tipo: a.tipo === "retiro" ? "retiro" : "aporte", monto: (a.tipo === "retiro" ? -1 : 1) * n(a.monto), ref: a.socio });
  return m;
}

// Conciliación con el banco usando EXACTAMENTE el mismo universo de la caja.
export function conciliacionBancaria(movs, saldoBanco) {
  const caja = movs.reduce((s, x) => s + x.monto, 0);
  if (!saldoBanco || !saldoBanco.fecha_corte) return { caja, hayCorte: false };
  const corte = f10(saldoBanco.fecha_corte);
  const posteriores = movs.filter((x) => x.fecha && x.fecha > corte);
  const movPosteriores = posteriores.reduce((s, x) => s + x.monto, 0);
  const saldoBancoCorte = n(saldoBanco.saldo);
  const esperado = saldoBancoCorte + movPosteriores;
  const sinFecha = movs.filter((x) => !x.fecha).length;   // se tratan como anteriores al corte
  return { caja, hayCorte: true, corte, saldoBancoCorte, movPosteriores, nPosteriores: posteriores.length, esperado, pendienteConciliacion: caja - esperado, sinFecha };
}

// Comisiones por pagar de TODOS los meses (no solo el actual). Provisorias: las de meses sin IVA registrado.
export function comisionesPorPagar({ vendedores, ocs, ivaMensual, pagosVendedor }) {
  const detalle = [];
  for (const v of vendedores || []) {
    for (const { anio, mes } of mesesConFactura(v.id, ocs || [])) {
      const r = calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual, pagosVendedor });
      if (!r || !(r.deuda > 0)) continue;
      const provisoria = !r.esVerificado && !r.sinIva && !r.ivaRegistrado;
      detalle.push({ vendedorId: v.id, vendedor: v.nombre, anio, mes, deuda: r.deuda, provisoria });
    }
  }
  const total = detalle.reduce((s, d) => s + d.deuda, 0);
  const provisorias = detalle.filter((d) => d.provisoria).reduce((s, d) => s + d.deuda, 0);
  return { total, definitivas: total - provisorias, provisorias, detalle };
}

// Períodos F29 (desde F29_DESDE hasta el mes actual) con ventas o compras y SIN IVA registrado.
// No se estima nada: quedan "pendientes de registrar" hasta tener el F29 real.
export function periodosIvaSinRegistrar({ ocs, ivaMensual, anioActual, mesActual }) {
  const clave = (a, m) => a * 12 + (m - 1);
  const desde = clave(F29_DESDE.anio, F29_DESDE.mes), hasta = clave(anioActual, mesActual);
  const conMovimiento = new Set();
  for (const oc of ocs || []) {
    if (oc.archivada || tipo(oc) !== "venta") continue;
    for (const f of facturasVigentes(oc)) if (f.fecha) conMovimiento.add(String(f.fecha).slice(0, 7));
    for (const e of oc.eventos_compra || []) if (e.fecha) conMovimiento.add(String(e.fecha).slice(0, 7));
  }
  return [...conMovimiento].map((k) => ({ anio: Number(k.slice(0, 4)), mes: Number(k.slice(5, 7)) }))
    .filter(({ anio, mes }) => clave(anio, mes) >= desde && clave(anio, mes) <= hasta && !registroIvaDe(ivaMensual, anio, mes))
    .sort((a, b) => clave(a.anio, a.mes) - clave(b.anio, b.mes));
}

// Resumen completo del Panel: cada concepto por separado y el saldo proyectado.
export function resumenCaja({ ocs, financiadores, gastos, pagosVendedor, ivaMensual, vendedores, pagoFinSueltos, aportes, saldoBanco, hoy = new Date() }) {
  const anioActual = hoy.getFullYear(), mesActual = hoy.getMonth() + 1;
  const activas = (ocs || []).filter((o) => !o.archivada);
  const movs = movimientosCaja({ ocs: activas, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes });
  const conc = conciliacionBancaria(movs, saldoBanco);

  let porCobrar = 0, valeVista = 0, nValeVista = 0;
  for (const oc of activas) {
    if (tipo(oc) !== "venta") continue;
    const vv = valeVistasPendientes(oc).reduce((s, e) => s + n(e.monto), 0);
    nValeVista += valeVistasPendientes(oc).length;
    const pend = ingresoPendienteOC(oc);
    valeVista += Math.min(vv, pend);
    porCobrar += Math.max(0, pend - vv);
  }
  const porFinanciador = (financiadores || []).filter((f) => f.tipo !== "propio" && n(f.saldo_deuda) !== 0).map((f) => ({ id: f.id, nombre: f.nombre, saldo: n(f.saldo_deuda) }));
  const deudaFinanciadores = porFinanciador.reduce((s, f) => s + f.saldo, 0);
  const comisiones = comisionesPorPagar({ vendedores, ocs: activas, ivaMensual, pagosVendedor });
  const f29 = calcularF29({ ivaMensual, gastos, anioActual, mesActual });
  const ivaSinRegistrar = periodosIvaSinRegistrar({ ocs: activas, ivaMensual, anioActual, mesActual });
  // Dinero de ventas externas que entró a la cuenta y aún no se liquida a quien corresponde.
  const fondosExternos = movs.filter((x) => x.tipo === "cobro_externo" || x.tipo === "pago_externo").reduce((s, x) => s + x.monto, 0);

  const saldoProyectado = conc.caja + porCobrar + valeVista - deudaFinanciadores - comisiones.total - f29.total - Math.max(0, fondosExternos);
  const provisorio = ivaSinRegistrar.length > 0 || comisiones.provisorias > 0;
  return {
    caja: conc.caja, conciliacion: conc, porCobrar, valeVista, nValeVista,
    deudaFinanciadores, porFinanciador, comisiones, f29Pendiente: f29.total, f29, ivaSinRegistrar,
    fondosExternos: Math.max(0, fondosExternos), saldoProyectado, provisorio, movimientos: movs.length,
  };
}
