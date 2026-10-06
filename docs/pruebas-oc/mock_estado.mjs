// Supabase y /api/oc simulados CON ESTADO (en memoria) para pruebas de interfaz de OCs (Fase 4A).
// Las escrituras se aplican a la base simulada y se registran; nada sale a la red.
import { chromium } from "playwright-core";
export const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
export { chromium };

const HIJAS = ["eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios"];
const clon = (x) => JSON.parse(JSON.stringify(x));

// db: { tabla: [filas] }. mp: { codigo: {status, body} | (n)=>({status,body}) }, listar: {modo: [...]}
// borrado: { tabla: "rls" | "error" } para simular que la base NO elimina.
export function crearBase(inicial, { mp = {}, borrado = {} } = {}) {
  const db = clon(inicial); const escr = []; const llamadasMP = [];
  for (const t of HIJAS) db[t] = db[t] || [];
  const filtrar = (filas, params) => {
    let r = filas;
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (v.startsWith("eq.")) { const x = decodeURIComponent(v.slice(3)); r = r.filter((f) => String(f[k]) === x); }
      else if (v === "is.null") r = r.filter((f) => f[k] === null || f[k] === undefined);
    }
    return r;
  };
  const leer = (tabla, params) => {
    const filas = filtrar(db[tabla] || [], params);
    if (tabla !== "ordenes_compra_v2" || !String(params.get("select") || "").includes("eventos_compra")) return clon(filas);
    return clon(filas).map((o) => {
      for (const t of HIJAS) o[t] = clon((db[t] || []).filter((e) => e.oc_id === o.id));
      o.vendedores = o.vendedor_id ? { nombre: (db.vendedores || []).find((v) => v.id === o.vendedor_id)?.nombre } : null;
      o.financiadores = o.financiador_id ? { nombre: (db.financiadores || []).find((f) => f.id === o.financiador_id)?.nombre } : null;
      return o;
    });
  };
  const escribir = (metodo, tabla, params, cuerpo) => {
    const id = (params.get("id") || "").startsWith("eq.") ? decodeURIComponent(params.get("id").slice(3)) : null;
    escr.push({ metodo, tabla, id, cuerpo: clon(cuerpo ?? null), n: escr.length });
    db[tabla] = db[tabla] || [];
    if (metodo === "POST") {
      const filas = (Array.isArray(cuerpo) ? cuerpo : [cuerpo]).map((f) => ({ creadoEn: new Date().toISOString(), ...f }));
      db[tabla].push(...clon(filas)); return { status: 201, json: filas };
    }
    if (metodo === "PATCH") {
      const afectadas = db[tabla].filter((f) => String(f.id) === String(id));
      for (const f of afectadas) Object.assign(f, clon(cuerpo));
      return { status: 200, json: clon(afectadas) };
    }
    if (metodo === "DELETE") {
      if (borrado[tabla] === "error") return { status: 403, json: { message: "permission denied (simulado)" } };
      if (borrado[tabla] === "rls") return { status: 200, json: [] };
      const fuera = db[tabla].filter((f) => String(f.id) === String(id));
      db[tabla] = db[tabla].filter((f) => String(f.id) !== String(id));
      return { status: 200, json: clon(fuera) };
    }
    return { status: 405, json: {} };
  };
  const rpc = (fn, b, yo) => {
    escr.push({ metodo: "RPC", tabla: fn, id: null, cuerpo: clon(b), n: escr.length });
    if (fn === "gestionar_bloqueo_oc") return { ok: true, segundos_restantes: 45 };
    if (fn === "registrar_entidad_desde_oc") return { accion: "sin_cambios" };
    if (fn === "archivar_oc" || fn === "restaurar_oc") {
      const oc = db.ordenes_compra_v2.find((o) => o.id === b.p_oc_id);
      if (oc) Object.assign(oc, fn === "archivar_oc" ? { archivada: true, archivada_en: new Date().toISOString(), archivada_por: yo, archivo_motivo: b.p_motivo || null } : { archivada: false, archivada_en: null, archivada_por: null, archivo_motivo: null });
      return { ok: true, oc_id: b.p_oc_id };
    }
    if (fn === "registrar_pago_financiador") {
      const fin = db.financiadores.find((f) => f.id === b.p_financiador_id);
      let resto = Number(b.p_monto) || 0;
      for (const a of b.p_asignaciones || []) {
        const oc = db.ordenes_compra_v2.find((o) => o.id === a.oc_id);
        db.eventos_pago_financiamiento.push({ id: "pf_" + db.eventos_pago_financiamiento.length, oc_id: a.oc_id, financiador_id: b.p_financiador_id, fecha: b.p_fecha, monto: a.monto, creadoEn: new Date().toISOString() });
        oc.monto_pagado_fin = (Number(oc.monto_pagado_fin) || 0) + Number(a.monto);
        oc.estado_pago_financiamiento = oc.monto_pagado_fin >= (Number(oc.costo_total) || 0) ? "pagado" : "parcial";
        resto -= Number(a.monto);
      }
      if (resto > 0) db.eventos_pago_financiamiento.push({ id: "pf_s" + db.eventos_pago_financiamiento.length, oc_id: null, financiador_id: b.p_financiador_id, fecha: b.p_fecha, monto: resto });
      if (fin) fin.saldo_deuda = Math.max(0, (Number(fin.saldo_deuda) || 0) - Number(b.p_monto));
      return { ok: true };
    }
    return { ok: true };
  };
  const respuestaMP = (u) => {
    if (u.searchParams.get("listar")) return { status: 200, body: { ok: true, ocs: [] } };
    const cod = u.searchParams.get("codigo"); llamadasMP.push(cod);
    const r = mp[cod];
    if (!r) return { status: 404, body: { ok: false, error: "OC no encontrada en Mercado Público" } };
    return typeof r === "function" ? r(llamadasMP.filter((c) => c === cod).length) : r;
  };
  return { db, escr, llamadasMP, leer, escribir, rpc, respuestaMP };
}

