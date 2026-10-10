import { calcularPagoVendedor, comisionProvisoria, extraGestion, pagoVigente, totalTransferido } from "./calculos.js";
import { utilidadPorMes } from "./ocs.js";
import { movimientosCaja } from "./caja.js";
import { aporteEnCaja, esCobroFueraDeBanco, esValeVistaPendiente, gastoEnCaja } from "./mediosPago.js";
import { deudaOC } from "./finanzas.js";

// ═══════════════════════════════════════════════════════════════
// Informes financieros (Etapa 3, 2026-10) — SOLO presentación: no cambian ningún monto, regla ni registro.
//
//  · Comisión ............. pagos_vendedor.monto_pagado (por mes de las ventas).
//  · Apoyo en gestión ..... una sola línea que suma el gasto "Apoyo en gestión" y el extra por gestión que va
//                           dentro de un pago a vendedor (monto_extra_gestion). La salida bancaria sigue siendo
//                           UNA: el total transferido del pago o el gasto, nunca ambos.
//  · Devolución a financiador: disminuye la deuda (pasivo). No es gasto.
//  · Aporte / retiro de capital: patrimonio. No es gasto.
//  · Impuestos (IVA, PPM) y retenciones del cliente: obligaciones tributarias, no gasto operacional.
// ═══════════════════════════════════════════════════════════════

const n = (v) => Number(v) || 0;
const clave = (anio, mes) => `${anio}-${String(mes).padStart(2, "0")}`;
export const CATEGORIA_APOYO = "cat_apoyo_gestion";

// Clasificación de un gasto para los informes (no cambia la categoría guardada).
export function claseGasto(g, categorias = []) {
  const id = g?.categoria_id;
  if (id === "cat_impuesto") return "impuestos";
  const nombre = String((categorias || []).find((c) => c.id === id)?.nombre || "");
  if (/retenci[oó]n/i.test(nombre) || !gastoEnCaja(g)) return "retenciones";
  if (id === CATEGORIA_APOYO) return "apoyo";
  if (id === "cat_vendedor") return "comisiones";
  return "operacional";
}

// Apoyo en gestión: cada monto UNA vez, con su origen. Período = mes de la comisión que acompaña
// (pago a vendedor) o el mes/año del gasto.
export function apoyoEnGestion({ gastos, pagosVendedor }) {
  const items = [];
  for (const g of gastos || []) if (g.categoria_id === CATEGORIA_APOYO)
    items.push({ origen: "gasto", id: g.id, fecha: String(g.fecha || "").slice(0, 10), anio: n(g.anio), mes: n(g.mes), monto: n(g.monto), detalle: g.detalle || "" });
  for (const p of pagosVendedor || []) if (pagoVigente(p) && extraGestion(p) > 0)
    items.push({ origen: "pago_vendedor", id: p.id, fecha: String(p.fecha || "").slice(0, 10), anio: n(p.anio), mes: n(p.mes), monto: extraGestion(p),
      vendedorId: p.vendedor_id, detalle: `Incluido en la transferencia de ${totalTransferido(p)} (comisión ${n(p.monto_pagado)})` });
  items.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { items, total: items.reduce((s, x) => s + x.monto, 0) };
}

// Comisión, apoyo en gestión y total transferido por vendedor y período (sin duplicar la salida bancaria).
export function comisionesYApoyo({ pagosVendedor, gastos, vendedores }) {
  const filas = {};
  const fila = (vendedorId, anio, mes) => (filas[`${vendedorId}|${clave(anio, mes)}`] ||= { vendedorId, vendedor: (vendedores || []).find((v) => v.id === vendedorId)?.nombre || vendedorId, anio, mes, comision: 0, apoyoEnPago: 0, apoyoGasto: 0, transferido: 0 });
  for (const p of pagosVendedor || []) if (pagoVigente(p)) {
    const f = fila(p.vendedor_id, n(p.anio), n(p.mes));
    f.comision += n(p.monto_pagado); f.apoyoEnPago += extraGestion(p); f.transferido += totalTransferido(p);
  }
  // Los gastos de apoyo no traen vendedor: se informan por período, aparte (salen del banco como gasto).
  const apoyoGastos = (gastos || []).filter((g) => g.categoria_id === CATEGORIA_APOYO).map((g) => ({ anio: n(g.anio), mes: n(g.mes), monto: n(g.monto), fecha: String(g.fecha || "").slice(0, 10), detalle: g.detalle || "" }));
  return { filas: Object.values(filas).sort((a, b) => a.anio - b.anio || a.mes - b.mes), apoyoGastos };
}

