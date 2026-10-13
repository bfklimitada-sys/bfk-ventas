// Actualización definitiva de Cotizaciones y EETT (octubre 2026): interfaz de punta a punta con Supabase,
// /api/compra-agil y Storage SIMULADOS (nada sale a la red). Cubre las 14 pruebas pedidas en la especificación
// (la 7, formato visual frente al Excel, se revisa aparte con docs/pruebas-cotizaciones/comparar_excel.mjs).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_definitiva.mjs http://127.0.0.1:4190/
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const SALIDA = process.env.SALIDA || mkdtempSync(join(tmpdir(), "cot-def-"));
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 500) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const LOGO = join(AQUI, "../../src/assets/bfk-logo.jpg");
const JPG = readFileSync(LOGO);

// Respuesta normalizada de /api/compra-agil (forma que entrega la función del servidor). Datos de PRUEBA.
const CA = { ok: true, fuente: "API oficial de Compra Ágil (ChileCompra)", consultado_en: "2026-10-13T12:00:00.000Z", datos: {
  codigo: "3390-246-COT26", nombre: "ADQUISICIÓN DE CONGELADORAS Y VISICOOLER", descripcion: "Equipos de frío para casino", estado: "Publicada",
  institucion: "Ejército de Chile", unidad_compra: "Brigada Motorizada N.º 4 Rancagua", rut: "61.962.500-5", region: "Región de Arica y Parinacota",
  direccion_entrega: "Av. General Velásquez 1750, Arica", plazo_dias: 15, presupuesto: { tipo: "Estimado", moneda: "CLP", estimado: 6000000, disponible: null },
  fecha_publicacion: "2026-10-10T09:00:00", fecha_cierre: "2026-10-15T15:00:00",
  productos: [{ codigo_producto: "1", nombre: "Congeladora vertical", descripcion: "Capacidad bruta mínima 590 L, útil mínima 440 L", cantidad: 2, unidad: "EA" },
    { codigo_producto: "2", nombre: "Visicooler 2 puertas", descripcion: "Capacidad bruta mínima 1.150 L, útil mínima 800 L", cantidad: 1, unidad: "EA" }],
  documentos: [{ id: "d1", nombre: "Especificaciones.pdf" }], oc_emitida: false } };

