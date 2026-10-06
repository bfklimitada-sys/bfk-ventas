// ═══════════════════════════════════════════════════════════════
// Navegación (Fase 3): una sola definición de las pantallas, sus
// grupos, su dirección (#/ruta) y quién puede verlas.
// Solo navegación: no toca datos ni reglas de negocio.
// ═══════════════════════════════════════════════════════════════

// key: identificador interno de la pantalla (no cambia: lo usan los paneles).
// ruta: lo que se ve en la dirección del navegador (#/compras).
export const PANTALLAS = [
  { key: "panel",          ruta: "panel",          label: "Panel",          icono: "📊", grupo: "operacion", desc: "Resumen del día, caja y compromisos" },
  { key: "compras",        ruta: "compras",        label: "Compras",        icono: "📦", grupo: "operacion", desc: "Órdenes de compra y su avance" },
  { key: "agenda",         ruta: "agenda",         label: "Agenda",         icono: "📅", grupo: "operacion", desc: "Entregas y vencimientos por fecha" },
  { key: "notif",          ruta: "alertas",        label: "Alertas",        icono: "🔔", grupo: "operacion", desc: "Lo que necesita atención" },
  { key: "financiamiento", ruta: "financiamiento", label: "Financiamiento", icono: "🏦", grupo: "finanzas",  desc: "Deuda con financiadores, abonos y aportes" },
  { key: "vendedores",     ruta: "vendedores",     label: "Vendedores",     icono: "🧑‍💼", grupo: "finanzas",  desc: "Comisiones, pagos e IVA mensual" },
  { key: "gastos",         ruta: "gastos",         label: "Gastos",         icono: "🧾", grupo: "finanzas",  desc: "Gastos del negocio e impuestos" },
  { key: "usuarios",       ruta: "administracion", label: "Administración", icono: "👥", grupo: "admin",     desc: "Usuarios, respaldo, entidades y OCs archivadas", adminOnly: true },
];

export const GRUPOS = [
  { key: "operacion", label: "Operación" },
  { key: "finanzas",  label: "Finanzas" },
  { key: "admin",     label: "Sistema" },
];

// Las cuatro de la barra inferior del celular (el resto va en "Más").
export const PRINCIPALES = ["panel", "compras", "agenda", "notif"];

export const PANTALLA_INICIAL = "panel";

export const pantallaDe = (key) => PANTALLAS.find((p) => p.key === key) || null;

export const puedeVer = (key, esAdmin) => {
  const p = pantallaDe(key);
  return !!p && (!p.adminOnly || !!esAdmin);
};

export const visiblesPara = (esAdmin) => PANTALLAS.filter((p) => !p.adminOnly || esAdmin);

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
  return p ? `${p.label} · BFK Ltda` : "BFK Ltda — Ventas Mercado Público";
};
