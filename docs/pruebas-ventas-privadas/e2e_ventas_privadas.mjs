// Recorrido completo de Ventas privadas en navegador real (escritorio 1440 px y celular 390 px) contra PostgREST REAL sobre
// una base desechable con la migración instalada. Usuarios ficticios: Ana (vendedora/responsable), Beto (otro usuario) y
// el administrador. Mercado Público se sirve con el simulador de siempre (para comprobar que sigue funcionando).
// Uso: (entorno.sh instalar) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-ventas-privadas/e2e_ventas_privadas.mjs http://127.0.0.1:4330/
import { readFileSync } from "node:fs";
import { abrir, chromium, CHROME, U, psql, sinDesborde, registro, desde, calma, marca, escriturasMP } from "./arnes_vp.mjs";
import * as ui from "./ui_cotizacion_vp.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, det); } };
const espera = (p, ms = 500) => p.waitForTimeout(ms);
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function textoPDF(buf) { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; let s = ""; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n"; return s; }
let ultimoArchivo = "";   // nombre con que se descargó el último PDF
async function descarga(p, accion) {
  try { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 15000 }), accion()]); ultimoArchivo = dl.suggestedFilename(); return readFileSync(await dl.path()); }
  catch (e) { const avisos = await p.locator('[role="status"], [data-errores-eett], [data-error-form]').allInnerTexts().catch(() => []); throw new Error(`sin descarga · ${avisos.join(" | ").slice(0, 400)}`); }
}
const q1 = (sql) => psql(sql).split("\n").pop();

