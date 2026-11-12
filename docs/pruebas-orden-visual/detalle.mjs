// Mercado Público: ficha de OC, ventanas emergentes y pestañas internas, con revisión de maquetación (desborde horizontal,
// contenido cortado, botones fuera de pantalla). Uso: node detalle.mjs <url> <carpeta> [pc|cel|cel360]
import path from "node:path";
const { crearBase, chromium, abrir } = await import("../pruebas-oc/mock_estado.mjs");
const { crearDatos, RESPUESTAS_MP } = await import("../pruebas-oc/datos_oc.mjs");
const { revisar, revisarVentana } = await import("./revisar.mjs");
const [url, carpeta, cual = "pc"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const [ancho, alto, movil] = cual === "pc" ? [1440, 900, false] : cual === "cel360" ? [360, 740, true] : [390, 844, true];
const base = crearBase(crearDatos(), { mp: RESPUESTAS_MP });
const { page, errs } = await abrir(browser, base, { url: url + "#/panel", ancho, alto, movil, espera: 2500 });
const fallos = []; const problemas = []; let n = 0;
const ir = async (h) => { await page.evaluate((x) => { location.hash = "#/" + x; }, h); await page.waitForTimeout(900); };
const foto = async (nombre, { ventana = false, full = !ventana } = {}) => { await page.waitForTimeout(450); n++;
  await page.screenshot({ path: path.join(carpeta, `${cual}-${nombre}.png`), fullPage: full });
  for (const p of await revisar(page)) problemas.push(`${nombre}: ${p}`);
  if (ventana) for (const p of await revisarVentana(page)) problemas.push(`${nombre}: ${p}`); };
const cerrar = async () => { for (let i = 0; i < 4; i++) { if (!(await page.locator("[role=dialog]").count())) break; await page.keyboard.press("Escape"); await page.waitForTimeout(300); } };
const paso = async (nombre, f) => { try { await f(); } catch (e) { fallos.push(nombre + ": " + e.message.split("\n")[0]); await cerrar().catch(() => {}); } };
const bajar = async (nombre, veces = 8) => { const c = page.locator("[role=dialog]").last(); for (let i = 1; i <= veces; i++) { const mas = await c.evaluate((v, k) => { const el = [v, ...v.querySelectorAll("*")].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 4).sort((a, b) => b.clientHeight - a.clientHeight)[0]; if (!el) return false; const antes = el.scrollTop; el.scrollTo(0, k * (el.clientHeight - 90)); return el.scrollTop > antes; }, i); if (!mas) break; await foto(`${nombre}-${i}`, { ventana: true }); } };
const tab = (re) => page.getByRole("tab", { name: re }).first().click({ timeout: 4000 });

// Ventanas de «Registrar» (Inicio)
for (const [nombre, txt] of [["m-compra", "Compra"], ["m-entrega", "Entrega"], ["m-factura", "Factura"], ["m-pago", "Pago"], ["m-cartola", "Cartola"]])
  await paso(nombre, async () => { await ir("panel"); await page.locator(`button:has(span:text-is("${txt}"))`).first().click({ timeout: 4000 }); await foto(nombre, { ventana: true }); await bajar(nombre, 3); await cerrar(); });
await paso("m-nueva-oc", async () => { await ir("panel"); await page.locator("button:has-text('Nuevo')").first().click(); await foto("m-menu-nuevo", { full: false }); await page.getByText("OC de Mercado Público").first().click(); await foto("m-nueva-oc", { ventana: true });
  await page.getByText("Ingresar manualmente").click(); await foto("m-nueva-oc-manual", { ventana: true }); await bajar("m-nueva-oc-manual", 5); await cerrar(); });
// Ficha de OC completa (todas las secciones) para tres estados distintos
for (const [nombre, oc] of [["ficha-abono", "2007-107-SE26"], ["ficha-comprada", "2001-101-SE26"], ["ficha-cerrada", "2008-108-SE26"]])
  await paso(nombre, async () => { await ir("compras"); await page.locator(`[data-oc="${oc}"]`).first().click({ timeout: 5000 }); await page.waitForTimeout(1200); await foto(nombre, { ventana: true }); await bajar(nombre, 10); await cerrar(); });
