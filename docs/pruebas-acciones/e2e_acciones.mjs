// Centro de Acciones Pendientes (17/11/2026) · pruebas de interfaz en computador (E) y celular (M).
// Supabase simulado con la migración instalada (mock_acciones.mjs); nada sale a la red.
// Uso: CHROME=/usr/bin/google-chrome node docs/pruebas-acciones/e2e_acciones.mjs http://127.0.0.1:4190/
import { chromium, CHROME, abrir, instalarRutas } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos, RESPUESTAS_MP, dias } from "../pruebas-oc/datos_oc.mjs";
import { crearBaseAcciones } from "./mock_acciones.mjs";
import { irSeccionFicha } from "../pruebas-oc/indice_ficha.mjs";
import { armarAcciones, contadores, filtrarAcciones, mezclarAcciones, corteAcciones, tituloAccion, alertasAccionesSinOC } from "../../src/lib/acciones.js";

const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 600) => p.waitForTimeout(ms);
// (ordenes_compra_v2 se compara aparte, campo a campo: al cargar, la app completa datos de cliente desde Mercado Público, como siempre)
const FINANCIERAS = ["eventos_compra", "eventos_pago_financiamiento", "eventos_pago_cliente", "eventos_factura", "financiadores", "ajustes_saldo_financiador", "pagos_vendedor", "gastos_indirectos", "iva_mensual", "comision_liquidaciones"];
const huellaOC = (b) => JSON.stringify(b.db.ordenes_compra_v2.map((o) => [o.id, o.costo_total, o.monto_pagado_fin, o.monto_cobrado, o.monto_facturado, o.estado_entrega, o.estado_postventa, o.estado_compra, o.estado_pago_cliente, o.vendedor_id, o.financiador_id, o.archivada, o.monto_total]));
const futuro = (n) => dias(-n);

const seg = (id, oc, o) => ({ id, oc_id: oc, titulo: null, cliente: null, origen: null, origen_id: null, categoria: "proveedor", descripcion: "Acción " + id, prioridad: "media", estado: "pendiente",
  responsable_id: null, responsable_nombre: null, fecha_revision: null, sobrecosto_estimado: null, solucion: null, resuelto_por: null, resuelto_por_nombre: null, resuelto_en: null,
  creado_por: "u2", creado_por_nombre: "Usuario Prueba", creado_en: new Date(Date.now() - 3 * 864e5).toISOString(), actualizado_por: null, actualizado_en: null, ...o });
function datos() {
  const d = crearDatos();
  d.perfiles.push({ id: "u3", nombre: "Tercera Persona", rol: "usuario", email: "u3@prueba.cl" });
  d.oc_seguimientos = [
    seg("sA", "oc1", { titulo: "Confirmar despacho con proveedor", prioridad: "alta", responsable_id: "u2", responsable_nombre: "Usuario Prueba", fecha_revision: futuro(3), descripcion: "El proveedor no confirma la fecha" }),
    seg("sB", "oc3", { categoria: "facturacion", fecha_revision: dias(2), descripcion: "Pedir orden de compra firmada para facturar" }),      // vencida, sin título
    seg("sC", null, { titulo: "Renovar póliza de garantía", categoria: "administrativa", prioridad: "baja", cliente: "Colegio Ficticio", descripcion: "Vence la póliza anual" }),
    seg("sD", "oc4", { titulo: "Coordinar instalación", categoria: "instalacion", estado: "en_gestion", fecha_revision: futuro(5), descripcion: "Cliente pide instalación del equipo" }),
    seg("sE", "oc7", { titulo: "Reclamo resuelto", categoria: "postventa", estado: "resuelto", solucion: "Se repuso el producto", resuelto_por: "u1", resuelto_por_nombre: "Admin Prueba", resuelto_en: new Date(Date.now() - 864e5).toISOString() }),
    seg("sF", "oc10", { titulo: "Acción de OC archivada", descripcion: "No debe aparecer en la bandeja" }),
  ];
  return d;
}
function base() {
  const b = crearBaseAcciones(datos(), { mp: RESPUESTAS_MP });
  // Instalación: el incidente de postventa abierto (pv11, oc11) genera su acción (como la migración en producción).
  for (const pv of b.db.eventos_postventa.filter((x) => x.estado !== "resuelto")) b.acc.trgPostventa("INSERT", pv, null, null);
  return b;
}

