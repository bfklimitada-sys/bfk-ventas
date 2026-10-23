// Eliminación definitiva de OC duplicadas (23/10/2026): botón solo para administradores, revisión con registros asociados,
// movimientos financieros y su igual en la OC original, bloqueos, confirmación con el N° de la OC, auditoría y recarga.
// Supabase SIMULADO en memoria (las reglas reales se prueban en SQL: docs/migraciones/pruebas/eliminar-oc). Datos ficticios.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-oc/e2e_eliminar_oc.mjs http://127.0.0.1:4178/
import { chromium, CHROME, crearBase, abrir } from "./mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "./datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const texto = (p) => p.evaluate(() => document.body.innerText);
const TABLAS = ["eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios", "historial_cambios"];
const FIN = ["ordenes_compra_v2", ...TABLAS, "financiadores", "pagos_vendedor", "gastos_indirectos", "iva_mensual"];
// Huella de todo lo que NO es la OC indicada (las demás OC deben quedar idénticas).
const huellaAjena = (b, ocId) => JSON.stringify(FIN.map((t) => (b.db[t] || []).filter((f) => f.id !== ocId && f.oc_id !== ocId).map((f) => JSON.stringify(f)).sort()));

const datos = () => {
  const d = crearDatos(); const base = d.ordenes_compra_v2[0];
  const pagada = { estado_compra: "comprado", estado_factura_propia: "emitida", estado_pago_cliente: "pagado", estado_pago_financiamiento: "pagado", costo_total: 104970, monto_pagado_fin: 104970, monto_facturado: 130000, archivada: false };
  d.ordenes_compra_v2.push(
    { ...base, ...pagada, id: "ocA", numero_oc: "5555-1-AG26", cliente: "HOSPITAL FICTICIO", rut_cliente: "61.000.000-0", monto_total: 130000, monto_cobrado: 130000, financiador_id: "f1" },
    { ...base, ...pagada, id: "ocB", numero_oc: "5555-1-AG26-B", cliente: "POR COMPLETAR", rut_cliente: "", monto_total: 130000, monto_cobrado: 130000, financiador_id: "f1" },
    { ...base, ...pagada, id: "ocD", numero_oc: "5555-1-AG26-D", cliente: "DUPLICADA CON COBRO EXTRA", rut_cliente: "", monto_total: 130000, monto_cobrado: 180000, financiador_id: "f1" },
    { ...base, id: "ocZ", numero_oc: "5555-9-AG26", cliente: "ARCHIVADA SIN MOVIMIENTOS", monto_total: 10000, costo_total: 0, monto_pagado_fin: 0, monto_facturado: 0, monto_cobrado: 0,
      estado_compra: "pendiente", estado_factura_propia: "pendiente", estado_pago_cliente: "pendiente", estado_pago_financiamiento: "pendiente", financiador_id: "f1",
      archivada: true, archivada_en: "2026-10-23T04:31:00Z", archivada_por: "u1", archivada_por_nombre: "Admin Prueba", archivo_motivo: "Creada por error" });
  for (const [x, cobros] of [["A", [["2026-04-20", 130000]]], ["B", [["2026-04-20", 130000]]], ["D", [["2026-04-20", 130000], ["2026-05-02", 50000]]]]) {
    d.eventos_factura.push({ id: "f" + x, oc_id: "oc" + x, fecha: "2026-04-20", numero_factura: "150", monto: 130000 });
    cobros.forEach(([f, m], i) => d.eventos_pago_cliente.push({ id: `c${x}${i}`, oc_id: "oc" + x, fecha: f, monto: m, medio_pago: "transferencia", cobrado_en_banco: true }));
    d.eventos_compra.push({ id: "k" + x, oc_id: "oc" + x, fecha: x === "A" ? "2026-04-17" : "2026-04-20", monto_venta: 130000, costo_compra: 104970, financiador_id: "f1", proveedor: "" });
    d.eventos_pago_financiamiento.push({ id: "p" + x, oc_id: "oc" + x, financiador_id: "f1", fecha: x === "A" ? "2026-07-01" : "2026-04-20", monto: 104970 });
    d.eventos_entrega.push({ id: "e" + x, oc_id: "oc" + x, fecha: "2026-04-20" });
  }
  return d;
};

