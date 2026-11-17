// ═══════════════════════════════════════════════════════════════
// Centro de Acciones Pendientes (17/11/2026). Funciones puras (no escriben datos).
// Una «acción» es una fila de public.oc_seguimientos (el mismo Seguimiento especial de la OC, ampliado): con OC (vive dentro
// de la OC, oc.oc_seguimientos) o sin OC (lista aparte). La base fija autor, fechas, responsable, resolución, historial y las
// acciones automáticas (postventa y entrega fallida); aquí solo se arma, ordena, filtra y cuenta la bandeja.
// ═══════════════════════════════════════════════════════════════
import { leerSubsanacion, PRIORIDADES_SEGUIMIENTO } from "./seguimientos.js";

// Catálogo inicial (igual al de la migración). La app usa el de la base (acciones_categorias) cuando está disponible.
export const CATEGORIAS_BASE = [
  { id: "proveedor", etiqueta: "Compras y proveedores", orden: 10, activa: true },
  { id: "entrega", etiqueta: "Entregas y despachos", orden: 20, activa: true },
  { id: "postventa", etiqueta: "Postventa, garantías y reclamos", orden: 30, activa: true },
  { id: "instalacion", etiqueta: "Instalaciones y servicios técnicos", orden: 40, activa: true },
  { id: "facturacion", etiqueta: "Facturación", orden: 50, activa: true },
  { id: "cobranza", etiqueta: "Cobranza", orden: 60, activa: true },
  { id: "comercial", etiqueta: "Gestiones comerciales", orden: 70, activa: true },
  { id: "administrativa", etiqueta: "Otras tareas administrativas", orden: 80, activa: true },
  { id: "sobrecosto", etiqueta: "Sobrecosto / Cargo adicional", orden: 110, activa: true },
  { id: "producto", etiqueta: "Producto", orden: 120, activa: true },
  { id: "cliente", etiqueta: "Cliente", orden: 130, activa: true },
  { id: "otro", etiqueta: "Otro", orden: 140, activa: true },
];
export const ordenarCategorias = (cats) => [...(cats?.length ? cats : CATEGORIAS_BASE)].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100) || String(a.etiqueta).localeCompare(String(b.etiqueta)));
export const categoriasActivas = (cats) => ordenarCategorias(cats).filter((c) => c.activa !== false);
export const etiquetaCat = (cats, id) => (cats?.length ? cats : CATEGORIAS_BASE).find((c) => c.id === id)?.etiqueta || id || "";

export const ORIGENES = { postventa: "Automática · incidente de postventa", entrega_fallida: "Automática · entrega fallida" };
export const RANGO_PRIORIDAD = { alta: 3, media: 2, baja: 1 };
export const etiquetaPrioridadAcc = (p) => PRIORIDADES_SEGUIMIENTO.find((x) => x.id === p)?.etiqueta || p || "";
export const ESTADOS_ACCION = { pendiente: "Pendiente", en_gestion: "En gestión", resuelto: "Resuelta" };

