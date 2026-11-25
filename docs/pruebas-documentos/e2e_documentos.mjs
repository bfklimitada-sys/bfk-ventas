// Documentación de la oferta (25/11/2026): interfaz de punta a punta con Supabase SIMULADO (nada sale a la red).
// Texto técnico pegado en la ficha → condiciones y matriz → vista previa (páginas, navegación, zoom, avisos) → descarga sin
// emitir → emisión definitiva (idéntica a la vista previa) → historial y nueva descarga idéntica → versión nueva al cambiar
// la información → cambio después de la vista previa → sin la migración instalada. PC y celular.
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-documentos/e2e_documentos.mjs http://127.0.0.1:4190/
import { readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const SALIDA = process.env.SALIDA || mkdtempSync(join(tmpdir(), "docs-oferta-"));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const FOTO = join(AQUI, "imagenes/tv_frente.jpg");
const TEXTO_TV = ["Especificaciones", "Marca", "Samsung", "Modelo", "UN43U8000HGXPE", "Tamaño de la pantalla", "43 pulgadas", "Resolución", "4K UHD (3840 x 2160)",
  "Frecuencia de actualización: 60hz", "HDR: No", "Puertos HDMI: 3", "Precio: $199.990", "12 cuotas sin interés", "Envío gratis a todo Chile", "Vendido por Tienda Ejemplo"].join("\n");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const textoPdf = (ruta) => execFileSync("pdftotext", ["-layout", ruta, "-"]).toString().replace(/[ \t]+/g, " ");

// ── Base simulada de oferta_* con las MISMAS reglas de la migración (versión por huella de contenido, sin duplicar) ──
function ofertaSimulada({ instalada = true } = {}) {
  const S = { cond: new Map(), docs: [], rpc: [], cortar: 0 };
  S.manejar = async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (!/\/(rpc\/)?oferta_/.test(u.pathname)) return route.fallback();
    if (!instalada) return route.fulfill({ status: 404, json: { code: "PGRST205", message: "Could not find the table" } });
    const t = u.pathname.split("/").pop(); const q = u.searchParams;
    if (t === "oferta_condiciones") { const c = S.cond.get(`${q.get("canal").slice(3)}:${q.get("cotizacion_id").slice(3)}`); return route.fulfill({ json: c ? [c] : [] }); }
    if (t === "oferta_documentos") {
      if (q.get("id")) return route.fulfill({ json: S.docs.filter((d) => d.id === q.get("id").slice(3)) });
      return route.fulfill({ json: S.docs.filter((d) => d.canal === q.get("canal").slice(3) && d.cotizacion_id === q.get("cotizacion_id").slice(3)).slice().reverse() });
    }
    const b = JSON.parse(req.postData() || "{}"); S.rpc.push({ fn: t, b });
    if (t === "oferta_guardar_condiciones") { S.cond.set(`${b.p_canal}:${b.p_cotizacion}`, { condiciones: b.p_condiciones, matriz: b.p_matriz, actualizado_en: new Date().toISOString() }); return route.fulfill({ json: { actualizado_en: new Date().toISOString() } }); }
    if (t === "oferta_emitir_documento") {
      const mias = S.docs.filter((d) => d.canal === b.p_canal && d.cotizacion_id === b.p_cotizacion);
      const misma = mias.filter((d) => d.huella_contenido === b.p_huella_contenido).map((d) => d.version);
      const esperada = misma.length ? Math.max(...misma) : mias.reduce((m, d) => Math.max(m, d.version), 0) + 1;
      if (b.p_version !== esperada) return route.fulfill({ status: 409, json: { code: "40001", message: `OFERTA_VERSION: corresponde la versión ${esperada}, no la ${b.p_version}. Vuelve a generar la vista previa.` } });
      const ex = mias.find((d) => d.tipo === b.p_tipo && d.version === b.p_version);
      if (ex) return route.fulfill({ json: { id: ex.id, version: ex.version, existente: true, emitido_en: ex.emitido_en } });
      const d = { id: `doc-${S.docs.length + 1}`, canal: b.p_canal, cotizacion_id: b.p_cotizacion, tipo: b.p_tipo, version: b.p_version, modelo: b.p_modelo, generador: b.p_generador,
        huella_contenido: b.p_huella_contenido, huella_modelo: b.p_huella_modelo, huella_pdf: b.p_huella_pdf, paginas: b.p_paginas, nombre_archivo: b.p_nombre, emitido_por_nombre: "Usuario de prueba", emitido_en: new Date(Date.now() + S.docs.length * 1000).toISOString() };
      S.docs.push(d);
      if (S.cortar > 0) { S.cortar--; return route.abort("failed"); }   // se registró, pero la respuesta no llegó
      return route.fulfill({ json: { id: d.id, version: d.version, existente: false, emitido_en: d.emitido_en } });
    }
    return route.fulfill({ status: 404, json: { code: "PGRST202", message: "sin función" } });
  };
  return S;
}

