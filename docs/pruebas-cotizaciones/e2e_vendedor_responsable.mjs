// Vendedor responsable obligatorio en Cotizaciones (21/10/2026) — interfaz en PC y celular con Supabase SIMULADO
// (misma regla que el disparador cz_vendedor_responsable). Nada sale a la red.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_vendedor_responsable.mjs http://127.0.0.1:4190/
import { execFileSync } from "node:child_process";
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "./modulo_simulado.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const CATALOGO = [{ id: "v1", nombre: "Vendedor Uno" }, { id: "v2", nombre: "Vendedora Dos" }];
const ITEM = (k, n, precio) => ({ key: k, producto_id: null, ficha: { nombre: n, marca: "Marca", modelo: "M-" + k, especificaciones: [{ etiqueta: "Tipo", valor: "Prueba" }], imagenes: [] }, ficha_aprobada: true, enlace: "https://tienda.cl/" + k, proveedor: "Tienda", cantidad: 2, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, disponibilidad: "En stock", origen_datos: "enlace" });
const COT = (id, nombre, estado, vend, extra = {}) => ({ id, version: 1, id_externo: nombre, nombre, institucion: "Municipio de Prueba", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja", estado, fecha: "2026-10-20", recargo: 0.3, plazo: "5 DIAS", actualizado_en: "2026-10-20",
  vendedor_id: vend?.id || null, vendedor_nombre: vend?.nombre || "", envios: [{ key: "e1", proveedor: "Tienda", monto: 5990, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "simulación" }],
  items: [ITEM("a", "Silla", 50000), ITEM("b", "Mesa", 120000), ITEM("c", "Lámpara", 30000)], ...extra });

async function preparar({ usuario = "u2", movil = false, cots = [] } = {}) {
  const b = crearBase(crearDatos(), {});
  const llamadasTransferir = [];
  const rpc0 = b.rpc;
  const r = await abrir(browser, b, { url: URL_APP, usuario, ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 2500 });
  const M = moduloSimulado(2); M.reglaVendedor = { catalogo: CATALOGO, admins: ["u1"] };
  for (const c of cots) M.cots.set(c.id, JSON.parse(JSON.stringify(c)));
  // Transferencia controlada a la OC (la valida la base: aquí, la misma regla sobre la base simulada de OC).
  b.rpc = (fn, body, yo, interno) => {
    if (fn !== "cz_transferir_vendedor_a_oc") return rpc0(fn, body, yo, interno);
    llamadasTransferir.push(body);
    const c = M.cots.get(body.p_cotizacion_id); const oc = b.db.ordenes_compra_v2.find((o) => o.numero_oc === c?.oc_codigo);
    if (!c || c.estado !== "adjudicada" || !oc) return { status: 400, json: { message: "CZ_VENDEDOR: la asignación no es inequívoca" } };
    if (oc.vendedor_id && oc.vendedor_id !== c.vendedor_id) return { status: 400, json: { message: `CZ_VENDEDOR: la OC ${oc.numero_oc} ya tiene un vendedor asignado distinto; no se sobrescribe` } };
    oc.vendedor_id = c.vendedor_id; return { status: 200, json: { ok: true, despues: c.vendedor_nombre } };
  };
  await r.page.route("**/*", (route) => M.manejar(route));
  await r.page.reload({ waitUntil: "load" }); await espera(r.page, 2500);   // carga inicial ya con las cotizaciones simuladas
  return { ...r, p: r.page, M, b, llamadasTransferir };
}
async function irCotizaciones(p, movil) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
}
const abrirCot = async (p, codigo) => { await p.locator(`[data-cotizacion="${codigo}"]`).click(); await espera(p, 1500); };
const cerrar = async (p) => { await H(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 600); };
const guardar = async (p) => { await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1300); };
const guardados = (M) => M.rpc.filter((r) => /cz_guardar/.test(r.fn));
const texto = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");

