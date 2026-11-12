// Datos FICTICIOS de Mercado Público para la demostración. Parte del conjunto de las pruebas (docs/pruebas-oc/datos_oc.mjs), que
// ya cubre todos los estados de una OC, y le pone nombres, productos y movimientos representativos. Ningún dato es real.
import { crearDatos, RESPUESTAS_MP, dias } from "../pruebas-oc/datos_oc.mjs";

export const ADMIN = "11111111-1111-1111-1111-111111111111";
const INSTITUCIONES = [
  ["I. MUNICIPALIDAD DE VALLE CLARO", "DIRECCIÓN DE ADMINISTRACIÓN Y FINANZAS", "VALLE CLARO"],
  ["HOSPITAL REGIONAL SAN ESTEBAN", "SUBDIRECCIÓN DE ABASTECIMIENTO", "SAN ESTEBAN"],
  ["SERVICIO DE SALUD RÍO HONDO", "DEPARTAMENTO DE RECURSOS FÍSICOS", "RÍO HONDO"],
  ["UNIVERSIDAD ESTATAL DEL SUR AUSTRAL", "FACULTAD DE INGENIERÍA", "PUERTO SERENO"],
  ["I. MUNICIPALIDAD DE LOMAS VERDES", "DEPARTAMENTO DE EDUCACIÓN MUNICIPAL (DAEM)", "LOMAS VERDES"],
  ["CORPORACIÓN EDUCACIONAL LOS ALERCES", "ADQUISICIONES", "LOS ALERCES"],
  ["GOBIERNO REGIONAL DE LA COSTA", "DIVISIÓN DE INFRAESTRUCTURA Y TRANSPORTE", "PUNTA LARGA"],
  ["CESFAM LAS VERTIENTES", "UNIDAD DE COMPRAS", "LAS VERTIENTES"],
  ["LICEO BICENTENARIO TÉCNICO PROFESIONAL DE CERRO ALTO", "INSPECTORÍA GENERAL", "CERRO ALTO"],
  ["JUNTA DE VECINOS N° 14 EL MIRADOR", "DIRECTIVA", "VALLE CLARO"],
  ["DIRECCIÓN REGIONAL DE VIALIDAD (FICTICIA)", "OFICINA PROVINCIAL", "PASO ANCHO"],
];
const PRODUCTOS = ["Notebook 14\" Core i5 16 GB", "Proyector láser 4000 lúmenes", "Silla ergonómica con apoyabrazos", "Impresora multifuncional láser color", "Monitor 27\" QHD", "Kit de herramientas eléctricas", "Generador eléctrico 5 kVA", "Estante metálico 5 niveles", "Router Wi-Fi 6 empresarial", "Escritorio en L 160 cm", "UPS 1500 VA en línea"];

