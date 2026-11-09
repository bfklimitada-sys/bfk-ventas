// Mercado Público SIN CAMBIOS — demostración en navegador real: el mismo recorrido de cotización de Mercado Público (simulador de
// siempre, nunca producción) en la versión PUBLICADA (main) y en la versión NUEVA de la aplicación, en escritorio y celular:
//   · pantallas de las 4 pestañas y de la vista previa de EETT → idénticas píxel a píxel (misma captura byte a byte);
//   · PDF de EETT descargado con «Generar y descargar EETT» → idéntico byte a byte (salvo la fecha de creación y el
//     identificador internos del PDF, que cambian en cada generación aunque el contenido sea el mismo).
// Casos: (A) la ficha del «Bolso Paramédico Mediano 47L» tal como está en la biblioteca (textos descriptivos sin valor y pares
// en la descripción), con sus 2 fotos e institución de nombre largo; (B) bomba + manguera con plazo de entrega largo.
// Uso: node docs/pruebas-ventas-privadas/mp_byte_a_byte.mjs <URL versión publicada> <URL versión nueva>   (CAPTURAS=carpeta)
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROME } from "./arnes_vp.mjs";
import { crearBase, abrir as abrirMP } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const [URL_PUB, URL_NUEVA] = [process.argv[2] || "http://127.0.0.1:4331/", process.argv[3] || "http://127.0.0.1:4330/"];
const CAPT = process.env.CAPTURAS || "/tmp/mp-byte-a-byte"; mkdirSync(CAPT, { recursive: true });
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 400)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const normalizar = (buf) => Buffer.from(buf).toString("latin1").replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()").replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");
const PROHIBIDAS = /\/api\/(inteligencia|interpretar)/;

const FX = JSON.parse(readFileSync(join(AQUI, "fixture_cp_2026_0001.json"), "utf8"));
const fotos = FX.item.ficha.imagenes.map((r) => "data:image/jpeg;base64," + readFileSync(join(AQUI, "fixture_cp_2026_0001", r.split("/").pop())).toString("base64"));
const LARGO = "15 días hábiles contados desde la recepción conforme de la orden de compra, sujeto a disponibilidad de stock del proveedor y despacho a la dirección indicada por el cliente en Laja";
const CASOS = {
  A: { id_externo: "1234-5-COT26", nombre: "Adquisición de bolso paramédico para el servicio de urgencia", institucion: FX.cliente.razon_social, rut: FX.cliente.rut, plazo: FX.rev.plazo_entrega, envios: [],
    items: [{ key: "a", cantidad: 2, precio_origen: 46000, precio_incluye_iva: true, con_factura: true, envio_key: null, recargo: null, proveedor: "Falabella", enlace: "https://tienda.invalid/bolso", ficha: { ...FX.item.ficha, imagenes: fotos } }] },
  B: { id_externo: "5678-9-COT26", nombre: "Adquisición de bombas", institucion: "Municipalidad de Laja", rut: "69.170.100-K", plazo: LARGO,
    envios: [{ key: "e1", proveedor: "Ferretería Sur", monto: 23800, con_factura: true, estado: "confirmado", destino: "Av. Uno 123, Laja", evidencia: "Simulación de compra" }],
    items: ["Bomba centrífuga 2 HP", "Manguera 1 pulgada"].map((n, i) => ({ key: "k" + i, cantidad: i ? 12 : 2, precio_origen: i ? 2500 : 285600, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, proveedor: "Ferretería Sur", enlace: "https://tienda.invalid/x",
      ficha: { nombre: n, marca: "Pedrollo", modelo: "CPm 680", color: "Azul", generales: [{ etiqueta: "Material", valor: "Hierro fundido" }], especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }, { etiqueta: "Caudal máximo", valor: "160 L/min" }], descripcion: "Bomba para riego.", imagenes: [] } })) },
};

