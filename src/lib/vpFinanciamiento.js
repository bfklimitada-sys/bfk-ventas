// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// Ventas privadas — financiamiento de compras y vendedor (11/11/2026). Funciones puras (sin red).
// Las reglas las aplica la base (BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql); aquí solo se muestran y se validan
// antes de enviar, con la MISMA definición que las vistas vp_fin_resumen / vp_fin_aportantes:
//   · total de la compra = Σ total pagado (con IVA) de las compras vigentes registradas en Ventas privadas (origen «registro»);
//     los gastos ya registrados en Gastos y vinculados no se financian aquí (su pago ya está registrado);
//   · financiado = Σ aportes vigentes · sin informar = total − financiado (nunca negativo);
//   · pendiente de devolución = aportes personales − devoluciones vigentes (BFK con fondos propios no es deuda).
// Separación: vendedor (a quién se atribuye la venta) ≠ responsable (quién la gestiona y registra) ≠ financiador (quién puso
// el dinero) ≠ proveedor ≠ cliente. Los aportes y devoluciones NO cambian el costo, la utilidad ni los cobros del cliente.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════
import { indicadoresVP, nuevaClave, hoyISO, aPesos } from "./ventasPrivadas.js";

const r0 = (x) => Math.round(Number(x) || 0);
const txt = (v) => String(v ?? "").trim();

// ── Vendedor ───────────────────────────────────────────────────────────────────────────────────────────
export const VENDEDOR_BFK = "bfk";
export const SIN_VENDEDOR = "";
// Valor del selector a partir del registro (cotización o venta): 'bfk' | <vendedores.id> | '' (sin asignar).
export const claveVendedor = (r) => (r?.vendedor_tipo === "bfk" ? VENDEDOR_BFK : r?.vendedor_tipo === "vendedor" ? r.vendedor_id || "" : SIN_VENDEDOR);
export const nombreVendedor = (r) => (r?.vendedor_tipo === "bfk" ? "BFK" : r?.vendedor_tipo === "vendedor" ? r.vendedor_nombre || r.vendedor_id : "Sin vendedor asignado");
// Opciones: BFK primero (la empresa, sin cuenta de acceso), luego los vendedores activos del catálogo de BFK. El vendedor ya
// asignado aparece aunque hoy esté inactivo (para no perderlo al mostrar).
export function opcionesVendedor(vendedores = [], actual = null) {
  const act = (vendedores || []).filter((v) => v.activo !== false).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  const op = [{ v: VENDEDOR_BFK, l: "BFK (empresa · sin comisión personal)" }, ...act.map((v) => ({ v: v.id, l: v.nombre }))];
  if (actual?.vendedor_tipo === "vendedor" && !op.some((o) => o.v === actual.vendedor_id)) op.push({ v: actual.vendedor_id, l: `${actual.vendedor_nombre} (inactivo)` });
  return op;
}
// Grupos de vendedor para filtrar e informar (cada venta pertenece a uno solo).
export function gruposVendedor(ventas = []) {
  const m = new Map();
  for (const v of ventas) {
    const k = claveVendedor(v);
    if (!m.has(k)) m.set(k, { clave: k, nombre: nombreVendedor(v), tipo: v.vendedor_tipo || null });
  }
  const orden = (g) => (g.clave === VENDEDOR_BFK ? 0 : g.clave === SIN_VENDEDOR ? 2 : 1);
  return [...m.values()].sort((a, b) => orden(a) - orden(b) || a.nombre.localeCompare(b.nombre, "es"));
}
export const filtrarPorVendedor = (filas, clave) => (clave == null || clave === "*" ? filas : (filas || []).filter((v) => claveVendedor(v) === clave));
// Indicadores por vendedor con la MISMA definición de indicadoresVP (ventas vigentes del período; cotizaciones no cuentan).
// La suma de los grupos es exactamente el total de Ventas privadas: ninguna venta se cuenta dos veces.
export function indicadoresPorVendedor(vp, rango = {}) {
  const ventas = (vp?.ventas || []).filter((v) => v.estado !== "anulada");
  return gruposVendedor(ventas).map((g) => {
    const k = indicadoresVP({ cotizaciones: [], ventas: ventas.filter((v) => claveVendedor(v) === g.clave), margenes: vp?.margenes || [] }, rango);
    return { ...g, ...k, comisionPersonal: g.clave !== VENDEDOR_BFK && g.clave !== SIN_VENDEDOR };
  }).filter((g) => g.nVentas > 0);
}

