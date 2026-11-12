// Datos FICTICIOS y representativos de Ventas privadas para revisar la interfaz (SOLO base desechable local; nunca producción).
// Se crean con las mismas funciones que usa la app (rol authenticated + sesión del usuario), así que valen RLS, disparadores y reglas.
// Cubre: textos largos, varios registros y todos los estados (cotización: borrador, enviada, por vencer, aceptada, rechazada;
// venta: pendiente, entrega parcial, facturada, pagada, vencida, anulada). Uso: VP_DB_URL=… node semilla_vp.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const DB = process.env.VP_DB_URL; if (!DB) { console.error("Falta VP_DB_URL"); process.exit(2); }
if (!/127\.0\.0\.1|localhost/.test(DB)) { console.error("La semilla solo corre contra una base local desechable"); process.exit(2); }
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222" };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const psql = (sql) => execFileSync("psql", [DB, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
const como = (u, sql) => psql(`set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n${sql}`);
const rpc = (u, fn, ...a) => { try { return JSON.parse(como(u, `select public.${fn}(${a.join(", ")});`).split("\n").pop()); } catch (e) { throw new Error(`${fn}: ${String(e.stderr || e.message).split("\n")[0]}`); } };
const dia = (n) => new Date(Date.now() + n * 864e5 - 3 * 36e5).toISOString().slice(0, 10);   // fecha relativa a hoy (hora de Chile)

const C = {};
for (const [k, c] of Object.entries({
  largo: { rut: "76.086.428-5", razon_social: "Sociedad Agrícola, Forestal y de Servicios Industriales Los Robles del Biobío Limitada", tipo_persona: "empresa", giro: "Explotación forestal, aserrío y servicios de mantención industrial para plantas de celulosa",
    contacto_nombre: "María Fernanda Valenzuela Sepúlveda", contacto_correo: "mariafernanda.valenzuela@agricolaforestallosrobles-prueba.invalid", contacto_telefono: "+56 9 8765 4321",
    direccion: "Camino a Santa Juana km 14,5, Parcela 27, Sector Los Robles", comuna: "Laja", direccion_entrega: "Bodega central, Ruta Q-90 km 3, acceso por portón norte (preguntar por jefe de bodega)", comuna_entrega: "San Rosendo",
    condiciones_pago: "30 días fecha factura, previa recepción conforme", plazo_pago_dias: 30, notas: "Exige orden de compra propia y guía de despacho valorizada. Recepción de mercadería solo de lunes a jueves, de 08:30 a 16:00." },
  metal: { rut: "77.234.567-4", razon_social: "Maestranza Prueba SpA", tipo_persona: "empresa", giro: "Maestranza", contacto_nombre: "Pedro Soto", contacto_correo: "psoto@maestranza-prueba.invalid", comuna: "Los Ángeles", condiciones_pago: "Contado", plazo_pago_dias: 0 },
  persona: { rut: "12.345.678-5", razon_social: "Juan Soto Prueba", tipo_persona: "persona" },
  cole: { rut: "96.345.678-6", razon_social: "Colegio Particular Prueba S.A.", tipo_persona: "empresa", contacto_nombre: "Rosa Pérez", contacto_telefono: "+56 43 211 0000", comuna: "Nacimiento", plazo_pago_dias: 45, condiciones_pago: "45 días" },
  sin: { rut: "78.456.789-3", razon_social: "Transportes Sin Contacto Prueba Ltda.", tipo_persona: "empresa" },
})) C[k] = rpc(k === "persona" ? U.admin : U.ana, "vp_guardar_cliente", j(c));

const ITEMS = [
  { tipo: "producto", codigo: "BOM-01", descripcion: "Bomba centrífuga monoblock 2 HP trifásica 380 V, impulsor de bronce, succión 2\" y descarga 1 1/2\", con sello mecánico y tablero de partida directa", unidad: "UN", cantidad: 2, precio_unitario: 350000, descuento_pct: 5, costo_unitario: 240000 },
  { tipo: "producto", descripcion: "Manguera 1\"", unidad: "M", cantidad: 12.5, precio_unitario: 3990, descuento_pct: 0, costo_unitario: 2100.5 },
  { tipo: "servicio", descripcion: "Instalación y puesta en marcha", unidad: "GL", cantidad: 1, precio_unitario: 180000, descuento_pct: 10 },
];
const cot = (u, cli, extra = {}, items = ITEMS) => rpc(u, "vp_guardar_cotizacion", j({ cliente_id: cli.id, contacto_nombre: cli.contacto_nombre || null, vigencia_dias: 15, plazo_entrega: "10 días hábiles", condiciones_pago: "30 días factura", afecta_iva: true, items, ...extra }));
const estado = (u, c, e, datos = {}) => rpc(u, "vp_cotizacion_estado", `'${c.id}'`, `'${e}'`, j(datos), c.version);

// Cotizaciones en todos los estados
cot(U.ana, C.metal, { observaciones: "Borrador: falta confirmar el despacho" }, [ITEMS[1]]);
let c2 = cot(U.ana, C.largo, { plazo_entrega: "25 días hábiles desde la recepción de la orden de compra, sujeto a disponibilidad del fabricante y a la coordinación de la ventana de detención de planta", direccion_entrega: C.largo.direccion_entrega,
  observaciones: "Incluye flete hasta bodega del cliente. No incluye obras civiles, energía eléctrica provisoria ni permisos de trabajo, que son de cargo del mandante.", condiciones_comerciales: "Precios netos en pesos chilenos. Validez sujeta a variación del tipo de cambio superior al 3%." });
