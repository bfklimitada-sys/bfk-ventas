// ═══════════════════════════════════════════════════════════════
// Datos del módulo Cotizaciones y EETT.
//  · Modo "base": tablas y funciones del módulo en Supabase (docs/migraciones/BORRADOR-2026-10-cotizaciones.sql).
//    Lectura directa; toda escritura por RPC (cz_guardar_cotizacion, cz_guardar_producto, cz_registrar_eett).
//    Imágenes y PDF en depósitos privados del módulo ("cz-productos", "cz-eett"), leídos con la sesión BFK.
//  · Modo "prueba": mientras el SQL NO esté aplicado, la app detecta que las tablas no existen y guarda
//    en este dispositivo (localStorage). No escribe nada en la base real.
// No toca ninguna tabla existente de BFK.
// ═══════════════════════════════════════════════════════════════
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.jsx";
import { fichaPublica, calcularCotizacion, FORMULA } from "./cotizaciones.js";

const CLAVE_LOCAL = "bfk_cotizaciones_prueba_v1";
export const DEP_IMG = "cz-productos"; // depósitos propios del módulo (no se comparten con otros)
export const DEP_PDF = "cz-eett";
const cab = (t, extra = {}) => ({ apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, ...extra });

async function json(r) { return r.json().catch(() => null); }
function errorDe(r, cuerpo, base) {
  const msg = cuerpo?.message || cuerpo?.error || `${base} (HTTP ${r.status})`;
  return Object.assign(new Error(/CZ409/.test(msg) ? "Otra persona guardó cambios en esta cotización. Cierra y vuelve a abrirla para ver la versión actual." : msg), { status: r.status, codigo: cuerpo?.code });
}

