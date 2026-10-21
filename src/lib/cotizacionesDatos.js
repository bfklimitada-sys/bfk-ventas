// ═══════════════════════════════════════════════════════════════
// Datos del módulo Cotizaciones y EETT.
//  · Modo "base": tablas y funciones del módulo en Supabase. Lectura directa; toda escritura por RPC.
//    Esquema 1 = docs/migraciones/BORRADOR-2026-10-cotizaciones.sql (aplicado en octubre 2026).
//    Esquema 2 = docs/migraciones/BORRADOR-2026-10-cotizaciones-v2.sql (preparado, NO aplicado): vendedor
//    responsable, datos de Compra Ágil, metadatos de EETT, auditoría y eliminación. La app detecta cuál está
//    instalado y, con el esquema 1, avisa qué datos no se pueden guardar todavía (no los pierde en silencio).
//    Imágenes en el depósito privado "cz-productos" (huella SHA-1 = ruta: una imagen idéntica no se vuelve a subir).
//    Los PDF de EETT NO se suben: se descargan en el dispositivo y solo se registran metadatos.
//  · Modo "prueba": solo si Supabase confirma que las tablas no existen; guarda en este dispositivo.
// No toca ninguna tabla existente de BFK (la tabla "vendedores" solo se LEE para reutilizar el catálogo).
// ═══════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";
import { fichaPublica, calcularCotizacion, FORMULA, formulaParaGuardar } from "./cotizaciones.js";

const CLAVE_LOCAL = "bfk_cotizaciones_prueba_v1";
export const DEP_IMG = "cz-productos"; // depósito propio del módulo (imágenes de fichas)
export const DEP_PDF = "cz-eett";      // histórico: PDF subidos antes de octubre 2026 (no se suben nuevos ni se borran)
const cab = (t, extra = {}) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });

async function json(r) { return r.json().catch(() => null); }
function errorDe(r, cuerpo, base) {
  const msg = cuerpo?.message || cuerpo?.error || `${base} (HTTP ${r.status})`;
  const texto = /CZ409/.test(msg) ? "Otra persona guardó cambios en esta cotización. Cierra y vuelve a abrirla para ver la versión actual (tus cambios no se guardaron)."
    : /CZ423/.test(msg) ? msg.replace(/^.*CZ423:\s*/, "") : msg;
  return Object.assign(new Error(texto), { status: r.status, codigo: cuerpo?.code, conflicto: /CZ409/.test(msg) });
}

// ¿Está instalado el módulo en la base? Devuelve { modo, esquema, detalle }:
//  · "base"   → las tablas existen (esquema 1 o 2).
//  · "prueba" → SOLO si Supabase confirma que la tabla no existe (404 + PGRST205/42P01).
//  · "error"  → cualquier otra falla: NO se guarda nada, ni en la base ni en el dispositivo; se ofrece reintentar.
export const TABLA_INEXISTENTE = ["PGRST205", "42P01"];
export async function detectarModo(token, { intentos = 3, pausa = 800 } = {}) {
  let ultimo = "No se pudo conectar con la base de datos.";
  for (let n = 1; n <= intentos; n++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?select=id&limit=1`, { headers: cab(token), signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        // Esquema 2: existe la columna vendedor_nombre (migración v2 aplicada).
        const v2 = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?select=vendedor_nombre&limit=1`, { headers: cab(token), signal: AbortSignal.timeout(10_000) }).catch(() => null);
        return { modo: "base", esquema: v2?.ok ? 2 : 1 };
      }
      const c = await json(r);
      if (r.status === 404 && TABLA_INEXISTENTE.includes(c?.code)) return { modo: "prueba", esquema: 2 };
      if (r.status === 401 || r.status === 403) return { modo: "error", detalle: "La sesión venció o no tiene permiso. Cierra sesión y vuelve a entrar." };
      ultimo = `La base de datos respondió con un error (HTTP ${r.status}${c?.code ? ` · ${c.code}` : ""}).`;
    } catch (e) { ultimo = e?.name === "TimeoutError" ? "La base de datos no respondió a tiempo." : "Sin conexión con la base de datos."; }
    if (n < intentos) await new Promise((ok) => setTimeout(ok, pausa * n));
  }
  return { modo: "error", detalle: `${ultimo} No se guardó nada. Revisa la conexión y reintenta.` };
}

