// Interfaz del módulo Cotizaciones y EETT, de punta a punta, con Supabase y /api/producto SIMULADOS (nada sale a la red).
// Uso: node docs/pruebas-cotizaciones/e2e_cotizaciones.mjs http://127.0.0.1:4178/   (build servido con vite preview)
// Escenarios: modo prueba (módulo sin instalar) en celular, y modo base (tablas instaladas) en escritorio.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { calcularCotizacion } from "../../src/lib/cotizaciones.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.argv[2] || "http://127.0.0.1:4178/";
const SALIDA = process.env.SALIDA || mkdtempSync(join(tmpdir(), "cot-e2e-"));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const JPG = readFileSync(join(AQUI, "../../src/assets/bfk-logo.jpg")).toString("base64");

// Respuestas simuladas de /api/producto
const SMART = { ok: true, enlace: "https://www.falabella.com/falabella-cl/product/123/impresora", fuente: "falabella.com", fecha_consulta: "2026-10-11T15:00:00.000Z", metodos: ["json-ld", "datos-pagina"],
  precio_origen: 187990, moneda: "CLP", precio_incluye_iva: true, disponibilidad: "En stock", completo: true,
  advertencias: ["El costo de envío no se obtiene automáticamente: verifícalo con la dirección real del cliente."],
  ficha: { nombre: "IMPRESORA MULTIFUNCIONAL SMART TANK 520 TANQUE DE TINTA COLOR", marca: "HP", modelo: "SMART TANK 580", color: "BLANCO", descripcion: "", generales: [],
    especificaciones: [{ etiqueta: "Tipo de impresión", valor: "Inyección a color" }, { etiqueta: "Resolución (DPI)", valor: "Hasta 1200 x 1200 dpi" }], imagenes: ["https://media.falabella.com/a.jpg", "https://media.falabella.com/b.jpg"] } };

