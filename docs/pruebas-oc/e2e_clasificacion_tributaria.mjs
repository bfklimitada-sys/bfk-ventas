// Fase 2 de ventas exentas: clasificación tributaria en la app (20/10/2026). Datos ficticios; no toca Supabase.
// La base real (funciones trib_*) se ensaya aparte en la copia restaurada (bfk-respaldos, trib/pruebas.sql).
// Aquí se emulan esas funciones para comprobar la interfaz: estado sin migración, solicitud, aprobación solo de
// administrador, bloqueos por documentos SII, factura afecta bloqueada en OC exenta y payload de cotizaciones.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_clasificacion_tributaria.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";
import { validarSolicitud, motivoIncompatibleOC, etiquetaTratamiento, cotizacionVinculadaA, historialDe } from "../../src/lib/clasificacionTributaria.js";
import { bloqueoFacturaPorExenta } from "../../src/lib/tributario.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const TRIB_COLS = ["tratamiento_iva", "fundamento_iva", "respaldo_iva", "tratamiento_aprobado_por", "tratamiento_aprobado_en", "clasificacion_id"];

// ═════ Unitarias ═════
{
  const D = crearDatos(); const O = (id) => ({ ...D.ordenes_compra_v2.find((o) => o.id === id), eventos_factura: D.eventos_factura.filter((f) => f.oc_id === id) });
  ok("U1_historica_es_afecta", etiquetaTratamiento(O("oc3")) === "Afecta (sin clasificación: registro histórico)");
  ok("U2_exencion_exige_fundamento_y_respaldo", /fundamento legal/.test(validarSolicitud({ tratamiento: "exenta_fora" }, { ambito: "cotizacion" }))
    && /qué acredita/.test(validarSolicitud({ tratamiento: "exenta_fora", fundamento_legal: "Art. 101 Ley 18.948" }, { ambito: "cotizacion" }))
    && validarSolicitud({ tratamiento: "exenta_fora", fundamento_legal: "Art. 101 Ley 18.948", respaldo_descripcion: "Certificado DGS FO.R.A.", respaldo_documento: "Oficio 1" }, { ambito: "cotizacion" }) === null);
  ok("U3_factura_afecta_vigente_bloquea", /factura afecta vigente \(N\.º 702\)/.test(motivoIncompatibleOC(O("oc2"), "exenta_fora", "x".repeat(20))));
  ok("U4_documentos_exigen_procedimiento", /procedimiento documental/.test(motivoIncompatibleOC({ ...O("oc3"), eventos_factura: [{ numero_factura: "1", monto: 1, tipo_dte: 33 }, { numero_factura: "2", monto: 1, tipo_dte: 61, ref_folio: "1", ref_codigo: 1 }] }, "exenta_fora", "")));
  ok("U5_mp_con_impuestos_bloquea", /Mercado Público informa impuestos/.test(motivoIncompatibleOC({ ...O("oc3"), mp: { iva: 190000 } }, "exenta_fora")) && motivoIncompatibleOC({ ...O("oc3"), mp: { iva: 0 } }, "exenta_fora") === null);
  ok("U6_oc_exenta_bloquea_factura_afecta", /clasificada como exenta/.test(bloqueoFacturaPorExenta({ ...O("oc3"), tratamiento_iva: "exenta_fora" })) && bloqueoFacturaPorExenta(O("oc3")) === null);
  ok("U7_vinculo_cotizacion_explicito", cotizacionVinculadaA({ numero_oc: "2003-103-SE26" }, [{ estado: "adjudicada", oc_codigo: "2003 103 se26", tratamiento_iva: "exenta_fora" }])?.tratamiento_iva === "exenta_fora"
    && cotizacionVinculadaA({ numero_oc: "2003-103-SE26" }, [{ estado: "presentada", oc_codigo: "2003-103-SE26" }]) === null);
  ok("U8_historial_por_objetivo", historialDe([{ ambito: "oc", oc_id: "oc3", solicitado_en: "1" }, { ambito: "oc", oc_id: "oc4", solicitado_en: "2" }], "oc", "oc3").length === 1);
}
// Payload de guardado de cotizaciones: nunca lleva la clasificación.
{
  const viejo = globalThis.fetch; let cuerpo = null;
  globalThis.fetch = async (url, op) => { if (String(url).includes("/rpc/")) cuerpo = JSON.parse(op.body); return { ok: true, status: 200, json: async () => ({ id: "c1", version: 2 }), text: async () => "", clone() { return this; } }; };
  try {
    // cotizacionesDatos importa supabase.jsx: se empaqueta con esbuild (como docs/pruebas-*/ejecutar.mjs).
    const { build } = await import("esbuild"); const { fileURLToPath } = await import("node:url");
    const salida = fileURLToPath(new URL("./.tmp_cot_datos.mjs", import.meta.url));
    await build({ entryPoints: [fileURLToPath(new URL("../../src/lib/cotizacionesDatos.js", import.meta.url))], bundle: true, format: "esm", platform: "node", outfile: salida, loader: { ".js": "jsx", ".jsx": "jsx" }, logLevel: "silent" });
    const { crearAlmacen } = await import(salida + "?v=" + Date.now());
    (await import("node:fs")).unlinkSync(salida);
    const alm = crearAlmacen("t", "base", 2);
    await alm.guardarCotizacion({ id: "c1", version: 1, nombre: "X", items: [], envios: [], recargo: 0.3, tratamiento_iva: "exenta_fora", fundamento_iva: "f", respaldo_iva: "r", tratamiento_aprobado_por: "u1", tratamiento_aprobado_en: "2026-10-20", clasificacion_id: "k" });
    ok("U9_guardar_cotizacion_sin_clasificacion", cuerpo && !TRIB_COLS.some((k) => k in cuerpo.p) && cuerpo.p.nombre === "X", cuerpo);
  } catch (e) { ok("U9_guardar_cotizacion_sin_clasificacion", false, e.message); }
  globalThis.fetch = viejo;
}