// ── Almacenamiento local (modo prueba) ──
function leerLocal() { try { const x = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "null"); return x && Array.isArray(x.cotizaciones) ? { productos: [], eett: [], vendedores: [], eliminaciones: [], ...x } : { cotizaciones: [], productos: [], eett: [], vendedores: [], eliminaciones: [] }; } catch { return { cotizaciones: [], productos: [], eett: [], vendedores: [], eliminaciones: [] }; } }
function escribirLocal(d) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(d)); }
  catch { throw new Error("El almacenamiento de este dispositivo está lleno (modo prueba). Quita imágenes o elimina cotizaciones de prueba."); }
}
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

// ── Imágenes en depósito privado (modo base) ──
const cacheImg = new Map();   // ruta → dataURL
const rutaDeImg = new Map();  // dataURL → ruta (evita volver a subir imágenes idénticas ya guardadas)
export const esRutaImagen = (x) => typeof x === "string" && x.length > 0 && !x.startsWith("data:");
async function sha1(texto) { const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(texto)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function blobDeDataUrl(d) { const [m, b64] = d.split(","); const tipo = m.match(/data:([^;]+)/)?.[1] || "image/jpeg"; const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: tipo }); }
async function subirImagen(token, dataUrl) {
  if (rutaDeImg.has(dataUrl)) return rutaDeImg.get(dataUrl); // ya está en el depósito
  const ruta = `img/${await sha1(dataUrl)}.${/png/.test(dataUrl.slice(0, 30)) ? "png" : "jpg"}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${DEP_IMG}/${ruta}`, { method: "POST", headers: cab(token, { "Content-Type": blobDeDataUrl(dataUrl).type }), body: blobDeDataUrl(dataUrl) });
  // Ruta = huella del contenido: si ya existe, es la misma imagen (no se sobrescribe nada).
  if (!r.ok && r.status !== 409 && !(r.status === 400 && /exist|duplicate/i.test(await r.clone().text()))) throw errorDe(r, await json(r), "No se pudo subir la imagen");
  cacheImg.set(ruta, dataUrl); rutaDeImg.set(dataUrl, ruta); return ruta;
}
async function bajarImagen(token, ruta) {
  if (!esRutaImagen(ruta)) return ruta;
  if (cacheImg.has(ruta)) return cacheImg.get(ruta);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${DEP_IMG}/${ruta}`, { headers: cab(token) });
  if (!r.ok) return null;
  const b = await r.blob(); const d = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
  cacheImg.set(ruta, d); rutaDeImg.set(d, ruta); return d;
}
const subirImagenes = (token, imgs) => Promise.all((imgs || []).map((d) => (String(d).startsWith("data:") ? subirImagen(token, d) : d)));
// Una imagen ya guardada vuelve a su ruta (así la cotización no cambia por solo haber visto la foto).
export const rutaConocida = (d) => (typeof d === "string" && d.startsWith("data:") && rutaDeImg.get(d)) || d;

// Filtro de texto seguro para PostgREST (sin comas, paréntesis ni comodines del usuario).
const limpiarQ = (q) => String(q || "").replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
const rango = (r) => { const m = String(r.headers.get("content-range") || "").match(/\/(\d+)$/); return m ? Number(m[1]) : null; };

export function crearAlmacen(token, modo, esquema = 1) {
  // token: texto o función que entrega el token VIGENTE (la renovación de sesión no recrea el almacén ni cierra el editor).
  const tk = () => (typeof token === "function" ? token() : token);
  const rpc = async (fn, body) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: cab(tk(), { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    const c = await json(r); if (!r.ok) throw errorDe(r, c, "No se pudo guardar"); return c;
  };
  const leer = async (tabla, q, { contar = false } = {}) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${q}`, { headers: cab(tk(), contar ? { Prefer: "count=exact" } : {}) });
    const c = await json(r); if (!r.ok) throw errorDe(r, c, `No se pudo leer ${tabla}`);
    return contar ? { filas: c || [], total: rango(r) ?? (c || []).length } : (c || []);
  };
  const resolver = async (imgs, max = 4) => (await Promise.all((imgs || []).slice(0, max).map((x) => bajarImagen(tk(), x)))).filter(Boolean);

  if (modo !== "base" && modo !== "prueba") return null; // modo "error": sin almacén (no se guarda nada)
  const comunes = {
    // Convierte las rutas de imágenes de una ficha en imágenes visibles (para el editor, la vista previa y el PDF).
    async resolverImagenes(imgs, max = 4) { return resolver(imgs, max); },
    async miniatura(ruta) { return bajarImagen(tk(), ruta); },
  };

  if (modo === "prueba") return {
    modo: "prueba", esquema: 2, capacidades: { vendedores: true, eliminar: true, datosCompraAgil: true, metadatosEETT: true }, ...comunes,
    async listarCotizaciones({ q = "", estado = "", vendedor = "", pagina = 0, porPagina = 20 } = {}) {
      const t = q.trim().toLowerCase(), v = vendedor.trim().toLowerCase();
      const todas = leerLocal().cotizaciones.map((c) => ({ id: c.id, id_externo: c.id_externo, nombre: c.nombre, institucion: c.institucion, estado: c.estado, fecha: c.fecha, subtotal_neto: c.subtotal_neto, total: c.total, n_items: (c.items || []).length, actualizado_en: c.actualizado_en, vendedor_nombre: c.vendedor_nombre || "", oc_codigo: c.oc_codigo || "" }))
        .filter((c) => (!t || `${c.id_externo} ${c.nombre} ${c.institucion}`.toLowerCase().includes(t)) && (!estado || c.estado === estado) && (!v || String(c.vendedor_nombre).toLowerCase().includes(v)))
        .sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
      return { filas: todas.slice(pagina * porPagina, (pagina + 1) * porPagina), total: todas.length };
    },
    async contarAbiertas() { return leerLocal().cotizaciones.filter((c) => ["borrador", "lista"].includes(c.estado)).length; },
    async cargarCotizacion(id) { const c = leerLocal().cotizaciones.find((x) => x.id === id); if (!c) throw new Error("Cotización no encontrada"); return JSON.parse(JSON.stringify(c)); },
    async guardarCotizacion(cot) {
      const d = leerLocal(); const i = cot.id ? d.cotizaciones.findIndex((x) => x.id === cot.id) : -1;
      if (i >= 0 && d.cotizaciones[i].version !== cot.version) throw Object.assign(new Error("Otra pestaña guardó cambios en esta cotización. Cierra y vuelve a abrirla (tus cambios no se guardaron)."), { conflicto: true });
      const calc = calcularCotizacion(cot);
      const nueva = { ...cot, id: cot.id || uuid(), version: (cot.version || 0) + 1, subtotal_neto: calc.totales.neto, total: calc.totales.total, actualizado_en: new Date().toISOString() };
      if (i >= 0) d.cotizaciones[i] = nueva; else d.cotizaciones.push(nueva);
      escribirLocal(d); return { id: nueva.id, version: nueva.version };
    },
    async listarProductos({ q = "", pagina = 0, porPagina = 30 } = {}) {
      const t = q.trim().toLowerCase();
      const todos = leerLocal().productos.filter((p) => p.estado !== "archivado" && (!t || `${p.nombre} ${p.marca} ${p.modelo}`.toLowerCase().includes(t))).sort((a, b) => String(b.ultima_revision).localeCompare(String(a.ultima_revision)));
      return { filas: todos.slice(pagina * porPagina, (pagina + 1) * porPagina), total: todos.length };
    },
    async contarProductos() { return leerLocal().productos.filter((p) => p.estado !== "archivado").length; },
    async guardarProducto(ficha, { id, fuente, fecha_verificacion } = {}) {
      const d = leerLocal(); const f = fichaPublica(ficha); const ahora = new Date().toISOString();
      const p = { id: id || uuid(), ...f, fuente: fuente || "", fecha_verificacion: fecha_verificacion || null, estado: "aprobado", ultima_revision: ahora };
      const i = d.productos.findIndex((x) => x.id === p.id); if (i >= 0) d.productos[i] = { ...d.productos[i], ...p }; else d.productos.push({ ...p, creado_en: ahora });
      escribirLocal(d); return p.id;
    },
    async registrarEETT(meta) { const d = leerLocal(); d.eett.push({ ...meta, id: uuid(), fecha: new Date().toISOString() }); escribirLocal(d); return true; },
    async listarEETT(cotId) { return leerLocal().eett.filter((e) => e.cotizacion_id === cotId).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))); },
    async listarVendedores() { return leerLocal().vendedores.map((v) => ({ ...v, origen: "cotizaciones" })); },
    async registrarVendedor(nombre) {
      const d = leerLocal(); const n = String(nombre || "").trim().replace(/\s+/g, " ");
      if (!n) throw new Error("Ingresa el nombre del vendedor.");
      if (d.vendedores.some((v) => normalNombre(v.nombre) === normalNombre(n))) throw new Error("Ese vendedor ya está registrado.");
      const v = { id: `cz:${uuid()}`, nombre: n }; d.vendedores.push(v); escribirLocal(d); return v;
    },
    async eliminarCotizacion(id, confirmacion) {
      const d = leerLocal(); const c = d.cotizaciones.find((x) => x.id === id);
      if (!c) throw new Error("Cotización no encontrada");
      revisarEliminable(c, confirmacion);
      d.cotizaciones = d.cotizaciones.filter((x) => x.id !== id); d.eett = d.eett.filter((e) => e.cotizacion_id !== id);
      d.eliminaciones.push({ cotizacion_id: id, id_externo: c.id_externo, nombre: c.nombre, eliminado_en: new Date().toISOString() });
      escribirLocal(d); return true;
    },
  };

  const v2 = esquema >= 2;
  return {
    modo: "base", esquema, capacidades: { vendedores: v2, eliminar: v2, datosCompraAgil: v2, metadatosEETT: v2 }, ...comunes,
    async listarCotizaciones({ q = "", estado = "", vendedor = "", pagina = 0, porPagina = 20 } = {}) {
      const t = limpiarQ(q), v = limpiarQ(vendedor);
      const campos = `id,id_externo,nombre,institucion,estado,fecha,subtotal_neto,total,actualizado_en,oc_codigo${v2 ? ",vendedor_nombre" : ""},cotizacion_items(count)`;
      const filtros = [t && `or=(id_externo.ilike.*${encodeURIComponent(t)}*,nombre.ilike.*${encodeURIComponent(t)}*,institucion.ilike.*${encodeURIComponent(t)}*)`,
        estado && `estado=eq.${encodeURIComponent(estado)}`, v && v2 && `vendedor_nombre=ilike.*${encodeURIComponent(v)}*`].filter(Boolean).join("&");
      const { filas, total } = await leer("cotizaciones", `select=${campos}${filtros ? `&${filtros}` : ""}&order=actualizado_en.desc&limit=${porPagina}&offset=${pagina * porPagina}`, { contar: true });
      return { filas: filas.map((c) => ({ ...c, n_items: c.cotizacion_items?.[0]?.count ?? 0 })), total };
    },
    async contarAbiertas() { return (await leer("cotizaciones", "select=id&estado=in.(borrador,lista)&limit=1", { contar: true })).total; },
    async cargarCotizacion(id) {
      const [c] = await leer("cotizaciones", `select=*&id=eq.${encodeURIComponent(id)}`);
      if (!c) throw new Error("Cotización no encontrada");
      const [envios, items] = await Promise.all([leer("cotizacion_envios", `select=*&cotizacion_id=eq.${id}`), leer("cotizacion_items", `select=*&cotizacion_id=eq.${id}&order=orden.asc`)]);
      // Las imágenes quedan como rutas del depósito: se cargan de forma progresiva al mostrarse.
      const its = items.map((it) => ({ key: it.id, producto_id: it.producto_id, ficha: { ...(it.especificaciones_aprobadas || {}), imagenes: [...(it.especificaciones_aprobadas?.imagenes || [])] }, ficha_aprobada: it.ficha_aprobada,
        enlace: it.enlace || "", enlace_original: it.enlace_original || "", proveedor: it.proveedor || "", cantidad: Number(it.cantidad), precio_origen: Number(it.precio_origen),
        precio_incluye_iva: it.precio_incluye_iva, con_factura: it.con_factura, envio_key: it.envio_clave, recargo: it.recargo == null ? null : Number(it.recargo), disponibilidad: it.disponibilidad || "", fecha_consulta: it.fecha_consulta, origen_datos: it.origen_datos || "" }));
      return { ...c, recargo: Number(c.recargo), items: its, requerimientos: c.requerimientos || [], documentos_mp: c.documentos_mp || [], vendedor_nombre: c.vendedor_nombre || "", vendedor_id: c.vendedor_id || null,
        descripcion: c.descripcion || "", unidad_compra: c.unidad_compra || "", region: c.region || "", presupuesto_estimado: c.presupuesto_estimado == null ? null : Number(c.presupuesto_estimado),
        envios: envios.map((e) => ({ key: e.clave, proveedor: e.proveedor || "", monto: Number(e.monto), con_factura: e.con_factura, estado: e.estado_confirmacion, destino: e.destino || "", evidencia: e.evidencia || "", fecha_cotizacion: e.fecha_cotizacion, origen_publicacion: e.origen_publicacion || "", cobertura: e.cobertura || "" })) };
    },
    async guardarCotizacion(cot) {
      const calc = calcularCotizacion(cot);
      const items = await Promise.all(cot.items.map(async (it, i) => {
        const l = calc.lineas[i]; const ficha = { ...fichaPublica(it.ficha), imagenes: await subirImagenes(tk(), (it.ficha?.imagenes || []).slice(0, 4)) };
        return { ...it, ficha, iva_compra: Math.round(l.iva_credito), envio_asignado: l.envio_asignado, costo_bruto: Math.round(l.costo_bruto), costo_neto: Math.round(l.costo_neto), unitario_venta_neto: l.unitario_neto };
      }));
      // Fase 2 exentas: la clasificación tributaria se gestiona aparte (trib_*): nunca viaja al guardar la cotización.
      // Fase 3: la fórmula guardada registra si los precios se calcularon como exentos (afecta: FORMULA idéntica a la actual).
      const { tratamiento_iva, fundamento_iva, respaldo_iva, tratamiento_aprobado_por, tratamiento_aprobado_en, clasificacion_id, _exenta_fija, ...cotSinTrib } = cot;   // eslint-disable-line no-unused-vars
      return rpc(v2 ? "cz_guardar_cotizacion_v2" : "cz_guardar_cotizacion", { p: { ...cotSinTrib, items, formula: formulaParaGuardar(cot), subtotal_neto: calc.totales.neto, impuestos: calc.totales.iva_debito, total: calc.totales.total,
        costo_neto: Math.round(calc.totales.costo_neto), iva_credito: Math.round(calc.totales.iva_credito) } });
    },
    // Biblioteca: página de fichas SIN imágenes (solo rutas); la miniatura se carga al mostrarse.
    async listarProductos({ q = "", pagina = 0, porPagina = 30 } = {}) {
      const t = limpiarQ(q);
      const f = t ? `&or=(nombre.ilike.*${encodeURIComponent(t)}*,marca.ilike.*${encodeURIComponent(t)}*,modelo.ilike.*${encodeURIComponent(t)}*)` : "";
      const { filas, total } = await leer("productos_catalogo", `select=id,nombre,marca,modelo,color,descripcion_tecnica,caracteristicas,especificaciones,imagenes,fuente,fecha_verificacion,ultima_revision&estado=eq.aprobado${f}&order=ultima_revision.desc&limit=${porPagina}&offset=${pagina * porPagina}`, { contar: true });
      return { total, filas: filas.map((p) => ({ id: p.id, nombre: p.nombre, marca: p.marca || "", modelo: p.modelo || "", color: p.color || "", descripcion: p.descripcion_tecnica || "",
        generales: p.caracteristicas || [], especificaciones: p.especificaciones || [], imagenes: (p.imagenes || []).slice(0, 4), fuente: p.fuente || "", fecha_verificacion: p.fecha_verificacion, ultima_revision: p.ultima_revision })) };
    },
    async contarProductos() { return (await leer("productos_catalogo", "select=id&estado=eq.aprobado&limit=1", { contar: true })).total; },
    async guardarProducto(ficha, { id, fuente, fecha_verificacion } = {}) {
      const f = fichaPublica(ficha); f.imagenes = await subirImagenes(tk(), (ficha?.imagenes || []).slice(0, 4));
      return rpc("cz_guardar_producto", { p: { ...f, id: id || null, fuente: fuente || null, fecha_verificacion: fecha_verificacion || null } });
    },
    // Solo metadatos del PDF generado (el archivo queda en el dispositivo; no se sube al depósito).
    async registrarEETT(meta) {
      if (v2) return rpc("cz_registrar_eett_v2", { p: meta });
      return rpc("cz_registrar_eett", { p_cotizacion: meta.cotizacion_id, p_version: meta.version, p_ruta: null, p_hash: meta.hash, p_paginas: meta.paginas });
    },
    async listarEETT(cotId) {
      return leer("eett_documentos", `select=id,version,fecha,paginas,hash,estado${v2 ? ",nombre_documento,generado_por_nombre,vendedor_nombre" : ""}&cotizacion_id=eq.${encodeURIComponent(cotId)}&order=fecha.desc&limit=20`);
    },
    // Vendedores: catálogo existente de BFK (solo lectura; no se tocan comisiones) + registrados desde Cotizaciones.
    async listarVendedores() {
      const [bfk, cz] = await Promise.all([
        leer("vendedores", "select=id,nombre,activo&order=nombre").catch(() => []),
        v2 ? leer("cotizacion_vendedores", "select=id,nombre&activo=eq.true&order=nombre").catch(() => []) : [],
      ]);
      const vistos = new Set(); const out = [];
      for (const v of [...bfk.filter((x) => x.activo !== false).map((x) => ({ id: String(x.id), nombre: x.nombre, origen: "bfk" })), ...cz.map((x) => ({ id: `cz:${x.id}`, nombre: x.nombre, origen: "cotizaciones" }))]) {
        const k = normalNombre(v.nombre); if (!k || vistos.has(k)) continue; vistos.add(k); out.push(v);
      }
      return out;
    },
    async registrarVendedor(nombre) {
      if (!v2) throw new Error("Registrar vendedores requiere instalar la actualización de la base del módulo (pendiente de autorización).");
      const r = await rpc("cz_registrar_vendedor", { p_nombre: String(nombre || "").trim() });
      return { id: `cz:${r.id}`, nombre: r.nombre, origen: "cotizaciones" };
    },
    async eliminarCotizacion(id, confirmacion) {
      if (!v2) throw new Error("Eliminar cotizaciones requiere instalar la actualización de la base del módulo (pendiente de autorización).");
      return rpc("cz_eliminar_cotizacion", { p_id: id, p_confirmacion: confirmacion });
    },
  };
}

