// ═══════════════════════════════════════════════════════════════
// Reglas de negocio únicas (Fase 5).
// Cada regla vive aquí una sola vez; las pantallas la consumen.
// Estas funciones NO modifican datos: solo calculan.
// ═══════════════════════════════════════════════════════════════
import { C, fmt } from "./theme.js";

// ── Factura vigente ───────────────────────────────────────────
// La más reciente por fecha: si hubo reemisión (NC de por medio), la
// primera del arreglo sería la anulada, no la que hay que cobrar.
export const facturaVigente = (oc) =>
  (oc.eventos_factura || []).slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];

// Año y mes leídos del texto "YYYY-MM-DD" (sin Date) para evitar el
// corrimiento de zona horaria que mueve el día 1 al mes anterior.
export const anioMesDe = (fechaStr) => {
  const [y, m] = String(fechaStr).slice(0, 10).split("-");
  return { anio: Number(y), mes: Number(m) };
};

// ── Vencimiento de factura ────────────────────────────────────
// Plazo real de la OC (15, 30, 50 o 60 días). 30 por defecto.
export const plazoPago = (oc) => (Number(oc?.dias_pago) > 0 ? Number(oc.dias_pago) : 30);

// vencida: cumplió el plazo · reclamar: 9 días o más después del plazo ·
// porVencer: quedan 5 días o menos.
export const estadoVencimiento = (dias, plazo) => {
  const vencida = dias >= plazo;
  return {
    vencida,
    reclamar: dias >= plazo + 9,
    porVencer: !vencida && dias >= plazo - 5,
    diasRestantes: plazo - dias,
  };
};

// ── Margen y ganancia ─────────────────────────────────────────
// Ganancia considerando los costos de post-venta (salen de la utilidad).
export const costoPostventa = (oc) =>
  (oc?.eventos_postventa || []).reduce((s, e) => s + (Number(e.costo_extra) || 0), 0);

const semaforo = (pct) => ({
  color: pct >= 20 ? C.ok : pct >= 10 ? C.warn : C.danger,
  bg: pct >= 20 ? C.okLight : pct >= 10 ? C.warnLight : C.dangerLight,
});

export const gananciaReal = (oc) => {
  const venta = Number(oc?.monto_total) || 0;
  const costo = (Number(oc?.costo_total) || 0) + costoPostventa(oc);
  const pesos = venta - costo;
  const pct = venta > 0 ? Math.round((pesos / venta) * 100) : 0;
  return { venta, costo, pesos, pct, ...semaforo(pct), extra: costoPostventa(oc) };
};

export const calcMargen = (venta, costo) => {
  const v = Number(venta) || 0;
  const c = Number(costo) || 0;
  if (v <= 0) return { pesos: 0, pct: 0, color: C.danger, bg: C.dangerLight };
  const pesos = v - c;
  const pct = Math.round((pesos / v) * 100);
  return { pesos, pct, ...semaforo(pct) };
};

// ── Comisión de vendedores ────────────────────────────────────
// Meses (YYYY-MM) en que el vendedor tiene facturas emitidas.
export const mesesConFactura = (vendedorId, ocs) => {
  const set = new Set();
  ocs.filter((o) => o.vendedor_id === vendedorId && o.estado_factura_propia === "emitida").forEach((o) => {
    (o.eventos_factura || []).forEach((ef) => {
      const { anio, mes } = anioMesDe(ef.fecha);
      set.add(`${anio}-${String(mes).padStart(2, "0")}`);
    });
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a)).map((ym) => ({ anio: Number(ym.slice(0, 4)), mes: Number(ym.slice(5, 7)) }));
};

// Pago de un vendedor en un mes. Regla única:
//  · La comisión es sobre la UTILIDAD (venta − costo), no sobre lo facturado.
//  · Mitad de (utilidad − IVA del mes). El IVA nunca es negativo.
//  · Abril 2025 no descontaba IVA.
//  · Las OC "venta propia" se pagan aparte: 100% de su utilidad menos el IVA de su factura.
//  · Si el mes está verificado (planilla o cartola), se usa ese monto.
// Devuelve null si el vendedor no tiene facturas ese mes.
export const calcularPagoVendedor = ({ vendedorId, ocs, anio, mes, ivaMensual = [], pagosVendedor = [] }) => {
  let sumaFacts = 0, sumaUtilidad = 0, pagoVentasPropias = 0, hayFacturas = false;
  ocs.filter((o) => o.vendedor_id === vendedorId && o.estado_factura_propia === "emitida").forEach((o) => {
    const factsMes = (o.eventos_factura || []).filter((ef) => {
      const p = anioMesDe(ef.fecha);
      return p.anio === anio && p.mes === mes;
    });
    if (!factsMes.length) return;
    hayFacturas = true;
    const montoFacts = factsMes.reduce((ss, ef) => ss + (ef.monto || 0), 0);
    const utilOC = (Number(o.monto_total) || 0) - (Number(o.costo_total) || 0);
    if (o.es_venta_propia) {
      const ivaFactura = montoFacts - montoFacts / 1.19;
      pagoVentasPropias += Math.max(0, Math.round(utilOC - ivaFactura));
    } else {
      sumaFacts += montoFacts;
      sumaUtilidad += utilOC;
    }
  });
  if (!hayFacturas) return null;
  const sinIva = anio === 2025 && mes === 4;
  const ivaMes = sinIva ? null : ivaMensual.find((i) => i.mes === mes && i.anio === anio);
  const impIva = ivaMes ? Math.max(0, (ivaMes.iva_ventas || 0) - (ivaMes.iva_compras || 0)) : 0;
  const pagoCalculadoFormula = Math.max(0, Math.round(sumaUtilidad / 2 - impIva / 2)) + pagoVentasPropias;
  const pagosDelMes = pagosVendedor.filter((p) => p.vendedor_id === vendedorId && p.mes === mes && p.anio === anio);
  const pagado = pagosDelMes.reduce((s, p) => s + (p.monto_pagado || 0), 0);
  const verificado = pagosDelMes.find((p) => p.monto_verificado != null)?.monto_verificado;
  const esVerificado = verificado != null;
  const pagoCalculado = esVerificado ? verificado : pagoCalculadoFormula;
  return {
    mes, anio, label: fmt.monthYear(mes, anio), sumaFacts, sumaUtilidad, pagoVentasPropias, pagoCalculado, pagado,
    estado: pagado >= pagoCalculado ? "pagado" : "pendiente", esVerificado, impIva, sinIva, ivaRegistrado: !!ivaMes,
    deuda: Math.max(0, pagoCalculado - pagado),
  };
};
