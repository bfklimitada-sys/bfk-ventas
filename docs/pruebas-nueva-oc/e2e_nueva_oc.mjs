// «Nueva OC» con la cotización BFK (03/11/2026): importación desde Mercado Público, sugerencias con confirmación,
// búsqueda manual, carga de la cotización, cambio de precios, compra (total, parcial, varios proveedores, venta propia),
// reintentos sin duplicar y casos bloqueados. Escritorio y celular. Supabase y Mercado Público SIMULADOS (nada sale a la red).
// La función cz_guardar_cotizacion_v2 se simula con las mismas reglas que la base (versión, adjudicadas protegidas,
// vendedor responsable); su comportamiento real se valida aparte en validar_vinculo_sql.sh.
// Uso: node docs/pruebas-nueva-oc/e2e_nueva_oc.mjs http://127.0.0.1:4279/
import { chromium, CHROME, crearBase, abrir } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, dias } from "../pruebas-oc/datos_oc.mjs";

const URL_APP = process.argv[2] || "http://127.0.0.1:4279/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
const clon = (x) => JSON.parse(JSON.stringify(x));
const pesos = (s) => (/[-−]/.test(String(s || "")) ? -1 : 1) * Number(String(s || "").replace(/[^0-9]/g, ""));

// ── Datos de prueba ──
const FORM = { confirmada: true, base: "neto", redondeo: "arriba", prorrateo: "valor" };
const cot = (id, o = {}) => ({ id, id_externo: `5602-${id}-COT26`, nombre: "Monitores y teclados para oficina", institucion: "Hospital Ficticio", rut: "61602123-4", direccion_entrega: "Av. Siempre Viva 123",
  comuna: "Los Ángeles", fecha: dias(10), plazo: "10 días", observaciones: null, estado: "presentada", recargo: 0.3, formula: FORM, subtotal_neto: 2000000, impuestos: 380000, total: 2380000,
  costo_neto: 1068899, iva_credito: 203091, oc_codigo: null, version: 3, vendedor_id: "v1", vendedor_nombre: "Vendedor Uno", actualizado_en: dias(5) + "T10:00:00Z", ...o });
const item = (cz, id, orden, nombre, marca, modelo, cantidad, precio, enlace, unit, o = {}) => ({ id, cotizacion_id: cz, orden, producto_id: null, envio_clave: "e1", enlace, enlace_original: null, proveedor: "Falabella",
  disponibilidad: "Stock", fecha_consulta: null, origen_datos: "manual", cantidad, precio_origen: precio, precio_incluye_iva: true, con_factura: true, iva_compra: Math.round(precio * cantidad * 0.19 / 1.19),
  envio_asignado: 0, costo_bruto: precio * cantidad, costo_neto: Math.round(precio * cantidad / 1.19), recargo: null, unitario_venta_neto: unit, especificaciones_aprobadas: { nombre, marca, modelo }, ficha_aprobada: true, ...o });
const envio = (cz, monto = 11990) => ({ id: "env-" + cz, cotizacion_id: cz, clave: "e1", proveedor: "Falabella", origen_publicacion: "web", destino: "Av. Siempre Viva 123, Los Ángeles", monto, con_factura: true,
  cobertura: null, fecha_cotizacion: dias(10), estado_confirmacion: "confirmado", evidencia: "Simulación de compra" });
const COSTO_A = 450000 * 2 + 90000 * 4 + 11990;   // costo cotizado con IVA (productos + despacho una vez)

function datos() {
  const d = crearDatos();
  d.cotizaciones = [
    cot("a"),                                                                                                        // la correcta
    cot("b", { nombre: "Sillas de oficina", institucion: "Liceo Ficticio", rut: "70.111.222-3", total: 900000, vendedor_id: "v2", vendedor_nombre: "Vendedora Dos" }),
    cot("c", { estado: "adjudicada", oc_codigo: "OTRA-9-SE26" }),                                                    // ya es de otra OC
    cot("d", { vendedor_id: null, vendedor_nombre: null, actualizado_en: dias(20) + "T10:00:00Z" }),                 // sin vendedor responsable
    cot("e", { estado: "adjudicada", nombre: "Equipos sala de reuniones", total: 1500000, actualizado_en: dias(8) + "T10:00:00Z" }),
  ];
  d.cotizacion_items = [
    item("a", "it-a1", 1, "Monitor 24 pulgadas", "LG", "24MK430", 2, 450000, "https://falabella.com/monitor-lg", 477307),
    item("a", "it-a2", 2, "Teclado inalámbrico", "Logitech", "K270", 4, 90000, "https://falabella.com/teclado-k270", 95480),
    item("b", "it-b1", 1, "Silla ergonómica", "Ofix", "S1", 6, 120000, "https://paris.cl/silla", 131093),
    item("c", "it-c1", 1, "Monitor 24 pulgadas", "LG", "24MK430", 2, 450000, "https://falabella.com/monitor-lg", 477307),
    item("e", "it-e1", 1, "Proyector", "Epson", "EB-X49", 1, 650000, "https://pcfactory.cl/epson", 700000),
  ];
  d.cotizacion_envios = [envio("a"), envio("b", 0), envio("c"), envio("e", 0)];
  d.cotizacion_versiones = [];
  return d;
}
const ocMP = (numero, o = {}) => ({ numero_oc: numero, nombre_oc: "Monitores y teclados para oficina", codigo_estado: 6, estado_mp: "6", cliente: "HOSPITAL FICTICIO", entidad: "ABASTECIMIENTO",
  rut_cliente: "61.602.123-4", comuna: "LOS ÁNGELES", region: "BIOBÍO", direccion: "Av. Siempre Viva 123", contacto: "Ana · 9999", correo_cliente: "compras@hospital.cl", monto_total: 2380000,
  fecha_envio: dias(1) + "T09:00:00", fecha_creacion: dias(2) + "T09:00:00", tipo_despacho_codigo: "7", tipo_despacho: "Despachar a dirección de envío", forma_pago: "30 días", dias_pago: 30,
  productos: [{ orden: 0, descripcion: "Teclado inalámbrico Logitech K270 USB", cantidad: 4, precio_venta_unitario: 95480, total_linea: 381920, categoria: "Computación" },
    { orden: 1, descripcion: "Monitor LED 24 pulgadas LG 24MK430", cantidad: 2, precio_venta_unitario: 477307, total_linea: 954614, categoria: "Computación" }], ...o });
