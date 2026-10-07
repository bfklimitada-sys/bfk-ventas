// ═══════════════════════════════════════════════════════════════
// Vendedor y financiador de cada OC (regla única para ficha, listado, filtros y exportaciones).
//  · Vendedor    = quien realizó/gestionó la venta; genera comisión (solo ventas de BFK).
//  · Financiador = quien puso el capital de la compra; genera deuda/saldo de financiamiento.
//  Pueden ser la misma persona. Sin dato = "Sin definir" (nunca se infiere en la app).
// Funciones puras: no escriben nada. Las escrituras van por RPC (asignar_vendedor_oc / asignar_financiador_oc),
// que repiten estas validaciones en la base.
// ═══════════════════════════════════════════════════════════════
import { periodoComision } from "./calculos.js";
import { fmt } from "./theme.js";

export const SIN_DEFINIR = "Sin definir";
const tipo = (oc) => oc?.tipo_registro || "venta";
// Un aporte de socio no tiene vendedor ni financiador: no se marca como faltante.
const aplica = (oc) => tipo(oc) !== "aporte_socio";

export const vendedorDe = (oc, vendedores) => (vendedores || []).find((v) => v.id === oc?.vendedor_id) || null;
export const financiadorDe = (oc, financiadores) => (financiadores || []).find((f) => f.id === oc?.financiador_id) || null;
export const nombreVendedor = (oc, vendedores) => vendedorDe(oc, vendedores)?.nombre || oc?.vendedores?.nombre || (oc?.vendedor_id ? oc.vendedor_id : SIN_DEFINIR);
export const nombreFinanciador = (oc, financiadores) => financiadorDe(oc, financiadores)?.nombre || oc?.financiadores?.nombre || (oc?.financiador_id ? oc.financiador_id : SIN_DEFINIR);
export const primerNombre = (n) => (n === SIN_DEFINIR ? n : String(n || "").trim().split(/\s+/)[0] || SIN_DEFINIR);

export const faltaVendedor = (oc) => aplica(oc) && !oc?.vendedor_id;
export const faltaFinanciador = (oc) => aplica(oc) && !oc?.financiador_id;

// Filtro del listado: "" = todos · "__sin" = sin definir · id = ese vendedor/financiador.
export const SIN = "__sin__";
export const pasaFiltroVendedor = (oc, f) => !f || (f === SIN ? faltaVendedor(oc) : oc?.vendedor_id === f);
export const pasaFiltroFinanciador = (oc, f) => !f || (f === SIN ? faltaFinanciador(oc) : oc?.financiador_id === f);

// ── Cambio de vendedor ─────────────────────────────────────────
// La comisión de un mes ya pagado a un vendedor incluye esta OC: quitársela alteraría ese pago.
// El pago al vendedor nunca se borra ni se mueve; por eso el cambio se bloquea (lo mismo hace la base).
const pagosDelPeriodo = (pagosVendedor, vendedorId, p) =>
  (pagosVendedor || []).filter((x) => p && x.vendedor_id === vendedorId && Number(x.anio) === p.anio && Number(x.mes) === p.mes);
export function evaluarCambioVendedor(oc, nuevoId, pagosVendedor) {
  const actual = oc?.vendedor_id || null, nuevo = nuevoId || null;
  if (actual === nuevo) return { sinCambios: true };
  const comisionable = tipo(oc) === "venta" && oc?.estado_factura_propia === "emitida";
  const p = comisionable ? periodoComision(oc) : null;
  const pagosActual = actual ? pagosDelPeriodo(pagosVendedor, actual, p) : [];
  if (pagosActual.length) {
    return { bloqueado: true, motivo: `La comisión de ${p.mes}/${p.anio} ya se pagó a este vendedor e incluye esta OC. Cambiarlo alteraría ese pago histórico.` };
  }
  if (oc?.es_venta_propia && !nuevo) {
    return { bloqueado: true, motivo: "Es venta propia: necesita un vendedor. Para dejarlo sin definir, cambia primero el financiamiento (deja de ser venta propia)." };
  }
  const avisos = [];
  if (nuevo && pagosDelPeriodo(pagosVendedor, nuevo, p).length) avisos.push(`El nuevo vendedor ya tiene un pago registrado en ${p.mes}/${p.anio}: esta OC quedará como comisión adicional pendiente de ese mes.`);
  if (comisionable && p) avisos.push(`La comisión de esta OC (factura de ${p.mes}/${p.anio}) pasará al nuevo vendedor. No se modifica ningún pago ya realizado.`);
  if (!nuevo) avisos.push("Sin vendedor, esta OC no entra en ninguna comisión.");
  return { bloqueado: false, avisos };
}

// ── Cambio de financiador ──────────────────────────────────────
// La deuda se calcula desde la compra: cambiar el financiador la traspasa al nuevo. Con pagos al financiador
// registrados no se permite (habría que reasignar esos pagos); "Sin definir" solo sin compra ni pagos.
export function evaluarCambioFinanciador(oc, nuevoId) {
  const actual = oc?.financiador_id || null, nuevo = nuevoId || null;
  if (actual === nuevo) return { sinCambios: true };
  const nCompras = (oc?.eventos_compra || []).length;
  const pagos = (oc?.eventos_pago_financiamiento || []).reduce((s, e) => s + (Number(e.monto) || 0), 0);
  const costo = Number(oc?.costo_total) || 0;
  if (pagos > 0) return { bloqueado: true, motivo: `Esta OC tiene ${fmt.money(pagos)} pagados al financiador. Corrige o elimina esos pagos antes de cambiarlo.` };
  if (!nuevo && nCompras > 0) return { bloqueado: true, motivo: "La compra ya está registrada: su costo es deuda de un financiador. No puede quedar sin definir; elige quién la financió." };
  const avisos = [];
  if (nCompras > 0 && !oc?.es_venta_propia) avisos.push(`La compra (costo ${fmt.money(costo)}) pasará a ser deuda del nuevo financiador y saldrá del saldo del anterior. La base recalcula ambos saldos.`);
  if (oc?.es_venta_propia) avisos.push("Es venta propia: no genera deuda con el financiador.");
  return { bloqueado: false, avisos, requiereConfirmacion: nCompras > 0 };
}