// Resultado de un mes: margen comercial (venta − costo − postventa, por fecha de la OC, igual que el Panel)
// − comisiones devengadas (por mes de factura) − apoyo en gestión − gastos operacionales.
export function resultadoMes({ ocs, gastos, pagosVendedor, ivaMensual, vendedores, categorias }, anio, mes) {
  const activas = (ocs || []).filter((o) => !o.archivada);
  const m = utilidadPorMes(activas)[clave(anio, mes)] || { venta: 0, costo: 0, util: 0, n: 0, pct: 0 };
  let comisiones = 0, provisoria = false;
  for (const v of vendedores || []) {
    const c = calcularPagoVendedor({ vendedorId: v.id, ocs: activas, anio, mes, ivaMensual: ivaMensual || [], pagosVendedor: pagosVendedor || [] });
    if (!c) continue;
    comisiones += n(c.pagoCalculado);
    if (comisionProvisoria(c)) provisoria = true;
  }
  const delMes = (gastos || []).filter((g) => n(g.anio) === anio && n(g.mes) === mes);
  const apoyo = apoyoEnGestion({ gastos: delMes, pagosVendedor: (pagosVendedor || []).filter((p) => n(p.anio) === anio && n(p.mes) === mes) }).total;
  const operacionales = delMes.filter((g) => claseGasto(g, categorias) === "operacional").reduce((s, g) => s + n(g.monto), 0);
  const comisionesHistoricas = delMes.filter((g) => claseGasto(g, categorias) === "comisiones").reduce((s, g) => s + n(g.monto), 0);
  const impuestos = delMes.filter((g) => ["impuestos", "retenciones"].includes(claseGasto(g, categorias))).reduce((s, g) => s + n(g.monto), 0);
  const resultado = m.util - comisiones - comisionesHistoricas - apoyo - operacionales;
  return { anio, mes, venta: m.venta, costo: m.costo, margenComercial: m.util, pctMargen: m.pct, comisiones: comisiones + comisionesHistoricas, comisionesProvisorias: provisoria,
    apoyoGestion: apoyo, gastosOperacionales: operacionales, impuestosInformativos: impuestos, resultado };
}

// Caja bancaria vs. registros fuera del banco. La caja usa EXACTAMENTE movimientosCaja (lib/caja.js).
export function cajaYFueraDelBanco({ ocs, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes }) {
  const activas = (ocs || []).filter((o) => !o.archivada);
  const movs = movimientosCaja({ ocs: activas, financiadores, gastos, pagosVendedor, pagoFinSueltos, aportes });
  const porTipo = {};
  for (const m of movs) { const t = (porTipo[m.tipo] ||= { n: 0, monto: 0 }); t.n++; t.monto += m.monto; }
  const fuera = { cobrosFueraBanco: [], valeVistaPorCobrar: [], gastosSinCargo: [], aportesSinMovimiento: [] };
  for (const o of activas) for (const e of o.eventos_pago_cliente || []) {
    if (esCobroFueraDeBanco(e)) fuera.cobrosFueraBanco.push({ fecha: String(e.fecha).slice(0, 10), monto: n(e.monto), oc: o.numero_oc, medio: e.medio_pago });
    else if (esValeVistaPendiente(e)) fuera.valeVistaPorCobrar.push({ fecha: String(e.fecha).slice(0, 10), monto: n(e.monto), oc: o.numero_oc, medio: e.medio_pago });
  }
  for (const g of gastos || []) if (!gastoEnCaja(g)) fuera.gastosSinCargo.push({ fecha: String(g.fecha).slice(0, 10), monto: n(g.monto), detalle: g.detalle || g.subcategoria || "" });
  for (const a of aportes || []) if (!aporteEnCaja(a)) fuera.aportesSinMovimiento.push({ fecha: String(a.fecha).slice(0, 10), monto: n(a.monto), socio: a.socio, tipo: a.tipo });
  const total = (l) => l.reduce((s, x) => s + x.monto, 0);
  return { caja: movs.reduce((s, m) => s + m.monto, 0), porTipo,
    fuera: Object.fromEntries(Object.entries(fuera).map(([k, l]) => [k, { items: l, n: l.length, total: total(l) }])) };
}

// Financiadores: compras financiadas, devoluciones y ajustes → saldo. Las devoluciones NO son gasto.
export function resumenFinanciadores({ ocs, financiadores, pagoFinSueltos, ajustes }) {
  return (financiadores || []).filter((f) => f.tipo !== "propio").map((f) => {
    const ocsF = (ocs || []).filter((o) => !o.archivada && o.financiador_id === f.id && !o.es_venta_propia && (o.tipo_registro || "venta") === "venta" && (o.eventos_compra || []).length);
    const compras = ocsF.reduce((s, o) => s + n(o.costo_total), 0);
    const devOC = (ocs || []).filter((o) => !o.archivada).flatMap((o) => (o.eventos_pago_financiamiento || []).filter((e) => (e.financiador_id || o.financiador_id) === f.id)).reduce((s, e) => s + n(e.monto), 0);
    const devSueltas = (pagoFinSueltos || []).filter((e) => e.financiador_id === f.id).reduce((s, e) => s + n(e.monto), 0);
    const aj = (ajustes || []).filter((a) => a.financiador_id === f.id).reduce((s, a) => s + n(a.monto_ajuste), 0);
    const pendientePorOC = ocsF.reduce((s, o) => s + Math.max(0, deudaOC(o)), 0);
    return { id: f.id, nombre: f.nombre, compras, devoluciones: devOC + devSueltas, devolucionesSinOC: devSueltas, ajustes: aj,
      saldo: n(f.saldo_deuda), calculado: compras - devOC - devSueltas + aj, pendientePorOC };
  });
}