export const normalNombre = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

// Reglas de eliminación (también se validan en el servidor): nunca adjudicadas ni con OC vinculada,
// y la confirmación escrita debe coincidir con el código o el nombre.
export function revisarEliminable(c, confirmacion) {
  if (c.estado === "adjudicada" || String(c.oc_codigo || "").trim()) throw new Error("Una cotización adjudicada o vinculada a una OC no se puede eliminar. Puedes dejarla como está o marcar otra como Descartada.");
  const t = normalNombre(confirmacion);
  if (!normalNombre(c.id_externo) && !normalNombre(c.nombre)) {
    if (t !== String(c.id || "").slice(0, 8).toUpperCase()) throw new Error("La confirmación no coincide con el identificador interno de la cotización.");
  } else if (!t || (t !== normalNombre(c.id_externo) && t !== normalNombre(c.nombre))) throw new Error("La confirmación no coincide con el código ni con el nombre de la cotización.");
}

// ── Consulta de Compra Ágil (función /api/compra-agil; el ticket queda en el servidor) ──
export async function consultarCompraAgil(token, entrada) {
  let r; try { r = await fetch(`/api/compra-agil?q=${encodeURIComponent(entrada)}`, { headers: { Authorization: `Bearer ${token}` } }); }
  catch { throw new Error("Sin conexión con el servidor de BFK. Ingresa los datos manualmente."); }
  const c = await json(r);
  if (!r.ok || !c?.ok) throw Object.assign(new Error(c?.error || (r.status === 404 ? "La consulta de Compra Ágil no está disponible en este entorno. Ingresa los datos manualmente." : `No se pudo consultar (HTTP ${r.status}). Ingresa los datos manualmente.`)), { codigo: c?.codigo || "" });
  return c;
}

