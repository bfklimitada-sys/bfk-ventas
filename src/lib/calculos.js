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
export const mesesConFactura = (vendedorId, ocs, cierres = null) => {
  const set = new Set();
  // Un mes con liquidación cerrada sigue apareciendo aunque hoy ninguna OC calce en él (15/11/2026).
  (cierres?.liquidaciones || []).filter((l) => l.vendedor_id === vendedorId).forEach((l) => set.add(`${l.anio}-${String(l.mes).padStart(2, "0")}`));
  ocsParaComision(ocs, cierres).filter((o) => o.vendedor_id === vendedorId && generaComision(o)).forEach((o) => {
    const p = periodoComision(o);
    if (p) set.add(`${p.anio}-${String(p.mes).padStart(2, "0")}`);
  });
  return Array.from(set).sort((a, b) => b.localeCompare(a)).map((ym) => ({ anio: Number(ym.slice(0, 4)), mes: Number(ym.slice(5, 7)) }));
};

// ── Liquidación de la comisión de una OC (regla definitiva, Kevin 13/11/2026 16:15; vigente desde NOVIEMBRE 2026) ──
// La comisión queda ligada a la OC y a su LIQUIDACIÓN; la cobranza sigue a la factura vigente (facturaVigente).
// Liquidación de la OC:
//  · anclada ...... comision_anio/comision_mes (la base la fija al marcarla pagada o la migración con evidencia).
//  · refacturada .. alguna factura anulada o reemplazada y la vigente en un mes posterior → mes de su PRIMERA factura.
//  · normal ....... mes de su factura vigente más reciente (regla Fase 4C).
// Período en que CUENTA la comisión (periodo), una sola vez y para siempre:
//  · período cerrado (comision_cierre_anio/mes): el mes en que la OC ya fue considerada hasta octubre 2026, registrado
//    por la base el 13/11/2026 tal como se calculaba. No cambia aunque la OC se anule y refacture una o varias veces,
//    en cualquier mes o año: así los cálculos, liquidaciones y pagos hasta octubre 2026 quedan intactos.
//  · liquidación desde noviembre 2026 (VIGENCIA_LIQUIDACION) → su liquidación (una refacturación posterior no la mueve).
//  · nunca considerada (sin período cerrado) y con liquidación anterior a noviembre:
//      pagada → no cuenta en ningún mes (ya se pagó; no genera nueva comisión);
//      no pagada y refacturada hacia noviembre o después → su PRIMER período válido: el mes de su primera factura desde
//      noviembre 2026 (fijo; nuevas refacturaciones no la mueven). Si su liquidación original tuvo un pago (posible pago
//      parcial que la cubrió) queda «Por revisar» y fuera de todo pago hasta revisarla;
//  · OC creada después del cierre (comision_tras_cierre, la marca la base) con factura de un período cerrado →
//    primer período abierto (noviembre 2026), fijo y con aviso. Las demás OC sin período cerrado: regla anterior.
// Por revisar guardado (comision_revision = 'por_revisar'): se conserva donde se calcula hoy, con aviso, y no se marca en
// ningún pago. Utilidad liquidada (comision_utilidad, solo desde noviembre 2026): si la utilidad actual cambió, la diferencia
// se muestra aparte como ajuste por revisar (no entra en la comisión ni en el saldo).
export const VIGENCIA_LIQUIDACION = { anio: 2026, mes: 11 };   // 13/11/2026 15:42 (Kevin): desde noviembre; octubre queda como estaba
const claveMes = (p) => (p ? Number(p.anio) * 12 + Number(p.mes) : null);
const mismoMes = (a, b) => !!a && !!b && claveMes(a) === claveMes(b);
export const liquidacionComision = (oc, pagosVendedor = null) => {
  const vig = facturasVigentes(oc);
  const todas = (oc?.eventos_factura || []).filter((f) => esFactura(f) && f.fecha);
  const fv = facturaVigente(oc);
  const actual = fv?.fecha ? anioMesDe(fv.fecha) : null;   // mes de la factura vigente (regla anterior)
  const primera = todas.map((f) => String(f.fecha).slice(0, 10)).sort()[0];
  const original = primera ? anioMesDe(primera) : null;
  const anclada = oc?.comision_anio != null && oc?.comision_mes != null ? { anio: Number(oc.comision_anio), mes: Number(oc.comision_mes) } : null;
  const hayReemplazo = todas.some((f) => !vig.some((v) => v.id === f.id));
  const refacturada = hayReemplazo && !!original && (!actual || claveMes(original) < claveMes(actual));
  const pagada = !!oc?.vendedor_pagado;
  let liquidacion = anclada || (refacturada ? original : actual);
  if (!anclada && !vig.length) liquidacion = pagada ? original : null;   // anulada sin reemplazo: solo si ya se pagó
  const desde = claveMes(VIGENCIA_LIQUIDACION);
  const cierre = oc?.comision_cierre_anio != null && oc?.comision_cierre_mes != null ? { anio: Number(oc.comision_cierre_anio), mes: Number(oc.comision_cierre_mes) } : null;
  let periodo, motivoRevision = null, derivada = false, motivoPeriodo = null;
  if (cierre) periodo = cierre;   // período cerrado (hasta octubre 2026): definitivo
  else if (liquidacion && claveMes(liquidacion) >= desde) periodo = liquidacion;
  else if (liquidacion && oc?.comision_tras_cierre) {
    // OC creada después del cierre con factura de un período cerrado: primer período abierto (fijo).
    periodo = { ...VIGENCIA_LIQUIDACION };
    motivoPeriodo = `Factura de ${fmt.monthYear(liquidacion.mes, liquidacion.anio)}, período ya cerrado: se considera en el primer período abierto`;
  } else if (liquidacion && actual && claveMes(actual) >= desde) {
    if (pagada) periodo = null;
    else {
      // Primer período válido: el mes de su primera factura desde noviembre 2026 (no se mueve con nuevas refacturaciones).
      const primeraDesde = todas.map((f) => String(f.fecha).slice(0, 10)).filter((d) => claveMes(anioMesDe(d)) >= desde).sort()[0];
      periodo = primeraDesde ? anioMesDe(primeraDesde) : actual;
      const pagoOriginal = (pagosVendedor || []).some((p) => !p?.anulado_en && p.vendedor_id === oc?.vendedor_id && Number(p.anio) === liquidacion.anio && Number(p.mes) === liquidacion.mes);
      if (pagoOriginal && oc?.comision_revision !== "revisada") { derivada = true;
        motivoRevision = `Su liquidación original (${fmt.monthYear(liquidacion.mes, liquidacion.anio)}) tuvo un pago y no se puede comprobar si la cubrió`; }
    }
  } else periodo = actual;
  if (oc?.comision_revision === "por_revisar") motivoRevision = oc.comision_revision_motivo || "Marcada por revisar";
  const porRevisar = !!motivoRevision;
  const desdeVigencia = !!periodo && claveMes(periodo) >= desde;
  const utilidadActual = (Number(oc?.monto_total) || 0) - (Number(oc?.costo_total) || 0);
  const utilidadLiquidada = desdeVigencia && pagada && oc?.comision_utilidad != null ? Number(oc.comision_utilidad) : null;
  return {
    periodo, liquidacion, actual, original, anclada: !!anclada, cerrada: !!cierre, motivoPeriodo, refacturada, pagada, porRevisar, motivoRevision, revisionDerivada: derivada,
    // Fuera de todo cálculo y pago: solo desde la vigencia y si no estaba pagada (lo anterior a octubre no se toca).
    // 15/11/2026: una OC sin período cerrado marcada «Por revisar» (p. ej. vendedor asignado después del cierre a una OC con
    // factura hasta octubre 2026) tampoco entra en ningún mes ni pago hasta que un administrador decida.
    excluida: porRevisar && !pagada && (desdeVigencia || (!cierre && oc?.comision_revision === "por_revisar")),
    utilidad: utilidadLiquidada ?? utilidadActual, utilidadActual, utilidadLiquidada,
    ajusteUtilidad: utilidadLiquidada != null ? utilidadActual - utilidadLiquidada : 0,
    // La factura vigente cae (desde octubre 2026) en otro mes que el que cuenta: ese mes no la incluye.
    fueraDeSuMes: !!actual && claveMes(actual) >= desde && !mismoMes(periodo, actual),
  };
};

