// ═══════════════════════════════════════════════════════════════
// F29 / IVA por período — solo para mostrar el Panel.
// NO modifica datos ni interviene en el cálculo de comisiones.
//
//  · IVA determinado = max(0, iva_ventas − iva_compras) de iva_mensual
//  · Pagado          = suma de gastos "Impuesto SII" (cat_impuesto) del mismo mes/año
//  · Pendiente       = max(0, determinado − pagado)   (cada período por separado:
//                      un pago mayor al IVA queda en $0 y no se traslada a otro período)
// ═══════════════════════════════════════════════════════════════

// Fecha de corte: los períodos anteriores usan criterios antiguos (planillas,
// iva_pagado, gastos SII distintos) y NO se interpretan como deuda F29.
// Los datos anteriores siguen intactos; solo quedan fuera de la deuda del Panel.
export const F29_DESDE = { anio: 2026, mes: 1 };

const clave = (anio, mes) => anio * 12 + (mes - 1);
export const periodoVigenteF29 = (anio, mes) => clave(anio, mes) >= clave(F29_DESDE.anio, F29_DESDE.mes);

export const periodoF29 = (ivaMensual, gastos, anio, mes) => {
  const iv = (ivaMensual || []).find((i) => Number(i.mes) === mes && Number(i.anio) === anio);
  const det = iv ? Math.max(0, (Number(iv.iva_ventas) || 0) - (Number(iv.iva_compras) || 0)) : 0;
  const pag = (gastos || [])
    .filter((g) => g.categoria_id === "cat_impuesto" && Number(g.mes) === mes && Number(g.anio) === anio)
    .reduce((s, g) => s + (Number(g.monto) || 0), 0);
  return { anio, mes, det, pag, pend: Math.max(0, det - pag) };
};

// Todos los períodos con datos desde F29_DESDE, más el desglose del Panel
// (mes anterior y mes actual se muestran; el resto se resume como "anteriores").
export const calcularF29 = ({ ivaMensual, gastos, anioActual, mesActual }) => {
  const claves = new Set();
  (ivaMensual || []).forEach((i) => claves.add(`${Number(i.anio)}-${Number(i.mes)}`));
  (gastos || []).forEach((g) => { if (g.categoria_id === "cat_impuesto") claves.add(`${Number(g.anio)}-${Number(g.mes)}`); });
  const periodos = [...claves]
    .map((k) => k.split("-").map(Number))
    .filter(([a, m]) => periodoVigenteF29(a, m))
    .map(([a, m]) => periodoF29(ivaMensual, gastos, a, m))
    .sort((x, y) => clave(x.anio, x.mes) - clave(y.anio, y.mes));
  const mesPrev = mesActual === 1 ? 12 : mesActual - 1;
  const anioPrev = mesActual === 1 ? anioActual - 1 : anioActual;
  const esMostrado = (x) => (x.anio === anioPrev && x.mes === mesPrev) || (x.anio === anioActual && x.mes === mesActual);
  const mostrados = periodos.filter((x) => esMostrado(x) && (x.det > 0 || x.pag > 0));
  const anterior = periodos.filter((x) => !esMostrado(x)).reduce((s, x) => s + x.pend, 0);
  const total = periodos.reduce((s, x) => s + x.pend, 0);
  return { periodos, mostrados, anterior, total, visible: mostrados.length > 0 || anterior > 0 };
};
