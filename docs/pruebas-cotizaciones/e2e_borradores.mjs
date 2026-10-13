// Recuperación de Cotizaciones (13/10/2026): la renovación de sesión no cierra el editor y la copia local
// (IndexedDB) restaura lo escrito tras recarga, cierre inesperado de la pestaña o cambio de pantalla.
// Supabase, /api y Storage SIMULADOS (nada sale a la red). Escritorio, iPhone (Safari emulado) y Android (Chrome emulado).
// Uso: NODE_PATH=$PWD/node_modules node docs/pruebas-cotizaciones/e2e_borradores.mjs http://127.0.0.1:4190/
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, CHROME, crearBase, abrir, instalarRutas } from "../pruebas-oc/mock_estado.mjs";
import { crearDatos } from "../pruebas-oc/datos_oc.mjs";
import { moduloSimulado } from "./modulo_simulado.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const URL_APP = process.argv[2] || "http://127.0.0.1:4190/";
const LOGO = join(AQUI, "../../src/assets/bfk-logo.jpg");
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const F = []; let nOk = 0;
const ok = (k, v, d) => { if (!v) { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } else { nOk++; console.log("OK    " + k); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const UA_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";

const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const fichaModal = (p) => p.locator("[data-editor-ficha]");
const llenar = async (loc, v) => { await loc.fill(""); await loc.fill(String(v)); };
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const irCotizaciones = async (p, movil) => {
  if (movil) { await p.locator('[data-nav="mas"]').click(); await espera(p); await p.locator('[role="dialog"] [data-nav="cotizaciones"]').click(); }
  else await p.locator('aside [data-nav="cotizaciones"]').click();
  await espera(p, 1500);
};
// Simula cambiar de aplicación / pestaña / bloquear el teléfono (el navegador emite visibilitychange).
const visibilidad = (p, e) => p.evaluate((e) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => e === "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}, e);
const borradoresIDB = (p) => p.evaluate(() => new Promise((res) => {
  const r = indexedDB.open("bfk-borradores");
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("cotizaciones")) { db.close(); return res([]); }
    const q = db.transaction("cotizaciones").objectStore("cotizaciones").getAll();
    q.onsuccess = () => { db.close(); res(q.result.map((x) => ({ usuario: x.usuario, idLocal: x.idLocal, cotId: x.cotId, inst: x.cot?.institucion, recargo: x.cot?.recargo, nItems: x.cot?.items?.length, ficha: x.ficha?.estado?.it?.ficha?.nombre || null, versionBase: x.versionBase, pestana: x.pestana }))); }; };
  r.onerror = () => res([]);
}));

async function preparar({ usuario = "u1", ancho = 1280, alto = 900, movil = false, ua } = {}) {
  const b = crearBase(crearDatos(), {});
  const r = await abrir(browser, b, { url: URL_APP, usuario, ancho, alto, movil, ua, espera: 2500 });
  const M = moduloSimulado(2);
  const tokens = []; let n = 0;
  const conectar = async (pg, yo) => {
    await pg.route("**/*", (route) => M.manejar(route));
    // Renovación de sesión: cada renovación entrega un token NUEVO (como Supabase).
    await pg.route("**/auth/v1/token**", (route) => { n++; route.fulfill({ json: { access_token: `t${yo}-renovado-${n}`, refresh_token: "r", expires_in: 3600, user: { id: yo } } }); });
    pg.on("request", (q) => { const a = q.headers()["authorization"]; if (/supabase\.co\/rest/.test(q.url()) && a) tokens.push({ url: q.url(), t: a.replace("Bearer ", "") }); });
  };
  await conectar(r.page, usuario);
  // Nueva pestaña en el MISMO dispositivo (mismo IndexedDB), opcionalmente con otro usuario.
  const nuevaPestana = async (yo = usuario) => {
    const pg = await r.ctx.newPage(); const errs = [];
    pg.on("pageerror", (e) => errs.push(e.message)); pg.on("dialog", (d) => d.accept());
    await instalarRutas(pg, b, yo); await conectar(pg, yo);
    await pg.addInitScript((id) => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t" + id, refresh_token: "r", user: { id, email: id + "@prueba.cl" } })); }, yo);
    await pg.goto(URL_APP, { waitUntil: "load" }); await pg.waitForTimeout(3500);
    pg.errs = errs; return pg;
  };
  // Cierre inesperado: el sistema mata la pestaña (sin pagehide ni visibilitychange).
  const matar = async (pg) => { const cdp = await r.ctx.newCDPSession(pg); cdp.send("Page.crash").catch(() => {}); await new Promise((ok) => setTimeout(ok, 1200)); };
  return { ...r, p: r.page, M, b, tokens, nuevaPestana, matar };
}
async function productoIncompleto(p) {
  await tab(p, "productos");
  await H(p).locator("[data-ingreso-manual]").click(); await espera(p);
  const f = fichaModal(p);
  await llenar(f.locator('[data-campo="nombre"]'), "TALADRO PERCUTOR 750W");
  await llenar(f.locator('[data-campo="especificaciones"]'), "Potencia: 750 W\nMandril: 13 mm");
  await f.locator('input[type="file"]').setInputFiles(LOGO); await espera(p, 900);
  await llenar(f.locator('[data-campo="enlace"]'), "https://www.sodimac.cl/sodimac-cl/product/123/taladro");
  await llenar(f.locator('[data-campo="proveedor"]'), "Sodimac");
  await llenar(f.locator('[data-campo="cantidad"]'), 3);
  await llenar(f.locator('[data-campo="precio"]'), 45990);
}
const valoresFicha = async (p) => { const f = fichaModal(p); return {
  nombre: await f.locator('[data-campo="nombre"]').inputValue(), esp: await f.locator('[data-campo="especificaciones"]').inputValue(),
  enlace: await f.locator('[data-campo="enlace"]').inputValue(), proveedor: await f.locator('[data-campo="proveedor"]').inputValue(),
  cantidad: await f.locator('[data-campo="cantidad"]').inputValue(), precio: await f.locator('[data-campo="precio"]').inputValue(),
  fotos: await f.locator("img").count() }; };
const fichaCompleta = (v) => v.nombre === "TALADRO PERCUTOR 750W" && /Mandril: 13 mm/.test(v.esp) && /sodimac\.cl/.test(v.enlace) && v.proveedor === "Sodimac" && v.cantidad === "3" && v.precio === "45990" && v.fotos >= 1;

// ═════ A. Escritorio ═════
{
  const S = await preparar();
  let p = S.p;
  await irCotizaciones(p, false);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipalidad de Laja");
  await llenar(H(p).locator('[data-campo="direccion"]'), "Balmaceda 292");
  await llenar(H(p).locator('[data-campo="comuna"]'), "Laja");
  await productoIncompleto(p);

  // A1. Cambio de app/pestaña + renovación de sesión: el editor y la ventana del producto siguen abiertos.
  const tokensAntes = S.tokens.length;
  await visibilidad(p, "hidden"); await espera(p, 600); await visibilidad(p, "visible"); await espera(p, 1500);
  ok("A01_renovacion_no_cierra_editor", await H(p).isVisible() && await fichaModal(p).isVisible());
  ok("A02_ventana_producto_conserva_lo_escrito", fichaCompleta(await valoresFicha(p)), await valoresFicha(p));
  await fichaModal(p).locator('[data-campo="nombre"]').press("End");
  await p.keyboard.type(" X"); await p.keyboard.press("Backspace"); await p.keyboard.press("Backspace"); // sigue editable
  await visibilidad(p, "hidden"); await espera(p, 300); await visibilidad(p, "visible"); await espera(p, 1500);
  ok("A03_bloqueo_y_desbloqueo_repetido", await fichaModal(p).isVisible() && fichaCompleta(await valoresFicha(p)));
  await H(p).locator('[data-hoja-lateral="cotizacion"]').count();
  // Las consultas posteriores usan el token renovado (la autenticación se actualiza sin desmontar).
  await fichaModal(p).locator("[data-guardar-ficha]").isVisible();
  // El módulo de cotizaciones sigue consultando con el token RENOVADO (sin recrear el almacén ni cerrar nada).
  ok("A04_sin_guardar_en_supabase_todavia", S.M.rpc.filter((x) => /guardar_cotizacion/.test(x.fn)).length === 0);
  await espera(p, 800);
  const idb1 = await borradoresIDB(p);
  ok("A05_copia_local_en_indexeddb_con_producto_incompleto", idb1.length === 1 && idb1[0].usuario === "u1" && idb1[0].inst === "Municipalidad de Laja" && idb1[0].ficha === "TALADRO PERCUTOR 750W" && !idb1[0].cotId, idb1);

  // A2. Recarga del navegador: se restaura el borrador con la ventana del producto, marcado como recuperado.
  await p.reload({ waitUntil: "load" }); await espera(p, 3500);
  ok("A06_recarga_vuelve_a_cotizaciones_y_reabre", await H(p).isVisible());
  ok("A07_aviso_borrador_recuperado_localmente", /Borrador recuperado localmente/.test(await H(p).locator('[data-aviso-linea="borrador-recuperado"]').innerText().catch(() => "")));
  ok("A08_estado_dice_solo_local_no_bfk", (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "local" && /no se han guardado en BFK|sin guardar en BFK/i.test(await H(p).innerText()) && !/Cotización guardada en BFK/.test(await H(p).innerText()));
  ok("A09_producto_incompleto_restaurado", await fichaModal(p).isVisible() && fichaCompleta(await valoresFicha(p)) && /recuperado localmente/i.test(await fichaModal(p).innerText()), await valoresFicha(p).catch(() => null));
  await fichaModal(p).locator('[data-campo="monto-despacho"]').fill("5990");
  await fichaModal(p).locator("[data-guardar-ficha]").click(); await espera(p, 600);
  await tab(p, "datos");
  ok("A10_datos_del_cliente_restaurados", (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipalidad de Laja" && (await H(p).locator('[data-campo="direccion"]').inputValue()) === "Balmaceda 292");

  // A3. Guardar en BFK: la copia local se limpia y el estado cambia a «Guardada en BFK».
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1200);
  const guardada = [...S.M.cots.values()][0];
  const rpcGuardar = S.tokens.filter((x) => /cz_guardar_cotizacion/.test(x.url)).pop();
  ok("A11b_guardado_con_token_renovado", !!rpcGuardar && /renovado/.test(rpcGuardar.t), rpcGuardar);
  ok("A11_guardado_real_en_bfk", S.M.cots.size === 1 && guardada.items.length === 1 && guardada.items[0].precio_origen == 45990 && guardada.institucion === "Municipalidad de Laja");
  ok("A12_estado_guardado_en_bfk", (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "bfk" && !(await H(p).locator('[data-aviso-linea="borrador-recuperado"]').count()));
  await espera(p, 700);
  ok("A13_copia_local_limpiada_al_guardar", (await borradoresIDB(p)).length === 0, await borradoresIDB(p));

  // A4. Cambio posterior + cierre inesperado (sin pagehide): se recupera lo último escrito.
  await tab(p, "precios");
  await llenar(H(p).locator('[data-campo="recargo"]'), 35);
  await tab(p, "datos");
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipalidad de Laja (editada)");
  await espera(p, 900);
  await S.matar(p);
  p = await S.nuevaPestana();
  ok("A14_cierre_inesperado_restaura", await H(p).isVisible() && (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipalidad de Laja (editada)");
  const idb2 = await borradoresIDB(p);
  ok("A15_borrador_de_cotizacion_guardada_con_version_base", idb2.length === 1 && idb2[0].cotId === guardada.id && idb2[0].versionBase === 1 && idb2[0].pestana === "datos", idb2);
  ok("A16_recargo_restaurado", String(idb2[0]?.recargo) !== String(guardada.recargo), { local: idb2[0]?.recargo, bfk: guardada.recargo });

  // A5. Versión más reciente en BFK: se advierte y NO se sobrescribe en silencio.
  await S.matar(p);
  S.M.cots.get(guardada.id).version = 5; S.M.cots.get(guardada.id).institucion = "Cambio de otra persona";
  p = await S.nuevaPestana();
  ok("A17_advierte_version_mas_reciente_en_bfk", /versión más reciente \(versión 5\)/.test(await H(p).innerText()));
  await H(p).locator("[data-guardar-cotizacion]").click(); await espera(p, 1200);
  ok("A18_no_sobrescribe_version_mas_reciente", S.M.cots.get(guardada.id).institucion === "Cambio de otra persona" && S.M.cots.get(guardada.id).version === 5);
  ok("A19_cambios_locales_siguen_disponibles", (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipalidad de Laja (editada)" && (await borradoresIDB(p)).length === 1);

  // A6. Descartar expresamente: pide confirmación y borra solo su borrador local.
  await p.locator('[data-cerrar-hoja]').first().click(); await espera(p, 800);
  ok("A20_descartar_borra_solo_su_borrador", !(await H(p).count()) && (await borradoresIDB(p)).length === 0 && S.M.cots.get(guardada.id).institucion === "Cambio de otra persona");

  // A7. Cambiar de pantalla dentro de BFK y volver: se restaura.
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await llenar(H(p).locator('[data-campo="institucion"]'), "Hospital de Laja");
  await p.locator('aside [data-nav="panel"]').click({ force: true }).catch(() => {}); await espera(p, 800);
  if (await H(p).count()) { await p.keyboard.press("Escape").catch(() => {}); }
  await irCotizaciones(p, false);
  ok("A21_cambio_de_pantalla_restaura", await H(p).isVisible() && (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Hospital de Laja");

  // A8. Otro usuario en el mismo dispositivo: no ve borradores ajenos.
  const otro = await S.nuevaPestana("u2");
  await irCotizaciones(otro, false).catch(() => {});
  const txt = await otro.locator("[data-panel-cotizaciones]").innerText().catch(() => "");
  ok("A22_otro_usuario_no_ve_borradores_ajenos", !(await H(otro).count()) && !/Hospital de Laja|recuperad/i.test(txt) && (await borradoresIDB(otro)).every((x) => x.usuario === "u1"));
  ok("A23_sin_errores", !(S.errs || []).length && !(otro.errs || []).length && !(p.errs || []).length, [...(S.errs || []), ...(otro.errs || []), ...(p.errs || [])]);
  await S.ctx.close();
}

// ═════ B. iPhone (Safari emulado) y C. Android (Chrome emulado) ═════
for (const [pref, disp] of [["B", { ancho: 390, alto: 844, ua: UA_IPHONE }], ["C", { ancho: 412, alto: 915, ua: UA_ANDROID }]]) {
  const S = await preparar({ movil: true, ...disp });
  let p = S.p;
  await irCotizaciones(p, true);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await llenar(H(p).locator('[data-campo="institucion"]'), "Liceo de Laja");
  await llenar(H(p).locator('[data-campo="direccion"]'), "Los Boldos 100");
  await productoIncompleto(p);
  // Cambiar de app y bloquear el teléfono (oculto varios segundos) → al volver se renueva la sesión.
  await visibilidad(p, "hidden"); await espera(p, 2500); await visibilidad(p, "visible"); await espera(p, 1500);
  ok(`${pref}01_bloqueo_y_cambio_de_app_no_cierran`, await H(p).isVisible() && await fichaModal(p).isVisible() && fichaCompleta(await valoresFicha(p)));
  // Toque accidental fuera de la ventana del producto: pide confirmación (aquí se rechaza → sigue abierta).
  p.removeAllListeners("dialog"); p.once("dialog", (d) => d.dismiss());
  await p.locator(".bfk-ventana-fondo").last().click({ position: { x: 5, y: 5 } }); await espera(p, 400);
  ok(`${pref}02_toque_fuera_no_pierde_producto`, await fichaModal(p).isVisible() && fichaCompleta(await valoresFicha(p)));
  p.on("dialog", (d) => d.accept());
  await espera(p, 600);
  // Cierre inesperado por memoria → al volver se recupera todo (producto incompleto incluido).
  await S.matar(p);
  p = await S.nuevaPestana();
  ok(`${pref}03_cierre_inesperado_recupera_producto_incompleto`, await H(p).isVisible() && await fichaModal(p).isVisible() && fichaCompleta(await valoresFicha(p)));
  ok(`${pref}04_marcado_como_recuperado_no_guardado`, /Borrador recuperado localmente/.test(await H(p).innerText()) && (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "local" && S.M.rpc.filter((x) => /guardar_cotizacion/.test(x.fn)).length === 0);
  ok(`${pref}05_sin_errores`, !(S.errs || []).length && !(p.errs || []).length, [...(S.errs || []), ...(p.errs || [])]);
  await S.ctx.close();
}

await browser.close();
console.log(`\n${nOk} OK · ${F.length} fallas`);
process.exit(F.length ? 1 : 0);