// ── Consulta de enlaces (función /api/producto; método alternativo, fuera del flujo principal) ──
export async function consultarEnlace(token, url) {
  let r; try { r = await fetch(`/api/producto?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } }); }
  catch { throw new Error("Sin conexión con el servidor de BFK."); }
  const c = await json(r);
  if (!r.ok || !c?.ok) throw Object.assign(new Error(c?.error || (r.status === 404 ? "La consulta automática no está disponible en este entorno." : `No se pudo consultar el enlace (HTTP ${r.status}).`)), { bloqueo: !!c?.bloqueo });
  return c;
}
export async function traerImagen(token, url) {
  const r = await fetch(`/api/producto?imagen=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } });
  const c = await json(r); if (!r.ok || !c?.ok) throw new Error(c?.error || "No se pudo traer la imagen");
  return normalizarImagen(c.dataUrl);
}

// Reduce y comprime la imagen (máx. 1000 px, JPEG 0,8) para que la ficha y el PDF sean livianos.
export function normalizarImagen(fuente, max = 1000, formato = "image/jpeg") {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      ok(formato === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => mal(new Error("La imagen no se pudo leer"));
    if (fuente instanceof Blob) { const f = new FileReader(); f.onload = () => { img.src = f.result; }; f.onerror = () => mal(new Error("No se pudo leer el archivo")); f.readAsDataURL(fuente); }
    else img.src = fuente;
  });
}

