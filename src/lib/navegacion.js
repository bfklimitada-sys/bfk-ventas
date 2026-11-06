// ═══════════════════════════════════════════════════════════════
// Navegación (Fase 3): una sola definición de las pantallas, sus
// grupos, su dirección (#/ruta) y quién puede verlas.
// Solo navegación: no toca datos ni reglas de negocio.
// ═══════════════════════════════════════════════════════════════

// key: identificador interno de la pantalla (no cambia: lo usan los paneles).
// ruta: lo que se ve en la dirección del navegador (#/compras).
// hub: la pantalla vive dentro de un centro con pestañas (Finanzas). Sus direcciones anteriores
// (#/financiamiento, #/vendedores, #/gastos) se conservan y abren la pestaña correspondiente.
// Orden y grupos del menú (06/11/2026, «Gestión comercial»): General · Mercado Público · Ventas privadas ·
// Proyectos industriales · Finanzas · Sistema. Las claves internas y las direcciones anteriores no cambian.
export const PANTALLAS = [
  { key: "panel",          ruta: "panel",          label: "Inicio",         icono: "📊", grupo: "general",   desc: "Resumen del día, caja y compromisos" },
  { key: "notif",          ruta: "alertas",        label: "Alertas",        icono: "🔔", grupo: "general",   desc: "Alertas de OC, ventas privadas y correos de BFK" },
  { key: "agenda",         ruta: "agenda",         label: "Agenda",         icono: "📅", grupo: "general",   desc: "Entregas y vencimientos por fecha" },
  { key: "compras",        ruta: "compras",        label: "Compras",        icono: "📦", grupo: "mp",        desc: "Órdenes de compra de Mercado Público y su avance" },
  { key: "cotizaciones",   ruta: "cotizaciones",   label: "Cotizaciones MP", icono: "📋", grupo: "mp",       desc: "Cotizaciones de Mercado Público, EETT y biblioteca de productos" },
  { key: "vp_clientes",     ruta: "clientes",              label: "Clientes",              icono: "🏢", grupo: "vp", desc: "Clientes de ventas privadas, historial y saldos" },
  { key: "vp_cotizaciones", ruta: "cotizaciones-privadas", label: "Cotizaciones privadas", icono: "📄", grupo: "vp", desc: "Cotizaciones a clientes privados, revisiones, PDF y EETT" },
  { key: "vp_ordenes",      ruta: "ordenes-venta",         label: "Órdenes de venta",      icono: "🛒", grupo: "vp", desc: "Ventas privadas: OC del cliente, entregas, facturas y pagos" },
  { key: "proyectos",      ruta: "proyectos",      label: "Proyectos industriales", icono: "🏭", grupo: "proyectos", desc: "Proyectos de ingeniería y servicios industriales (línea PI)" },
  { key: "finanzas",       ruta: "finanzas",       label: "Resumen",        icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Resultado del mes, caja y margen" },
  { key: "financiamiento", ruta: "financiamiento", label: "Financiamiento", icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Deuda con financiadores, abonos y aportes" },
  { key: "vendedores",     ruta: "vendedores",     label: "Comisiones",     icono: "🧑‍💼", grupo: "finanzas",  hub: "finanzas", desc: "Comisiones y pagos a vendedores" },
  { key: "gastos",         ruta: "gastos",         label: "Gastos",         icono: "🧾", grupo: "finanzas",  hub: "finanzas", desc: "Gastos del negocio" },
  { key: "impuestos",      ruta: "impuestos",      label: "Impuestos",      icono: "🧾", grupo: "finanzas",  hub: "finanzas", desc: "IVA mensual y F29" },
  { key: "banco",          ruta: "banco",          label: "Banco",          icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Saldo, conciliación y cartola" },
  { key: "usuarios",       ruta: "administracion", label: "Administración", icono: "👥", grupo: "admin",     desc: "Usuarios, respaldo, entidades, OCs archivadas y datos de BFK", adminOnly: true },
];

// Centros con pestañas: aparecen como una sola entrada en la navegación.
export const HUBS = {
  finanzas: { key: "finanzas", label: "Finanzas", icono: "🏦", grupo: "finanzas", desc: "Resumen, financiamiento, comisiones, gastos, impuestos y banco" },
};

export const GRUPOS = [
  { key: "general",   label: "General" },
  { key: "mp",        label: "Mercado Público" },
  { key: "vp",        label: "Ventas privadas" },
  { key: "proyectos", label: "Proyectos industriales" },
  { key: "finanzas",  label: "Finanzas" },
  { key: "admin",     label: "Sistema" },
];

// Las cuatro de la barra inferior del celular (el resto va en "Más").
export const PRINCIPALES = ["panel", "compras", "finanzas", "notif"];

export const PANTALLA_INICIAL = "panel";

export const pantallaDe = (key) => PANTALLAS.find((p) => p.key === key) || null;

export const puedeVer = (key, esAdmin) => {
  const p = pantallaDe(key);
  return !!p && (!p.adminOnly || !!esAdmin);
};

export const visiblesPara = (esAdmin) => PANTALLAS.filter((p) => !p.adminOnly || esAdmin);

// Entrada de navegación a la que pertenece una pantalla (el centro, si vive en uno).
export const entradaDe = (key) => pantallaDe(key)?.hub || key;

// Entradas de la navegación principal: pantallas sueltas + un acceso por centro (en el lugar de su primera pantalla).
export const entradasPara = (esAdmin) => {
  const out = []; const vistos = new Set();
  for (const p of visiblesPara(esAdmin)) {
    if (p.hub) { if (vistos.has(p.hub)) continue; vistos.add(p.hub); const h = HUBS[p.hub]; out.push({ ...h, key: h.key, ruta: p.ruta, esHub: true }); }
    else out.push(p);
  }
  return out;
};

// Pestañas de un centro (en orden).
export const pestanasDe = (hub, esAdmin) => visiblesPara(esAdmin).filter((p) => p.hub === hub);

// "#/compras" → "compras" (clave interna). Acepta también la clave interna ("#/usuarios").
// Devuelve null si la dirección no corresponde a ninguna pantalla.
export const pantallaDesdeHash = (hash) => {
  const r = String(hash || "").replace(/^#\/?/, "").split(/[?/]/)[0].trim().toLowerCase();
  if (!r) return null;
  const p = PANTALLAS.find((x) => x.ruta === r || x.key === r);
  return p ? p.key : null;
};

export const hashDe = (key) => "#/" + (pantallaDe(key)?.ruta || PANTALLA_INICIAL);

// Enlace directo a un proyecto industrial: #/proyectos/PI-AAAA-NNN (la pantalla sigue siendo «proyectos»).
export const detalleDesdeHash = (hash) => {
  const m = /^#\/?proyectos\/(PI-\d{4}-\d{3,})\/?$/i.exec(String(hash || "").trim());
  return m ? m[1].toUpperCase() : null;
};
export const hashProyecto = (codigo) => (codigo ? `#/proyectos/${codigo}` : "#/proyectos");
// Enlace directo a una cotización privada o a una orden de venta: #/cotizaciones-privadas/CP-AAAA-NNNN · #/ordenes-venta/OV-AAAA-NNNN.
const RUTAS_VP = { vp_cotizaciones: ["cotizaciones-privadas", "CP"], vp_ordenes: ["ordenes-venta", "OV"] };
export const folioVPDesdeHash = (hash, key) => {
  const r = RUTAS_VP[key]; if (!r) return null;
  const m = new RegExp(`^#/?${r[0]}/(${r[1]}-\\d{4}-\\d{4,})/?$`, "i").exec(String(hash || "").trim());
  return m ? m[1].toUpperCase() : null;
};
export const hashVP = (key, folio) => `#/${RUTAS_VP[key]?.[0] || pantallaDe(key)?.ruta || ""}${folio ? `/${folio}` : ""}`;
// La dirección actual ya corresponde a la pantalla (incluye los enlaces directos): no se reescribe.
export const hashEsDe = (hash, key) => hash === hashDe(key) || (key === "proyectos" && !!detalleDesdeHash(hash)) || !!folioVPDesdeHash(hash, key);

export const tituloDocumento = (key) => {
  const p = pantallaDe(key);
  if (!p) return "BFK Ltda — Gestión comercial";
  return p.hub ? `${HUBS[p.hub].label} · ${p.label} · BFK Ltda` : `${p.label} · BFK Ltda`;
};