const MP = {};
for (const n of ["2600-77-SE26", "2600-79-SE26", "2600-80-SE26", "2600-81-SE26", "2600-82-SE26"]) MP[n] = { status: 200, body: { ok: true, oc: ocMP(n) } };
MP["2600-78-SE26"] = { status: 200, body: { ok: true, oc: ocMP("2600-78-SE26", { nombre_oc: "Equipos sala de reuniones", monto_total: 1500000, productos: [{ orden: 0, descripcion: "Proyector Epson EB-X49", cantidad: 1, precio_venta_unitario: 1260504, total_linea: 1260504 }] }) } };
MP["2600-83-SE26"] = { status: 200, body: { ok: true, oc: ocMP("2600-83-SE26", { codigo_estado: 9, estado_mp: "9" }) } };

// ── cz_guardar_cotizacion_v2 simulada (mismas reglas que la base) y búsqueda «or» del listado ──
const nrm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
function rpcCotizacion(b, p, yo) {
  const db = b.db; b.escr.push({ metodo: "RPC", tabla: "cz_guardar_cotizacion_v2", id: p.id, cuerpo: clon(p), n: b.escr.length });
  const err = (status, message) => ({ status, json: { message } });
  const c = db.cotizaciones.find((x) => x.id === p.id); if (!c) return err(404, "Cotización no encontrada");
  if (c.version !== p.version) return err(409, `CZ409: otra persona guardó cambios en esta cotización (versión ${c.version}). Recarga antes de guardar.`);
  const admin = (db.perfiles || []).some((x) => x.id === yo && x.rol === "admin");
  const its = db.cotizacion_items.filter((i) => i.cotizacion_id === c.id).sort((a, z) => a.orden - z.orden);
  if (c.estado === "adjudicada") {
    if ((p.estado ?? c.estado) !== "adjudicada" && !admin) return err(403, "CZ423: solo un administrador puede cambiar el estado de una cotización adjudicada.");
    if (c.oc_codigo != null && String(p.oc_codigo || "") !== c.oc_codigo && !admin) return err(403, "CZ423: el vínculo con la OC de una cotización adjudicada solo lo cambia un administrador.");
    const o = JSON.stringify(its.map((i) => [String(i.id).toLowerCase(), Number(i.cantidad), Number(i.unitario_venta_neto), nrm(i.especificaciones_aprobadas?.marca), nrm(i.especificaciones_aprobadas?.modelo)]));
    const n = JSON.stringify((p.items || []).map((x) => [String(x.key || "").toLowerCase(), Number(x.cantidad), Number(x.unitario_venta_neto || 0), nrm(x.ficha?.marca), nrm(x.ficha?.modelo)]));
    if (o !== n) return err(403, "CZ423: la cotización está adjudicada: los productos ofertados (líneas, marca, modelo), sus cantidades y precios no se pueden modificar ni sustituir.");
  }
  if (["presentada", "adjudicada"].includes(p.estado) && !c.vendedor_id && p.estado !== c.estado) return err(400, "CZ_VENDEDOR: no se puede adjudicar una cotización sin vendedor responsable. Asígnalo en Datos.");
  for (const k of ["id_externo", "nombre", "institucion", "rut", "direccion_entrega", "comuna", "plazo", "observaciones", "subtotal_neto", "impuestos", "total", "costo_neto", "iva_credito"]) c[k] = p[k] ?? null;
  if (p.fecha) c.fecha = p.fecha; if (p.estado) c.estado = p.estado; if (p.recargo != null) c.recargo = p.recargo;
  c.formula = p.formula ?? null; c.oc_codigo = String(p.oc_codigo || "") || null; c.version += 1; c.actualizado_en = new Date().toISOString();
  db.cotizacion_items = db.cotizacion_items.filter((i) => i.cotizacion_id !== c.id).concat((p.items || []).map((x, k) => ({ id: x.key, cotizacion_id: c.id, orden: k + 1, producto_id: x.producto_id ?? null,
    envio_clave: x.envio_key ?? null, enlace: x.enlace ?? null, enlace_original: x.enlace_original ?? null, proveedor: x.proveedor ?? null, disponibilidad: x.disponibilidad ?? null, fecha_consulta: x.fecha_consulta ?? null,
    origen_datos: x.origen_datos ?? null, cantidad: x.cantidad, precio_origen: x.precio_origen ?? 0, precio_incluye_iva: x.precio_incluye_iva ?? true, con_factura: x.con_factura ?? true, iva_compra: x.iva_compra ?? 0,
    envio_asignado: x.envio_asignado ?? 0, costo_bruto: x.costo_bruto ?? 0, costo_neto: x.costo_neto ?? 0, recargo: x.recargo ?? null, unitario_venta_neto: x.unitario_venta_neto ?? 0, especificaciones_aprobadas: x.ficha ?? {}, ficha_aprobada: x.ficha_aprobada ?? false })));
  const idEnv = Object.fromEntries(db.cotizacion_envios.filter((e) => e.cotizacion_id === c.id).map((e) => [e.clave, e.id]));
  db.cotizacion_envios = db.cotizacion_envios.filter((e) => e.cotizacion_id !== c.id).concat((p.envios || []).map((e) => ({ id: idEnv[e.key] || "env-n", cotizacion_id: c.id, clave: e.key, proveedor: e.proveedor ?? null,
    origen_publicacion: e.origen_publicacion ?? null, destino: e.destino ?? null, monto: e.monto ?? 0, con_factura: e.con_factura ?? true, cobertura: e.cobertura ?? null, fecha_cotizacion: e.fecha_cotizacion ?? null, estado_confirmacion: e.estado ?? "pendiente", evidencia: e.evidencia ?? null })));
  db.cotizacion_versiones.push({ cotizacion_id: c.id, version: c.version });
  return { status: 200, json: { id: c.id, version: c.version } };
}
async function rutasCotizaciones(page, b, yo, { fallarVinculo = 0, fallarCompra = 0 } = {}) {
  let fv = fallarVinculo, fc = fallarCompra;
  await page.route("**/rest/v1/rpc/cz_guardar_cotizacion_v2", async (route) => {
    const p = JSON.parse(route.request().postData() || "{}").p;
    if (fv > 0) { fv--; const c = b.db.cotizaciones.find((x) => x.id === p.id); if (c) c.version += 1; return route.fulfill({ status: 409, json: { message: `CZ409: otra persona guardó cambios en esta cotización (versión ${c?.version}). Recarga antes de guardar.` } }); }
    const r = rpcCotizacion(b, p, yo); return route.fulfill({ status: r.status, json: r.json });
  });
  await page.route("**/rest/v1/rpc/registrar_compra_oc", async (route) => { if (fc > 0) { fc--; return route.fulfill({ status: 503, json: { message: "falla simulada de red" } }); } return route.fallback(); });
  // Listado del módulo (búsqueda manual): or=(id_externo.ilike.*x*,nombre.ilike.*x*,institucion.ilike.*x*)
  await page.route(/\/rest\/v1\/cotizaciones\?.*\bor=/, async (route) => {
    const q = new URL(route.request().url()).searchParams; const m = (q.get("or") || "").match(/^\((.*)\)$/);
    const conds = m ? m[1].split(",").map((x) => x.match(/^(\w+)\.ilike\.\*?(.*?)\*?$/)).filter(Boolean) : [];
    const filas = b.db.cotizaciones.filter((c) => conds.some(([, col, pat]) => String(c[col] || "").toLowerCase().includes(decodeURIComponent(pat).toLowerCase())));
    return route.fulfill({ json: clon(filas).map((c) => ({ ...c, cotizacion_items: [{ count: b.db.cotizacion_items.filter((i) => i.cotizacion_id === c.id).length }] })), headers: { "access-control-expose-headers": "content-range", "content-range": `0-${filas.length}/${filas.length}` } });
  });
}