c2 = estado(U.ana, c2, "enviada", { medio: "correo", destinatario: C.largo.contacto_correo });
let c3 = cot(U.ana, C.cole, { vigencia_dias: 2 }, [ITEMS[0]]); c3 = estado(U.ana, c3, "enviada", { medio: "whatsapp" });                 // vence en ≤ 3 días
let c4 = cot(U.ana, C.sin, {}, [ITEMS[2]]); c4 = estado(U.ana, c4, "enviada", { medio: "correo" }); estado(U.ana, c4, "rechazada", { motivo: "El cliente adjudicó a otro proveedor por plazo de entrega" });
let c5 = cot(U.ana, C.largo); c5 = estado(U.ana, c5, "enviada", { medio: "correo" }); c5 = estado(U.ana, c5, "aceptada", { referencia: "Correo de María Fernanda Valenzuela", nota: "Acepta sin cambios" });
let c6 = cot(U.admin, C.metal, {}, [ITEMS[0], ITEMS[2]]); c6 = estado(U.admin, c6, "enviada", { medio: "correo" }); c6 = estado(U.admin, c6, "aceptada", { referencia: "OC 4512" });

// Ventas en distintos estados
const items = (v) => como(U.admin, `select id||'|'||cantidad from public.vp_venta_items where venta_id = '${v.id}' order by orden, id;`).split("\n").map((l) => l.split("|"));
const total = (v) => como(U.admin, `select neto||'|'||iva||'|'||total from public.vp_ventas_vista where id = '${v.id}';`).split("|").map(Number);
// A) Desde cotización: OC del cliente, entrega parcial, sin factura.
const vA = rpc(U.ana, "vp_crear_venta_desde_cotizacion", `'${c5.id}'`, `'${randomUUID()}'`, j({ fecha: dia(-6) }));
rpc(U.ana, "vp_registrar_oc_cliente", j({ venta_id: vA.id, numero: "OC-2026-000451-MANTENCION-PLANTA", fecha: dia(-6), monto: total(vA)[2] }));
const iA = items(vA); rpc(U.ana, "vp_registrar_entrega", j({ venta_id: vA.id, tipo: "despacho", fecha: dia(-2), guia_numero: "G-1021", items: [{ venta_item_id: iA[0][0], cantidad: 1 }] }));
// B) Entregada, facturada y pagada por completo.
const vB = rpc(U.admin, "vp_crear_venta_desde_cotizacion", `'${c6.id}'`, `'${randomUUID()}'`, j({ fecha: dia(-20) }));
const iB = items(vB); rpc(U.admin, "vp_registrar_entrega", j({ venta_id: vB.id, tipo: "despacho", fecha: dia(-15), guia_numero: "G-1009", items: iB.map(([id, q]) => ({ venta_item_id: id, cantidad: Number(q) })) }));
const [nB, ivaB, tB] = total(vB); const fB = rpc(U.admin, "vp_registrar_factura", j({ venta_id: vB.id, tipo_documento: "factura_afecta", numero: "15001", fecha: dia(-14), neto: nB, iva: ivaB }));
rpc(U.admin, "vp_registrar_pago", j({ clave: randomUUID(), venta_id: vB.id, tipo: "abono", fecha: dia(-3), monto: tB, medio: "transferencia", referencia: "TEF 889123", factura_id: fB.id }));
// C) Venta directa facturada y VENCIDA sin pago (plazo 0).
const vC = rpc(U.admin, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: C.persona.id, afecta_iva: true, plazo_pago_dias: 0, fecha: dia(-30), items: [{ descripcion: "Visita técnica y diagnóstico de tablero de control", unidad: "GL", cantidad: 1, precio_unitario: 100000, costo_unitario: 40000 }] }));
const iC = items(vC); rpc(U.admin, "vp_registrar_entrega", j({ venta_id: vC.id, tipo: "servicio", fecha: dia(-29), items: [{ venta_item_id: iC[0][0], cantidad: 1 }] }));
rpc(U.admin, "vp_registrar_factura", j({ venta_id: vC.id, tipo_documento: "factura_afecta", numero: "15002", fecha: dia(-28), neto: 100000, iva: 19000 }));
// D) Venta directa con anticipo, pendiente de entrega.
const vD = rpc(U.ana, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: C.cole.id, afecta_iva: true, plazo_pago_dias: 45, items: [{ descripcion: "Proyector multimedia 4.000 lúmenes", unidad: "UN", cantidad: 3, precio_unitario: 420000, costo_unitario: 310000 }, { descripcion: "Soporte de techo universal", unidad: "UN", cantidad: 3, precio_unitario: 35000, costo_unitario: 18000 }] }));
rpc(U.ana, "vp_registrar_pago", j({ clave: randomUUID(), venta_id: vD.id, tipo: "anticipo", fecha: dia(-1), monto: 500000, medio: "transferencia", referencia: "Anticipo 30%" }));
// E) Venta anulada por el administrador.
const vE = rpc(U.ana, "vp_crear_venta_directa", j({ clave: randomUUID(), cliente_id: C.sin.id, items: [{ descripcion: "Repuesto", cantidad: 1, precio_unitario: 5000 }] }));
rpc(U.admin, "vp_anular_venta", `'${vE.id}'`, "'Ingresada por error: el cliente no confirmó la compra'");
console.log("SEMILLA VP:", como(U.admin, "select (select count(*) from public.vp_clientes_vista)||' clientes · '||(select count(*) from public.vp_cotizaciones)||' cotizaciones · '||(select count(*) from public.vp_ventas)||' ventas';"));