// ¿Está instalado el módulo en la base? Devuelve { modo, detalle }:
//  · "base"   → las tablas existen: se trabaja contra Supabase.
//  · "prueba" → SOLO si Supabase confirma que la tabla no existe (404 + PGRST205/42P01): módulo sin instalar.
//  · "error"  → cualquier otra falla (sin conexión, tiempo agotado, 5xx, sesión vencida): NO se guarda nada,
//               ni en la base ni en el dispositivo; se ofrece reintentar. Un error transitorio nunca activa el modo prueba.
export const TABLA_INEXISTENTE = ["PGRST205", "42P01"];
export async function detectarModo(token, { intentos = 3, pausa = 800 } = {}) {
  let ultimo = "No se pudo conectar con la base de datos.";
  for (let n = 1; n <= intentos; n++) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/cotizaciones?select=id&limit=1`, { headers: cab(token), signal: AbortSignal.timeout(10_000) });
      if (r.ok) return { modo: "base" };
      const c = await json(r);
      if (r.status === 404 && TABLA_INEXISTENTE.includes(c?.code)) return { modo: "prueba" };
      if (r.status === 401 || r.status === 403) return { modo: "error", detalle: "La sesión venció o no tiene permiso. Cierra sesión y vuelve a entrar." };
      ultimo = `La base de datos respondió con un error (HTTP ${r.status}${c?.code ? ` · ${c.code}` : ""}).`;
    } catch (e) { ultimo = e?.name === "TimeoutError" ? "La base de datos no respondió a tiempo." : "Sin conexión con la base de datos."; }
    if (n < intentos) await new Promise((ok) => setTimeout(ok, pausa * n));
  }
  return { modo: "error", detalle: `${ultimo} No se guardó nada. Revisa la conexión y reintenta.` };
}

// ── Almacenamiento local (modo prueba) ──
function leerLocal() { try { const x = JSON.parse(localStorage.getItem(CLAVE_LOCAL) || "null"); return x && Array.isArray(x.cotizaciones) ? x : { cotizaciones: [], productos: [] }; } catch { return { cotizaciones: [], productos: [] }; } }
function escribirLocal(d) {
  try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(d)); }
  catch { throw new Error("El almacenamiento de este dispositivo está lleno (modo prueba). Quita imágenes o elimina cotizaciones de prueba."); }
}
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

// ── Imágenes en depósito privado (modo base) ──
const cacheImg = new Map();
async function sha1(texto) { const b = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(texto)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join(""); }
function blobDeDataUrl(d) { const [m, b64] = d.split(","); const tipo = m.match(/data:([^;]+)/)?.[1] || "image/jpeg"; const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: tipo }); }
async function subirImagen(token, dataUrl) {
  const ruta = `img/${await sha1(dataUrl)}.${/png/.test(dataUrl.slice(0, 30)) ? "png" : "jpg"}`;
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${DEP_IMG}/${ruta}`, { method: "POST", headers: cab(token, { "Content-Type": blobDeDataUrl(dataUrl).type }), body: blobDeDataUrl(dataUrl) });
  // Ruta = huella del contenido: si ya existe, es la misma imagen (no se sobrescribe nada).
  if (!r.ok && r.status !== 409 && !(r.status === 400 && /exist|duplicate/i.test(await r.clone().text()))) throw errorDe(r, await json(r), "No se pudo subir la imagen");
  cacheImg.set(ruta, dataUrl); return ruta;
}
async function bajarImagen(token, ruta) {
  if (String(ruta).startsWith("data:")) return ruta;
  if (cacheImg.has(ruta)) return cacheImg.get(ruta);
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/authenticated/${DEP_IMG}/${ruta}`, { headers: cab(token) });
  if (!r.ok) return null;
  const b = await r.blob(); const d = await new Promise((ok) => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
  cacheImg.set(ruta, d); return d;
}
const subirImagenes = (token, imgs) => Promise.all((imgs || []).map((d) => (String(d).startsWith("data:") ? subirImagen(token, d) : d)));
const bajarImagenes = async (token, imgs) => (await Promise.all((imgs || []).map((r) => bajarImagen(token, r)))).filter(Boolean);

export function crearAlmacen(token, modo) {
  const rpc = async (fn, body) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: "POST", headers: cab(token, { "Content-Type": "application/json" }), body: JSON.stringify(body) });
    const c = await json(r); if (!r.ok) throw errorDe(r, c, "No se pudo guardar"); return c;
  };
  const leer = async (tabla, q) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tabla}?${q}`, { headers: cab(token) });
    const c = await json(r); if (!r.ok) throw errorDe(r, c, `No se pudo leer ${tabla}`); return c || [];
  };

  if (modo !== "base" && modo !== "prueba") return null; // modo "error": sin almacén (no se guarda nada)
  if (modo === "prueba") return {
    modo: "prueba",
    async listarCotizaciones() {
      return leerLocal().cotizaciones.map((c) => ({ id: c.id, id_externo: c.id_externo, nombre: c.nombre, institucion: c.institucion, estado: c.estado, fecha: c.fecha, subtotal_neto: c.subtotal_neto, total: c.total, n_items: (c.items || []).length, actualizado_en: c.actualizado_en }))
        .sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
    },
    async cargarCotizacion(id) { const c = leerLocal().cotizaciones.find((x) => x.id === id); if (!c) throw new Error("Cotización no encontrada"); return JSON.parse(JSON.stringify(c)); },
    async guardarCotizacion(cot) {
      const d = leerLocal(); const i = cot.id ? d.cotizaciones.findIndex((x) => x.id === cot.id) : -1;
      if (i >= 0 && d.cotizaciones[i].version !== cot.version) throw new Error("Otra pestaña guardó cambios en esta cotización. Cierra y vuelve a abrirla.");
      const calc = calcularCotizacion(cot);
      const nueva = { ...cot, id: cot.id || uuid(), version: (cot.version || 0) + 1, subtotal_neto: calc.totales.neto, total: calc.totales.total, actualizado_en: new Date().toISOString() };
      if (i >= 0) d.cotizaciones[i] = nueva; else d.cotizaciones.push(nueva);
      escribirLocal(d); return { id: nueva.id, version: nueva.version };
    },
    async listarProductos() { return leerLocal().productos.filter((p) => p.estado !== "archivado").sort((a, b) => String(b.ultima_revision).localeCompare(String(a.ultima_revision))); },
    async guardarProducto(ficha, { id, fuente, fecha_verificacion } = {}) {
      const d = leerLocal(); const f = fichaPublica(ficha); const ahora = new Date().toISOString();
      const p = { id: id || uuid(), ...f, fuente: fuente || "", fecha_verificacion: fecha_verificacion || null, estado: "aprobado", ultima_revision: ahora };
      const i = d.productos.findIndex((x) => x.id === p.id); if (i >= 0) d.productos[i] = { ...d.productos[i], ...p }; else d.productos.push({ ...p, creado_en: ahora });
      escribirLocal(d); return p.id;
    },
    async registrarEETT() { return null; },
  };

  return {
    modo: "base",
    async listarCotizaciones() {
      const filas = await leer("cotizaciones", "select=id,id_externo,nombre,institucion,estado,fecha,subtotal_neto,total,actualizado_en,cotizacion_items(count)&order=actualizado_en.desc&limit=300");
      return filas.map((c) => ({ ...c, n_items: c.cotizacion_items?.[0]?.count ?? 0 }));
    },
    async cargarCotizacion(id) {
      const [c] = await leer("cotizaciones", `select=*&id=eq.${encodeURIComponent(id)}`);
      if (!c) throw new Error("Cotización no encontrada");
      const [envios, items] = await Promise.all([leer("cotizacion_envios", `select=*&cotizacion_id=eq.${id}`), leer("cotizacion_items", `select=*&cotizacion_id=eq.${id}&order=orden.asc`)]);
      const its = await Promise.all(items.map(async (it) => {
        const ficha = { ...(it.especificaciones_aprobadas || {}) }; ficha.imagenes = await bajarImagenes(token, ficha.imagenes);
        return { key: it.id, producto_id: it.producto_id, ficha, ficha_aprobada: it.ficha_aprobada, enlace: it.enlace || "", proveedor: it.proveedor || "", cantidad: Number(it.cantidad), precio_origen: Number(it.precio_origen),
          precio_incluye_iva: it.precio_incluye_iva, con_factura: it.con_factura, envio_key: it.envio_clave, recargo: it.recargo == null ? null : Number(it.recargo), disponibilidad: it.disponibilidad || "", fecha_consulta: it.fecha_consulta, origen_datos: it.origen_datos || "" };
      }));
      return { ...c, recargo: Number(c.recargo), items: its,
        envios: envios.map((e) => ({ key: e.clave, proveedor: e.proveedor || "", monto: Number(e.monto), con_factura: e.con_factura, estado: e.estado_confirmacion, destino: e.destino || "", evidencia: e.evidencia || "", fecha_cotizacion: e.fecha_cotizacion, origen_publicacion: e.origen_publicacion || "", cobertura: e.cobertura || "" })) };
    },
    async guardarCotizacion(cot) {
      const calc = calcularCotizacion(cot);
      const items = await Promise.all(cot.items.map(async (it, i) => {
        const l = calc.lineas[i]; const ficha = fichaPublica(it.ficha); ficha.imagenes = await subirImagenes(token, ficha.imagenes);
        return { ...it, ficha, iva_compra: Math.round(l.iva_credito), envio_asignado: l.envio_asignado, costo_bruto: Math.round(l.costo_bruto), costo_neto: Math.round(l.costo_neto), unitario_venta_neto: l.unitario_neto };
      }));
      return rpc("cz_guardar_cotizacion", { p: { ...cot, items, formula: FORMULA, subtotal_neto: calc.totales.neto, impuestos: calc.totales.iva_debito, total: calc.totales.total,
        costo_neto: Math.round(calc.totales.costo_neto), iva_credito: Math.round(calc.totales.iva_credito) } });
    },
    async listarProductos() {
      const filas = await leer("productos_catalogo", "select=*&estado=eq.aprobado&order=ultima_revision.desc&limit=500");
      return Promise.all(filas.map(async (p) => ({ id: p.id, nombre: p.nombre, marca: p.marca || "", modelo: p.modelo || "", color: p.color || "", descripcion: p.descripcion_tecnica || "",
        generales: p.caracteristicas || [], especificaciones: p.especificaciones || [], imagenes: await bajarImagenes(token, (p.imagenes || []).slice(0, 4)), fuente: p.fuente || "", fecha_verificacion: p.fecha_verificacion, ultima_revision: p.ultima_revision })));
    },
    async guardarProducto(ficha, { id, fuente, fecha_verificacion } = {}) {
      const f = fichaPublica(ficha); f.imagenes = await subirImagenes(token, f.imagenes);
      return rpc("cz_guardar_producto", { p: { ...f, id: id || null, fuente: fuente || null, fecha_verificacion: fecha_verificacion || null } });
    },
    async registrarEETT(cot, blob, hash, paginas) {
      const ruta = `${cot.id}/v${cot.version}-${Date.now()}.pdf`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${DEP_PDF}/${ruta}`, { method: "POST", headers: cab(token, { "Content-Type": "application/pdf" }), body: blob });
      if (!r.ok) throw errorDe(r, await json(r), "No se pudo guardar el PDF");
      return rpc("cz_registrar_eett", { p_cotizacion: cot.id, p_version: cot.version, p_ruta: `${DEP_PDF}/${ruta}`, p_hash: hash, p_paginas: paginas });
    },
  };
}

// ── Consulta de enlaces (función /api/producto) ──
export async function consultarEnlace(token, url) {
  let r; try { r = await fetch(`/api/producto?url=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } }); }
  catch { throw new Error("Sin conexión con el servidor de BFK."); }
  const c = await json(r);
  if (!r.ok || !c?.ok) throw new Error(c?.error || (r.status === 404 ? "La consulta automática no está disponible en este entorno." : `No se pudo consultar el enlace (HTTP ${r.status}).`));
  return c;
}
export async function traerImagen(token, url) {
  const r = await fetch(`/api/producto?imagen=${encodeURIComponent(url)}`, { headers: { Authorization: `Bearer ${token}` } });
  const c = await json(r); if (!r.ok || !c?.ok) throw new Error(c?.error || "No se pudo traer la imagen");
  return normalizarImagen(c.dataUrl);
}

// Reduce la imagen (máx. 1000 px, JPEG) para que la ficha y el PDF sean livianos.
export function normalizarImagen(fuente, max = 1000) {
  return new Promise((ok, mal) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL("image/jpeg", 0.85));
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
