// Pruebas unitarias de la Fase 4A (OCs). Ejecutar: node docs/pruebas-oc/ejecutar.mjs
// Cubren cada error corregido en su parte de lógica pura; la parte de interfaz se prueba en e2e_fase4a.mjs.
import {
  esCodigoMP, normalizarCodigoOC, buscarOCPorCodigo, mensajeDuplicado, esErrorDuplicado, estadoMP, resultadoConsultaMP,
  estaEntregada, estaComprada, etapasCompletadas, valeVistasPendientes, facturaVencida, facturaPorVencer, entregaAtrasada,
  diasAtrasoEntrega, fechaOC, fechaCompra, fechaOCEditable, FILTROS_PANEL, filtrarPanel, esFiltroPanel,
} from "../../src/lib/ocs.js";
import { cambiosProducto, repartirInversion } from "../../src/lib/productosOC.js";
import { delConfirmado } from "../../src/lib/supabase.jsx";
import { calcularAlertas } from "../../src/components/ui/Multiusuario.jsx";
import handler from "../../api/oc.mjs";

let ok = 0, fallas = 0;
const eq = (nombre, real, esperado) => {
  const b = JSON.stringify(real) === JSON.stringify(esperado);
  if (b) ok++; else fallas++;
  console.log((b ? "OK    " : "FALLA ") + nombre + (b ? "" : ` :: esperado ${JSON.stringify(esperado)} obtenido ${JSON.stringify(real)}`));
};
const dias = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };

