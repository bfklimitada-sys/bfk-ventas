// ═══════════════════════════════════════════════════════════════
// Operaciones financieras de las OCs (Fase 4B).
// Toda operación que afecta costos, pagos, deuda o facturación se hace en la
// base, en una sola transacción, y los totales (costo de la OC, monto pagado,
// saldo del financiador, facturado, cobrado y sus estados) los recalcula la
// base desde los eventos reales. El navegador ya no calcula ni escribe totales.
// ═══════════════════════════════════════════════════════════════
import { SUPABASE_URL, hdrs } from "./supabase.jsx";

async function rpc(token, fn, body) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: hdrs(token), body: JSON.stringify(body) });
  } catch {
    throw new Error("Sin conexión con la base: no se guardó nada.");
  }
  const cuerpo = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = cuerpo?.message || `La base respondió ${r.status}`;
    throw Object.assign(new Error(/no se (registró|guardó) ningún cambio|no se guardó nada/i.test(msg) ? msg : `${msg} (no se guardó nada)`),
      { rpcStatus: r.status, rpcCuerpo: cuerpo });
  }
  return cuerpo;
}

const fechaONull = (f) => (f ? String(f).slice(0, 10) : null);

// Compra (M1): crea el evento de compra; si la OC aún no tiene compras, la primera fija su financiador.
export const registrarCompraOC = (t, { ocId, fecha, costo, financiadorId = null, proveedor = "", fechaEntregaEstimada = null, montoVenta = null, notas = "" }) =>
  rpc(t, "registrar_compra_oc", {
    p_oc_id: ocId, p_fecha: fechaONull(fecha), p_costo: Number(costo), p_financiador_id: financiadorId || null,
    p_proveedor: proveedor || "", p_fecha_entrega_estimada: fechaONull(fechaEntregaEstimada),
    p_monto_venta: montoVenta === null || montoVenta === undefined || montoVenta === "" ? null : Number(montoVenta), p_notas: notas || "",
  });

export const editarCompraOC = (t, { eventoId, fecha, costo, montoVenta = null, fechaEntregaEstimada = null, proveedor = null }) =>
  rpc(t, "editar_compra_oc", {
    p_evento_id: eventoId, p_fecha: fechaONull(fecha), p_costo: Number(costo),
    p_monto_venta: montoVenta === null || montoVenta === undefined || montoVenta === "" ? null : Number(montoVenta),
    p_fecha_entrega_estimada: fechaONull(fechaEntregaEstimada), p_proveedor: proveedor,
  });

export const eliminarCompraOC = (t, eventoId) => rpc(t, "eliminar_compra_oc", { p_evento_id: eventoId });

export const editarPagoFinanciador = (t, { eventoId, fecha, monto }) =>
  rpc(t, "editar_pago_financiador", { p_evento_id: eventoId, p_fecha: fechaONull(fecha), p_monto: Number(monto) });

export const eliminarPagoFinanciador = (t, eventoId) => rpc(t, "eliminar_pago_financiador", { p_evento_id: eventoId });

// Cambio de financiamiento (M2): tipo = externo | fondos_propios | venta_propia.
export const cambiarFinanciamientoOC = (t, { ocId, tipo, financiadorId = null }) =>
  rpc(t, "cambiar_financiamiento_oc", { p_oc_id: ocId, p_tipo: tipo, p_financiador_id: financiadorId || null });

// ── Lectura (sin escribir nada) ───────────────────────────────
export const TIPOS_FINANCIAMIENTO = {
  externo: { etiqueta: "Financiador externo", detalle: "Genera deuda con el financiador hasta que se le paga." },
  fondos_propios: { etiqueta: "Fondos propios (Cuenta BFK)", detalle: "No es deuda con un financiador: la etapa de financiamiento no aplica." },
  venta_propia: { etiqueta: "Venta propia", detalle: "No genera deuda: la etapa de financiamiento no aplica y no requiere un pago para cerrar." },
};
export const esFondosPropios = (fin) => fin?.tipo === "propio";
export const financiadoresExternos = (fs) => (fs || []).filter((f) => !esFondosPropios(f));
export const tipoFinanciamiento = (oc, financiadores) =>
  oc?.es_venta_propia ? "venta_propia"
    : esFondosPropios((financiadores || []).find((f) => f.id === oc?.financiador_id)) ? "fondos_propios" : "externo";
export const financiamientoNoAplica = (oc) => oc?.estado_pago_financiamiento === "no_aplica";
// Lo que la OC aún debe a su financiador (0 si no aplica). Viene de los totales que calcula la base.
export const deudaOC = (oc) =>
  financiamientoNoAplica(oc) ? 0 : Math.max(0, (Number(oc?.costo_total) || 0) - (Number(oc?.monto_pagado_fin) || 0));
// Saldo del financiador: positivo = BFK le debe; negativo = a favor de BFK (pagos mayores que la deuda).
export const describirSaldo = (saldo) => {
  const n = Number(saldo) || 0;
  return n > 0 ? "deuda" : n < 0 ? "a_favor" : "cero";
};

// ── Diferencias históricas pendientes (Fase 4B) ───────────────
export const diferenciasPendientes = (difs, entidad, id) =>
  (difs || []).filter((d) => d.entidad === entidad && d.entidad_id === id && d.estado === "pendiente");
export const bloqueoDominio = (difs, ocId, dominio) =>
  diferenciasPendientes(difs, "oc", ocId).some((d) => (d.bloquea || []).includes(dominio));
