// Ficha de OC en Compras, vista móvil: sin cabecera ni estados duplicados y sin pestañas/botones cortados.
// Uso: node docs/pruebas-ui-movil/e2e_compras_movil.mjs http://127.0.0.1:4178/   (build servido con vite preview)
// Base simulada (Fase 4A). Nada sale a la red.
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import { irSeccionFicha, seccionesDelIndice } from "../pruebas-oc/indice_ficha.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const NUM = "2001-101-SE26";

async function abrirFicha(vista) {
  const b = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
  const r = await abrir(browser, b, { url: URL_APP, ...vista, espera: 3000 });
  const p = r.page;
  const nav = vista.movil ? p.locator('[data-nav="compras"]').last() : p.locator('aside [data-nav="compras"]');
  await nav.click(); await p.waitForTimeout(800);
  await p.locator(`[data-oc="${NUM}"] > div`).first().click(); await p.waitForTimeout(1300);
  return { ...r, b };
}

for (const ancho of [360, 390]) {
  const { page: p, ctx, errs } = await abrirFicha({ ancho, alto: 800, movil: true });
  const ficha = p.locator(`[data-ficha-oc="${NUM}"]`);
  ok(`M${ancho}_ficha_abierta`, await ficha.count() === 1);
  const cab = ficha.locator("[data-ficha-cabecera]");
  const txtCab = (await cab.innerText()).trim();
  ok(`M${ancho}_cabecera_sin_numero_oc`, !txtCab.includes(NUM), txtCab);
  ok(`M${ancho}_cabecera_sin_vendedor_financiador`, await cab.locator("[data-cabecera-asignaciones]").count() === 0);
  ok(`M${ancho}_cabecera_sin_chips_estado`, !/✓ Compra|Financ\./.test(txtCab), txtCab);
  ok(`M${ancho}_tarjeta_conserva_resumen`, (await p.locator(`[data-oc="${NUM}"] > div`).first().innerText()).includes(NUM)
    && await p.locator(`[data-oc="${NUM}"] [data-asignaciones-fila]`).count() === 1);
  // El índice ofrece un acceso por cada sección de la ficha. Antes se comparaba con un número fijo (9), que quedó desactualizado
  // al agregarse «Clasificación tributaria»: ahora se valida contra las secciones realmente presentes y las nueve permanentes.
  const idsSec = await ficha.locator("[data-seccion-ficha]").evaluateAll((els) => els.map((e) => e.getAttribute("data-seccion-ficha").split("-")[0]));
  // 12/11/2026: en celular el índice es un solo control que despliega la lista; se valida lo necesario (un acceso por sección y que
  // cada acceso lleve a su sección y la abra), no cuántas filas ocupa.
  const titulosInd = await seccionesDelIndice(cab);
  const titulosSec = await ficha.locator("[data-seccion-ficha] > button").evaluateAll((els) => els.map((e) => e.children[1].innerText.trim()));
  const fijas = ["info", "productos", "compra", "facturacion", "entrega", "cobranza", "seguimiento", "comunicaciones", "historial"];
  ok(`M${ancho}_indice_presente`, titulosInd.length === idsSec.length && fijas.every((id) => idsSec.includes(id)) && titulosSec.every((t) => titulosInd.includes(t)), { titulosInd, titulosSec });
  const llegadas = [];
  for (const t of titulosInd) {
    await irSeccionFicha(cab, t); await p.waitForTimeout(650);
    llegadas.push(await ficha.locator("[data-seccion-ficha]").filter({ has: p.locator("> button > span:nth-child(2)", { hasText: new RegExp("^" + t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") }) }).first().evaluate((sec) => {
      const r = sec.getBoundingClientRect(); return { abierta: sec.querySelector(":scope > button").getAttribute("aria-expanded") === "true", visible: r.top < window.innerHeight && r.bottom > 0 }; }).catch((e) => ({ error: String(e.message).slice(0, 80) })));
  }
  ok(`M${ancho}_indice_lleva_a_cada_seccion`, llegadas.length === titulosInd.length && llegadas.every((x) => x.abierta && x.visible), llegadas);
  ok(`M${ancho}_indice_se_cierra_al_elegir`, !(await cab.locator("[data-indice-lista]").count()) || !(await cab.locator("[data-indice-lista]").isVisible()));
  ok(`M${ancho}_edicion_presente`, await ficha.locator("[data-asignacion-editar]").count() >= 1 && await ficha.locator("[data-resumen-financiero]").count() === 1);
  // Ningún botón de la ficha sobresale del ancho de pantalla.
  const cortados = await p.evaluate(({ num }) => {
    const vw = document.documentElement.clientWidth;
    return [...document.querySelectorAll(`[data-ficha-oc="${num}"] button`)]
      .filter((b) => b.offsetParent).map((b) => ({ t: b.innerText.trim().slice(0, 30), r: Math.round(b.getBoundingClientRect().right), l: Math.round(b.getBoundingClientRect().left) }))
      .filter((x) => x.r > vw + 0.5 || x.l < -0.5);
  }, { num: NUM });
  ok(`M${ancho}_sin_botones_cortados`, cortados.length === 0, cortados);
  ok(`M${ancho}_sin_scroll_horizontal`, await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  ok(`M${ancho}_sin_errores`, errs.length === 0, errs);
  if (ancho === 390) await p.screenshot({ path: process.env.CAPTURA || "/tmp/compras_movil.png", fullPage: false });
  await ctx.close();
}

// Escritorio: cabecera fija sin repetir la identificación de la hoja.
{
  const { page: p, ctx } = await abrirFicha({ ancho: 1440, alto: 900, movil: false });
  const cab = p.locator(`[data-ficha-oc="${NUM}"] [data-ficha-cabecera]`);
  // Identificación una sola vez: OC e institución solo en el encabezado de la hoja (no repetidos en la cabecera fija).
  const hoja = await p.locator(`[data-hoja-lateral="${NUM}"]`).innerText();
  ok("E_identificacion_una_sola_vez", (hoja.match(new RegExp(NUM, "g")) || []).length === 1 && !(await cab.innerText()).includes(NUM), (hoja.match(new RegExp(NUM, "g")) || []).length);
  ok("E_cabecera_conserva_estados_y_asignaciones", /Compra/.test(await cab.innerText()) && await cab.locator("[data-cabecera-asignaciones]").count() === 1);
  await p.screenshot({ path: process.env.CAPTURA_E || "/tmp/compras_escritorio.png", fullPage: false });
  await ctx.close();
}

await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
