// Revisión en anchos de TABLETA (12/11/2026): navegación, tablas, formularios y ventanas de Mercado Público, Ventas privadas y
// Proyectos. Se ejecuta contra la demostración aislada (docs/demo), que reúne los tres módulos con datos ficticios en una sola
// página y no necesita arneses ni base externa. En cada paso guarda una captura y aplica las comprobaciones de revisar.mjs
// (desplazamiento horizontal, contenido cortado, botones fuera de pantalla, ventanas que sobresalen).
// Uso: CHROME=… node docs/pruebas-orden-visual/tableta.mjs http://127.0.0.1:4190/ <carpeta> [anchos, p. ej. 768x1024,1024x768]
import { chromium } from "playwright-core";
import path from "node:path";
import { revisar, revisarVentana } from "./revisar.mjs";
const [url = "http://127.0.0.1:4190/", carpeta = "/tmp/tableta", tam = "768x1024,820x1180,1024x768,1180x820"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let total = 0, totalProblemas = 0;
for (const t of tam.split(",")) {
  const [ancho, alto] = t.split("x").map(Number); const problemas = []; const fallos = []; let n = 0;
  const ctx = await browser.newContext({ viewport: { width: ancho, height: alto }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, timezoneId: "America/Santiago" });
  const page = await ctx.newPage(); page.setDefaultTimeout(8000); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.route("**/*", (r) => (new URL(r.request().url()).hostname === "127.0.0.1" ? r.continue() : r.abort()));
  await page.goto(url, { waitUntil: "load" }); await page.locator("[data-demo-espera]").waitFor({ state: "detached", timeout: 90000 }).catch(() => {}); await page.waitForTimeout(2500);
  await page.evaluate(() => document.querySelector("[data-demo-avisos]")?.remove());
  const ir = async (h) => { await page.evaluate((x) => { location.hash = "#/" + x; }, h); await page.waitForTimeout(1100); };
  const foto = async (nombre, { ventana = false } = {}) => { await page.waitForTimeout(400); n++;
    await page.screenshot({ path: path.join(carpeta, `${t}-${nombre}.png`), fullPage: !ventana });
    for (const p of await revisar(page)) problemas.push(`${nombre}: ${p}`);
    if (ventana) for (const p of await revisarVentana(page)) problemas.push(`${nombre}: ${p}`); };
  const cerrar = async () => { for (let i = 0; i < 4; i++) { if (!(await page.locator("[role=dialog]").count())) break; await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
  const paso = async (nombre, f) => { try { await f(); } catch (e) { fallos.push(`${nombre}: ${e.message.split("\n")[0]}`); } await cerrar().catch(() => {}); };
  const pestana = async (txt) => { await page.locator("[role=dialog] [role=tab]").filter({ hasText: new RegExp("^" + txt) }).first().click(); await page.waitForTimeout(700); };

  // Navegación y listas
  for (const r of ["panel", "alertas", "agenda", "compras", "cotizaciones", "clientes", "cotizaciones-privadas", "ordenes-venta", "proyectos", "finanzas", "financiamiento", "vendedores", "gastos", "impuestos", "banco", "administracion"]) await paso(r, async () => { await ir(r); await foto(r); });
  await paso("menu-nuevo", async () => { await ir("panel"); await page.locator("button", { hasText: /^\+ Nuevo/ }).first().click(); await page.waitForTimeout(400); await foto("menu-nuevo", { ventana: false }); await page.keyboard.press("Escape"); });
  await paso("menu-mas", async () => { const mas = page.locator("nav button, nav a").filter({ hasText: /^Más$/ }).first(); if (await mas.count()) { await mas.click(); await page.waitForTimeout(500); await foto("menu-mas", { ventana: (await page.locator("[role=dialog]").count()) > 0 }); } });
  // Mercado Público: formularios y ficha
  for (const [k, nombre] of [["compra", "Compra"], ["entrega", "Entrega"], ["factura", "Factura"], ["pago", "Pago"]]) await paso("mp-form-" + k, async () => { await ir("panel"); await page.locator("button").filter({ hasText: new RegExp(`^\\d?\\s*${nombre}$`) }).first().click(); await page.waitForTimeout(600); await foto("mp-form-" + k, { ventana: true }); });
  await paso("mp-gasto", async () => { await ir("gastos"); await page.getByRole("button", { name: /Registrar gasto/ }).first().click(); await page.waitForTimeout(500); await page.locator("[role=dialog] select").first().selectOption({ label: "Arriendo y oficina" }); await foto("mp-gasto", { ventana: true }); });
  await paso("mp-filtros", async () => { await ir("compras"); await page.getByRole("button", { name: /Filtros/ }).first().click(); await page.waitForTimeout(500); await foto("mp-filtros", { ventana: (await page.locator("[role=dialog]").count()) > 0 }); });
  await paso("mp-ficha", async () => { await ir("compras"); await page.locator('[data-oc="2002-102-SE26"] > div').first().click(); await page.waitForTimeout(1300); await foto("mp-ficha", { ventana: (await page.locator("[role=dialog]").count()) > 0 });
    const f = page.locator('[data-ficha-oc="2002-102-SE26"]'); const abre = f.locator("[data-indice-abrir]"); if (await abre.count()) { await abre.click(); await page.waitForTimeout(250); await foto("mp-ficha-indice", { ventana: (await page.locator("[role=dialog]").count()) > 0 }); await abre.click(); }
    for (const b of await f.locator('[data-seccion-ficha] > button[aria-expanded="false"]').all()) { await b.click().catch(() => {}); await page.waitForTimeout(120); }
    await foto("mp-ficha-abierta", { ventana: (await page.locator("[role=dialog]").count()) > 0 }); });
  await paso("mp-cot-nueva", async () => { await ir("cotizaciones"); await page.getByRole("button", { name: /Nueva cotización/ }).first().click(); await page.waitForTimeout(1200); await foto("mp-cot-nueva", { ventana: (await page.locator("[role=dialog]").count()) > 0 }); });
  // Ventas privadas
  await paso("vp-cliente", async () => { await ir("clientes"); await page.locator("[data-cliente]").first().click(); await page.waitForTimeout(700); await foto("vp-cliente-ficha", { ventana: true }); await page.locator("[data-editar-cliente]").first().click(); await page.waitForTimeout(500); await foto("vp-cliente-editar", { ventana: true }); });
  await paso("vp-cot", async () => { await ir("cotizaciones-privadas"); await page.locator("[data-cotizacion]").filter({ hasText: /Los Robles/ }).first().click(); await page.waitForTimeout(1500); await foto("vp-cot-datos", { ventana: true });
    for (const x of ["Productos", "Precios", "EETT"]) { await pestana(x); await foto("vp-cot-" + x.toLowerCase(), { ventana: true }); } });
  await paso("vp-venta", async () => { await ir("ordenes-venta"); await page.locator("[data-venta]").filter({ hasText: /Los Robles/ }).first().click(); await page.waitForTimeout(1500); await foto("vp-venta", { ventana: true });
    for (const [x, sel] of [["Entregas", "[data-registrar-entrega]"], ["Documentos", "[data-registrar-factura]"], ["Pagos", "[data-registrar-pago]"]]) { await pestana(x); await foto("vp-venta-" + x.toLowerCase(), { ventana: true });
      const b = page.locator(sel).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(700); await foto("vp-form-" + x.toLowerCase(), { ventana: true }); await page.keyboard.press("Escape"); await page.waitForTimeout(350); } } });
  // Proyectos
  await paso("pi-ficha", async () => { await ir("proyectos"); await page.locator("[data-proyecto]").filter({ hasText: /concentradora/ }).first().click(); await page.waitForTimeout(1500); await foto("pi-ficha", { ventana: true });
    for (const x of ["Actividades", "Entregables", "Equipo", "Documentos", "Historial"]) { await pestana(x); await foto("pi-" + x.toLowerCase(), { ventana: true }); } });
  await paso("pi-nuevo", async () => { await ir("proyectos"); await page.locator("[data-nuevo-proyecto]").first().click(); await page.waitForTimeout(900); await foto("pi-nuevo", { ventana: true }); });
  if (errs.length) fallos.push("errores de página: " + [...new Set(errs)].join(" | "));
  await ctx.close(); total += n; totalProblemas += problemas.length + fallos.length;
  console.log(`\n== ${t}: ${n} capturas · ${problemas.length} problema(s) de distribución · ${fallos.length} paso(s) sin completar`);
  for (const p of [...new Set(problemas)]) console.log("  · " + p); for (const f of fallos) console.log("  ! " + f);
}
await browser.close();
console.log(`\nRESUMEN tableta: ${total} capturas, ${totalProblemas} hallazgo(s)`);