await paso("ficha-editar", async () => { await ir("compras"); await page.locator('[data-oc="2007-107-SE26"]').first().click(); await page.waitForTimeout(1000); const ed = page.getByRole("button", { name: /Editar datos/ }).first(); if (!(await ed.isVisible().catch(() => false))) { await page.locator('[data-seccion-ficha^="info"] button').first().click(); await page.waitForTimeout(400); } await ed.click(); await foto("m-editar-oc", { ventana: true }); await bajar("m-editar-oc", 3); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.locator("[data-asignacion-editar]").first().click(); await foto("m-asignacion", { ventana: true }); await cerrar(); });
await paso("compras-filtros", async () => { await ir("compras"); await page.getByRole("button", { name: /Filtros/ }).first().click(); await foto("compras-filtros"); });
// Pestañas internas
await paso("alertas", async () => { await ir("alertas"); await foto("alertas"); await tab(/Correos/); await foto("alertas-correos"); });
for (const t of ["Datos y respaldo", "Mercado Público", "Ventas privadas", "OCs archivadas", "Correcciones"]) await paso("admin-" + t, async () => { await ir("administracion"); await tab(new RegExp(t)); await foto("admin-" + t.replace(/\s+/g, "-").toLowerCase()); });
await paso("financiamiento", async () => { await ir("financiamiento"); await foto("fin-deuda"); await page.getByText("Abonar a un financiador").first().click(); await foto("m-abono", { ventana: true }); await cerrar();
  await page.getByText("Registrar aporte o retiro").first().click(); await foto("m-aporte", { ventana: true }); await cerrar(); await tab(/Aportes/); await foto("fin-aportes"); await tab(/Deuda/); await page.getByText("Ver cartola").first().click(); await foto("fin-cartola"); });
await paso("comisiones", async () => { await ir("vendedores"); await foto("comisiones"); await page.getByText("Pago a vendedor").first().click(); await foto("m-pago-vendedor", { ventana: true }); await bajar("m-pago-vendedor", 2); await cerrar(); await page.getByText("Vendedor Uno").first().click(); await foto("comisiones-detalle"); });
await paso("gastos", async () => { await ir("gastos"); await foto("gastos"); await page.getByText("Registrar gasto").first().click(); await foto("m-gasto", { ventana: true }); await bajar("m-gasto", 2); await cerrar(); });
await paso("impuestos", async () => { await ir("impuestos"); await foto("impuestos-iva"); await page.getByRole("button", { name: "Registrar", exact: true }).first().click(); await foto("m-iva", { ventana: true }); await bajar("m-iva", 2); await cerrar(); await tab(/F29/); await foto("impuestos-f29"); });
await paso("banco", async () => { await ir("banco"); await foto("banco"); await page.getByText("Saldo BancoEstado").first().click(); await foto("m-saldo", { ventana: true }); await cerrar(); await tab(/Cartola/); await foto("banco-cartola"); await tab(/Por revisar/); await foto("banco-revisar"); });
await paso("resumen", async () => { await ir("finanzas"); await foto("finanzas-resumen"); });
await paso("cotizaciones", async () => { await ir("cotizaciones"); await page.getByText("Nueva cotización").first().click(); await page.waitForTimeout(1000); await foto("cot-nueva", { ventana: true }); await bajar("cot-nueva", 3); await cerrar(); await tab(/Biblioteca/); await foto("cot-biblioteca"); });
await paso("agenda", async () => { await ir("agenda"); await foto("agenda"); await page.locator("[data-dia][data-eventos]:not([data-eventos='0'])").first().click(); await foto("agenda-dia"); });
if (movil) await paso("mas", async () => { await ir("panel"); await page.locator("[data-nav=mas], nav button:has-text('Más')").first().click(); await foto("menu-mas", { full: false }); });
await browser.close();
console.log(`${n} capturas (${cual}) · problemas de maquetación: ${problemas.length}${problemas.length ? "\n  " + problemas.join("\n  ") : ""}\npasos fallidos: ${fallos.length}${fallos.length ? "\n  " + fallos.join("\n  ") : ""}\nerrores de página: ${[...new Set(errs)].join(" | ") || "ninguno"}`);
