// Recorrido visual: abre cada pantalla en escritorio y celular con la base simulada y guarda capturas.
// Uso: node recorrido.mjs <url> <carpeta> [solo=clave,clave]
import path from "node:path";
import { pathToFileURL } from "node:url";
const REPO = process.env.REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const { crearBase, chromium, abrir } = await import(pathToFileURL(path.join(REPO, "docs/pruebas-oc/mock_estado.mjs")));
const { crearDatos, RESPUESTAS_MP } = await import(pathToFileURL(path.join(REPO, "docs/pruebas-oc/datos_oc.mjs")));
const { sembrar } = { sembrar: (d) => d };
const [url, carpeta, solo] = process.argv.slice(2);
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const RUTAS = ["panel", "alertas", "agenda", "compras", "cotizaciones", "clientes", "cotizaciones-privadas", "ordenes-venta", "proyectos", "finanzas", "financiamiento", "vendedores", "gastos", "impuestos", "banco", "administracion"];
const lista = solo ? solo.split(",") : RUTAS;
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const errores = [];
for (const [nombre, ancho, alto, movil] of [["pc", 1440, 900, false], ["cel", 390, 844, true]]) {
  const base = crearBase(sembrar(crearDatos()), { mp: RESPUESTAS_MP });
  const { page, errs } = await abrir(browser, base, { url: url + "#/panel", ancho, alto, movil, espera: 2500 });
  for (const r of lista) {
    await page.evaluate((h) => { location.hash = "#/" + h; }, r);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(carpeta, `${nombre}-${r}.png`), fullPage: true });
  }
  if (errs.length) errores.push(nombre + ": " + [...new Set(errs)].join(" | "));
  await page.context().close();
}
await browser.close();
console.log(errores.length ? "ERRORES\n" + errores.join("\n") : "sin errores de página");
