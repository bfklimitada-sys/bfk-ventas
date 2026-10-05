import { anioMesDe, facturaVigente } from "./calculos";

// Fuente única de la regla "qué OC cubre un pago a vendedor":
// OC del vendedor, con factura propia emitida, aún no marcadas como pagadas,
// cuya factura vigente cae en el mes/año de la comisión. Lo usan Vendedores y Cartola.
export const ocsPagablesDelMes = (ocs, vendedorId, mes, anio) =>
  (ocs || []).filter((o) => {
    if (o.vendedor_id !== vendedorId || o.estado_factura_propia !== "emitida" || o.vendedor_pagado) return false;
    const evF = facturaVigente(o);
    if (!evF) return false;
    const f = anioMesDe(evF.fecha);
    return f.mes === Number(mes) && f.anio === Number(anio);
  });

// Escritura única de un pago a vendedor (pago + marcado de OC). `origen` solo cambia la nota.
export async function registrarPagoVendedor({ ins, upd, token, userId, id, vendedorId, monto, fecha, mes, anio, notas, ocIds }) {
  await ins("pagos_vendedor", token, {
    id, vendedor_id: vendedorId, anio: Number(anio), mes: Number(mes),
    monto_calculado: monto, monto_pagado: monto, fecha, estado: "pagado", notas, creado_por: userId,
  });
  for (const ocId of ocIds || []) await upd("ordenes_compra_v2", token, ocId, { vendedor_pagado: true });
  return (ocIds || []).length;
}
