import { anioMesDe, calcularPagoVendedor, facturaVigente, pagoVigente } from "./calculos.js";

// OC del vendedor con factura propia emitida, aún no marcadas como pagadas,
// cuya factura vigente cae en el mes/año de la comisión.
export const ocsPagablesDelMes = (ocs, vendedorId, mes, anio) =>
  (ocs || []).filter((o) => {
    if (o.vendedor_id !== vendedorId || o.estado_factura_propia !== "emitida" || o.vendedor_pagado) return false;
    const evF = facturaVigente(o);
    if (!evF) return false;
    const f = anioMesDe(evF.fecha);
    return f.mes === Number(mes) && f.anio === Number(anio);
  });

// OC del período ya marcadas como pagadas (para desmarcarlas si una anulación deja la comisión impaga).
const ocsMarcadasDelMes = (ocs, vendedorId, mes, anio) =>
  (ocs || []).filter((o) => {
    if (o.vendedor_id !== vendedorId || !o.vendedor_pagado) return false;
    const evF = facturaVigente(o);
    if (!evF) return false;
    const f = anioMesDe(evF.fecha);
    return f.mes === Number(mes) && f.anio === Number(anio);
  });

// Reparto de UNA transferencia (08/10/2026):
//   pago de comisión  = mínimo(monto transferido, comisión pendiente del período)
//   extra por gestión = máximo(monto transferido − comisión pendiente, 0)
// El excedente es gestión del MISMO período: no se traslada a otro mes ni aumenta la comisión.
export const repartirTransferencia = (monto, pendiente) => {
  const total = Math.max(0, Math.round(Number(monto) || 0));
  const pend = Math.max(0, Math.round(Number(pendiente) || 0));
  const comision = Math.min(total, pend);
  return { total, comision, extra: total - comision };
};

// REGLA ÚNICA DE SALDO (Vendedores y Cartola):
//   pendiente = max(0, comisión calculada del período − comisión ya pagada del período)
// Solo cuentan los pagos vigentes (no anulados) y solo su parte de comisión (monto_pagado).
// Las OC del período se marcan como pagadas cuando la comisión pagada (incluido este pago) la cubre.
export const evaluarPagoVendedor = ({ vendedorId, mes, anio, monto, ocs, ivaMensual, pagosVendedor }) => {
  mes = Number(mes); anio = Number(anio);
  const calc = calcularPagoVendedor({ vendedorId, ocs: ocs || [], anio, mes, ivaMensual: ivaMensual || [], pagosVendedor: pagosVendedor || [] });
  const comision = calc ? Math.round(calc.pagoCalculado) : 0;
  const pagadoAntes = (pagosVendedor || [])
    .filter((p) => pagoVigente(p) && p.vendedor_id === vendedorId && Number(p.mes) === mes && Number(p.anio) === anio)
    .reduce((s, p) => s + (Number(p.monto_pagado) || 0), 0);
  const pendienteAntes = Math.max(0, comision - pagadoAntes);
  const r = repartirTransferencia(monto, pendienteAntes);
  const pagadoDespues = pagadoAntes + r.comision;
  const completo = pagadoDespues >= comision;
  return {
    comision, pagadoAntes, pagadoDespues, completo, pendienteAntes,
    total: r.total, pagoComision: r.comision, extraGestion: r.extra,
    pendiente: Math.max(0, comision - pagadoDespues),
    excedente: r.extra,
    provisoria: !!calc && !calc.esVerificado && !calc.sinIva && !calc.ivaRegistrado,
    ocIds: completo && r.total > 0 ? ocsPagablesDelMes(ocs, vendedorId, mes, anio).map((o) => o.id) : [],
  };
};

// Mismo período, mismo día y mismo total ya registrado (y vigente): posible doble registro.
export const pagoParecido = ({ pagosVendedor, vendedorId, mes, anio, fecha, monto }) =>
  (pagosVendedor || []).find((p) => pagoVigente(p) && p.vendedor_id === vendedorId && Number(p.mes) === Number(mes) && Number(p.anio) === Number(anio)
    && String(p.fecha || "").slice(0, 10) === String(fecha || "").slice(0, 10)
    && Math.round(p.monto_transferido != null ? Number(p.monto_transferido) : Number(p.monto_pagado)) === Math.round(Number(monto) || 0)) || null;

export const esPagoDuplicado = (e) => /duplicate|unique|23505|already exists/i.test(String(e?.message || e || ""));

// Escritura única de un pago a vendedor: una fila = una transferencia, con sus dos componentes.
// `id` lo fija el formulario al abrirse: si el mismo pago se envía dos veces, la base rechaza el segundo (llave primaria).
export async function registrarPagoVendedor({ ins, upd, token, userId, id, vendedorId, monto, fecha, mes, anio, notas, referencia, ocs, ivaMensual, pagosVendedor }) {
  const ev = evaluarPagoVendedor({ vendedorId, mes, anio, monto, ocs, ivaMensual, pagosVendedor });
  if (!(ev.total > 0)) throw new Error("Indica un monto mayor que $0");
  const fila = {
    id, vendedor_id: vendedorId, anio: Number(anio), mes: Number(mes),
    monto_calculado: ev.pagoComision, monto_pagado: ev.pagoComision,
    monto_extra_gestion: ev.extraGestion, monto_transferido: ev.total,
    referencia_bancaria: String(referencia || "").trim() || null,
    fecha, estado: "pagado", notas: notas || "", creado_por: userId,
  };
  await ins("pagos_vendedor", token, fila);
  for (const ocId of ev.ocIds) await upd("ordenes_compra_v2", token, ocId, { vendedor_pagado: true });
  return { ...ev, fila };
}

// Anulación controlada (solo administrador; la base lo exige): el pago queda completo en la base con fecha, usuario
// y motivo, y deja de contar en comisión y caja. Si con eso la comisión del período ya no queda cubierta, las OC
// del período vuelven a "comisión pendiente".
export async function anularPagoVendedor({ upd, token, pago, motivo, ocs, ivaMensual, pagosVendedor }) {
  const m = String(motivo || "").trim();
  if (!m) throw new Error("Indica el motivo de la anulación");
  try {
    await upd("pagos_vendedor", token, pago.id, { anulado_en: new Date().toISOString(), motivo_anulacion: m });
  } catch {
    throw new Error("No se pudo anular: solo un administrador puede hacerlo y un pago ya anulado no se vuelve a modificar. No se cambió nada.");
  }
  const restantes = (pagosVendedor || []).filter((p) => p.id !== pago.id);
  const ev = evaluarPagoVendedor({ vendedorId: pago.vendedor_id, mes: pago.mes, anio: pago.anio, monto: 0, ocs, ivaMensual, pagosVendedor: restantes });
  const desmarcar = ev.pagadoAntes >= ev.comision ? [] : ocsMarcadasDelMes(ocs, pago.vendedor_id, pago.mes, pago.anio).map((o) => o.id);
  for (const ocId of desmarcar) await upd("ordenes_compra_v2", token, ocId, { vendedor_pagado: false });
  return { ...ev, desmarcadas: desmarcar.length };
}
