// ═══════════════════════════════════════════════════════════════
// Navegación (Fase 3): una sola definición de las pantallas, sus
// grupos, su dirección (#/ruta) y quién puede verlas.
// Solo navegación: no toca datos ni reglas de negocio.
// ═══════════════════════════════════════════════════════════════

// key: identificador interno de la pantalla (no cambia: lo usan los paneles).
// ruta: lo que se ve en la dirección del navegador (#/compras).
// hub: la pantalla vive dentro de un centro con pestañas (Finanzas). Sus direcciones anteriores
// (#/financiamiento, #/vendedores, #/gastos) se conservan y abren la pestaña correspondiente.
export const PANTALLAS = [
  { key: "panel",          ruta: "panel",          label: "Inicio",         icono: "📊", grupo: "operacion", desc: "Resumen del día, caja y compromisos" },
  { key: "compras",        ruta: "compras",        label: "Compras",        icono: "📦", grupo: "operacion", desc: "Órdenes de compra y su avance" },
  { key: "notif",          ruta: "alertas",        label: "Alertas",        icono: "🔔", grupo: "operacion", desc: "Alertas de OC y correos de BFK" },
  { key: "agenda",         ruta: "agenda",         label: "Agenda",         icono: "📅", grupo: "operacion", desc: "Entregas y vencimientos por fecha" },
  { key: "finanzas",       ruta: "finanzas",       label: "Resumen",        icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Resultado del mes, caja y margen" },
  { key: "financiamiento", ruta: "financiamiento", label: "Financiamiento", icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Deuda con financiadores, abonos y aportes" },
  { key: "vendedores",     ruta: "vendedores",     label: "Comisiones",     icono: "🧑‍💼", grupo: "finanzas",  hub: "finanzas", desc: "Comisiones y pagos a vendedores" },
  { key: "gastos",         ruta: "gastos",         label: "Gastos",         icono: "🧾", grupo: "finanzas",  hub: "finanzas", desc: "Gastos del negocio" },
  { key: "impuestos",      ruta: "impuestos",      label: "Impuestos",      icono: "🧾", grupo: "finanzas",  hub: "finanzas", desc: "IVA mensual y F29" },
  { key: "banco",          ruta: "banco",          label: "Banco",          icono: "🏦", grupo: "finanzas",  hub: "finanzas", desc: "Saldo, conciliación y cartola" },
  { key: "usuarios",       ruta: "administracion", label: "Administración", icono: "👥", grupo: "admin",     desc: "Usuarios, respaldo, entidades y OCs archivadas", adminOnly: true },
];

// Centros con pestañas: aparecen como una sola entrada en la navegación.
export const HUBS = {
  finanzas: { key: "finanzas", label: "Finanzas", icono: "🏦", grupo: "finanzas", desc: "Resumen, financiamiento, comisiones, gastos, impuestos y banco" },
};

export const GRUPOS = [
  { key: "operacion", label: "Operación" },
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

export const tituloDocumento = (key) => {
  const p = pantallaDe(key);
  if (!p) return "BFK Ltda — Ventas Mercado Público";
  return p.hub ? `${HUBS[p.hub].label} · ${p.label} · BFK Ltda` : `${p.label} · BFK Ltda`;
};
