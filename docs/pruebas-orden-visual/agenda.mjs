// Agenda: una sola leyenda (visible en computador y celular), meses de seis filas y días con varios eventos.
// Datos simulados: se concentran entregas estimadas, entregas realizadas y vencimientos de factura en un mismo día.
// Uso: node agenda.mjs <url> <carpeta>
import path from "node:path";
const { crearBase, chromium, abrir } = await import("../pruebas-oc/mock_estado.mjs");
const { crearDatos, RESPUESTAS_MP } = await import("../pruebas-oc/datos_oc.mjs");
const { revisar } = await import("./revisar.mjs");
const [url, carpeta] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
let okN = 0, fallas = 0; const ok = (n, c, d = "") => { if (c) okN++; else { fallas++; console.log("FALLA", n, typeof d === "string" ? d : JSON.stringify(d)); } };
const hoy = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Santiago" }));
const A = hoy.getFullYear(), M = hoy.getMonth();
const iso = (d) => `${A}-${String(M + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const DIA = 18, MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function datos() {
  const d = crearDatos();
  d.eventos_compra.forEach((e, i) => { if (i < 6) e.fecha_entrega_estimada = iso(DIA); });          // 6 entregas estimadas el mismo día
  d.eventos_entrega.forEach((e, i) => { if (i < 3) e.fecha = iso(DIA); });                             // 3 entregas realizadas ese día
  d.eventos_compra.slice(6, 8).forEach((e) => { e.fecha_entrega_estimada = iso(DIA + 1); });           // 2 más al día siguiente
  return d;
}
const filasDelMes = (a, m) => Math.ceil((((new Date(a, m, 1).getDay() + 6) % 7) + new Date(a, m + 1, 0).getDate()) / 7);
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const [nombre, ancho, alto, movil] of [["pc", 1440, 900, false], ["cel", 390, 844, true], ["cel360", 360, 740, true]]) {
  const { page, errs } = await abrir(browser, crearBase(datos(), { mp: RESPUESTAS_MP }), { url: url + "#/agenda", ancho, alto, movil, espera: 2500 });
  const P = (n) => `${nombre}_${n}`;
  const medir = () => page.evaluate(() => { const ds = [...document.querySelectorAll("[data-dia]")]; const W = document.documentElement.clientWidth;
    const tops = [...new Set(ds.map((b) => Math.round(b.getBoundingClientRect().top)))];
    return { dias: ds.length, filas: tops.length, fuera: ds.filter((b) => { const r = b.getBoundingClientRect(); return r.left < -1 || r.right > W + 1; }).length,
      cortados: ds.filter((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map((b) => b.dataset.dia),
      alto: ds[0]?.getBoundingClientRect().height, calendario: document.querySelector("[data-leyenda-agenda]")?.getBoundingClientRect().bottom, vista: window.innerHeight }; });
  // 1. Una sola explicación de los colores, a la vista sin tocar nada.
  ok(P("leyenda_unica"), (await page.locator("[data-leyenda-agenda]").count()) === 1 && (await page.getByText("¿Qué significan los puntos?").count()) === 0);
  const ley = await page.locator("[data-leyenda-agenda]").innerText();
  ok(P("leyenda_completa"), ["Entrega estimada", "Entrega realizada", "Vence factura", "Promesa de pago", "Hoy", "Día seleccionado"].every((t) => ley.includes(t)), ley);
  ok(P("leyenda_visible"), await page.locator("[data-leyenda-agenda]").isVisible());
  // 2. Mes actual: todos los días, sin cortes; día con varios eventos.
  let m = await medir();
  ok(P("mes_actual_filas"), m.filas === filasDelMes(A, M) && m.dias === new Date(A, M + 1, 0).getDate() && m.fuera === 0, m);
  ok(P("dias_sin_contenido_cortado"), m.cortados.length === 0, m.cortados);
  const dia = page.locator(`[data-dia="${DIA}"]`);
  // El día concentra varias entregas estimadas y realizadas (cuántas exactamente lo decide la app: no toda OC simulada entra a la Agenda).
  const rot = await dia.getAttribute("aria-label"); const total = Number(await dia.getAttribute("data-eventos"));
  const nEst = Number(/(\d+) entregas estimadas/.exec(rot)?.[1] || 0), nReal = Number(/(\d+) entregas realizadas/.exec(rot)?.[1] || 0);
  ok(P("dia_con_varios_eventos_de_dos_tipos"), nEst >= 5 && nReal >= 2 && total === nEst + nReal, rot);
  const visto = await dia.innerText();
  ok(P("dia_muestra_cantidad_de_cada_tipo"), visto.includes(String(nEst)) && visto.includes(String(nReal)), visto);
  await page.screenshot({ path: path.join(carpeta, `${nombre}-agenda-mes.png`), fullPage: true });
  // 3. Al tocar el día se listan TODOS sus eventos (ninguno se oculta por espacio).
  await dia.click(); await page.waitForTimeout(500);
  const det = await page.locator("body").innerText(); const listados = (det.slice(det.indexOf(`${DIA} de ${MESES[M]}`)).match(/\d{4}-\d{3}-SE26|VD-\d+/g) || []).length;
  ok(P("detalle_lista_todos_los_eventos"), listados === total, { listados, total });
  await page.locator("[data-leyenda-agenda]").scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(carpeta, `${nombre}-agenda-dia.png`) });   // captura de la vista (no de página completa)
  for (const p of await revisar(page)) { fallas++; console.log("FALLA", P("maquetacion"), p); }
  // 4. Meses de seis filas: se recorren 14 meses y se comprueba cada uno que lo sea.
  let seis = 0; let a = A, mm = M;
  for (let i = 0; i < 14; i++) {
    await page.getByRole("button", { name: "Mes siguiente" }).click(); await page.waitForTimeout(140); mm++; if (mm > 11) { mm = 0; a++; }
    if (filasDelMes(a, mm) !== 6) continue; seis++; m = await medir();
    ok(P(`seis_filas_${MESES[mm]}_${a}`), m.filas === 6 && m.dias === new Date(a, mm + 1, 0).getDate() && m.fuera === 0 && m.cortados.length === 0, m);
    if (!movil) ok(P(`seis_filas_cabe_en_pantalla_${MESES[mm]}`), m.calendario <= m.vista + 1 || (await page.evaluate(() => window.scrollY)) > 0, m);
    if (seis === 1) await page.screenshot({ path: path.join(carpeta, `${nombre}-agenda-seis-filas.png`), fullPage: true });
  }
  ok(P("hubo_meses_de_seis_filas"), seis >= 1, seis);
  ok(P("sin_errores_de_pagina"), errs.length === 0, errs);
  await page.context().close();
}
await browser.close();
console.log(`RESUMEN Agenda: ${okN} OK, ${fallas} FALLA(S)`);