async function preparar({ ancho = 1280, alto = 900, movil = false, instalada = true } = {}) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, usuario: "u1", ancho, alto, movil, espera: 2500 });
  const M = moduloSimulado(2); await r.page.route("**/*", (route) => M.manejar(route));
  const S = ofertaSimulada({ instalada }); await r.page.route("**/*", (route) => S.manejar(route));
  return { ...r, p: r.page, M, S };
}
const irCotizaciones = async (p, movil) => {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
};
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 400));
const llenar = async (loc, v) => { await loc.fill(""); await loc.fill(String(v)); };
const ficha = (p) => p.locator("[data-editor-ficha]");
const descargar = async (p, accion) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), accion()]); const ruta = join(SALIDA, d.suggestedFilename()); await d.saveAs(ruta); return { nombre: d.suggestedFilename(), ruta, bytes: readFileSync(ruta) }; };
const visor = (p) => p.locator('[data-hoja-lateral="visor-documento"]');

async function cotizacionConProductos(p, { movil = false } = {}) {
  await irCotizaciones(p, movil);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await llenar(H(p).locator("[data-entrada-compra-agil]"), "3390-246-COT26"); await H(p).locator("[data-consultar-compra-agil]").click(); await espera(p, 800);
  await p.locator("[data-aplicar-compra-agil]").click(); await espera(p, 500);
  await tab(p, "productos");
  // Producto 1: texto pegado desde la página del proveedor.
  await H(p).locator("[data-ingreso-manual]").click(); await espera(p);
  const f = ficha(p);
  await llenar(f.locator('[data-campo="nombre"]'), "Smart TV Samsung 43\" UHD 4K");
  await f.locator('[data-desplegable="procesar-texto"] button').first().click(); await espera(p, 200);
  await f.locator("[data-texto-proveedor]").fill(TEXTO_TV); await f.locator("[data-procesar-texto]").click(); await espera(p, 300);
  const res = await f.locator("[data-resultado-procesado]").innerText();
  await f.locator("[data-reemplazar-especificaciones]").click(); await espera(p, 300);
  const esp = await f.locator('[data-campo="especificaciones"]').inputValue();
  await llenar(f.locator('[data-campo="marca"]'), "Samsung"); await llenar(f.locator('[data-campo="modelo"]'), "UN43U8000HGXPE");
  await f.locator('input[type="file"]').setInputFiles(FOTO); await espera(p, 800);
  await f.locator('[data-condicion-producto="garantia"]').fill("12 meses con el fabricante");
  await llenar(f.locator('[data-campo="proveedor"]'), "Tienda Uno"); await llenar(f.locator('[data-campo="cantidad"]'), 2); await llenar(f.locator('[data-campo="precio"]'), 160000);
  await llenar(f.locator('[data-campo="monto-despacho"]'), 5000); await f.locator('[data-campo="estado-despacho"]').selectOption("confirmado"); await llenar(f.locator('[data-campo="evidencia-despacho"]'), "simulación de compra");
  const original = await f.locator("[data-texto-original-guardado]").count();
  await f.locator("[data-guardar-ficha]").click(); await espera(p, 500);
  // Producto 2: ingreso manual.
  await H(p).locator("[data-ingreso-manual]").click(); await espera(p);
  await llenar(f.locator('[data-campo="nombre"]'), "Silla ergonómica RD"); await llenar(f.locator('[data-campo="marca"]'), "RD"); await llenar(f.locator('[data-campo="modelo"]'), "PR96015");
  await llenar(f.locator('[data-campo="especificaciones"]'), "Respaldo: Reclinable, 90° a 130°\nPeso máximo soportado: 120 kg\nApoyapiés: No");
  await llenar(f.locator('[data-campo="proveedor"]'), "Tienda Dos"); await llenar(f.locator('[data-campo="cantidad"]'), 3); await llenar(f.locator('[data-campo="precio"]'), 70000);
  await llenar(f.locator('[data-campo="monto-despacho"]'), 6000); await f.locator('[data-campo="estado-despacho"]').selectOption("confirmado"); await llenar(f.locator('[data-campo="evidencia-despacho"]'), "cotización del proveedor");
  await f.locator("[data-guardar-ficha]").click(); await espera(p, 500);
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1200);
  return { res, esp, original };
}