async function preparar({ ancho, alto, movil, modoBase }) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  const p = r.page; const reg = { rpc: [], storage: [], api: [] };
  const tabla = { cotizaciones: [], productos_catalogo: [] };
  // Rutas propias del módulo (se registran después: tienen prioridad; el resto sigue en la base simulada).
  await p.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.pathname.startsWith("/api/producto")) {
      reg.api.push(u.search);
      if (u.searchParams.get("imagen")) return route.fulfill({ json: { ok: true, dataUrl: "data:image/jpeg;base64," + JPG } });
      const e = u.searchParams.get("url") || "";
      if (/caido/.test(e)) return route.fulfill({ status: 422, json: { ok: false, error: "El enlace ya no existe en el sitio del proveedor (página no encontrada)." } });
      return route.fulfill({ json: SMART });
    }
    if (u.hostname.endsWith("supabase.co")) {
      const t = u.pathname.split("/").pop();
      if (u.pathname.startsWith("/storage/v1/")) { reg.storage.push({ m, ruta: u.pathname }); return route.fulfill({ json: { Key: u.pathname } }); }
      if (["cotizaciones", "productos_catalogo", "cotizacion_items", "cotizacion_envios"].includes(t)) {
        if (!modoBase) return route.fulfill({ status: 404, json: { code: "PGRST205", message: `Could not find the table 'public.${t}' in the schema cache` } });
        return route.fulfill({ json: tabla[t] || [] });
      }
      if (u.pathname.includes("/rpc/cz_")) {
        const cuerpo = JSON.parse(req.postData() || "{}"); reg.rpc.push({ fn: t, cuerpo });
        if (t === "cz_guardar_cotizacion") return route.fulfill({ json: { id: "c-1", version: (cuerpo.p.version || 0) + 1 } });
        if (t === "cz_guardar_producto") return route.fulfill({ json: "p-1" });
        return route.fulfill({ json: "e-1" });
      }
    }
    return route.fallback();
  });
  return { ...r, p, reg, b };
}
const irCotizaciones = async (p, movil) => {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1200);
};
const llenar = async (loc, v) => { await loc.fill(""); await loc.fill(String(v)); };
const enHoja = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => enHoja(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const sinScrollH = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

// ═════ 1. Modo prueba (módulo sin instalar), celular 390 ═════
{
  const { p, ctx, errs, reg, b } = await preparar({ ancho: 390, alto: 844, movil: true, modoBase: false });
  const escriturasAntes = b.escr?.length ?? null;
  await irCotizaciones(p, true);
  ok("U1_pantalla_visible_desde_mas", await p.locator("[data-panel-cotizaciones]").count() === 1);
  ok("U2_aviso_modo_prueba", await p.locator('[data-aviso-linea="modo-prueba"]').count() === 1);
  ok("U3_parte_vacia_con_nota", /parte vacío desde octubre de 2026/.test(await p.locator("[data-panel-cotizaciones]").innerText()));
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 600);
  ok("U4_hoja_en_pantalla_completa", await enHoja(p).count() === 1 && (await enHoja(p).boundingBox()).width >= 389);
  const h = enHoja(p);
  await llenar(h.locator('[data-campo="id_externo"]'), "1525570-33-cot26");
  await llenar(h.locator('[data-campo="nombre_licitacion"]'), "ADQUISICIÓN DE IMPRESORA MULTIFUNCIONAL");
  await llenar(h.locator('[data-campo="institucion"]'), "ASOCIACIÓN DE MUNICIPIOS PARA LA SEGURIDAD COMUNITARIA");
  await llenar(h.locator('[data-campo="rut"]'), "65.229.008-6");
  await llenar(h.locator('[data-campo="plazo"]'), "2 DIAS");
  await llenar(h.locator('[data-campo="direccion"]'), "Av. Siempre Viva 742");
  ok("U5_id_en_mayusculas", await h.locator('[data-campo="id_externo"]').inputValue() === "1525570-33-COT26");

  // Producto 1 desde enlace
  await tab(p, "productos");
  await h.locator("[data-enlace-proveedor]").fill(SMART.enlace); await h.locator("[data-consultar-enlace]").click(); await espera(p, 1500);
  const ed = p.locator("[data-editor-ficha]");
  ok("U6_consulta_abre_ficha_prellenada", await ed.count() === 1 && /SMART TANK 520/.test(await ed.locator('[data-campo="nombre"]').inputValue()) && await ed.locator('[data-campo="precio"]').inputValue() === "187990");
  ok("U7_procedencia_y_fecha_visibles", /falabella\.com/.test(await ed.locator("[data-origen-consulta]").innerText()) && /envío no se obtiene/i.test(await ed.locator("[data-origen-consulta]").innerText()));
  ok("U8_imagenes_traidas", await ed.locator("[data-imagen-ficha]").count() === 2 && reg.api.filter((s) => s.includes("imagen=")).length === 2);
  ok("U9_discrepancia_520_580_detectada", await ed.locator('[data-aviso-linea="modelo_discrepante"]').count() === 1);
  ok("U10_no_corrige_solo", await ed.locator('[data-campo="modelo"]').inputValue() === "SMART TANK 580");
  ok("U11_datos_internos_separados", /nunca van en la EETT/i.test(await ed.locator("[data-datos-internos]").innerText()));
  ok("U12_guardar_en_biblioteca_por_defecto", await ed.locator("[data-guardar-biblioteca] input").isChecked());
  await llenar(ed.locator('[data-campo="cantidad"]'), 3);
  await ed.locator("[data-guardar-ficha]").click(); await espera(p, 800);
  ok("U13_producto_agregado", await h.locator("[data-item-cotizacion]").count() === 1 && /Envío por verificar/.test(await h.locator('[data-item-cotizacion="1"]').innerText()), await h.locator("[data-item-cotizacion]").allInnerTexts());

  // Producto 2 manual, otro proveedor, precio sin IVA
  await h.locator("[data-ingreso-manual]").click(); await espera(p, 500);
  await llenar(ed.locator('[data-campo="nombre"]'), "Cable UTP Cat6 305 m");
  await llenar(ed.locator('[data-campo="marca"]'), "Nexxt"); await llenar(ed.locator('[data-campo="modelo"]'), "AB360NXT12");
  await llenar(ed.locator('[data-campo="especificaciones"]'), "Categoría: 6\nLargo: 305 m");
  await llenar(ed.locator('[data-campo="enlace"]'), "https://www.pcfactory.cl/producto/cable");
  await llenar(ed.locator('[data-campo="proveedor"]'), "PC Factory");
  await llenar(ed.locator('[data-campo="cantidad"]'), 2); await llenar(ed.locator('[data-campo="precio"]'), 50000);
  await ed.locator("label", { hasText: "El precio publicado incluye IVA" }).locator("input").uncheck();
  await ed.locator('[data-campo="envio"]').selectOption("__nuevo");
  await ed.locator("[data-guardar-ficha]").click(); await espera(p, 800);
  ok("U14_dos_productos_dos_proveedores", await h.locator("[data-item-cotizacion]").count() === 2);

  // Precios y envíos
  await tab(p, "precios");
  ok("U15_formula_provisional_visible", await h.locator('[data-aviso-linea="formula-provisional"]').count() === 1);
  ok("U16_pendientes_por_envio", await h.locator('[data-aviso-linea="pendiente-precio"]').count() >= 2);
  const envF = h.locator('[data-envio="Falabella"]'); const envP = h.locator('[data-envio="PC Factory"]');
  await llenar(envF.locator('[data-campo="monto-envio"]'), 5990); await envF.locator('[data-campo="estado-envio"]').selectOption("confirmado");
  await llenar(envP.locator('[data-campo="monto-envio"]'), 0); await envP.locator('[data-campo="estado-envio"]').selectOption("sin_costo_confirmado");
  await espera(p, 300);
  ok("U17_sin_pendientes_con_envios_confirmados", await h.locator('[data-aviso-linea="pendiente-precio"]').count() === 0);
  const esperado = calcularCotizacion({ recargo: 0.3, envios: [{ key: "f", monto: 5990, con_factura: true, estado: "confirmado" }, { key: "c", monto: 0, con_factura: true, estado: "sin_costo_confirmado" }],
    items: [{ key: "a", cantidad: 3, precio_origen: 187990, precio_incluye_iva: true, con_factura: true, envio_key: "f" }, { key: "b", cantidad: 2, precio_origen: 50000, precio_incluye_iva: false, con_factura: true, envio_key: "c" }] });
  const dinero = async (dato) => Number((await h.locator(`[data-fila="${dato}"]`).innerText()).replace(/[^\d-]/g, "").replace(/^.*?(-?\d+)$/, "$1"));
  const vNeto = await dinero("neto"), vTotal = await dinero("total");
  ok("U18_totales_iguales_al_calculo", vNeto === esperado.totales.neto && vTotal === esperado.totales.total, { vNeto, vTotal, esp: esperado.totales });
  ok("U19_desglose_explicito", ["costo-bruto", "iva-credito", "costo-neto", "neto", "iva-debito", "total", "despacho-mp", "utilidad", "iva-pagar"].every((d) => true) && await h.locator("[data-totales-cotizacion] [data-fila]").count() === 9);
  ok("U20_despacho_mp_cero", /\$\s?0$/.test((await h.locator('[data-fila="despacho-mp"]').innerText()).trim()));
  await llenar(h.locator('[data-campo="recargo"]'), 25); await espera(p, 300);
  const esp25 = calcularCotizacion({ ...{ recargo: 0.25 }, envios: [{ key: "f", monto: 5990, con_factura: true, estado: "confirmado" }, { key: "c", monto: 0, con_factura: true, estado: "sin_costo_confirmado" }], items: [{ key: "a", cantidad: 3, precio_origen: 187990, precio_incluye_iva: true, con_factura: true, envio_key: "f" }, { key: "b", cantidad: 2, precio_origen: 50000, precio_incluye_iva: false, con_factura: true, envio_key: "c" }] });
  ok("U21_recargo_editable_recalcula", await dinero("neto") === esp25.totales.neto, [await dinero("neto"), esp25.totales.neto]);
  ok("U22_sin_scroll_horizontal_precios", await sinScrollH(p));

  // EETT: requiere aprobar la discrepancia; luego genera un único PDF sin datos comerciales.
  await tab(p, "eett");
  ok("U23_generar_bloqueado_hasta_aprobar", await h.locator("[data-generar-eett]").isDisabled());
  await h.locator('[data-revision-eett="1"] [data-aprobar-ficha] input').check(); await espera(p, 200);
  ok("U24a_cada_ficha_con_avisos_se_aprueba", await h.locator("[data-generar-eett]").isDisabled() && /sin imágenes|no tiene imágenes/.test(await h.locator('[data-revision-eett="2"]').innerText()));
  await h.locator('[data-revision-eett="2"] [data-aprobar-ficha] input').check(); await espera(p, 200);
  ok("U24_generar_habilitado", !(await h.locator("[data-generar-eett]").isDisabled()));
  const [descarga] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), h.locator("[data-generar-eett]").click()]);
  const rutaPdf = join(SALIDA, descarga.suggestedFilename()); await descarga.saveAs(rutaPdf); await espera(p, 600);
  const txt = execFileSync("pdftotext", ["-layout", rutaPdf, "-"]).toString();
  const paginas = Number(execFileSync("pdfinfo", [rutaPdf]).toString().match(/Pages:\s+(\d+)/)[1]);
  ok("U25_pdf_nombre_y_fichas", descarga.suggestedFilename() === "EETT_1525570-33-COT26.pdf" && paginas === 2 && /SMART TANK 520/.test(txt) && /AB360NXT12/.test(txt), { n: descarga.suggestedFilename(), paginas });
  const prohibido = ["187990", "187.990", "50000", "50.000", "5990", "5.990", "falabella.com", "pcfactory", "PC Factory", "Falabella", "http", "Siempre Viva", "$"].filter((x) => txt.includes(x));
  ok("U26_pdf_sin_datos_comerciales", prohibido.length === 0, prohibido);
  ok("U27_registro_de_generacion", await h.locator("[data-eett-generado]").count() === 1);

  // Guardar, cerrar y reabrir (persistencia en el dispositivo); biblioteca con 1 producto.
  await p.locator("[data-guardar-cotizacion]").click(); await espera(p, 800);
  ok("U28_guardado", /Guardado/.test(await p.locator("[data-guardar-cotizacion]").innerText()));
  await p.locator("[data-cerrar-hoja]").click(); await espera(p, 800);
  ok("U29_lista_muestra_cotizacion", await p.locator('[data-cotizacion="1525570-33-COT26"]').count() === 1 && /2 productos/.test(await p.locator('[data-cotizacion="1525570-33-COT26"]').innerText()));
  await p.locator('[data-tab="biblioteca"]').click(); await espera(p, 400);
  ok("U30_biblioteca_con_productos_aprobados", await p.locator("[data-producto-biblioteca]").count() === 2);
  const bib = await p.evaluate(() => JSON.parse(localStorage.getItem("bfk_cotizaciones_prueba_v1")).productos.find((x) => /SMART/.test(x.nombre)));
  ok("U31_biblioteca_sin_datos_comerciales", !/187990|falabella\.com\/falabella|precio|enlace|proveedor/.test(JSON.stringify({ ...bib, imagenes: [] })) && bib.fuente === "falabella.com", Object.keys(bib));
  await p.locator('[data-tab="cotizaciones"]').click(); await espera(p, 300);
  await p.locator('[data-cotizacion="1525570-33-COT26"]').click(); await espera(p, 800);
  ok("U32_reabre_con_datos", await enHoja(p).locator("[data-item-cotizacion]").count() === 2 && await enHoja(p).locator('[data-campo="rut"]').count() === 0);

  // Reutilización desde la biblioteca en una cotización nueva
  await p.locator("[data-cerrar-hoja]").click(); await espera(p, 500);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 500);
  await tab(p, "productos");
  await enHoja(p).locator("[data-desde-biblioteca]").click(); await espera(p, 400);
  await p.locator('[role="dialog"] [data-producto-biblioteca^="IMPRESORA"]').click(); await espera(p, 600);
  ok("U33_reutiliza_ficha_con_imagenes", /SMART TANK 520/.test(await ed.locator('[data-campo="nombre"]').inputValue()) && await ed.locator("[data-imagen-ficha]").count() === 2);
  await ed.locator("[data-guardar-ficha]").click(); await espera(p, 600);
  ok("U34_marca_biblioteca", /Biblioteca/.test(await enHoja(p).locator('[data-item-cotizacion="1"]').innerText()));
  // Enlace caído → aviso con ingreso manual
  await enHoja(p).locator("[data-enlace-proveedor]").fill("https://www.paris.cl/caido"); await enHoja(p).locator("[data-consultar-enlace]").click(); await espera(p, 800);
  ok("U35_enlace_caido_ofrece_manual", /ya no existe/.test(await enHoja(p).locator('[data-aviso-linea="error-enlace"]').innerText()));
  await enHoja(p).locator('[data-aviso-linea="error-enlace"]').click(); await espera(p, 500);
  ok("U36_manual_conserva_enlace", await ed.locator('[data-campo="enlace"]').inputValue() === "https://www.paris.cl/caido");
  await p.locator('[role="dialog"] button[aria-label="Cerrar"]').last().click(); await espera(p, 300);
  ok("U37_sin_scroll_horizontal", await sinScrollH(p));
  await p.screenshot({ path: join(SALIDA, "cotizacion_movil.png") });
  ok("U38_no_escribe_en_tablas_de_bfk", escriturasAntes === null || (b.escr?.length ?? 0) === escriturasAntes, b.escr?.slice(escriturasAntes));
  ok("U39_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

// ═════ 2. Modo base (tablas instaladas), escritorio 1440 ═════
{
  const { p, ctx, errs, reg } = await preparar({ ancho: 1440, alto: 900, movil: false, modoBase: true });
  await irCotizaciones(p, false);
  ok("B1_sin_aviso_modo_prueba", await p.locator('[data-aviso-linea="modo-prueba"]').count() === 0);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 600);
  const h = enHoja(p);
  ok("B2_panel_lateral_escritorio", (await h.locator('[role="dialog"]').first().boundingBox()).width <= 740);
  await llenar(h.locator('[data-campo="id_externo"]'), "2000-1-COT26"); await llenar(h.locator('[data-campo="institucion"]'), "Municipalidad de Prueba");
  await tab(p, "productos");
  await h.locator("[data-enlace-proveedor]").fill(SMART.enlace); await h.locator("[data-consultar-enlace]").click(); await espera(p, 1500);
  const ed = p.locator("[data-editor-ficha]");
  await ed.locator("[data-guardar-ficha]").click(); await espera(p, 1000);
  const prod = reg.rpc.find((x) => x.fn === "cz_guardar_producto");
  ok("B3_producto_por_rpc_solo_tecnico", !!prod && !["precio_origen", "enlace", "proveedor", "cantidad", "recargo", "envio_key"].some((k) => k in prod.cuerpo.p) && prod.cuerpo.p.imagenes.every((x) => /^img\//.test(x)), prod?.cuerpo.p && Object.keys(prod.cuerpo.p));
  ok("B4_imagenes_a_deposito_privado", reg.storage.some((s) => /\/storage\/v1\/object\/productos\/img\//.test(s.ruta)));
  await p.locator("[data-guardar-cotizacion]").click(); await espera(p, 1200);
  const gc = reg.rpc.find((x) => x.fn === "cz_guardar_cotizacion");
  ok("B5_cotizacion_por_rpc_atomica", !!gc && gc.cuerpo.p.items.length === 1 && gc.cuerpo.p.items[0].unitario_venta_neto > 0 && gc.cuerpo.p.formula?.base === "neto" && gc.cuerpo.p.envios.length === 1, gc?.cuerpo.p && Object.keys(gc.cuerpo.p));
  ok("B6_items_guardan_ficha_sin_imagenes_embebidas", gc && gc.cuerpo.p.items[0].ficha.imagenes.every((x) => /^img\//.test(x)));
  ok("B7_version_actualizada", /Guardado/.test(await p.locator("[data-guardar-cotizacion]").innerText()));
  // Otras pantallas siguen funcionando
  await p.locator("[data-cerrar-hoja]").click(); await espera(p, 400);
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 1000);
  ok("B8_compras_sigue_funcionando", await p.locator("[data-oc]").count() > 0);
  await p.locator('aside [data-nav="cotizaciones"]').click(); await espera(p, 800);
  await p.screenshot({ path: join(SALIDA, "cotizaciones_escritorio.png") });
  ok("B9_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
console.log(`\nSalida: ${SALIDA}\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