// Logo BFK como data URL (para el PDF).
let logoCache = null;
export async function logoBFK(url) {
  if (logoCache) return logoCache;
  try { let b = await (await fetch(url)).blob(); if (!/^image\//.test(b.type)) b = new Blob([b], { type: "image/jpeg" }); logoCache = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); }); } catch { logoCache = null; }
  return logoCache;
}

// ── Compra desde la cotización adjudicada (15/10/2026): SOLO LECTURA de cotizaciones ──
// Cotizaciones cuyo oc_codigo coincide con el código de la OC. El filtro del servidor es amplio (contiene) y la
// coincidencia EXACTA (sin mayúsculas ni espacios) se verifica después: nunca se vincula por parecido.
// Si el módulo de cotizaciones no está instalado, devuelve [] (se usa el formulario de compra normal).
export async function buscarCotizacionesDeOC(token, numeroOC) {
  const codigo = String(numeroOC || "").trim(); if (!codigo) return [];
  const patron = codigo.replace(/[%*,()]/g, "");
  const r = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?select=id,id_externo,nombre,institucion,estado,oc_codigo,fecha,total,actualizado_en&oc_codigo=ilike.*${encodeURIComponent(patron)}*`, { headers: cab(token) });
  if (!r.ok) { const c = await json(r); if (r.status === 404 && TABLA_INEXISTENTE.includes(c?.code)) return []; throw new Error(`No se pudo consultar las cotizaciones (HTTP ${r.status}).`); }
  return (await r.json()) || [];
}
export async function cargarCotizacionLectura(token, id) {
  return crearAlmacen(token, "base", 2).cargarCotizacion(id);
}
