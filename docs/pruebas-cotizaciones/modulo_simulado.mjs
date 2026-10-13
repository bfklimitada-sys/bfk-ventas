// Base simulada del módulo Cotizaciones (Supabase, /api/compra-agil y Storage) compartida por las pruebas de interfaz.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const AQUI = dirname(fileURLToPath(import.meta.url));
const JPG = readFileSync(join(AQUI, "../../src/assets/bfk-logo.jpg"));

// Respuesta normalizada de /api/compra-agil (forma que entrega la función del servidor). Datos de PRUEBA.
export const CA = { ok: true, fuente: "API oficial de Compra Ágil (ChileCompra)", consultado_en: "2026-10-13T12:00:00.000Z", datos: {
  codigo: "3390-246-COT26", nombre: "ADQUISICIÓN DE CONGELADORAS Y VISICOOLER", descripcion: "Equipos de frío para casino", estado: "Publicada",
  institucion: "Ejército de Chile", unidad_compra: "Brigada Motorizada N.º 4 Rancagua", rut: "61.962.500-5", region: "Región de Arica y Parinacota",
  direccion_entrega: "Av. General Velásquez 1750, Arica", plazo_dias: 15, presupuesto: { tipo: "Estimado", moneda: "CLP", estimado: 6000000, disponible: null },
  fecha_publicacion: "2026-10-10T09:00:00", fecha_cierre: "2026-10-15T15:00:00",
  productos: [{ codigo_producto: "1", nombre: "Congeladora vertical", descripcion: "Capacidad bruta mínima 590 L, útil mínima 440 L", cantidad: 2, unidad: "EA" },
    { codigo_producto: "2", nombre: "Visicooler 2 puertas", descripcion: "Capacidad bruta mínima 1.150 L, útil mínima 800 L", cantidad: 1, unidad: "EA" }],
  documentos: [{ id: "d1", nombre: "Especificaciones.pdf" }], oc_emitida: false } };

