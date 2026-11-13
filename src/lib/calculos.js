// ═══════════════════════════════════════════════════════════════
// Reglas de negocio únicas (Fase 5).
// Cada regla vive aquí una sola vez; las pantallas la consumen.
// Estas funciones NO modifican datos: solo calculan.
// ═══════════════════════════════════════════════════════════════
import { C, fmt } from "./theme.js";
import { facturasVigentesDe, montoTributarioVigente, ivaDeDocumento, esFactura } from "./tributario.js";
import { tieneDesgloseF29, desgloseRegistroF29, usaReglaTotalF29 } from "./f29Desglose.js";

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

// ── Liquidación de la comisión de una OC (13/11/2026) ──
// La comisión queda ligada a la OC y a su liquidación ORIGINAL. Al anular y reemplazar una factura, la cobranza sigue a
// la factura vigente (facturaVigente), pero la comisión NO se mueve al mes de la nueva factura:
//  · anclada ...... comision_anio/comision_mes guardados en la OC (liquidación comprobada; los fija la base al marcarla
//                   pagada o la migración con evidencia de pagos). Manda sobre todo lo demás.
//  · refacturada .. alguna factura de la OC quedó anulada o reemplazada y la vigente cae en un mes POSTERIOR al de su
//                   primera factura: se liquida en el mes de su PRIMERA factura (su liquidación original), pagada o no.
//                   Si ese mes tuvo un pago parcial, el pago se reconoce y solo queda el saldo (deuda del mes).
//  · normal ....... el mes de su factura vigente más reciente (regla Fase 4C, sin cambios).
// Por revisar: comision_revision = 'por_revisar' (guardado), o una OC refacturada, no marcada pagada, cuya liquidación
// original es una planilla verificada sin detalle por OC (hasta LIQ_SIN_DETALLE_HASTA): no se puede comprobar si quedó
// cubierta. Si no está marcada pagada, NO entra en ningún cálculo ni pago hasta revisarla; si ya está marcada pagada se
// conserva donde se pagó (cierre histórico) con el aviso.
// Utilidad: una OC marcada pagada con utilidad liquidada (comision_utilidad) usa ESA utilidad; si la utilidad actual
// cambió, la diferencia se muestra aparte como ajuste por revisar (no entra en la comisión ni en el saldo).
export const LIQ_SIN_DETALLE_HASTA = { anio: 2026, mes: 6 };
const claveMes = (p) => (p ? Number(p.anio) * 12 + Number(p.mes) : null);
export const liquidacionComision = (oc) => {
  const vig = facturasVigentes(oc);
  const todas = (oc?.eventos_factura || []).filter((f) => esFactura(f) && f.fecha);
  const fv = facturaVigente(oc);
  const actual = fv?.fecha ? anioMesDe(fv.fecha) : null;
  const primera = todas.map((f) => String(f.fecha).slice(0, 10)).sort()[0];
  const original = primera ? anioMesDe(primera) : null;
  const anclada = oc?.comision_anio != null && oc?.comision_mes != null ? { anio: Number(oc.comision_anio), mes: Number(oc.comision_mes) } : null;
  const hayReemplazo = todas.some((f) => !vig.some((v) => v.id === f.id));
  const refacturada = hayReemplazo && !!original && (!actual || claveMes(original) < claveMes(actual));
  const pagada = !!oc?.vendedor_pagado;
  let periodo = anclada || (refacturada ? original : actual);
  if (!anclada && !vig.length) periodo = pagada ? original : null;   // anulada sin reemplazo: solo si ya se pagó
  let motivoRevision = null;
  if (oc?.comision_revision === "por_revisar") motivoRevision = oc.comision_revision_motivo || "Marcada por revisar";
  else if (!anclada && refacturada && !pagada && oc?.comision_revision !== "revisada" && claveMes(original) <= claveMes(LIQ_SIN_DETALLE_HASTA))
    motivoRevision = `Su liquidación original (${fmt.monthYear(original.mes, original.anio)}) es una planilla verificada sin detalle por OC: no se puede comprobar si quedó cubierta`;
  else if (!anclada && pagada && !vig.length && periodo) motivoRevision = "Factura anulada sin reemplazo después de pagada";
  const porRevisar = !!motivoRevision;
  const utilidadActual = (Number(oc?.monto_total) || 0) - (Number(oc?.costo_total) || 0);
  const utilidadLiquidada = pagada && oc?.comision_utilidad != null ? Number(oc.comision_utilidad) : null;
  return {
    periodo, actual, original, anclada: !!anclada, refacturada, pagada, porRevisar, motivoRevision,
    excluida: porRevisar && !pagada,
    utilidad: utilidadLiquidada ?? utilidadActual, utilidadActual, utilidadLiquidada,
    ajusteUtilidad: utilidadLiquidada != null ? utilidadActual - utilidadLiquidada : 0,
    // La factura vigente cae en otro mes que la liquidación: ese mes NO la incluye (refacturación).
    fueraDeSuMes: !!periodo && !!actual && claveMes(periodo) !== claveMes(actual),
  };
};

