// ═══════════════════════════════════════════════════════════════
// F29 con el desglose del informe del contador (13/11/2026). Funciones puras, sin dependencias.
//
// Columnas nuevas de iva_mensual (todas NULL = dato pendiente de ingresar; 0 = $0 registrado explícitamente):
//   remanente_anterior .. remanente de crédito del mes anterior, REAJUSTADO, copiado del informe de ese mes
//                         (puede diferir del «remanente para el mes siguiente» nominal del mes anterior).
//   ppm ................. PPM del F29, copiado del informe (nunca se deduce del total pagado).
//   otras_retenciones ... Impuesto Único, retención de honorarios y demás retenciones del F29.
//   desglose_f29 ........ true = período registrado con este desglose. NULL = registro anterior: conserva su cálculo.
//
// Reglas del período (con el desglose):
//   IVA neto del mes            = IVA débito − IVA crédito (con signo)
//   IVA a pagar                 = max(0, IVA neto − remanente anterior reajustado)
//   Remanente para el mes sgte. = max(0, remanente anterior reajustado − IVA neto)
//   Total a pagar F29           = IVA a pagar + PPM + otras retenciones          → impuestos y caja
//   Descuento para comisiones   = IVA neto (con signo) + PPM + otras retenciones → una sola vez, antes de dividir
// ═══════════════════════════════════════════════════════════════

// Desde este período el descuento tributario de las comisiones es el Total a pagar F29 (con el desglose completo).
export const DESCUENTO_TOTAL_F29_DESDE = { anio: 2026, mes: 10 };
export const usaReglaTotalF29 = (anio, mes) => Number(anio) * 12 + Number(mes) >= DESCUENTO_TOTAL_F29_DESDE.anio * 12 + DESCUENTO_TOTAL_F29_DESDE.mes;

// Valor guardado: null/undefined/"" = pendiente; cualquier otro, número.
export const datoF29 = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
export const tieneDesgloseF29 = (r) => r?.desglose_f29 === true;

// Texto escrito por el usuario → número entero o null (pendiente). Acepta el formato del informe:
// «$ 1.202.931», «1202931», «–» o «-» (sin monto = $0). Devuelve { valor, error }.
export const leerMontoF29 = (texto, { negativo = false } = {}) => {
  const t = String(texto ?? "").trim();
  if (t === "") return { valor: null, error: null };
  if (/^[-–—]$/.test(t)) return { valor: 0, error: null };
  const neg = /^[-–—−]\s*\$?/.test(t);
  const limpio = t.replace(/^[-–—−]/, "").replace(/\$/g, "").replace(/\s/g, "").replace(/\./g, "");
  if (!/^\d+$/.test(limpio)) return { valor: null, error: "monto no válido (solo pesos enteros, p. ej. 1.202.931)" };
  const n = Number(limpio) * (neg ? -1 : 1);
  if (n < 0 && !negativo) return { valor: null, error: "no puede ser negativo" };
  return { valor: n, error: null };
};

// Desglose de un registro (o de los valores del formulario con los mismos nombres de columna).
export const desgloseRegistroF29 = (r) => {
  const debito = Number(r?.iva_ventas) || 0, credito = Number(r?.iva_compras) || 0;
  const ivaNeto = Math.round(debito - credito);
  const remanente = datoF29(r?.remanente_anterior), ppm = datoF29(r?.ppm), otras = datoF29(r?.otras_retenciones);
  const ivaAPagar = remanente === null ? null : Math.max(0, ivaNeto - remanente);
  const remanenteSiguiente = remanente === null ? null : Math.max(0, remanente - ivaNeto);
  const total = ivaAPagar === null || ppm === null || otras === null ? null : ivaAPagar + ppm + otras;
  const retenciones = ppm === null || otras === null ? null : ppm + otras;
  // Descuento tributario para comisiones (una sola vez, antes de dividir):
  //  · desde octubre 2026 (DESCUENTO_TOTAL_F29_DESDE) con el desglose COMPLETO: el Total a pagar F29 después del remanente
  //    (IVA a pagar + PPM + otras retenciones), aunque esté pendiente de pago. Regla de Kevin, 13/11/2026 12:48.
  //  · antes de octubre 2026: IVA neto con signo + PPM + otras retenciones (regla del 13/11/2026 10:30).
  //  · con datos pendientes en un período desde octubre 2026: null (pendiente; la comisión queda provisoria).
  const reglaTotalF29 = usaReglaTotalF29(r?.anio, r?.mes);
  const descuentoComisiones = reglaTotalF29 ? total : retenciones === null ? null : ivaNeto + retenciones;
  const pendientes = [remanente === null && "remanente_anterior", ppm === null && "ppm", otras === null && "otras_retenciones"].filter(Boolean);
  return {
    debito, credito, ivaNeto, remanente, ppm, otras, ivaAPagar, remanenteSiguiente, total, retenciones, descuentoComisiones, reglaTotalF29, pendientes,
    // Lo que ya se sabe que hay que pagar (los datos pendientes cuentan $0 hasta ingresarlos).
    totalConocido: (ivaAPagar ?? 0) + (ppm ?? 0) + (otras ?? 0),
    completo: pendientes.length === 0,
  };
};

export const ETIQUETA_PENDIENTE = { remanente_anterior: "remanente anterior reajustado", ppm: "PPM", otras_retenciones: "otras retenciones" };
