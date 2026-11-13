// Última pasada puntual (12/11/2026): verifica las ocho pantallas ajustadas en 360, 390, 820, 1024 y 1440 px sobre la demostración
// aislada (datos ficticios, sin base real). Comportamiento (no distribución): que lo importante aparezca antes, que filtros, pasos,
// secciones y acciones sigan accesibles, y que no haya textos cortados ni controles fuera de pantalla (revisar.mjs). Guarda capturas.
// Uso: CHROME=… node docs/pruebas-orden-visual/pasada4.mjs file:///…/BFK-Ventas-demo.html <carpeta>
import { chromium } from "playwright-core";
import { revisar, revisarVentana } from "./revisar.mjs";
const [url, carpeta = "/tmp/pasada4"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const TAM = [["360", 360, 780, true], ["390", 390, 844, true], ["820", 820, 1180, true], ["1024", 1024, 768, false], ["1440", 1440, 900, false]];
let nOk = 0; const F = [];
const ok = (k, v, d) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } };
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });

for (const [id, ancho, alto, movil] of TAM) {
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: movil, hasTouch: movil, deviceScaleFactor: ancho <= 390 ? 2 : 1, timezoneId: "America/Santiago" });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.dismiss());
  await p.goto(url); await p.locator("[data-demo-espera]").waitFor({ state: "detached", timeout: 90000 }).catch(() => {}); await p.waitForTimeout(2200);
  const compacto = ancho < 1024; const K = `W${id}`;
  const limpiarAvisos = () => p.evaluate(() => document.querySelector("[data-demo-avisos]")?.replaceChildren());
  const cerrar = async () => { for (let i = 0; i < 4; i++) { if (!(await p.locator("[role=dialog]").count())) break; await p.keyboard.press("Escape"); await p.waitForTimeout(300); } };
  const ir = async (h) => { await cerrar(); await p.evaluate((x) => { location.hash = "#/" + x; }, h); await p.waitForTimeout(1200); await p.evaluate(() => window.scrollTo(0, 0)); };
  const foto = async (n, { pagina = false, ventana = false } = {}) => { await limpiarAvisos(); await p.waitForTimeout(300);
    await p.screenshot({ path: `${carpeta}/${id}-${n}.jpg`, type: "jpeg", quality: 82, fullPage: pagina });
    const fallas = [...(await revisar(p)), ...(ventana ? await revisarVentana(p) : [])]; ok(`${K}_${n}_sin_cortes_ni_desbordes`, !fallas.length, fallas); };
  const top = (loc) => loc.first().evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
  // Las cuatro pestañas de una cotización se ven completas sin desplazar la tira.
  const pestanasCompletas = (h) => h.locator('[data-pestanas="Cotización"]').evaluate((t) => { const R = t.getBoundingClientRect(); return [...t.querySelectorAll("[data-tab]")].every((b) => { const r = b.getBoundingClientRect(); return r.left >= R.left - 1 && r.right <= R.right + 1; }) && t.scrollWidth <= t.clientWidth + 1; });
  const paso = async (n, f) => { try { await f(); } catch (e) { ok(`${K}_${n}_sin_excepcion`, false, e.message.split("\n")[0]); } await cerrar().catch(() => {}); };

  // 1. Inicio
  await paso("inicio", async () => {
    await ir("panel");
    const yPrior = await top(p.locator("[data-prioridad]")); const yReg = await top(p.locator("button").filter({ hasText: /^\d?\s*Compra$/ }));
    if (compacto) {
      const yRes = await top(p.locator('button[data-indicador="banco"]'));
      ok(`${K}_inicio_prioridades_y_registrar_antes_del_resumen`, yPrior < yRes && yReg < yRes, { yPrior, yReg, yRes });
      ok(`${K}_inicio_registrar_en_la_primera_pantalla`, yReg + 60 <= alto, { yReg, alto });
      ok(`${K}_inicio_alerta_vp_antes_de_prioridades`, (await top(p.locator('[data-aviso-linea="alertas-vp"]'))) < yPrior);
      await foto("inicio"); await foto("inicio-completo", { pagina: true });
      await p.locator('button[data-indicador="proyectado"]').click(); await p.waitForTimeout(900);
      ok(`${K}_inicio_resumen_lleva_al_detalle_financiero`, /#\/finanzas/.test(await p.evaluate(() => location.hash)));
    } else {
      ok(`${K}_inicio_indicadores_arriba_en_computador`, (await top(p.locator('[data-indicador="banco"]'))) < yPrior);
      await foto("inicio");
    }
  });
  // 2. Ficha de OC: vendedor y financiador solo en sus filas editables
  await paso("ficha", async () => {
    await ir("compras"); await p.locator('[data-oc="2002-102-SE26"] > div').first().click(); await p.waitForTimeout(1300);
    const f = p.locator('[data-ficha-oc="2002-102-SE26"]');
    ok(`${K}_ficha_sin_vendedor_financiador_repetidos_arriba`, (await f.locator("[data-cabecera-asignaciones]").count()) === 0 && !/V: Rodrigo|F: Inversiones/.test(await f.locator("[data-ficha-cabecera]").innerText()));
    ok(`${K}_ficha_filas_editables_presentes`, (await f.locator('[data-asignacion="vendedor"] [data-asignacion-editar]').count()) === 1 && (await f.locator('[data-asignacion="financiador"] [data-asignacion-editar]').count()) === 1);
    await foto("ficha-oc", { ventana: true });
  });
  // 3. Cotizaciones privadas
  await paso("cotvp", async () => {
    await ir("cotizaciones-privadas");
    const tab = (await p.locator('[data-pestanas="Cotizaciones privadas"] [data-tab="cotizaciones"]').innerText()).trim();
    ok(`${K}_cotvp_un_solo_conteo`, tab === "Cotizaciones" && /\d+ cotizaci/i.test(await p.locator("[data-panel-vp-cotizaciones] h2").first().innerText()), tab);
    ok(`${K}_cotvp_busqueda_y_accion_visibles`, (await p.locator("[data-buscar-cotizaciones]").isVisible()) && (await p.locator("[data-nueva-cotizacion]").isVisible()));
    const yLista = await top(p.locator("[data-cotizacion]"));
    if (compacto) {
      ok(`${K}_cotvp_filtros_secundarios_agrupados`, (await p.locator("[data-filtro-cliente]").count()) === 0 && (await p.locator("[data-abrir-filtros]").isVisible()) && (await p.locator("[data-filtro-estado]").isVisible()));
      ok(`${K}_cotvp_lista_en_la_primera_pantalla`, yLista + 80 <= alto, { yLista, alto });
      await foto("cotizaciones-privadas");
      await p.locator("[data-abrir-filtros]").click(); await p.waitForTimeout(300);
      await p.locator("[data-filtro-cliente]").selectOption({ index: 1 }); await p.waitForTimeout(400);
      ok(`${K}_cotvp_indicador_de_filtros_activos`, (await p.locator("[data-filtros-activos]").innerText()).trim() === "1" && / de \d+ cotizaciones/i.test(await p.locator("[data-panel-vp-cotizaciones] h2").first().innerText()));
      await foto("cotizaciones-privadas-filtros");
      await p.locator("[data-limpiar-filtros]").first().click(); await p.waitForTimeout(300);
      ok(`${K}_cotvp_limpiar_filtros`, (await p.locator("[data-filtros-activos]").count()) === 0);
    } else {
      ok(`${K}_cotvp_filtros_visibles_en_computador`, (await p.locator("[data-filtro-cliente]").isVisible()) && (await p.locator("[data-abrir-filtros]").count()) === 0);
      await foto("cotizaciones-privadas");
    }
  });
  // 4. Editores de cotización: avance en las pestañas, «Falta» enlaza cada paso, estado de la aceptada visible
  await paso("editorvp", async () => {
    await ir("cotizaciones-privadas"); await p.locator("[data-cotizacion]").filter({ hasText: /Los Robles/ }).first().click(); await p.waitForTimeout(1500);
    const h = p.locator('[data-hoja-lateral="ficha-cotizacion"]');
    const est = await h.locator('[data-pestanas="Cotización"] [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.estadoPaso));
    ok(`${K}_editorvp_avance_en_las_pestanas`, est.length === 4 && est.every((e) => e === "listo" || e === "pendiente"), est);
    ok(`${K}_editorvp_aceptada_y_protegida_visibles`, (await h.locator('[data-estado-cotizacion="aceptada"]').count()) === 1 && (await h.locator('[data-aviso-linea="cotizacion-protegida"]').isVisible()));
    ok(`${K}_editorvp_cuatro_pestanas_a_la_vista`, await pestanasCompletas(h));
    ok(`${K}_editorvp_sin_fila_de_pasos_repetida`, (await h.locator("[data-paso=listo]").count()) === 0);
    await h.locator('[data-pestanas="Cotización"] [data-tab="datos"]').click(); await p.waitForTimeout(500);
    ok(`${K}_editorvp_pestana_datos_abierta`, (await h.locator('[data-tab="datos"]').getAttribute("aria-selected")) === "true" && (await h.locator('[data-campo="direccion"]').isVisible()));
    // 13/11/2026: razón social y RUT una sola vez (cliente elegido); debajo, solo el giro.
    const txtDatos = await h.locator('[role="tabpanel"]').filter({ has: p.locator('[data-campo="direccion"]') }).first().innerText();
    const rut = (await h.locator("[data-cliente-elegido]").innerText()).match(/\d{1,2}\.\d{3}\.\d{3}-[\dkK]/)?.[0];
    ok(`${K}_editorvp_cliente_una_sola_vez_y_giro`, !!rut && txtDatos.split(rut).length - 1 === 1 && !/Razón social:/.test(txtDatos) && /Giro: /.test(txtDatos), { rut, veces: rut && txtDatos.split(rut).length - 1 });
    await foto("editor-vp-datos", { ventana: true });
    const pend = h.locator("[data-pasos-cotizacion] [data-paso=pendiente]");
    if (await pend.count()) { const destino = await pend.first().getAttribute("data-paso-pestana"); await pend.first().click(); await p.waitForTimeout(500);
      ok(`${K}_editorvp_falta_lleva_al_paso`, (await h.locator(`[data-tab="${destino}"]`).getAttribute("aria-selected")) === "true", destino); }
    await h.locator('[data-tab="productos"]').click(); await p.waitForTimeout(400); await foto("editor-vp-productos", { ventana: true });
  });
  await paso("editormp", async () => {
    await ir("cotizaciones"); await p.getByRole("button", { name: /Nueva cotización/ }).first().click(); await p.waitForTimeout(1200);
    const h = p.locator("[data-editor-cotizacion]").last();
    const est = await h.locator('[data-pestanas="Cotización"] [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.estadoPaso));
    ok(`${K}_editormp_avance_en_las_pestanas_y_falta`, JSON.stringify(est) === JSON.stringify(["pendiente", "pendiente", "pendiente", "pendiente"]) && (await h.locator("[data-pasos-cotizacion] [data-paso=pendiente]").count()) === 6, est);
    ok(`${K}_editormp_cuatro_pestanas_a_la_vista`, await pestanasCompletas(h));
    await foto("editor-mp-nueva", { ventana: true });
  });
  // 5. Ficha de venta › Pagos
  await paso("pagos", async () => {
    await ir("ordenes-venta"); await p.locator("[data-venta]").filter({ hasText: /Los Robles/ }).first().click(); await p.waitForTimeout(1500);
    const fv = p.locator('[data-hoja-lateral="ficha-venta"]'); await fv.locator('[data-tab="pagos"]').click(); await p.waitForTimeout(500);
    const panel = await fv.locator('[role="tabpanel"]').last().innerText().catch(() => fv.innerText());
    ok(`${K}_pagos_un_solo_resumen`, !/Total de la venta|Cobrado \(pagos vigentes\)/.test(await fv.innerText()) && (await fv.locator('[data-kpi="v-saldo"]').count()) === 1, panel.slice(0, 200));
    ok(`${K}_pagos_registrar_visible`, await fv.locator("[data-registrar-pago]").isVisible());
    await foto("venta-pagos", { ventana: true });
  });
  // 6. Proyectos
  await paso("proyectos", async () => {
    await ir("proyectos");
    ok(`${K}_proyectos_sin_configuracion_en_la_lista`, (await p.locator("[data-config-documentos]").count()) === 0);
    ok(`${K}_proyectos_alertas_operativas_visibles`, (await p.locator('[data-aviso-linea="propuestas"]').isVisible()) && (compacto ? await p.locator('[data-aviso-linea="atrasos"]').isVisible() : (await p.locator('[data-kpi-pi="atraso"]').isVisible())));
    const yLista = await top(p.locator("[data-proyecto]"));
    if (compacto) { ok(`${K}_proyectos_lista_en_la_primera_pantalla`, yLista + 80 <= alto, { yLista, alto });
      ok(`${K}_proyectos_filtros_agrupados`, (await p.locator("[data-filtro-responsable]").count()) === 0 && (await p.locator("[data-abrir-filtros]").isVisible()));
      await p.locator("[data-abrir-filtros]").click(); await p.waitForTimeout(300); await p.locator("[data-filtro-estado]").selectOption("finalizado"); await p.waitForTimeout(400);
      ok(`${K}_proyectos_filtro_estado_funciona`, (await p.locator("[data-proyecto]").count()) === 1 && (await p.locator("[data-filtros-activos]").innerText()).trim() === "1");
      await p.locator("[data-limpiar-filtros]").first().click(); await p.waitForTimeout(300); await p.evaluate(() => window.scrollTo(0, 0)); }
    // 13/11/2026: en el celular los estados van debajo del título (el nombre usa todo el ancho); en tableta y computador, a su lado.
    const disp = await p.locator("[data-proyecto]").first().evaluate((t) => { const n = t.querySelector("[data-cabecera-proyecto] > div:first-child").getBoundingClientRect(); const e = t.querySelector("[data-estados-proyecto]").getBoundingClientRect(); return { debajo: e.top >= n.bottom - 1, anchoNombre: Math.round(n.width), anchoTarjeta: Math.round(t.getBoundingClientRect().width) }; });
    ok(`${K}_proyectos_estados_${ancho <= 400 ? "debajo_del_titulo" : "al_lado_del_titulo"}`, ancho <= 400 ? disp.debajo && disp.anchoNombre >= disp.anchoTarjeta - 40 : !disp.debajo, disp);
    await foto("proyectos");
    await p.locator("[data-proyecto]").filter({ hasText: /concentradora/ }).first().click(); await p.waitForTimeout(1500);
    await p.locator('[data-pestanas="Ficha del proyecto"] [data-tab="documentos"]').click(); await p.waitForTimeout(900);
    ok(`${K}_proyectos_configuracion_en_documentos`, (await p.locator('[data-config-documentos="deshabilitada"]').isVisible()) && /respaldo diario/.test(await p.locator("[data-config-documentos]").innerText()));
    await foto("proyecto-documentos", { ventana: true });
    await p.locator('[data-aviso-accion-boton="alternar-documentos"]').click(); await p.waitForTimeout(500);
    ok(`${K}_proyectos_habilitar_pide_motivo`, await p.locator('[data-ventana="motivo"]').isVisible());
  });
  // 7. Banco
  await paso("banco", async () => {
    await ir("banco"); const txt = await p.locator("main").innerText();
    ok(`${K}_banco_estado_completo`, !/Sin regist…|Sin regist\.\.\./.test(txt) && /Falta registrar el saldo de BancoEstado/.test(txt));
    ok(`${K}_banco_aviso_unico`, (txt.match(/no se puede conciliar/g) || []).length === 1 && !/Registrar saldo de la cuenta|Toca para registrar/.test(txt), (txt.match(/conciliar/g) || []).length);
    await foto("banco");
    await p.locator('[data-aviso-accion-boton="falta-saldo-banco"]').click(); await p.waitForTimeout(700);
    ok(`${K}_banco_registrar_saldo_abre_el_formulario`, (await p.locator("[role=dialog]").count()) >= 1);
  });
  ok(`${K}_sin_errores_de_pagina`, !errs.length, errs.slice(0, 3));
  await ctx.close();
}
await browser.close();
console.log(`RESUMEN pasada 4: ${nOk} OK · ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
