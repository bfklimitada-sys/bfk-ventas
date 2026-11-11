// Capturas de fichas, ventanas y pestañas internas. Uso: node detalle.mjs <url> <carpeta> [pc|cel]
import path from "node:path";
import { pathToFileURL } from "node:url";
const REPO = process.env.REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { crearBase, chromium, abrir } = await import(pathToFileURL(path.join(REPO, "docs/pruebas-oc/mock_estado.mjs")));
const { crearDatos, RESPUESTAS_MP } = await import(pathToFileURL(path.join(REPO, "docs/pruebas-oc/datos_oc.mjs")));
const { sembrar } = { sembrar: (d) => d };
const [url, carpeta, cual = "pc"] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const [ancho, alto, movil] = cual === "pc" ? [1440, 900, false] : [390, 844, true];
const base = crearBase(sembrar(crearDatos()), { mp: RESPUESTAS_MP });
const { page, errs } = await abrir(browser, base, { url: url + "#/panel", ancho, alto, movil, espera: 2500 });
const fallos = [];
const ir = async (h) => { await page.evaluate((x) => { location.hash = "#/" + x; }, h); await page.waitForTimeout(900); };
const foto = async (n, full = false) => { await page.waitForTimeout(500); await page.screenshot({ path: path.join(carpeta, `${cual}-${n}.png`), fullPage: full }); };
const cerrar = async () => { for (let i = 0; i < 3; i++) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); } };
const paso = async (n, f) => { try { await f(); } catch (e) { fallos.push(n + ": " + e.message.split("\n")[0]); } };
const clic = (sel) => page.locator(sel).first().click({ timeout: 4000 });

for (const [n, txt] of [["m-compra", "Compra"], ["m-entrega", "Entrega"], ["m-factura", "Factura"], ["m-pago", "Pago"], ["m-cartola", "Cartola"]]) {
  await paso(n, async () => { await ir("panel"); await page.locator(`button:has(span:text-is("${txt}"))`).first().click({ timeout: 4000 }); await foto(n); await cerrar(); });
}
await paso("m-nuevo", async () => { await ir("panel"); await clic("text=Nuevo"); await foto("m-nuevo"); await page.getByText("OC de Mercado Público").first().click(); await foto("m-nueva-oc"); await page.getByText("Ingresar manualmente").click(); await foto("m-nueva-oc-manual", true); await cerrar(); });
await paso("ficha", async () => { await ir("compras"); await clic("text=2007-107-SE26"); await page.waitForTimeout(1200); await foto("ficha-oc");
  const cuerpo = page.locator("[data-hoja-cuerpo]").first();
  for (let i = 1; i <= 4; i++) { await cuerpo.evaluate((el, k) => el.scrollTo(0, k * (el.clientHeight - 80)), i); await foto("ficha-oc-" + i); }
  await cerrar(); });
await paso("filtros", async () => { await ir("compras"); await clic("text=Filtros"); await foto("compras-filtros"); await cerrar(); });
await paso("alertas-correos", async () => { await ir("alertas"); await page.getByRole("tab", { name: /Correos/ }).click(); await foto("alertas-correos"); });
for (const t of ["Datos y respaldo", "Mercado Público", "OCs archivadas", "Correcciones"]) await paso("admin-" + t, async () => { await ir("administracion"); await page.getByRole("tab", { name: new RegExp(t) }).click({ timeout: 4000 }); await foto("admin-" + t.replace(/\s+/g, "-").toLowerCase(), true); });
await paso("fin-aportes", async () => { await ir("financiamiento"); await page.getByRole("tab", { name: /Aportes/ }).click(); await foto("fin-aportes", true); await clic("text=Registrar aporte o retiro"); await foto("m-aporte"); await cerrar(); await clic("text=Abonar a un financiador"); await foto("m-abono"); await cerrar(); await page.getByRole("tab", { name: /Deuda/ }).click(); await clic("text=Ver cartola"); await foto("fin-cartola", true); });
await paso("com", async () => { await ir("vendedores"); await clic("text=Pago a vendedor"); await foto("m-pago-vendedor"); await cerrar(); await clic("text=Vendedor Uno"); await foto("com-detalle", true); });
await paso("gasto", async () => { await ir("gastos"); await clic("text=Registrar gasto"); await foto("m-gasto"); await cerrar(); });
await paso("imp", async () => { await ir("impuestos"); await page.getByRole("tab", { name: /F29/ }).click(); await foto("imp-f29", true); await page.getByRole("tab", { name: /IVA/ }).click(); await page.getByRole("button", { name: "Registrar", exact: true }).click(); await foto("m-iva"); await cerrar(); });
await paso("banco", async () => { await ir("banco"); await page.getByRole("tab", { name: /Cartola/ }).click(); await foto("banco-cartola", true); await page.getByRole("tab", { name: /Por revisar/ }).click(); await foto("banco-revisar", true); await clic("text=Saldo BancoEstado"); await foto("m-saldo"); await cerrar(); });
await paso("cot", async () => { await ir("cotizaciones"); await clic("text=Nueva cotización"); await page.waitForTimeout(1000); await foto("cot-editor"); await cerrar(); await page.getByRole("tab", { name: /Biblioteca/ }).click(); await foto("cot-biblioteca", true); });
await paso("agenda-dia", async () => { await ir("agenda"); await page.locator("button", { hasText: /^14$/ }).first().click(); await foto("agenda-dia", true); });
if (movil) await paso("mas", async () => { await ir("panel"); await clic("[data-nav=mas]"); await foto("menu-mas"); });
await browser.close();
console.log("fallos:", fallos.length ? "\n" + fallos.join("\n") : "ninguno", "\nerrores de página:", [...new Set(errs)].join(" | ") || "ninguno");
