// ═══════════════════════════════════════════════════════════════
// Vendedor y financiador de cada OC (regla única para ficha, listado, filtros y exportaciones).
//  · Vendedor    = quien realizó/gestionó la venta; genera comisión (solo ventas de BFK).
//  · Financiador = quien puso el capital de la compra; genera deuda/saldo de financiamiento.
//  Pueden ser la misma persona. Sin dato = "Sin definir" (nunca se infiere en la app).
//  Venta de capitalización de BFK Ltda. (capitalizacion_bfk): no tiene vendedor personal ni genera comisión;
//  no es un dato faltante. Comisión excluida (comision_excluida): OC con vendedor asignado retroactivamente en un
//  mes de comisión ya cerrado; figura con su vendedor pero no cambia la comisión de ese mes.
// Funciones puras: no escriben nada. Las escrituras van por RPC (asignar_vendedor_oc / asignar_financiador_oc),
// que repiten estas validaciones en la base.
// ═══════════════════════════════════════════════════════════════
import { periodoComision } from "./calculos.js";
import { fmt } from "./theme.js";

export const SIN_DEFINIR = "Sin definir";
export const CAPITALIZACION = "__capitalizacion__";
export const ETIQUETA_CAPITALIZACION = "BFK Ltda. · Capitalización";
export const esCapitalizacion = (oc) => !!oc?.capitalizacion_bfk;
const tipo = (oc) => oc?.tipo_registro || "venta";
// Un aporte de socio no tiene vendedor ni financiador: no se marca como faltante.
const aplica = (oc) => tipo(oc) !== "aporte_socio";

export const vendedorDe = (oc, vendedores) => (vendedores || []).find((v) => v.id === oc?.vendedor_id) || null;
export const financiadorDe = (oc, financiadores) => (financiadores || []).find((f) => f.id === oc?.financiador_id) || null;
export const nombreVendedor = (oc, vendedores) => esCapitalizacion(oc) ? ETIQUETA_CAPITALIZACION : vendedorDe(oc, vendedores)?.nombre || oc?.vendedores?.nombre || (oc?.vendedor_id ? oc.vendedor_id : SIN_DEFINIR);
export const nombreFinanciador = (oc, financiadores) => financiadorDe(oc, financiadores)?.nombre || oc?.financiadores?.nombre || (oc?.financiador_id ? oc.financiador_id : SIN_DEFINIR);
export const primerNombre = (n) => (n === SIN_DEFINIR ? n : n === ETIQUETA_CAPITALIZACION ? "BFK Ltda. (capitalización)" : String(n || "").trim().split(/\s+/)[0] || SIN_DEFINIR);

export const faltaVendedor = (oc) => aplica(oc) && !oc?.vendedor_id && !esCapitalizacion(oc);
export const faltaFinanciador = (oc) => aplica(oc) && !oc?.financiador_id;

// Filtro del listado: "" = todos · "__sin" = sin definir · id = ese vendedor/financiador.
export const SIN = "__sin__";
export const pasaFiltroVendedor = (oc, f) => !f || (f === SIN ? faltaVendedor(oc) : f === CAPITALIZACION ? esCapitalizacion(oc) : oc?.vendedor_id === f);
// Valor del selector de vendedor de la ficha: id, CAPITALIZACION o "" (Sin definir).
export const valorVendedor = (oc) => (esCapitalizacion(oc) ? CAPITALIZACION : oc?.vendedor_id || "");

// Comisión de la OC, en palabras (ficha y exportaciones).
export function estadoComision(oc) {
  if (esCapitalizacion(oc)) return { genera: false, texto: "No genera comisión (venta de capitalización de BFK Ltda.)" };
  if (tipo(oc) === "externa") return { genera: false, texto: "No genera comisión (venta externa)" };
  if (tipo(oc) !== "venta") return { genera: false, texto: "No aplica" };
  if (!oc?.vendedor_id) return { genera: false, texto: "Sin vendedor: no entra en ninguna comisión" };
  if (oc?.comision_excluida) return { genera: false, texto: "No genera comisión (vendedor asignado después del cierre de ese mes)" };
  return { genera: true, texto: "Genera comisión" };
}
export const pasaFiltroFinanciador = (oc, f) => !f || (f === SIN ? faltaFinanciador(oc) : oc?.financiador_id === f);

// ── Cambio de vendedor ─────────────────────────────────────────
// La comisión de un mes ya pagado a un vendedor incluye esta OC: quitársela alteraría ese pago.
// El pago al vendedor nunca se borra ni se mueve; por eso el cambio se bloquea (lo mismo hace la base).
const pagosDelPeriodo = (pagosVendedor, vendedorId, p) =>
  (pagosVendedor || []).filter((x) => p && x.vendedor_id === vendedorId && Number(x.anio) === p.anio && Number(x.mes) === p.mes);
export function evaluarCambioVendedor(oc, nuevoId, pagosVendedor) {
  const actual = valorVendedor(oc) || null, nuevo = nuevoId || null;
  if (actual === nuevo) return { sinCambios: true };
  const vendActual = oc?.vendedor_id || null, vendNuevo = nuevo === CAPITALIZACION ? null : nuevo;
  const comisionable = tipo(oc) === "venta" && oc?.estado_factura_propia === "emitida" && !oc?.comision_excluida;
  const p = comisionable ? periodoComision(oc) : null;
  const pagosActual = vendActual ? pagosDelPeriodo(pagosVendedor, vendActual, p) : [];
  if (pagosActual.length) {
    return { bloqueado: true, motivo: `La comisión de ${p.mes}/${p.anio} ya se pagó a este vendedor e incluye esta OC. Cambiarlo alteraría ese pago histórico.` };
  }
  if (oc?.es_venta_propia && !vendNuevo) {
    return { bloqueado: true, motivo: "Es venta propia: necesita un vendedor. Para dejarla sin vendedor personal, cambia primero el financiamiento (deja de ser venta propia)." };
  }
  const avisos = [];
  if (nuevo === CAPITALIZACION) avisos.push("Venta de capitalización de BFK Ltda.: sin vendedor personal y no genera comisión. El financiador, la compra, los pagos y los cobros no cambian.");
  if (vendNuevo && pagosDelPeriodo(pagosVendedor, vendNuevo, p).length) avisos.push(`El nuevo vendedor ya tiene un pago registrado en ${p.mes}/${p.anio}: esta OC quedará como comisión adicional pendiente de ese mes.`);
  if (vendNuevo && comisionable && p) avisos.push(`La comisión de esta OC (factura de ${p.mes}/${p.anio}) pasará al nuevo vendedor. No se modifica ningún pago ya realizado.`);
  if (vendNuevo && oc?.comision_excluida) avisos.push("Esta OC no genera comisión (mes de comisión ya cerrado): el cambio no altera ninguna comisión.");
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