// Motivo por el que una OC refacturada no entra en el mes de su factura vigente (se muestra con su período original).
export const motivoExclusion = (liq) => {
  const m = (x) => (x ? fmt.monthYear(x.mes, x.anio) : "—");
  if (!liq?.periodo) return `ya pagada en la liquidación de ${m(liq?.liquidacion)}; no genera nueva comisión`;
  if (liq.cerrada) return `ya considerada en la comisión de ${m(liq.periodo)} (período cerrado)${liq.pagada ? ", ya pagada" : ""}`;
  return `su comisión es de su liquidación original, ${m(liq.periodo)}${liq.pagada ? ", ya pagada" : ""}`;
};
// Texto de una OC no incluida en el mes (Comisiones, pago manual y cartola).
export const textoNoIncluida = (x) => `${x.numero_oc} → ${x.liquidacion ? fmt.monthYear(x.liquidacion.mes, x.liquidacion.anio) : "—"}: ${x.motivo || (x.pagada ? "ya pagada" : "su liquidación original")}`;

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
const utilidadOrdinariaPorVendedor = (ocs, anio, mes, pagosVendedor = null) => {
  const u = new Map();
  (ocs || []).forEach((o) => {
    if (!o?.vendedor_id || o.es_venta_propia || !generaComision(o)) return;
    const liq = liquidacionComision(o, pagosVendedor);
    const p = liq.periodo;
    if (!p || p.anio !== Number(anio) || p.mes !== Number(mes) || liq.excluida) return;
    u.set(o.vendedor_id, (u.get(o.vendedor_id) || 0) + liq.utilidad);
  });
  return u;
};

