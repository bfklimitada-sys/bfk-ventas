// Cotización privada con la MISMA experiencia que la de Mercado Público — recorrido completo en navegador real, en ESCRITORIO
// (1440 px) y CELULAR (390 px), contra PostgREST REAL sobre una base desechable con las migraciones del 06/11 y del 08/11:
//   crear → ingresar productos y fichas técnicas (manual, con foto y despacho; desde la biblioteca; un servicio) → calcular precios
//   → guardar → reabrir → editar → vista previa de EETT y PDF de la cotización → registrar envío → nueva revisión → aceptación →
//   EETT emitida desde las fichas → convertir en venta. Comprueba persistencia en la base en cada paso, permisos de costos,
//   que no se escribe nada en Mercado Público y que no hay desborde en el celular.
// Además toma capturas comparativas del editor de Mercado Público (simulado, el de siempre) y del editor privado (CAPTURAS=carpeta).
// Uso: (entorno.sh instalar) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-ventas-privadas/e2e_cotizacion_como_mp.mjs http://127.0.0.1:4330/
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { abrir, chromium, CHROME, U, psql, comoUsuario, sinDesborde, calma, marca, escriturasMP } from "./arnes_vp.mjs";
import { crearBase, abrir as abrirMP } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "../pruebas-cotizaciones/modulo_simulado.mjs";
import * as ui from "./ui_cotizacion_vp.mjs";
import { calcularCotizacionVP, cotizacionParaEditor, precioConRecargo } from "../../src/lib/vpCotizacion.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
const CAPT = process.env.CAPTURAS || "/tmp/capturas-vp-mp"; mkdirSync(CAPT, { recursive: true });
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, String(det).slice(0, 500)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const pdfjsMod = await import("pdfjs-dist/legacy/build/pdf.js"); const pdfjs = pdfjsMod.getDocument ? pdfjsMod : pdfjsMod.default;
async function textoPDF(buf) { const d = await pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise; let s = ""; for (let i = 1; i <= d.numPages; i++) s += (await (await d.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ") + "\n"; return s; }
let ultimoArchivo = "";   // nombre con que se descargó el último PDF
async function descarga(p, accion) { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), accion()]); ultimoArchivo = dl.suggestedFilename(); return readFileSync(await dl.path()); }
// Plazo de entrega largo (09/11/2026): debe leerse completo en la EETT de ambos canales y en el PDF de la cotización.
const LARGO = "15 días hábiles contados desde la recepción conforme de la orden de compra, sujeto a disponibilidad de stock del proveedor y despacho a la dirección indicada por el cliente en Laja";
const contiene = (texto, frase) => texto.replace(/\s+/g, " ").includes(frase);
// Sin Inteligencia Comercial, sincronizaciones ni IA: ninguna llamada a estos servicios durante los recorridos.
const PROHIBIDAS = /\/api\/(inteligencia|interpretar|compra-agil)/;
const vigilar = (p) => { const vistas = []; p.on("request", (r) => { if (PROHIBIDAS.test(r.url())) vistas.push(r.url().replace(/\?.*/, "")); }); return vistas; };
const captura = async (p, nombre) => { await espera(p, 350); await p.screenshot({ path: `${CAPT}/${nombre}.png` }); };
// La ventana del producto se captura desde arriba (como la de Mercado Público), aunque se haya llenado hasta abajo.
const alInicioDeVentana = (p) => p.locator("[data-editor-ficha]").evaluate((e) => { let x = e; while (x && !(x.scrollHeight > x.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(x).overflowY))) x = x.parentElement; if (x) x.scrollTop = 0; });

// Cliente (registro compartido) y una ficha en la biblioteca compartida (la misma que usa Mercado Público).
const cliente = JSON.parse(psql(`${comoUsuario(U.ana)}select public.vp_guardar_cliente('${JSON.stringify({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", giro: "Aserradero",
  contacto_nombre: "Rosa Pérez", contacto_correo: "rosa@maderas.invalid", contacto_telefono: "+56 9 1111 2222", direccion_entrega: "Planta km 5", comuna_entrega: "Laja", condiciones_pago: "50% anticipo y saldo a 30 días", plazo_pago_dias: 30 })}'::jsonb);`).split("\n").pop());
psql(`insert into public.productos_catalogo (nombre, marca, modelo, especificaciones, caracteristicas, imagenes, estado, creado_por, ultima_revision)
      values ('Manguera 1 pulgada (prueba)', 'Flexi', 'PVC-1', '[{"etiqueta":"Diámetro","valor":"1 pulgada"},{"etiqueta":"Presión máxima","valor":"8 bar"}]', '[{"etiqueta":"Material","valor":"PVC"}]', '[]', 'aprobado', '${U.ana}', now());`);

