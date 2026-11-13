import { registroIvaDe, ivaAPagarPeriodo, aplicaRetenciones } from "./calculos.js";
import { F29_DESDE, desgloseF29 } from "./f29.js";
import { desgloseRegistroF29 } from "./f29Desglose.js";

// ═══════════════════════════════════════════════════════════════
// IVA del mes / F29.
//  · iva_mensual: la declaración del período (débito/crédito y, desde el 13/11/2026, el desglose del informe:
//    remanente anterior reajustado, PPM y otras retenciones). La usa la comisión y el F29.
//  · gasto "Impuesto SII": la salida real de caja. Desde el 13/11/2026 se registra SOLO al ingresar un pago
//    realizado (planPagoF29), separado de la declaración (planGuardarIva no toca gastos).
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

// Plan de escritura del formulario del F29. No escribe: devuelve qué hacer, para poder probarlo sin base de datos.
// 13/11/2026 — declaración y pago SEPARADOS: guardar el F29 NUNCA crea, modifica ni borra gastos «Impuesto SII».
// La salida de caja se registra aparte, al ingresar un pago realizado (planPagoF29). Así editar o volver a guardar
// el período no puede duplicar ni alterar los pagos existentes.
//  data = { anio, mes, ventasNetas, ivaVentas, comprasNetas, ivaCompras,
//           desglose: true, remanenteAnterior, ppm, otrasRetenciones   (null = pendiente; 0 = $0 explícito)
//           — o, para un registro ANTERIOR sin desglose que se edita en su formato: totalF29 }
//  · iva: inserta o actualiza el registro de iva_mensual del período.
//  · gasto: siempre { accion: "ninguna" } (se conserva la clave por compatibilidad).
const nulo = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v)));
export const planGuardarIva = ({ data, gastos, ivaMensual }) => {
  const anio = Number(data.anio), mes = Number(data.mes);
  const fila = {
    anio, mes,
    ventas_netas: Number(data.ventasNetas) || 0, iva_ventas: Number(data.ivaVentas) || 0,
    compras_netas: Number(data.comprasNetas) || 0, iva_compras: Number(data.ivaCompras) || 0,
  };
  const existente = registroIvaDe(ivaMensual, anio, mes);
  if (data.desglose) {
    fila.remanente_anterior = nulo(data.remanenteAnterior);
    fila.ppm = nulo(data.ppm);
    fila.otras_retenciones = nulo(data.otrasRetenciones);
    fila.desglose_f29 = true;
    // iva_pagado (NOT NULL) guarda el Total a pagar F29 cuando está completo; 0 mientras falte un dato. Los cálculos
    // de un período con desglose leen las columnas explícitas, no iva_pagado.
    const d = desgloseRegistroF29(fila);
    fila.iva_pagado = d.total ?? 0;
  } else {
    // Registro anterior editado en su formato (sin desglose): misma regla de iva_pagado que antes del 13/11/2026.
    // 10/10/2026: desde agosto 2026 el total del F29 (IVA + PPM) NO se presume igual al IVA a pagar; sin total escrito se
    // conserva el registrado (o 0 = no registrado). Antes de agosto 2026, sin total, se guarda el IVA a pagar.
    const total = Math.round(Number(data.totalF29 ?? data.pagadoSii) || 0);   // pagadoSii: nombre anterior del mismo dato
    if (total > 0) fila.iva_pagado = total;
    else if (!aplicaRetenciones(anio, mes)) fila.iva_pagado = ivaAPagarPeriodo(fila);
    else fila.iva_pagado = existente && Number(existente.iva_pagado) > 0 ? Number(existente.iva_pagado) : 0;
  }
  const iva = existente ? { accion: "actualizar", id: existente.id, fila } : { accion: "insertar", fila };
  return { iva, gasto: { accion: "ninguna" }, aviso: null };
};

// Pago realizado del F29 → UN gasto «Impuesto SII» del período, con su monto y fecha reales. No escribe.
//  id: identificador fijado al abrir el formulario de pago (un segundo envío del mismo pago choca con la clave
//      primaria y no se duplica). hoy: "YYYY-MM-DD" (Chile).
// Devuelve { error } o { accion: "insertar", fila, pendienteAntes, pendienteDespues }.
export const planPagoF29 = ({ id, anio, mes, monto, fecha, gastos, ivaMensual, hoy }) => {
  anio = Number(anio); mes = Number(mes);
  const m = Math.round(Number(monto));
  if (!id) return { error: "Falta el identificador del pago" };
  if ((gastos || []).some((g) => g.id === id)) return { error: "Este pago ya estaba registrado: no se guardó dos veces", duplicado: true };
  const registro = registroIvaDe(ivaMensual, anio, mes);
  if (!registro) return { error: "Primero guarda el F29 de este período (declaración); después registra su pago." };
  if (!Number.isFinite(m) || m <= 0) return { error: "Indica el monto pagado (mayor que $0)" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return { error: "Indica la fecha real del pago" };
  if (hoy && String(fecha) > String(hoy)) return { error: "La fecha del pago no puede ser futura: registra el pago cuando ya esté hecho." };
  const per = desgloseF29(ivaMensual, gastos, anio, mes);
  if (m > per.pend) return { error: per.pend > 0
    ? `El pago (${m.toLocaleString("es-CL")}) supera el saldo pendiente del F29 (${per.pend.toLocaleString("es-CL")}). Si incluye multa o intereses, regístralos en Gastos › Impuesto SII › Multa.`
    : "Este F29 no tiene saldo pendiente: no se registró otro pago." };
  const fila = { id, categoria_id: CATEGORIA_IMPUESTO, subcategoria: SUBCATEGORIA_IVA, monto: m, mes, anio, fecha: String(fecha), detalle: `Pago F29 ${String(mes).padStart(2, "0")}/${anio}` };
  return { accion: "insertar", fila, pendienteAntes: per.pend, pendienteDespues: per.pend - m };
};
