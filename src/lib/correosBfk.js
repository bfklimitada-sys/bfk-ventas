// Correos del buzón de BFK convertidos en notificaciones (tabla correos_bfk, solo lectura para la app).
// La sincronización es externa y de solo lectura (bfk-respaldos · correos.yml). La app solo lee y cambia
// el estado de la notificación (pendiente ⇄ gestionado) con la RPC correo_bfk_marcar; el correo original
// en Gmail nunca se modifica.
// Lógica pura (sin red): las llamadas a la base están en supabase.jsx (cargarCorreosBfk, rpcMarcarCorreo).

export const CATEGORIAS_CORREO = {
  reclamo:         { etiqueta: "Reclamo",          icono: "⚠" },
  entrega:         { etiqueta: "Entrega",          icono: "🚚" },
  facturacion:     { etiqueta: "Facturación",      icono: "🧾" },
  cobranza:        { etiqueta: "Cobranza",         icono: "💰" },
  documentos:      { etiqueta: "Documentos",       icono: "📋" },
  solicitud:       { etiqueta: "Solicitud",        icono: "📧" },
  mercado_publico: { etiqueta: "Mercado Público",  icono: "📦" },
  general:         { etiqueta: "General",          icono: "📧" },
};
export const categoriaCorreo = (c) => CATEGORIAS_CORREO[c] || CATEGORIAS_CORREO.general;

export const NIVEL_PRIORIDAD = { 3: "Urgente", 2: "Requiere acción", 1: "Revisar", 0: "Informativo" };

export const ASOCIACION_TEXTO = {
  numero_oc: "N° de OC en el correo",
  factura: "Folio de factura + cliente",
  rut_unico: "RUT del cliente (única OC abierta)",
  remitente_unico: "Correo del cliente (única OC abierta)",
};

export const esPendiente = (c) => c?.estado === "pendiente";

// Prioridad alta primero; dentro de la misma prioridad, el más reciente primero.
export const ordenarCorreos = (lista) =>
  (lista || []).slice().sort((a, b) => (Number(b.prioridad) || 0) - (Number(a.prioridad) || 0) || String(b.fecha || "").localeCompare(String(a.fecha || "")));

export const pendientesCorreo = (lista) => ordenarCorreos((lista || []).filter(esPendiente));
export const contarCorreosPendientes = (lista) => (lista || []).filter(esPendiente).length;
// Para la campana: solo los pendientes que implican una acción (prioridad ≥ 1); los informativos se listan pero no suman.
export const contarCorreosAccion = (lista) => (lista || []).filter((c) => esPendiente(c) && Number(c.prioridad) >= 1).length;
export const correosDeOC = (lista, ocId) => ordenarCorreos((lista || []).filter((c) => ocId && c.oc_id === ocId));

// filtro: "todos" | "oc" (asociados a una OC) | "general" (sin OC)
export const filtrarCorreos = (lista, filtro) =>
  filtro === "oc" ? lista.filter((c) => c.oc_id) : filtro === "general" ? lista.filter((c) => !c.oc_id) : lista;

// Desde cuándo se cargan los gestionados (para poder reabrirlos): últimos 30 días.
export const desdeCorreos = (ahora = new Date()) => new Date(ahora.getTime() - 30 * 86400000).toISOString();
// Reemplaza un correo en la lista por la versión que devuelve la base.
export const reemplazarCorreo = (lista, fila) => (lista || []).map((c) => (fila && c.id === fila.id ? { ...c, ...fila } : c));
