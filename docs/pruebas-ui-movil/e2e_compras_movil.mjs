// Ficha de OC en Compras, vista móvil: sin cabecera ni estados duplicados y sin pestañas/botones cortados.
// Uso: node docs/pruebas-ui-movil/e2e_compras_movil.mjs http://127.0.0.1:4178/   (build servido con vite preview)
// Base simulada (Fase 4A). Nada sale a la red.
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";

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
  ok(`M${ancho}_indice_presente`, await cab.locator("[data-indice-ficha] button").count() === 8);
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

// Escritorio: la cabecera fija se mantiene igual.
{
  const { page: p, ctx } = await abrirFicha({ ancho: 1440, alto: 900, movil: false });
  const cab = p.locator(`[data-ficha-oc="${NUM}"] [data-ficha-cabecera]`);
  ok("E_cabecera_escritorio_intacta", (await cab.innerText()).includes(NUM) && await cab.locator("[data-cabecera-asignaciones]").count() === 1);
  await ctx.close();
}

await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