// ── Utilidades de interfaz ──
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const modal = (p) => p.locator('[role="dialog"]').last();
async function preparar({ movil = false, usuario = "u2", ...opts } = {}) {
  const d0 = datos(); const b = crearBase(clon(d0), { mp: MP });
  const r = await abrir(browser, b, { url: URL_APP, usuario, ancho: movil ? 390 : 1366, alto: movil ? 844 : 900, movil, espera: 2500 });
  await rutasCotizaciones(r.page, b, usuario, opts);
  return { ...r, p: r.page, b, d0 };
}
async function abrirNuevaOC(p, codigo, { vendedor = null, ventaPropia = false } = {}) {
  await p.locator("button:visible", { hasText: /^\+ Nueva OC$/ }).first().click(); await espera(p, 500);
  const m = modal(p);
  if (vendedor !== null) await m.locator("select").first().selectOption(vendedor);
  if (ventaPropia) { await m.getByText("Es venta propia del vendedor").click(); }
  await m.locator('input[placeholder="ej: 3013-587-AG26"]').fill(codigo);
  await m.getByRole("button", { name: /Buscar OC/ }).click(); await espera(p, 1600);
  return m;
}
const escrDesde = (b, n, f = () => true) => b.escr.slice(n).filter(f);
const escrituras = (b, n) => escrDesde(b, n, (w) => !["mp_cache_avisos", "mp_uso_diario", "historial_cambios"].includes(w.tabla) && !(w.metodo === "RPC" && ["gestionar_bloqueo_oc", "registrar_entidad_desde_oc", "conciliar_contactos_oc"].includes(w.tabla)));
const ocDe = (b, n) => b.db.ordenes_compra_v2.find((o) => o.numero_oc === n);
const comprasDe = (b, oc) => b.db.eventos_compra.filter((e) => e.oc_id === oc?.id);
const lineas = (b, oc, origen) => b.db.oc_productos_link.filter((l) => l.oc_id === oc?.id && l.origen === origen);
// La cotización (cabecera sin estado/OC/versión, líneas y despachos) sin cambios respecto de la base inicial.
const fotoCot = (db, id) => { const c = db.cotizaciones.find((x) => x.id === id); const { estado, oc_codigo, version, actualizado_en, ...cab } = c; // eslint-disable-line no-unused-vars
  return JSON.stringify({ cab, its: db.cotizacion_items.filter((i) => i.cotizacion_id === id).sort((a, z) => a.orden - z.orden), env: db.cotizacion_envios.filter((e) => e.cotizacion_id === id) }); };
