// Ventas privadas y Proyectos con datos representativos (base desechable local + semilla_vp.mjs + pruebas-proyectos/semilla.sql).
// Captura listas, fichas y formularios y revisa la maquetación. Uso: PGRST_URL=… JWT_SECRET=… VP_DB_URL=… node modulos.mjs <url> <carpeta> [pc|cel|cel360]
import path from "node:path";
process.env.PI_DB_URL ||= process.env.VP_DB_URL;
const vp = await import("../pruebas-ventas-privadas/arnes_vp.mjs");
const pi = await import("../pruebas-proyectos/arnes_pi.mjs");
const { revisar, revisarVentana } = await import("./revisar.mjs");
const [url, carpeta, cual = "pc"] = process.argv.slice(2);
const [ancho, alto, movil] = cual === "pc" ? [1440, 900, false] : cual === "cel360" ? [360, 740, true] : [390, 844, true];
const browser = await vp.chromium.launch({ executablePath: vp.CHROME, args: ["--no-sandbox"] });
const problemas = []; const fallos = []; let n = 0;
async function sesion(arnes, hash, pasos) {
  const { page, errs } = await arnes.abrir(browser, { usuario: arnes.U.admin, url, hash, ancho, alto, movil, espera: 3000 });
  const ir = async (h) => { await page.evaluate((x) => { location.hash = "#/" + x; }, h); await page.waitForTimeout(1100); };
  const foto = async (nombre, { ventana = false, full = !ventana } = {}) => { await page.waitForTimeout(450); n++;
    await page.screenshot({ path: path.join(carpeta, `${cual}-${nombre}.png`), fullPage: full });
    for (const p of await revisar(page)) problemas.push(`${nombre}: ${p}`);
    if (ventana) for (const p of await revisarVentana(page)) problemas.push(`${nombre}: ${p}`); };
  const cerrar = async () => { for (let i = 0; i < 3; i++) { if (!(await page.locator("[role=dialog]").count())) break; await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
  const paso = async (nombre, f) => { try { await f(); } catch (e) { fallos.push(`${nombre}: ${e.message.split("\n")[0]}`); await cerrar().catch(() => {}); } };
  const bajar = async (nombre, veces = 3) => { const c = page.locator("[role=dialog]").last(); for (let i = 1; i <= veces; i++) { const mas = await c.evaluate((v, k) => { const el = [v, ...v.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).sort((a, b) => b.clientHeight - a.clientHeight)[0]; if (!el) return false; const antes = el.scrollTop; el.scrollTo(0, k * (el.clientHeight - 90)); return el.scrollTop > antes; }, i); if (!mas) break; await foto(`${nombre}-${i}`, { ventana: true }); } };
  await pasos({ page, ir, foto, cerrar, paso, bajar });
  if (errs.length) fallos.push("errores de página: " + [...new Set(errs)].join(" | "));
  await page.context().close();
}
await sesion(vp, "#/clientes", async ({ page, ir, foto, cerrar, paso, bajar }) => {
  await paso("vp-clientes", async () => { await foto("vp-clientes"); await page.locator("[data-cliente]").first().click(); await foto("vp-cliente-ficha", { ventana: true }); await bajar("vp-cliente-ficha", 2);
    await page.locator("[data-editar-cliente]").first().click(); await foto("vp-cliente-editar", { ventana: true }); await bajar("vp-cliente-editar", 2); await cerrar(); });
  await paso("vp-cliente-nuevo", async () => { await page.locator("[data-nuevo-cliente]").first().click(); await foto("vp-cliente-nuevo", { ventana: true }); await cerrar(); });
  await paso("vp-cotizaciones", async () => { await ir("cotizaciones-privadas"); await foto("vp-cotizaciones"); });
  await paso("vp-cot-editor", async () => { await page.locator("[data-cotizacion]").filter({ hasText: /Los Robles/ }).first().click(); await page.waitForTimeout(1500); await foto("vp-cot-datos", { ventana: true }); await bajar("vp-cot-datos", 2);
    for (const t of ["Productos", "Precios", "EETT"]) { await page.locator("[role=dialog] [role=tab]").filter({ hasText: new RegExp("^" + t) }).first().click(); await page.waitForTimeout(700); await foto("vp-cot-" + t.toLowerCase(), { ventana: true }); await bajar("vp-cot-" + t.toLowerCase(), 2); }
    await cerrar(); });
  await paso("vp-cot-nueva", async () => { await page.locator("[data-nueva-cotizacion]").first().click(); await page.waitForTimeout(1200); await foto("vp-cot-nueva", { ventana: true }); await cerrar(); });
  await paso("vp-biblioteca", async () => { await page.getByRole("tab", { name: /Biblioteca/ }).first().click(); await foto("vp-biblioteca"); });
  await paso("vp-ordenes", async () => { await ir("ordenes-venta"); await foto("vp-ordenes"); });
  await paso("vp-venta", async () => { await page.locator("[data-venta]").filter({ hasText: /Los Robles/ }).first().click(); await page.waitForTimeout(1500); await foto("vp-venta", { ventana: true }); await bajar("vp-venta", 6); });
  // Formularios de la venta: cada uno se abre desde su pestaña.
  const enTab = async (t) => { await page.locator("[role=dialog] [role=tab]").filter({ hasText: new RegExp("^" + t) }).first().click(); await page.waitForTimeout(600); };
  const form = async (nombre, sel) => paso("vp-form-" + nombre, async () => { await page.locator(sel).first().scrollIntoViewIfNeeded(); await page.locator(sel).first().click(); await page.waitForTimeout(700); await foto("vp-form-" + nombre, { ventana: true }); await bajar("vp-form-" + nombre, 2); await page.keyboard.press("Escape"); await page.waitForTimeout(400); });
  await form("oc-cliente", "[data-registrar-oc]"); await form("compra", "[data-registrar-compra]");
  await paso("vp-venta-entregas", async () => { await enTab("Entregas"); await foto("vp-venta-entregas", { ventana: true }); }); await form("entrega", "[data-registrar-entrega]");
  await paso("vp-venta-documentos", async () => { await enTab("Documentos"); await foto("vp-venta-documentos", { ventana: true }); }); await form("factura", "[data-registrar-factura]");
  await paso("vp-venta-pagos", async () => { await enTab("Pagos"); await foto("vp-venta-pagos", { ventana: true }); }); await form("pago", "[data-registrar-pago]");
  await cerrar();
  // Venta pagada (todos los estados cerrados) y venta vencida.
  await paso("vp-venta-pagada", async () => { await page.locator("[data-venta]").filter({ hasText: /Maestranza/ }).first().click(); await page.waitForTimeout(1300); await enTab("Pagos"); await foto("vp-venta-pagada", { ventana: true }); await cerrar(); });
  await paso("vp-venta-nueva", async () => { await page.locator("[data-nuevo], button:has-text('Nuevo')").first().click(); await page.getByText("Venta privada / Registrar OC").first().click(); await page.waitForTimeout(900); await foto("vp-venta-nueva", { ventana: true }); await bajar("vp-venta-nueva", 2); await cerrar(); });
  await paso("vp-inicio", async () => { await ir("panel"); await page.locator("[data-canal=vp]").first().click(); await foto("vp-inicio"); await page.locator("[data-canal=todos]").first().click(); await foto("todos-inicio");
    await ir("alertas"); await foto("todos-alertas"); await ir("agenda"); await foto("todos-agenda"); await ir("finanzas"); await page.locator("[data-canal=vp]").first().click().catch(() => {}); await foto("vp-finanzas"); });
});
await sesion(pi, "#/proyectos", async ({ page, foto, cerrar, paso, bajar }) => {
  await paso("pi-lista", async () => { await foto("pi-proyectos"); });
  await paso("pi-ficha", async () => { await page.locator("[data-proyecto]").filter({ hasText: /concentradora/ }).first().click(); await page.waitForTimeout(1500); await foto("pi-ficha", { ventana: true }); await bajar("pi-ficha", 2);
    for (const t of ["Actividades", "Entregables", "Equipo", "Documentos", "Historial"]) { await page.locator("[role=dialog] [role=tab]").filter({ hasText: new RegExp("^" + t) }).first().click(); await page.waitForTimeout(800); await foto("pi-" + t.toLowerCase(), { ventana: true }); }
    await cerrar(); });
  await paso("pi-nuevo", async () => { await page.locator("[data-nuevo-proyecto]").first().click(); await page.waitForTimeout(900); await foto("pi-nuevo", { ventana: true }); await bajar("pi-nuevo", 3); await cerrar(); });
});
await browser.close();
console.log(`${n} capturas (${cual}) · problemas de maquetación: ${problemas.length}${problemas.length ? "\n  " + problemas.join("\n  ") : ""}\npasos fallidos: ${fallos.length}${fallos.length ? "\n  " + fallos.join("\n  ") : ""}`);