// ── Aportantes ─────────────────────────────────────────────────────────────────────────────────────────
export const APORTANTE_BFK = "bfk";
export const OTRA_PERSONA = "otra";
// Opciones: BFK con fondos propios · personas del catálogo de financiadores (externos, activos) · otra persona (por nombre).
export function opcionesAportante(financiadores = []) {
  const personas = (financiadores || []).filter((f) => f.tipo !== "propio" && f.activo !== false).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  return [{ v: APORTANTE_BFK, l: "BFK · fondos propios" }, ...personas.map((f) => ({ v: f.id, l: `${f.nombre} · personal` })), { v: OTRA_PERSONA, l: "Otra persona…" }];
}
export const filaAporte = (extra = {}) => ({ _k: nuevaClave(), clave: nuevaClave(), aportante: "", nombre: "", monto: "", fecha: hoyISO(), medio: "transferencia", comprobante: "", observacion: "", ...extra });

// Valida las filas antes de enviar. disponible: lo que aún se puede financiar (total de compras − ya financiado, más el total
// de esta compra si se registra junto con ella). Devuelve { errores, total }.
export function validarAportes(filas = [], { disponible = Infinity, hoy = hoyISO() } = {}) {
  const errores = []; let total = 0;
  filas.forEach((f, i) => {
    const n = `Aporte ${i + 1}`;
    if (!f.aportante) errores.push(`${n}: indica quién financia.`);
    if (f.aportante === OTRA_PERSONA && txt(f.nombre).length < 3) errores.push(`${n}: indica el nombre de la persona que aporta.`);
    if (f.aportante === OTRA_PERSONA && /^(bfk|bfk ltda\.?|cuenta bfk)$/i.test(txt(f.nombre))) errores.push(`${n}: si el dinero es de la empresa, elige «BFK con fondos propios».`);
    const m = aPesos(f.monto);
    if (m == null || Number.isNaN(m) || m <= 0) errores.push(`${n}: el monto debe ser mayor que cero.`); else total += m;
    if (!f.fecha || f.fecha > hoy) errores.push(`${n}: indica la fecha (no futura).`);
  });
  if (total > disponible) errores.push(`Lo financiado (${pesosTxt(total)}) supera lo que falta financiar (${pesosTxt(disponible)}).`);
  return { errores, total };
}
const pesosTxt = (n) => "$" + r0(n).toLocaleString("es-CL");

// Filas → formato de la base (vp_fin_aporte_interno).
export function aportesParaGuardar(filas = []) {
  return filas.map((f) => ({
    clave: f.clave, aportante_tipo: f.aportante === APORTANTE_BFK ? "bfk" : "persona",
    ...(f.aportante !== APORTANTE_BFK && f.aportante !== OTRA_PERSONA ? { financiador_id: f.aportante } : {}),
    ...(f.aportante === OTRA_PERSONA ? { aportante_nombre: txt(f.nombre) } : {}),
    monto: aPesos(f.monto), fecha: f.fecha, medio: f.medio || "transferencia", comprobante: txt(f.comprobante) || null, observacion: txt(f.observacion) || null,
    ...(f.documento_id ? { documento_id: f.documento_id } : {}),
  }));
}