// Base simulada del módulo (esquema 2 o 1) con estado en memoria.
export function moduloSimulado(esquema) {
  const M = { esquema, cots: new Map(), eett: [], vend: [], prods: [], rpc: [], storagePost: [], storageGet: 0, api: [], sec: 0 };
  const fila = (c) => { const { items, envios, version, ...r } = c; return { ...r, version }; };
  M.manejar = async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    const json = (j, extra = {}) => route.fulfill({ json: j, headers: { "access-control-expose-headers": "content-range", ...extra } });
    if (u.pathname.startsWith("/api/compra-agil")) {
      M.api.push(u.search);
      if (/9999-1-COT26/.test(decodeURIComponent(u.search))) return route.fulfill({ status: 503, json: { ok: false, codigo: "SIN_TICKET", error: "La consulta oficial de Compra Ágil requiere un ticket de ChileCompra que aún no está configurado en el servidor. Mientras tanto, ingresa los datos manualmente." } });
      return route.fulfill({ json: CA });
    }
    if (!u.hostname.endsWith("supabase.co")) return route.fallback();
    if (u.pathname.startsWith("/storage/v1/object/authenticated/")) { M.storageGet++; return route.fulfill({ body: JPG, contentType: "image/jpeg" }); }
    if (u.pathname.startsWith("/storage/v1/")) { M.storagePost.push(u.pathname); return route.fulfill({ json: { Key: u.pathname } }); }
    const t = u.pathname.split("/").pop(); const q = u.searchParams;
    if (u.pathname.includes("/rpc/cz_")) {
      const b = JSON.parse(req.postData() || "{}"); M.rpc.push({ fn: t, b });
      if (t === "cz_guardar_cotizacion" || t === "cz_guardar_cotizacion_v2") {
        const p = b.p; const prev = p.id ? M.cots.get(p.id) : null;
        if (prev && prev.version !== p.version) return route.fulfill({ status: 409, json: { message: "CZ409: otra persona guardó cambios" } });
        const id = p.id || `c-${++M.sec}`; const v = (prev?.version || 0) + 1;
        M.cots.set(id, { ...(esquema < 2 ? Object.fromEntries(Object.entries(p).filter(([k]) => !["vendedor_id", "vendedor_nombre", "descripcion", "unidad_compra", "region", "presupuesto_estimado", "fecha_publicacion", "fecha_cierre", "requerimientos", "documentos_mp", "mp_consultado_en"].includes(k))) : p), id, version: v, actualizado_en: new Date().toISOString() });
        return json({ id, version: v });
      }
      if (t === "cz_guardar_producto") { M.prods.push(b.p); return json(`p-${M.prods.length}`); }
      if (t === "cz_registrar_eett_v2" || t === "cz_registrar_eett") { const c = M.cots.get(b.p?.cotizacion_id || b.p_cotizacion); M.eett.push({ id: `e-${M.eett.length + 1}`, cotizacion_id: c.id, version: b.p?.version ?? b.p_version, paginas: b.p?.paginas ?? b.p_paginas, nombre_documento: b.p?.nombre_documento, generado_por_nombre: "Admin Prueba", vendedor_nombre: c.vendedor_nombre, fecha: new Date().toISOString(), ubicacion_pdf: b.p_ruta ?? null }); return json(`e-${M.eett.length}`); }
      if (t === "cz_registrar_vendedor") { const v = { id: `u${M.vend.length + 1}`, nombre: b.p_nombre }; M.vend.push(v); return json(v); }
      if (t === "cz_eliminar_cotizacion") { const c = M.cots.get(b.p_id); if (c.estado === "adjudicada") return route.fulfill({ status: 400, json: { message: "CZ423: una cotización adjudicada o vinculada a una OC no se puede eliminar." } }); M.cots.delete(b.p_id); return json({ eliminada: b.p_id }); }
      return json(null);
    }
    if (t === "cotizaciones") {
      const sel = q.get("select") || "";
      if (/vendedor_nombre/.test(sel) && esquema < 2 && !/cotizacion_items/.test(sel)) return route.fulfill({ status: 400, json: { code: "42703", message: "column cotizaciones.vendedor_nombre does not exist" } });
      if (q.get("id")) return json([fila(M.cots.get(q.get("id").replace("eq.", "")) || {})].filter((x) => x.id));
      let todas = [...M.cots.values()].sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
      if (q.get("estado")?.startsWith("eq.")) todas = todas.filter((c) => c.estado === q.get("estado").slice(3));
      if (q.get("estado")?.startsWith("in.")) todas = todas.filter((c) => ["borrador", "lista"].includes(c.estado));
      const off = Number(q.get("offset") || 0), lim = Number(q.get("limit") || 1000);
      return json(todas.slice(off, off + lim).map((c) => ({ ...fila(c), cotizacion_items: [{ count: c.items.length }] })), { "content-range": `${off}-${off + lim - 1}/${todas.length}` });
    }
    const cid = (q.get("cotizacion_id") || "").replace("eq.", "");
    if (t === "cotizacion_items") return json((M.cots.get(cid)?.items || []).map((it, i) => ({ id: it.key, orden: i + 1, producto_id: it.producto_id, especificaciones_aprobadas: it.ficha, ficha_aprobada: it.ficha_aprobada, enlace: it.enlace, enlace_original: it.enlace_original, proveedor: it.proveedor, cantidad: it.cantidad, precio_origen: it.precio_origen, precio_incluye_iva: it.precio_incluye_iva, con_factura: it.con_factura, envio_clave: it.envio_key, recargo: it.recargo, disponibilidad: it.disponibilidad, fecha_consulta: it.fecha_consulta, origen_datos: it.origen_datos })));
    if (t === "cotizacion_envios") return json((M.cots.get(cid)?.envios || []).map((e) => ({ clave: e.key, proveedor: e.proveedor, monto: Number(e.monto) || 0, con_factura: e.con_factura, estado_confirmacion: e.estado, destino: e.destino, evidencia: e.evidencia, fecha_cotizacion: e.fecha_cotizacion })));
    if (t === "eett_documentos") return json(M.eett.filter((e) => e.cotizacion_id === cid).reverse());
    if (t === "productos_catalogo") return json(M.prods.map((p, i) => ({ id: `p-${i + 1}`, nombre: p.nombre, marca: p.marca, modelo: p.modelo, caracteristicas: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes, ultima_revision: "2026-10-13" })), { "content-range": `0-0/${M.prods.length}` });
    if (t === "cotizacion_vendedores") return json(M.vend);
    return route.fallback(); // "vendedores" y el resto: base simulada general (solo lectura)
  };
  return M;
}
