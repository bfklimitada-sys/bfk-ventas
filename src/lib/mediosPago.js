// ═══════════════════════════════════════════════════════════════
// Qué pasa (y qué no pasa) por la cuenta BancoEstado de BFK. Regla única para caja, Panel,
// vale vistas pendientes, búsqueda y exportación (conciliación bancaria 2026-10).
//
// Cobros (eventos_pago_cliente.medio_pago)
//  · transferencia ............ entra al banco.
//  · vale_vista / cheque ...... entra al banco cuando se marca cobrado (cobrado_en_banco).
//  · retencion ................ el cliente retuvo ese monto (p. ej. impuesto): la factura queda pagada,
//                               pero esa plata nunca entra al banco.
//  · fuera_banco .............. cobrado fuera de la cuenta de BFK (p. ej. venta externa que cobró y
//                               conserva el vendedor): la factura queda pagada, no hay abono bancario.
//  Los dos últimos cuentan como cobrado de la OC, pero NO son caja ni vale vista por cobrar.
// Gastos: subcategoría "Retención (sin movimiento bancario)" → gasto contable, sin cargo bancario.
// Aportes de socios: medio "Sin movimiento BancoEstado comprobado" → aporte patrimonial histórico,
//   no se suma a la caja BancoEstado (no se exige un depósito en su fecha de registro).
// ═══════════════════════════════════════════════════════════════

export const MEDIOS_FUERA_BANCO = ["retencion", "fuera_banco"];
export const SUBCAT_GASTO_SIN_BANCO = "Retención (sin movimiento bancario)";
export const MEDIO_APORTE_SIN_BANCO = "Sin movimiento BancoEstado comprobado";

export const MEDIOS_PAGO = [
  { id: "transferencia", etiqueta: "Transferencia" },
  { id: "vale_vista", etiqueta: "Vale Vista" },
  { id: "cheque", etiqueta: "Cheque" },
  { id: "retencion", etiqueta: "Retención del cliente (no entra al banco)" },
  { id: "fuera_banco", etiqueta: "Cobrado fuera de la cuenta BFK (no entra al banco)" },
];

const medio = (e) => e?.medio_pago || "transferencia";
export const esCobroFueraDeBanco = (e) => MEDIOS_FUERA_BANCO.includes(medio(e));
// Vale vista o cheque entregado y todavía sin cobrar en el banco.
export const esValeVistaPendiente = (e) => medio(e) !== "transferencia" && !esCobroFueraDeBanco(e) && !e?.cobrado_en_banco;
export const esDocumentoBancario = (e) => medio(e) !== "transferencia" && !esCobroFueraDeBanco(e);
// El cobro ya es dinero en la cuenta BancoEstado.
export const cobroEnCaja = (e) => !esCobroFueraDeBanco(e) && !esValeVistaPendiente(e);
// El cobro reduce lo que el cliente debe (todo menos un vale vista o cheque sin cobrar).
export const cobroSaldaCliente = (e) => !esValeVistaPendiente(e);

export const gastoEnCaja = (g) => String(g?.subcategoria || "").trim() !== SUBCAT_GASTO_SIN_BANCO;
export const aporteEnCaja = (a) => String(a?.medio || "").trim() !== MEDIO_APORTE_SIN_BANCO;

export const etiquetaMedio = (e) => (MEDIOS_PAGO.find((m) => m.id === medio(e))?.etiqueta || medio(e));
