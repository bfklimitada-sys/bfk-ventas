// ═══════════════════════════════════════════════════════════════
// Filtros «Financiamiento pendiente» y «Vale vista pendiente» de Compras (15/10/2026).
// Solo consulta y presentación: no escribe datos ni cambia reglas financieras.
//
// Financiamiento pendiente: OC comprada, con financiador EXTERNO (la base marca «no_aplica» los fondos propios
// y la venta propia: ahí no corresponde devolución) y con saldo > 0 según sus registros:
//   costo de la compra − devoluciones ya asignadas a la OC (cada devolución de capital se reparte por FIFO
//   global al registrarse: OC más antigua primero). No se inventan repartos: lo no asignado a una OC
//   (pagos sueltos o ajustes) solo se refleja en el saldo global del financiador.
// Vale vista pendiente: OC con vales vista o cheques RECIBIDOS que aún no están abonados en el banco
//   (misma regla de lib/mediosPago.js: no son caja ni se concilian hasta marcarse cobrados).
// ═══════════════════════════════════════════════════════════════
import { estaComprada, financiamientoPagado, valeVistasPendientes } from "./ocs.js";
import { esDocumentoBancario, etiquetaMedio } from "./mediosPago.js";

const num = (x) => Number(x) || 0;
export const saldoFinanciamientoOC = (oc) => Math.max(0, num(oc?.costo_total) - num(oc?.monto_pagado_fin));
export const financiamientoPendiente = (oc) => estaComprada(oc) && !financiamientoPagado(oc) && saldoFinanciamientoOC(oc) > 0;
// Compradas donde NO corresponde devolución (fondos propios o venta propia).
export const financiamientoNoCorresponde = (oc) => estaComprada(oc) && oc?.estado_pago_financiamiento === "no_aplica";

// Resumen por financiador. lista: las OC mostradas; todas: todas las OC (para comparar con el saldo global).
export function resumenFinanciamiento(lista, todas, financiadores) {
  const grupos = new Map();
  const totalPorFin = new Map();
  for (const o of todas || []) if (financiamientoPendiente(o)) totalPorFin.set(o.financiador_id || "", (totalPorFin.get(o.financiador_id || "") || 0) + saldoFinanciamientoOC(o));
  for (const o of lista || []) {
    if (!financiamientoPendiente(o)) continue;
    const id = o.financiador_id || "";
    if (!grupos.has(id)) {
      const f = (financiadores || []).find((x) => x.id === id);
      grupos.set(id, { id, nombre: f?.nombre || (id ? id : "Sin financiador"), tipo: f?.tipo === "propio" ? "propio" : "externo", n: 0, costo: 0, devuelto: 0, pendiente: 0,
        saldoGlobal: f && f.saldo_deuda != null ? num(f.saldo_deuda) : null, pendienteTodas: totalPorFin.get(id) || 0 });
    }
    const g = grupos.get(id); g.n++; g.costo += num(o.costo_total); g.devuelto += num(o.monto_pagado_fin); g.pendiente += saldoFinanciamientoOC(o);
  }
  // ¿El saldo global del financiador coincide con la suma de sus OC pendientes? Si no, hay pagos sin asignar a OC o ajustes.
  for (const g of grupos.values()) g.cuadra = g.saldoGlobal == null ? null : Math.abs(g.saldoGlobal - g.pendienteTodas) <= 1;
  return [...grupos.values()].sort((a, b) => b.pendiente - a.pendiente);
}

// Documentos (vale vista / cheque) recibidos y sin abonar en el banco, de las OC indicadas.
export const documentosPendientes = (ocs) => (ocs || []).flatMap((oc) => valeVistasPendientes(oc).map((ev) => ({
  oc, ev, cliente: oc.cliente || oc.entidad || "", numero: oc.numero_oc, monto: num(ev.monto), fecha: ev.fecha || null,
  medio: etiquetaMedio(ev), institucion: ev.institucion || "", estado: "Documento recibido · sin abonar en banco" })));
export const tieneValeVistaPendiente = (oc) => valeVistasPendientes(oc).length > 0;
// Documentos de la OC ya abonados (para mostrar «Dinero abonado en banco» junto a los pendientes).
export const documentosCobrados = (oc) => (oc?.eventos_pago_cliente || []).filter((e) => esDocumentoBancario(e) && e.cobrado_en_banco);