// Réplica simple de las funciones de la base (la regla completa se prueba en SQL).
function conEliminacion(b, { instalada = true } = {}) {
  b.db.oc_eliminaciones = []; const rpc0 = b.rpc;
  const filasDe = (oc) => Object.fromEntries(TABLAS.map((t) => [t, (b.db[t] || []).filter((f) => f.oc_id === oc)]).filter(([, v]) => v.length));
  const revisar = (ocId, origId) => {
    const o = b.db.ordenes_compra_v2.find((x) => x.id === ocId); const orig = origId ? b.db.ordenes_compra_v2.find((x) => x.id === origId) : null;
    const usados = new Set(); const movs = []; const bloqueos = [];
    const tipos = [["cobro", "eventos_pago_cliente", "monto", (e, f) => e.fecha === f.fecha], ["factura", "eventos_factura", "monto", (e, f) => e.numero_factura === f.numero_factura],
      ["compra", "eventos_compra", "costo_compra", () => true], ["devolucion", "eventos_pago_financiamiento", "monto", () => true]];
    for (const [tipo, t, campo, igual] of tipos) for (const e of b.db[t].filter((x) => x.oc_id === ocId)) {
      const eq = orig ? b.db[t].find((f) => f.oc_id === orig.id && !usados.has(f.id) && Number(f[campo]) === Number(e[campo]) && igual(e, f)) : null;
      if (eq) usados.add(eq.id);
      movs.push({ tipo, id: e.id, fecha: e.fecha, monto: Number(e[campo]), detalle: tipo === "factura" ? e.numero_factura : null, equivalente: eq?.id || null });
      if (orig && !eq) bloqueos.push({ codigo: "sin_equivalente", texto: `El ${tipo} del ${e.fecha} por $${Number(e[campo]).toLocaleString("es-CL")} no tiene un equivalente en la OC original: podría ser un movimiento real.` });
    }
    if (movs.length && !orig) bloqueos.push({ codigo: "financiera", texto: "Tiene movimientos financieros: solo se puede eliminar como duplicado de otra OC que tenga los mismos movimientos (indique la OC original)." });
    const adv = [{ codigo: "financiador", texto: "El financiador deja de registrar una compra y una devolución de $104.970: su saldo no cambia." }];
    if (!o.archivada) adv.push({ codigo: "activa", texto: "La OC está activa: deja de contar en ventas, caja, cuentas por cobrar y comisiones." });
    return { oc: { id: o.id, numero_oc: o.numero_oc, cliente: o.cliente, archivada: !!o.archivada, monto_total: o.monto_total },
      original: orig ? { id: orig.id, numero_oc: orig.numero_oc } : null, registros: Object.fromEntries(Object.entries(filasDe(ocId)).map(([t, v]) => [t, v.length])),
      movimientos: movs, financiera: movs.length > 0, bloqueos, advertencias: adv, eliminable: bloqueos.length === 0 };
  };
  b.rpc = (fn, body, yo, interno) => {
    if (fn === "oc_eliminacion_revisar" || fn === "oc_eliminar_definitivamente") {
      b.escr.push({ metodo: "RPC", tabla: fn, cuerpo: JSON.parse(JSON.stringify(body)), n: b.escr.length });
      if (!instalada) return { status: 404, json: { code: "PGRST202", message: "Could not find the function public." + fn } };
      if (yo !== "u1") return { status: 403, json: { code: "42501", message: "OCE: solo un administrador puede eliminar una OC." } };
      const o = b.db.ordenes_compra_v2.find((x) => x.id === body.p_oc_id);
      if (!o) return { status: 404, json: { message: "OCE: la OC no existe (¿ya fue eliminada?). No se eliminó nada." } };
      const rev = revisar(body.p_oc_id, body.p_original_id);
      if (fn === "oc_eliminacion_revisar") return { status: 200, json: rev };
      if (String(body.p_confirmacion).trim().toUpperCase() !== o.numero_oc.toUpperCase()) return { status: 400, json: { message: "OCE: la confirmación no coincide con el N° de la OC. No se eliminó nada." } };
      if (!rev.eliminable) return { status: 403, json: { message: "OCE: no se puede eliminar." } };
      b.db.oc_eliminaciones.push({ id: "oce1", oc_id: o.id, numero_oc: o.numero_oc, cliente: o.cliente, estaba_archivada: !!o.archivada, original_numero: rev.original?.numero_oc || null,
        motivo: body.p_motivo, eliminado_por_nombre: "Admin Prueba", eliminado_en: "2026-10-23T13:00:00Z", resumen: { registros: rev.registros, monto_total: o.monto_total } });
      for (const t of TABLAS) b.db[t] = (b.db[t] || []).filter((f) => f.oc_id !== o.id);
      b.db.ordenes_compra_v2 = b.db.ordenes_compra_v2.filter((x) => x.id !== o.id);
      return { status: 200, json: { eliminacion: "oce1", oc: o.numero_oc, registros: rev.registros } };
    }
    return rpc0(fn, body, yo, interno);
  };
  return b;
}
async function irA(p, k, movil) {
  if (movil) { await p.locator('[data-nav="mas"]').first().click(); await espera(p, 500); await p.locator(`[data-nav="${k}"]`).last().click(); await espera(p, 900); return; }
  await p.locator(`aside [data-nav="${k}"]`).first().click(); await espera(p, 800);
}
async function irCompras(p, movil) {
  if (movil) { await p.locator('[data-nav="compras"]').first().click(); await espera(p, 900); return; }
  await irA(p, "compras", false);
}
async function abrirOC(p, numero) {
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
const escrituras = (b, n0) => b.escr.slice(n0).filter((w) => w.metodo !== "GET" && w.metodo !== "RPC" && w.tabla !== "oc_bloqueos");

for (const movil of [false, true]) {
  const X = movil ? "M" : "P";
  const b = conEliminacion(crearBase(datos(), { mp: RESPUESTAS_MP }));
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 3000 });
  const h0 = huellaAjena(b, "ocB"), n0 = b.escr.length;
  await irCompras(p, movil); await abrirOC(p, "5555-1-AG26-B");
  ok(`${X}01_admin_ve_eliminar_definitivamente`, (await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-B"]').count()) === 1);
  await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-B"]').first().scrollIntoViewIfNeeded();
  await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-B"]').first().click(); await espera(p, 1200);
  const dlg = p.locator("[role=dialog]").last(); const tD = await dlg.innerText();
  ok(`${X}02_original_sugerida_y_registros_asociados`, (await dlg.locator("[data-original]").inputValue()) === "ocA" && /1 cobros/.test(tD) && /1 devoluciones al financiador/.test(tD) && /1 entregas/.test(tD), tD.slice(0, 600));
  ok(`${X}03_cada_movimiento_con_su_igual_en_la_original`, (await dlg.locator('[data-mov-financiero][data-equivalente="1"]').count()) === 4 && (await dlg.locator("[data-bloqueos]").count()) === 0);
  ok(`${X}04_advertencias_visibles`, /su saldo no cambia/.test(tD) && /deja de contar en ventas/.test(tD));
  const btn = dlg.locator("[data-eliminar-definitivo]");
  ok(`${X}05_boton_inactivo_sin_motivo_ni_codigo`, await btn.isDisabled());
  await dlg.locator("[data-motivo]").fill("Duplicada de la importación del 29/07");
  await dlg.locator("[data-confirmar-codigo]").fill("5555-1-AG26");
  ok(`${X}06_codigo_de_la_original_no_confirma`, await btn.isDisabled());
  await dlg.locator("[data-confirmar-codigo]").fill("5555-1-ag26-b");
  ok(`${X}07_codigo_correcto_habilita`, !(await btn.isDisabled()));
  if (movil) await p.screenshot({ path: (process.env.SALIDA || "/tmp") + `/eliminar_oc_${X}.png` });
  else await dlg.screenshot({ path: (process.env.SALIDA || "/tmp") + `/eliminar_oc_${X}.png` });
  await btn.click(); await espera(p, 2500);
  const rpc = b.escr.slice(n0).filter((w) => w.tabla === "oc_eliminar_definitivamente");
  ok(`${X}08_una_sola_llamada_a_la_base_con_original_motivo_y_codigo`, rpc.length === 1 && rpc[0].cuerpo.p_oc_id === "ocB" && rpc[0].cuerpo.p_original_id === "ocA" && rpc[0].cuerpo.p_confirmacion === "5555-1-ag26-b" && /29\/07/.test(rpc[0].cuerpo.p_motivo), rpc.map((w) => w.cuerpo));
  ok(`${X}09_sin_borrados_ni_escrituras_directas`, escrituras(b, n0).length === 0, escrituras(b, n0));
  const tL = await texto(p);
  ok(`${X}10_desaparece_de_compras_y_la_original_sigue`, (await p.locator('[data-oc="5555-1-AG26-B"]').count()) === 0 && (await p.locator('[data-oc="5555-1-AG26"]').count()) === 1 && /eliminada definitivamente/.test(tL));
  ok(`${X}11_nada_ajeno_cambia`, huellaAjena(b, "ocB") === h0);
  // OC con un cobro sin igual en la original: se explica y no hay botón.
  await abrirOC(p, "5555-1-AG26-D"); await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-D"]').first().scrollIntoViewIfNeeded();
  await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-D"]').first().click(); await espera(p, 1200);
  const d2 = p.locator("[role=dialog]").last(); const tD2 = await d2.innerText();
  ok(`${X}12_bloqueo_explicado_sin_boton`, /No se puede eliminar/.test(tD2) && /2026-05-02 por \$50\.000/.test(tD2) && (await d2.locator("[data-eliminar-definitivo]").count()) === 0 && (await d2.locator('[data-equivalente="0"]').count()) === 1, tD2.slice(0, 500));
  await p.keyboard.press("Escape"); await espera(p, 400);
  ok(`${X}13_sin_desborde_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  ok(`${X}14_sin_errores_js`, errs.length === 0, errs);
  await ctx.close();
}

// Administración (escritorio): archivada con su botón y registro de OCs eliminadas.
{
  const b = conEliminacion(crearBase(datos(), { mp: RESPUESTAS_MP }));
  b.db.oc_eliminaciones.push({ id: "oce0", oc_id: "ocQ", numero_oc: "4444-1-AG26-B", cliente: "POR COMPLETAR", estaba_archivada: true, original_numero: "4444-1-AG26", motivo: "Duplicada",
    eliminado_por_nombre: "Admin Prueba", eliminado_en: "2026-10-23T12:00:00Z", resumen: { monto_total: 130000, registros: { eventos_pago_cliente: 1, historial_cambios: 2 } } });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await p.locator('[data-nav="usuarios"]').first().click({ timeout: 5000 }).catch(async () => { await p.getByText("Administración", { exact: true }).first().click(); });
  await espera(p, 900);
  await p.getByText(/^OCs archivadas/).first().click(); await espera(p, 1200);
  await p.locator('[data-oc-archivada="5555-9-AG26"] button').first().click(); await espera(p, 500);
  ok("A01_archivada_tiene_eliminar_definitivamente", (await p.locator('[data-eliminar-oc-abrir="5555-9-AG26"]').count()) === 1);
  const tE = await p.locator('[data-oc-eliminada="4444-1-AG26-B"]').innerText().catch(() => "");
  ok("A02_registro_de_eliminadas_quien_cuando_motivo_y_registros", /duplicada de 4444-1-AG26/.test(tE) && /por Admin Prueba/.test(tE) && /Duplicada/.test(tE) && /1 cobros · 2 historial de cambios/.test(tE), tE);
  await p.locator('[data-eliminar-oc-abrir="5555-9-AG26"]').click(); await espera(p, 1200);
  const dlg = p.locator("[role=dialog]").last();
  ok("A03_archivada_sin_movimientos_no_pide_original", (await dlg.locator("[data-original]").inputValue()) === "" && (await dlg.locator("[data-eliminar-definitivo]").count()) === 1);
  await dlg.locator("[data-motivo]").fill("Creada por error"); await dlg.locator("[data-confirmar-codigo]").fill("5555-9-AG26");
  await dlg.locator("[data-eliminar-definitivo]").click(); await espera(p, 2500);
  ok("A04_tras_eliminar_aparece_en_el_registro", (await p.locator('[data-oc-eliminada="5555-9-AG26"]').count()) === 1 && (await p.locator('[data-oc-archivada="5555-9-AG26"]').count()) === 0);
  ok("A05_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}
// Usuario no administrador: no ve el botón.
{
  const b = conEliminacion(crearBase(datos(), { mp: RESPUESTAS_MP }));
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, usuario: "u2", ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await irCompras(p, false);
  if (await p.locator('[data-oc="5555-1-AG26-B"]').count()) await abrirOC(p, "5555-1-AG26-B");
  ok("U01_usuario_sin_boton_eliminar", (await p.locator("[data-eliminar-oc-abrir]").count()) === 0 && (await p.locator('aside [data-nav="usuarios"]').count()) === 0);
  ok("U02_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}
// Base sin la actualización: se avisa y no se elimina nada.
{
  const b = conEliminacion(crearBase(datos(), { mp: RESPUESTAS_MP }), { instalada: false });
  const { page: p, errs, ctx } = await abrir(browser, b, { url: URL_APP, ancho: 1280, alto: 900, movil: false, espera: 3000 });
  await irCompras(p, false); await abrirOC(p, "5555-1-AG26-B");
  await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-B"]').first().scrollIntoViewIfNeeded(); await p.locator('[data-eliminar-oc-abrir="5555-1-AG26-B"]').first().click(); await espera(p, 1200);
  const t = await p.locator("[role=dialog]").last().innerText();
  ok("S01_sin_migracion_avisa_y_no_ofrece_eliminar", /actualización pendiente/.test(t) && (await p.locator("[data-eliminar-definitivo]").count()) === 0, t.slice(0, 300));
  ok("S02_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}
await browser.close();
console.log(`\nRESUMEN eliminar OC (interfaz): ${nOk} OK, ${F.length} FALLA(S)`);
if (F.length) process.exitCode = 1;