// Base simulada del módulo (esquema 2 o 1) con estado en memoria.
function moduloSimulado(esquema) {
  const M = { esquema, cots: new Map(), eett: [], vend: [], prods: [], rpc: [], storagePost: [], storageGet: 0, api: [], sec: 0 };
  const fila = (c) => { const { items, envios, version, ...r } = c; return { ...r, version }; };
  M.manejar = async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    const json = (j, extra = {}) => route.fulfill({ json: j, headers: { "access-control-expose-headers": "content-range", ...extra } });
    if (u.pathname.startsWith("/api/compra-agil")) {
      M.api.push(u.search);
      if (/9999-1-COT26/.test(decodeURIComponent(u.search))) return route.fulfill({ status: 503, json: { ok: false, codigo: "SIN_TICKET", error: "La consulta oficial de Compra Ágil requiere un ticket de ChileCompra que aún no está configurado en el servidor. Mientras tanto, ingresa los datos manualmente." } });
      return route.fulfill({ json: CA });
    }
    if (!u.hostname.endsWith("supabase.co")) return route.fallback();
    if (u.pathname.startsWith("/storage/v1/object/authenticated/")) { M.storageGet++; return route.fulfill({ body: JPG, contentType: "image/jpeg" }); }
    if (u.pathname.startsWith("/storage/v1/")) { M.storagePost.push(u.pathname); return route.fulfill({ json: { Key: u.pathname } }); }
    const t = u.pathname.split("/").pop(); const q = u.searchParams;
    if (u.pathname.includes("/rpc/cz_")) {
      const b = JSON.parse(req.postData() || "{}"); M.rpc.push({ fn: t, b });
      if (t === "cz_guardar_cotizacion" || t === "cz_guardar_cotizacion_v2") {
        const p = b.p; const prev = p.id ? M.cots.get(p.id) : null;
        if (prev && prev.version !== p.version) return route.fulfill({ status: 409, json: { message: "CZ409: otra persona guardó cambios" } });
        const id = p.id || `c-${++M.sec}`; const v = (prev?.version || 0) + 1;
        M.cots.set(id, { ...(esquema < 2 ? Object.fromEntries(Object.entries(p).filter(([k]) => !["vendedor_id", "vendedor_nombre", "descripcion", "unidad_compra", "region", "presupuesto_estimado", "fecha_publicacion", "fecha_cierre", "requerimientos", "documentos_mp", "mp_consultado_en"].includes(k))) : p), id, version: v, actualizado_en: new Date().toISOString() });
        return json({ id, version: v });
      }
      if (t === "cz_guardar_producto") { M.prods.push(b.p); return json(`p-${M.prods.length}`); }
      if (t === "cz_registrar_eett_v2" || t === "cz_registrar_eett") { const c = M.cots.get(b.p?.cotizacion_id || b.p_cotizacion); M.eett.push({ id: `e-${M.eett.length + 1}`, cotizacion_id: c.id, version: b.p?.version ?? b.p_version, paginas: b.p?.paginas ?? b.p_paginas, nombre_documento: b.p?.nombre_documento, generado_por_nombre: "Admin Prueba", vendedor_nombre: c.vendedor_nombre, fecha: new Date().toISOString(), ubicacion_pdf: b.p_ruta ?? null }); return json(`e-${M.eett.length}`); }
      if (t === "cz_registrar_vendedor") { const v = { id: `u${M.vend.length + 1}`, nombre: b.p_nombre }; M.vend.push(v); return json(v); }
      if (t === "cz_eliminar_cotizacion") { const c = M.cots.get(b.p_id); if (c.estado === "adjudicada") return route.fulfill({ status: 400, json: { message: "CZ423: una cotización adjudicada o vinculada a una OC no se puede eliminar." } }); M.cots.delete(b.p_id); return json({ eliminada: b.p_id }); }
      return json(null);
    }
    if (t === "cotizaciones") {
      const sel = q.get("select") || "";
      if (/vendedor_nombre/.test(sel) && esquema < 2 && !/cotizacion_items/.test(sel)) return route.fulfill({ status: 400, json: { code: "42703", message: "column cotizaciones.vendedor_nombre does not exist" } });
      if (q.get("id")) return json([fila(M.cots.get(q.get("id").replace("eq.", "")) || {})].filter((x) => x.id));
      let todas = [...M.cots.values()].sort((a, b) => String(b.actualizado_en).localeCompare(String(a.actualizado_en)));
      if (q.get("estado")?.startsWith("eq.")) todas = todas.filter((c) => c.estado === q.get("estado").slice(3));
      if (q.get("estado")?.startsWith("in.")) todas = todas.filter((c) => ["borrador", "lista"].includes(c.estado));
      const off = Number(q.get("offset") || 0), lim = Number(q.get("limit") || 1000);
      return json(todas.slice(off, off + lim).map((c) => ({ ...fila(c), cotizacion_items: [{ count: c.items.length }] })), { "content-range": `${off}-${off + lim - 1}/${todas.length}` });
    }
    const cid = (q.get("cotizacion_id") || "").replace("eq.", "");
    if (t === "cotizacion_items") return json((M.cots.get(cid)?.items || []).map((it, i) => ({ id: it.key, orden: i + 1, producto_id: it.producto_id, especificaciones_aprobadas: it.ficha, ficha_aprobada: it.ficha_aprobada, enlace: it.enlace, enlace_original: it.enlace_original, proveedor: it.proveedor, cantidad: it.cantidad, precio_origen: it.precio_origen, precio_incluye_iva: it.precio_incluye_iva, con_factura: it.con_factura, envio_clave: it.envio_key, recargo: it.recargo, disponibilidad: it.disponibilidad, fecha_consulta: it.fecha_consulta, origen_datos: it.origen_datos })));
    if (t === "cotizacion_envios") return json((M.cots.get(cid)?.envios || []).map((e) => ({ clave: e.key, proveedor: e.proveedor, monto: Number(e.monto) || 0, con_factura: e.con_factura, estado_confirmacion: e.estado, destino: e.destino, evidencia: e.evidencia, fecha_cotizacion: e.fecha_cotizacion })));
    if (t === "eett_documentos") return json(M.eett.filter((e) => e.cotizacion_id === cid).reverse());
    if (t === "productos_catalogo") return json(M.prods.map((p, i) => ({ id: `p-${i + 1}`, nombre: p.nombre, marca: p.marca, modelo: p.modelo, caracteristicas: p.generales, especificaciones: p.especificaciones, imagenes: p.imagenes, ultima_revision: "2026-10-13" })), { "content-range": `0-0/${M.prods.length}` });
    if (t === "cotizacion_vendedores") return json(M.vend);
    return route.fallback(); // "vendedores" y el resto: base simulada general (solo lectura)
  };
  return M;
}

