// EETT tras una nueva publicación (21/10/2026): «Failed to fetch dynamically imported module …/jspdf.es.min-*.js».
// Simula una pestaña con la versión anterior (el archivo de jsPDF ya no existe en el sitio → 404) y comprueba:
// error claro sin pérdida de datos, aviso «Actualizar BFK Datos», UNA sola recarga controlada (sin bucles) y que, con el
// archivo disponible, la vista previa y la descarga funcionan en PC y celular. Supabase simulado (nada sale a la red).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_eett_version_nueva.mjs http://127.0.0.1:4190/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "./modulo_simulado.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const COT = { id: "c-7", version: 3, id_externo: "697036-78-COT26", nombre: "Impresoras", institucion: "Municipio", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja", estado: "presentada", fecha: "2026-10-05", recargo: 0.3, plazo: "2 DIAS", actualizado_en: "2026-10-05",
  envios: [{ key: "e1", proveedor: "Falabella", monto: 5990, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "simulación" }],
  items: [{ key: "i1", producto_id: null, ficha: { nombre: "Impresora", marca: "HP", modelo: "520", especificaciones: [{ etiqueta: "Tipo", valor: "Tinta" }], imagenes: ["img/abc.jpg"] }, ficha_aprobada: true, enlace: "https://falabella.com/x", proveedor: "Falabella", cantidad: 3, precio_origen: 82865, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, disponibilidad: "En stock", origen_datos: "enlace" }] };

async function preparar({ movil }) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, usuario: "u1", ancho: movil ? 390 : 1280, alto: movil ? 844 : 900, movil, espera: 2500 });
  const M = moduloSimulado(1); M.cots.set("c-7", JSON.parse(JSON.stringify(COT)));
  await r.page.route("**/*", (route) => M.manejar(route));
  const estado = { bloquear: false, pedidos: 0, cargas: 0 };
  await r.page.route(/\/assets\/jspdf\.es\.min-[^/]+\.js$/, (route) => { estado.pedidos++; return estado.bloquear ? route.fulfill({ status: 404, body: "Not Found" }) : route.fallback(); });
  r.page.on("load", () => { estado.cargas++; });
  return { ...r, p: r.page, M, estado };
}
async function abrirCotizacion(p, movil) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
  await p.locator('[data-cotizacion="697036-78-COT26"]').click(); await espera(p, 1500);
  await tab(p, "eett");
}
const guardados = (M) => M.rpc.filter((r) => /guardar/.test(r.fn)).length;
const registros = (M) => M.rpc.filter((r) => /registrar_eett/.test(r.fn)).length;
const toast = async (p) => (await p.locator("body").innerText()).replace(/\s+/g, " ");