// La carga de archivos se habilita SOLO en esta base desechable (en producción queda deshabilitada al instalar).
psql(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"${U.admin}","role":"authenticated"}', false); select public.vp_configurar('documentos_habilitados', 'true'::jsonb, 'Prueba e2e en base desechable');`);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  // ── 1. Menú lateral (escritorio) ───────────────────────────────────────────────────────────────
  let { page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel" });
  const lateral = await p.locator("aside").innerText();
  ok("M1 subtítulo «Gestión comercial»", /Gestión comercial/.test(lateral) && !/Ventas Mercado Público/.test(lateral));
  const grupos = await p.locator("aside nav > div > div:first-child").allInnerTexts();
  ok("M2 grupos en orden", JSON.stringify(grupos.map((g) => g.trim().toUpperCase())) === JSON.stringify(["GENERAL", "MERCADO PÚBLICO", "VENTAS PRIVADAS", "PROYECTOS INDUSTRIALES", "FINANZAS"]), JSON.stringify(grupos));
  const items = await p.locator("aside nav [data-nav]").allInnerTexts();
  ok("M3 opciones en orden", JSON.stringify(items.map((x) => x.replace(/\s*\d+$/, "").trim())) === JSON.stringify(["Inicio", "Alertas", "Agenda", "Compras", "Cotizaciones MP", "Clientes", "Cotizaciones privadas", "Órdenes de venta", "Proyectos industriales", "Finanzas"]), JSON.stringify(items));
  ok("M4 sin «+ Nueva OC»; botón «+ Nuevo»", !(await p.locator("aside button", { hasText: /^\+ Nueva OC$/ }).count()) && (await p.locator("aside [data-boton-nuevo]").count()) === 1);
  await p.locator("aside [data-boton-nuevo]").click(); await espera(p, 300);
  ok("M5 «+ Nuevo» ofrece las 3 opciones", JSON.stringify(await p.locator("[data-menu-nuevo] [data-nuevo] span span:first-child").allInnerTexts()) === JSON.stringify(["Cotización privada", "Venta privada / Registrar OC de cliente", "OC de Mercado Público"]));
  await p.locator('[data-nuevo="mp_oc"]').click(); await espera(p, 600);
  ok("M6 «OC de Mercado Público» abre el flujo de siempre (Nueva OC)", (await p.locator('[role="dialog"]', { hasText: "Nueva OC" }).count()) > 0);
  await p.keyboard.press("Escape"); await espera(p, 300);
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 1200);
  ok("M7 Compras (Mercado Público) sigue mostrando sus OC", (await p.locator("main").innerText()).length > 200 && !errs.length, errs.join(" | "));

  await calma(); const m1 = marca();
  // ── 2. Clientes ─────────────────────────────────────────────────────────────────────────────────
  await p.locator('aside [data-nav="vp_clientes"]').click(); await p.locator("[data-panel-vp-clientes]").waitFor();
  await p.locator("[data-nuevo-cliente]").click(); await espera(p, 300);
  const f = p.locator('[data-ventana="form-cliente"]');
  await f.locator("[data-campo-rut]").fill("76086428-5"); await f.locator("[data-campo-razon]").fill("Maderas del Sur SpA");
  await f.locator("input").nth(3).fill("Aserradero y venta de maderas");
  await f.locator("[data-campo-contacto]").fill("Rosa Pérez"); await f.locator("[data-campo-correo]").fill("rosa@maderas.invalid");
  await f.locator("[data-campo-entrega]").fill("Planta km 5, Laja"); await f.locator("[data-campo-condiciones]").fill("50% anticipo y saldo a 30 días");
  await f.locator("[data-guardar-cliente]").click(); await espera(p, 1500);
  ok("C1 cliente registrado (ficha con historial)", (await p.locator('[data-hoja-lateral="ficha-cliente"]').count()) === 1 && /Maderas del Sur/.test(await p.locator('[data-hoja-lateral="ficha-cliente"]').innerText()));
  await p.locator("[data-cerrar-hoja]").click(); await espera(p, 300);
  await p.locator("[data-nuevo-cliente]").click(); await espera(p, 300);
  await f.locator("[data-campo-rut]").fill("76.086.428-5"); await f.locator("[data-campo-razon]").fill("Otro nombre"); await f.locator("[data-guardar-cliente]").click(); await espera(p, 600);
  ok("C2 duplicado por RUT detectado y se ofrece el existente", /Ya existe un cliente con ese RUT/.test(await f.innerText()) && (await f.locator("[data-usar-existente]").count()) === 1);
  await f.locator("[data-cerrar-ventana]").click();
  ok("C3 un solo cliente con ese RUT en la base", q1(`select count(*) from public.pi_clientes where rut_clave = '760864285';`) === "1");

  // ── 3. Cotización privada (misma experiencia que Mercado Público; recorrido completo en e2e_cotizacion_como_mp.mjs) ──────
  await p.locator("aside [data-boton-nuevo]").click(); await p.locator('[data-nuevo="vp_cotizacion"]').click(); await p.locator('[data-hoja-lateral="ficha-cotizacion"]').waitFor();
  const h = ui.hoja(p);
  await ui.elegirCliente(p, "Maderas", "76.086.428-5");
  ok("Q1 al elegir el cliente se proponen contacto y condiciones", (await h.locator('[data-campo="contacto"]').inputValue()) === "Rosa Pérez" && (await h.locator('[data-campo="pago"]').inputValue()) === "50% anticipo y saldo a 30 días");
  await h.locator('[data-campo="plazo"]').fill("10 días hábiles desde la aceptación");
  await ui.pestana(p, "productos");
  await ui.ingresarManual(p, { nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", especificaciones: "Potencia: 2 HP", cantidad: 2, unidad: "UN", precio: 240000, incluyeIva: false,
    despacho: { modo: "propio", monto: 0, estado: "sin_costo_confirmado", evidencia: "Retiro en tienda del proveedor" }, biblioteca: false });
  await ui.ingresarManual(p, { nombre: "Manguera 1 pulgada", cantidad: "12.5", unidad: "M", precio: "2100.5", incluyeIva: false, despacho: { modo: "existente" }, biblioteca: false });
  await h.locator("[data-ingreso-manual]").click(); await ui.llenarFicha(p, { tipo: "servicio", nombre: "Instalación y puesta en marcha", cantidad: 1, unidad: "GL", biblioteca: false }); await ui.guardarFicha(p);
  await ui.pestana(p, "precios");
  await ui.fijarPrecio(p, 1, 350000, 5); await ui.fijarPrecio(p, 2, 3990); await ui.fijarPrecio(p, 3, 180000, 10); await espera(p, 300);
  const totTxt = await h.locator('[data-resumen="totales"]').innerText();
  ok("Q2 totales en pantalla (neto, IVA, total) y margen interno", /\$876\.875/.test(totTxt) && /\$166\.606/.test(totTxt) && /\$1\.043\.481/.test(totTxt) && /Utilidad estimada/i.test(totTxt) && /no aparecen? en el PDF/i.test(totTxt), totTxt.replace(/\n/g, " "));
  await ui.guardarCotizacion(p);
  const folio = q1(`select folio from public.vp_cotizaciones order by creado_en desc limit 1;`);
  ok("Q3 guardada con folio automático", /^CP-\d{4}-0001$/.test(folio) && (await p.locator('[data-hoja-lateral="ficha-cotizacion"]').innerText()).includes(folio), folio);
  ok("Q4 totales de la base = pantalla", q1(`select neto||'|'||iva||'|'||total from public.vp_cotizacion_revisiones r join public.vp_cotizaciones c on c.id = r.cotizacion_id where c.folio = '${folio}';`) === "876875|166606|1043481");
  const h2 = ui.hoja(p);
  await ui.pestana(p, "precios");
  const pdfCot = await descarga(p, () => h2.locator("[data-pdf-cotizacion]").click());
  const tCot = await textoPDF(pdfCot);
  ok("Q5 PDF con datos de BFK, cliente, ítems y totales", /77\.322\.317-3/.test(tCot) && /Maderas del Sur/.test(tCot) && /Bomba centr/.test(tCot) && /1\.043\.481/.test(tCot) && tCot.includes(folio));
  ok("Q6a el PDF de la cotización se guarda con su código y revisión (<folio>_Rev0.pdf)", ultimoArchivo === `${folio}_Rev0.pdf`, ultimoArchivo);
  ok("Q6 PDF SIN costos ni márgenes", !/240\.000|480\.000|2\.100|506\.256|370\.619/.test(tCot) && !/costo|margen|utilidad/i.test(tCot));
  await h2.locator("[data-ver-cotizacion]").click(); await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-pagina-preview="1"]').waitFor({ timeout: 15000 });
  ok("Q6b vista previa de la cotización en la app (mismo PDF) sin registrar envío", /cotizaci/i.test(await p.locator('[data-hoja-lateral="vista-previa-eett"]').innerText()) && q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "borrador");
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja], [data-hoja-lateral="vista-previa-eett"] button[aria-label="Cerrar"]').first().click(); await espera(p, 400);
  ok("Q7 descargar el PDF NO marca la cotización como enviada", q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "borrador");
  await ui.registrarEstado(p, "enviada");
  ok("Q8 envío registrado manualmente; contenido bloqueado", q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "enviada" && !(await h2.locator("[data-precio-unitario]").count()) && !(await h2.locator("[data-ingreso-manual]").count()));
  // Duplicar (cotización nueva, folio nuevo) y una segunda cotización enviada que vence pronto (para Alertas).
  await h2.locator('[data-accion-cot="duplicar"]').click(); await espera(p, 2500);
  const folio2 = q1(`select folio from public.vp_cotizaciones order by creado_en desc limit 1;`);
  const h3 = ui.hoja(p);
  ok("Q9 duplicar crea otra cotización con los mismos ítems y fichas", folio2 !== folio && /^CP-/.test(folio2) && (await h3.locator("[data-item-cotizacion]").count()) === 3 && q1(`select count(*) from public.vp_cotizacion_items i join public.vp_cotizacion_revisiones r on r.id = i.revision_id join public.vp_cotizaciones c on c.id = r.cotizacion_id where c.folio = '${folio2}' and i.ficha is not null;`) === "3");
  await ui.pestana(p, "datos");
  await h3.locator('[data-campo="vigencia"]').fill(new Date(Date.now() + 2 * 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  await ui.guardarCotizacion(p);
  await ui.registrarEstado(p, "enviada");
  await h3.locator("[data-cerrar-hoja]").click(); await espera(p, 400);
  await p.locator(`[data-cotizacion="${folio}"]`).click(); await espera(p, 1500);
  const h4 = ui.hoja(p);
  await ui.registrarEstado(p, "aceptada");
  ok("Q10 aceptación registrada", q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "aceptada" && (await h4.locator('[data-accion-cot="crear-venta"]').count()) === 1);

  // ── 4. EETT: el mismo recorrido de Mercado Público (revisión de fichas → generar y descargar), sin ventana adicional ──
  await ui.pestana(p, "eett");
  ok("E1 pestaña EETT de Mercado Público: revisión de cada ficha, «Vista previa de EETT» y «Generar y descargar EETT»", (await h4.locator("[data-revision-eett]").count()) === 3
    && /Vista previa de EETT/.test(await h4.locator("[data-vista-previa-eett]").innerText()) && /Generar y descargar EETT/.test(await h4.locator("[data-generar-eett]").innerText()));
  const pdfE = await descarga(p, () => h4.locator("[data-generar-eett]").click()); await espera(p, 1500);
  ok("E2 sin ventana adicional: no se piden objeto, alcance, requisitos ni selección de ítems", !(await p.locator('[data-ventana^="eett"], [data-eett-objeto], [data-armar-eett]').count()) && !/Objeto del suministro|Alcance/.test(await h4.innerText()));
  const tE = await textoPDF(pdfE);
  const eettFolio = q1(`select folio||' R'||revision from public.vp_eett where estado = 'emitida';`);
  const pos = (r) => tE.search(r);
  ok("E4 EETT emitida y descargada (folio, revisión, cliente, referencia, todos los ítems numerados en orden)", /^ET-\d{4}-0001 R0$/.test(eettFolio) && /ET-\d{4}-0001/.test(tE) && /Rev\. 0/.test(tE) && /Maderas del Sur/.test(tE) && tE.includes(folio)
    && pos(/(^|\s)1\. /) >= 0 && pos(/(^|\s)1\. /) < pos(/(^|\s)2\. /) && pos(/(^|\s)2\. /) < pos(/(^|\s)3\. /), eettFolio);
  ok("E4b EETT con el formato de Mercado Público y sin campos de licitación", /INFORMACI.N\s+T.CNICA DE/.test(tE) && /CARACTER.STICAS/.test(tE) && /COTIZACI.N/.test(tE) && !/LICITACI.N|INSTITUCI.N SOLICITANTE/.test(tE));
  ok("E5 EETT con marca/modelo/características de la ficha y sin precios ni costos", /CPm 680/.test(tE) && /Pedrollo/.test(tE) && /2 HP/.test(tE) && !/\$\s?\d/.test(tE) && !/350\.000|240\.000/.test(tE) && !/Objeto del suministro|Requisitos del cliente/.test(tE));
  ok("E6 contenido congelado en el formato de Mercado Público (sin objeto ni requisitos) y con los 3 ítems", q1(`select (contenido->>'formato')||'|'||coalesce(contenido->>'objeto','')||'|'||jsonb_array_length(contenido->'items')||'|'||(hash is not null) from public.vp_eett where estado = 'emitida';`) === "mp||3|true");
  ok("E7 «EETT generadas» muestra la emisión con su PDF", (await h4.locator('[data-eett-generado] [data-descargar-eett]').count()) === 1);

  // ── 5. Conversión a venta: doble clic no duplica; OC del cliente con archivo ───────────────────
  const h5 = p.locator('[data-hoja-lateral="ficha-cotizacion"]');
  await h5.locator('[data-accion-cot="crear-venta"]').click(); await p.locator('[data-ventana="crear-venta"]').waitFor();
  const cv = p.locator('[data-ventana="crear-venta"]');
  ok("V1 OC del cliente distinguida de la orden interna", /documento que el cliente emite a BFK/.test(await cv.innerText()) && /orden de venta interna/.test(await cv.innerText()));
  await cv.locator("[data-oc-numero]").fill("OC-4512");
  await cv.locator("[data-oc-archivo]").setInputFiles({ name: "OC-4512.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 OC de prueba ficticia") });
  await cv.locator("[data-confirmar-venta]").dblclick(); await espera(p, 3000);
  ok("V2 doble clic: UNA sola venta para la cotización", q1(`select count(*) from public.vp_ventas v join public.vp_cotizaciones c on c.id = v.cotizacion_id where c.folio = '${folio}';`) === "1");
  const ov = q1(`select folio from public.vp_ventas order by creado_en desc limit 1;`);
  ok("V3 venta con folio interno, total y vínculos (cotización, revisión, EETT, OC)", q1(`select v.total||'|'||v.origen||'|'||(v.eett_id is not null)||'|'||(select count(*) from public.vp_oc_cliente o where o.venta_id = v.id and o.documento_id is not null) from public.vp_ventas v where folio = '${ov}';`) === "1043481|cotizacion|true|1" && /^OV-\d{4}-0001$/.test(ov), ov);
  const fv = p.locator('[data-hoja-lateral="ficha-venta"]'); await fv.waitFor();
  ok("V4 se abre la ficha de la venta con las cuatro pestañas", JSON.stringify(await fv.locator('[data-pestanas="Ficha de la venta"] [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.tab))) === JSON.stringify(["detalle", "entregas", "documentos", "pagos"]));
  ok("V5 detalle con costo estimado y utilidad estimada (responsable)", /Costo estimado/.test(await fv.locator("[data-margen-venta]").innerText()));
  ok("V6 estados independientes al crear", (await fv.locator('[data-estado-vp="entrega-pendiente"]').count()) === 1 && (await fv.locator('[data-estado-vp="fact-sin_facturar"]').count()) === 1 && (await fv.locator('[data-estado-vp="pago-pendiente"]').count()) === 1);

  // ── 6. Entregas parcial y final ────────────────────────────────────────────────────────────────
  await fv.locator('[data-tab="entregas"]').click(); await fv.locator("[data-registrar-entrega]").click();
  const fe = p.locator('[data-ventana="form-entrega"]');
  await fe.locator('[data-entrega-cantidad="1"]').fill("1"); await fe.locator('[data-entrega-cantidad="2"]').fill("12,5"); await fe.locator('[data-entrega-cantidad="3"]').fill("0");
  await fe.locator("[data-guardar-entrega]").click(); await espera(p, 1800);
  ok("D1 entrega parcial", (await fv.locator('[data-estado-vp="entrega-parcial"]').count()) === 1 && /1 \/ 2/.test(await fv.locator('[data-fila-vp="pend-1"]').innerText()));
  await fv.locator("[data-registrar-entrega]").click();
  await fe.locator('[data-entrega-cantidad="1"]').fill("5"); await fe.locator("[data-guardar-entrega]").click(); await espera(p, 600);
  ok("D2 no se entrega más que lo pendiente", /supera lo pendiente/.test(await fe.innerText()));
  await fe.locator('[data-entrega-cantidad="1"]').fill("1"); await fe.locator("[data-guardar-entrega]").click(); await espera(p, 1800);
  ok("D3 entrega final: entregada, pero el pago sigue pendiente", (await fv.locator('[data-estado-vp="entrega-entregada"]').count()) === 1 && (await fv.locator('[data-estado-vp="pago-pendiente"]').count()) === 1);

  // ── 7. Factura (registro, no emisión), anticipo y saldo ───────────────────────────────────────
  await fv.locator('[data-tab="documentos"]').click();
  ok("F1 se aclara que no es emisión tributaria", /no emite documentos tributarios/.test(await fv.innerText()));
  ok("F2 OC del cliente adjunta en Documentos", (await fv.locator('[data-documento="oc_cliente"]').count()) === 1);
  ok("F2b la EETT emitida está vinculada a la venta", (await fv.locator("[data-eett-venta]").count()) === 1 && /Vinculada a esta venta/.test(await fv.locator("[data-eett-venta]").innerText()));
  const tEv = await textoPDF(await descarga(p, () => fv.locator("[data-pdf-eett-venta]").click()));
  ok("F2c la EETT se recupera desde la venta (mismo folio, revisión y contenido)", /ET-\d{4}-0001/.test(tEv) && /Rev\. 0/.test(tEv) && /CPm 680/.test(tEv) && tEv.replace(/\s+/g, " ") === tE.replace(/\s+/g, " ") && !/\$\s?\d/.test(tEv));
  const tAp = await textoPDF(await descarga(p, async () => { await fv.locator('[data-tab="detalle"]').click(); await fv.locator("[data-pdf-aprobada]").click(); }));
  const revAp = q1(`select r.numero from public.vp_ventas v join public.vp_cotizacion_revisiones r on r.id = v.revision_id join public.vp_cotizaciones c on c.id = v.cotizacion_id where c.folio = '${folio}';`);
  ok("F2d PDF de la cotización aprobada desde la venta (congelado, sin costos)", tAp.includes(folio) && /1\.043\.481/.test(tAp) && !/costo|margen/i.test(tAp));
  ok("F2e ese PDF se guarda con el código y la revisión aprobada", ultimoArchivo === `${folio}_Rev${revAp}.pdf`, `${ultimoArchivo} (rev ${revAp})`);
  await fv.locator('[data-tab="documentos"]').click();
  await fv.locator("[data-registrar-factura]").click(); const ff = p.locator('[data-ventana="form-factura"]');
  ok("F3 neto e IVA propuestos para lo pendiente", (await ff.locator("[data-factura-neto]").inputValue()) === "876875" && (await ff.locator("[data-factura-iva]").inputValue()) === "166606");
  await ff.locator("[data-factura-numero]").fill("1501"); await ff.locator("[data-guardar-factura]").click(); await espera(p, 1800);
  ok("F4 factura registrada (facturada)", (await fv.locator('[data-estado-vp="fact-facturada"]').count()) === 1 && (await fv.locator('[data-factura="1501"]').count()) === 1);
  await fv.locator('[data-tab="pagos"]').click(); await fv.locator("[data-registrar-pago]").click(); const fp = p.locator('[data-ventana="form-pago"]');
  await fp.locator("[data-pago-tipo]").selectOption("anticipo"); await fp.locator("[data-pago-monto]").fill("521740"); await fp.locator("[data-guardar-pago]").dblclick(); await espera(p, 2000);
  ok("P1 anticipo registrado una sola vez (doble clic)", q1(`select count(*) from public.vp_pagos where tipo = 'anticipo';`) === "1" && /521\.740/.test(await fv.locator('[data-fila-vp="cobrado"]').innerText()));
  await fv.locator("[data-imputar-pago]").click(); await p.locator('[data-ventana="form-imputar"] [data-guardar-imputacion]').click(); await espera(p, 1600);
  ok("P2 aplicar el anticipo a la factura NO cambia lo cobrado", /521\.740/.test(await fv.locator('[data-fila-vp="cobrado"]').innerText()) && q1(`select count(*) from public.vp_pago_imputaciones where estado = 'vigente';`) === "1");
  await fv.locator("[data-registrar-pago]").click();
  ok("P3 el saldo se propone como monto", (await fp.locator("[data-pago-monto]").inputValue()) === "521741");
  await fp.locator("[data-pago-factura]").selectOption({ index: 1 }); await fp.locator("[data-guardar-pago]").click(); await espera(p, 1800);
  ok("P4 venta pagada: saldo $0", (await fv.locator('[data-estado-vp="pago-pagada"]').count()) === 1 && /\$0/.test(await fv.locator('[data-fila-vp="saldo"]').innerText()));
  ok("P5 base: cobrado = total, sin duplicar", q1(`select cobrado||'|'||saldo||'|'||facturado from public.vp_ventas_vista where folio = '${ov}';`) === "1043481|0|1043481");

  // ── 8. Finanzas, Inicio, Alertas y Agenda ─────────────────────────────────────────────────────
  await fv.locator("[data-cerrar-hoja]").click(); await espera(p, 300);
  await p.locator('aside [data-nav="finanzas"]').click(); await espera(p, 1200);
  await p.locator('[data-canal-filtro="finanzas"] [data-canal="vp"]').click(); await espera(p, 600);
  const kv = async (d) => (await p.locator(`[data-kpi-valor="${d}"]`).innerText()).trim();
  ok("FI1 Finanzas · Ventas privadas: cotizado aparte, vendido, facturado, cobrado y saldo", (await kv("vp-vendido")) === "$1.043.481" && (await kv("vp-facturado")) === "$1.043.481" && (await kv("vp-cobrado")) === "$1.043.481" && (await kv("vp-saldo")) === "$0" && (await kv("vp-cotizado")) === "$1.043.481",
    [await kv("vp-vendido"), await kv("vp-cobrado"), await kv("vp-cotizado")].join(" "));
  ok("FI2 utilidad estimada según costos registrados", /\$/.test(await kv("vp-utilidad")));
  await p.locator('[data-canal-filtro="finanzas"] [data-canal="todos"]').click(); await espera(p, 600);
  await p.locator("[data-periodo]").selectOption("todo"); await espera(p, 400);
  const fila = async (d) => (await p.locator(`[data-consolidado-fila="${d}"] td`).allInnerTexts()).map((x) => x.trim());
  const fv1 = await fila("venta"), fc1 = await fila("cobrado"), fq1 = await fila("cotizado");
  const n = (s) => Number(String(s).replace(/[^\d-]/g, "")) || 0;
  ok("FI3 Todos los canales: total = MP + privadas (ventas y cobros)", n(fv1[3]) === n(fv1[1]) + n(fv1[2]) && n(fv1[2]) === 1043481 && n(fc1[3]) === n(fc1[1]) + n(fc1[2]), JSON.stringify([fv1, fc1]));
  ok("FI4 lo cotizado no se suma como ingreso", fq1[3] === "—" && fq1[1] === "—");
  await p.locator('[data-canal-filtro="finanzas"] [data-canal="mp"]').click(); await espera(p, 600);
  ok("FI5 Mercado Público muestra el resumen existente", (await p.locator("[data-margen-comercial]").count()) === 1 && !(await p.locator("[data-consolidado]").count()));
  await p.locator('aside [data-nav="notif"]').click(); await espera(p, 800);
  await p.locator('[data-canal-filtro="alertas"] [data-canal="vp"]').click(); await espera(p, 500);
  const al = await p.locator("[data-alerta-canal]").evaluateAll((b) => b.map((x) => x.dataset.alertaCanal));
  ok("A1 Alertas · Ventas privadas: cotización por vencer y solo canal VP", al.length > 0 && al.every((c) => c === "vp") && /vence en 2 días/i.test(await p.locator("main").innerText()), JSON.stringify(al));
  await p.locator('[data-canal-filtro="alertas"] [data-canal="mp"]').click(); await espera(p, 500);
  ok("A2 Alertas · Mercado Público: sin alertas privadas", (await p.locator('[data-alerta-canal="vp"]').count()) === 0 && (await p.locator('[data-alerta-canal="mp"]').count()) > 0);
  await p.locator('[data-canal-filtro="alertas"] [data-canal="vp"]').click(); await espera(p, 400);
  await p.locator('[data-alerta-canal="vp"]').first().click(); await espera(p, 1500);
  ok("A3 la alerta abre la cotización", (await p.locator('[data-hoja-lateral="ficha-cotizacion"]').count()) === 1 && (await p.locator('[data-hoja-lateral="ficha-cotizacion"]').innerText()).includes(folio2));
  await p.locator("[data-cerrar-hoja]").click();
  await p.locator('aside [data-nav="agenda"]').click(); await espera(p, 800);
  await p.locator('[data-canal-filtro="agenda"] [data-canal="vp"]').click(); await espera(p, 400);
  ok("AG1 Agenda muestra eventos de ventas privadas", (await p.locator("[data-punto-vp]").count()) > 0);
  await p.locator('aside [data-nav="panel"]').click(); await espera(p, 800);
  await p.locator('[data-canal-filtro="inicio"] [data-canal="vp"]').click(); await espera(p, 400);
  ok("I1 Inicio · Ventas privadas: resumen del canal", (await p.locator("[data-resumen-vp]").count()) === 1 && (await kv("vp-vendido")) === "$1.043.481");

  // ── 9. Persistencia al recargar y enlace directo ──────────────────────────────────────────────
  await p.goto(URL_APP + `#/ordenes-venta/${ov}`, { waitUntil: "load" }); await espera(p, 3500);
  const fr = p.locator('[data-hoja-lateral="ficha-venta"]');
  ok("R1 tras recargar, la venta abre por enlace directo con sus estados", (await fr.count()) === 1 && (await fr.locator('[data-estado-vp="pago-pagada"]').count()) === 1 && (await fr.locator('[data-estado-vp="entrega-entregada"]').count()) === 1);
  ok("R2 sin errores de página (Ana)", !errs.length, errs.join(" | "));
  ok("R3 el recorrido de ventas privadas no escribió nada en Mercado Público", !escriturasMP(m1).length, JSON.stringify(escriturasMP(m1).map((x) => x.obj)));
  await ctx.close();

  // ── 10. Permisos: otro usuario ─────────────────────────────────────────────────────────────────
  ({ page: p, ctx, errs } = await abrir(browser, { usuario: U.beto, url: URL_APP, hash: `#/ordenes-venta/${ov}` }));
  const fb = p.locator('[data-hoja-lateral="ficha-venta"]'); await fb.waitFor();
  ok("S1 otro usuario ve la venta pero no costos ni márgenes", (await fb.locator("[data-margen-venta]").count()) === 0 && /visibles solo para el responsable/.test(await fb.innerText()));
  ok("S2 otro usuario no ve acciones financieras ni anular venta", (await fb.locator("[data-anular-venta]").count()) === 0 && !(await fb.locator("[data-registrar-pago]").count()));
  const r403 = await p.evaluate(async (venta) => { const r = await fetch("https://gypywxaugwuxbgmcqntp.supabase.co/rest/v1/rpc/vp_registrar_pago", { method: "POST", headers: { "Content-Type": "application/json", apikey: "x", Authorization: "Bearer x" }, body: JSON.stringify({ p: { clave: crypto.randomUUID(), venta_id: venta, tipo: "abono", fecha: new Date().toISOString().slice(0, 10), monto: 1, medio: "efectivo" } }) }); return [r.status, (await r.json()).message]; }, q1(`select id from public.vp_ventas where folio = '${ov}';`));
  ok("S3 la base rechaza el pago de otro usuario (permiso en backend)", r403[0] >= 400 && /responsable/.test(r403[1]), JSON.stringify(r403));
  const rc = await p.evaluate(async () => { const r = await fetch("https://gypywxaugwuxbgmcqntp.supabase.co/rest/v1/vp_cotizacion_item_costos?select=*", { headers: { apikey: "x", Authorization: "Bearer x" } }); return (await r.json()).length; });
  ok("S4 la base no entrega costos a otro usuario", rc === 0);
  await fb.locator('[data-tab="documentos"]').click();
  ok("S5 documentos visibles (OC del cliente) para el equipo", (await fb.locator('[data-documento="oc_cliente"]').count()) === 1);
  await p.goto(URL_APP + `#/cotizaciones-privadas/${folio}`, { waitUntil: "load" }); await espera(p, 3500);
  const cb = p.locator('[data-hoja-lateral="ficha-cotizacion"]');
  ok("S6 cotización ajena: sin margen interno ni acciones de estado", (await cb.count()) === 1 && (await cb.locator("[data-margen-interno]").count()) === 0 && !(await cb.locator('[data-accion-cot="aceptada"]').count()));
  ok("S7 sin errores de página (Beto)", !errs.length, errs.join(" | "));
  await ctx.close();

  // ── 11. Celular (390 px) ───────────────────────────────────────────────────────────────────────
  ({ page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ancho: 390, alto: 844, movil: true }));
  ok("CE1 barra inferior sin cambios", JSON.stringify(await p.locator('nav[aria-label="Navegación principal"] [data-nav]').evaluateAll((b) => b.map((x) => x.dataset.nav))) === JSON.stringify(["panel", "compras", "finanzas", "notif", "mas"]));
  await p.locator("header [data-boton-nuevo]").click(); await espera(p, 300);
  ok("CE2 «+ Nuevo» en el encabezado del celular con las 3 opciones", (await p.locator("[data-menu-nuevo] [data-nuevo]").count()) === 3 && await sinDesborde(p));
  await p.keyboard.press("Escape");
  await p.locator('[data-nav="mas"]').click(); await espera(p, 400);
  const mas = await p.locator('[role="dialog"][aria-label="Más pantallas y cuenta"]').innerText();
  ok("CE3 menú «Más» con grupos y Ventas privadas", /VENTAS PRIVADAS/i.test(mas) && /Clientes/.test(mas) && /Cotizaciones privadas/.test(mas) && /Órdenes de venta/.test(mas) && /MERCADO PÚBLICO/i.test(mas));
  await p.locator('[role="dialog"] [data-nav="vp_ordenes"]').click(); await espera(p, 1000);
  ok("CE4 Órdenes de venta en celular sin desborde", (await p.locator("[data-panel-vp-ordenes]").count()) === 1 && await sinDesborde(p));
  await p.locator(`[data-venta="${ov}"]`).click(); await espera(p, 1500);
  ok("CE5 ficha de venta a pantalla completa con pestañas", (await p.locator('[data-hoja-lateral="ficha-venta"]').count()) === 1 && await sinDesborde(p));
  await p.locator('[data-hoja-lateral="ficha-venta"] [data-tab="pagos"]').click(); await espera(p, 300);
  ok("CE6 pestaña Pagos legible en celular", /Saldo pendiente/.test(await p.locator('[data-hoja-lateral="ficha-venta"]').innerText()) && await sinDesborde(p));
  await p.locator("[data-cerrar-hoja]").click(); await espera(p, 300);
  await p.locator('[data-nav="mas"]').click(); await p.locator('[role="dialog"] [data-nav="vp_cotizaciones"]').click(); await espera(p, 1000);
  ok("CE7 Cotizaciones privadas en celular sin desborde", (await p.locator("[data-panel-vp-cotizaciones]").count()) === 1 && await sinDesborde(p));
  ok("CE8 sin errores de página (celular)", !errs.length, errs.join(" | "));
  await ctx.close();

  // ── 12. Venta directa y anulación con trazabilidad (administrador) ───────────────────────────
  ({ page: p, ctx, errs } = await abrir(browser, { usuario: U.admin, url: URL_APP, hash: "#/panel" }));
  await calma(); const m4 = marca();
  await p.locator("aside [data-boton-nuevo]").click(); await p.locator('[data-nuevo="vp_venta"]').click(); await espera(p, 600);
  const nv = p.locator('[data-ventana="nueva-venta"]');
  await nv.locator('[data-tab="directa"]').click();
  await nv.locator("[data-buscar-cliente]").fill("Maderas"); await nv.locator('[data-opcion-cliente="76.086.428-5"]').click();
  await nv.locator('[data-linea="1"] [data-campo="descripcion"]').fill("Visita técnica"); await nv.locator('[data-linea="1"] [data-campo="precio"]').fill("100000"); await nv.locator('[data-linea="1"] [data-campo="costo"]').fill("40000");
  await nv.locator("[data-crear-venta-directa]").click(); await espera(p, 2500);
  const ov2 = q1(`select folio from public.vp_ventas where origen = 'directa' order by creado_en desc limit 1;`);
  ok("X1 venta directa identificada (sin cotización)", /^OV-/.test(ov2) && /venta directa/.test(await p.locator('[data-hoja-lateral="ficha-venta"]').innerText()));
  await p.locator("[data-anular-venta]").click(); await p.locator("[data-motivo]").fill("Ingresada por error en la prueba"); await p.locator("[data-confirmar-motivo]").click(); await espera(p, 1800);
  ok("X2 anulación conserva el registro y sale de los indicadores", q1(`select estado from public.vp_ventas where folio = '${ov2}';`) === "anulada" && /ANULADA/.test(await p.locator('[data-hoja-lateral="ficha-venta"]').innerText()));
  await p.locator("[data-cerrar-hoja]").click();
  await p.locator('aside [data-nav="finanzas"]').click(); await espera(p, 800);
  await p.locator('[data-canal-filtro="finanzas"] [data-canal="vp"]').click(); await espera(p, 500);
  ok("X3 la venta anulada no suma en Finanzas", (await kv("vp-vendido")) === "$1.043.481");
  ok("X4 historial con estados, usuario y fecha", Number(q1(`select count(*) from public.vp_historial where tabla in ('vp_cotizacion_revisiones','vp_ventas') and usuario_nombre is not null;`)) >= 5);
  ok("X5 sin errores de página (administrador)", !errs.length, errs.join(" | "));
  ok("X6 venta directa y anulación no escribieron en Mercado Público", !escriturasMP(m4).length, JSON.stringify(escriturasMP(m4).map((x) => x.obj)));
  await ctx.close();
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`\nRESUMEN e2e Ventas privadas: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