const BOMBA = { nombre: "Bomba centrífuga 2 HP", marca: "Pedrollo", modelo: "CPm 680", color: "Azul", generales: "Material: Hierro fundido\nGarantía: 12 meses", especificaciones: "Potencia: 2 HP\nCaudal máximo: 160 L/min",
  descripcion: "Bomba para riego y uso industrial liviano.", foto: true, enlace: "https://tienda.invalid/bomba-cpm680", proveedor: "Ferretería Sur", cantidad: 2, unidad: "UN", codigo: "BOM-01", precio: 285600, incluyeIva: true,
  despacho: { modo: "propio", monto: 23800, estado: "confirmado", evidencia: "Simulación de compra a Planta km 5, Laja" } };

async function irACotizaciones(p, movil) {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="vp_cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="vp_cotizaciones"]').click();
  await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 500);
}
const leerEditor = (folio) => { // estado de la base, leído con las mismas funciones del editor
  const datos = JSON.parse(q1(`select jsonb_build_object('revisiones', (select jsonb_agg(to_jsonb(r)) from public.vp_cotizacion_revisiones r where r.cotizacion_id = c.id), 'items', (select jsonb_agg(to_jsonb(i)) from public.vp_cotizacion_items i join public.vp_cotizacion_revisiones r on r.id = i.revision_id where r.cotizacion_id = c.id),
     'costos', (select jsonb_agg(to_jsonb(k)) from public.vp_cotizacion_item_costos k join public.vp_cotizacion_items i on i.id = k.item_id join public.vp_cotizacion_revisiones r on r.id = i.revision_id where r.cotizacion_id = c.id), 'rev', (select r.id from public.vp_cotizacion_revisiones r where r.cotizacion_id = c.id and r.numero = c.revision_actual)) from public.vp_cotizaciones c where c.folio = '${folio}';`));
  return { ...cotizacionParaEditor({ ...datos, costos: datos.costos || [] }, datos.rev), revisionId: datos.rev };
};