for (const movil of [false, true]) {
  const K = movil ? "M" : "P";
  const { p, ctx, M, estado, errs } = await preparar({ movil });
  await abrirCotizacion(p, movil);
  const antes = JSON.stringify(M.cots.get("c-7"));

  // 1. Pestaña con versión anterior: el archivo de jsPDF ya no existe.
  estado.bloquear = true;
  await H(p).locator("[data-vista-previa-eett]").click(); await espera(p, 1500);
  const t1 = await toast(p);
  ok(`${K}01_vista_previa_error_claro`, /se actualizó mientras esta pestaña estaba abierta/.test(t1) && estado.pedidos >= 1, t1.slice(0, 300));
  ok(`${K}02_aviso_actualizar_visible`, await p.locator("[data-aviso-version-nueva] [data-actualizar-version]").count() === 1);
  ok(`${K}03_vista_previa_no_guarda_ni_cambia_la_cotizacion`, guardados(M) === 0 && registros(M) === 0 && JSON.stringify(M.cots.get("c-7")) === antes);
  ok(`${K}04_sin_recarga_automatica`, estado.cargas === 0, estado.cargas);

  // 2. Descarga con el archivo faltante: aviso de falla con reintento; cotización intacta; nada registrado.
  await H(p).locator("[data-generar-eett]").click(); await espera(p, 1500);
  ok(`${K}05_descarga_falla_con_reintento_sin_perdida`, await H(p).locator('[data-aviso-linea="falla-descarga"]').count() === 1 && registros(M) === 0 && JSON.stringify(M.cots.get("c-7")) === antes);

  // 3. Actualizar: UNA recarga controlada.
  await p.locator("[data-actualizar-version]").click(); await p.waitForLoadState("load"); await espera(p, 2600);
  ok(`${K}06_una_recarga_controlada`, estado.cargas === 1 && await p.evaluate(() => !!sessionStorage.getItem("bfk_recarga_por_version")), estado.cargas);

  // 4. Si el archivo sigue faltando tras recargar: no se ofrece otra recarga (sin bucles).
  await abrirCotizacion(p, movil);
  await H(p).locator("[data-vista-previa-eett]").click(); await espera(p, 1500);
  ok(`${K}07_segundo_fallo_sin_bucle`, await p.locator("[data-aviso-version-nueva]").count() === 1 && await p.locator("[data-actualizar-version]").count() === 0 && /ya se actualizó hace pocos minutos/.test(await p.locator("[data-aviso-version-nueva]").innerText()));
  await espera(p, 2000);
  ok(`${K}08_sin_recargas_adicionales`, estado.cargas === 1, estado.cargas);
  await p.locator("[data-cerrar-aviso-version]").click(); await espera(p, 200);

  // 5. El usuario vuelve a abrir BFK Datos (el navegador recuerda el fallo de un módulo hasta recargar) y el archivo existe:
  //    vista previa y descarga funcionan.
  estado.bloquear = false;
  await p.reload({ waitUntil: "load" }); await espera(p, 2600); await abrirCotizacion(p, movil);
  await H(p).locator("[data-vista-previa-eett]").click();
  await p.locator("[data-pagina-preview]").first().waitFor({ timeout: 20000 }).catch(() => {}); await espera(p, 800);
  ok(`${K}09_vista_previa_funciona`, await p.locator("[data-pagina-preview]").count() >= 1 && await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja]').click(); await espera(p, 300);
  const [d] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]);
  const ruta = await d.path(); await espera(p, 800);
  ok(`${K}10_descarga_funciona`, !!ruta && /^EETT_697036-78-COT26_v\d+\.pdf$/.test(d.suggestedFilename()) && registros(M) === 1, d.suggestedFilename());
  ok(`${K}11_precios_y_especificaciones_intactos`, (() => { const c = M.cots.get("c-7"); return c.items[0].precio_origen === 82865 && c.items[0].cantidad === 3 && JSON.stringify(c.items[0].ficha.especificaciones) === JSON.stringify(COT.items[0].ficha.especificaciones); })());
  ok(`${K}12_sin_errores_js_de_la_app`, errs.filter((e) => !/dynamically imported module|jspdf/i.test(e)).length === 0, errs);
  await ctx.close();
}

// 6. Cambios sin guardar + archivo faltante: se avisa que NO están guardados; nada se pierde ni se recarga solo.
{
  const { p, ctx, M, estado } = await preparar({ movil: false });
  await abrirCotizacion(p, false);
  await tab(p, "datos");
  const campo = H(p).locator('[data-campo="comuna"]');
  await campo.fill("Laja (editado)"); await espera(p, 200);
  await tab(p, "eett");
  estado.bloquear = true;
  await H(p).locator("[data-vista-previa-eett]").click(); await espera(p, 1500);
  ok("S01_aviso_cambios_no_guardados", /Tus cambios aún NO están guardados/.test(await toast(p)));
  ok("S02_sin_recarga_ni_guardado_automatico", estado.cargas === 0 && guardados(M) === 0);
  await tab(p, "datos");
  ok("S03_lo_editado_sigue_en_pantalla", (await campo.inputValue()) === "Laja (editado)" && M.cots.get("c-7").comuna === "Laja");
  await ctx.close();
}

await browser.close();
console.log(`RESUMEN e2e EETT tras nueva versión: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
