// ═══════════════════════════════════════════════════════════════
// Reglas de negocio únicas (Fase 5).
// Cada regla vive aquí una sola vez; las pantallas la consumen.
// Estas funciones NO modifican datos: solo calculan.
// ═══════════════════════════════════════════════════════════════
import { C, fmt } from "./theme.js";
import { facturasVigentesDe, montoTributarioVigente } from "./tributario.js";

// ── Facturas vigentes (regla 4, Fase 4B · modelo tributario SII) ──
// La regla vive en lib/tributario.js (misma que la base, fin_facturas_vigentes):
// solo facturas (no NC/ND); anulada si una NC código 1 la referencia o si otra
// factura de la OC la reemplazó (reemisión antigua). Una NC código 2 (corrige
// texto) NO anula ni cambia montos.
export const facturasVigentes = (oc) => facturasVigentesDe(oc);
// Una factura de la OC (por id) que ya no está vigente.
export const facturaAnulada = (oc, f) => !facturasVigentesDe(oc).some((v) => v.id === f?.id);
export { montoTributarioVigente };

// ── Factura vigente ───────────────────────────────────────────
// La vigente más reciente por fecha (para el plazo de cobro). Si hubo
// reemisión, la anulada nunca es la que hay que cobrar.
export const facturaVigente = (oc) => {
  // Fase 4C: solo entre las vigentes (si todas están anuladas no hay factura que cobrar ni comisionar).
  return facturasVigentes(oc).slice().sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")) || String(b.numero_factura || "").localeCompare(String(a.numero_factura || ""), "es", { numeric: true }))[0] || null;
};

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
// Solo una VENTA de BFK con factura emitida genera comisión. Una venta externa (el vendedor la cobró y el
// dinero es suyo) o un aporte nunca generan comisión, aunque tengan vendedor asignado.
// Tampoco una venta de capitalización de BFK Ltda. ni una OC con la comisión excluida (vendedor asignado después del
// cierre del mes: figura con su vendedor, pero no altera la comisión ya cerrada de ese mes).
export const generaComision = (o) => (o?.tipo_registro || "venta") === "venta" && o?.estado_factura_propia === "emitida"
  && !o?.capitalizacion_bfk && !o?.comision_excluida;
export const mesesConFactura = (vendedorId, ocs) => {
  const set = new Set();
  ocs.filter((o) => o.vendedor_id === vendedorId && generaComision(o)).forEach((o) => {
    const p = periodoComision(o);
    if (p) set.add(`${p.anio}-${String(p.mes).padStart(2, "0")}`);
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a)).map((ym) => ({ anio: Number(ym.slice(0, 4)), mes: Number(ym.slice(5, 7)) }));
};

// Período de la comisión de una OC (Fase 4C): el mes de su factura VIGENTE (la más reciente
// entre las vigentes). Una OC entra en un solo mes: una factura anulada o un registro duplicado
// nunca la hace contar en otro mes.
export const periodoComision = (oc) => {
  const f = facturaVigente(oc);
  return f?.fecha ? anioMesDe(f.fecha) : null;
};

// ── IVA del período (regla única) ─────────────────────────────
// Registro de iva_mensual de un período (mes/año).
export const registroIvaDe = (ivaMensual, anio, mes) =>
  (ivaMensual || []).find((i) => Number(i.mes) === Number(mes) && Number(i.anio) === Number(anio)) || null;
// IVA NETO del período = IVA débito (ventas) − IVA crédito (compras). Puede ser
// positivo, cero o negativo (crédito mayor que débito). Es el que usa la comisión:
// la utilidad se calcula con montos que incluyen IVA, y la parte que corresponde al
// IVA neto del período no es ganancia. No depende de lo pagado al SII.
export const ivaNetoPeriodo = (registro) =>
  registro ? (Number(registro.iva_ventas) || 0) - (Number(registro.iva_compras) || 0) : 0;
// IVA A PAGAR del período (F29): el neto si es positivo; si es negativo no se paga
// nada (queda remanente de crédito). Solo para compromisos con el SII, no para comisiones.
export const ivaAPagarPeriodo = (registro) => Math.max(0, ivaNetoPeriodo(registro));
// RETENCIONES del F29 (PPM, honorarios, etc.) que también se descuentan en la comisión
// desde agosto 2026 (decisión del 2026-10-06: se descuenta el total a pagar del F29,
// IVA + retenciones). Se obtienen del total pagado del F29, guardado en iva_pagado:
// retenciones = total pagado − IVA a pagar (nunca negativo). Antes de esa fecha
// iva_pagado significaba "IVA a pagar" y no se usa: los meses anteriores no cambian.
export const RETENCIONES_DESDE = { anio: 2026, mes: 8 };
export const aplicaRetenciones = (anio, mes) =>
  Number(anio) * 12 + Number(mes) >= RETENCIONES_DESDE.anio * 12 + RETENCIONES_DESDE.mes;
export const retencionesPeriodo = (registro) => {
  if (!registro || !aplicaRetenciones(registro.anio, registro.mes)) return 0;
  return Math.max(0, Math.round((Number(registro.iva_pagado) || 0) - ivaAPagarPeriodo(registro)));
};