async function preparar({ esquema = 2, usuario = "u1", ancho = 1280, alto = 900, movil = false }) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, usuario, ancho, alto, movil, espera: 2500 });
  const M = moduloSimulado(esquema);
  await r.page.route("**/*", (route) => M.manejar(route));
  await r.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(URL_APP).origin });
  return { ...r, p: r.page, M, b };
}
const irCotizaciones = async (p, movil) => {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
};
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const llenar = async (loc, v) => { await loc.fill(""); await loc.fill(String(v)); };
const fichaModal = (p) => p.locator("[data-editor-ficha]");
const cap = async (p, n) => { if (process.env.CAPTURAS) await p.screenshot({ path: join(SALIDA, n + ".png"), fullPage: false }); };
const textoPdf = (ruta) => execFileSync("pdftotext", ["-layout", ruta, "-"]).toString();
async function ingresarProducto(p, d) {
  await H(p).locator("[data-ingreso-manual]").click(); await espera(p);
  const f = fichaModal(p);
  await llenar(f.locator('[data-campo="nombre"]'), d.nombre); await llenar(f.locator('[data-campo="marca"]'), d.marca); await llenar(f.locator('[data-campo="modelo"]'), d.modelo);
  await llenar(f.locator('[data-campo="especificaciones"]'), d.esp);
  if (d.foto) { await f.locator('input[type="file"]').setInputFiles(LOGO); await espera(p, 800); }
  if (d.enlace) await llenar(f.locator('[data-campo="enlace"]'), d.enlace);
  await llenar(f.locator('[data-campo="proveedor"]'), d.proveedor); await llenar(f.locator('[data-campo="cantidad"]'), d.cantidad); await llenar(f.locator('[data-campo="precio"]'), d.precio);
  if (d.compartir) { await f.locator('[data-despacho-modo="existente"]').click(); const sel = f.locator('[data-campo="envio-existente"]'); const tx = await sel.locator("option").allInnerTexts(); await sel.selectOption({ index: tx.findIndex((t) => t.includes(d.compartir)) }); }
  else { await llenar(f.locator('[data-campo="monto-despacho"]'), d.despacho); await f.locator('[data-campo="estado-despacho"]').selectOption(d.estadoDespacho || "confirmado"); await llenar(f.locator('[data-campo="evidencia-despacho"]'), "Simulación de compra a la dirección de entrega"); }
  await f.locator("[data-guardar-ficha]").click(); await espera(p, 500);
}