// CAPTURAS=<carpeta>: guarda imágenes de los pasos principales (revisión visual; alto amplio para ver todo el formulario).
const CAPTURAS = process.env.CAPTURAS || "";
async function captura(p, nombre) {
  if (!CAPTURAS) return; const v = p.viewportSize();
  await p.setViewportSize({ width: v.width, height: 2600 }); await espera(p, 400);
  await p.screenshot({ path: `${CAPTURAS}/${nombre}.png` }); await p.setViewportSize(v); await espera(p, 200);
}
const sinDesborde = (p) => p.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return document.documentElement.scrollWidth <= window.innerWidth + 1 && (!d || [...d.querySelectorAll("*")].every((x) => x.getBoundingClientRect().right <= window.innerWidth + 1)); });

// ═════ 1. Escritorio: sugerencias, búsqueda manual, precios reales, varios proveedores y registro de la compra ═════
{
  const { p, ctx, errs, b, d0 } = await preparar();
  const n0 = b.escr.length;
  const m = await abrirNuevaOC(p, "2600-77-SE26");
  await m.locator("[data-sugerencia]").first().waitFor({ timeout: 8000 }).catch(() => {});
  const sug = await m.locator("[data-sugerencia]").evaluateAll((xs) => xs.map((x) => x.getAttribute("data-sugerencia")));
  ok("E01_importa_oc_y_busca_cotizaciones", /HOSPITAL FICTICIO/.test(await m.innerText()) && (await m.locator("[data-cotizacion-nueva-oc]").count()) === 1);
  ok("E02_sugiere_la_correcta_primero", sug[0] === "a" && !sug.includes("b") && !sug.includes("c"), sug);
  ok("E03_motivos_y_confianza_visibles", /Mismo RUT del comprador/.test(await m.locator('[data-sugerencia="a"] [data-motivos]').innerText()) && (await m.locator('[data-sugerencia="a"] [data-confianza="alta"]').count()) === 1);
  ok("E04_sin_vendedor_no_vinculable", (await m.locator('[data-sugerencia="d"] [data-no-vinculable]').count()) === 1 && (await m.locator('[data-usar-cotizacion="d"]').count()) === 0);
  ok("E05_no_asocia_sin_confirmacion", (await m.locator("[data-cotizacion-seleccionada]").count()) === 0 && (await m.locator("[data-modo-guardado]").count()) === 0);
  ok("E06_sugerir_no_escribe_nada", escrituras(b, n0).length === 0, escrituras(b, n0));
  await captura(p, "1-escritorio-sugerencias");
  // Búsqueda manual
  await m.locator("[data-buscar-cotizacion]").fill("5602-b"); await m.locator("[data-boton-buscar-cotizacion]").click(); await espera(p, 900);
  ok("E07_busqueda_manual_encuentra", (await m.locator('[data-resultado-busqueda="b"] [data-usar-cotizacion="b"]').count()) === 1);
  await m.locator("[data-buscar-cotizacion]").fill("5602-c"); await m.locator("[data-boton-buscar-cotizacion]").click(); await espera(p, 900);
  ok("E08_vinculada_a_otra_oc_no_se_usa", /Ya está vinculada a la OC OTRA-9-SE26/.test(await m.locator('[data-resultado-busqueda="c"]').innerText()) && (await m.locator('[data-usar-cotizacion="c"]').count()) === 0);
  // Elegir otra primero y cambiarla: los enlaces de la primera no quedan pegados.
  await m.locator('[data-usar-cotizacion="e"]').click(); await espera(p, 1200);
  const linksE = await m.locator("[data-link-oc]").evaluateAll((xs) => xs.map((x) => x.value));
  await m.locator("[data-cambiar-cotizacion]").click(); await espera(p, 600);
  const linksSin = await m.locator("[data-link-oc]").evaluateAll((xs) => xs.map((x) => x.value));
  ok("E08b_cambiar_cotizacion_reemplaza_enlaces", linksE.join() === "https://pcfactory.cl/epson,https://pcfactory.cl/epson" && linksSin.join() === "" && (await m.locator("[data-sugerencia]").count()) >= 2, { linksE, linksSin });
  // Elegir la sugerida
  await m.locator('[data-usar-cotizacion="a"]').click(); await espera(p, 1200);
  ok("E09_cotizacion_cargada", (await m.locator('[data-cotizacion-seleccionada="a"]').count()) === 1 && /adjudicada y vinculada a esta OC/.test(await m.locator("[data-efecto-vinculo]").innerText()));
  const links = await m.locator("[data-link-oc]").evaluateAll((xs) => xs.map((x) => x.value));
  ok("E10_enlaces_desde_la_cotizacion_por_producto", links.join() === "https://falabella.com/teclado-k270,https://falabella.com/monitor-lg", links);
  await captura(p, "2-escritorio-solo-oc");
  ok("E11_resumen_solo_oc_por_defecto", (await m.locator("[data-resumen-cotizacion]").count()) === 1 && pesos(await m.locator("[data-costo-cotizado]").innerText()) === COSTO_A && pesos(await m.locator("[data-utilidad-estimada]").innerText()) === 2380000 - COSTO_A);
  // Compra real
  await m.locator('[data-modo="con_compra"]').click(); await espera(p, 600);
  const filas = m.locator("[data-fila-compra]");
  ok("E12_carga_productos_cantidades_proveedor_enlace_despacho", (await filas.count()) === 2 && (await filas.nth(0).locator('[data-campo-compra="enlace"]').inputValue()) === "https://falabella.com/monitor-lg"
    && (await filas.nth(1).locator('[data-campo-compra="cantidad"]').inputValue()) === "4" && /Despacho cotizado \$11\.990/.test(await m.locator("[data-despachos]").innerText()));
  await filas.nth(0).locator('[data-campo-compra="unitario"]').fill("480000"); await espera(p, 300);
  await filas.nth(1).locator('[data-campo-compra="proveedor"]').fill("Paris"); await filas.nth(1).locator('[data-campo-compra="enlace"]').fill("https://paris.cl/teclado-k270"); await espera(p, 300);
  ok("E13_cambio_destacado_con_referencia", /Cotizado: \$450\.000/.test(await filas.nth(0).innerText()) && /Cotizado: Falabella/.test(await filas.nth(1).innerText()));
  ok("E14_compara_y_actualiza_utilidad", pesos(await m.locator("[data-diferencia-total]").innerText()) === 60000
    && pesos(await m.locator("[data-utilidad-original]").innerText()) - pesos(await m.locator("[data-utilidad-actualizada]").innerText()) === 60000, await m.locator("[data-comparacion]").innerText());
  await captura(p, "3-escritorio-compra-real");
  ok("E15_dos_pedidos_despacho_una_vez", (await m.locator("[data-pedido]").count()) === 2 && (await m.locator("[data-despachos]").innerText()).match(/Despacho cotizado \$11\.990/g).length === 1);
  let n = b.escr.length;
  await m.locator("[data-crear-oc-y-compra]").click(); await espera(p, 800);
  const errTxt = await m.locator("[data-errores-compra]").innerText().catch(() => "");
  ok("E16_exige_financiador_y_confirmacion", /Selecciona el financiador/.test(errTxt) && /realizó efectivamente/.test(errTxt) && escrituras(b, n).length === 0 && !ocDe(b, "2600-77-SE26"), errTxt);
  await m.locator('[data-campo-compra="financiador"]').selectOption("f1");
  await m.locator('[data-confirmar="compra-efectiva"] input').check();
  n = b.escr.length;
  await m.locator("[data-crear-oc-y-compra]").evaluate((x) => { x.click(); x.click(); }); await espera(p, 4000);
  const oc = ocDe(b, "2600-77-SE26"); const ev = comprasDe(b, oc);
  ok("E17_una_oc_creada", b.db.ordenes_compra_v2.filter((o) => o.numero_oc === "2600-77-SE26").length === 1 && oc.monto_total === 2380000 && oc.vendedor_id === "v1");
  ok("E18_una_compra_por_proveedor_costo_real", ev.length === 2 && ev.map((e) => `${e.proveedor}:${e.costo_compra}`).sort().join() === `Falabella:${960000 + 11990},Paris:360000` && ev.every((e) => e.financiador_id === "f1" && /Pedido P[A-Z0-9]+-\d · desde cotización 5602-a-COT26/.test(e.notas)), ev.map((e) => [e.proveedor, e.costo_compra, e.notas]));
  const comp = lineas(b, oc, "compra");
  ok("E19_productos_comprados_y_despacho_una_vez", comp.length === 3 && comp.filter((l) => /^Despacho/.test(l.descripcion)).length === 1 && comp.some((l) => l.url === "https://paris.cl/teclado-k270") && comp.every((l) => l.precio_venta === null), comp.map((l) => [l.descripcion, l.precio_compra, l.url]));
  const vend = lineas(b, oc, "venta");
  ok("E20_vendido_desde_mp_con_enlaces_de_la_cotizacion", vend.length === 2 && vend.map((l) => l.url).join() === "https://falabella.com/teclado-k270,https://falabella.com/monitor-lg", vend.map((l) => [l.descripcion, l.url]));
  const c = b.db.cotizaciones.find((x) => x.id === "a");
  ok("E21_cotizacion_adjudicada_y_vinculada", c.estado === "adjudicada" && c.oc_codigo === "2600-77-SE26" && c.version === 4);
  ok("E22_cotizacion_precios_y_lineas_intactos", fotoCot(b.db, "a") === fotoCot(d0, "a"));
  ok("E23_costo_y_deuda_una_vez", oc.costo_total === 960000 + 11990 + 360000 && escrDesde(b, n, (w) => w.tabla === "registrar_compra_oc").length === 2 && escrDesde(b, n, (w) => w.tabla === "ordenes_compra_v2" && w.metodo === "POST").length === 1);
  ok("E24_historial_vinculo_y_compra", b.db.historial_cambios.some((h) => h.oc_id === oc.id) && escrDesde(b, n, (w) => w.tabla === "historial_cambios" && /vinculada desde Nueva OC \(marcada adjudicada\)/.test(w.cuerpo?.accion || "")).length === 1);
  ok("E25_modal_cerrado", (await p.locator('[role="dialog"]').count()) === 0);
  // «Registrar otra compra» en la OC: reconoce la cotización vinculada y que todo está comprado.
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  await p.locator('[data-oc="2600-77-SE26"] > div').first().click(); await espera(p, 1300);
  if (!(await p.getByRole("button", { name: /Registrar otra compra/ }).count())) { await p.locator("[data-indice-ficha] button", { hasText: "Compra y financiamiento" }).first().click().catch(() => {}); await espera(p, 500); }
  await p.getByRole("button", { name: /Registrar otra compra/ }).first().click(); await espera(p, 1500);
  ok("E26_ficha_reconoce_cotizacion_y_compra", (await modal(p).locator("[data-compra-cotizacion]").count()) === 1 && (await modal(p).locator("[data-todo-comprado]").count()) === 1);
  ok("E27_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ 2. Escritorio: guardar SOLO la OC (sin compra) con la cotización adjudicada sugerida ═════
{
  const { p, ctx, errs, b, d0 } = await preparar({ usuario: "u1" });
  const m = await abrirNuevaOC(p, "2600-78-SE26", { vendedor: "v2" });
  await m.locator('[data-sugerencia="e"]').waitFor({ timeout: 8000 }).catch(() => {});
  ok("O01_sugiere_adjudicada_sin_oc", (await m.locator("[data-sugerencia]").first().getAttribute("data-sugerencia")) === "e");
  await m.locator('[data-usar-cotizacion="e"]').click(); await espera(p, 1200);
  ok("O02_ya_adjudicada_solo_se_vincula", /quedará vinculada a esta OC/.test(await m.locator("[data-efecto-vinculo]").innerText()) && !/adjudicada y/.test(await m.locator("[data-efecto-vinculo]").innerText()));
  ok("O03_avisa_vendedor_distinto", (await m.locator("[data-aviso-vendedor]").count()) === 1);
  const n = b.escr.length;
  await m.locator("[data-crear-oc]").click(); await espera(p, 3000);
  const oc = ocDe(b, "2600-78-SE26");
  ok("O04_oc_creada_sin_compra_ni_deuda", !!oc && comprasDe(b, oc).length === 0 && escrDesde(b, n, (w) => w.tabla === "registrar_compra_oc").length === 0 && (oc.costo_total || 0) === 0);
  const c = b.db.cotizaciones.find((x) => x.id === "e");
  ok("O05_vinculada_sin_cambiar_precios", c.oc_codigo === "2600-78-SE26" && c.estado === "adjudicada" && fotoCot(b.db, "e") === fotoCot(d0, "e"));
  ok("O06_solo_un_guardado_de_cotizacion", escrDesde(b, n, (w) => w.tabla === "cz_guardar_cotizacion_v2").length === 1);
  ok("O07_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ 3. Celular: compra PARCIAL, falla de red al registrar y reintento sin duplicar OC, vínculo ni compra ═════
{
  const { p, ctx, errs, b, d0 } = await preparar({ movil: true, fallarCompra: 1 });
  const m = await abrirNuevaOC(p, "2600-79-SE26");
  await m.locator('[data-usar-cotizacion="a"]').waitFor({ timeout: 8000 }).catch(() => {});
  await m.locator('[data-usar-cotizacion="a"]').click(); await espera(p, 1200);
  await m.locator('[data-modo="con_compra"]').click(); await espera(p, 600);
  ok("M01_sin_desborde_horizontal", await sinDesborde(p));
  const filas = m.locator("[data-fila-compra]");
  await filas.nth(0).locator('[data-campo-compra="cantidad"]').fill("1");
  await filas.nth(1).locator('[data-campo-compra="cantidad"]').fill("0"); await espera(p, 300);
  await captura(p, "4-celular-compra-parcial");
  ok("M02_parcial_rentabilidad_no_definitiva", (await m.locator("[data-aviso-parcial]").count()) === 1);
  await m.locator('[data-campo-compra="financiador"]').selectOption("f2");
  await m.locator('[data-confirmar="compra-efectiva"] input').check();
  await m.locator("[data-crear-oc-y-compra]").click(); await espera(p, 3500);
  const oc = ocDe(b, "2600-79-SE26");
  const txt = await m.locator("[data-errores-compra]").innerText().catch(() => "");
  ok("M03_falla_informada_oc_creada_y_vinculada", !!oc && /quedó creada y vinculada/.test(txt) && /Puedes reintentar/.test(txt) && comprasDe(b, oc).length === 0 && (await m.locator("[data-aviso-oc-creada]").count()) === 1, txt);
  await captura(p, "5-celular-falla-y-reintento");
  ok("M04_no_permite_cambiar_cotizacion_ni_volver", (await m.locator("[data-cambiar-cotizacion]").count()) === 0 && await m.getByRole("button", { name: /Atrás/ }).isDisabled());
  const n = b.escr.length;
  await m.locator("[data-crear-oc-y-compra]").click(); await espera(p, 3500);
  const ev = comprasDe(b, ocDe(b, "2600-79-SE26"));
  ok("M05_reintento_una_oc_una_compra", b.db.ordenes_compra_v2.filter((o) => o.numero_oc === "2600-79-SE26").length === 1 && ev.length === 1 && ev[0].costo_compra === 450000 + 11990 && ev[0].financiador_id === "f2", ev);
  ok("M06_reintento_no_vuelve_a_guardar_la_cotizacion", escrDesde(b, n, (w) => w.tabla === "cz_guardar_cotizacion_v2").length === 0 && escrDesde(b, n, (w) => w.tabla === "ordenes_compra_v2" && w.metodo === "POST").length === 0);
  ok("M07_cotizacion_intacta", fotoCot(b.db, "a") === fotoCot(d0, "a") && b.db.cotizaciones.find((x) => x.id === "a").oc_codigo === "2600-79-SE26");
  ok("M08_parcial_queda_pendiente", lineas(b, ocDe(b, "2600-79-SE26"), "compra").filter((l) => !/^Despacho/.test(l.descripcion)).map((l) => l.cantidad).join() === "1");
  ok("M09_modal_cerrado", (await p.locator('[role="dialog"]').count()) === 0);
  ok("M10_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ 4. Celular: venta propia (sin financiador) ═════
{
  const { p, ctx, errs, b } = await preparar({ movil: true });
  const m = await abrirNuevaOC(p, "2600-82-SE26", { vendedor: "v1", ventaPropia: true });
  await m.locator('[data-usar-cotizacion="a"]').waitFor({ timeout: 8000 }).catch(() => {});
  await m.locator('[data-usar-cotizacion="a"]').click(); await espera(p, 1200);
  await m.locator('[data-modo="con_compra"]').click(); await espera(p, 600);
  ok("P01_no_pide_financiador", (await m.locator("[data-financiador-venta-propia]").count()) === 1 && (await m.locator('[data-campo-compra="financiador"]').count()) === 0);
  await m.locator('[data-confirmar="compra-efectiva"] input').check();
  await m.locator("[data-crear-oc-y-compra]").click(); await espera(p, 3500);
  const oc = ocDe(b, "2600-82-SE26"); const ev = comprasDe(b, oc);
  ok("P02_venta_propia_sin_deuda", oc?.es_venta_propia === true && !oc.financiador_id && ev.length === 1 && ev[0].costo_compra === COSTO_A && oc.estado_pago_financiamiento === "no_aplica", { oc, ev });
  ok("P03_sin_desborde_y_sin_errores", (await sinDesborde(p)) && !errs.length, errs);
  await ctx.close();
}

// ═════ 5. Escritorio: el vínculo falla (otra persona guardó la cotización) y se reintenta sin duplicar la OC ═════
{
  const { p, ctx, errs, b, d0 } = await preparar({ fallarVinculo: 1 });
  const m = await abrirNuevaOC(p, "2600-81-SE26");
  await m.locator('[data-usar-cotizacion="a"]').waitFor({ timeout: 8000 }).catch(() => {});
  await m.locator('[data-usar-cotizacion="a"]').click(); await espera(p, 1200);
  await m.locator("[data-crear-oc]").click(); await espera(p, 2500);
  const e1 = await m.locator("[data-error-nueva-oc]").innerText().catch(() => "");
  ok("V01_falla_vinculo_informada", /quedó creada, pero la cotización 5602-a-COT26 no se vinculó/.test(e1) && /Otra persona guardó cambios/.test(e1) && !!ocDe(b, "2600-81-SE26") && !b.db.cotizaciones.find((x) => x.id === "a").oc_codigo, e1);
  ok("V02_boton_reintentar", /Reintentar vínculo/.test(await m.locator("[data-crear-oc]").innerText()));
  await m.locator("[data-crear-oc]").click(); await espera(p, 2500);
  ok("V03_reintento_vincula_sin_duplicar_oc", b.db.ordenes_compra_v2.filter((o) => o.numero_oc === "2600-81-SE26").length === 1 && b.db.cotizaciones.find((x) => x.id === "a").oc_codigo === "2600-81-SE26" && fotoCot(b.db, "a") === fotoCot(d0, "a"));
  ok("V04_sin_errores", !errs.length, errs);
  await ctx.close();
}

// ═════ 6. Escritorio: sin cotización (flujo anterior) y OC cancelada (no se registra compra) ═════
{
  const { p, ctx, errs, b } = await preparar();
  let m = await abrirNuevaOC(p, "2600-80-SE26");
  await m.locator("[data-sin-cotizacion-oc]").waitFor({ timeout: 8000 }).catch(() => {});
  await m.locator("[data-sin-cotizacion-oc]").click(); await espera(p, 300);
  ok("N01_sin_cotizacion_formulario_anterior", (await m.locator("[data-modo-guardado]").count()) === 0 && /^✓ Crear OC$/.test((await m.locator("[data-crear-oc]").innerText()).trim()));
  let n = b.escr.length;
  await m.locator("[data-crear-oc]").click(); await espera(p, 500);
  ok("N02_sigue_exigiendo_link", /al menos un link/.test(await m.innerText()) && escrituras(b, n).length === 0);
  await m.locator('input[placeholder="https://…"]').first().fill("https://tienda.cl/x");
  // Teléfono del contacto: Mercado Público no lo entrega; se copia desde el portal y se valida.
  ok("T01_campo_telefono_visible_vacio", (await m.locator("[data-telefono-contacto]").inputValue()) === "" && /no lo entrega automáticamente/.test(await m.innerText()));
  await m.locator("[data-telefono-contacto]").fill("abc"); n = b.escr.length; await m.locator("[data-crear-oc]").click(); await espera(p, 500);
  ok("T02_telefono_invalido_no_guarda", /solo admite números/.test(await m.innerText()) && escrituras(b, n).length === 0);
  await m.locator("[data-telefono-contacto]").fill("56-65-2240404");
  n = b.escr.length; await m.locator("[data-crear-oc]").click(); await espera(p, 2500);
  ok("T03_contacto_guardado_con_telefono", ocDe(b, "2600-80-SE26")?.contacto === "Ana · 56-65-2240404", ocDe(b, "2600-80-SE26")?.contacto);
  ok("N03_crea_oc_sin_tocar_cotizaciones_ni_compras", !!ocDe(b, "2600-80-SE26") && escrDesde(b, n, (w) => /^cz_|registrar_compra_oc/.test(w.tabla)).length === 0 && b.db.cotizaciones.every((c) => c.id === "c" ? c.oc_codigo === "OTRA-9-SE26" : !c.oc_codigo));
  m = await abrirNuevaOC(p, "2600-83-SE26");
  await m.locator('[data-usar-cotizacion="a"]').waitFor({ timeout: 8000 }).catch(() => {});
  await m.locator('[data-usar-cotizacion="a"]').click(); await espera(p, 1200);
  await m.locator('[data-modo="con_compra"]').click(); await espera(p, 600);
  ok("N04_cancelada_bloquea_compra", (await m.locator("[data-bloqueo-compra]").count()) === 1);
  await m.locator('[data-confirmar="compra-efectiva"] input').check(); await m.locator('[data-campo-compra="financiador"]').selectOption("f1");
  n = b.escr.length; await m.locator("[data-crear-oc-y-compra]").click(); await espera(p, 1200);
  ok("N05_cancelada_no_escribe", escrituras(b, n).length === 0 && !ocDe(b, "2600-83-SE26"));
  ok("N06_sin_errores", !errs.length, errs);
  await ctx.close();
}

await browser.close();
console.log(`\nRESUMEN e2e Nueva OC: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