// ── Pagos a vendedores: una transferencia, dos componentes (08/10/2026) ──
//  monto_pagado ........ parte aplicada a la COMISIÓN del período (único monto que cuenta para la comisión).
//  monto_extra_gestion . excedente sobre la comisión pendiente: extra por gestión del mismo período (no es comisión).
//  monto_transferido ... total de la transferencia (= comisión + extra). Pagos históricos: null → total = monto_pagado.
//  anulado_en .......... pago anulado: se conserva, pero no cuenta en comisión ni en caja.
export const pagoVigente = (p) => !p?.anulado_en;
export const totalTransferido = (p) => (p?.monto_transferido != null ? Number(p.monto_transferido) || 0 : Number(p?.monto_pagado) || 0);
export const extraGestion = (p) => Number(p?.monto_extra_gestion) || 0;

// Pago de un vendedor en un mes. Regla única:
//  · La comisión es sobre la UTILIDAD (venta − costo), no sobre lo facturado.
//  · Mitad de (utilidad − IVA neto del período − retenciones del F29 desde ago-2026).
//    El IVA neto se usa con su signo:
//    si es negativo (más crédito que débito) suma; la comisión nunca baja de $0.
//  · Abril 2025 no descontaba IVA.
//  · Las OC "venta propia" se pagan aparte: 100% de su utilidad menos el IVA de su factura.
//  · Si el mes está verificado (planilla o cartola), se usa ese monto.
// Devuelve null si el vendedor no tiene facturas ese mes.
export const calcularPagoVendedor = ({ vendedorId, ocs, anio, mes, ivaMensual = [], pagosVendedor = [] }) => {
  let sumaFacts = 0, sumaUtilidad = 0, pagoVentasPropias = 0, hayFacturas = false;
  const detalle = [];   // las OCs que forman el cálculo del mes (Fase 4C)
  ocs.filter((o) => o.vendedor_id === vendedorId && generaComision(o)).forEach((o) => {
    // Regla 4: solo la factura vigente define el mes; una anulada no vuelve a generar comisión.
    const p = periodoComision(o);
    if (!p || p.anio !== anio || p.mes !== mes) return;
    hayFacturas = true;
    const vigentes = facturasVigentes(o);
    const montoFacts = vigentes.reduce((ss, ef) => ss + (Number(ef.monto) || 0), 0);
    const utilOC = (Number(o.monto_total) || 0) - (Number(o.costo_total) || 0);
    const fv = facturaVigente(o);
    const linea = { ocId: o.id, numero_oc: o.numero_oc, cliente: o.cliente || o.entidad || "", factura: vigentes.map((f) => f.numero_factura).join(", "),
      fechaFactura: fv?.fecha || null, montoFacturas: montoFacts, venta: Number(o.monto_total) || 0, costo: Number(o.costo_total) || 0,
      utilidad: utilOC, ventaPropia: !!o.es_venta_propia, pagoVentaPropia: 0 };
    if (o.es_venta_propia) {
      const ivaFactura = montoFacts - montoFacts / 1.19;
      linea.pagoVentaPropia = Math.max(0, Math.round(utilOC - ivaFactura));
      pagoVentasPropias += linea.pagoVentaPropia;
    } else {
      sumaFacts += montoFacts;
      sumaUtilidad += utilOC;
    }
    detalle.push(linea);
  });
  if (!hayFacturas) return null;
  const sinIva = anio === 2025 && mes === 4;
  const ivaMes = sinIva ? null : registroIvaDe(ivaMensual, anio, mes);
  const impIva = ivaNetoPeriodo(ivaMes); // con signo (0 si el período no tiene IVA registrado)
  const retenciones = retencionesPeriodo(ivaMes); // desde agosto 2026: PPM y demás retenciones del F29
  const descuentoF29 = impIva + retenciones;
  const pagoCalculadoFormula = Math.max(0, Math.round(sumaUtilidad / 2 - descuentoF29 / 2)) + pagoVentasPropias;
  const pagosDelMes = pagosVendedor.filter((p) => pagoVigente(p) && p.vendedor_id === vendedorId && Number(p.mes) === mes && Number(p.anio) === anio);
  const pagado = pagosDelMes.reduce((s, p) => s + (Number(p.monto_pagado) || 0), 0);
  const extra = pagosDelMes.reduce((s, p) => s + extraGestion(p), 0);
  const transferido = pagosDelMes.reduce((s, p) => s + totalTransferido(p), 0);
  const verificado = pagosDelMes.find((p) => p.monto_verificado != null)?.monto_verificado;
  const esVerificado = verificado != null;
  const pagoCalculado = esVerificado ? verificado : pagoCalculadoFormula;
  return {
    mes, anio, label: fmt.monthYear(mes, anio), sumaFacts, sumaUtilidad, pagoVentasPropias, pagoCalculado, pagado,
    estado: pagado >= pagoCalculado ? "pagado" : "pendiente", esVerificado, impIva, retenciones, descuentoF29, sinIva, ivaRegistrado: !!ivaMes,
    ivaVentas: ivaMes ? Number(ivaMes.iva_ventas) || 0 : 0, ivaCompras: ivaMes ? Number(ivaMes.iva_compras) || 0 : 0,
    deuda: Math.max(0, pagoCalculado - pagado),
    // Extra por gestión del período (aparte de la comisión) y total transferido; si la comisión bajó después de pagarla
    // (p. ej. al registrar el IVA), la diferencia queda como saldo por regularizar: no se reclasifica ningún pago.
    extraGestion: extra, transferido, pagos: pagosDelMes,
    porRegularizar: esVerificado ? 0 : Math.max(0, pagado - pagoCalculado),
    detalle: detalle.sort((a, b) => String(a.fechaFactura || "").localeCompare(String(b.fechaFactura || "")) || String(a.numero_oc).localeCompare(String(b.numero_oc))),
  };
};