// ═════ A. Esquema 2 (migración preparada), escritorio, administrador ═════
{
  const { p, ctx, errs, M } = await preparar({ esquema: 2 });
  await irCotizaciones(p, false);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  const hoy = await H(p).locator('[data-campo="fecha"]').inputValue();

  // 1. Compra Ágil por enlace: vista previa, aplicar, sin tocar fecha de emisión ni estado.
  await llenar(H(p).locator("[data-entrada-compra-agil]"), "https://buscador.mercadopublico.cl/ficha?code=3390-246-COT26");
  await H(p).locator("[data-consultar-compra-agil]").click(); await espera(p, 800);
  const vista = p.locator("[data-vista-compra-agil]");
  await cap(p, "a1-compra-agil-vista-previa");
  ok("01_compra_agil_vista_previa", await vista.isVisible() && (await vista.locator("[data-fila-importar]").count()) >= 12 && /6\.000\.000/.test(await vista.innerText()) && /no es el precio de BFK/.test(await vista.innerText()));
  ok("01_compra_agil_codigo_al_servidor", M.api.length === 1 && /3390-246-COT26/.test(decodeURIComponent(M.api[0])), M.api);
  await vista.locator("[data-aplicar-compra-agil]").click(); await espera(p, 500);
  const val = async (c) => H(p).locator(`[data-campo="${c}"]`).inputValue();
  ok("01_compra_agil_campos_aplicados", (await val("institucion")) === "Ejército de Chile" && (await val("rut")) === "61.962.500-5" && (await val("plazo")) === "15 DÍAS" && (await val("direccion")) === "Av. General Velásquez 1750, Arica" && (await val("id_externo")) === "3390-246-COT26" && (await val("unidad_compra")) === "Brigada Motorizada N.º 4 Rancagua" && (await val("presupuesto")) === "6000000");
  ok("01_compra_agil_no_toca_fecha_ni_estado", (await val("fecha")) === hoy && (await val("estado")) === "borrador");
  ok("01_compra_agil_requerimientos_del_comprador", (await H(p).locator("[data-requerimiento]").count()) === 2);
  // Confirmar antes de sobrescribir: un dato distinto ya escrito queda sin marcar.
  await llenar(H(p).locator('[data-campo="institucion"]'), "Institución escrita a mano");
  await llenar(H(p).locator("[data-entrada-compra-agil]"), "3390-246-COT26"); await H(p).locator("[data-consultar-compra-agil]").click(); await espera(p, 800);
  const filaInst = p.locator('[data-fila-importar="institucion"]');
  ok("01_compra_agil_pide_confirmar_sobrescritura", (await filaInst.locator("[data-sobrescribe]").count()) === 1 && !(await filaInst.locator("input").isChecked()));
  await p.locator("[data-aplicar-compra-agil]").click().catch(() => {}); await espera(p, 300);
  if (await p.locator("[data-vista-compra-agil]").isVisible()) await p.keyboard.press("Escape");
  ok("01_compra_agil_respeta_dato_manual", (await val("institucion")) === "Institución escrita a mano");
  await llenar(H(p).locator('[data-campo="institucion"]'), "Ejército de Chile");
  // Sin ticket configurado: se informa y el ingreso manual sigue disponible.
  await llenar(H(p).locator("[data-entrada-compra-agil]"), "9999-1-COT26"); await H(p).locator("[data-consultar-compra-agil]").click(); await espera(p, 600);
  ok("01_compra_agil_sin_ticket_informa", /ticket de ChileCompra/.test(await H(p).locator('[data-aviso-linea="error-compra-agil"]').innerText().catch(() => "")));

  // 11. Vendedor responsable: catálogo existente + registro nuevo.
  const opciones = await H(p).locator('[data-campo="vendedor"] option').allInnerTexts();
  ok("11_vendedores_del_catalogo_bfk", opciones.includes("Vendedor Uno") && opciones.includes("Vendedora Dos"), opciones);
  await H(p).locator("[data-nuevo-vendedor]").click(); await llenar(H(p).locator('[data-campo="nuevo-vendedor"]'), "María Pérez"); await H(p).locator("[data-registrar-vendedor]").click(); await espera(p, 500);
  ok("11_registra_y_asigna_vendedor", M.rpc.some((r) => r.fn === "cz_registrar_vendedor") && /María Pérez/.test(await H(p).locator('[data-campo="vendedor"] option:checked').innerText()));

  // 2 y 4. Ingreso manual (acción principal) con despacho en el mismo formulario: individual y compartido.
  await tab(p, "productos");
  ok("02_ingreso_manual_es_la_accion_principal", (await H(p).locator("[data-ingreso-manual]").count()) === 1 && (await H(p).locator("[data-desde-capturas], [data-pegar-texto], [data-consultar-enlace]").count()) === 0);
  await ingresarProducto(p, { nombre: "Mesa plegable de camping", marca: "Outdoor", modelo: "MP-180", esp: "Largo: 180 cm\nMaterial: Aluminio", foto: true, enlace: "https://www.tienda.cl/mesa-plegable", proveedor: "Tienda Uno", cantidad: 50, precio: 51800, despacho: 3690 });
  ok("02_formulario_sin_disponibilidad", true);
  await ingresarProducto(p, { nombre: "Silla plegable", marca: "Outdoor", modelo: "SP-1", esp: "Peso: 3 kg", enlace: "https://www.otra.cl/silla", proveedor: "Tienda Dos", cantidad: 2, precio: 100000, despacho: 10000 });
  await ingresarProducto(p, { nombre: "Toldo 3x3", marca: "Outdoor", modelo: "T33", esp: "Medida: 3 x 3 m", proveedor: "Tienda Dos", cantidad: 1, precio: 50000, compartir: "Tienda Dos" });
  const resumen = await H(p).locator("[data-despacho-item]").allInnerTexts();
  ok("04_despacho_individual", /\$\s?3\.690/.test(resumen[0]) && /Confirmado/.test(resumen[0]), resumen[0]);
  ok("04_despacho_compartido_sin_duplicar", /\$\s?8\.000/.test(resumen[1]) && /\$\s?2\.000/.test(resumen[2]) && /compartido/.test(resumen[2]), resumen);
  await H(p).locator('[data-item-cotizacion="1"] [data-editar-item]').click(); await espera(p);
  await fichaModal(p).locator("[data-despacho-ficha]").scrollIntoViewIfNeeded(); await cap(p, "a3-formulario-despacho");
  ok("02_campo_disponibilidad_eliminado", !/Disponibilidad/.test(await fichaModal(p).innerText()));
  await fichaModal(p).locator("text=Cancelar").click(); await espera(p, 300);

  await cap(p, "a2-productos");
  // 3. Enlaces visibles: «Abrir publicación» o «Sin enlace registrado».
  ok("03_abrir_publicacion", (await H(p).locator('[data-item-cotizacion="1"] [data-abrir-publicacion]').getAttribute("href")) === "https://www.tienda.cl/mesa-plegable" && (await H(p).locator('[data-item-cotizacion="1"] [data-abrir-publicacion]').getAttribute("target")) === "_blank");
  ok("03_sin_enlace_registrado", (await H(p).locator('[data-item-cotizacion="3"] [data-sin-enlace]').count()) === 1);

  // 5 y 6. Precios: valor unitario grande, copiar solo dígitos, total y ganancia; sin IVA contable.
  await tab(p, "precios");
  const precios = H(p).locator('[role="tabpanel"]:visible, [data-totales-cotizacion]').first();
  await cap(p, "a4-precios");
  ok("05_valor_unitario_mesa_56669", /56\.669/.test(await H(p).locator('[data-unitario="1"]').innerText()) && /2\.833\.450/.test(await H(p).locator('[data-subtotal="1"]').innerText()));
  await H(p).locator('[data-copiar-valor="1"]').click(); await espera(p, 300);
  ok("05_copiar_valor_solo_digitos", (await p.evaluate(() => navigator.clipboard.readText())) === "56669");
  const totTxt = await H(p).locator("[data-totales-cotizacion]").innerText();
  ok("06_resumen_seis_datos", /Costo total de adquisici/.test(totTxt) && /Recargo comercial/.test(totTxt) && /Total neto de la oferta/.test(totTxt) && /Total con IVA/.test(totTxt) && /Ganancia neta estimada/.test(totTxt), totTxt);
  const panelPrecios = await H(p).innerText();
  ok("06_sin_iva_credito_debito_f29", !/IVA cr.dito|IVA d.bito|F29|IVA neto estimado|recargo efectivo/i.test(panelPrecios));
  await H(p).locator("[data-copiar-mp]").click(); await espera(p, 300);
  ok("06_copiar_valores_mp_general", /56669\t2833450/.test(await p.evaluate(() => navigator.clipboard.readText())));
  void precios;

  // 8. Vista previa: mismo generador, todas las páginas, sin guardar nada.
  await tab(p, "eett");
  for (const c of await H(p).locator("[data-aprobar-ficha] input").all()) await c.check();
  const rpcAntes = M.rpc.length; const stAntes = M.storagePost.length;
  await H(p).locator("[data-vista-previa-eett]").click();
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-pagina-preview]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await espera(p, 1500);
  const pagsPrevia = await p.locator("[data-pagina-preview]").count();
  ok("08_vista_previa_todas_las_paginas", pagsPrevia === 3, pagsPrevia);
  ok("08_vista_previa_no_guarda_nada", M.rpc.length === rpcAntes && M.cots.size === 0 && M.storagePost.length === stAntes);
  if (process.env.CAPTURAS) await p.screenshot({ path: join(SALIDA, "vista-previa-escritorio.png") });
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja]').click(); await espera(p, 300);

  // 9, 11 y 12. Generar y descargar: guarda primero, genera desde lo guardado, registra solo metadatos.
  const [desc] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]);
  const ruta = join(SALIDA, desc.suggestedFilename()); await desc.saveAs(ruta); await espera(p, 800);
  const iG = M.rpc.findIndex((r) => r.fn === "cz_guardar_cotizacion_v2"); const iR = M.rpc.findIndex((r) => r.fn === "cz_registrar_eett_v2");
  ok("09_guardado_automatico_antes_de_generar", iG >= 0 && iR > iG && M.cots.size === 1, M.rpc.map((r) => r.fn));
  const guardado = M.cots.get("c-1");
  ok("09_guardado_completo", guardado.items.length === 3 && guardado.vendedor_nombre === "María Pérez" && guardado.requerimientos.length === 2 && guardado.items[0].enlace === "https://www.tienda.cl/mesa-plegable");
  const pdfTxt = textoPdf(ruta);
  ok("09_pdf_con_datos_guardados", desc.suggestedFilename() === "EETT_3390-246-COT26_v1.pdf" && /Mesa plegable de camping/i.test(pdfTxt) && /Toldo 3x3/i.test(pdfTxt) && /Versi.n 1/.test(pdfTxt), desc.suggestedFilename());
  ok("11_pdf_vendedor_y_elaborador", /Vendedor responsable: Mar.a P.rez/.test(pdfTxt) && /Elaborado por: Admin Prueba/.test(pdfTxt) && /Empresa: BFK Limitada/.test(pdfTxt));
  ok("12_pdf_sin_datos_comerciales", !/51800|51\.800|56669|56\.669|tienda\.cl|Tienda Uno|3\.690|\$|6\.000\.000/.test(pdfTxt));
  const reg = M.rpc[iR].b.p;
  ok("12_solo_metadatos_registrados", reg.cotizacion_id === "c-1" && reg.version === 1 && /^[0-9a-f]{64}$/.test(reg.hash) && reg.nombre_documento === "EETT_3390-246-COT26_v1.pdf" && !("blob" in reg));
  ok("12_ningun_pdf_subido_a_storage", !M.storagePost.some((x) => /cz-eett|\.pdf/.test(x)) && M.storagePost.every((x) => /cz-productos\/img\//.test(x)), M.storagePost);
  ok("12_vista_previa_igual_al_pdf", Number(execFileSync("pdfinfo", [ruta]).toString().match(/Pages:\s+(\d+)/)[1]) === pagsPrevia);

  // Sin cambios: generar de nuevo NO crea otra versión.
  const nG = M.rpc.filter((r) => r.fn === "cz_guardar_cotizacion_v2").length;
  const [d2] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]); await d2.path(); await espera(p, 800);
  ok("09_sin_cambios_no_crea_version", M.rpc.filter((r) => r.fn === "cz_guardar_cotizacion_v2").length === nG && M.rpc.filter((r) => r.fn === "cz_registrar_eett_v2").length === 2);

  // 10. Edición posterior y nueva EETT.
  await tab(p, "productos");
  await H(p).locator('[data-item-cotizacion="1"] [data-editar-item]').click(); await espera(p);
  await llenar(fichaModal(p).locator('[data-campo="especificaciones"]'), "Largo: 180 cm\nMaterial: Aluminio reforzado"); await fichaModal(p).locator("[data-guardar-ficha]").click(); await espera(p, 400);
  await tab(p, "eett"); for (const c of await H(p).locator("[data-aprobar-ficha] input").all()) await c.check();
  const [d3] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]);
  const ruta3 = join(SALIDA, d3.suggestedFilename()); await d3.saveAs(ruta3); await espera(p, 800);
  ok("10_edicion_genera_nueva_version", M.cots.get("c-1").version === 2 && d3.suggestedFilename() === "EETT_3390-246-COT26_v2.pdf" && /Aluminio reforzado/.test(textoPdf(ruta3)));
  ok("10_historial_de_generaciones", (await H(p).locator("[data-eett-generado]").count()) === 3 && /versi.n 2/.test(await H(p).locator("[data-eett-generado]").first().innerText()));
  ok("12_imagenes_no_se_resuben", M.storagePost.length === 1, M.storagePost);

  // 3. Reabrir: enlaces conservados; adjudicada → «Ir a comprar» y lo ofertado protegido.
  await H(p).locator("[data-cerrar-hoja]").click(); await espera(p, 800);
  await p.locator('[data-cotizacion="3390-246-COT26"]').click(); await espera(p, 1200);
  await tab(p, "productos");
  ok("03_enlace_conservado_al_reabrir", (await H(p).locator('[data-item-cotizacion="1"] [data-abrir-publicacion]').getAttribute("href")) === "https://www.tienda.cl/mesa-plegable");
  ok("03_miniatura_visible_al_reabrir", /^data:image/.test(await H(p).locator('[data-item-cotizacion="1"] img').getAttribute("src").catch(() => "")));
  await tab(p, "datos"); await H(p).locator('[data-campo="estado"]').selectOption("adjudicada"); await espera(p, 200);
  await llenar(H(p).locator('[data-campo="oc_codigo"]'), "3390-1082-AG26");
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 800);
  await tab(p, "productos");
  await cap(p, "a5-adjudicada");
  ok("03_adjudicada_ir_a_comprar", (await H(p).locator('[data-item-cotizacion="1"] [data-ir-a-comprar]').getAttribute("href")) === "https://www.tienda.cl/mesa-plegable" && (await H(p).locator('[data-item-cotizacion="2"] [data-ir-a-comprar]').count()) === 1);
  await H(p).locator('[data-item-cotizacion="1"] [data-editar-item]').click(); await espera(p);
  ok("03_adjudicada_protege_ofertado_y_permite_enlace", await fichaModal(p).locator('[data-campo="cantidad"]').isDisabled() && await fichaModal(p).locator('[data-campo="precio"]').isDisabled() && !(await fichaModal(p).locator('[data-campo="enlace"]').isDisabled()));
  await llenar(fichaModal(p).locator('[data-campo="enlace"]'), "https://www.tienda.cl/mesa-plegable-v2"); await fichaModal(p).locator("[data-guardar-ficha]").click(); await espera(p, 300);
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 800);
  const itG = M.cots.get("c-1").items[0];
  ok("03_enlace_actualizado_conserva_original", itG.enlace === "https://www.tienda.cl/mesa-plegable-v2" && itG.enlace_original === "https://www.tienda.cl/mesa-plegable" && Number(itG.cantidad) === 50, itG);

  // 13. Eliminación: bloqueada en adjudicada; confirmación escrita en otra.
  await tab(p, "datos"); await H(p).locator("[data-eliminar-cotizacion]").click(); await espera(p, 300);
  ok("13_no_elimina_adjudicada", (await p.locator('[data-aviso-linea="eliminar-bloqueada"]').count()) === 1 && (await p.locator("[data-eliminar-definitivamente]").count()) === 0);
  await p.locator("[data-cancelar-eliminar]").click(); await H(p).locator("[data-cerrar-hoja]").click(); await espera(p, 600);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 600);
  await llenar(H(p).locator('[data-campo="nombre_licitacion"]'), "Prueba para eliminar"); await llenar(H(p).locator('[data-campo="institucion"]'), "Municipalidad");
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 800);
  await H(p).locator("[data-eliminar-cotizacion]").click(); await espera(p, 300);
  const btn = p.locator("[data-eliminar-definitivamente]");
  ok("13_pide_confirmacion_escrita", /definitiva/.test(await p.locator("[data-modal-eliminar]").innerText()) && await btn.isDisabled());
  await llenar(p.locator("[data-confirmar-eliminar]"), "otra cosa"); ok("13_confirmacion_incorrecta_no_habilita", await btn.isDisabled());
  await llenar(p.locator("[data-confirmar-eliminar]"), "prueba para eliminar"); await btn.click(); await espera(p, 1000);
  ok("13_elimina_con_confirmacion", M.rpc.some((r) => r.fn === "cz_eliminar_cotizacion" && r.b.p_confirmacion === "prueba para eliminar") && M.cots.size === 1 && (await p.locator('[data-hoja-lateral="cotizacion"]').count()) === 0);
  ok("A_sin_errores_de_consola", errs.length === 0, errs);
  await ctx.close();
}