// ═════ A. Usuario (no administrador), PC ═════
{
  const { p, ctx, M, errs } = await preparar({ usuario: "u2", cots: [COT("c-pres", "1111-1-COT26", "presentada", CATALOGO[0]), COT("c-hist", "2222-2-COT26", "presentada", null)] });
  await irCotizaciones(p, false);
  // 1. Borrador sin vendedor: permitido, y nada se asigna solo.
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await tab(p, "datos");
  ok("A01_nueva_sin_vendedor_preasignado", (await H(p).locator('[data-campo="vendedor"]').inputValue()) === "" && /no se asigna solo/.test(await H(p).innerText()));
  await H(p).locator('[data-campo="nombre_licitacion"]').fill("Compra de prueba vendedor"); await H(p).locator('[data-campo="id_externo"]').fill("3333-3-COT26");
  await guardar(p);
  const nueva = [...M.cots.values()].find((c) => c.id_externo === "3333-3-COT26");
  ok("A02_borrador_sin_vendedor_se_guarda", !!nueva && nueva.estado === "borrador" && !nueva.vendedor_id);
  // 2. Presentar sin vendedor: bloqueado (aviso + sin llamada al servidor).
  const n0 = guardados(M).length;
  await H(p).locator('[data-campo="estado"]').selectOption("presentada"); await espera(p, 300);
  ok("A03_aviso_falta_vendedor", await H(p).locator('[data-aviso-linea="falta-vendedor"]').count() === 1);
  await H(p).locator("[data-guardar-cotizacion]").click();
  const vioMensaje = await p.getByText(/No se puede presentar una cotización sin vendedor responsable/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await espera(p, 600);
  ok("A04_presentar_sin_vendedor_bloqueado", vioMensaje && guardados(M).length === n0 && M.cots.get(nueva.id).estado === "borrador");
  // 3. Presentar con vendedor: permitido, con el nombre del catálogo.
  await H(p).locator('[data-campo="vendedor"]').selectOption("v1"); await espera(p, 200);
  ok("A05_aviso_desaparece_al_elegir", await H(p).locator('[data-aviso-linea="falta-vendedor"]').count() === 0);
  await guardar(p);
  const g = M.cots.get(nueva.id);
  ok("A06_presentada_con_vendedor", g.estado === "presentada" && g.vendedor_id === "v1" && g.vendedor_nombre === "Vendedor Uno");
  // 4. Persistencia: cerrar y volver a abrir.
  await cerrar(p); await abrirCot(p, "3333-3-COT26"); await tab(p, "datos");
  ok("A07_persistencia_al_reabrir", (await H(p).locator('[data-campo="vendedor"]').inputValue()) === "v1");
  // 6. Cambio en presentada sin autorización: el selector queda bloqueado con explicación.
  ok("A08_presentada_vendedor_bloqueado_para_usuario", await H(p).locator('[data-campo="vendedor"]').isDisabled() && /solo un administrador puede cambiar el vendedor/.test(await H(p).innerText()));
  await cerrar(p);
  // 5. Cambio de vendedor en borrador.
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800); await tab(p, "datos");
  await H(p).locator('[data-campo="id_externo"]').fill("4444-4-COT26"); await H(p).locator('[data-campo="vendedor"]').selectOption("v1"); await guardar(p);
  await H(p).locator('[data-campo="vendedor"]').selectOption("v2"); await guardar(p);
  const b2 = [...M.cots.values()].find((c) => c.id_externo === "4444-4-COT26");
  ok("A09_cambio_en_borrador_permitido_y_registrado", b2.vendedor_id === "v2" && (M.histVend || []).some((h) => h.cotizacion_id === b2.id && h.anterior_id === "v1" && h.nuevo_id === "v2"));
  await cerrar(p);
  // Histórica presentada sin vendedor: se puede seguir editando (aviso de completar) y asignar el vendedor.
  await abrirCot(p, "2222-2-COT26"); await tab(p, "datos");
  ok("A10_historica_sin_vendedor_avisa_sin_bloquear", await H(p).locator('[data-aviso-linea="historica-sin-vendedor"]').count() === 1 && !(await H(p).locator('[data-campo="vendedor"]').isDisabled()));
  await H(p).locator('[data-campo="comuna"]').fill("Laja Centro"); await guardar(p);
  ok("A11_historica_editable_sin_vendedor", M.cots.get("c-hist").comuna === "Laja Centro" && M.cots.get("c-hist").version === 2);
  await cerrar(p);
  ok("A12_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}

// ═════ B. Administrador: cambio autorizado, adjudicación y transferencia a la OC; EETT ═════
{
  const { p, ctx, M, b, llamadasTransferir, errs } = await preparar({ usuario: "u1", cots: [
    COT("c-pres", "1111-1-COT26", "presentada", CATALOGO[0]),
    COT("c-adj1", "5555-5-COT26", "adjudicada", CATALOGO[1], { oc_codigo: "2001-101-SE26" }),   // la OC 2001 ya tiene vendedor v1
  ] });
  await irCotizaciones(p, false);
  await abrirCot(p, "1111-1-COT26"); await tab(p, "datos");
  ok("B01_admin_puede_cambiar", !(await H(p).locator('[data-campo="vendedor"]').isDisabled()));
  await H(p).locator('[data-campo="vendedor"]').selectOption("v2"); await espera(p, 300); await guardar(p);
  ok("B02_cambio_autorizado_con_historial", M.cots.get("c-pres").vendedor_id === "v2" && (M.histVend || []).some((h) => h.cotizacion_id === "c-pres" && h.anterior_nombre === "Vendedor Uno" && h.nuevo_nombre === "Vendedora Dos" && h.es_admin));
  await espera(p, 600);
  ok("B03_historial_visible", /Vendedor Uno → Vendedora Dos \(administrador\)/.test(await H(p).locator("[data-historial-vendedor]").innerText().catch(() => "")));
  // 8. Adjudicación con vendedor asignado, vinculada a una OC sin vendedor (2005-105-SE26).
  await H(p).locator('[data-campo="estado"]').selectOption("adjudicada"); await espera(p, 300);
  await H(p).locator('[data-campo="oc_codigo"]').fill("2005-105-SE26"); await guardar(p);
  const adj = M.cots.get("c-pres");
  ok("B04_adjudicada_conserva_vendedor", adj.estado === "adjudicada" && adj.vendedor_id === "v2" && adj.vendedor_nombre === "Vendedora Dos" && adj.oc_codigo === "2005-105-SE26");
  // 12. EETT con el vendedor responsable.
  await tab(p, "eett");
  const [d] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]);
  const txt = execFileSync("pdftotext", ["-layout", await d.path(), "-"]).toString();
  ok("B05_eett_con_vendedor_responsable", /Vendedor responsable: Vendedora Dos/.test(txt), txt.slice(0, 200));
  await cerrar(p);
  // 9 y 10. OC: con vendedor distinto → solo aviso; sin vendedor → transferencia controlada.
  await p.reload({ waitUntil: "load" }); await espera(p, 2600);
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  await p.locator('[data-oc="2001-101-SE26"] > div').first().click(); await espera(p, 1400);
  ok("B06_oc_con_vendedor_distinto_solo_avisa", await p.locator('[data-vendedor-cotizacion="diferente"]').count() === 1 && await p.locator("[data-transferir-vendedor]").count() === 0
    && b.db.ordenes_compra_v2.find((o) => o.id === "oc1").vendedor_id === "v1");
  await p.keyboard.press("Escape"); await espera(p, 500);
  await p.locator('[data-oc="2005-105-SE26"] > div').first().click(); await espera(p, 1400);
  ok("B07_oc_sin_vendedor_ofrece_transferir", await p.locator('[data-vendedor-cotizacion="transferible"] [data-transferir-vendedor]').count() === 1);
  await p.locator("[data-transferir-vendedor]").click(); await espera(p, 1800);
  ok("B08_transferencia_controlada", llamadasTransferir.length === 1 && b.db.ordenes_compra_v2.find((o) => o.numero_oc === "2005-105-SE26").vendedor_id === "v2" && await p.locator("[data-transferir-vendedor]").count() === 0);
  ok("B09_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}

// ═════ C. Celular 390 px ═════
{
  const { p, ctx, M, errs } = await preparar({ usuario: "u2", movil: true, cots: [COT("c-bor", "6666-6-COT26", "borrador", null)] });
  await irCotizaciones(p, true); await abrirCot(p, "6666-6-COT26"); await tab(p, "datos");
  await H(p).locator('[data-campo="estado"]').selectOption("presentada"); await espera(p, 300);
  const sinDesborde = await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  ok("C01_celular_aviso_visible_sin_desborde", await H(p).locator('[data-aviso-linea="falta-vendedor"]').isVisible() && sinDesborde);
  await guardar(p);
  ok("C02_celular_presentar_sin_vendedor_bloqueado", M.cots.get("c-bor").estado === "borrador");
  await H(p).locator('[data-campo="vendedor"]').selectOption("v2"); await guardar(p);
  ok("C03_celular_presentar_con_vendedor", M.cots.get("c-bor").estado === "presentada" && M.cots.get("c-bor").vendedor_id === "v2");
  ok("C04_sin_errores_js", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
console.log(`RESUMEN e2e vendedor responsable: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