// Período de la comisión de una OC: el de su liquidación (ver liquidacionComision). Una OC entra en un solo mes.
export const periodoComision = (oc) => liquidacionComision(oc).periodo;

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
// Total del F29 REGISTRADO (desde agosto 2026 la comisión lo necesita para ser definitiva). 10/10/2026:
//  · El total (IVA + PPM y demás retenciones) se guarda en iva_pagado y SOLO cuenta si el usuario lo escribió:
//    desde agosto 2026 el formulario ya no copia el IVA a pagar como total (no se presume PPM $0).
//  · Registrado ⇔ total > 0 y total ≥ IVA a pagar (un total menor que su propio IVA es incoherente).
//  · iva_pagado es NOT NULL DEFAULT 0 en producción: 0 significa «total no registrado». Un F29 declarado
//    legítimamente en $0 no se puede distinguir sin un cambio de esquema (propuesta aparte): queda provisorio.
//  · 13/11/2026: un período registrado con el desglose del informe (desglose_f29) usa el PPM y las otras retenciones
//    registrados explícitamente: la comisión es definitiva cuando ambos están ingresados (un $0 explícito cuenta).
export const f29TotalRegistrado = (registro) => {
  if (!registro) return false;
  if (tieneDesgloseF29(registro)) {
    const d = desgloseRegistroF29(registro);
    // Desde octubre 2026 el descuento es el Total a pagar F29: definitivo solo con el desglose completo (remanente incluido).
    return usaReglaTotalF29(registro.anio, registro.mes) ? d.completo : d.retenciones !== null;
  }
  const total = Number(registro.iva_pagado);
  return Number.isFinite(total) && total > 0 && total >= ivaAPagarPeriodo(registro);
};
export const retencionesPeriodo = (registro) => {
  if (!registro || !aplicaRetenciones(registro.anio, registro.mes)) return 0;
  // Con el desglose del informe: PPM + otras retenciones registrados (pendientes cuentan $0 y la comisión queda provisoria).
  if (tieneDesgloseF29(registro)) { const d = desgloseRegistroF29(registro); return (d.ppm ?? 0) + (d.otras ?? 0); }
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

// ── Descuento tributario ÚNICO del período (IVA neto con signo + retenciones del F29 desde agosto 2026) ──
// Abril 2025 no descontaba IVA. Sin IVA registrado el descuento es 0 (comisión provisoria).
export const descuentoTributarioPeriodo = (ivaMensual, anio, mes) => {
  const sinIva = Number(anio) === 2025 && Number(mes) === 4;
  const ivaMes = sinIva ? null : registroIvaDe(ivaMensual, anio, mes);
  // 13/11/2026 12:48 (Kevin): desde octubre 2026, en un período con el desglose del informe COMPLETO, el descuento es el
  // Total a pagar F29 después del remanente = IVA a pagar + PPM + otras retenciones (aunque esté pendiente de pago).
  // impIva pasa a ser el IVA a pagar (tras el remanente), de modo que impIva + retenciones = descuentoF29 sigue valiendo.
  // Con datos pendientes, o antes de octubre 2026, se mantiene la regla anterior (y la comisión queda provisoria si faltan).
  if (ivaMes && tieneDesgloseF29(ivaMes) && usaReglaTotalF29(anio, mes)) {
    const d = desgloseRegistroF29(ivaMes);
    if (d.completo) return { sinIva, ivaMes, impIva: d.ivaAPagar, retenciones: d.retenciones, descuentoF29: d.total,
      reglaTotalF29: true, ivaNetoF29: d.ivaNeto, remanenteF29: d.remanente };
  }
  const impIva = ivaNetoPeriodo(ivaMes);          // con signo (0 si el período no tiene IVA registrado)
  const retenciones = retencionesPeriodo(ivaMes); // desde agosto 2026: PPM y demás retenciones del F29
  return { sinIva, ivaMes, impIva, retenciones, descuentoF29: impIva + retenciones };
};

// ── Comisión ordinaria del PERÍODO con uno o más vendedores (Etapa 4, 28/10/2026) ──
// Regla común para Vendedores, Panel, informes, caja y registro de pagos (todos usan calcularPagoVendedor):
//   comisión ordinaria total = max(0, redondeo((Σ utilidad ordinaria del período − descuento tributario único) / 2))
//   El descuento tributario se aplica UNA vez por período. Antes cada vendedor lo descontaba completo de su propia
//   utilidad, de modo que con dos o más vendedores el IVA y el PPM se descontaban dos o más veces.
//   Reparto entre los vendedores con ventas ordinarias del período, en proporción a su utilidad ordinaria POSITIVA, en
//   pesos enteros por el método del mayor resto (las partes suman exactamente el total; empates por id del vendedor).
// Casos definidos y probados (docs/pruebas-comisiones-multiples):
//   · Un solo vendedor con ventas ordinarias: idéntico al cálculo anterior (incluido el IVA neto negativo, que suma).
//   · Utilidad ordinaria de un vendedor negativa o cero: su resultado entra en la utilidad total del período (es de BFK)
//     y su parte es $0. Nunca hay pagos negativos ni porcentajes indefinidos.
//   · Utilidad total menor o igual al descuento: comisión total $0.
//   · Ningún vendedor con utilidad positiva y aun así total > 0 (solo por IVA neto negativo): partes iguales.
//   · Un vendedor con SOLO ventas propias en el período no participa del total ordinario ni recibe parte del descuento
//     (antes recibía la mitad del IVA neto negativo como si tuviera ventas ordinarias).
//   · Ventas propias (100% de su utilidad − IVA de su factura), montos verificados, pagos, extras por gestión y
//     anulaciones: sin cambios.
// Vigencia: desde COMISION_PERIODO_DESDE. Los períodos anteriores conservan el cálculo anterior por vendedor: no se
// recalculan comisiones pagadas, verificadas ni cierres. La comparación por período está en el informe de la Etapa 4.
export const COMISION_PERIODO_DESDE = { anio: 2026, mes: 10 };
export const aplicaComisionPeriodo = (anio, mes, desde = COMISION_PERIODO_DESDE) =>
  Number(anio) * 12 + Number(mes) >= desde.anio * 12 + desde.mes;

// Reparte un total en pesos enteros según pesos enteros ≥ 0 (mayor resto). pesos: [{ id, peso }]. Devuelve Map id → monto.
// Aritmética exacta con BigInt: las partes suman exactamente el total. Sin pesos positivos, partes iguales.
export const repartirComision = (total, pesos) => {
  const T = BigInt(Math.max(0, Math.round(Number(total) || 0)));
  const lista = [...pesos].map((p) => ({ id: String(p.id), peso: BigInt(Math.max(0, Math.round(Number(p.peso) || 0))) })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const res = new Map(lista.map((p) => [p.id, 0]));
  if (!lista.length || T === 0n) return res;
  let W = lista.reduce((s, p) => s + p.peso, 0n);
  if (W === 0n) { lista.forEach((p) => { p.peso = 1n; }); W = BigInt(lista.length); }
  const filas = lista.map((p, i) => ({ id: p.id, i, base: (T * p.peso) / W, resto: (T * p.peso) % W }));
  let sobrante = T - filas.reduce((s, f) => s + f.base, 0n);
  [...filas].sort((a, b) => (b.resto > a.resto ? 1 : b.resto < a.resto ? -1 : a.i - b.i)).forEach((f) => { if (sobrante > 0n) { f.base += 1n; sobrante -= 1n; } });
  filas.forEach((f) => res.set(f.id, Number(f.base)));
  return res;
};

// Utilidad ordinaria por vendedor de un período (OC que generan comisión, no venta propia, con vendedor asignado).
const utilidadOrdinariaPorVendedor = (ocs, anio, mes) => {
  const u = new Map();
  (ocs || []).forEach((o) => {
    if (!o?.vendedor_id || o.es_venta_propia || !generaComision(o)) return;
    const liq = liquidacionComision(o);
    const p = liq.periodo;
    if (!p || p.anio !== Number(anio) || p.mes !== Number(mes) || liq.excluida) return;
    u.set(o.vendedor_id, (u.get(o.vendedor_id) || 0) + liq.utilidad);
  });
  return u;
};

// Comisión ordinaria total del período y su reparto (solo cálculo; no lee pagos).
export const comisionOrdinariaPeriodo = ({ ocs, anio, mes, ivaMensual = [] }) => {
  const util = utilidadOrdinariaPorVendedor(ocs, anio, mes);
  const t = descuentoTributarioPeriodo(ivaMensual, anio, mes);
  const utilidadTotal = [...util.values()].reduce((s, x) => s + x, 0);
  const total = util.size ? Math.max(0, Math.round(utilidadTotal / 2 - t.descuentoF29 / 2)) : 0;
  const pesos = [...util.entries()].map(([id, x]) => ({ id, peso: Math.max(0, Math.round(x)) }));
  const pesoTotal = pesos.reduce((s, p) => s + p.peso, 0);
  const partes = repartirComision(total, pesos);
  const metodo = !util.size ? "sin_ventas_ordinarias" : util.size === 1 ? "un_vendedor" : total === 0 ? "sin_comision" : pesoTotal > 0 ? "proporcional" : "partes_iguales";
  return { anio: Number(anio), mes: Number(mes), vendedores: util.size, utilidades: util, utilidadTotal, ...t, total, pesos, pesoTotal, partes, metodo };
};

// Pago de un vendedor en un mes. Regla única:
//  · La comisión es sobre la UTILIDAD (venta − costo), no sobre lo facturado.
//  · Comisión ordinaria: su parte de la comisión ordinaria del período (comisionOrdinariaPeriodo, desde
//    COMISION_PERIODO_DESDE). Con un solo vendedor es la mitad de (utilidad − IVA neto del período − retenciones del
//    F29 desde ago-2026); el IVA neto se usa con su signo: si es negativo (más crédito que débito) suma; nunca baja de $0.
//    Antes de COMISION_PERIODO_DESDE: la fórmula anterior por vendedor (sin cambios en esos períodos).
//  · Abril 2025 no descontaba IVA.
//  · Las OC "venta propia" se pagan aparte: 100% de su utilidad menos el IVA de su factura.
//  · Si el mes está verificado (planilla o cartola), se usa ese monto.
// Devuelve null si el vendedor no tiene facturas ese mes.
export const calcularPagoVendedor = ({ vendedorId, ocs, anio, mes, ivaMensual = [], pagosVendedor = [] }) => {
  let sumaFacts = 0, sumaUtilidad = 0, pagoVentasPropias = 0, hayFacturas = false;
  const detalle = [];   // las OCs que forman el cálculo del mes (Fase 4C)
  const porRevisar = [], ajustes = [], refacturadasFuera = [];   // 13/11/2026: fuera del cálculo, solo para revisar
  ocs.filter((o) => o.vendedor_id === vendedorId && generaComision(o)).forEach((o) => {
    // 13/11/2026: el mes es el de su LIQUIDACIÓN (liquidacionComision); una refacturación no la mueve de mes.
    const liq = liquidacionComision(o);
    const p = liq.periodo;
    // Factura vigente en este mes pero liquidada en otro: no entra aquí (se informa para que se vea por qué).
    if (liq.fueraDeSuMes && liq.actual.anio === anio && liq.actual.mes === mes) refacturadasFuera.push({ ocId: o.id, numero_oc: o.numero_oc, liquidacion: p, pagada: liq.pagada });
    if (!p || p.anio !== anio || p.mes !== mes) return;
    hayFacturas = true;
    if (liq.excluida) { porRevisar.push({ ocId: o.id, numero_oc: o.numero_oc, utilidad: liq.utilidad, motivo: liq.motivoRevision, incluida: false }); return; }
    if (liq.porRevisar) porRevisar.push({ ocId: o.id, numero_oc: o.numero_oc, utilidad: liq.utilidad, motivo: liq.motivoRevision, incluida: true });
    if (liq.ajusteUtilidad) ajustes.push({ ocId: o.id, numero_oc: o.numero_oc, utilidadLiquidada: liq.utilidadLiquidada, utilidadActual: liq.utilidadActual, diferencia: liq.ajusteUtilidad });
    const vigentes = facturasVigentes(o);
    const montoFacts = vigentes.reduce((ss, ef) => ss + (Number(ef.monto) || 0), 0);
    const utilOC = liq.utilidad;
    const fv = facturaVigente(o);
    const linea = { ocId: o.id, numero_oc: o.numero_oc, cliente: o.cliente || o.entidad || "", factura: vigentes.map((f) => f.numero_factura).join(", "),
      fechaFactura: fv?.fecha || null, montoFacturas: montoFacts, venta: Number(o.monto_total) || 0, costo: Number(o.costo_total) || 0,
      utilidad: utilOC, ventaPropia: !!o.es_venta_propia, pagoVentaPropia: 0,
      // Solo cuando aplica (sin cambiar la forma de las líneas comunes):
      ...(liq.fueraDeSuMes ? { refacturada: true, facturaVigenteMes: liq.actual } : {}),
      ...(liq.porRevisar ? { porRevisar: true, motivoRevision: liq.motivoRevision } : {}),
      ...(liq.ajusteUtilidad ? { utilidadActual: liq.utilidadActual, ajusteUtilidad: liq.ajusteUtilidad } : {}) };
    if (o.es_venta_propia) {
      // IVA de su propia factura (fase 1 exentas, 20/10/2026): por documento vigente, el registrado o, si no hay,
      // 0 para DTE 34 y monto − monto/1,19 para DTE 33 (idéntico al cálculo anterior para facturas afectas).
      const ivaFactura = vigentes.reduce((ss, ef) => ss + ivaDeDocumento(ef), 0);
      linea.pagoVentaPropia = Math.max(0, Math.round(utilOC - ivaFactura));
      pagoVentasPropias += linea.pagoVentaPropia;
    } else {
      sumaFacts += montoFacts;
      sumaUtilidad += utilOC;
    }
    detalle.push(linea);
  });
  if (!hayFacturas) return null;
  const tribut = descuentoTributarioPeriodo(ivaMensual, anio, mes);
  const { sinIva, ivaMes, impIva, retenciones, descuentoF29 } = tribut;
  // Comisión ordinaria: su parte del período (regla común) o, antes de COMISION_PERIODO_DESDE, la fórmula anterior.
  const reglaPeriodo = aplicaComisionPeriodo(anio, mes);
  const per = reglaPeriodo ? comisionOrdinariaPeriodo({ ocs, anio, mes, ivaMensual }) : null;
  const comisionOrdinaria = per ? per.partes.get(String(vendedorId)) || 0 : Math.max(0, Math.round(sumaUtilidad / 2 - descuentoF29 / 2));
  const periodo = per ? { vendedores: per.vendedores, utilidadTotal: per.utilidadTotal, descuentoF29: per.descuentoF29, total: per.total, metodo: per.metodo,
    pesoTotal: per.pesoTotal, peso: per.pesos.find((p) => String(p.id) === String(vendedorId))?.peso || 0 } : null;
  const pagoCalculadoFormula = comisionOrdinaria + pagoVentasPropias;
  const pagosDelMes = pagosVendedor.filter((p) => pagoVigente(p) && p.vendedor_id === vendedorId && Number(p.mes) === mes && Number(p.anio) === anio);
  const pagado = pagosDelMes.reduce((s, p) => s + (Number(p.monto_pagado) || 0), 0);
  const extra = pagosDelMes.reduce((s, p) => s + extraGestion(p), 0);
  const transferido = pagosDelMes.reduce((s, p) => s + totalTransferido(p), 0);
  const verificado = pagosDelMes.find((p) => p.monto_verificado != null)?.monto_verificado;
  const esVerificado = verificado != null;
  const pagoCalculado = esVerificado ? verificado : pagoCalculadoFormula;
  return {
    mes, anio, label: fmt.monthYear(mes, anio), sumaFacts, sumaUtilidad, pagoVentasPropias, pagoCalculado, pagado,
    comisionOrdinaria, reglaPeriodo, periodo,   // desglose de la comisión ordinaria (regla común del período)
    estado: pagado >= pagoCalculado ? "pagado" : "pendiente", esVerificado, impIva, retenciones, descuentoF29, sinIva, ivaRegistrado: !!ivaMes,
    // Desde agosto 2026 la comisión descuenta el PPM del F29: sin el total del F29 registrado aún no es definitiva.
    f29Incompleto: !sinIva && !!ivaMes && aplicaRetenciones(anio, mes) && !f29TotalRegistrado(ivaMes),
    ivaVentas: ivaMes ? Number(ivaMes.iva_ventas) || 0 : 0, ivaCompras: ivaMes ? Number(ivaMes.iva_compras) || 0 : 0,
    // Solo en períodos con la regla del Total a pagar F29 (desde octubre 2026, desglose completo): datos para el desglose en pantalla.
    ...(tribut.reglaTotalF29 ? { reglaTotalF29: true, ivaNetoF29: tribut.ivaNetoF29, remanenteF29: tribut.remanenteF29 } : {}),
    deuda: Math.max(0, pagoCalculado - pagado),
    // Extra por gestión del período (aparte de la comisión) y total transferido; si la comisión bajó después de pagarla
    // (p. ej. al registrar el IVA), la diferencia queda como saldo por regularizar: no se reclasifica ningún pago.
    extraGestion: extra, transferido, pagos: pagosDelMes,
    porRegularizar: esVerificado ? 0 : Math.max(0, pagado - pagoCalculado),
    detalle: detalle.sort((a, b) => String(a.fechaFactura || "").localeCompare(String(b.fechaFactura || "")) || String(a.numero_oc).localeCompare(String(b.numero_oc))),
    // 13/11/2026 (solo cuando hay algo que informar): OC por revisar, ajustes de utilidad por revisar (aparte, no suman a la
    // comisión ni al saldo) y OC con factura vigente en este mes que se liquidan en otro.
    ...(porRevisar.length ? { porRevisar } : {}),
    ...(ajustes.length ? { ajustesUtilidad: ajustes, ajusteUtilidadTotal: ajustes.reduce((s2, a) => s2 + a.diferencia, 0) } : {}),
    ...(refacturadasFuera.length ? { refacturadasFuera } : {}),
  };
};

// ── Estado de la comisión de un mes (regla única: Vendedores, Panel, informes y pagos; 09/10/2026) ──
// Solo presentación: NO cambia el cálculo, los pagos ni las marcas de las OC.
//  · pagada ........ la comisión pagada del mes cubre la comisión calculada (deuda $0).
//  · en_curso ...... mes actual (o posterior): sigue acumulando ventas; no es deuda exigible.
//  · por_liquidar .. mes cerrado con comisión provisoria: falta el IVA del mes o, desde agosto 2026, el total del
//                    F29 (IVA + PPM). El monto puede cambiar; no es deuda exigible.
//  · pendiente ..... comisión definitiva (IVA y F29 registrados, o monto verificado) aún no pagada: deuda exigible.
export const ESTADOS_COMISION = { pagada: "Comisión pagada", en_curso: "En curso", por_liquidar: "Por liquidar (provisoria)", pendiente: "Pendiente de pago" };
// Provisoria = el monto aún puede cambiar (misma regla en todas las pantallas).
export const comisionProvisoria = (c) => !!c && !c.esVerificado && !c.sinIva && (!c.ivaRegistrado || !!c.f29Incompleto);
// Mes actual o posterior según la fecha de hoy (hora local del navegador).
export const esMesEnCurso = (anio, mes, hoy = new Date()) => Number(anio) * 12 + Number(mes) >= hoy.getFullYear() * 12 + hoy.getMonth() + 1;
export const estadoComisionMes = (c, hoy = new Date()) => {
  if (!c) return null;
  if (!(c.deuda > 0)) return "pagada";
  if (esMesEnCurso(c.anio, c.mes, hoy)) return "en_curso";
  return comisionProvisoria(c) ? "por_liquidar" : "pendiente";
};
// Motivo legible de una comisión provisoria.
export const motivoProvisoria = (c) => (!c?.ivaRegistrado ? "IVA sin registrar" : c?.f29Incompleto ? "falta el total del F29 (IVA + PPM)" : "");