// ═════ Unitarias (lib/acciones.js) ═════
{
  const D = datos(); const ocs = D.ordenes_compra_v2.map((o) => ({ ...o, oc_seguimientos: D.oc_seguimientos.filter((s) => s.oc_id === o.id) }));
  const L = armarAcciones(ocs, D.oc_seguimientos.filter((s) => !s.oc_id));
  const c = contadores(L);
  ok("U01 bandeja: sin acciones de OC archivadas; contadores pendientes/urgentes/vencidas/en gestión", !L.some((a) => a.id === "sF") && c.pendientes === 4 && c.urgentes === 1 && c.vencidas === 1 && c.enGestion === 1 && c.resueltas === 1, c);
  const ord = filtrarAcciones(L, {}).map((a) => a.id);
  ok("U02 orden por prioridad y vencimiento (sin vencimiento al final)", JSON.stringify(ord) === JSON.stringify(["sA", "sB", "sD", "sC"]), ord);
  ok("U03 filtros: sin OC / categoría / responsable / búsqueda por OC, cliente y descripción",
    filtrarAcciones(L, { oc: "sin" }).map((a) => a.id).join() === "sC" && filtrarAcciones(L, { categoria: "instalacion" }).map((a) => a.id).join() === "sD"
    && filtrarAcciones(L, { responsable: "yo" }, { yo: "u2" }).map((a) => a.id).join() === "sA" && filtrarAcciones(L, { responsable: "sin" }).length === 3
    && filtrarAcciones(L, { texto: "2003-103" }).map((a) => a.id).join() === "sB" && filtrarAcciones(L, { texto: "colegio ficticio" }).map((a) => a.id).join() === "sC"
    && filtrarAcciones(L, { texto: "POLIZA" }).map((a) => a.id).join() === "sC" && filtrarAcciones(L, { vista: "resueltas" }).map((a) => a.id).join() === "sE");
  ok("U04 título: el registrado o la primera línea de la descripción", tituloAccion(L.find((a) => a.id === "sB")) === "Pedir orden de compra firmada para facturar");
  const corte = corteAcciones(ocs, []);
  const m = mezclarAcciones({ ocs, sueltas: [] }, [{ ...D.oc_seguimientos[0], prioridad: "baja", actualizado_en: "2099-01-01T00:00:00Z" }, seg("sN", null, { titulo: "Nueva sin OC", creado_en: "2099-01-01T00:00:00Z" })],
    [{ id: "h1", campo: "seguimiento:sA", accion: "Acción: prioridad cambiada", creadoEn: "2099-01-01T00:00:00Z" }]);
  ok("U05 sincronización: mezcla cambios de otro usuario en la OC y en las acciones sin OC, con su historial", m.cambio && m.ocs.find((o) => o.id === "oc1").oc_seguimientos.find((s) => s.id === "sA").prioridad === "baja"
    && m.ocs.find((o) => o.id === "oc1").oc_seguimientos.find((s) => s.id === "sA").bitacora.length === 1 && m.sueltas.map((s) => s.id).join() === "sN" && !!corte);
  ok("U06 alertas de acciones sin OC: solo prioridad alta o vencidas", alertasAccionesSinOC([seg("x1", null, { titulo: "a", prioridad: "alta" }), seg("x2", null, { titulo: "b", fecha_revision: dias(1) }), seg("x3", null, { titulo: "c" })]).length === 2);
}

// ═════ Interfaz ═════
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const centro = (p) => p.locator("[data-centro-acciones]").first();
const n = async (p, k) => Number(await centro(p).locator(`[data-acc-contador="${k}"]`).getAttribute("data-n"));
// La bandeja muestra 6 y «Ver todas (N)»: las pruebas despliegan la lista completa antes de buscar.
const todas = async (p) => { const v = centro(p).locator("[data-acc-ver-todas]"); if ((await v.count()) && /Ver todas/.test(await v.innerText())) { await v.click(); await p.waitForTimeout(200); } };
const items = async (p) => { await todas(p); return centro(p).locator("[data-acc-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-acc-item"))); };
const item = (p, id) => centro(p).locator(`[data-acc-item="${id}"]`);
const abrirItem = async (p, id) => { await todas(p); if (!(await item(p, id).locator("[data-acc-detalle]").count())) { await item(p, id).locator("[data-acc-fila]").click(); await espera(p, 300); } };
const recargar = async (p) => { await centro(p).locator("[data-acc-recargar]").click(); await espera(p, 900); };
async function irA(p, k) {
  const v = p.locator(`[data-nav="${k}"]:visible`);
  if (await v.count()) await v.first().click(); else { await p.locator('[data-nav="mas"]:visible').first().click(); await espera(p, 400); await p.locator(`[data-nav="${k}"]:visible`).first().click(); }
  await espera(p, 900);
}
const escrFin = (b, n0) => b.escr.slice(n0).filter((w) => FINANCIERAS.includes(w.tabla));

