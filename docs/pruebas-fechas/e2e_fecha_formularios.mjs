// Fecha predeterminada de los formularios de Mercado Público = fecha de Chile, no el día UTC (12/11/2026).
// Antes, entre las 21:00 (20:00 en invierno) y la medianoche de Chile, los formularios proponían el día siguiente.
// Reloj del navegador fijado en instantes cercanos a la medianoche, en horario de verano e invierno y en los dos cambios de hora
// de 2026; además con el equipo en otra zona (un teléfono de viaje). Supabase simulado: no toca ninguna base real.
// Uso: CHROME=… node docs/pruebas-fechas/e2e_fecha_formularios.mjs http://127.0.0.1:4179/
import { chromium, CHROME, crearBase, instalarRutas } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4179/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };

const CASOS = [
  { id: "verano_2330", utc: "2026-11-12T02:30:00Z", chile: "2026-11-11", zona: "America/Santiago", nota: "23:30 del 11/11 (UTC ya es 12/11)" },
  { id: "verano_0010", utc: "2026-11-12T03:10:00Z", chile: "2026-11-12", zona: "America/Santiago", nota: "00:10 del 12/11" },
  { id: "invierno_2330", utc: "2026-06-15T03:30:00Z", chile: "2026-06-14", zona: "America/Santiago", nota: "23:30 del 14/06 (invierno, UTC−4)" },
  { id: "cambio_abril", utc: "2026-04-05T03:30:00Z", chile: "2026-04-04", zona: "America/Santiago", nota: "23:30 repetidas del sábado 4 de abril (fin del horario de verano)" },
  { id: "cambio_septiembre", utc: "2026-09-06T04:05:00Z", chile: "2026-09-06", zona: "America/Santiago", nota: "01:05 del domingo 6 de septiembre (inicio del horario de verano)" },
  { id: "fin_de_mes", utc: "2026-12-01T02:10:00Z", chile: "2026-11-30", zona: "America/Santiago", nota: "23:10 del 30/11: no pasa a diciembre" },
  { id: "equipo_en_utc", utc: "2026-11-12T02:30:00Z", chile: "2026-11-11", zona: "UTC", nota: "equipo configurado en UTC: igual manda la fecha de Chile" },
  { id: "equipo_en_madrid", utc: "2026-11-12T15:00:00Z", chile: "2026-11-12", zona: "Europe/Madrid", nota: "mediodía de Chile con el equipo en otra zona" },
];

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
for (const c of CASOS) {
  const datos = crearDatos(); datos.categorias_gasto.push({ id: "cat_arriendo", nombre: "Arriendo de oficina" }); // gasto corriente (la otra categoría deriva al IVA)
  const base = crearBase(datos, { mp: RESPUESTAS_MP });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: c.zona });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.clock.setFixedTime(new Date(c.utc));
  await instalarRutas(p, base, "u1");
  await p.addInitScript(() => { try { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "tu1", refresh_token: "r", user: { id: "u1", email: "u1@prueba.cl" } })); } catch {} });
  await p.goto(URL_APP, { waitUntil: "load" }); await p.waitForTimeout(2500);
  const fechaDelModal = async () => { const m = p.locator('[role="dialog"]').last(); await m.waitFor({ timeout: 4000 }); return m.locator('input[type="date"]').first().inputValue({ timeout: 3000 }); };
  const cerrar = async () => { await p.keyboard.press("Escape"); await p.waitForTimeout(350); if (await p.locator('[role="dialog"]').count()) { await p.locator('[role="dialog"] button[aria-label*="errar"]').last().click().catch(() => {}); await p.waitForTimeout(300); } };
  const leidas = {};
  for (const [clave, nombre] of [["compra", "Compra"], ["entrega", "Entrega"], ["factura", "Factura"], ["pago", "Pago"]]) {
    try {
      await p.locator("main button, button").filter({ hasText: new RegExp(`^\\d?\\s*${nombre}$`) }).first().click(); await p.waitForTimeout(500);
      leidas[clave] = await fechaDelModal();
    } catch (e) { leidas[clave] = "ERROR " + String(e.message).slice(0, 80); }
    await cerrar();
  }
  try {
    await p.evaluate(() => { location.hash = "#/gastos"; }); await p.waitForTimeout(900);
    await p.getByRole("button", { name: /Registrar gasto/ }).first().click(); await p.waitForTimeout(500);
    // La primera categoría puede ser «Impuestos» (deriva al formulario único de IVA): se elige una categoría de gasto corriente.
    const m = p.locator('[role="dialog"]').last(); await m.waitFor({ timeout: 4000 });
    if (!(await m.locator('input[type="date"]').count())) { const sel = m.locator("select").first(); const ops = await sel.locator("option").evaluateAll((o) => o.map((x) => x.value));
      for (const v of ops) { await sel.selectOption(v); await p.waitForTimeout(150); if (await m.locator('input[type="date"]').count()) break; } }
    leidas.gasto = await m.locator('input[type="date"]').first().inputValue({ timeout: 3000 }); await cerrar();
  } catch (e) { leidas.gasto = "ERROR " + String(e.message).slice(0, 80); }
  for (const [k, v] of Object.entries(leidas)) ok(`${c.id}_${k}_propone_${c.chile}`, v === c.chile, { obtuvo: v, nota: c.nota });
  ok(`${c.id}_sin_errores`, !errs.length, errs);
  await ctx.close();
}
await browser.close();
console.log(`RESUMEN fechas de formularios: ${nOk} OK · ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