// Comisión ordinaria total del período y su reparto (solo cálculo; no lee pagos).
export const comisionOrdinariaPeriodo = ({ ocs, anio, mes, ivaMensual = [], pagosVendedor = null }) => {
  const util = utilidadOrdinariaPorVendedor(ocs, anio, mes, pagosVendedor);
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
const calcularPagoVendedorActual = ({ vendedorId, ocs, anio, mes, ivaMensual = [], pagosVendedor = [] }) => {
  let sumaFacts = 0, sumaUtilidad = 0, pagoVentasPropias = 0, hayFacturas = false;
  const detalle = [];   // las OCs que forman el cálculo del mes (Fase 4C)
  const porRevisar = [], ajustes = [], refacturadasFuera = [], liquidadasAqui = [];   // 13/11/2026: avisos, fuera del cálculo
  ocs.filter((o) => o.vendedor_id === vendedorId && generaComision(o)).forEach((o) => {
    // 13/11/2026: el mes es el de su liquidación desde octubre 2026 (liquidacionComision); antes, la regla anterior.
    const liq = liquidacionComision(o, pagosVendedor);
    const p = liq.periodo;
    const esteMes = { anio, mes };
    // Factura vigente en este mes pero su comisión cuenta en otro (o ya se pagó): no entra aquí; se informa por qué.
    if (liq.fueraDeSuMes && mismoMes(liq.actual, esteMes)) refacturadasFuera.push({ ocId: o.id, numero_oc: o.numero_oc, liquidacion: p || liq.liquidacion, pagada: liq.pagada, motivo: motivoExclusion(liq) });
    // Liquidada (y pagada) en este mes y refacturada después hacia la vigencia: sigue apareciendo aquí, solo como referencia.
    if (liq.pagada && !p && mismoMes(liq.liquidacion, esteMes)) liquidadasAqui.push({ ocId: o.id, numero_oc: o.numero_oc, facturaVigenteMes: liq.actual, utilidad: liq.utilidadActual });
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
      ...(liq.refacturada && !mismoMes(liq.actual, { anio, mes }) && liq.actual ? { refacturada: true, facturaVigenteMes: liq.actual } : {}),
      ...(liq.porRevisar ? { porRevisar: true, motivoRevision: liq.motivoRevision } : {}),
      ...(liq.motivoPeriodo ? { motivoPeriodo: liq.motivoPeriodo } : {}),
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
  const per = reglaPeriodo ? comisionOrdinariaPeriodo({ ocs, anio, mes, ivaMensual, pagosVendedor }) : null;
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
    ...(liquidadasAqui.length ? { liquidadasAqui } : {}),
  };
};

// ══ Liquidaciones CERRADAS (15/11/2026, Kevin; rige desde noviembre 2026) ════════════════════════════════════════════
// Una liquidación cerrada (comision_liquidaciones, por vendedor y mes) conserva para siempre su período, las OC
// consideradas con la utilidad usada, el descuento F29 aplicado y la comisión reconocida. Cambios posteriores en una OC
// (venta, costo, despacho, vendedor, una OC que llega o sale del mes) NO la recalculan: se muestran como «Ajuste por
// revisar» (OC, vendedor, período, utilidad anterior y nueva, efecto propuesto). Un administrador los aprueba o rechaza
// con motivo y respaldo (comision_decisiones); el aprobado suma como línea aparte del mes original (decisión de Kevin).
// Saldo = max(0, comisión reconocida + ajustes aprobados − pagos válidos del mes). Cierran: las 17 liquidaciones con
// evidencia hasta octubre 2026 (13 verificadas + 4 pagadas completas, registradas por la migración tal como se calculaban)
// y, desde noviembre 2026, cada mes ya terminado que queda pagado completo con su comisión definitiva.
// cierres = { liquidaciones: [{ id, vendedor_id, anio, mes, origen, comision_reconocida, …, ocs: [{ oc_id, numero_oc,
// utilidad, venta_propia, pago_venta_propia }] }], decisiones: [{ tipo, resultado, liquidacion_id, oc_id, monto, … }] }.
export const CIERRE_AUTOMATICO_DESDE = { anio: 2026, mes: 11 };
export const ORIGENES_CIERRE = { historica_verificada: "Verificada (planilla o cartola)", historica_pagada: "Pagada completa (registrada al 15/11/2026)",
  verificada: "Verificada", pagada: "Pagada completa" };
const DIF_MINIMA = 0.5;   // diferencias de utilidad menores a medio peso no son ajustes
// Una OC registrada en una liquidación cerrada cuenta SOLO allí: si hoy calzaría con otro vendedor u otro mes (p. ej. se
// cambió el vendedor), queda fuera de ese otro cálculo (sin comisión duplicada) y su liquidación cerrada la informa como
// ajuste por revisar.
export const ocsParaComision = (ocs, cierres) => {
  const liqs = cierres?.liquidaciones || []; if (!liqs.length) return ocs || [];
  const donde = new Map(); for (const l of liqs) for (const r of l.ocs || []) donde.set(r.oc_id, l);
  return (ocs || []).filter((o) => { const l = donde.get(o.id); if (!l) return true;
    const p = periodoComision(o); return o.vendedor_id === l.vendedor_id && !!p && p.anio === Number(l.anio) && p.mes === Number(l.mes); });
};
export const liquidacionCerrada = (cierres, vendedorId, anio, mes) =>
  (cierres?.liquidaciones || []).find((l) => l.vendedor_id === vendedorId && Number(l.anio) === Number(anio) && Number(l.mes) === Number(mes)) || null;

// Efecto en la comisión del vendedor de un cambio de utilidad (delta) en una liquidación cerrada, con los datos que se
// usaron al cerrarla (propuesta para el administrador; nada se aplica solo).
export function efectoAjuste(liq, { delta, ventaPropia = false }) {
  const d = Number(delta) || 0;
  if (ventaPropia) return Math.round(d);
  const D = Number(liq.descuento_f29) || 0; const base = Number(liq.comision_ordinaria) || 0;
  if (liq.regla_periodo) {
    const U = Number(liq.utilidad_periodo) || 0; const w = Math.max(0, Math.round(Number(liq.peso) || 0)); const W = Number(liq.peso_total) || 0;
    const total = Math.max(0, Math.round((U + d) / 2 - D / 2));
    const wNuevo = Math.max(0, Math.round((Number(liq.utilidad_vendedor) || 0) + d)); const otros = Math.max(0, W - w);
    const partes = repartirComision(total, [{ id: "v", peso: wNuevo }, { id: "o", peso: otros }]);
    return (partes.get("v") || 0) - base;
  }
  return Math.max(0, Math.round(((Number(liq.utilidad_vendedor) || 0) + d) / 2 - D / 2)) - base;
}

function resultadoCerrado({ actual, liq, vendedorId, ocs, anio, mes, ivaMensual, pagosVendedor, decisiones }) {
  const porId = new Map((ocs || []).map((o) => [o.id, o]));
  const linActual = new Map((actual?.detalle || []).map((l) => [l.ocId, l]));
  const lineaDe = (r) => { const l = linActual.get(r.oc_id); const o = porId.get(r.oc_id);
    const fv = o ? facturaVigente(o) : null;
    return { ...(l || { ocId: r.oc_id, numero_oc: r.numero_oc, cliente: o?.cliente || o?.entidad || "", factura: o ? facturasVigentes(o).map((f) => f.numero_factura).join(", ") : "",
      fechaFactura: fv?.fecha || null, montoFacturas: 0, venta: Number(o?.monto_total) || 0, costo: Number(o?.costo_total) || 0, ventaPropia: !!r.venta_propia }),
      utilidad: Number(r.utilidad), ventaPropia: !!r.venta_propia, pagoVentaPropia: Number(r.pago_venta_propia) || 0, enLiquidacionCerrada: true }; };
  const detalle = (liq.ocs || []).map(lineaDe).sort((a, b) => String(a.fechaFactura || "").localeCompare(String(b.fechaFactura || "")) || String(a.numero_oc).localeCompare(String(b.numero_oc)));
  const decs = (decisiones || []).filter((x) => x.liquidacion_id === liq.id && x.tipo === "ajuste_utilidad");
  const aprobados = decs.filter((x) => x.resultado === "aprobado").map((x) => ({ id: x.id, ocId: x.oc_id, numero_oc: x.numero_oc, monto: Number(x.monto) || 0,
    utilidadAnterior: Number(x.utilidad_anterior), utilidadNueva: Number(x.utilidad_nueva), decididoEn: x.decidido_en, motivo: x.motivo }));
  // Ajustes por revisar: utilidad actual de cada OC frente a la registrada (o a la última decidida); OC que hoy entran al
  // mes y no estaban; OC registradas que hoy ya no corresponden al mes o al vendedor.
  const ultimaDecidida = (ocId) => { const ds = decs.filter((x) => x.oc_id === ocId).sort((a, b) => String(a.decidido_en).localeCompare(String(b.decidido_en))); return ds.length ? Number(ds[ds.length - 1].utilidad_nueva) : null; };
  const pendientes = [];
  const registradas = new Set((liq.ocs || []).map((r) => r.oc_id));
  const evaluar = (ocId, numero_oc, registrada, nueva, ventaPropia, motivo) => {
    const decidida = ultimaDecidida(ocId); const anterior = decidida ?? registrada;
    if (Math.abs(nueva - anterior) < DIF_MINIMA) return;
    const delta = nueva - anterior;
    pendientes.push({ ocId, numero_oc, vendedorId, periodo: { anio, mes }, motivo, utilidadAnterior: anterior, utilidadNueva: nueva, diferencia: delta,
      efecto: efectoAjuste(liq, { delta, ventaPropia }), ventaPropia: !!ventaPropia });
  };
  for (const r of liq.ocs || []) {
    const o = porId.get(r.oc_id);
    const enEsteMes = o && o.vendedor_id === vendedorId && generaComision(o) && (() => { const p = periodoComision(o); return p && p.anio === anio && p.mes === mes; })();
    if (!enEsteMes) { evaluar(r.oc_id, r.numero_oc, Number(r.utilidad), 0, r.venta_propia, o ? "ya no corresponde a este mes o vendedor" : "la OC ya no existe"); continue; }
    evaluar(r.oc_id, r.numero_oc, Number(r.utilidad), liquidacionComision(o).utilidadActual, r.venta_propia, "cambió la utilidad (venta, costo o despacho)");
  }
  for (const l of actual?.detalle || []) {
    if (registradas.has(l.ocId)) continue;
    const o = porId.get(l.ocId); evaluar(l.ocId, l.numero_oc, 0, o ? liquidacionComision(o).utilidadActual : Number(l.utilidad), l.ventaPropia, "OC nueva en un mes ya liquidado");
  }
  const tribut = actual ? { impIva: actual.impIva, retenciones: actual.retenciones, sinIva: actual.sinIva, ivaRegistrado: actual.ivaRegistrado, ivaVentas: actual.ivaVentas, ivaCompras: actual.ivaCompras }
    : (() => { const t = descuentoTributarioPeriodo(ivaMensual, anio, mes); return { impIva: t.impIva, retenciones: t.retenciones, sinIva: t.sinIva, ivaRegistrado: !!t.ivaMes,
      ivaVentas: t.ivaMes ? Number(t.ivaMes.iva_ventas) || 0 : 0, ivaCompras: t.ivaMes ? Number(t.ivaMes.iva_compras) || 0 : 0 }; })();
  const pagosDelMes = (pagosVendedor || []).filter((x) => pagoVigente(x) && x.vendedor_id === vendedorId && Number(x.mes) === mes && Number(x.anio) === anio);
  const pagado = pagosDelMes.reduce((a, x) => a + (Number(x.monto_pagado) || 0), 0);
  const verificado = pagosDelMes.find((x) => x.monto_verificado != null)?.monto_verificado;
  const reconocida = Number(liq.comision_reconocida) || 0; const totalAprobado = aprobados.reduce((a, x) => a + x.monto, 0);
  const pagoCalculado = reconocida + totalAprobado;
  const descuentoActual = actual ? actual.descuentoF29 : descuentoTributarioPeriodo(ivaMensual, anio, mes).descuentoF29;
  return {
    ...(actual || {}), mes, anio, label: fmt.monthYear(mes, anio),
    sumaFacts: detalle.filter((l) => !l.ventaPropia).reduce((a, l) => a + (Number(l.montoFacturas) || 0), 0),
    sumaUtilidad: Number(liq.utilidad_vendedor) || 0, pagoVentasPropias: Number(liq.ventas_propias) || 0, comisionOrdinaria: Number(liq.comision_ordinaria) || 0,
    reglaPeriodo: !!liq.regla_periodo, periodo: liq.regla_periodo ? { vendedores: actual?.periodo?.vendedores ?? null, utilidadTotal: Number(liq.utilidad_periodo) || 0,
      descuentoF29: Number(liq.descuento_f29) || 0, total: null, metodo: actual?.periodo?.metodo ?? null, pesoTotal: Number(liq.peso_total) || 0, peso: Number(liq.peso) || 0 } : null,
    ...tribut, descuentoF29: Number(liq.descuento_f29) || 0, f29Incompleto: false,
    pagoCalculado, pagado, esVerificado: verificado != null, estado: pagado >= pagoCalculado ? "pagado" : "pendiente",
    extraGestion: pagosDelMes.reduce((a, x) => a + extraGestion(x), 0), transferido: pagosDelMes.reduce((a, x) => a + totalTransferido(x), 0), pagos: pagosDelMes,
    deuda: Math.max(0, pagoCalculado - pagado), porRegularizar: Math.max(0, pagado - pagoCalculado),
    detalle,
    cerrada: { id: liq.id, origen: liq.origen, origenTexto: ORIGENES_CIERRE[liq.origen] || liq.origen, cerradaEn: liq.cerrada_en || null, nota: liq.nota || "",
      comisionReconocida: reconocida, pagadoAlCierre: Number(liq.pagado_al_cierre) || 0, ...(Math.abs(descuentoActual - (Number(liq.descuento_f29) || 0)) >= DIF_MINIMA ? { f29Cambio: { registrado: Number(liq.descuento_f29) || 0, actual: descuentoActual } } : {}) },
    ...(aprobados.length ? { ajustesAprobados: aprobados, ajusteAprobadoTotal: totalAprobado } : {}),
    ...(pendientes.length ? { ajustesPorRevisar: pendientes } : {}),
    // En un mes cerrado no rigen los ajustes de utilidad de la regla anterior (los reemplazan los «Ajustes por revisar»).
    ajustesUtilidad: undefined, ajusteUtilidadTotal: undefined,
  };
}

// Pago de un vendedor en un mes (regla única). Si el mes tiene una liquidación cerrada, la conserva (ver arriba).
export const calcularPagoVendedor = ({ vendedorId, ocs, anio, mes, ivaMensual = [], pagosVendedor = [], cierres = null }) => {
  anio = Number(anio); mes = Number(mes);
  const actual = calcularPagoVendedorActual({ vendedorId, ocs: ocsParaComision(ocs, cierres), anio, mes, ivaMensual, pagosVendedor });
  const liq = liquidacionCerrada(cierres, vendedorId, anio, mes);
  if (!liq) return actual;
  const r = resultadoCerrado({ actual, liq, vendedorId, ocs, anio, mes, ivaMensual, pagosVendedor, decisiones: cierres?.decisiones });
  for (const k of ["ajustesUtilidad", "ajusteUtilidadTotal"]) if (r[k] === undefined) delete r[k];
  return r;
};

// Datos de una liquidación por cerrar (lo que se registra, tal como se calcula en ese momento).
export const datosCierre = (c, vendedorId, origen) => ({
  vendedor_id: vendedorId, anio: c.anio, mes: c.mes, origen, comision_reconocida: c.pagoCalculado, comision_ordinaria: c.comisionOrdinaria, ventas_propias: c.pagoVentasPropias,
  utilidad_vendedor: c.sumaUtilidad, utilidad_periodo: c.periodo ? c.periodo.utilidadTotal : null, descuento_f29: c.descuentoF29, regla_periodo: !!c.reglaPeriodo,
  peso: c.periodo ? c.periodo.peso : null, peso_total: c.periodo ? c.periodo.pesoTotal : null, pagado_al_cierre: c.pagado,
  ocs: c.detalle.map((l) => ({ oc_id: l.ocId, numero_oc: l.numero_oc, utilidad: l.utilidad, venta_propia: !!l.ventaPropia, pago_venta_propia: l.pagoVentaPropia || 0 })) });

// Desde noviembre 2026: meses YA TERMINADOS, pagados completos (comisión definitiva, nada «Por revisar» fuera del cálculo)
// y aún sin cerrar → datos para cerrarlos. No cierra nada por sí misma.
export const liquidacionesPorCerrar = ({ vendedores, ocs, ivaMensual = [], pagosVendedor = [], cierres = null, hoy = new Date() }) => {
  const out = [];
  for (const v of vendedores || []) {
    for (const { anio, mes } of mesesConFactura(v.id, ocs || [], cierres)) {
      if (anio * 12 + mes < CIERRE_AUTOMATICO_DESDE.anio * 12 + CIERRE_AUTOMATICO_DESDE.mes || esMesEnCurso(anio, mes, hoy)) continue;
      if (liquidacionCerrada(cierres, v.id, anio, mes)) continue;
      const c = calcularPagoVendedor({ vendedorId: v.id, ocs, anio, mes, ivaMensual, pagosVendedor, cierres });
      if (!c || !(c.pagado > 0) || c.deuda > 0 || comisionProvisoria(c) || (c.porRevisar || []).some((x) => !x.incluida)) continue;
      out.push(datosCierre(c, v.id, c.esVerificado ? "verificada" : "pagada"));
    }
  }
  return out;
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