async function recorrido(browser, { pref, ancho, alto, movil }) {
  const { page: p, ctx, errs } = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", ancho, alto, movil });
  const h = ui.hoja(p); const nombre = movil ? "celular" : "escritorio"; const llamadas = vigilar(p);
  await calma(); const m0 = marca(); const desborde = [];
  const revisarDesborde = async (donde) => { if (movil && !(await sinDesborde(p))) desborde.push(donde); };
  await irACotizaciones(p, movil);
  await p.locator("[data-nueva-cotizacion]").click(); await h.waitFor(); await espera(p, 600);
  ok(`${pref}01 cuatro pestañas en el orden de Mercado Público y pasos`, JSON.stringify(await h.locator('[data-pestanas="Cotización"] [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.tab))) === JSON.stringify(["datos", "productos", "precios", "eett"]) && (await h.locator("[data-pasos-cotizacion] button").count()) >= 5
    // 12/11/2026: el avance va en las pestañas (✓ / pendiente) y una línea «Falta» enlaza cada paso pendiente.
    && JSON.stringify(await h.locator('[data-pestanas="Cotización"] [data-tab]').evaluateAll((b) => b.map((x) => x.dataset.estadoPaso))) === JSON.stringify(["pendiente", "pendiente", "pendiente", "pendiente"]));
  const txtDatos = await h.locator('[role="tabpanel"]').first().innerText().catch(() => h.innerText());
  ok(`${pref}02 Datos sin campos exclusivos de Mercado Público`, !/Mercado P[uú]blico|licitaci|Compra [AÁ]gil|ChileCompra|Instituci[oó]n|Presupuesto del comprador/i.test(await h.innerText()) && !(await h.locator('[data-campo="id_externo"]').count()), txtDatos.slice(0, 200));
  await ui.elegirCliente(p, "Maderas", "76.086.428-5");
  ok(`${pref}03 cliente del registro: propone contacto, dirección y condiciones`, (await h.locator('[data-campo="contacto"]').inputValue()) === "Rosa Pérez" && (await h.locator('[data-campo="direccion"]').inputValue()) === "Planta km 5, Laja" && (await h.locator('[data-campo="pago"]').inputValue()) === "50% anticipo y saldo a 30 días" && /76\.086\.428-5/.test(await h.locator("[data-cliente-elegido]").innerText())
    // 13/11/2026: razón social y RUT una sola vez (cliente elegido); debajo solo lo adicional (giro), sin repetirlos.
    && (await h.locator("[data-datos-cliente]").count() === 0 || !/76\.086\.428-5|Razón social/.test(await h.locator("[data-datos-cliente]").innerText())));
  await h.locator('[data-campo="plazo"]').fill(LARGO);
  await h.locator('[data-campo="condiciones"]').fill("Precios netos en pesos chilenos. Despacho incluido.");
  ok(`${pref}04 cambios sin guardar señalados (protección)`, (await h.locator('[data-estado-guardado="local"]').count()) === 1);
  await revisarDesborde("datos");

  // Productos: manual con foto y despacho; desde la biblioteca con despacho compartido; un servicio.
  await ui.pestana(p, "productos");
  await h.locator("[data-ingreso-manual]").click(); await ui.llenarFicha(p, BOMBA);
  ok(`${pref}05 ventana «Ingresar producto» de Mercado Público con tipo, unidad y código`, (await ui.ventanaFicha(p).locator('[data-tipo="producto"]').count()) === 1 && (await ui.ventanaFicha(p).locator('[data-campo="unidad"]').count()) === 1 && /Ficha técnica · va en la EETT/i.test(await ui.ventanaFicha(p).innerText()) && /Datos comerciales internos/i.test(await ui.ventanaFicha(p).innerText()));
  if (movil) await revisarDesborde("ventana producto");
  await alInicioDeVentana(p); await captura(p, `${nombre}-vp-5-ventana-producto`);
  { const ec = await ui.ventanaFicha(p).locator('[data-campo="cantidad"]').evaluate((e) => getComputedStyle(e).borderRadius + "|" + getComputedStyle(e).paddingLeft);
    const ep = await ui.ventanaFicha(p).locator('[data-campo="precio"]').evaluate((e) => getComputedStyle(e).borderRadius + "|" + getComputedStyle(e).paddingLeft);
    const em = await ui.ventanaFicha(p).locator('[data-campo="marca"]').evaluate((e) => getComputedStyle(e).borderRadius + "|" + getComputedStyle(e).paddingLeft);
    ok(`${pref}05b «Cantidad» y «Precio unitario de compra» con el mismo estilo que los demás campos`, ec === em && ep === em, `${ec} / ${ep} / ${em}`); }
  await ui.guardarFicha(p);
  ok(`${pref}06 producto agregado (tarjeta con foto, proveedor, despacho confirmado)`, (await h.locator("[data-item-cotizacion]").count()) === 1 && /Ferretería Sur/.test(await h.locator('[data-item-cotizacion="1"]').innerText()) && /Confirmado/.test(await h.locator('[data-item-cotizacion="1"] [data-despacho-item]').innerText()) && (await h.locator('[data-item-cotizacion="1"] img').count()) === 1);
  await ui.desdeBiblioteca(p, "Manguera 1 pulgada (prueba)", { cantidad: "12.5", unidad: "M", proveedor: "Ferretería Sur", enlace: "https://tienda.invalid/manguera", precio: 2500, despacho: { modo: "existente" } });
  ok(`${pref}07 desde la biblioteca: ficha precargada y despacho compartido`, (await h.locator("[data-item-cotizacion]").count()) === 2 && /Flexi · PVC-1/.test(await h.locator('[data-item-cotizacion="2"]').innerText()) && /compartido/.test(await h.locator('[data-item-cotizacion="2"] [data-despacho-item]').innerText()));
  await h.locator("[data-ingreso-manual]").click(); await ui.ventanaFicha(p).locator('[data-tipo="servicio"]').click(); await espera(p, 200);
  ok(`${pref}08 servicio: sin marca, modelo ni despacho`, !(await ui.ventanaFicha(p).locator('[data-campo="marca"]').count()) && (await ui.ventanaFicha(p).locator("[data-despacho-no-aplica]").count()) === 1);
  await ui.llenarFicha(p, { nombre: "Instalación y puesta en marcha", generales: "Alcance: Instalación en planta\nDuración: 1 día", cantidad: 1, unidad: "GL", precio: 80000, incluyeIva: false, biblioteca: false });
  await ui.guardarFicha(p);
  ok(`${pref}09 tres ítems en la cotización`, (await h.locator("[data-item-cotizacion]").count()) === 3 && /Servicio/.test(await h.locator('[data-item-cotizacion="3"]').innerText()));
  await revisarDesborde("productos");

  // Precios: costo como Mercado Público, recargo como ayuda, precio y descuento privados.
  await ui.pestana(p, "precios");
  const cu1 = await ui.dinero(h.locator('[data-costo-unitario="1"]'));
  const esperadoCU = calcularCotizacionVP({ items: [{ key: "a", cantidad: 2, precio_origen: 285600, precio_incluye_iva: true, con_factura: true, envio_key: "e" }, { key: "b", cantidad: 12.5, precio_origen: 2500, precio_incluye_iva: true, con_factura: true, envio_key: "e" }], envios: [{ key: "e", monto: 23800, con_factura: true }], afecta_iva: true }).lineas[0].costo_unitario;
  ok(`${pref}10 costo unitario (compra + despacho prorrateado, neto) = fórmula de Mercado Público`, cu1 === Math.round(esperadoCU), `${cu1} vs ${esperadoCU}`);
  await h.locator('[data-campo="recargo-producto-1"]').fill("30"); await h.locator('[data-campo="recargo-producto-1"]').blur(); await espera(p, 200);
  ok(`${pref}11 el recargo sobre costo escribe el precio (redondeado hacia arriba)`, Number(await h.locator('[data-precio-unitario="1"]').inputValue()) === precioConRecargo(esperadoCU, 0.3), await h.locator('[data-precio-unitario="1"]').inputValue());
  await ui.fijarPrecio(p, 1, 350000, 5); await ui.fijarPrecio(p, 2, 3990); await ui.fijarPrecio(p, 3, 180000, 10); await espera(p, 300);
  const tot = { neto: await ui.dinero(ui.fila(p, "neto")), iva: await ui.dinero(ui.fila(p, "iva")), total: await ui.dinero(ui.fila(p, "total")) };
  ok(`${pref}12 totales (fórmula de ventas privadas): neto 876.875 · IVA 166.606 · total 1.043.481`, tot.neto === 876875 && tot.iva === 166606 && tot.total === 1043481, JSON.stringify(tot));
  ok(`${pref}13 costo, utilidad y margen internos visibles para el responsable`, (await h.locator("[data-margen-interno]").count()) === 1 && /Utilidad estimada/.test(await h.locator("[data-margen-interno]").innerText()));
  await revisarDesborde("precios");

  // Guardar y comprobar en la base.
  await ui.guardarCotizacion(p);
  const folio = q1(`select folio from public.vp_cotizaciones where creado_por = '${U.ana}' order by creado_en desc limit 1;`);
  ok(`${pref}14 guardada con folio automático`, /^CP-\d{4}-\d{4}$/.test(folio) && (await h.innerText()).includes(folio) && (await h.locator('[data-estado-guardado="bfk"]').count()) === 1, folio);
  let db = leerEditor(folio);
  ok(`${pref}15 base: ficha técnica completa (marca, modelo, color, generales, especificaciones, descripción, foto en el depósito)`, db.items[0].ficha.marca === "Pedrollo" && db.items[0].ficha.modelo === "CPm 680" && db.items[0].ficha.color === "Azul" && db.items[0].ficha.generales.length === 2 && db.items[0].ficha.especificaciones.some((x) => x.etiqueta === "Caudal máximo") && /^img\/[0-9a-f]+\.jpg$/.test(db.items[0].ficha.imagenes[0] || ""), JSON.stringify(db.items[0].ficha).slice(0, 300));
  ok(`${pref}16 base: proveedor, enlace, precio de compra, IVA, factura y despacho compartido`, db.items[0].proveedor === "Ferretería Sur" && db.items[0].enlace === BOMBA.enlace && db.items[0].precio_origen === 285600 && db.envios.length === 1 && db.envios[0].estado === "confirmado" && db.items[1].envio_key === db.items[0].envio_key && db.items[2].envio_key === null && db.items[2].tipo === "servicio" && db.items[2].unidad === "GL" && db.items[1].cantidad === 12.5 && db.items[0].codigo === "BOM-01");
  ok(`${pref}17 base: totales y costos iguales a la pantalla`, q1(`select neto||'|'||iva||'|'||total from public.vp_cotizacion_revisiones where id = '${db.revisionId}';`) === "876875|166606|1043481"
    && Number(q1(`${comoUsuario(U.ana)}select costo from public.vp_margen_revisiones where revision_id = '${db.revisionId}';`)) === calcularCotizacionVP({ ...db, afecta_iva: true }).totales.costo);
  ok(`${pref}18 la ficha nueva quedó en la biblioteca compartida`, q1(`select count(*) from public.productos_catalogo where modelo = 'CPm 680';`) >= "1" && db.items[0].producto_id != null);

  // Cerrar, reabrir y editar.
  await h.locator("[data-cerrar-hoja]").click(); await espera(p, 500);
  await p.locator(`[data-cotizacion="${folio}"]`).click(); await h.waitFor(); await espera(p, 1500);
  await ui.pestana(p, "datos");
  const reab = { plazo: await h.locator('[data-campo="plazo"]').inputValue(), cond: await h.locator('[data-campo="condiciones"]').inputValue() };
  await ui.pestana(p, "productos");
  ok(`${pref}19 al reabrir: datos, tres ítems con su ficha y despacho`, reab.plazo === LARGO && /Despacho incluido/.test(reab.cond) && (await h.locator("[data-item-cotizacion]").count()) === 3 && /Bomba centrífuga 2 HP/.test(await h.locator('[data-item-cotizacion="1"]').innerText()) && /Confirmado/.test(await h.locator('[data-item-cotizacion="1"]').innerText()));
  { await ui.pestana(p, "datos"); await captura(p, `${nombre}-vp-1-datos`); await ui.pestana(p, "productos"); await captura(p, `${nombre}-vp-2-productos`); await ui.pestana(p, "precios"); await captura(p, `${nombre}-vp-3-precios`); await ui.pestana(p, "eett"); await captura(p, `${nombre}-vp-4-eett`); await ui.pestana(p, "productos"); }
  await ui.pestana(p, "precios");
  ok(`${pref}20 al reabrir: precios y descuentos`, (await h.locator('[data-precio-unitario="1"]').inputValue()) === "350000" && (await h.locator('[data-campo="descuento-1"]').inputValue()) === "5" && (await ui.dinero(ui.fila(p, "total"))) === 1043481);
  await ui.pestana(p, "productos");
  await h.locator('[data-item-cotizacion="1"] [data-editar-item]').click();
  ok(`${pref}21 la ventana muestra la ficha guardada (foto incluida)`, (await ui.ventanaFicha(p).locator('[data-campo="marca"]').inputValue()) === "Pedrollo" && /Caudal máximo/.test(await ui.ventanaFicha(p).locator('[data-campo="especificaciones"]').inputValue()) && (await ui.ventanaFicha(p).locator("[data-imagen-ficha]").count()) === 1);
  await ui.ventanaFicha(p).locator('[data-campo="especificaciones"]').fill("Potencia: 2 HP\nCaudal máximo: 160 L/min\nAltura máxima: 40 m");
  await ui.guardarFicha(p); await ui.guardarCotizacion(p);
  db = leerEditor(folio);
  ok(`${pref}22 edición guardada: nueva especificación sin perder foto, compra ni despacho`, db.items[0].ficha.especificaciones.some((x) => x.etiqueta === "Altura máxima") && db.items[0].ficha.imagenes.length === 1 && db.items[0].proveedor === "Ferretería Sur" && db.envios.length === 1);

  // EETT: revisión de fichas, vista previa (no guarda) y PDF de la cotización (no cambia el estado).
  await ui.pestana(p, "eett");
  for (const cb of await h.locator("[data-aprobar-ficha] input").all()) if (!(await cb.isChecked())) await cb.check();
  ok(`${pref}23 fichas revisadas: EETT lista para generar`, (await h.locator("[data-revision-eett]").count()) === 3 && await h.locator("[data-generar-eett]").isEnabled());
  await h.locator("[data-vista-previa-eett]").click(); await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-pagina-preview="1"]').waitFor({ timeout: 20000 });
  ok(`${pref}24 vista previa de EETT desde las fichas, sin registrar nada`, /Vista previa de EETT/.test(await p.locator('[data-hoja-lateral="vista-previa-eett"]').innerText()) && q1(`select count(*) from public.vp_eett e join public.vp_cotizaciones c on c.id = e.cotizacion_id where c.folio = '${folio}';`) === "0");
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja]').first().click(); await espera(p, 400);
  await ui.pestana(p, "precios");
  const pdfCot = await descarga(p, () => h.locator("[data-pdf-cotizacion]").click()); writeFileSync(`${CAPT}/${nombre}-documento-cotizacion.pdf`, pdfCot);
  const tCot = await textoPDF(pdfCot);
  ok(`${pref}25a el PDF de la cotización se guarda con su código y revisión (${folio}_Rev0.pdf)`, ultimoArchivo === `${folio}_Rev0.pdf`, ultimoArchivo);
  ok(`${pref}25 PDF de la cotización: cliente, ítems con marca/modelo y totales`, /Maderas del Sur/.test(tCot) && /Bomba centr/.test(tCot) && /Pedrollo CPm 680/.test(tCot) && /1\.043\.481/.test(tCot) && tCot.includes(folio));
  ok(`${pref}25b PDF de la cotización con el plazo de entrega completo`, contiene(tCot, LARGO));
  ok(`${pref}26 PDF de la cotización SIN costos, proveedor, enlaces ni despachos`, !/Ferreter|tienda\.invalid|285\.600|23\.800|costo|margen|utilidad/i.test(tCot));
  await h.locator("[data-ver-cotizacion]").click(); await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-pagina-preview="1"]').waitFor({ timeout: 20000 });
  await p.locator('[data-hoja-lateral="vista-previa-eett"] [data-cerrar-hoja]').first().click(); await espera(p, 300);
  await ui.guardarCotizacion(p);   // aprobaciones de fichas
  ok(`${pref}27 ver y descargar no cambian el estado (sigue borrador)`, q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "borrador");

  // Envío manual → contenido bloqueado → nueva revisión.
  await ui.registrarEstado(p, "enviada");
  await ui.pestana(p, "productos");
  ok(`${pref}28 enviada: productos y precios bloqueados (solo «Ver»)`, q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "enviada" && !(await h.locator("[data-ingreso-manual]").count()) && /^Ver$/.test((await h.locator('[data-item-cotizacion="1"] [data-editar-item]').innerText()).trim()) && !(await h.locator("[data-precio-unitario]").count()));
  await h.locator('[data-item-cotizacion="1"] [data-editar-item]').click();
  ok(`${pref}29 la ventana del ítem se abre solo para ver`, (await ui.ventanaFicha(p).locator('[data-aviso-linea="item-solo-lectura"]').count()) === 1 && await ui.ventanaFicha(p).locator('[data-campo="marca"]').isDisabled() && !(await ui.ventanaFicha(p).locator("[data-guardar-ficha]").count()));
  await ui.ventanaFicha(p).getByText("Cerrar", { exact: true }).click(); await espera(p, 300);
  const r0 = db.revisionId;
  await h.locator('[data-accion-cot="revision"]').click(); await espera(p, 2000);
  db = leerEditor(folio);
  const copia = (rev) => q1(`select md5(string_agg(coalesce(i.ficha::text,'')||coalesce((to_jsonb(k) - 'item_id')::text,''), '|' order by i.orden)) from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = '${rev}';`);
  ok(`${pref}30 nueva revisión R1: copia fichas y datos de compra; R0 se conserva`, db.revisionId !== r0 && copia(db.revisionId) === copia(r0) && (await h.locator("[data-selector-revision]").count()) === 1 && (await h.locator("[data-ingreso-manual]").count()) === 1);
  await ui.pestana(p, "precios"); await ui.fijarPrecio(p, 3, 185000, 10); await ui.guardarCotizacion(p);
  ok(`${pref}31 R1 editada y guardada; R0 intacta`, q1(`select total from public.vp_cotizacion_revisiones where id = '${db.revisionId}';`) !== "1043481" && q1(`select total from public.vp_cotizacion_revisiones where id = '${r0}';`) === "1043481");

  // Envío y aceptación de R1 → EETT emitida desde las fichas → venta.
  await ui.registrarEstado(p, "enviada"); await ui.registrarEstado(p, "aceptada");
  ok(`${pref}32 R1 aceptada: disponible «Crear venta / Registrar OC»`, q1(`select estado from public.vp_cotizaciones where folio = '${folio}';`) === "aceptada" && (await h.locator('[data-accion-cot="crear-venta"]').count()) === 1);
  await ui.pestana(p, "eett");
  ok(`${pref}33 pestaña EETT igual a la de Mercado Público (revisión de fichas, vista previa, «Generar y descargar EETT»)`, (await h.locator("[data-revision-eett]").count()) === 3 && /Generar y descargar EETT/.test(await h.locator("[data-generar-eett]").innerText()));
  const pdfEETT = await descarga(p, () => h.locator("[data-generar-eett]").click()); await espera(p, 1500); writeFileSync(`${CAPT}/${nombre}-documento-eett.pdf`, pdfEETT);
  ok(`${pref}34 sin ventana adicional (objeto, alcance, requisitos, emisión aparte)`, !(await p.locator('[data-ventana^="eett"], [data-eett-objeto]').count()));
  const tE = await textoPDF(pdfEETT);
  ok(`${pref}35 EETT emitida con el formato de Mercado Público y la ficha (marca, modelo, generales, especificaciones)`, /INFORMACI.N\s+T.CNICA DE/.test(tE) && /Pedrollo/.test(tE) && /CPm 680/.test(tE) && /Hierro fundido/.test(tE) && /Altura m.xima/.test(tE) && !/\$\s?\d/.test(tE) && !/Ferreter/.test(tE) && !/BOM-01/.test(tE) && !/Objeto del suministro/.test(tE));
  ok(`${pref}35a EETT privada con el plazo de entrega largo completo (la fila crece)`, contiene(tE, LARGO), tE.slice(0, 300));
  ok(`${pref}35b la foto de la ficha va en la EETT (como en Mercado Público)`, pdfEETT.toString("latin1").includes("/Subtype /Image"));
  ok(`${pref}36 EETT emitida y congelada en la base (formato de Mercado Público)`, q1(`select count(*)||'|'||bool_and(hash is not null)||'|'||bool_and(contenido->>'formato' = 'mp') from public.vp_eett e join public.vp_cotizaciones c on c.id = e.cotizacion_id where c.folio = '${folio}' and e.estado = 'emitida';`) === "1|true|true");
  // Generar otra vez sin cambios: vuelve a descargar la misma emisión (no emite una revisión idéntica).
  const pdfEETT2 = await descarga(p, () => h.locator("[data-generar-eett]").click()); await espera(p, 1200);
  ok(`${pref}36b generar otra vez sin cambios descarga la misma EETT (sin revisión nueva)`, q1(`select count(*) from public.vp_eett e join public.vp_cotizaciones c on c.id = e.cotizacion_id where c.folio = '${folio}';`) === "1" && (await textoPDF(pdfEETT2)).replace(/\s+/g, " ") === tE.replace(/\s+/g, " "));
  await h.locator('[data-accion-cot="crear-venta"]').click(); await p.locator('[data-ventana="crear-venta"]').waitFor();
  await p.locator('[data-ventana="crear-venta"] [data-confirmar-venta]').dblclick(); await espera(p, 3000);
  const ov = q1(`select v.folio from public.vp_ventas v join public.vp_cotizaciones c on c.id = v.cotizacion_id where c.folio = '${folio}';`);
  ok(`${pref}37 una sola venta (doble clic) con el total de la revisión aceptada`, /^OV-\d{4}-\d{4}$/.test(ov) && q1(`select count(*) from public.vp_ventas v join public.vp_cotizaciones c on c.id = v.cotizacion_id where c.folio = '${folio}';`) === "1" && q1(`select v.total = r.total from public.vp_ventas v join public.vp_cotizacion_revisiones r on r.id = v.revision_id where v.folio = '${ov}';`) === "t", ov);
  ok(`${pref}38 la venta conserva fichas y datos de compra (proveedor, enlace, despacho)`, q1(`select count(*) from public.vp_venta_items i where i.venta_id = (select id from public.vp_ventas where folio = '${ov}') and i.ficha is not null;`) === "3"
    && q1(`select k.proveedor||'|'||k.enlace||'|'||(k.despacho->>'estado') from public.vp_venta_item_costos k join public.vp_venta_items i on i.id = k.item_id where i.venta_id = (select id from public.vp_ventas where folio = '${ov}') and i.orden = 1;`) === `Ferretería Sur|${BOMBA.enlace}|confirmado`);
  const fv = p.locator('[data-hoja-lateral="ficha-venta"]'); await fv.waitFor({ timeout: 8000 });
  ok(`${pref}39 ficha de la venta: proveedor y «Ir a comprar» para el responsable`, (await fv.locator('[data-compra-item="1"] [data-ir-a-comprar]').count()) === 1 && /Ferretería Sur/.test(await fv.locator('[data-compra-item="1"]').innerText()));
  await revisarDesborde("venta");
  ok(`${pref}40 sin desborde horizontal en celular`, !desborde.length, desborde.join(", "));
  ok(`${pref}41 sin errores de página`, !errs.length, errs.join(" | "));
  ok(`${pref}43 sin llamadas a Inteligencia Comercial, IA ni sincronizaciones`, !llamadas.length, llamadas.join(" "));
  ok(`${pref}42 no se escribió nada en Mercado Público`, !escriturasMP(m0).length, JSON.stringify(escriturasMP(m0).map((x) => x.obj)));
  await ctx.close();
  return folio;
}