// ── 1. Código de OC: normalización igual (o más estricta) que el índice único de la base ──
// Índice real (diagnóstico de solo lectura): upper(regexp_replace(regexp_replace(numero_oc,'^[Nn][ºo°]\s*',''),'[^A-Za-z0-9]','','g'))
const claveBD = (c) => String(c).replace(/^[Nn][ºo°]\s*/, "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const variantes = ["3013-587-AG26", "3013 587 ag26", "Nº 3013-587-AG26", "N°3013-587-AG26", "No 3013-587-AG26", "N3013-587-AG26", " 3013-587-ag26 "];
eq("normalización: todas las variantes son la misma OC", new Set(variantes.map(normalizarCodigoOC)).size, 1);
eq("normalización: otra OC es distinta", normalizarCodigoOC("3013-588-AG26") === normalizarCodigoOC("3013-587-AG26"), false);
const muestra = [...variantes, "3013-588-AG26", "VD-001", "vd 001", "N° VD-1", "1107277-31-AG26", "OC-ABC", "No-1", "N1", "1"];
let laxa = 0; for (const a of muestra) for (const b of muestra) if (claveBD(a) === claveBD(b) && normalizarCodigoOC(a) !== normalizarCodigoOC(b)) laxa++;
eq("normalización: nunca es más laxa que el índice único de la base", laxa, 0);
eq("esCodigoMP: formato Mercado Público", [esCodigoMP("3013-587-AG26"), esCodigoMP("Nº 3013-587-AG26"), esCodigoMP("VD-001"), esCodigoMP("")], [true, true, false, false]);
const activas = [{ id: "a1", numero_oc: "3013-587-AG26" }], archivadas = [{ id: "z1", numero_oc: "2000-1-SE26", archivada: true }];
eq("duplicado: encuentra la activa con otro formato", buscarOCPorCodigo("3013 587 ag26", [activas, archivadas])?.id, "a1");
eq("duplicado: encuentra la archivada", buscarOCPorCodigo("N° 2000-1-SE26", [activas, archivadas])?.id, "z1");
eq("duplicado: excluye la propia OC (edición)", buscarOCPorCodigo("3013-587-AG26", [activas, archivadas], "a1"), null);
eq("duplicado: código nuevo no es duplicado", buscarOCPorCodigo("9999-1-AG26", [activas, archivadas]), null);
eq("duplicado: mensaje de archivada indica restaurar", /archivada: restáurela/.test(mensajeDuplicado(archivadas[0])), true);
eq("error de índice único reconocido", [esErrorDuplicado({ message: 'duplicate key value violates unique constraint "idx_numero_oc_unico"' }), esErrorDuplicado({ message: "otro" })], [true, false]);

// ── 2. Respuesta de /api/oc → flujo correcto en la interfaz ──
eq("404 → no disponible (habilita guardar pendiente)", resultadoConsultaMP(404, { ok: false }).tipo, "no_disponible");
eq("502 → error con mensaje, sin flujo pendiente", [resultadoConsultaMP(502, { ok: false, error: "MP caído" }).tipo, resultadoConsultaMP(502, { ok: false, error: "MP caído" }).mensaje], ["error", "MP caído"]);
eq("200 cancelada → estado cancelada", resultadoConsultaMP(200, { ok: true, oc: { codigo_estado: 9 } }).estado.tipo, "cancelada");
eq("200 enviada a proveedor → no aceptada", resultadoConsultaMP(200, { ok: true, oc: { codigo_estado: 4 } }).estado.tipo, "sin_aceptar");
eq("200 recepción conforme → aceptada", [estadoMP(12).tipo, estadoMP(6).tipo, estadoMP("15").tipo], ["aceptada", "aceptada", "aceptada"]);
eq("sin JSON → error (nunca 'ok')", resultadoConsultaMP(500, null).tipo, "error");

// ── 3. Criterio único de "entregada" y etapas ──
eq("entregada: confirmada y entregado (registros anteriores)", [estaEntregada({ estado_entrega: "confirmada" }), estaEntregada({ estado_entrega: "entregado" }), estaEntregada({ estado_entrega: "pendiente" }), estaEntregada({})], [true, true, false, false]);
eq("etapas completadas cuenta 'entregado'", etapasCompletadas({ eventos_compra: [{}], estado_entrega: "entregado" }), 2);

// ── 4. Fecha de la OC distinta de la fecha de compra ──
const ocMP = { numero_oc: "3013-587-AG26", fecha_emision_mp: "2026-09-01", fecha_hora_emision_mp: "2026-09-01T10:15:00", eventos_compra: [{ fecha: "2026-09-10" }] };
eq("fecha de la OC = emisión, no la compra", [fechaOC(ocMP).valor.slice(0, 10), fechaOC(ocMP).origen, fechaCompra(ocMP)], ["2026-09-01", "emision", "2026-09-10"]);
eq("OC antigua sin emisión: se indica que viene de la compra", fechaOC({ eventos_compra: [{ fecha: "2026-01-05" }] }).origen, "compra");
eq("fecha de la OC editable solo si no viene de MP", [fechaOCEditable(ocMP), fechaOCEditable({ numero_oc: "VD-001" }), fechaOCEditable({ numero_oc: "3013-587-AG26", no_en_mp: true })], [false, true, true]);

// ── 5. Contadores del Panel = listas exactas ──
const fact = (n, monto = 1000) => [{ id: "f", fecha: dias(n), numero_factura: "1", monto }];
const D = [
  { id: "1", numero_oc: "1-1-SE26", vendedor_id: "v1", eventos_compra: [{ fecha: dias(20), fecha_entrega_estimada: dias(3) }], estado_entrega: "pendiente" },             // comprada sin entregar, atrasada
  { id: "2", numero_oc: "1-2-SE26", vendedor_id: "v1", eventos_compra: [{ fecha: dias(20) }], estado_entrega: "entregado", estado_factura_propia: "pendiente" },           // entregada (anterior) sin factura
  { id: "3", numero_oc: "1-3-SE26", vendedor_id: "v1", eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", eventos_factura: fact(40), dias_pago: 30 }, // vencida
  { id: "4", numero_oc: "1-4-SE26", vendedor_id: "v1", eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", eventos_factura: fact(27), dias_pago: 30 }, // por vencer
  { id: "5", numero_oc: "1-5-SE26", vendedor_id: null, eventos_compra: [], estado_entrega: "pendiente" },                                                               // MP sin comprar y sin vendedor
  { id: "6", numero_oc: "VD-6", vendedor_id: "v1", eventos_compra: [], estado_entrega: "pendiente" },                                                                    // venta directa sin compra (no es MP)
  { id: "7", numero_oc: "1-7-SE26", vendedor_id: "v1", eventos_compra: [{}], estado_entrega: "confirmada", estado_factura_propia: "emitida", estado_pago_cliente: "parcial", eventos_factura: fact(5), eventos_pago_cliente: [{ medio_pago: "vale_vista", cobrado_en_banco: false, monto: 10 }, { medio_pago: "cheque", cobrado_en_banco: false, monto: 5 }] },
  { id: "8", numero_oc: "1-8-SE26", vendedor_id: "v1", tipo_registro: "externa", eventos_compra: [{}], estado_entrega: "pendiente" },                                    // externa: fuera de todo
  { id: "9", numero_oc: "1-9-SE26", vendedor_id: "v1", eventos_compra: [{ fecha_entrega_estimada: dias(10) }], estado_entrega: "entregado" },                            // estimada pasada pero entregada (anterior)
];
const ids = (k) => filtrarPanel(D, k).map((o) => o.id);
eq("Panel: vencidas", ids("vencidas"), ["3"]);
eq("Panel: por vencer (no abre todas las por cobrar)", ids("por_vencer"), ["4"]);
eq("Panel: entregadas sin facturar (incluye 'entregado')", ids("entregadas_sin_factura"), ["2", "9"]);
eq("Panel: compradas sin entregar (excluye 'entregado' y externas)", ids("compradas_sin_entregar"), ["1"]);
eq("Panel: MP sin comprar (excluye ventas directas)", ids("mp_sin_comprar"), ["5"]);
eq("Panel: sin vendedor", ids("sin_vendedor"), ["5"]);
eq("Panel: vale vista (OC) y documentos", [ids("vale_vista"), valeVistasPendientes(D[6]).length], [["7"], 2]);
eq("claves del Panel reconocidas", [esFiltroPanel("por_vencer"), esFiltroPanel("cobro"), esFiltroPanel(null)], [true, false, false]);
eq("cada filtro del Panel tiene etiqueta", Object.values(FILTROS_PANEL).every((f) => f.etiqueta && typeof f.pred === "function"), true);
eq("factura vencida/por vencer excluyen cobradas", [facturaVencida({ ...D[2], estado_pago_cliente: "pagado" }), facturaPorVencer({ ...D[3], estado_pago_cliente: "pagado" })], [false, false]);
eq("entrega atrasada: misma regla que Alertas y Agenda", [entregaAtrasada(D[0]), entregaAtrasada(D[8]), diasAtrasoEntrega(D[0])], [true, false, 3]);

// ── 6. Alertas con el mismo criterio ──
const AL = calcularAlertas(D);
const al = (id, t) => AL.filter((a) => a.ocId === id && a.titulo.startsWith(t)).length;
eq("Alertas: 'entregado' no genera 'Entrega atrasada'", al("9", "Entrega atrasada"), 0);
eq("Alertas: atrasada real sí", al("1", "Entrega atrasada"), 1);
eq("Alertas: 'entregado' no genera 'Facturada sin registrar la entrega'", AL.filter((a) => a.titulo === "Facturada sin registrar la entrega").length, 0);
eq("Alertas: OC abierta sin vendedor", al("5", "OC sin vendedor"), 1);
eq("Alertas: OC cerrada sin vendedor no alerta", calcularAlertas([{ ...D[4], estado_pago_cliente: "pagado", estado_pago_financiamiento: "pagado" }]).filter((a) => a.titulo === "OC sin vendedor").length, 0);
eq("Alertas: vale vista pendiente por documento", AL.filter((a) => a.ocId === "7" && /sin cobrar en el banco/.test(a.titulo)).length, 2);

// ── 7. Productos: edición parcial y reparto que no borra datos ──
const linea = { id: "l1", descripcion: "Silla", url: "https://x.cl/a", direccion_entrega: "Calle 1", cantidad: 3, precio_compra: 100, precio_venta: 300 };
const p1 = cambiosProducto(linea, { precio_compra: 250 });
eq("reparto/edición parcial: solo cambia precio de compra", [p1.patch, p1.cambios.map((c) => c.campo)], [{ precio_compra: 250 }, ["precio de compra"]]);
const p2 = cambiosProducto(linea, { descripcion: "Silla", cantidad: 3, precio_compra: 100, precio_venta: 300, url: "https://x.cl/a", direccion_entrega: "Calle 1" });
eq("edición sin cambios: no guarda ni registra nada", [p2.patch, p2.cambios.length], [{}, 0]);
const p3 = cambiosProducto({ ...linea, url: "sin-link", direccion_entrega: null }, { url: "sin-link", direccion_entrega: null, cantidad: "3" });
eq("vacío = 'sin-link' = null y '3' = 3: no son cambios", p3.patch, {});
const p4 = cambiosProducto(linea, { url: "https://y.cl/b" });
eq("cambio de link: un solo registro de historial", [Object.keys(p4.patch), p4.cambios.map((c) => c.accion)], [["url"], ["Link de compra cambiado"]]);
const R = repartirInversion(1000, [{ id: "a", precio_venta: 300, cantidad: 2, direccion_entrega: "X" }, { id: "b", precio_venta: 100 }, { id: "c", precio_venta: 100 }]);
eq("reparto: solo id y precio de compra (nada más se toca)", R.every((r) => Object.keys(r).join() === "id,precio_compra"), true);
eq("reparto: suma exacta y a prorrata", [R.reduce((s, r) => s + r.precio_compra, 0), R.map((r) => r.precio_compra)], [1000, [600, 200, 200]]);
eq("reparto: partes iguales sin precio de venta", repartirInversion(100, [{ id: "a" }, { id: "b" }, { id: "c" }]).map((r) => r.precio_compra), [33, 33, 34]);
eq("reparto: total inválido no reparte", repartirInversion(0, [{ id: "a" }]), []);

// ── 8. Borrado confirmado: sin confirmación de la base no se ajusta nada ──
const fetchOriginal = globalThis.fetch;
const conFetch = async (fn, cuerpo) => { globalThis.fetch = fn; try { return await cuerpo(); } finally { globalThis.fetch = fetchOriginal; } };
const resp = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });
eq("borrado aceptado: devuelve la fila", await conFetch(resp(200, [{ id: "e1" }]), () => delConfirmado("eventos_compra", "t", "e1").then((f) => f.length)), 1);
const err = async (fn) => { try { await fn(); return "sin error"; } catch (e) { return e.message; } };
eq("RLS: 200 sin filas → error (no se eliminó)", /no eliminó el registro/.test(await conFetch(resp(200, []), () => err(() => delConfirmado("eventos_compra", "t", "e1")))), true);
eq("403 → error (rechazado)", /rechazó la eliminación/.test(await conFetch(resp(403, { message: "permission denied" }), () => err(() => delConfirmado("eventos_compra", "t", "e1")))), true);
eq("sin red → error", /Sin conexión/.test(await conFetch(async () => { throw new Error("red"); }, () => err(() => delConfirmado("eventos_compra", "t", "e1")))), true);
eq("otra fila eliminada no cuenta como confirmación", /no eliminó/.test(await conFetch(resp(200, [{ id: "otro" }]), () => err(() => delConfirmado("eventos_compra", "t", "e1")))), true);

// ── 9. /api/oc distingue OC inexistente (404) de Mercado Público caído (502) ──
process.env.MP_TICKET = "ticket-de-prueba";
const ocMPCruda = (estado) => ({ Codigo: "3013-587-AG26", Nombre: "Prueba", CodigoEstado: estado, Estado: "x", Comprador: { NombreOrganismo: "Muni", RutUnidad: "69.150.600-2" }, Items: { Listado: [{ Cantidad: 2, PrecioNeto: 1000, EspecificacionComprador: "Silla", Total: 2000 }] }, Total: 2380, Fechas: { FechaEnvio: "2026-09-01T10:00:00" }, FormaPago: "2" });
async function llamar(mp, { auth = true } = {}) {
  let llamadasMP = 0;
  const fake = async (url) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return { ok: true, status: 200, json: async () => ({ id: "u-prueba" }) };
    if (u.includes("/rest/v1/perfiles")) return { ok: true, status: 200, json: async () => [{ id: "u-prueba" }] };
    if (u.includes("mercadopublico")) { llamadasMP++; return mp(llamadasMP, u); }
    throw new Error("url inesperada " + u);
  };
  const res = { statusCode: 0, body: null, headers: {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; }, setHeader(k, v) { this.headers[k] = v; } };
  await conFetch(fake, () => handler({ headers: auth ? { authorization: "Bearer t" } : {}, query: { codigo: "3013-587-AG26" } }, res));
  return { status: res.statusCode, body: res.body, llamadasMP };
}
const json200 = (j) => ({ ok: true, status: 200, json: async () => j });
let r = await llamar(() => json200({ Cantidad: 1, Listado: [ocMPCruda(6)] }));
eq("api: OC encontrada → 200 con datos normalizados", [r.status, r.body.ok, r.body.oc.codigo_estado, r.body.oc.productos.length, r.body.oc.dias_pago], [200, true, 6, 1, 30]);
r = await llamar(() => json200({ Cantidad: 0, Listado: [] }));
eq("api: Mercado Público sin la OC → 404 (antes era 502)", [r.status, r.body.ok, /no encontrada/.test(r.body.error)], [404, false, true]);
eq("api: 404 se confirma con 2 consultas (rápido)", r.llamadasMP, 2);
r = await llamar(() => ({ ok: false, status: 500, json: async () => ({}) }));
eq("api: Mercado Público caído → 502 (no 404)", [r.status, /no respondió/.test(r.body.error)], [502, true]);
r = await llamar((n) => (n === 1 ? json200({ Cantidad: 0, Listado: [] }) : { ok: false, status: 500, json: async () => ({}) }));
eq("api: vacío y luego errores → 404", r.status, 404);
r = await llamar((n) => (n === 1 ? { ok: false, status: 503, json: async () => ({}) } : json200({ Cantidad: 1, Listado: [ocMPCruda(9)] })));
eq("api: cancelada se informa como OC con estado 9", [r.status, r.body.oc.codigo_estado], [200, 9]);
r = await llamar(() => json200({ Listado: [ocMPCruda(6)] }), { auth: false });
eq("api: sin sesión → 401 (sin consultar MP)", [r.status, r.llamadasMP], [401, 0]);

console.log(`\nRESUMEN pruebas Fase 4A (unitarias): ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