export function crearDatosDemo() {
  const d = crearDatos();
  d.ordenes_compra_v2.forEach((o, i) => { const [cliente, entidad, comuna] = INSTITUCIONES[i % INSTITUCIONES.length]; Object.assign(o, { cliente, entidad, comuna, creado_por: ADMIN, ...(o.archivada_por ? { archivada_por: ADMIN } : {}) }); });
  d.eventos_compra.forEach((e, i) => { e.proveedor = ["Comercial Andes Ltda.", "Tecno Sur SpA", "Distribuidora El Roble", "Importadora Pacífico", "Ferretería Industrial Maule"][i % 5]; });
  d.vendedores = [{ id: "v1", nombre: "Daniela Fuentes", comision_pct: 10 }, { id: "v2", nombre: "Rodrigo Pino", comision_pct: 10 }];
  d.financiadores = [{ id: "f1", nombre: "Inversiones Los Coihues", saldo_deuda: 2500000 }, { id: "f2", nombre: "Cuenta BFK", saldo_deuda: 0 }];
  d.perfiles = [{ id: ADMIN, nombre: "Administrador Demo", rol: "admin", email: "demo@bfk.invalid" }, { id: "u2", nombre: "Daniela Fuentes", rol: "usuario", email: "daniela@bfk.invalid", vendedor_id: "v1" }];
  // Productos: cada OC con al menos una línea legible (las de las pruebas quedan, con nombres representativos).
  d.oc_productos_link.forEach((l, i) => { l.descripcion = l.descripcion.replace(/Silla ergonómica|Silla modelo A|Silla modelo B|Compra en ferretería|Producto por completar/, (m) => ({ "Silla modelo A": "Silla ergonómica malla negra", "Silla modelo B": "Silla ergonómica con cabecero", "Compra en ferretería": "Kit de herramientas eléctricas", "Producto por completar": "Generador eléctrico 5 kVA" }[m] || m)); });
  const conLinea = new Set(d.oc_productos_link.map((l) => l.oc_id));
  d.ordenes_compra_v2.forEach((o, i) => { if (!conLinea.has(o.id)) d.oc_productos_link.push({ id: "dv" + i, oc_id: o.id, descripcion: PRODUCTOS[i % PRODUCTOS.length], cantidad: 1 + (i % 4), precio_venta: Math.round(o.monto_total / 1.19), origen: "venta", orden: 0, url: "sin-link" }); });
  d.oc_comentarios = [{ id: "cm1", oc_id: "oc1", usuario_id: ADMIN, usuario_nombre: "Administrador Demo", texto: "El proveedor confirma despacho para la próxima semana; avisar a bodega.", creadoEn: new Date().toISOString() },
    { id: "cm2", oc_id: "oc2", usuario_id: ADMIN, usuario_nombre: "Administrador Demo", texto: "Factura enviada por correo a la unidad de finanzas. Queda pendiente la recepción conforme.", creadoEn: new Date(Date.now() - 5 * 864e5).toISOString() }];
  d.eventos_postventa.forEach((e) => { e.descripcion = "El equipo llegó con el embalaje dañado; el cliente pide cambio de una unidad."; });
  // Gastos del negocio (dos meses) para que Finanzas, Gastos y Banco tengan contenido.
  const hoy = new Date(); const mesDe = (n) => { const f = new Date(hoy.getFullYear(), hoy.getMonth() - n, 10); return { mes: f.getMonth() + 1, anio: f.getFullYear(), fecha: `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-10` }; };
  d.categorias_gasto = [{ id: "cat_impuesto", nombre: "Impuesto SII" },
    { id: "cat_arriendo", nombre: "Arriendo y oficina", subcategorias: [{ nombre: "Arriendo bodega", monto_sugerido: 420000 }, { nombre: "Internet y telefonía", monto_sugerido: 45000 }] },
    { id: "cat_transporte", nombre: "Transporte y despachos", subcategorias: [{ nombre: "Flete a regiones" }, { nombre: "Combustible" }] },
    { id: "cat_servicios", nombre: "Servicios profesionales", subcategorias: [{ nombre: "Contabilidad", monto_sugerido: 120000 }] }];
  const gasto = (id, cat, sub, monto, n, detalle) => ({ id, categoria_id: cat, subcategoria: sub, monto, ...mesDe(n), detalle, creado_por: ADMIN });
  d.gastos_indirectos = [gasto("g1", "cat_arriendo", "Arriendo bodega", 420000, 0, "Bodega calle Los Aromos"), gasto("g2", "cat_arriendo", "Internet y telefonía", 45000, 0, "Plan empresa"),
    gasto("g3", "cat_transporte", "Flete a regiones", 86000, 0, "Despacho a Puerto Sereno"), gasto("g4", "cat_servicios", "Contabilidad", 120000, 0, "Honorarios del mes"),
    gasto("g5", "cat_arriendo", "Arriendo bodega", 420000, 1, "Bodega calle Los Aromos"), gasto("g6", "cat_transporte", "Combustible", 54000, 1, "Camioneta de reparto"), gasto("g7", "cat_servicios", "Contabilidad", 120000, 1, "Honorarios del mes")];
  d.notificaciones = [];
  return d;
}

// Respuestas de la consulta a Mercado Público (/api/oc): las mismas OCs de ejemplo de las pruebas. Para probar «+ Nuevo › OC de
// Mercado Público» sirven 4005-5-SE26 (aceptada) y 3001-1-SE26; 4001-1-SE26 no existe y 4002-2-SE26 simula una caída del servicio.
export const RESPUESTAS_MP_DEMO = Object.fromEntries(Object.entries(RESPUESTAS_MP).map(([k, v]) => [k, v.body?.oc ? { ...v, body: { ...v.body, oc: { ...v.body.oc, cliente: "HOSPITAL REGIONAL SAN ESTEBAN", entidad: "SUBDIRECCIÓN DE ABASTECIMIENTO", comuna: "SAN ESTEBAN", region: "REGIÓN DEL SUR", direccion: "Av. Los Aromos 1250", contacto: "Paula Rivas · 600 000 000", correo_cliente: "abastecimiento@hospital.invalid" } } } : v]));
export { dias };