export async function abrir(browser, base, { url, usuario = "u1", ancho = 390, alto = 844, movil = true, espera = 1800, dialogos = "aceptar", prompt = "" } = {}) {
  const yo = usuario;
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 1, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); const errs = []; const dlg = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && /Warning|Each child|unique "key"/i.test(m.text())) errs.push("consola: " + m.text().slice(0, 160)); });
  page.on("dialog", (d) => { dlg.push(d.type() + ": " + d.message().slice(0, 90)); if (dialogos === "aceptar") d.type() === "prompt" ? d.accept(prompt) : d.accept(); else d.dismiss(); });
  await page.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if ((u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.pathname.startsWith("/api/oc")) {
      const r = base.respuestaMP(u); return route.fulfill({ status: r.status, json: r.body });
    }
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return route.continue();
    if (u.hostname.endsWith("supabase.co")) {
      if (u.pathname.includes("/auth/v1/token")) return route.fulfill({ json: { access_token: "t" + yo, refresh_token: "r", expires_in: 3600, user: { id: yo } } });
      if (u.pathname.includes("/auth/v1/user")) return route.fulfill({ json: { id: yo } });
      if (u.pathname.includes("/auth/v1/logout")) return route.fulfill({ json: {} });
      let cuerpo = null; try { cuerpo = JSON.parse(req.postData() || "null"); } catch {}
      if (u.pathname.includes("/rest/v1/rpc/")) return route.fulfill({ json: base.rpc(u.pathname.split("/").pop(), cuerpo || {}, yo) });
      const tabla = u.pathname.split("/").pop();
      if (m === "GET") return route.fulfill({ json: base.leer(tabla, u.searchParams) });
      const r = base.escribir(m, tabla, u.searchParams, cuerpo);
      return route.fulfill({ status: r.status, json: r.json });
    }
    return route.abort();
  });
  await page.addInitScript((id) => { try { if (location.protocol.startsWith("http")) localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t" + id, refresh_token: "r", user: { id, email: id + "@prueba.cl" } })); } catch {} }, yo);
  await page.goto(url, { waitUntil: "load" }); await page.waitForTimeout(espera);
  return { page, ctx, errs, dlg };
}
