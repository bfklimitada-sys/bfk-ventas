// ═══════════════════════════════════════════════════════════════
// Caja, compromisos y conciliación bancaria del Panel (cierre financiero).
// Funciones puras: solo leen lo cargado, no escriben.
//
// UN SOLO universo de movimientos de dinero (movimientosCaja). Con él se calculan:
//  · Caja registrada BFK   = suma de todos los movimientos registrados en BFK, incluidos los que nunca
//                            pasaron por BancoEstado (compras anteriores a la apertura, compras pagadas
//                            por un socio, pagos compensados fuera del banco). Es un control, no dinero disponible.
//  · Saldo bancario        = saldo informado de BancoEstado a la fecha de corte + movimientos registrados
//                            después del corte (saldo esperado hoy). Es el único dinero disponible.
//  · Diferencia banco − caja registrada: se explica con el expediente de conciliación (operaciones fuera
//    del banco, compensaciones, partidas pendientes de prueba). No es pérdida ni ganancia.
// Saldo proyectado (cuadratura 2026-10): parte del SALDO BANCARIO, no de la caja registrada. Las
// operaciones fuera del banco ya ocurrieron (no vuelven a mover la cuenta) y las deudas que dejaron
// pendientes ya están en el saldo de cada financiador; partir de la caja registrada las descontaba dos veces.
// Sin saldo bancario registrado, la proyección parte de la caja registrada y se indica.
// Compromisos: todos los pendientes, sin importar el mes en que nacieron. Lo que depende de un IVA
// todavía no registrado (F29 y comisiones de esos meses) se marca como PROVISORIO, nunca como definitivo.
// ═══════════════════════════════════════════════════════════════
import { calcularPagoVendedor, estadoComisionMes, facturasVigentes, mesesConFactura, pagoVigente, registroIvaDe, totalTransferido, extraGestion } from "./calculos.js";
import { F29_DESDE, calcularF29 } from "./f29.js";
import { ingresoPendienteOC, valeVistasPendientes } from "./ocs.js";
import { aporteEnCaja, cobroEnCaja, gastoEnCaja } from "./mediosPago.js";

const n = (v) => Number(v) || 0;
const f10 = (v) => (v ? String(v).slice(0, 10) : "");
const tipo = (oc) => oc?.tipo_registro || "venta";
// OCs cuyo dinero pasa por la cuenta de BFK: ventas y ventas externas (estas últimas con su pasivo aparte).
const enCuenta = (oc) => !oc?.archivada && (tipo(oc) === "venta" || tipo(oc) === "externa" || tipo(oc) === "aporte_socio");