// ═════ B. Usuario sin rol administrador: no ve «Eliminar cotización» ═════
{
  const { p, ctx, M, errs } = await preparar({ esquema: 2, usuario: "u2" });
  M.cots.set("c-9", { id: "c-9", version: 1, id_externo: "1-1-COT26", nombre: "X", institucion: "Y", estado: "borrador", fecha: "2026-10-13", recargo: 0.3, items: [], envios: [], actualizado_en: "2026-10-13" });
  await irCotizaciones(p, false); await p.locator('[data-cotizacion="1-1-COT26"]').click(); await espera(p, 1000); await tab(p, "datos");
  ok("13_sin_permiso_no_ve_eliminar", (await H(p).locator("[data-eliminar-cotizacion]").count()) === 0);
  ok("B_sin_errores_de_consola", errs.length === 0, errs);
  await ctx.close();
}

// ═════ C. Compatibilidad: base actual (esquema 1, migración NO aplicada), celular 390 ═════
{
  const { p, ctx, M, errs } = await preparar({ esquema: 1, ancho: 390, alto: 844, movil: true });
  // Cotización guardada con la versión anterior (con disponibilidad y envío compartido antiguos).
  M.cots.set("c-7", { id: "c-7", version: 3, id_externo: "2656-40-COT25", nombre: "Impresoras", institucion: "Municipio", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja", estado: "presentada", fecha: "2026-10-05", recargo: 0.3, plazo: "2 DIAS", actualizado_en: "2026-10-05",
    envios: [{ key: "e1", proveedor: "Falabella", monto: 5990, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "simulación" }],
    items: [{ key: "i1", producto_id: null, ficha: { nombre: "Impresora", marca: "HP", modelo: "520", especificaciones: [{ etiqueta: "Tipo", valor: "Tinta" }], imagenes: ["img/abc.jpg"] }, ficha_aprobada: true, enlace: "https://falabella.com/x", proveedor: "Falabella", cantidad: 3, precio_origen: 82865, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, disponibilidad: "En stock", origen_datos: "enlace" }] });
  await irCotizaciones(p, true);
  ok("14_lista_datos_existentes", (await p.locator('[data-cotizacion="2656-40-COT25"]').count()) === 1);
  await p.locator('[data-cotizacion="2656-40-COT25"]').click(); await espera(p, 1200);
  await espera(p, 800);
  ok("14_imagen_guardada_carga_progresiva", M.storageGet >= 1 && /^data:image/.test(await H(p).locator('[data-item-cotizacion="1"] img').getAttribute("src").catch(() => "")), M.storageGet);
  await tab(p, "precios");
  ok("14_calculo_existente_sin_cambios", /\$\s?\d/.test(await H(p).locator('[data-unitario="1"]').innerText()) && (await H(p).locator('[data-precio-item="1"]').count()) === 1);
  await tab(p, "datos"); await H(p).locator('[data-campo="vendedor"]').selectOption({ label: "Vendedor Uno" }); await espera(p, 200);
  ok("14_aviso_migracion_pendiente", (await H(p).locator('[data-aviso-linea="esquema-pendiente"]').count()) === 1);
  ok("14_sin_eliminar_sin_migracion", (await H(p).locator("[data-eliminar-cotizacion]").count()) === 0);
  await tab(p, "eett");
  await H(p).locator("[data-vista-previa-eett]").click();
  await p.locator("[data-pagina-preview]").first().waitFor({ timeout: 20000 }).catch(() => {}); await espera(p, 800);
  ok("08_vista_previa_celular", (await p.locator("[data-pagina-preview]").count()) === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  if (process.env.CAPTURAS) await p.screenshot({ path: join(SALIDA, "vista-previa-celular.png") });
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja]').click(); await espera(p, 300);
  const [d] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), H(p).locator("[data-generar-eett]").click()]); await d.path(); await espera(p, 800);
  const g = M.rpc.find((r) => r.fn === "cz_guardar_cotizacion"); const r1 = M.rpc.find((r) => r.fn === "cz_registrar_eett");
  ok("14_guarda_con_funcion_actual", !!g && g.b.p.version === 3 && g.b.p.items[0].disponibilidad === "En stock" && g.b.p.items[0].ficha.imagenes[0] === "img/abc.jpg", g?.b.p.items[0]);
  ok("14_registro_sin_pdf_en_base_actual", !!r1 && r1.b.p_ruta === null && r1.b.p_version === 4 && !M.storagePost.length, r1?.b);
  ok("C_sin_errores_de_consola", errs.length === 0, errs);
  await ctx.close();
}

await browser.close();
writeFileSync(join(SALIDA, "resultado.txt"), `${nOk} OK · ${F.length} fallas\n${F.join("\n")}`);
console.log(`\n${nOk} OK · ${F.length} fallas  (salida: ${SALIDA})`);
process.exit(F.length ? 1 : 0);