// Recorrido de Mercado Público en una versión: capturas de pantalla y PDF descargado.
async function recorrido(browser, url, caso, { ancho, alto, movil }) {
  const b = crearBase(crearDatos(), {});
  const { page: p, ctx, errs } = await abrirMP(browser, b, { url, ancho, alto, movil, espera: 2500 });
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route));
  const vistas = []; p.on("request", (r) => { if (PROHIBIDAS.test(r.url())) vistas.push(r.url()); });
  const c = CASOS[caso];
  M.cots.set("c-1", { id: "c-1", version: 2, direccion_entrega: "Av. Uno 123", comuna: "Laja", estado: "borrador", fecha: "2026-11-09", recargo: 0.3, actualizado_en: "2026-11-09", vendedor_id: null, vendedor_nombre: "", ...c });
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); } else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500); await p.locator(`[data-cotizacion="${c.id_externo}"]`).click(); await espera(p, 1800);
  const H = p.locator('[data-hoja-lateral="cotizacion"]'); const capturas = {};
  for (const k of ["datos", "productos", "precios", "eett"]) { await H.locator(`[role="tab"][data-tab="${k}"]`).click(); await espera(p, 700); capturas[k] = await p.screenshot(); }
  for (const cb of await H.locator("[data-aprobar-ficha] input").all()) if (!(await cb.isChecked())) await cb.check();
  await espera(p, 500); capturas["eett-aprobada"] = await p.screenshot();
  await H.locator("[data-vista-previa-eett]").click(); const vp = p.locator('[data-hoja-lateral="vista-previa-eett"]');
  await vp.locator('[data-pagina-preview="1"]').waitFor({ timeout: 20000 }); await espera(p, 1500); capturas["vista-previa"] = await p.screenshot();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), vp.getByText("Generar y descargar", { exact: true }).click()]);
  const pdf = readFileSync(await dl.path()); const nombre = dl.suggestedFilename();
  await ctx.close();
  return { capturas, pdf, nombre, errs, vistas };
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  for (const [modo, dims] of [["escritorio", { ancho: 1440, alto: 900, movil: false }], ["celular", { ancho: 390, alto: 844, movil: true }]]) {
    for (const caso of ["A", "B"]) {
      const pub = await recorrido(browser, URL_PUB, caso, dims); const nue = await recorrido(browser, URL_NUEVA, caso, dims);
      for (const k of Object.keys(pub.capturas)) {
        const igual = Buffer.compare(pub.capturas[k], nue.capturas[k]) === 0;
        if (!igual) { writeFileSync(`${CAPT}/${modo}-${caso}-${k}-publicada.png`, pub.capturas[k]); writeFileSync(`${CAPT}/${modo}-${caso}-${k}-nueva.png`, nue.capturas[k]); }
        ok(`${modo} caso ${caso}: pantalla «${k}» de Mercado Público idéntica píxel a píxel`, igual);
      }
      writeFileSync(`${CAPT}/${modo}-${caso}-publicada-${pub.nombre}`, pub.pdf); writeFileSync(`${CAPT}/${modo}-${caso}-nueva-${nue.nombre}`, nue.pdf);
      ok(`${modo} caso ${caso}: PDF de EETT de Mercado Público idéntico byte a byte (${pub.pdf.length} bytes, ${pub.nombre})`, pub.nombre === nue.nombre && normalizar(pub.pdf) === normalizar(nue.pdf) && pub.pdf.length === nue.pdf.length, `${pub.pdf.length} vs ${nue.pdf.length}`);
      ok(`${modo} caso ${caso}: sin errores de página ni llamadas a Inteligencia Comercial en ninguna versión`, !pub.errs.length && !nue.errs.length && !pub.vistas.length && !nue.vistas.length, [...pub.errs, ...nue.errs, ...pub.vistas, ...nue.vistas].join(" | "));
    }
  }
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`RESUMEN Mercado Público sin cambios (publicada vs nueva): ${nOk} OK, ${F.length} fallas · PDF en ${CAPT}`);
process.exit(F.length ? 1 : 0);
