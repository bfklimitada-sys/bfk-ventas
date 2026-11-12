// Prueba de la DEMOSTRACIÓN aislada (docs/demo/dist servida en local). No instala ninguna respuesta simulada desde fuera: lo que
// responde es la propia página. Bloquea y registra toda solicitud que salga del equipo para comprobar el aislamiento.
// Recorre las pantallas en computador, tableta y celular y ejecuta acciones reales en Mercado Público, Ventas privadas y Proyectos.
// Uso: CHROME=… node docs/demo/prueba_demo.mjs http://127.0.0.1:4190/ [carpeta-de-capturas]
import { chromium } from "playwright-core";
import path from "node:path";
const [URL_DEMO = "http://127.0.0.1:4190/", CARPETA = ""] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const PERMITIDAS = /^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/;   // fuentes y Chart.js (como la app real); nada de datos
const RUTAS = ["panel", "alertas", "agenda", "compras", "cotizaciones", "clientes", "cotizaciones-privadas", "ordenes-venta", "proyectos", "finanzas", "financiamiento", "vendedores", "gastos", "impuestos", "banco", "administracion"];
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

async function abrir({ ancho, alto, movil }) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil, timezoneId: "America/Santiago", deviceScaleFactor: 1 });
  const p = await ctx.newPage(); p.setDefaultTimeout(9000); const errs = []; const fuera = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/*", (r) => { const u = new URL(r.request().url()); if (u.hostname === "127.0.0.1") return r.continue(); fuera.push(u.hostname); return r.abort(); });
  const t0 = Date.now(); await p.goto(URL_DEMO, { waitUntil: "load" });
  await p.locator("[data-demo-espera]").waitFor({ state: "detached", timeout: 90000 }).catch(() => {});
  const ms = Date.now() - t0; await p.waitForTimeout(2500);
  const ir = async (h) => { await p.evaluate((x) => { location.hash = "#/" + x; }, h); await p.waitForTimeout(1300); };
  const sql = (q) => p.evaluate(async (x) => (await window.__bfkDemo.depurar.pg.query(x)).rows, q);
  const mp = (tabla) => p.evaluate((t) => window.__bfkDemo.depurar.mp.db[t], tabla);
  const cerrar = async () => { for (let i = 0; i < 4; i++) { if (!(await p.locator("[role=dialog]").count())) break; await p.keyboard.press("Escape"); await p.waitForTimeout(350); } };
  return { p, ctx, errs, fuera, ms, ir, sql, mp, cerrar };
}
const paso = async (nombre, fn) => { try { await fn(); } catch (e) { ok(nombre + "_sin_excepcion", false, String(e.message).split("\n")[0]); } };

for (const [nombre, ancho, alto, movil] of [["pc", 1440, 900, false], ["tableta", 820, 1180, true], ["cel", 390, 844, true]]) {
  const { p, ctx, errs, fuera, ms, ir, sql, mp, cerrar } = await abrir({ ancho, alto, movil });
  const N = nombre.toUpperCase();
  ok(`${N}_01_lista_en_menos_de_45s`, ms < 45000, ms);
  const est = await p.evaluate(() => window.__bfkDemo.estado);
  ok(`${N}_02_base_de_ventas_privadas_y_proyectos_iniciada`, est.pgError === null && est.fase === "", est);
  ok(`${N}_03_sesion_del_usuario_ficticio`, /Administrador/.test(await p.locator("body").innerText()));

  // ── Recorrido de todas las pantallas ──
  const vacias = []; const desbordes = [];
  for (const r of RUTAS) {
    await ir(r); const t = (await p.locator("main").innerText().catch(() => "")).trim();
    if (t.length < 40) vacias.push(r);
    if (!(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1))) desbordes.push(r);
    if (CARPETA) await p.screenshot({ path: path.join(CARPETA, `${nombre}-${r}.png`), fullPage: true });
  }
  ok(`${N}_04_las_${RUTAS.length}_pantallas_tienen_contenido`, vacias.length === 0, vacias);
  ok(`${N}_05_sin_desplazamiento_horizontal`, desbordes.length === 0, desbordes);
  await ir("compras"); ok(`${N}_06_mercado_publico_con_ocs`, (await p.locator("[data-oc]").count()) >= 8);
  await ir("ordenes-venta"); ok(`${N}_07_ventas_privadas_con_ventas`, (await p.locator("[data-venta]").count()) >= 4);
  await ir("proyectos"); ok(`${N}_08_proyectos_con_proyectos`, (await p.locator("[data-proyecto]").count()) >= 4);
  ok(`${N}_09_sin_nombres_reales_en_catalogos`, !/Vergara|Balboa|Vegas/.test(JSON.stringify(await mp("vendedores")) + JSON.stringify(await mp("financiadores")) + JSON.stringify(await sql("select nombre from public.perfiles"))));

  // ── Mercado Público: registrar un gasto ──
  await paso(`${N}_10_gasto`, async () => {
    const antes = (await mp("gastos_indirectos")).length;
    await ir("gastos"); await p.getByRole("button", { name: /Registrar gasto/ }).first().click(); await p.waitForTimeout(500);
    const m = p.locator("[role=dialog]").last(); await m.locator("select").first().selectOption({ label: "Transporte y despachos" }); await p.waitForTimeout(200);
    await m.locator('input[type="number"]').nth(1).fill("73500"); await m.locator('input:not([type="number"]):not([type="date"])').last().fill("Flete de prueba de la demostración");
    await m.getByRole("button", { name: /Registrar gasto/ }).click(); await p.waitForTimeout(1500);
    const g = await mp("gastos_indirectos");
    ok(`${N}_10_gasto_registrado_en_mercado_publico`, g.length === antes + 1 && g.some((x) => Number(x.monto) === 73500), g.length);
    // La lista muestra el último pago de cada categoría; el historial de la categoría muestra todos.
    await p.locator("main").getByText("Transporte y despachos").first().click(); await p.waitForTimeout(700);
    ok(`${N}_11_gasto_visible_en_el_historial_de_su_categoria`, /73\.500/.test(await p.locator("body").innerText()), (await p.locator("body").innerText()).slice(-400));
  });
  await cerrar();

  // ── Mercado Público: ficha de una OC, índice de secciones y nota en el historial ──
  await paso(`${N}_12_ficha`, async () => {
    await ir("compras"); await p.locator('[data-oc="2003-103-SE26"] > div').first().click(); await p.waitForTimeout(1300);
    const f = p.locator('[data-ficha-oc="2003-103-SE26"]'); await f.waitFor();
    const abre = f.locator("[data-indice-abrir]"); if (await abre.count()) { await abre.click(); await p.waitForTimeout(200); }
    const nSec = await f.locator("[data-indice-seccion]").count(); const nFicha = await f.locator("[data-seccion-ficha]").count();
    ok(`${N}_12_indice_con_un_acceso_por_seccion`, nSec === nFicha && nSec >= 9, { nSec, nFicha });
    await f.locator('[data-indice-seccion="cobranza"]').click(); await p.waitForTimeout(700);
    ok(`${N}_13_el_indice_abre_la_seccion`, (await f.locator('[data-seccion-ficha^="cobranza-"] > button').getAttribute("aria-expanded")) === "true");
    ok(`${N}_14_ficha_sin_desborde`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
    if (CARPETA) await p.screenshot({ path: path.join(CARPETA, `${nombre}-ficha-oc.png`) });
  });
  await cerrar();

  // ── Mercado Público: consulta de una OC al «servicio» simulado de Mercado Público ──
  await paso(`${N}_15_consulta_mp`, async () => {
    const r = await p.evaluate(async () => { const x = await fetch("/api/oc?codigo=4005-5-SE26"); return { s: x.status, j: await x.json() }; });
    ok(`${N}_15_consulta_a_mercado_publico_respondida_en_la_pagina`, r.s === 200 && r.j?.oc?.numero_oc === "4005-5-SE26", r);
  });

  // ── Ventas privadas: cliente nuevo y pago ──
  await paso(`${N}_16_cliente`, async () => {
    const antes = Number((await sql("select count(*)::int n from public.pi_clientes"))[0].n);
    await ir("clientes"); await p.locator("[data-nuevo-cliente]").first().click(); await p.waitForTimeout(400);
    const f = p.locator('[data-ventana="form-cliente"]'); await f.locator("[data-campo-rut]").fill("77654321-7"); await f.locator("[data-campo-razon]").fill("Maderas del Sur Demo SpA");
    await f.locator("[data-campo-contacto]").fill("Rosa Pérez"); await f.locator("[data-campo-correo]").fill("rosa@maderas.invalid");
    await f.locator("[data-guardar-cliente]").click(); await p.waitForTimeout(1800);
    const despues = Number((await sql("select count(*)::int n from public.pi_clientes"))[0].n);
    ok(`${N}_16_cliente_creado_en_la_base_de_la_demostracion`, despues === antes + 1, { antes, despues, texto: (await f.innerText().catch(() => "")).slice(0, 200) });
    await cerrar(); await ir("clientes");
    ok(`${N}_17_cliente_visible_en_la_lista`, /Maderas del Sur Demo/.test(await p.locator("main").innerText()));
  });
  await cerrar();
  await paso(`${N}_18_pago`, async () => {
    const antes = Number((await sql("select count(*)::int n from public.vp_pagos"))[0].n);
    await ir("ordenes-venta"); await p.locator("[data-venta]").filter({ hasText: /Los Robles/ }).first().click(); await p.waitForTimeout(1500);
    const fv = p.locator('[data-hoja-lateral="ficha-venta"]'); await fv.waitFor();
    await fv.locator('[data-tab="pagos"]').click(); await p.waitForTimeout(500); await fv.locator("[data-registrar-pago]").first().click(); await p.waitForTimeout(600);
    const fp = p.locator('[data-ventana="form-pago"]'); await fp.locator("[data-pago-tipo]").selectOption("anticipo"); await fp.locator("[data-pago-monto]").fill("15000");
    if (CARPETA) await p.screenshot({ path: path.join(CARPETA, `${nombre}-vp-pago.png`) });
    await fp.locator("[data-guardar-pago]").click(); await p.waitForTimeout(2000);
    const despues = Number((await sql("select count(*)::int n from public.vp_pagos"))[0].n);
    ok(`${N}_18_pago_registrado_por_la_funcion_real_de_la_base`, despues === antes + 1, { antes, despues, texto: (await fp.innerText().catch(() => "")).slice(-200) });
  });
  await cerrar();

  // ── Proyectos: proyecto nuevo y actividad ──
  await paso(`${N}_19_proyecto`, async () => {
    const hoy = (await sql("select (public.pi_hoy())::text a, (public.pi_hoy() + 90)::text b, (public.pi_hoy() + 30)::text c"))[0];
    await ir("proyectos"); await p.locator("[data-nuevo-proyecto]").first().click(); const v = p.locator('[data-ventana="nuevo-proyecto"]'); await v.waitFor(); await p.waitForTimeout(400);
    await v.locator('[data-campo="cliente_id"]').selectOption({ index: 1 }).catch(async () => { await v.locator("select").first().selectOption({ index: 1 }); });
    await v.locator('[data-campo="nombre"]').fill("Proyecto de la demostración " + nombre); await v.locator('[data-campo="tipo"]').selectOption("ingenieria");
    await v.locator('[data-campo="responsable_id"]').selectOption("33333333-3333-3333-3333-333333333333");
    await v.locator('[data-especialidad="electrica"]').click(); await v.locator('[data-campo="ubicacion"]').fill("Planta ficticia, sector norte");
    await v.locator('[data-campo="fecha_inicio_prevista"]').fill(hoy.a); await v.locator('[data-campo="fecha_termino_prevista"]').fill(hoy.b); await v.locator('[data-campo="presupuesto"]').fill("12.500.000");
    if (CARPETA) await p.screenshot({ path: path.join(CARPETA, `${nombre}-pi-nuevo.png`) });
    await v.locator("[data-guardar-proyecto]").click(); await p.waitForTimeout(2600);
    const fila = (await sql(`select codigo from public.pi_proyectos where nombre = 'Proyecto de la demostración ${nombre}'`))[0];
    ok(`${N}_19_proyecto_creado_con_codigo`, /^PI-\d{4}-\d{3}$/.test(fila?.codigo || ""), { fila, texto: (await v.innerText().catch(() => "")).slice(-300) });
    if (fila) {
      const fp = p.locator(`[data-ficha-proyecto="${fila.codigo}"]`); if (!(await fp.count())) { await cerrar(); await ir("proyectos"); await p.locator(`[data-proyecto="${fila.codigo}"]`).click(); await fp.waitFor(); }
      await p.locator('[data-pestanas="Ficha del proyecto"] [data-tab="actividades"]').click(); await p.waitForTimeout(900);
      await p.locator("[data-nueva-actividad]").click(); const va = p.locator('[data-ventana="actividad"]'); await va.waitFor();
      await va.locator('[data-campo="nombre"]').fill("Ingeniería conceptual"); await va.locator('[data-campo="responsable_id"]').selectOption("33333333-3333-3333-3333-333333333333");
      await va.locator('[data-campo="fecha_inicio_prevista"]').fill(hoy.a); await va.locator('[data-campo="fecha_fin_prevista"]').fill(hoy.c); await va.locator('[data-campo="peso"]').fill("2");
      await va.locator("[data-guardar-actividad]").click(); await p.waitForTimeout(1800);
      const n = Number((await sql(`select count(*)::int n from public.pi_actividades a join public.pi_proyectos p on p.id = a.proyecto_id where p.codigo = '${fila.codigo}'`))[0].n);
      ok(`${N}_20_actividad_creada`, n === 1, n);
    }
  });
  await cerrar();

  // ── Documento generado: se muestra en el visor de la demostración (el alojamiento no permite descargas) ──
  if (nombre === "pc") await paso(`${N}_21_pdf`, async () => {
    await ir("compras"); await p.locator('[data-oc="2002-102-SE26"] > div').first().click(); await p.waitForTimeout(1300);
    await p.locator("[data-ficha-pdf]").first().click(); await p.locator("[data-demo-visor] canvas").first().waitFor({ timeout: 30000 });
    ok(`${N}_21_pdf_de_la_ficha_visible_en_el_visor`, (await p.locator("[data-demo-visor] canvas").count()) >= 1);
    if (CARPETA) await p.screenshot({ path: path.join(CARPETA, `${nombre}-visor-pdf.png`) });
    await p.locator("[data-demo-visor-cerrar]").click();
  });
  await cerrar();

  // ── Aislamiento y estabilidad ──
  const otras = [...new Set(fuera)].filter((h) => !PERMITIDAS.test(h));
  ok(`${N}_22_ninguna_solicitud_de_datos_sale_del_equipo`, otras.length === 0 && !fuera.some((h) => /supabase/.test(h)), [...new Set(fuera)]);
  ok(`${N}_23_la_pagina_no_intento_llegar_a_servidores_externos`, (await p.evaluate(() => window.__bfkDemo.estado.bloqueadas)).length === 0, await p.evaluate(() => window.__bfkDemo.estado.bloqueadas));
  ok(`${N}_24_sin_errores_de_pagina`, errs.length === 0, [...new Set(errs)].slice(0, 5));
  // Al recargar, la demostración vuelve a su estado inicial (nada queda guardado).
  if (nombre === "pc") { await p.reload({ waitUntil: "load" }); await p.locator("[data-demo-espera]").waitFor({ state: "detached", timeout: 90000 }).catch(() => {}); await p.waitForTimeout(1500);
    ok(`${N}_25_al_recargar_vuelve_al_estado_inicial`, Number((await sql("select count(*)::int n from public.pi_clientes where razon_social like 'Maderas del Sur Demo%'"))[0].n) === 0 && !(await mp("gastos_indirectos")).some((x) => Number(x.monto) === 73500)); }
  await ctx.close();
}
await browser.close();
console.log(`RESUMEN demostración: ${nOk} OK · ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
