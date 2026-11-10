// Ventas privadas — acceso a datos (API REST de Supabase con la sesión del usuario).
// Toda regla la aplica la base (RLS, disparadores y funciones vp_*). Lecturas: vistas y tablas vp_*, pi_clientes (por la
// vista vp_clientes_vista), productos_catalogo y gastos_indirectos (solo lectura). Escrituras: solo funciones vp_*.
// Archivos: depósito privado «vp-documentos» (huella SHA-256 al subir y al descargar).
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase";

const H = (t, extra = {}) => ({ "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });
export class ErrorVP extends Error {
  constructor(message, { status, code, detalle, noInstalado, conflicto, sinPermiso, duplicado, incierto } = {}) {
    super(message); Object.assign(this, { status, code, detalle, noInstalado: !!noInstalado, conflicto: !!conflicto, sinPermiso: !!sinPermiso, duplicado: !!duplicado, incierto: !!incierto });
  }
}
const esNoInstalado = (status, j) => status === 404 || ["PGRST205", "PGRST202", "42P01", "42883"].includes(j?.code);
// limite (ms, opcional): si el servidor no responde en ese plazo se trata como respuesta incierta (quien llama comprueba el resultado).
async function pedir(t, metodo, ruta, cuerpo, limite) {
  let r;
  try { r = await fetch(`${SUPABASE_URL}/rest/v1/${ruta}`, { method: metodo, headers: H(t, { Prefer: "return=representation" }), body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    ...(limite && typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(limite) } : {}) }); }
  catch { throw new ErrorVP("Sin conexión con la base de datos. Intenta nuevamente.", { status: 0 }); }
  const txt = await r.text(); let j = null; try { j = txt ? JSON.parse(txt) : null; } catch { j = null; }
  if (!r.ok) {
    const msg = j?.message || `HTTP ${r.status}`;
    throw new ErrorVP(msg, { status: r.status, code: j?.code, detalle: j?.details || null, noInstalado: esNoInstalado(r.status, j),
      conflicto: /VP409/.test(msg), sinPermiso: r.status === 403 || j?.code === "42501", duplicado: j?.code === "23505" });
  }
  return j;
}
const leer = (t, ruta) => pedir(t, "GET", ruta);
const rpc = (t, fn, args, limite) => pedir(t, "POST", `rpc/${fn}`, args, limite);
const LIMITE_GUARDAR = 45000;
const q = encodeURIComponent;

// ── Carga general (listas livianas para las pantallas y para Inicio, Alertas, Agenda y Finanzas) ─────
// Devuelve {instalado:false} si la migración aún no está aplicada (las pantallas lo informan y no guardan nada).
export async function cargarVentasPrivadas(t) {
  try {
    const [config, clientes, cotizaciones, ventas, margenes] = await Promise.all([
      leer(t, "vp_configuracion?select=clave,valor,motivo,actualizado_en"),
      leer(t, "vp_clientes_vista?select=*&order=razon_social"),
      leer(t, "vp_cotizaciones_vista?select=*&order=creado_en.desc&limit=2000"),
      leer(t, "vp_ventas_vista?select=*&order=creado_en.desc&limit=2000"),
      leer(t, "vp_margen_ventas?select=*"),
    ]);
    const cfg = Object.fromEntries((config || []).map((c) => [c.clave, c.valor]));
    return { instalado: true, empresa: cfg.empresa || {}, documentosHabilitados: cfg.documentos_habilitados === true, config: config || [],
      clientes: clientes || [], cotizaciones: cotizaciones || [], ventas: ventas || [], margenes: margenes || [] };
  } catch (e) {
    if (e.noInstalado) return { instalado: false, clientes: [], cotizaciones: [], ventas: [], margenes: [] };
    throw e;
  }
}

// ── Clientes ───────────────────────────────────────────────────────────────────────────────────────
export const guardarCliente = (t, p) => rpc(t, "vp_guardar_cliente", { p });

// ── Cotizaciones ───────────────────────────────────────────────────────────────────────────────────
export async function leerCotizacion(t, id) {
  const [cab] = await leer(t, `vp_cotizaciones_vista?select=*&id=eq.${q(id)}`);
  if (!cab) return null;
  const [revs, eett, docs] = await Promise.all([
    leer(t, `vp_cotizacion_revisiones?select=*&cotizacion_id=eq.${q(id)}&order=numero.desc`),
    leer(t, `vp_eett?select=id,folio,revision,estado,cotizacion_revision_id,hash,emitida_en,emitida_por,version,creado_en,actualizado_en&cotizacion_id=eq.${q(id)}&order=revision.desc`),
    leer(t, `vp_documentos?select=*&cotizacion_id=eq.${q(id)}&order=subido_en.desc`),
  ]);
  const ids = (revs || []).map((r) => r.id);
  const items = ids.length ? await leer(t, `vp_cotizacion_items?select=*&revision_id=in.(${ids.join(",")})&order=orden`) : [];
  const itemIds = (items || []).map((i) => i.id);
  // Costos: RLS los entrega solo a quien puede verlos (administrador y responsable); para los demás llega una lista vacía.
  const costos = itemIds.length ? await leer(t, `vp_cotizacion_item_costos?select=*&item_id=in.(${itemIds.join(",")})`) : [];
  const margenes = ids.length ? await leer(t, `vp_margen_revisiones?select=*&revision_id=in.(${ids.join(",")})`) : [];
  return { cab, revisiones: revs || [], items: items || [], costos: costos || [], margenes: margenes || [], eett: eett || [], documentos: docs || [] };
}
// Guardar con protección ante respuestas inciertas (09/11/2026). Si la conexión se corta después de enviar, no se sabe si la
// base guardó: NUNCA se repite a ciegas. Se comprueba el resultado (versión y contenido de la revisión; para una cotización
// nueva, si apareció una nueva de esta cuenta para el cliente) y, si quedó guardada, se continúa con ella; si no, se informa
// que no se guardó. Si ni siquiera se puede comprobar, el siguiente intento comprueba primero (no se duplica).
// Un rechazo por sesión vencida lo resuelve lib/sesion.js (renueva y reintenta una vez: el servidor no ejecutó nada).
const pendientesGuardar = new Map();
const uidDe = (t) => { try { return JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null; } catch { return null; } };
const mismoTexto = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();
async function comprobarGuardado(t, p, info) {
  if (p.id) {
    const [c] = await leer(t, `vp_cotizaciones?select=id,folio,version,revision_actual&id=eq.${q(p.id)}`);
    if (!c || Number(c.version) === Number(p.version)) return null;              // no se guardó
    const [r] = await leer(t, `vp_cotizacion_revisiones?select=*&cotizacion_id=eq.${q(p.id)}&numero=eq.${c.revision_actual}`);
    const lineas = r ? await leer(t, `vp_cotizacion_items?select=orden,descripcion,cantidad,precio_unitario&revision_id=eq.${q(r.id)}&order=orden`) : [];
    const cab = ["contacto_nombre", "contacto_correo", "contacto_telefono", "plazo_entrega", "direccion_entrega", "condiciones_pago", "observaciones", "condiciones_comerciales"];
    const igual = Number(c.version) === Number(p.version) + 1 && r && cab.every((k) => !(k in p) || mismoTexto(p[k], r[k]))
      && lineas.length === (p.items || []).length && lineas.every((l, i) => mismoTexto(l.descripcion, p.items[i]?.descripcion) && Number(l.cantidad) === Number(p.items[i]?.cantidad) && Number(l.precio_unitario) === Number(p.items[i]?.precio_unitario));
    if (!igual) throw new ErrorVP("VP409: otra persona guardó cambios en esta cotización mientras se perdía la conexión; tus cambios no se guardaron", { status: 409, conflicto: true });
    return { id: c.id, folio: c.folio, revision_id: r.id, revision: r.numero, version: c.version };
  }
  const uid = uidDe(t); if (!uid || !info?.previas) return null;
  const cands = (await leer(t, `vp_cotizaciones?select=id,folio,version,revision_actual&cliente_id=eq.${q(p.cliente_id)}&creado_por=eq.${q(uid)}&order=creado_en.desc&limit=20`)).filter((c) => !info.previas.has(c.id));
  for (const c of cands) {
    const [r] = await leer(t, `vp_cotizacion_revisiones?select=id,numero&cotizacion_id=eq.${q(c.id)}&numero=eq.${c.revision_actual}`);
    const n = r ? (await leer(t, `vp_cotizacion_items?select=id&revision_id=eq.${q(r.id)}`)).length : -1;
    if (n === (p.items || []).length) return { id: c.id, folio: c.folio, revision_id: r.id, revision: r.numero, version: c.version };
  }
  return null;
}
export async function guardarCotizacion(t, p) {
  const clave = p.id ? `cot:${p.id}:${p.version}` : `cot:nueva:${p.cliente_id}`;
  let info = pendientesGuardar.get(clave);
  if (info) {   // un intento anterior quedó sin respuesta: primero se comprueba si ya se guardó
    const hecho = await comprobarGuardado(t, p, info).catch((e) => { if (e.conflicto) throw e; throw new ErrorVP("Sin conexión: todavía no se puede comprobar si el guardado anterior quedó registrado. Intenta nuevamente en un momento (no se duplicará).", { status: 0, incierto: true }); });
    if (hecho) { pendientesGuardar.delete(clave); return { ...hecho, comprobado: true }; }
  }
  // Nunca impide guardar: si esta lectura previa falla, solo se pierde la posibilidad de comprobar una creación incierta.
  if (!p.id && !info) { const uid = uidDe(t); info = { previas: uid ? await leer(t, `vp_cotizaciones?select=id&cliente_id=eq.${q(p.cliente_id)}&creado_por=eq.${q(uid)}`).then((l) => new Set(l.map((c) => c.id))).catch(() => null) : null }; }
  // Versión antigua (otra pestaña o persona guardó después): se detecta ANTES de enviar y no se envía nada. La base lo rechaza
  // igual, pero ese rechazo (SQLSTATE 40001) puede dejar la solicitud sin respuesta en el servidor de la API; así no se llega a eso.
  if (p.id) {
    const [vig] = await leer(t, `vp_cotizaciones?select=version&id=eq.${q(p.id)}`).catch(() => []);
    if (vig && Number(vig.version) !== Number(p.version)) throw new ErrorVP("VP409: otra persona guardó cambios en esta cotización; tus cambios no se guardaron", { status: 409, conflicto: true });
  }
  try { const r = await rpc(t, "vp_guardar_cotizacion", { p }, LIMITE_GUARDAR); pendientesGuardar.delete(clave); return r; }
  catch (e) {
    if (e.status !== 0) { pendientesGuardar.delete(clave); throw e; }
    pendientesGuardar.set(clave, info || {});
    let hecho;
    try { hecho = await comprobarGuardado(t, p, info || {}); }
    catch (e2) { if (e2.conflicto) { pendientesGuardar.delete(clave); throw e2; } throw new ErrorVP("Se perdió la conexión al guardar y aún no se puede comprobar si quedó guardada. Al volver a guardar, la app lo comprobará primero (no se duplicará).", { status: 0, incierto: true }); }
    pendientesGuardar.delete(clave);
    if (hecho) return { ...hecho, comprobado: true };
    throw new ErrorVP("Se perdió la conexión al guardar. Se comprobó que NO quedó guardada: puedes volver a guardar.", { status: 0 });
  }
}
// ¿Está instalada la actualización de la base del 08/11/2026 (ficha técnica y datos de compra por ítem)? Sin ella, guardar desde
// el editor perdería esos datos: la interfaz lo informa y no guarda. null si no se pudo comprobar (sin conexión).
export async function esquemaFichaVP(t) {
  try { await leer(t, "vp_cotizacion_items?select=ficha,ficha_aprobada&limit=1"); await leer(t, "vp_cotizacion_item_costos?select=precio_compra,despacho&limit=1"); return true; }
  catch (e) { if (e.status === 400 || ["42703", "PGRST204", "PGRST100"].includes(e.code)) return false; return null; }
}
export const cambiarEstadoCotizacion = (t, id, estado, datos, version) => rpc(t, "vp_cotizacion_estado", { p_cotizacion: id, p_estado: estado, p_datos: datos || {}, p_version: version });
export const nuevaRevision = (t, id, version) => rpc(t, "vp_cotizacion_nueva_revision", { p_cotizacion: id, p_version: version });
export const duplicarCotizacion = (t, id) => rpc(t, "vp_duplicar_cotizacion", { p_cotizacion: id });
export const documentoPublico = (t, revisionId) => rpc(t, "vp_documento_publico", { p_rev: revisionId });

// ── Ventas ─────────────────────────────────────────────────────────────────────────────────────────
export const crearVentaDesdeCotizacion = (t, cotizacionId, clave, datos) => rpc(t, "vp_crear_venta_desde_cotizacion", { p_cotizacion: cotizacionId, p_clave: clave, p_datos: datos || {} });
export const crearVentaDirecta = (t, p) => rpc(t, "vp_crear_venta_directa", { p });
export const actualizarVenta = (t, id, version, p) => rpc(t, "vp_actualizar_venta", { p_id: id, p_version: version, p });
export async function leerVenta(t, id) {
  const [cab] = await leer(t, `vp_ventas_vista?select=*&id=eq.${q(id)}`);
  if (!cab) return null;
  const [items, oc, entregas, facturas, pagos, docs, margen, historial] = await Promise.all([
    leer(t, `vp_venta_items?select=*&venta_id=eq.${q(id)}&order=orden`),
    leer(t, `vp_oc_cliente?select=*&venta_id=eq.${q(id)}&order=fecha`),
    leer(t, `vp_entregas?select=*&venta_id=eq.${q(id)}&order=numero`),
    leer(t, `vp_facturas?select=*&venta_id=eq.${q(id)}&order=fecha`),
    leer(t, `vp_pagos?select=*&venta_id=eq.${q(id)}&order=fecha`),
    leer(t, `vp_documentos?select=*&venta_id=eq.${q(id)}&order=subido_en.desc`),
    leer(t, `vp_margen_ventas?select=*&venta_id=eq.${q(id)}`),
    leer(t, `vp_historial?select=*&venta_id=eq.${q(id)}&order=fecha.desc,id.desc&limit=300`),
  ]);
  const eIds = (entregas || []).map((e) => e.id), pIds = (pagos || []).map((p) => p.id), iIds = (items || []).map((i) => i.id);
  const [entregaItems, imputaciones, costos, compras, eett] = await Promise.all([
    eIds.length ? leer(t, `vp_entrega_items?select=*&entrega_id=in.(${eIds.join(",")})`) : [],
    pIds.length ? leer(t, `vp_pago_imputaciones?select=*&pago_id=in.(${pIds.join(",")})`) : [],
    iIds.length ? leer(t, `vp_venta_item_costos?select=*&item_id=in.(${iIds.join(",")})`) : [],
    leer(t, `vp_compras?select=*&venta_id=eq.${q(id)}&order=fecha`),
    cab.cotizacion_id ? leer(t, `vp_eett?select=id,folio,revision,estado,cotizacion_revision_id,hash,emitida_en,version&cotizacion_id=eq.${q(cab.cotizacion_id)}&estado=neq.borrador&order=revision.desc`) : [],
  ]);
  return { cab, items: items || [], oc: oc || [], entregas: entregas || [], entregaItems: entregaItems || [], facturas: facturas || [], pagos: pagos || [],
    imputaciones: imputaciones || [], documentos: docs || [], costos: costos || [], compras: compras || [], margen: (margen || [])[0] || null,
    historial: historial || [], eett: eett || [] };
}
export const registrarOcCliente = (t, p) => rpc(t, "vp_registrar_oc_cliente", { p });
export const registrarEntrega = (t, p) => rpc(t, "vp_registrar_entrega", { p });
export const registrarFactura = (t, p) => rpc(t, "vp_registrar_factura", { p });
export const registrarPago = (t, p) => rpc(t, "vp_registrar_pago", { p });
export const imputarPago = (t, pago, factura, monto) => rpc(t, "vp_imputar_pago", { p_pago: pago, p_factura: factura, p_monto: monto });
export const registrarCompra = (t, p) => rpc(t, "vp_registrar_compra", { p });
export const anular = (t, tabla, id, motivo) => rpc(t, "vp_anular", { p_tabla: tabla, p_id: id, p_motivo: motivo });
export const anularVenta = (t, id, motivo) => rpc(t, "vp_anular_venta", { p_id: id, p_motivo: motivo });
// Gastos ya registrados (solo lectura) para vincularlos como costo real sin duplicarlos.
export const buscarGastos = (t, texto) => leer(t, `gastos_indirectos?select=id,fecha,monto,descripcion&order=fecha.desc&limit=30${texto ? `&descripcion=ilike.*${q(texto)}*` : ""}`);

// ── Historial de cotización ────────────────────────────────────────────────────────────────────────
export const historialCotizacion = (t, id) => leer(t, `vp_historial?select=*&cotizacion_id=eq.${q(id)}&order=fecha.desc,id.desc&limit=300`);

// ── Productos (biblioteca compartida + información técnica) ───────────────────────────────────────
export async function buscarProductos(t, texto) {
  const f = texto ? `&or=(nombre.ilike.*${q(texto)}*,marca.ilike.*${q(texto)}*,modelo.ilike.*${q(texto)}*)` : "";
  return leer(t, `productos_catalogo?select=id,nombre,marca,modelo,descripcion_tecnica,imagenes,estado&estado=eq.aprobado&order=nombre&limit=30${f}`);
}
export async function leerProductos(t, ids) {
  const lista = [...new Set((ids || []).filter(Boolean))];
  if (!lista.length) return { productos: [], tecnicos: [], documentos: [], extracciones: [] };
  const inn = `in.(${lista.join(",")})`;
  const [productos, tecnicos, documentos, extracciones] = await Promise.all([
    leer(t, `productos_catalogo?select=id,nombre,marca,modelo,descripcion_tecnica,imagenes,especificaciones,caracteristicas,fuente&id=${inn}`),
    leer(t, `vp_productos_tecnicos?select=*&producto_id=${inn}`),
    leer(t, `vp_documentos?select=*&producto_id=${inn}&estado=eq.vigente&order=subido_en.desc`),
    leer(t, `vp_extracciones?select=*&producto_id=${inn}&estado=eq.pendiente&order=creado_en.desc`),
  ]);
  return { productos: productos || [], tecnicos: tecnicos || [], documentos: documentos || [], extracciones: extracciones || [] };
}
export const guardarProducto = (t, p) => rpc(t, "vp_guardar_producto", { p });
export const registrarExtraccion = (t, p) => rpc(t, "vp_registrar_extraccion", { p });
export const resolverExtraccion = (t, id, aceptadas) => rpc(t, "vp_resolver_extraccion", { p_id: id, p_aceptadas: aceptadas });

// ── EETT ───────────────────────────────────────────────────────────────────────────────────────────
// OC del cliente vigente (no anulada) de una venta, si existe: {numero, fecha} o null. Se copia al contenido de la EETT
// al prepararla; una EETT emitida conserva lo que tenía al emitirse.
export async function ocClienteDeVenta(t, ventaId) {
  if (!ventaId) return null;
  const oc = await leer(t, `vp_oc_cliente?select=numero,fecha&venta_id=eq.${q(ventaId)}&estado=eq.vigente&order=creado_en.desc&limit=1`);
  return oc?.[0] ? { numero: oc[0].numero, fecha: oc[0].fecha } : null;
}
export const leerEETT = async (t, id) => (await leer(t, `vp_eett?select=*&id=eq.${q(id)}`))?.[0] || null;
// Estado ACTUAL de las EETT de una cotización (se lee justo antes de emitir: si un intento anterior quedó sin respuesta, se ve
// si ya quedó emitida y no se emite otra).
export const listarEETT = async (t, cotId) => (await leer(t, `vp_eett?select=id,folio,revision,estado,cotizacion_revision_id,hash,emitida_en,version&cotizacion_id=eq.${q(cotId)}&order=revision.desc`)) || [];
export const guardarEETT = (t, p) => rpc(t, "vp_guardar_eett", { p });
export const emitirEETT = (t, id, version) => rpc(t, "vp_emitir_eett", { p_id: id, p_version: version });
export const descartarEETT = (t, id) => rpc(t, "vp_descartar_eett", { p_id: id });

// ── Configuración (solo administrador) ─────────────────────────────────────────────────────────────
export const configurar = (t, clave, valor, motivo) => rpc(t, "vp_configurar", { p_clave: clave, p_valor: valor, p_motivo: motivo });

// ── Archivos (depósito privado vp-documentos) ─────────────────────────────────────────────────────
export async function sha256Hex(buffer) {
  const h = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const nombreSeguro = (n) => String(n || "archivo").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-120) || "archivo";
const rutaStorage = (ruta) => ruta.split("/").map(encodeURIComponent).join("/");
export const TAMANO_MAXIMO = 25 * 1024 * 1024;
// Sube el archivo y lo registra. ambito: venta | cotizacion | producto. Devuelve {id} del registro.
export async function subirDocumento(t, { ambito, id, categoria, titulo, archivo }) {
  if (!archivo) throw new ErrorVP("Selecciona un archivo.");
  if (archivo.size > TAMANO_MAXIMO) throw new ErrorVP("El archivo supera 25 MB.");
  const buf = await archivo.arrayBuffer();
  const sha256 = await sha256Hex(buf);
  const uid = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(16).padStart(8, "0")}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, "0")}`;
  const ruta = `${ambito}/${id}/${categoria}/${uid}-${nombreSeguro(archivo.name)}`;
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/storage/v1/object/vp-documentos/${rutaStorage(ruta)}`, {
      method: "POST", headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, "x-upsert": "false", "Content-Type": archivo.type || "application/octet-stream" }, body: buf });
  } catch { throw new ErrorVP("Sin conexión: el archivo no se subió."); }
  if (!r.ok) {
    const j = await r.json().catch(() => null); const m = j?.message || j?.error || `HTTP ${r.status}`;
    throw new ErrorVP(/row-level security|Unauthorized|403/i.test(m) || r.status === 403 ? "El depósito no aceptó el archivo: la carga de archivos está deshabilitada o no tienes permiso." : `No se pudo subir el archivo (${m}).`, { status: r.status });
  }
  return rpc(t, "vp_registrar_documento", { p: { ambito, id, categoria, titulo: titulo || archivo.name, nombre_archivo: archivo.name.slice(0, 200), ruta, tipo_mime: (archivo.type || "").slice(0, 120) || null, tamano: archivo.size, sha256 } });
}
export async function descargarDocumento(t, doc) {
  let r;
  try { r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/vp-documentos/${rutaStorage(doc.ruta)}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}` } }); }
  catch { throw new ErrorVP("Sin conexión: no se pudo descargar."); }
  if (!r.ok) throw new ErrorVP(r.status === 404 || r.status === 400 ? "El archivo no está disponible (o no tienes permiso para verlo)." : `No se pudo descargar (HTTP ${r.status}).`, { status: r.status });
  const buf = await r.arrayBuffer();
  if ((await sha256Hex(buf)) !== doc.sha256) throw new ErrorVP("El archivo descargado no coincide con su huella registrada (SHA-256). No se entrega.", { status: 409 });
  return new Blob([buf], { type: doc.tipo_mime || "application/octet-stream" });
}
// Imagen para el PDF (dataURL) desde vp-documentos o desde el depósito de imágenes de la biblioteca (cz-productos).
export async function imagenComoDataURL(t, { bucket, ruta, sha256 }) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${bucket}/${rutaStorage(ruta)}`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}` } });
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    if (sha256 && (await sha256Hex(buf)) !== sha256) return null;
    const tipo = r.headers.get("content-type") || "image/jpeg";
    if (!/^image\/(jpe?g|png)/i.test(tipo)) return null;
    let bin = ""; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${tipo};base64,${btoa(bin)}`;
  } catch { return null; }
}
export function guardarArchivo(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = nombre || "documento"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