// ═════ Emulación de las funciones trib_* de la base ═════
function conTrib(b, { instalada = true } = {}) {
  b.db.trib_clasificaciones = b.db.trib_clasificaciones || [];
  const leer0 = b.leer, rpc0 = b.rpc; let n = 0;
  b.leer = (tabla, params) => (tabla === "trib_clasificaciones" && !instalada ? { code: "PGRST205", message: "Could not find the table" } : leer0(tabla, params));
  b.rpc = (fn, body, yo) => {
    if (!fn.startsWith("trib_")) return rpc0(fn, body, yo);
    b.escr.push({ metodo: "RPC", tabla: fn, id: null, cuerpo: JSON.parse(JSON.stringify(body)), n: b.escr.length });
    const admin = (b.db.perfiles || []).some((p) => p.id === yo && p.rol === "admin");
    const nombre = (b.db.perfiles || []).find((p) => p.id === yo)?.nombre;
    if (fn === "trib_solicitar_clasificacion") {
      const p = body.p; const id = "tc" + (++n);
      b.db.trib_clasificaciones.push({ id, ...p, estado: "pendiente", solicitado_por: yo, solicitado_por_nombre: nombre, solicitado_en: new Date().toISOString(), origen: "manual" });
      return { status: 200, json: { id, estado: "pendiente" } };
    }
    const h = b.db.trib_clasificaciones.find((x) => x.id === body.p_id);
    if (fn === "trib_resolver_clasificacion") {
      if (!admin) return { status: 403, json: { message: "TRIB423: solo un administrador aprueba o rechaza clasificaciones tributarias." } };
      Object.assign(h, { estado: body.p_decision === "aprobar" ? "aprobada" : "rechazada", resuelto_por: yo, resuelto_por_nombre: nombre, resuelto_en: new Date().toISOString(), observacion_resolucion: body.p_observacion });
      if (body.p_decision === "aprobar") { const oc = b.db.ordenes_compra_v2.find((o) => o.id === h.oc_id); Object.assign(oc, { tratamiento_iva: h.tratamiento, fundamento_iva: h.fundamento_legal, respaldo_iva: h.respaldo_descripcion, tratamiento_aprobado_por: yo, tratamiento_aprobado_en: h.resuelto_en, clasificacion_id: h.id }); }
      return { status: 200, json: { id: h.id, estado: h.estado } };
    }
    if (fn === "trib_anular_solicitud") { h.estado = "anulada"; return { status: 200, json: { id: h.id, estado: "anulada" } }; }
    return { status: 404, json: { message: "función desconocida" } };
  };
  return b;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [pref, movil] of [["E", false], ["M", true]]) {
  const ancho = movil ? 390 : 1440, alto = movil ? 844 : 900;
  const abrirOC = async (p, num) => {
    if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
    await p.getByPlaceholder(/Buscar/i).first().fill(num); await espera(p, 500);
    await p.locator(`[data-oc="${num}"] > div`).first().click(); await espera(p, 1400);
    await p.locator("[data-indice-ficha] button", { hasText: "Clasificación tributaria" }).first().click(); await espera(p, 500);
  };
  const seccion = (p) => p.locator("[data-hoja-lateral]").last().locator("[data-clasificacion-tributaria], [data-trib-no-instalada]").first();
  const escrTrib = (b) => b.escr.filter((w) => w.metodo !== "RPC" && TRIB_COLS.some((k) => k in (w.cuerpo || {})));

  // ── A. Migración no instalada: todo sigue como hoy ──
  {
    const b = conTrib(crearBase(crearDatos(), { mp: RESPUESTAS_MP }), { instalada: false });
    const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
    await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 900);
    await abrirOC(p, "2003-103-SE26");
    const t = await seccion(p).innerText().catch(() => "");
    ok(`${pref}A1_sin_migracion_solo_informa`, /Afecta \(sin clasificación: registro histórico\)/.test(t) && /se habilitará cuando se instale/.test(t) && !(await p.locator("[data-trib-solicitar]").count()), t);
    ok(`${pref}A2_sin_errores`, !errs.length, errs);
    await ctx.close();
  }
  // ── B. Usuario: solicita; no puede aprobar ──
  const base = conTrib(crearBase(crearDatos(), { mp: RESPUESTAS_MP }));
  {
    const { page: p, ctx, errs } = await abrir(browser, base, { url: URL_APP, usuario: "u2", ancho, alto, movil, espera: 2500 });
    await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 900);
    // OC con factura afecta vigente: se avisa antes de enviar y no se llama a la base.
    await abrirOC(p, "2002-102-SE26");
    await p.locator("[data-trib-solicitar]").first().click(); await espera(p, 300);
    await p.locator("[data-trib-fundamento]").fill("Art. 101 de la Ley N.º 18.948 (FO.R.A.)");
    await p.locator("[data-trib-respaldo]").fill("Certificado de la DGS: pago con Fondo Rotativo");
    await p.locator("[data-trib-documento]").fill("Oficio 123");
    await p.locator("[data-trib-procedimiento]").fill("ENSAYO sin nota de crédito");
    const n0 = base.escr.length;
    await p.locator("[data-trib-enviar]").click(); await espera(p, 500);
    ok(`${pref}B1_factura_afecta_vigente_avisa`, /factura afecta vigente \(N\.º 702\)/.test(await p.locator("[data-trib-error]").innerText().catch(() => "")) && !base.escr.slice(n0).some((w) => w.tabla === "trib_solicitar_clasificacion"));
    // OC sin documentos: sin respaldo se avisa; con respaldo se envía.
    await abrirOC(p, "2003-103-SE26");
    await p.locator("[data-trib-solicitar]").first().click(); await espera(p, 300);
    await p.locator("[data-trib-fundamento]").fill("");
    await p.locator("[data-trib-enviar]").click(); await espera(p, 400);
    ok(`${pref}B2_sin_respaldo_avisa`, /fundamento legal/.test(await p.locator("[data-trib-error]").innerText().catch(() => "")) && !base.escr.some((w) => w.tabla === "trib_solicitar_clasificacion"));
    await p.locator("[data-trib-fundamento]").fill("Art. 101 de la Ley N.º 18.948 (FO.R.A.)");
    await p.locator("[data-trib-respaldo]").fill("Certificado de la DGS: pago con Fondo Rotativo");
    await p.locator("[data-trib-documento]").fill("Oficio DGS N.º 123");
    await p.locator("[data-trib-enviar]").click(); await espera(p, 1800);
    const sol = base.escr.find((w) => w.tabla === "trib_solicitar_clasificacion")?.cuerpo?.p;
    ok(`${pref}B3_solicitud_enviada`, sol && sol.ambito === "oc" && sol.oc_id === "oc3" && sol.tratamiento === "exenta_fora" && sol.respaldo_documento === "Oficio DGS N.º 123" && /18\.948/.test(sol.fundamento_legal), sol);
    await abrirOC(p, "2003-103-SE26");
    const t = await seccion(p).innerText().catch(() => "");
    ok(`${pref}B4_pendiente_visible_sin_aprobar`, /Solicitud pendiente: Exenta FO\.R\.A\./.test(t) && !(await p.locator("[data-trib-aprobar]").count()) && (await p.locator("[data-trib-anular]").count()) === 1
      && /Afecta \(sin clasificación/.test(t), t);
    ok(`${pref}B5_oc_sin_cambios_por_la_api`, !escrTrib(base).length && base.db.ordenes_compra_v2.find((o) => o.id === "oc3").tratamiento_iva == null, escrTrib(base));
    ok(`${pref}B6_sin_errores`, !errs.length, errs);
    await ctx.close();
  }
  // ── C. Administrador: aprueba; la OC queda exenta y no admite factura afecta ──
  {
    const { page: p, ctx, errs } = await abrir(browser, base, { url: URL_APP, usuario: "u1", ancho, alto, movil, espera: 2500 });
    await p.locator('[data-nav="compras"]:visible').first().click(); await espera(p, 900);
    await abrirOC(p, "2003-103-SE26");
    await p.locator("[data-trib-observacion]").fill("Certificado revisado");
    await p.locator("[data-trib-aprobar]").click(); await espera(p, 2000);
    const r = base.escr.find((w) => w.tabla === "trib_resolver_clasificacion")?.cuerpo;
    ok(`${pref}C1_aprobacion_enviada`, r && r.p_decision === "aprobar" && r.p_observacion === "Certificado revisado", r);
    await abrirOC(p, "2003-103-SE26");
    const t = await seccion(p).innerText().catch(() => "");
    ok(`${pref}C2_vigente_exenta_con_respaldo`, /Exenta FO\.R\.A\. \(art\. 101, Ley 18\.948\)/.test(t) && /Fundamento: Art\. 101/.test(t) && /fase 3/.test(t) && /Aprobada/.test(t), t);
    await p.locator("[data-indice-ficha] button", { hasText: "Facturación SII" }).first().click(); await espera(p, 400);
    await p.locator("[data-hoja-lateral]").last().getByRole("button", { name: /Emitir factura$/ }).first().click(); await espera(p, 500);
    const m = p.locator("[role=dialog]").last();
    ok(`${pref}C3_factura_afecta_bloqueada_en_oc_exenta`, /clasificada como exenta/.test(await m.locator("[data-bloqueo-exenta]").innerText().catch(() => "")) && await m.getByRole("button", { name: /Registrar factura/ }).isDisabled());
    await p.keyboard.press("Escape"); await espera(p, 300);
    // Una OC histórica sigue igual (sin clasificación ni aviso).
    await abrirOC(p, "2004-104-SE26");
    ok(`${pref}C4_historica_igual`, /Afecta \(sin clasificación: registro histórico\)/.test(await seccion(p).innerText().catch(() => "")) && !(await p.locator("[data-trib-aviso-fase]").count()));
    ok(`${pref}C5_sin_escrituras_directas`, !escrTrib(base).length && !base.escr.some((w) => ["iva_mensual", "pagos_vendedor", "financiadores", "eventos_pago_financiamiento"].includes(w.tabla)));
    ok(`${pref}C6_sin_errores`, !errs.length, errs);
    await ctx.close();
  }
}
await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