// Capturas del editor de Mercado Público (el de siempre, con su base simulada) para comparar.
async function capturasMP(browser, { ancho, alto, movil }) {
  const nombre = movil ? "celular" : "escritorio";
  const b = crearBase(crearDatos(), {});
  const { page: p, ctx, errs } = await abrirMP(browser, b, { url: URL_APP, ancho, alto, movil, espera: 2500 });
  const M = moduloSimulado(2); await p.route("**/*", (route) => M.manejar(route)); const llamadasMP = vigilar(p);
  const env = { key: "e1", proveedor: "Ferretería Sur", monto: 23800, con_factura: true, estado: "confirmado", destino: "Av. Uno 123, Laja", evidencia: "Simulación de compra" };
  const it = (key, nombreP, q, precio, envio_key, extra = {}) => ({ key, cantidad: q, precio_origen: precio, precio_incluye_iva: true, con_factura: true, envio_key, recargo: null, proveedor: "Ferretería Sur", enlace: "https://tienda.invalid/x",
    ficha: { nombre: nombreP, marca: "Pedrollo", modelo: "CPm 680", generales: [{ etiqueta: "Material", valor: "Hierro fundido" }], especificaciones: [{ etiqueta: "Potencia", valor: "2 HP" }], imagenes: [] }, ...extra });
  M.cots.set("c-1", { id: "c-1", version: 2, id_externo: "1234-5-COT26", nombre: "Adquisición de bombas", institucion: "Municipalidad de Laja", rut: "69.170.100-K", direccion_entrega: "Av. Uno 123", comuna: "Laja", estado: "borrador",
    fecha: "2026-11-08", plazo: "10 DIAS", recargo: 0.3, actualizado_en: "2026-11-08", vendedor_id: null, vendedor_nombre: "", envios: [env], items: [it("a", "Bomba centrífuga 2 HP", 2, 285600, "e1"), it("b", "Manguera 1 pulgada", 12, 2500, "e1")] });
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); } else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500); await p.locator('[data-cotizacion="1234-5-COT26"]').click(); await espera(p, 1500);
  const H = p.locator('[data-hoja-lateral="cotizacion"]');
  const tabs = await H.locator('[data-pestanas="Cotización"] [data-tab]').evaluateAll((x) => x.map((y) => y.dataset.tab));
  for (const [i, k] of [[1, "datos"], [2, "productos"], [3, "precios"], [4, "eett"]]) { await H.locator(`[role="tab"][data-tab="${k}"]`).click(); await captura(p, `${nombre}-mp-${i}-${k}`); }
  await H.locator('[role="tab"][data-tab="productos"]').click(); await H.locator("[data-editar-item]").first().click(); await espera(p, 500); await captura(p, `${nombre}-mp-5-ventana-producto`);
  const ventanaMP = (await p.locator("[data-editor-ficha]").count()) === 1 && !(await p.locator("[data-tipo-item]").count());
  const estiloCantidad = await p.locator('[data-editor-ficha] [data-campo="cantidad"]').evaluate((e) => getComputedStyle(e).fontFamily + "|" + getComputedStyle(e).borderRadius);
  const estiloNombre = await p.locator('[data-editor-ficha] [data-campo="marca"]').evaluate((e) => getComputedStyle(e).borderRadius);
  ok(`MP-${nombre} «Cantidad» con el mismo formato de los demás campos (ventana compartida)`, estiloCantidad.split("|")[1] === estiloNombre && /mono|Mono|Menlo|Consolas|courier/i.test(estiloCantidad), estiloCantidad + " vs " + estiloNombre);
  await p.locator("[data-editor-ficha]").getByText("Cancelar", { exact: true }).click(); await espera(p, 300);
  await H.locator('[role="tab"][data-tab="datos"]').click(); await H.locator('[data-campo="plazo"]').fill(LARGO);
  await H.locator('[role="tab"][data-tab="eett"]').click(); await espera(p, 300);
  for (const cb of await H.locator("[data-aprobar-ficha] input").all()) if (!(await cb.isChecked())) await cb.check();
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), H.locator("[data-generar-eett]").click()]);
  const pdfMP = readFileSync(await dl.path()); writeFileSync(`${CAPT}/${nombre}-documento-eett-mp.pdf`, pdfMP);
  ok(`MP-${nombre} EETT de Mercado Público con el plazo de entrega largo completo (misma plantilla)`, contiene(await textoPDF(pdfMP), LARGO) && /INFORMACI.N\s+T.CNICA DE/.test(await textoPDF(pdfMP)));
  ok(`MP-${nombre} sin llamadas a Inteligencia Comercial`, !llamadasMP.some((u) => /inteligencia/.test(u)), llamadasMP.join(" "));
  ok(`MP-${nombre} el editor de Mercado Público sigue con sus pestañas y ventana de producto`, JSON.stringify(tabs) === JSON.stringify(["datos", "productos", "precios", "eett"]) && ventanaMP && !errs.length, errs.join(" | "));
  await ctx.close();
  return tabs;
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  await capturasMP(browser, { ancho: 1440, alto: 900, movil: false });
  await capturasMP(browser, { ancho: 390, alto: 844, movil: true });
  await recorrido(browser, { pref: "E", ancho: 1440, alto: 900, movil: false });
  await recorrido(browser, { pref: "C", ancho: 390, alto: 844, movil: true });
  // Permisos: otro usuario abre la cotización (sin costos ni acciones).
  const folio = q1(`select folio from public.vp_cotizaciones order by creado_en limit 1;`);
  const { page: p, ctx, errs } = await abrir(browser, { usuario: U.beto, url: URL_APP, hash: `#/cotizaciones-privadas/${folio}` });
  await espera(p, 1500); const h = ui.hoja(p);
  await ui.pestana(p, "productos");
  const txtB = await h.innerText();
  ok("S1 otro usuario: ve la ficha técnica pero no proveedor, enlace, precio de compra ni despacho", /Bomba centrífuga 2 HP/.test(txtB) && !/Ferretería|Abrir publicación|Precio unitario de compra|Despacho:/.test(txtB));
  await ui.pestana(p, "precios");
  ok("S2 otro usuario: sin costo, utilidad ni recargo; sin acciones de estado", !(await h.locator("[data-margen-interno]").count()) && !(await h.locator('[data-campo^="recargo"]').count()) && !(await h.locator('[data-accion-cot="aceptada"]').count()) && !(await h.locator("[data-guardar-cotizacion]").count()));
  await ui.pestana(p, "productos"); await h.locator('[data-item-cotizacion="1"] [data-editar-item]').click();
  ok("S3 otro usuario: la ventana del ítem es de solo lectura y sin datos internos", (await ui.ventanaFicha(p).locator("[data-datos-internos]").count()) === 0 && !(await ui.ventanaFicha(p).locator("[data-guardar-ficha]").count()));
  ok("S4 sin errores de página (otro usuario)", !errs.length, errs.join(" | "));
  await ctx.close();
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`\nCapturas: ${CAPT}`);
console.log(`RESUMEN e2e cotización privada como Mercado Público: ${nOk} OK, ${F.length} FALLA(S)`);
process.exit(F.length ? 1 : 0);