export const hoyLocal = () => { const d = new Date(); const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
export const abierta = (a) => a?.estado === "pendiente" || a?.estado === "en_gestion";
export const vencida = (a, hoy = hoyLocal()) => abierta(a) && !!a.fecha_revision && String(a.fecha_revision).slice(0, 10) < hoy;
export const venceHoy = (a, hoy = hoyLocal()) => abierta(a) && !!a.fecha_revision && String(a.fecha_revision).slice(0, 10) === hoy;
export const urgente = (a) => abierta(a) && a.prioridad === "alta";

// Título visible: el registrado; si no hay (seguimientos de OC anteriores al 17/11/2026), la subsanación o la primera línea.
export function tituloAccion(a) {
  if (a?.titulo) return a.titulo;
  const sub = leerSubsanacion(a); if (sub) return `Subsanación de factura N.º ${sub.numero || "s/n"}`;
  const l = String(a?.descripcion || "").split("\n")[0].trim();
  return l.length > 90 ? l.slice(0, 87) + "…" : l || "Acción";
}
// Descripción sin la marca interna de la subsanación.
export const descripcionAccion = (a) => String(a?.descripcion || "").replace(/\n?⟦subsanacion[^⟧]*⟧\s*$/, "");

// Arma la bandeja: acciones de OCs activas (no archivadas) + acciones sin OC. Cada elemento lleva su OC (si tiene) y el cliente.
export function armarAcciones(ocs, sueltas) {
  const r = [];
  for (const oc of ocs || []) {
    if (oc?.archivada) continue;
    for (const s of oc.oc_seguimientos || []) r.push({ ...s, oc, numeroOC: oc.numero_oc || "", clienteVista: oc.cliente || oc.entidad || "" });
  }
  for (const s of sueltas || []) if (!s.oc_id) r.push({ ...s, oc: null, numeroOC: "", clienteVista: s.cliente || "" });
  return r;
}

// Orden de la bandeja: prioridad (alta → baja), luego vencimiento más próximo (sin fecha al final), luego antigüedad.
export const compararAcciones = (a, b) => (RANGO_PRIORIDAD[b.prioridad] || 0) - (RANGO_PRIORIDAD[a.prioridad] || 0)
  || String(a.fecha_revision || "9999-12-31").slice(0, 10).localeCompare(String(b.fecha_revision || "9999-12-31").slice(0, 10))
  || String(a.creado_en || "").localeCompare(String(b.creado_en || ""));
// Resueltas: la más reciente primero.
export const compararResueltas = (a, b) => String(b.resuelto_en || "").localeCompare(String(a.resuelto_en || ""));

export function contadores(lista, hoy = hoyLocal()) {
  const ab = (lista || []).filter(abierta);
  return { pendientes: ab.length, urgentes: ab.filter(urgente).length, vencidas: ab.filter((a) => vencida(a, hoy)).length,
    enGestion: ab.filter((a) => a.estado === "en_gestion").length, resueltas: (lista || []).filter((a) => a.estado === "resuelto").length };
}

const norm = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
// filtro: { vista: abiertas|urgentes|vencidas|en_gestion|pendiente|resueltas, categoria, responsable: ""|"yo"|"sin"|<uuid>, oc: ""|"con"|"sin", texto }
export function filtrarAcciones(lista, f = {}, { yo = null, hoy = hoyLocal() } = {}) {
  const vista = f.vista || "abiertas"; const q = norm(f.texto);
  const r = (lista || []).filter((a) => {
    if (vista === "resueltas") { if (a.estado !== "resuelto") return false; }
    else if (!abierta(a)) return false;
    if (vista === "urgentes" && !urgente(a)) return false;
    if (vista === "vencidas" && !vencida(a, hoy)) return false;
    if (vista === "en_gestion" && a.estado !== "en_gestion") return false;
    if (vista === "pendiente" && a.estado !== "pendiente") return false;
    if (f.categoria && a.categoria !== f.categoria) return false;
    if (f.responsable === "yo" && a.responsable_id !== yo) return false;
    if (f.responsable === "sin" && a.responsable_id) return false;
    if (f.responsable && !["yo", "sin"].includes(f.responsable) && a.responsable_id !== f.responsable) return false;
    if (f.oc === "con" && !a.oc_id) return false;
    if (f.oc === "sin" && a.oc_id) return false;
    if (q) {
      const campos = [a.numeroOC, a.clienteVista, a.titulo, tituloAccion(a), descripcionAccion(a), a.responsable_nombre];
      if (!campos.some((c) => norm(c).includes(q))) return false;
    }
    return true;
  });
  return r.sort(vista === "resueltas" ? compararResueltas : compararAcciones);
}
export const filtrosActivos = (f = {}) => ["categoria", "responsable", "oc"].filter((k) => !!f[k]).length;

// Sincronización entre usuarios: mezcla las filas cambiadas (y su bitácora nueva) en las OCs y en la lista sin OC.
// filas: oc_seguimientos cambiados desde el último corte; bitacora: historial_cambios nuevos (campo 'seguimiento:<id>').
export function mezclarAcciones({ ocs = [], sueltas = [] }, filas = [], bitacora = []) {
  const nuevasBit = {}; for (const h of bitacora || []) { const k = String(h.campo || "").slice(12); if (k) (nuevasBit[k] ||= []).push(h); }
  const conBit = (s, previa) => {
    const m = new Map(); for (const h of previa?.bitacora || []) m.set(h.id, h); for (const h of nuevasBit[s.id] || []) m.set(h.id, h);
    return { ...s, bitacora: [...m.values()].sort((a, b) => String(b.creadoEn || "").localeCompare(String(a.creadoEn || ""))) };
  };
  const porId = new Map((filas || []).map((f) => [f.id, f]));
  const tocadas = new Set([...porId.keys(), ...Object.keys(nuevasBit)]);
  if (!tocadas.size) return { ocs, sueltas, cambio: false };
  let cambio = false;
  const ocsN = ocs.map((oc) => {
    const propias = (oc.oc_seguimientos || []); const nuevas = (filas || []).filter((f) => f.oc_id === oc.id && !propias.some((s) => s.id === f.id));
    if (!nuevas.length && !propias.some((s) => tocadas.has(s.id))) return oc;
    cambio = true;
    const lista = propias.map((s) => (tocadas.has(s.id) ? conBit(porId.get(s.id) || s, s) : s)).concat(nuevas.map((f) => conBit(f, null)));
    return { ...oc, oc_seguimientos: lista.sort((a, b) => String(b.creado_en || "").localeCompare(String(a.creado_en || ""))) };
  });
  const prevS = new Map((sueltas || []).map((s) => [s.id, s]));
  let sueltasN = sueltas;
  const nuevasS = (filas || []).filter((f) => !f.oc_id);
  if (nuevasS.length || (sueltas || []).some((s) => tocadas.has(s.id))) {
    cambio = true;
    const m = new Map(prevS);
    for (const s of sueltas || []) if (tocadas.has(s.id)) m.set(s.id, conBit(porId.get(s.id) || s, s));
    for (const f of nuevasS) m.set(f.id, conBit(f, prevS.get(f.id) || null));
    sueltasN = [...m.values()].sort((a, b) => String(b.creado_en || "").localeCompare(String(a.creado_en || "")));
  }
  return { ocs: ocsN, sueltas: sueltasN, cambio };
}
// Último cambio conocido (para pedir solo lo nuevo), con 2 minutos de margen: una transacción que empezó antes (su hora es la
// de inicio) pero terminó después de la última lectura igual se recoge. Lo que se repite se mezcla por id (sin duplicar).
export const MARGEN_SINCRONIZACION_MS = 120000;
export function corteAcciones(ocs, sueltas, margenMs = MARGEN_SINCRONIZACION_MS) {
  let c = "";
  const ver = (s) => { for (const v of [s.creado_en, s.actualizado_en]) if (v && String(v) > c) c = String(v); for (const h of s.bitacora || []) if (h.creadoEn && String(h.creadoEn) > c) c = String(h.creadoEn); };
  for (const oc of ocs || []) for (const s of oc.oc_seguimientos || []) ver(s);
  for (const s of sueltas || []) ver(s);
  if (!c) return null;
  const t = Date.parse(c); return Number.isFinite(t) ? new Date(t - margenMs).toISOString() : c;
}

// Alertas (pestaña Alertas) de las acciones SIN OC: prioridad alta o vencidas (las de OC ya las da la OC).
export function alertasAccionesSinOC(sueltas, hoy = hoyLocal()) {
  return (sueltas || []).filter((a) => abierta(a) && (urgente(a) || vencida(a, hoy))).map((a) => ({
    nivel: "alto", icono: "🚩", oc: "Sin OC", cliente: a.cliente || "", seguimientoId: a.id, canal: "acc", monto: 0,
    titulo: `${vencida(a, hoy) ? "Acción vencida" : "Acción prioridad alta"} · ${tituloAccion(a)}`,
    detalle: [a.responsable_nombre ? `Responsable: ${a.responsable_nombre}` : "Sin responsable", a.fecha_revision ? `Vence ${String(a.fecha_revision).slice(8, 10)}/${String(a.fecha_revision).slice(5, 7)}/${String(a.fecha_revision).slice(0, 4)}` : ""].filter(Boolean).join(" · "),
    destino: { tab: "acciones", id: a.id },
  }));
}
