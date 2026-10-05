import { anioMesDe, calcularPagoVendedor, facturaVigente } from "./calculos";

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

// REGLA ÚNICA DE SALDO (Vendedores y Cartola):
//   pendiente = max(0, comisión calculada del período − pagos acumulados del período)
// Las OC del período solo se marcan como pagadas cuando el acumulado (incluido este pago)
// cubre la comisión. Un excedente no se traslada a otro mes.
export const evaluarPagoVendedor = ({ vendedorId, mes, anio, monto, ocs, ivaMensual, pagosVendedor }) => {
  mes = Number(mes); anio = Number(anio); monto = Number(monto) || 0;
  const calc = calcularPagoVendedor({ vendedorId, ocs: ocs || [], anio, mes, ivaMensual: ivaMensual || [], pagosVendedor: pagosVendedor || [] });
  const comision = calc ? calc.pagoCalculado : 0;
  const pagadoAntes = (pagosVendedor || [])
    .filter((p) => p.vendedor_id === vendedorId && Number(p.mes) === mes && Number(p.anio) === anio)
    .reduce((s, p) => s + (Number(p.monto_pagado) || 0), 0);
  const pagadoDespues = pagadoAntes + monto;
  const completo = pagadoDespues >= comision;
  return {
    comision, pagadoAntes, pagadoDespues, completo,
    pendienteAntes: Math.max(0, comision - pagadoAntes),
    pendiente: Math.max(0, comision - pagadoDespues),
    excedente: Math.max(0, pagadoDespues - comision),
    ocIds: completo ? ocsPagablesDelMes(ocs, vendedorId, mes, anio).map((o) => o.id) : [],
  };
};

// Escritura única de un pago a vendedor. Devuelve la evaluación y la fila escrita
// (para que quien procese varios pagos seguidos los acumule).
export async function registrarPagoVendedor({ ins, upd, token, userId, id, vendedorId, monto, fecha, mes, anio, notas, ocs, ivaMensual, pagosVendedor }) {
  const ev = evaluarPagoVendedor({ vendedorId, mes, anio, monto, ocs, ivaMensual, pagosVendedor });
  const fila = {
    id, vendedor_id: vendedorId, anio: Number(anio), mes: Number(mes),
    monto_calculado: monto, monto_pagado: monto, fecha, estado: "pagado", notas, creado_por: userId,
  };
  await ins("pagos_vendedor", token, fila);
  for (const ocId of ev.ocIds) await upd("ordenes_compra_v2", token, ocId, { vendedor_pagado: true });
  return { ...ev, fila };
}
