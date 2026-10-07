import { registroIvaDe, ivaAPagarPeriodo } from "./calculos.js";
import { F29_DESDE } from "./f29.js";

// ═══════════════════════════════════════════════════════════════
// IVA del mes — un solo registro.
//
// Un mismo formulario guarda los dos datos del período:
//  · iva_mensual (débito / crédito)  → lo usa la comisión (IVA neto)
//  · gasto "Impuesto SII"            → la salida real de caja (pagado al SII)
// Las reglas de cálculo no cambian (lib/calculos.js y lib/f29.js); solo se
// evita tener que ingresar el mismo período en dos lugares.
// ═══════════════════════════════════════════════════════════════

export const CATEGORIA_IMPUESTO = "cat_impuesto";
export const SUBCATEGORIA_IVA = "IVA Mensual";

const clave = (anio, mes) => Number(anio) * 12 + (Number(mes) - 1);
const desdeClave = (k) => ({ anio: Math.floor(k / 12), mes: (k % 12) + 1 });

// Gastos "Impuesto SII" de un período.
export const gastosImpuestoDe = (gastos, anio, mes) =>
  (gastos || []).filter((g) => g.categoria_id === CATEGORIA_IMPUESTO && Number(g.mes) === Number(mes) && Number(g.anio) === Number(anio));

export const pagadoSiiDe = (gastos, anio, mes) =>
  gastosImpuestoDe(gastos, anio, mes).reduce((s, g) => s + (Number(g.monto) || 0), 0);

// Períodos con pago al SII registrado en Gastos pero sin débito/crédito en IVA
// mensual (la comisión los está calculando sin IVA). Desde F29_DESDE: antes se
// usaban criterios distintos y no se marcan.
export const periodosIvaIncompletos = ({ gastos, ivaMensual }) => {
  const claves = new Set();
  (gastos || []).forEach((g) => {
    if (g.categoria_id !== CATEGORIA_IMPUESTO) return;
    const k = clave(g.anio, g.mes);
    if (Number.isFinite(k) && k >= clave(F29_DESDE.anio, F29_DESDE.mes) && !registroIvaDe(ivaMensual, g.anio, g.mes)) claves.add(k);
  });
  return [...claves].sort((a, b) => a - b).map((k) => {
    const { anio, mes } = desdeClave(k);
    return { anio, mes, pagado: pagadoSiiDe(gastos, anio, mes) };
  });
};

// Mes con que abre el formulario nuevo: el período incompleto más antiguo; si no
// hay, el mes anterior si aún no tiene IVA (el F29 se declara el mes siguiente);
// si no, el mes actual.
export const mesSugeridoIva = ({ gastos, ivaMensual, hoy = new Date() }) => {
  const inc = periodosIvaIncompletos({ gastos, ivaMensual });
  if (inc.length) return { anio: inc[0].anio, mes: inc[0].mes };
  const mesAct = hoy.getMonth() + 1, anioAct = hoy.getFullYear();
  const mesPrev = mesAct === 1 ? 12 : mesAct - 1, anioPrev = mesAct === 1 ? anioAct - 1 : anioAct;
  if (!registroIvaDe(ivaMensual, anioPrev, mesPrev)) return { anio: anioPrev, mes: mesPrev };
  return { anio: anioAct, mes: mesAct };
};

// Plan de escritura del formulario único. No escribe: devuelve qué hacer, para
// poder probarlo sin base de datos.
//  data = { anio, mes, ventasNetas, ivaVentas, comprasNetas, ivaCompras, pagadoSii, fechaPago }
//  · iva: inserta o actualiza el registro de iva_mensual del período.
//  · gasto:
//     - pagado > 0 y sin gasto del período → inserta un gasto "Impuesto SII".
//     - pagado > 0 y exactamente un gasto  → lo actualiza si el monto o la fecha cambian.
//     - varios gastos del período (pagos parciales) → no los toca; avisa si la suma difiere.
//     - pagado vacío o 0 → no crea ni borra gastos.
export const planGuardarIva = ({ data, gastos, ivaMensual }) => {
  const anio = Number(data.anio), mes = Number(data.mes);
  const fila = {
    anio, mes,
    ventas_netas: Number(data.ventasNetas) || 0, iva_ventas: Number(data.ivaVentas) || 0,
    compras_netas: Number(data.comprasNetas) || 0, iva_compras: Number(data.ivaCompras) || 0,
  };
  const pagado = Math.round(Number(data.pagadoSii) || 0);
  // iva_pagado = total pagado del F29 (IVA + retenciones); sin pago indicado, el IVA a pagar.
  // Desde agosto 2026 la diferencia (retenciones) se descuenta en la comisión (lib/calculos.js).
  fila.iva_pagado = pagado > 0 ? pagado : ivaAPagarPeriodo(fila);
  const existente = registroIvaDe(ivaMensual, anio, mes);
  const iva = existente ? { accion: "actualizar", id: existente.id, fila } : { accion: "insertar", fila };

  const delMes = gastosImpuestoDe(gastos, anio, mes);
  let gasto = { accion: "ninguna" }, aviso = null;
  if (pagado > 0) {
    if (delMes.length === 0) {
      gasto = { accion: "insertar", fila: { categoria_id: CATEGORIA_IMPUESTO, subcategoria: SUBCATEGORIA_IVA, monto: pagado, mes, anio, fecha: data.fechaPago || null, detalle: null } };
    } else if (delMes.length === 1) {
      const g = delMes[0];
      const cambios = {};
      if (Number(g.monto) !== pagado) cambios.monto = pagado;
      if (data.fechaPago && String(g.fecha || "").slice(0, 10) !== data.fechaPago) cambios.fecha = data.fechaPago;
      gasto = Object.keys(cambios).length ? { accion: "actualizar", id: g.id, fila: cambios } : { accion: "ninguna" };
    } else {
      const suma = delMes.reduce((s, g) => s + (Number(g.monto) || 0), 0);
      if (suma !== pagado) aviso = `El período tiene ${delMes.length} pagos al SII en Gastos (suma ${suma}); no se modificaron.`;
    }
  }
  return { iva, gasto, aviso };
};