// ═════ A. PC ═════
{
  const { p, ctx, errs, M, S } = await preparar();
  const { res, esp, original } = await cotizacionConProductos(p);
  ok("A01_texto_pegado_ordenado_por_grupos", /Pantalla e imagen/.test(res) && /Tamaño de pantalla/.test(res) && /línea.* comercial/.test(res), res);
  ok("A02_publicidad_fuera_de_la_ficha", /Tamaño de pantalla: 43 pulgadas/.test(esp) && /Frecuencia de actualización: 60 Hz/.test(esp) && /HDR: No/.test(esp) && !/Precio|cuotas|Envío|Vendido/.test(esp), esp);
  ok("A03_texto_original_conservado_en_la_ficha", original === 1);
  const cot = [...M.cots.values()][0];
  ok("A04_original_y_garantia_guardados_en_la_ficha", /Precio: \$199\.990/.test(cot?.items?.[0]?.ficha?.texto_original || "") && cot?.items?.[0]?.ficha?.condiciones_producto?.garantia === "12 meses con el fabricante", cot?.items?.[0]?.ficha);
  await tab(p, "eett");
  const sec = H(p).locator("[data-documentacion-oferta]");
  ok("A05_seccion_documentacion_con_los_tres_documentos", (await sec.locator("[data-documento-oferta]").count()) === 3 && (await sec.locator('[data-documento-oferta="oferta"]').innerText()).includes("principal"));
  ok("A06_tab_documentos", /Documentos/.test(await H(p).locator('[role="tab"][data-tab="eett"]').innerText()));
  // Condiciones (sin valores predeterminados) y matriz desde los requerimientos (todo «Por verificar»).
  ok("A07_condiciones_vacias_por_defecto", (await sec.locator('[data-condicion] input').evaluateAll((els) => els.every((e) => !e.value))));
  await sec.locator('[data-condicion="garantia"] input').fill("12 meses"); await sec.locator('[data-condicion="vigencia"] input').fill("30 días desde la emisión");
  await sec.locator("[data-proponer-matriz]").click(); await espera(p, 200);
  const estados = await sec.locator("[data-estado-requisito]").evaluateAll((els) => els.map((e) => e.value));
  ok("A08_matriz_desde_requerimientos_por_verificar", estados.length === 2 && estados.every((x) => x === "por_verificar"), estados);
  await sec.locator("[data-estado-requisito]").first().selectOption("cumple");
  await sec.locator("[data-guardar-condiciones]").click(); await espera(p, 600);
  ok("A09_condiciones_y_matriz_guardadas_por_rpc", S.rpc.some((r) => r.fn === "oferta_guardar_condiciones" && r.b.p_condiciones.garantia === "12 meses" && r.b.p_matriz.length === 2));
  // Vista previa: páginas, navegación, zoom, avisos; nada se guarda.
  const n0 = S.rpc.length; const g0 = M.rpc.length;
  await sec.locator('[data-previa-documento="oferta"]').click();
  await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 1500);
  const nPag = await visor(p).locator("[data-pagina-doc]").count();
  ok("A10_vista_previa_todas_las_paginas", nPag >= 3 && /\/ ?\d/.test(await visor(p).locator("[data-pagina-actual]").innerText()), nPag);
  const ancho0 = await visor(p).locator("[data-pagina-doc] canvas").first().evaluate((c) => c.getBoundingClientRect().width);
  await visor(p).locator('[aria-label="Ampliar"]').click(); await espera(p, 1500);
  const ancho1 = await visor(p).locator("[data-pagina-doc] canvas").first().evaluate((c) => c.getBoundingClientRect().width);
  ok("A11_zoom", ancho1 > ancho0 * 1.2 && /125%/.test(await visor(p).locator("[data-zoom-valor]").innerText()), [ancho0, ancho1]);
  await visor(p).locator('[aria-label="Página siguiente"]').click(); await espera(p, 900);
  ok("A12_navegacion_entre_paginas", /^2 ?\//.test((await visor(p).locator("[data-pagina-actual]").innerText()).trim()), await visor(p).locator("[data-pagina-actual]").innerText());
  ok("A13_avisos_antes_de_emitir", /Por verificar/.test(await visor(p).locator("[data-avisos-documento]").innerText().catch(() => "")));
  ok("A14_vista_previa_no_guarda_ni_emite", S.rpc.length === n0 && M.rpc.length === g0);
  const previa = await descargar(p, () => visor(p).locator("[data-descargar-previa]").click());
  const tPrev = textoPdf(previa.ruta);
  ok("A15_descarga_sin_emitir_marcada_en_el_nombre", previa.nombre === "OFERTA_MP_3390-246-COT26_v1_sin-emitir.pdf", previa.nombre);
  ok("A16_pdf_con_precios_del_calculo_y_sin_datos_internos", /OFERTA TÉCNICA Y ECONÓMICA/.test(tPrev) && /TOTAL OFERTA/.test(tPrev) && !/Tienda Uno|Tienda Dos|simulación|160\.000|\$199\.990|cuotas/.test(tPrev));
  ok("A17_matriz_y_garantias_en_el_pdf", /CUMPLIMIENTO TÉCNICO/.test(tPrev) && /Cumple/.test(tPrev) && /12 meses con el fabricante/.test(tPrev) && /Vigencia de la oferta/.test(tPrev));
  // Emisión definitiva = el mismo PDF de la vista previa.
  const emit = await descargar(p, () => visor(p).locator("[data-emitir-documento]").click());
  ok("A18_emision_descarga_el_documento_definitivo", emit.nombre === "OFERTA_MP_3390-246-COT26_v1.pdf", emit.nombre);
  ok("A19_documento_emitido_identico_a_la_vista_previa", sha(emit.bytes) === sha(previa.bytes));
  const rpcEmit = S.rpc.filter((r) => r.fn === "oferta_emitir_documento");
  ok("A20_registro_inalterable_con_version_y_huellas", rpcEmit.length === 1 && rpcEmit[0].b.p_version === 1 && rpcEmit[0].b.p_huella_pdf === sha(emit.bytes) && rpcEmit[0].b.p_tipo === "oferta");
  ok("A21_modelo_emitido_sin_datos_internos", !/Tienda Uno|precio_origen|costo|enlace|recargo|texto_original/i.test(JSON.stringify(rpcEmit[0].b.p_modelo)));
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 600);
  ok("A22_historial_con_la_version", /v01 emitida/.test(await sec.locator('[data-documento-oferta="oferta"]').innerText()));
  // EETT con la misma información: conserva la versión 1. Sin precios.
  await sec.locator('[data-previa-documento="eett"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 800);
  const eett = await descargar(p, () => visor(p).locator("[data-emitir-documento]").click());
  ok("A23_eett_misma_version_y_sin_montos", eett.nombre === "EETT_MP_3390-246-COT26_v1.pdf" && !/\$\s?\d|TOTAL OFERTA|IVA/.test(textoPdf(eett.ruta)), eett.nombre);
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 500);
  // Descargar de nuevo desde el historial: idéntico al emitido.
  await sec.locator('[data-desplegable="historial-oferta"] button').first().click(); await espera(p, 200);
  const otra = await descargar(p, () => sec.locator("[data-descargar-emitido]").first().click());
  ok("A24_nueva_descarga_de_version_emitida_identica", otra.nombre === "OFERTA_MP_3390-246-COT26_v1.pdf" && sha(otra.bytes) === sha(emit.bytes));
  // Cambio después de la vista previa → no se emite: se actualiza la vista previa.
  await sec.locator('[data-previa-documento="cotizacion"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 500);
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 300);
  await sec.locator('[data-condicion="forma_pago"] input').fill("30 días");
  await sec.locator('[data-previa-documento="cotizacion"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 500);
  const sub = await visor(p).innerText();
  ok("A25_informacion_distinta_recibe_version_siguiente", /versión 02/.test(sub), sub.slice(0, 200));
  const cot2 = await descargar(p, () => visor(p).locator("[data-emitir-documento]").click());
  ok("A26_cotizacion_v2", cot2.nombre === "COT_MP_3390-246-COT26_v2.pdf" && /30 días/.test(textoPdf(cot2.ruta)));
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 300);
  // Respuesta incierta: la base registró la emisión pero la respuesta se perdió → reintentar NO duplica (devuelve la existente).
  await sec.locator('[data-previa-documento="eett"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 500);
  const nDocs = S.docs.length; S.cortar = 1;
  await visor(p).locator("[data-emitir-documento]").click(); await espera(p, 2000);
  const errCorte = await visor(p).locator('[data-aviso-linea="visor-error"]').innerText().catch(() => "");
  const reint = await descargar(p, () => visor(p).locator("[data-emitir-documento]").click()); await espera(p, 600);
  ok("A26b_respuesta_perdida_reintento_sin_duplicar", !!errCorte && S.docs.length === nDocs + 1 && reint.nombre === "EETT_MP_3390-246-COT26_v2.pdf" && /ya estaba emitida/.test(await visor(p).locator('[data-aviso-linea="visor-emitido"]').innerText()), { errCorte, n: S.docs.length - nDocs });
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 300);
  // Producto modificado DESPUÉS de abrir la vista previa → la emisión se detiene y pide revisar.
  await sec.locator('[data-previa-documento="oferta"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 500);
  await p.evaluate(() => { const i = document.querySelector('[data-condicion="garantia"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "24 meses"); i.dispatchEvent(new Event("input", { bubbles: true })); });
  await espera(p, 200);
  const nEmit = S.rpc.filter((r) => r.fn === "oferta_emitir_documento").length;
  await visor(p).locator("[data-emitir-documento]").click(); await espera(p, 2500);
  ok("A27_cambio_tras_la_vista_previa_no_se_emite", S.rpc.filter((r) => r.fn === "oferta_emitir_documento").length === nEmit && /cambió desde la vista previa/.test(await sec.locator('[data-aviso-linea="oferta-error"]').innerText().catch(() => "")));
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 300);
  ok("A28_cotizacion_ni_finanzas_tocadas_por_emitir", M.rpc.filter((r) => /cz_guardar/.test(r.fn)).length >= 1 && !M.rpc.some((r) => /cz_eliminar|cz_transferir/.test(r.fn)));
  ok("A29_sin_errores", errs.length === 0, errs);
  if (process.env.CAPTURAS) await p.screenshot({ path: join(SALIDA, "pc-documentos.png"), fullPage: false });
  await ctx.close();
}

// ═════ B. Celular ═════
{
  const { p, ctx, errs } = await preparar({ ancho: 390, alto: 844, movil: true });
  await cotizacionConProductos(p, { movil: true });
  await tab(p, "eett");
  const sec = H(p).locator("[data-documentacion-oferta]");
  await sec.locator('[data-previa-documento="oferta"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 }); await espera(p, 1500);
  ok("B01_celular_vista_previa_con_navegacion_y_zoom", (await visor(p).locator("[data-navegacion-paginas]").isVisible()) && (await visor(p).locator("[data-zoom]").isVisible()) && (await visor(p).locator("[data-pagina-doc]").count()) >= 3);
  ok("B02_celular_pagina_ajustada_al_ancho", (await visor(p).locator("[data-pagina-doc] canvas").first().evaluate((c) => c.getBoundingClientRect().width)) <= 390);
  if (process.env.CAPTURAS) await p.screenshot({ path: join(SALIDA, "celular-visor.png"), fullPage: false });
  await visor(p).locator("[data-volver-editar]").click(); await espera(p, 300);
  ok("B03_celular_sin_desborde_y_sin_errores", await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1) && errs.length === 0, errs);
  await ctx.close();
}

// ═════ C. Sin la migración instalada: vista previa y descarga sí; emitir no ═════
{
  const { p, ctx, errs, S } = await preparar({ instalada: false });
  await cotizacionConProductos(p);
  await tab(p, "eett");
  const sec = H(p).locator("[data-documentacion-oferta]");
  ok("C01_aviso_de_actualizacion_pendiente", (await sec.locator('[data-aviso-linea="oferta-no-instalada"]').count()) === 1);
  const d = await descargar(p, () => sec.locator('[data-descargar-documento="cotizacion"]').click());
  ok("C02_descarga_sin_emitir_disponible", /_sin-emitir\.pdf$/.test(d.nombre));
  await sec.locator('[data-previa-documento="eett"]').click(); await visor(p).locator("[data-pagina-doc]").first().waitFor({ timeout: 30000 });
  ok("C03_sin_boton_emitir", (await visor(p).locator("[data-emitir-documento]").count()) === 0 && !S.rpc.length);
  ok("C04_sin_errores", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
console.log(`\nRESUMEN e2e_documentos: ${nOk} OK, ${F.length} FALLA(S) · archivos en ${SALIDA}`);
process.exit(F.length ? 1 : 0);