for (const [pref, movil] of [["E", false], ["M", true]]) {
  const b = base(); const n0 = b.escr.length; const oc0 = huellaOC(b);
  const dim = movil ? { ancho: 390, alto: 844, movil: true } : { ancho: 1440, alto: 900, movil: false };
  const { page: p, ctx, errs } = await abrir(browser, b, { url: URL_APP, usuario: "u2", espera: 2600, ...dim });
  try {
    ok(`${pref}01 el Centro de Acciones está en la pantalla principal`, (await centro(p).count()) === 1 && /Acciones pendientes/i.test(await centro(p).innerText()));
    const c = { p: await n(p, "abiertas"), u: await n(p, "urgentes"), v: await n(p, "vencidas"), g: await n(p, "en_gestion") };
    ok(`${pref}02 contadores: pendientes, urgentes, vencidas y en gestión (incluye la automática de postventa)`, c.p === 5 && c.u === 1 && c.v === 1 && c.g === 1, c);
    const ids = await items(p);
    ok(`${pref}03 ordenadas por prioridad y vencimiento; sin resueltas ni OC archivadas`, ids[0] === "sA" && ids[1] === "sB" && !ids.includes("sE") && !ids.includes("sF") && ids.includes("seg_pv_pv11"), ids);
    ok(`${pref}04 la vencida se identifica visualmente`, (await item(p, "sB").getAttribute("data-acc-vencida")) === "1" && (await item(p, "sB").locator("[data-acc-chip-vencida]").count()) === 1);
    const t = await item(p, "sC").innerText();
    ok(`${pref}05 cada registro muestra acción, categoría, OC o «Sin OC», cliente, responsable, prioridad y vencimiento`, /Renovar póliza de garantía/.test(t) && /Otras tareas administrativas/.test(t) && /Sin OC/.test(t) && /Colegio Ficticio/.test(t) && /Sin responsable/.test(t) && /Baja/.test(t) && /Sin vencimiento/.test(t), t);
    const tA = await item(p, "sA").innerText();
    ok(`${pref}06 acción de OC: número de OC y cliente de la OC`, /OC 2001-101-SE26/.test(tA) && /MUNICIPALIDAD FICTICIA 1/.test(tA) && /Usuario Prueba/.test(tA), tA);
    // Detalle desplegable
    await abrirItem(p, "sA");
    const det = await item(p, "sA").locator("[data-acc-detalle]").innerText();
    ok(`${pref}07 detalle desplegable sin salir de Inicio: descripción, creación, vencimiento e historial`, /El proveedor no confirma la fecha/.test(det) && /Creada:/.test(det) && /Vencimiento:/.test(det) && /Historial/i.test(det));
    // Filtros y búsqueda
    await centro(p).locator("[data-acc-buscar]").fill("2003-103"); await espera(p, 300);
    ok(`${pref}08 búsqueda por número de OC`, JSON.stringify(await items(p)) === '["sB"]', await items(p));
    await centro(p).locator("[data-acc-buscar]").fill("colegio"); await espera(p, 300);
    ok(`${pref}09 búsqueda por cliente`, JSON.stringify(await items(p)) === '["sC"]');
    await centro(p).locator("[data-acc-buscar]").fill("instalación del equipo"); await espera(p, 300);
    ok(`${pref}10 búsqueda por descripción`, JSON.stringify(await items(p)) === '["sD"]');
    await centro(p).locator("[data-acc-buscar]").fill(""); await espera(p, 200);
    await centro(p).locator("[data-acc-ver-filtros]").click(); await espera(p, 200);
    await centro(p).locator('[data-acc-filtro="oc"]').selectOption("sin"); await espera(p, 200);
    ok(`${pref}11 filtro por OC (sin OC)`, JSON.stringify(await items(p)) === '["sC"]');
    await centro(p).locator('[data-acc-filtro="oc"]').selectOption(""); await centro(p).locator('[data-acc-filtro="categoria"]').selectOption("postventa"); await espera(p, 200);
    ok(`${pref}12 filtro por categoría`, JSON.stringify(await items(p)) === '["seg_pv_pv11"]', await items(p));
    await centro(p).locator('[data-acc-filtro="categoria"]').selectOption(""); await centro(p).locator('[data-acc-filtro="responsable"]').selectOption("yo"); await espera(p, 200);
    ok(`${pref}13 filtro por responsable (mis acciones)`, JSON.stringify(await items(p)) === '["sA"]');
    await centro(p).locator('[data-acc-filtro="responsable"]').selectOption(""); await centro(p).locator('[data-acc-filtro="estado"]').selectOption("en_gestion"); await espera(p, 200);
    ok(`${pref}14 filtro por estado (en gestión)`, JSON.stringify(await items(p)) === '["sD"]');
    await centro(p).locator('[data-acc-filtro="estado"]').selectOption("resueltas"); await espera(p, 200);
    ok(`${pref}15 las resueltas se conservan para consulta`, JSON.stringify(await items(p)) === '["sE"]' && /Se repuso el producto/.test(await (async () => { await abrirItem(p, "sE"); return item(p, "sE").innerText(); })()));
    await centro(p).locator('[data-acc-filtro="estado"]').selectOption("abiertas"); await espera(p, 200);
    await centro(p).locator("[data-acc-ver-filtros]").click(); await espera(p, 200);
    // Contador como acceso directo
    await centro(p).locator('[data-acc-contador="vencidas"]').click(); await espera(p, 200);
    ok(`${pref}16 tocar «Vencidas» muestra solo las vencidas`, JSON.stringify(await items(p)) === '["sB"]');
    await centro(p).locator('[data-acc-contador="vencidas"]').click(); await espera(p, 200);

    // Nueva acción SIN OC
    const w0 = b.escr.length;
    await centro(p).locator("[data-acc-nueva]").click(); await espera(p, 400);
    const form = p.locator("[data-acc-form]");
    await form.locator("[data-acc-guardar]").click(); await espera(p, 200);
    ok(`${pref}17 el formulario exige título, descripción y categoría`, /título/.test(await form.locator("[data-acc-errores]").innerText()) && b.escr.length === w0);
    await form.locator('[data-acc-campo="titulo"]').fill("Cotizar servicio técnico");
    await form.locator('[data-acc-campo="descripcion"]').fill("El colegio pide mantención de impresoras");
    await form.locator('[data-acc-campo="categoria"]').selectOption("instalacion");
    await form.locator('[data-acc-campo="cliente"]').fill("Colegio Nuevo");
    await form.locator('[data-acc-campo="responsable"]').selectOption("u3");
    await form.locator('[data-acc-campo="prioridad"]').selectOption("alta");
    await form.locator('[data-acc-campo="vencimiento"]').fill(futuro(7));
    await form.locator("[data-acc-guardar]").evaluate((x) => { x.click(); x.click(); }); await espera(p, 1500);
    const nueva = b.db.oc_seguimientos.filter((s) => s.titulo === "Cotizar servicio técnico");
    ok(`${pref}18 crear sin OC: una sola acción pendiente, autor y responsable fijados por la base`, nueva.length === 1 && nueva[0].oc_id === null && nueva[0].estado === "pendiente" && nueva[0].creado_por === "u2" && nueva[0].responsable_nombre === "Tercera Persona" && nueva[0].cliente === "Colegio Nuevo", nueva);
    ok(`${pref}19 aparece en la bandeja (urgente, arriba) y avisa al responsable`, (await items(p)).slice(0, 2).includes(nueva[0]?.id) && b.db.notificaciones.some((x) => x.usuario_id === "u3" && /Cotizar servicio técnico/.test(x.mensaje)));
    // Nueva acción CON OC (por número) y con OC inexistente
    await centro(p).locator("[data-acc-nueva]").click(); await espera(p, 400);
    await form.locator('[data-acc-campo="titulo"]').fill("Solicitar guía de despacho");
    await form.locator('[data-acc-campo="descripcion"]').fill("Falta la guía para facturar");
    await form.locator('[data-acc-campo="categoria"]').selectOption("facturacion");
    await form.locator('[data-acc-campo="oc"]').fill("9999-999-XX26"); await form.locator("[data-acc-guardar]").click(); await espera(p, 300);
    ok(`${pref}20 OC inexistente: no se guarda y se explica`, /No existe una OC vigente/.test(await form.locator("[data-acc-errores]").innerText()));
    await form.locator('[data-acc-campo="oc"]').fill("2002-102-SE26"); await espera(p, 200);
    ok(`${pref}21 con OC no se pide cliente (se usa el de la OC)`, (await form.locator('[data-acc-campo="cliente"]').count()) === 0);
    await form.locator("[data-acc-guardar]").click(); await espera(p, 1500);
    const conOC = b.db.oc_seguimientos.find((s) => s.titulo === "Solicitar guía de despacho");
    ok(`${pref}22 crear con OC: queda asociada a la OC y se ve con su número y cliente`, conOC?.oc_id === "oc2" && /2002-102-SE26/.test(await item(p, conOC.id).innerText()) && /MUNICIPALIDAD FICTICIA 2/.test(await item(p, conOC.id).innerText()));
    // Gestión: responsable, prioridad, vencimiento, estado, comentario, resolver, reabrir
    await abrirItem(p, conOC.id);
    await item(p, conOC.id).locator("[data-acc-responsable]").selectOption("u1"); await espera(p, 900);
    await item(p, conOC.id).locator("[data-acc-prioridad]").selectOption("alta"); await espera(p, 900);
    await item(p, conOC.id).locator("[data-acc-vencimiento]").fill(futuro(2)); await espera(p, 900);
    await item(p, conOC.id).locator("[data-acc-en-gestion]").click(); await espera(p, 900);
    const s1 = b.db.oc_seguimientos.find((s) => s.id === conOC.id);
    ok(`${pref}23 asignar responsable, cambiar prioridad, vencimiento y estado`, s1.responsable_nombre === "Admin Prueba" && s1.prioridad === "alta" && s1.fecha_revision === futuro(2) && s1.estado === "en_gestion", s1);
    await item(p, conOC.id).locator("[data-acc-avance]").click(); await item(p, conOC.id).locator("[data-acc-texto]").fill("Se pidió la guía por correo");
    await item(p, conOC.id).locator("[data-acc-confirmar]").click(); await espera(p, 1200);
    if (await item(p, conOC.id).locator("[data-acc-historial] [data-consulta]").count()) { await item(p, conOC.id).locator("[data-acc-historial] [data-consulta]").click(); await espera(p, 200); }
    const hist = await item(p, conOC.id).locator("[data-acc-historial]").innerText();
    ok(`${pref}24 historial con cada cambio y el comentario (fecha y usuario)`, /Responsable cambiado/.test(hist) && /Prioridad cambiada/.test(hist) && /Vencimiento cambiado/.test(hist) && /Estado cambiado/.test(hist) && /Se pidió la guía por correo/.test(hist) && /Usuario Prueba/.test(hist), hist);
    await item(p, conOC.id).locator("[data-acc-resolver]").click(); await item(p, conOC.id).locator("[data-acc-confirmar]").click(); await espera(p, 300);
    ok(`${pref}25 resolver exige la solución`, /indica la solución/i.test(await item(p, conOC.id).locator("[data-acc-error]").innerText()));
    const ocAntes = JSON.stringify(b.db.ordenes_compra_v2.find((o) => o.id === "oc2"));
    await item(p, conOC.id).locator("[data-acc-texto]").fill("Guía recibida"); await item(p, conOC.id).locator("[data-acc-confirmar]").click(); await espera(p, 1300);
    const s2 = b.db.oc_seguimientos.find((s) => s.id === conOC.id);
    ok(`${pref}26 resuelta: fecha, usuario y solución; sale de la bandeja`, s2.estado === "resuelto" && s2.solucion === "Guía recibida" && s2.resuelto_por === "u2" && !!s2.resuelto_en && !(await items(p)).includes(conOC.id), { s2, items: await items(p) });
    ok(`${pref}27 resolver no modifica la OC`, JSON.stringify(b.db.ordenes_compra_v2.find((o) => o.id === "oc2")) === ocAntes);
    await centro(p).locator("[data-acc-ver-resueltas]").click(); await espera(p, 300); await abrirItem(p, conOC.id);
    await item(p, conOC.id).locator("[data-acc-reabrir]").click(); await item(p, conOC.id).locator("[data-acc-confirmar]").click(); await espera(p, 300);
    ok(`${pref}28 reabrir pide el motivo`, /por qué se reabre/.test(await item(p, conOC.id).locator("[data-acc-error]").innerText()));
    await item(p, conOC.id).locator("[data-acc-texto]").fill("La guía venía con error"); await item(p, conOC.id).locator("[data-acc-confirmar]").click(); await espera(p, 1300);
    const s3 = b.db.oc_seguimientos.find((s) => s.id === conOC.id);
    ok(`${pref}29 un usuario reabre: vuelve a pendiente y el historial guarda la solución anterior y el motivo`, s3.estado === "pendiente" && s3.solucion === null
      && b.db.historial_cambios.some((h) => h.campo === "seguimiento:" + conOC.id && h.accion === "Acción: reabierta" && /Guía recibida/.test(h.valor_anterior))
      && b.db.historial_cambios.some((h) => h.campo === "seguimiento:" + conOC.id && /La guía venía con error/.test(h.valor_nuevo || "")));
    await centro(p).locator('[data-acc-contador="abiertas"]').click(); await espera(p, 300);
    ok(`${pref}30 un usuario no ve «Eliminar» ni la gestión de categorías`, (await centro(p).locator("[data-acc-eliminar]").count()) === 0 && (await centro(p).locator("[data-acc-abrir-categorias]").count()) === 0);
    // Varias acciones independientes por OC
    ok(`${pref}31 una OC puede tener varias acciones independientes`, b.db.oc_seguimientos.filter((s) => s.oc_id === "oc2" && s.estado !== "resuelto").length >= 1 && b.db.oc_seguimientos.filter((s) => s.oc_id === "oc1").length >= 1);
    // Postventa automática: otra sesión registra un incidente → aparece al sincronizar; al cerrarlo se resuelve sola
    b.escribir("POST", "eventos_postventa", new URLSearchParams(), { id: "pvN", oc_id: "oc4", fecha: dias(0), tipo: "faltante", descripcion: "Faltó una unidad", estado: "abierto", costo_extra: 0 }, "u1");
    await p.evaluate(() => document.dispatchEvent(new Event("visibilitychange"))); await espera(p, 1200);
    const auto = b.db.oc_seguimientos.find((s) => s.origen === "postventa" && s.origen_id === "pvN");
    ok(`${pref}32 incidente de postventa → UNA acción automática visible sin recargar la página`, !!auto && b.db.oc_seguimientos.filter((s) => s.origen_id === "pvN").length === 1 && (await items(p)).includes(auto?.id) && /Automática/.test(await item(p, auto.id).innerText()));
    b.escribir("PATCH", "eventos_postventa", new URLSearchParams("id=eq.pvN"), { estado: "resuelto", solucion: "Se envió la unidad" }, "u1");
    await recargar(p);
    ok(`${pref}33 incidente cerrado → la acción se resuelve sola y sale de la bandeja`, b.db.oc_seguimientos.find((s) => s.origen_id === "pvN").estado === "resuelto" && !(await items(p)).includes(auto.id));
    // Persistencia
    await p.reload({ waitUntil: "load" }); await espera(p, 2600);
    ok(`${pref}34 después de recargar, todo sigue igual (persistencia)`, (await items(p)).includes(nueva[0].id) && (await items(p)).includes(conOC.id) && (await n(p, "abiertas")) === 7, await n(p, "abiertas"));
    // Ver OC → ficha con la acción en Seguimiento especial
    await abrirItem(p, "sA"); await item(p, "sA").locator("[data-acc-abrir-oc]").click(); await espera(p, 1600);
    const ficha = p.locator("[data-ficha-oc]").last();
    if (!(await ficha.locator("[data-seguimiento-especial]").isVisible().catch(() => false))) { await irSeccionFicha(ficha, /Seguimiento/); await espera(p, 500); }
    ok(`${pref}35 «Ver OC» abre la OC con la acción en su Seguimiento especial (mismo registro)`, (await ficha.count()) === 1 && /Confirmar despacho con proveedor/.test(await ficha.locator('[data-seg-item="sA"]').innerText()));
    // Desde la ficha: crear un seguimiento con título → aparece en el Centro
    await ficha.locator("[data-seg-agregar]").click(); await espera(p, 300);
    const cats = await ficha.locator('[data-seg="categoria"] option').allInnerTexts();
    ok(`${pref}36 la ficha de la OC usa el catálogo de categorías (incluye las nuevas)`, cats.includes("Instalaciones y servicios técnicos") && cats.includes("Cobranza") && cats.includes("Subsanación de factura"), cats);
    await ficha.locator('[data-seg="categoria"]').selectOption("cobranza"); await ficha.locator('[data-seg="titulo"]').fill("Llamar a tesorería");
    await ficha.locator('[data-seg="descripcion"]').fill("Consultar fecha de pago"); await ficha.locator("[data-seg-guardar]").click(); await espera(p, 1500);
    const deFicha = b.db.oc_seguimientos.find((s) => s.titulo === "Llamar a tesorería");
    // En la ficha (mismo registro): resolver y reabrir con motivo (usuario no administrador)
    const it = ficha.locator(`[data-seg-item="${deFicha.id}"]`);
    ok(`${pref}36b la ficha muestra el título de la acción`, /Llamar a tesorería/.test(await it.innerText()));
    await it.locator("[data-seg-resolver-abrir]").click(); await it.locator('[data-seg="solucion"]').fill("Tesorería confirmó el pago"); await it.locator("[data-seg-confirmar]").click(); await espera(p, 1500);
    ok(`${pref}36c resolver desde la ficha (la base registra quién y cuándo)`, b.db.oc_seguimientos.find((s) => s.id === deFicha.id).estado === "resuelto" && b.db.oc_seguimientos.find((s) => s.id === deFicha.id).resuelto_por === "u2");
    if (!(await ficha.locator(`[data-seg-resuelto="${deFicha.id}"]`).isVisible().catch(() => false))) { await ficha.locator("[data-seg-ver-resueltos]").click(); await espera(p, 300); }
    const rz = ficha.locator(`[data-seg-resuelto="${deFicha.id}"]`);
    await rz.locator("[data-seg-reabrir]").click(); await rz.locator("[data-seg-reabrir-confirmar]").click(); await espera(p, 300);
    const sinMotivo = b.db.oc_seguimientos.find((s) => s.id === deFicha.id).estado === "resuelto";
    await rz.locator('[data-seg="motivo_reapertura"]').fill("El pago no llegó"); await rz.locator("[data-seg-reabrir-confirmar]").click(); await espera(p, 1500);
    ok(`${pref}36d reabrir desde la ficha exige motivo y vuelve a pendiente`, sinMotivo && b.db.oc_seguimientos.find((s) => s.id === deFicha.id).estado === "pendiente"
      && b.db.historial_cambios.some((h) => h.campo === "seguimiento:" + deFicha.id && /El pago no llegó/.test(h.valor_nuevo || "")));
    await p.keyboard.press("Escape"); await espera(p, 500); if (await p.locator("[data-ficha-oc]").count()) { await p.locator("[data-cerrar-hoja]").last().click().catch(() => {}); await espera(p, 400); }
    await irA(p, "panel");
    ok(`${pref}37 lo creado en la ficha de la OC aparece en el Centro (un solo sistema)`, deFicha?.oc_id === "oc1" && (await items(p)).includes(deFicha.id));
    // Entrega fallida → acción automática; al registrar la entrega se resuelve sola
    const rEF = b.rpc("acc_registrar_entrega_fallida", { p_oc_id: "oc5", p_lugar: "bodega", p_motivo: "bodega cerrada" }, "u1");
    const rEF2 = b.rpc("acc_registrar_entrega_fallida", { p_oc_id: "oc5", p_lugar: "bodega", p_motivo: "nadie recibió" }, "u1");
    await recargar(p);
    const ef = b.db.oc_seguimientos.filter((s) => s.origen === "entrega_fallida" && s.oc_id === "oc5");
    ok(`${pref}38 entrega fallida → UNA acción automática (un 2.º intento no la duplica)`, rEF.json.nueva === true && rEF2.json.nueva === false && ef.length === 1 && ef[0].prioridad === "alta" && (await items(p)).includes(ef[0].id));
    b.escribir("POST", "eventos_entrega", new URLSearchParams(), { id: "enN", oc_id: "oc5", fecha: dias(0), persona_recibe: "Bodeguero" }, "u1");
    await recargar(p);
    ok(`${pref}39 al registrar la entrega, la acción de entrega fallida se resuelve sola`, b.db.oc_seguimientos.find((s) => s.id === ef[0].id).estado === "resuelto" && !(await items(p)).includes(ef[0].id));
    // Sincronización entre sesiones (otra pestaña / otro usuario)
    const p2ctx = await browser.newContext({ viewport: { width: dim.ancho, height: dim.alto }, isMobile: dim.movil, hasTouch: dim.movil, timezoneId: "America/Santiago" });
    const p2 = await p2ctx.newPage(); await instalarRutas(p2, b, "u1");
    await p2.addInitScript(() => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "tu1", refresh_token: "r", user: { id: "u1", email: "u1@prueba.cl" } })); });
    await p2.goto(URL_APP, { waitUntil: "load" }); await espera(p2, 2600);
    await abrirItem(p2, "sC"); await item(p2, "sC").locator("[data-acc-prioridad]").selectOption("alta"); await espera(p2, 1000);
    await recargar(p);
    ok(`${pref}40 lo que cambia otro usuario aparece en esta sesión al sincronizar`, (await item(p, "sC").getAttribute("data-acc-prioridad")) === "alta");
    ok(`${pref}41 un administrador ve «Eliminar» y la gestión de categorías`, (await item(p2, "sC").locator("[data-acc-eliminar]").count()) === 1 && await (async () => { await centro(p2).locator("[data-acc-ver-filtros]").click(); await espera(p2, 200); return (await centro(p2).locator("[data-acc-abrir-categorias]").count()) === 1; })());
    await centro(p2).locator("[data-acc-abrir-categorias]").click(); await espera(p2, 300);
    await p2.locator("[data-acc-nueva-categoria]").fill("Licitaciones"); await p2.locator("[data-acc-categorias] button", { hasText: "Agregar" }).click(); await espera(p2, 900);
    ok(`${pref}42 el administrador agrega una categoría nueva (sin tocar los registros)`, b.db.acciones_categorias.some((x) => x.etiqueta === "Licitaciones") && b.db.oc_seguimientos.every((s) => s.categoria !== "licitaciones"));
    await p2ctx.close();
    // Alertas: acción sin OC urgente → desde Alertas vuelve a Inicio con la acción desplegada
    await irA(p, "notif"); await espera(p, 500);
    const al = p.locator(`[data-alerta-seguimiento="${nueva[0].id}"]`);
    ok(`${pref}43 una acción sin OC urgente aparece en Alertas`, (await al.count()) === 1);
    await al.first().click(); await espera(p, 1200);
    ok(`${pref}44 desde la alerta se abre su detalle en el Centro`, (await item(p, nueva[0].id).locator("[data-acc-detalle]").count()) === 1);
    // Entrega fallida desde la ficha de la OC (aviso al cliente confirmado) → acción automática en el Centro
    {
      const nEF0 = b.db.oc_seguimientos.filter((x) => x.origen === "entrega_fallida" && x.oc_id === "oc2").length;
      await irA(p, "compras"); await p.evaluate(() => { window.open = () => null; });
      await p.locator('[data-oc="2002-102-SE26"] > div').first().click(); await espera(p, 1400);
      const fz = p.locator("[data-ficha-oc]").last(); await irSeccionFicha(fz, "Entrega"); await espera(p, 450);
      await p.getByRole("button", { name: /Entrega fallida/ }).first().click(); await espera(p, 500);
      const modal = p.locator('[role="dialog"]').last();
      await modal.locator('input[type="email"]').fill("bodega@muni.cl");
      await modal.locator("[data-abrir-correo]").click(); await espera(p, 400);
      await modal.locator("[data-confirmar-envio]").click(); await espera(p, 1800);
      const ef2 = b.db.oc_seguimientos.filter((x) => x.origen === "entrega_fallida" && x.oc_id === "oc2");
      await p.keyboard.press("Escape"); await espera(p, 400); if (await p.locator("[data-ficha-oc]").count()) { await p.locator("[data-cerrar-hoja]").last().click().catch(() => {}); await espera(p, 400); }
      await irA(p, "panel");
      ok(`${pref}44b aviso de entrega fallida confirmado en la ficha → UNA acción «Reprogramar entrega fallida» en el Centro`, nEF0 === 0 && ef2.length === 1 && ef2[0].prioridad === "alta" && /Motivo:/.test(ef2[0].descripcion) && (await items(p)).includes(ef2[0].id), ef2);
    }
    // Celular / computador: sin desborde horizontal
    const anchos = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok(`${pref}45 sin desborde horizontal`, anchos.sw <= anchos.iw + 1, anchos);
    ok(`${pref}46 ninguna escritura financiera; montos y estados de las OC intactos`, escrFin(b, n0).length === 0 && huellaOC(b) === oc0, escrFin(b, n0).map((w) => [w.metodo, w.tabla, JSON.stringify(w.cuerpo).slice(0, 200)]));
    ok(`${pref}47 sin errores de página`, !errs.length, errs);
    await p.screenshot({ path: `/tmp/acciones_${pref}.png`, fullPage: false });
  } catch (e) { F.push(pref + " EXCEPCIÓN " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.message.split("\n").slice(0, 3).join(" | ")); await p.screenshot({ path: `/tmp/acciones_${pref}_error.png` }).catch(() => {}); }
  await ctx.close();
}
await browser.close();
console.log(`RESUMEN Centro de Acciones (interfaz): ${nOk} OK, ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