// ── Resumen de una orden de venta (misma definición que vp_fin_resumen) y detalle por aportante ──────────
export function resumenFinanciamiento({ compras = [], aportes = [], devoluciones = [] } = {}) {
  const vig = (x) => x.estado === "vigente";
  const totalCompras = compras.filter((k) => vig(k) && k.origen === "registro").reduce((s, k) => s + r0(k.total), 0);
  const gastosVinculados = compras.filter((k) => vig(k) && k.origen === "gasto_existente").reduce((s, k) => s + r0(k.total), 0);
  const av = aportes.filter(vig); const dv = devoluciones.filter(vig);
  const devueltoDe = (id) => dv.filter((d) => d.aporte_id === id).reduce((s, d) => s + r0(d.monto), 0);
  const financiadoBfk = av.filter((a) => a.aportante_tipo === "bfk").reduce((s, a) => s + r0(a.monto), 0);
  const financiadoPersonas = av.filter((a) => a.aportante_tipo === "persona").reduce((s, a) => s + r0(a.monto), 0);
  const financiado = financiadoBfk + financiadoPersonas;
  const devuelto = dv.reduce((s, d) => s + r0(d.monto), 0);
  const grupos = new Map();
  for (const a of av) {
    const k = a.financiador_id || `nombre:${txt(a.aportante_nombre).toLowerCase()}`;
    const g = grupos.get(k) || { clave: k, nombre: a.aportante_nombre, tipo: a.aportante_tipo, financiador_id: a.financiador_id || null, aportado: 0, devuelto: 0, aportes: [] };
    const d = devueltoDe(a.id);
    g.aportado += r0(a.monto); g.devuelto += d;
    g.aportes.push({ ...a, devuelto: d, pendiente: a.aportante_tipo === "persona" ? r0(a.monto) - d : 0 });
    grupos.set(k, g);
  }
  const porAportante = [...grupos.values()].map((g) => ({ ...g, pendiente: g.tipo === "persona" ? g.aportado - g.devuelto : 0 }))
    .sort((a, b) => (a.tipo === "bfk" ? -1 : b.tipo === "bfk" ? 1 : a.nombre.localeCompare(b.nombre, "es")));
  return { totalCompras, gastosVinculados, financiado, financiadoBfk, financiadoPersonas, sinInformar: Math.max(0, totalCompras - financiado),
    devuelto, pendienteDevolucion: financiadoPersonas - devuelto, porAportante, nAportes: av.length,
    estado: totalCompras === 0 ? "sin_compras" : financiado === 0 ? "sin_informar" : financiado < totalCompras ? "parcial" : "completo" };
}
export const ESTADOS_FINANCIAMIENTO = {
  sin_compras: { l: "Sin compras registradas", tono: "neutro" }, sin_informar: { l: "Financiamiento sin informar", tono: "warn" },
  parcial: { l: "Financiamiento parcial", tono: "info" }, completo: { l: "Financiamiento informado", tono: "ok" },
};

// Totales de Finanzas (todas las ventas visibles): resumen por venta (vp_fin_resumen) y por persona (vp_fin_aportantes).
export function totalesFinanciamiento(resumenes = [], aportantes = []) {
  const s = (k) => resumenes.reduce((t, r) => t + r0(r[k]), 0);
  return { totalCompras: s("total_compras"), financiado: s("financiado"), financiadoBfk: s("financiado_bfk"), financiadoPersonas: s("financiado_personas"),
    sinInformar: s("sin_informar"), devuelto: s("devuelto"), pendienteDevolucion: s("pendiente_devolucion"),
    ventasSinInformar: resumenes.filter((r) => r0(r.sin_informar) > 0).length,
    personas: aportantes.filter((a) => a.aportante_tipo === "persona").map((a) => ({ ...a, aportado: r0(a.aportado), devuelto: r0(a.devuelto), pendiente: r0(a.pendiente_devolucion) }))
      .sort((a, b) => b.pendiente - a.pendiente || String(a.nombre).localeCompare(String(b.nombre), "es")),
    bfk: aportantes.filter((a) => a.aportante_tipo === "bfk").reduce((t, a) => t + r0(a.aportado), 0) };
}

// Saldo de un aporte para registrar una devolución (null si no admite: BFK o anulado).
export const saldoAporte = (ap) => (ap && ap.estado === "vigente" && ap.aportante_tipo === "persona" ? ap.pendiente ?? r0(ap.monto) - r0(ap.devuelto) : null);
export function validarDevolucion({ aporte, monto, fecha, hoy = hoyISO() }) {
  const errores = []; const m = aPesos(monto); const saldo = saldoAporte(aporte);
  if (saldo == null) errores.push("Este aporte no admite devoluciones (BFK con fondos propios no genera deuda, o está anulado).");
  if (m == null || Number.isNaN(m) || m <= 0) errores.push("El monto devuelto debe ser mayor que cero.");
  else if (saldo != null && m > saldo) errores.push(`No se puede devolver más que el saldo pendiente (${pesosTxt(saldo)}).`);
  if (!fecha || fecha > hoy) errores.push("Indica la fecha de la devolución (no futura).");
  else if (aporte?.fecha && fecha < aporte.fecha) errores.push("La devolución no puede ser anterior al aporte.");
  return { errores, monto: m };
}