// Universo único de movimientos de dinero. Cada uno: { fecha, tipo, monto (+ entra / − sale), ref }.
export function movimientosCaja({ ocs, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes }) {
  const propio = new Set((financiadores || []).filter((f) => f.tipo === "propio").map((f) => f.id));
  const m = [];
  for (const oc of ocs || []) {
    if (!enCuenta(oc)) continue;
    // Solo lo que entró a la cuenta: sin vale vistas por cobrar ni cobros fuera de banco (retención, cobro directo del vendedor).
    for (const e of oc.eventos_pago_cliente || []) if (cobroEnCaja(e)) m.push({ fecha: f10(e.fecha), tipo: tipo(oc) === "externa" ? "cobro_externo" : "cobro", monto: n(e.monto), ref: oc.numero_oc });
    for (const e of oc.eventos_pago_financiamiento || []) m.push({ fecha: f10(e.fecha), tipo: tipo(oc) === "externa" ? "pago_externo" : "pago_financiador", monto: -n(e.monto), ref: oc.numero_oc });
    // Fondos propios (Cuenta BFK): la compra la pagó la cuenta de BFK.
    if (propio.has(oc.financiador_id) && !oc.es_venta_propia)
      for (const e of oc.eventos_compra || []) m.push({ fecha: f10(e.fecha), tipo: "compra_fondos_propios", monto: -n(e.costo_compra), ref: oc.numero_oc });
  }
  for (const e of pagoFinSueltos || []) m.push({ fecha: f10(e.fecha), tipo: "pago_financiador", monto: -n(e.monto), ref: e.financiador_id });
  for (const g of gastos || []) if (gastoEnCaja(g)) m.push({ fecha: f10(g.fecha), tipo: "gasto", monto: -n(g.monto), ref: g.categoria_id });
  // Una transferencia = un solo movimiento por su total (comisión + extra por gestión); los anulados no son caja.
  for (const p of pagosVendedor || []) if (pagoVigente(p)) m.push({ fecha: f10(p.fecha), tipo: "pago_vendedor", monto: -totalTransferido(p), extraGestion: extraGestion(p), ref: p.vendedor_id });
  for (const a of aportes || []) if (aporteEnCaja(a)) m.push({ fecha: f10(a.fecha), tipo: a.tipo === "retiro" ? "retiro" : "aporte", monto: (a.tipo === "retiro" ? -1 : 1) * n(a.monto), ref: a.socio });
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

// Comisiones impagas de TODOS los meses (no solo el actual), separadas por estado (regla única en calculos.js):
//  · exigible (pendiente de pago) ... comisión definitiva aún no pagada: es la única deuda exigible con el vendedor.
//  · porLiquidar .................... mes cerrado con comisión provisoria (falta IVA o total del F29).
//  · enCurso ........................ mes actual: sigue acumulando ventas.
// total = exigible + porLiquidar + enCurso (el saldo proyectado descuenta las tres, igual que antes).
// definitivas = exigible; provisorias = porLiquidar + enCurso (no son definitivas).
export function comisionesPorPagar({ vendedores, ocs, ivaMensual, pagosVendedor, hoy = new Date() }) {
  const detalle = [];
  for (const v of vendedores || []) {
    for (const { anio, mes } of mesesConFactura(v.id, ocs || [])) {
      const r = calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual, pagosVendedor });
      if (!r || !(r.deuda > 0)) continue;
      const estado = estadoComisionMes(r, hoy);
      detalle.push({ vendedorId: v.id, vendedor: v.nombre, anio, mes, deuda: r.deuda, estado, provisoria: estado !== "pendiente" });
    }
  }
  const suma = (e) => detalle.filter((d) => d.estado === e).reduce((s, d) => s + d.deuda, 0);
  const exigible = suma("pendiente"), porLiquidar = suma("por_liquidar"), enCurso = suma("en_curso");
  const total = exigible + porLiquidar + enCurso;
  return { total, exigible, porLiquidar, enCurso, definitivas: exigible, provisorias: porLiquidar + enCurso, detalle };
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

  // Por cobrar = facturas vigentes por cobrar + ventas ya compradas que aún no se facturan (sin vale vista pendiente).
  let porCobrar = 0, facturasPorCobrar = 0, ventasPorFacturar = 0, valeVista = 0, nValeVista = 0;
  for (const oc of activas) {
    if (tipo(oc) !== "venta") continue;
    const vv = valeVistasPendientes(oc).reduce((s, e) => s + n(e.monto), 0);
    nValeVista += valeVistasPendientes(oc).length;
    const pend = ingresoPendienteOC(oc);
    valeVista += Math.min(vv, pend);
    const neto = Math.max(0, pend - vv);
    porCobrar += neto;
    if (n(oc.monto_facturado) > 0) facturasPorCobrar += neto; else ventasPorFacturar += neto;
  }
  const porFinanciador = (financiadores || []).filter((f) => f.tipo !== "propio" && n(f.saldo_deuda) !== 0).map((f) => ({ id: f.id, nombre: f.nombre, saldo: n(f.saldo_deuda) }));
  const deudaFinanciadores = porFinanciador.reduce((s, f) => s + f.saldo, 0);
  const comisiones = comisionesPorPagar({ vendedores, ocs: activas, ivaMensual, pagosVendedor, hoy });
  const f29 = calcularF29({ ivaMensual, gastos, anioActual, mesActual });
  const ivaSinRegistrar = periodosIvaSinRegistrar({ ocs: activas, ivaMensual, anioActual, mesActual });
  // Dinero de ventas externas que entró a la cuenta y aún no se liquida a quien corresponde.
  const fondosExternos = movs.filter((x) => x.tipo === "cobro_externo" || x.tipo === "pago_externo").reduce((s, x) => s + x.monto, 0);

  // Base de la proyección: el saldo bancario esperado hoy; solo sin saldo de banco registrado, la caja registrada.
  const saldoBancario = conc.hayCorte ? conc.esperado : null;
  const baseProyeccion = conc.hayCorte ? conc.esperado : conc.caja;
  const diferenciaBancoCaja = conc.hayCorte ? conc.esperado - conc.caja : null;
  const saldoProyectado = baseProyeccion + porCobrar + valeVista - deudaFinanciadores - comisiones.total - f29.total - Math.max(0, fondosExternos);
  const provisorio = ivaSinRegistrar.length > 0 || comisiones.provisorias > 0 || (f29.faltaTotal || []).length > 0;
  return {
    caja: conc.caja, conciliacion: conc, saldoBancario, baseProyeccion, baseEsBanco: conc.hayCorte, diferenciaBancoCaja,
    porCobrar, facturasPorCobrar, ventasPorFacturar, valeVista, nValeVista,
    deudaFinanciadores, porFinanciador, comisiones, f29Pendiente: f29.total, f29, ivaSinRegistrar,
    fondosExternos: Math.max(0, fondosExternos), saldoProyectado, provisorio, movimientos: movs.length,
  };
}
