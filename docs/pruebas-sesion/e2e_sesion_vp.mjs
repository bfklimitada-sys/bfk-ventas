// Renovación de sesión y sesiones vencidas (10/11/2026) — Ventas privadas, navegador real, PostgREST REAL sobre una base
// desechable (nunca producción) y un servicio de sesión simulado con las reglas de Supabase Auth (tokens con vencimiento real,
// refresh token de un solo uso). El token que envía la app llega tal cual a PostgREST: un «JWT expired» es un rechazo real.
// Comprueba que guardar cotizaciones, emitir EETT y crear ventas ocurren EXACTAMENTE UNA VEZ con: sesión vencida, varias
// pestañas, suspensión y reactivación, pérdida de conexión (antes de enviar y con respuesta incierta) y fallo de renovación;
// y que una pestaña desactualizada recupera lo escrito y resuelve el conflicto sin sobrescribir.
// Uso: (entorno.sh instalar) → PGRST_URL, JWT_SECRET, VP_DB_URL · node docs/pruebas-sesion/e2e_sesion_vp.mjs http://127.0.0.1:4330/
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { abrir, crearAuth, chromium, CHROME, U, psql, comoUsuario, archivos } from "../pruebas-ventas-privadas/arnes_vp.mjs";
import * as ui from "../pruebas-ventas-privadas/ui_cotizacion_vp.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url)); const VPD = join(AQUI, "../pruebas-ventas-privadas");
const URL_APP = process.argv[2] || "http://127.0.0.1:4330/";
const SOLO = (process.env.SOLO || "").split(",").filter(Boolean);
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, typeof det === "string" ? det.slice(0, 700) : JSON.stringify(det).slice(0, 700)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const q1 = (sql) => psql(sql).split("\n").pop();
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const LLAVE = "bfk_supabase_session_v2";

// ── Datos: cliente y cotizaciones con la ficha de la copia aislada de CP-2026-0001 (lista para emitir EETT) ──────────────────
const FX = JSON.parse(readFileSync(join(VPD, "fixture_cp_2026_0001.json"), "utf8")); const ficha = FX.item.ficha; const C = FX.cat;
for (const r of ficha.imagenes) { psql(`insert into storage.objects (bucket_id, name, owner, metadata) values ('cz-productos', ${lit(r)}, '${U.ana}', '{}'::jsonb) on conflict do nothing;`); archivos.set("cz-productos/" + r, readFileSync(join(VPD, "fixture_cp_2026_0001", r.split("/").pop()))); }
psql(`insert into public.productos_catalogo (id, nombre, marca, modelo, color, descripcion_tecnica, caracteristicas, especificaciones, imagenes, fuente, estado, creado_por, ultima_revision)
      values ('${C.id}', ${lit(C.nombre)}, ${lit(C.marca)}, ${lit(C.modelo)}, ${lit(C.color)}, ${lit(C.descripcion_tecnica)}, ${lit(JSON.stringify(ficha.generales))}::jsonb, ${lit(JSON.stringify(ficha.especificaciones))}::jsonb, ${lit(JSON.stringify(C.imagenes))}::jsonb, ${lit(C.fuente)}, 'aprobado', '${U.ana}', now()) on conflict do nothing;`);
const cliPrevio = q1(`select id from public.pi_clientes where regexp_replace(rut, '[^0-9kK]', '', 'g') = '760864285' limit 1;`);
const cli = cliPrevio ? { id: cliPrevio } : JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_guardar_cliente(${lit(JSON.stringify({ rut: "76086428-5", razon_social: "Maderas del Sur SpA (prueba)", tipo_persona: "empresa", direccion_entrega: "Planta km 5, Laja", comuna_entrega: "Laja" }))}::jsonb);`));
function nuevaCot() {
  const cot = JSON.parse(q1(`${comoUsuario(U.ana)}select public.vp_guardar_cotizacion(${lit(JSON.stringify({ cliente_id: cli.id, plazo_entrega: "10 días hábiles", vigencia_dias: 15, observaciones: "inicial",
    items: [{ tipo: "producto", producto_id: C.id, descripcion: FX.item.descripcion, unidad: "UN", cantidad: 2, precio_unitario: 59990, ficha, ficha_aprobada: true }] }))}::jsonb);`));
  return { id: cot.id, folio: q1(`select folio from public.vp_cotizaciones where id = '${cot.id}';`) };
}
const version = (id) => Number(q1(`select version from public.vp_cotizaciones where id = '${id}';`));
const revision = (id) => JSON.parse(q1(`select to_jsonb(r) from public.vp_cotizacion_revisiones r join public.vp_cotizaciones c on c.id = r.cotizacion_id and c.revision_actual = r.numero where c.id = '${id}';`));
const nRev = (id) => Number(q1(`select count(*) from public.vp_cotizacion_revisiones where cotizacion_id = '${id}';`));
const nEETT = (id, estado) => Number(q1(`select count(*) from public.vp_eett where cotizacion_id = '${id}'${estado ? ` and estado = '${estado}'` : ""};`));
const nVentas = (id) => Number(q1(`select count(*) from public.vp_ventas where cotizacion_id = '${id}';`));
const nCots = () => Number(q1(`select count(*) from public.vp_cotizaciones;`));

// ── Sesiones de prueba ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Vencida para el servidor, pero el navegador la cree vigente (reloj del equipo adelantado/atrasado: el caso «JWT expired»).
const vencidaEnServidor = (A, u) => ({ ...A.sesion(u, { ttl: 3600, hace: 3700 }), bfk_desfase: -3700 * 1000, bfk_recibido: Date.now() });
const queVenceEn = (A, u, seg) => ({ ...A.sesion(u, { ttl: seg }), bfk_desfase: 0, bfk_recibido: Date.now() });
const est = (p) => p.evaluate(() => window.__bfkSesion.estado());
const jtiDe = (A, tok) => A.datos("Bearer " + tok)?.jti;
const tokenGuardado = (p) => p.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || "null")?.access_token || null; } catch { return null; } }, LLAVE);
// Otra pestaña del mismo navegador guarda una sesión (las pestañas de la app la adoptan por el evento «storage»).
async function auxiliar(ctx) { const a = await ctx.newPage(); await a.route("**/*", (r) => r.fulfill({ contentType: "text/html", body: "<html><body>aux</body></html>" })); await a.goto(URL_APP + "__aux.html"); return a; }
const ponerSesion = async (aux, s) => { await aux.evaluate(([k, v]) => localStorage.setItem(k, v), [LLAVE, s ? JSON.stringify(s) : ""]); await aux.waitForTimeout(350); };
const visibilidad = (p, e) => p.evaluate((e) => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => e }); Object.defineProperty(document, "hidden", { configurable: true, get: () => e === "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }, e);
const borradores = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("bfk-borradores"); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("cotizaciones")) { db.close(); return res([]); }
  const q = db.transaction("cotizaciones").objectStore("cotizaciones").getAll(); q.onsuccess = () => { db.close(); res(q.result.map((x) => ({ usuario: x.usuario, cotId: x.cotId, versionBase: x.versionBase, obs: x.cot?.observaciones, plazo: x.cot?.plazo_entrega, base: !!x.base }))); }; q.onerror = () => res([]); }; r.onerror = () => res([]); }));
const descarga = async (p, accion, ms = 30000) => { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: ms }), accion()]); return dl.suggestedFilename(); };
const cuerpo = (p) => p.locator("body").innerText();
const desde = (A, i, obj, status) => A.pedidos.slice(i).filter((x) => x.obj === obj && (status === undefined || x.status === status));

async function irACotizaciones(p) { await p.locator('aside [data-nav="vp_cotizaciones"]').click(); await p.locator("[data-panel-vp-cotizaciones]").waitFor(); await espera(p, 500); }
async function abrirCot(p, folio) { if (await ui.hoja(p).isVisible().catch(() => false)) { await ui.pestana(p, "datos"); return; }   // tras recargar, la app la reabre sola
  await irACotizaciones(p); await p.locator(`[data-cotizacion="${folio}"]`).click(); await ui.hoja(p).waitFor(); await espera(p, 1500); await ui.pestana(p, "datos"); }
async function iniciar(browser, A, extra = {}) {
  const r = await abrir(browser, { usuario: U.ana, url: URL_APP, hash: "#/panel", auth: A, ...extra });
  const aux = extra.ctx ? null : await auxiliar(r.ctx);
  return { ...r, p: r.page, aux };
}
const campo = (p, k) => ui.hoja(p).locator(`[data-campo="${k}"]`);
const guardar = async (p, ms = 2600) => { await ui.hoja(p).locator("[data-guardar-cotizacion]").click(); await espera(p, ms); };
// Espera a que aparezca un aviso (los avisos duran pocos segundos).
const ve = async (p, re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await cuerpo(p))) return true; await p.waitForTimeout(120); } return false; };
const guardarViendo = async (p, re, ms = 8000) => { await ui.hoja(p).locator("[data-guardar-cotizacion]").click(); const v = await ve(p, re, ms); await espera(p, 1800); return v; };
const conexion = async (S, A, hay) => { A.sinConexion = !hay; await S.ctx.setOffline(!hay); };
const corre = (k) => !SOLO.length || SOLO.includes(k);

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  // ═══ A. Sesión vencida: rechazo confirmado «JWT expired» → renueva y reintenta UNA vez (guardar, EETT, venta) ═══════════════
  if (corre("A")) {
    const A = crearAuth(); const cot = nuevaCot(); const S = await iniciar(browser, A); const p = S.p;
    await abrirCot(p, cot.folio);
    ok("A00 la app abre con la sesión simulada (token real con vencimiento)", (await est(p)).estado === "vigente" && (await est(p)).vence_en_s > 3000, await est(p));
    await campo(p, "observaciones").fill("guardado con sesión vencida"); await espera(p, 600);
    // Token vencido DE VERDAD para PostgREST (por fecha) que el navegador cree vigente: lo rechaza PostgREST real y la app se recupera.
    let ia = A.pedidos.length; let ra = A.renovaciones(); await ponerSesion(S.aux, vencidaEnServidor(A, U.ana)); await espera(p, 2500);
    const reales = A.pedidos.slice(ia).filter((x) => x.obj.startsWith("vp_") || x.obj.startsWith("rpc/vp_"));
    ok("A01 PostgREST real rechaza el token vencido («JWT expired»); la app renueva UNA vez y repite cada lectura una vez", reales.some((x) => x.status === 401) && A.renovaciones() === ra + 1
      && [...new Set(reales.filter((x) => x.status === 401).map((x) => x.obj))].every((o) => reales.filter((x) => x.obj === o && x.status === 200).length >= 1) && (await est(p)).estado === "vigente" && A.renovaciones("reuso") === 0, reales.map((x) => `${x.obj}:${x.status}`).join(" "));
    // Desde aquí el servidor de prueba da por vencido el token justo antes de cada operación (el navegador lo cree vigente).
    await espera(p, 800); A.vencerAhora();
    const i0 = A.pedidos.length; const r0 = A.renovaciones(); const v0 = version(cot.id);
    await guardar(p);
    const g = desde(A, i0, "rpc/vp_guardar_cotizacion");
    const rech = A.pedidos.slice(i0).filter((x) => x.status === 401);
    ok("A02 guardar: el servidor rechazó por «JWT expired» la primera solicitud, se renovó UNA vez, se repitió esa solicitud una vez y el guardado se ejecutó una sola vez", rech.length === 1 && A.pedidos.slice(i0).filter((x) => x.obj === rech[0].obj && x.status === 200).length >= 1
      && JSON.stringify(g.map((x) => x.status)) === "[200]" && A.renovaciones() === r0 + 1, A.pedidos.slice(i0).map((x) => `${x.obj}:${x.status}`).join(" "));
    ok("A03 guardar: la cotización quedó guardada exactamente una vez (versión +1, misma revisión)", version(cot.id) === v0 + 1 && revision(cot.id).observaciones === "guardado con sesión vencida" && nRev(cot.id) === 1, { v: version(cot.id), v0 });
    ok("A04 guardar: sin aviso de sesión y sin cambios pendientes", !(await p.locator("[data-aviso-sesion]").count()) && (await ui.hoja(p).locator('[data-estado-guardado="local"]').count()) === 0 && (await est(p)).reintentos >= 1);

    // Emitir EETT con la sesión vencida.
    await ui.pestana(p, "eett"); await espera(p, 500);
    A.vencerAhora();
    const i1 = A.pedidos.length; const r1 = A.renovaciones();
    const nombre = await descarga(p, () => ui.hoja(p).locator("[data-generar-eett]").click()); await espera(p, 1500);
    ok("A05 EETT: emitida y descargada con la sesión vencida (una renovación, un solo guardado y una sola emisión)", /^EETT_.*_Rev0\.pdf$/.test(nombre) && A.renovaciones() === r1 + 1
      && desde(A, i1, "rpc/vp_guardar_eett", 200).length === 1 && desde(A, i1, "rpc/vp_emitir_eett", 200).length === 1 && A.pedidos.slice(i1).filter((x) => x.status === 401).length === 1, A.pedidos.slice(i1).map((x) => `${x.obj}:${x.status}`).join(" "));
    ok("A06 EETT: UNA sola EETT, emitida, revisión 0", nEETT(cot.id) === 1 && nEETT(cot.id, "emitida") === 1 && q1(`select revision from public.vp_eett where cotizacion_id = '${cot.id}';`) === "0");

    // Crear la venta con la sesión vencida.
    psql(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cot.id}', 'enviada', '{}'::jsonb, ${version(cot.id)});`);
    psql(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cot.id}', 'aceptada', '{}'::jsonb, ${version(cot.id)});`);
    await ui.hoja(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 500); await abrirCot(p, cot.folio);
    await ui.hoja(p).locator('[data-accion-cot="crear-venta"]').click(); const cv = p.locator('[data-ventana="crear-venta"]'); await cv.waitFor();
    A.vencerAhora();
    const i2 = A.pedidos.length; const r2 = A.renovaciones();
    await cv.locator("[data-confirmar-venta]").click(); await p.locator('[data-hoja-lateral="ficha-venta"]').waitFor({ timeout: 15000 }); await espera(p, 800);
    const gv = desde(A, i2, "rpc/vp_crear_venta_desde_cotizacion");
    ok("A07 venta: rechazo por «JWT expired», renovación y UN reintento", JSON.stringify(gv.map((x) => x.status)) === "[401,200]" && A.renovaciones() === r2 + 1, gv);
    ok("A08 venta: UNA sola venta para la cotización", nVentas(cot.id) === 1);
    ok("A09 sin errores de página", !S.errs.length, S.errs.join(" | "));
    await S.ctx.close();
  }

  // ═══ B. Renovación anticipada, al volver a la pestaña y tras suspender el equipo ═══════════════════════════════════════════
  if (corre("B")) {
    const A = crearAuth(); const cot = nuevaCot(); const S = await iniciar(browser, A); const p = S.p;
    await abrirCot(p, cot.folio);
    // B1. Antes del vencimiento, sin que nadie haga nada (faltan menos de 5 minutos).
    let r0 = A.renovaciones(); await ponerSesion(S.aux, queVenceEn(A, U.ana, 280));
    for (let i = 0; i < 30 && A.renovaciones() === r0; i++) await espera(p, 1000);
    const e1 = await est(p);
    ok("B01 renueva sola antes del vencimiento (quedaban menos de 5 minutos)", A.renovaciones() === r0 + 1 && e1.vence_en_s > 3000 && e1.estado === "vigente", e1);
    ok("B02 la renovación no cerró el editor", await ui.hoja(p).isVisible());
    // B2 y B3: el reloj del navegador salta dos horas sin que corra nada en la página (así queda una pestaña inactiva o un equipo
    // suspendido) y, para el servidor, los tokens emitidos antes ya vencieron.
    await p.clock.install(); const DOS_HORAS = 2 * 3600 * 1000;
    const dormir = async () => { const r = A.renovaciones(); const viejo = jtiDe(A, await tokenGuardado(p)); A.vencerAhora(); await p.clock.setSystemTime(new Date(await p.evaluate(() => Date.now()) + DOS_HORAS)); return { r, viejo }; };
    // B2. Al volver a una pestaña que estuvo inactiva (el token venció mientras tanto).
    await visibilidad(p, "hidden"); let d = await dormir();
    const e2 = await est(p);
    ok("B03 pestaña inactiva dos horas: el token venció y todavía no se ha renovado", A.renovaciones() === d.r && e2.vence_en_s < 0, e2);
    await visibilidad(p, "visible");
    for (let i = 0; i < 20 && A.renovaciones() === d.r; i++) await espera(p, 250);
    ok("B04 al volver a la pestaña renueva de inmediato (una vez), sin esperar a que se pida algo", A.renovaciones() === d.r + 1 && (await est(p)).vence_en_s > 3000 && (await est(p)).estado === "vigente", await est(p));
    await campo(p, "observaciones").fill("tras volver a la pestaña"); const i0 = A.pedidos.length; const v0 = version(cot.id); await guardar(p);
    const g = desde(A, i0, "rpc/vp_guardar_cotizacion");
    ok("B05 guardar tras volver: una sola solicitud, aceptada, con el token renovado", g.length === 1 && g[0].status === 200 && g[0].jti !== d.viejo && version(cot.id) === v0 + 1, g);
    // B3. Suspensión del equipo: al reactivar se guarda de inmediato, sin eventos previos.
    await campo(p, "observaciones").fill("justo al reactivar el equipo"); await espera(p, 500);
    d = await dormir(); const i1 = A.pedidos.length; const v1 = version(cot.id);
    await guardar(p);
    const g2 = desde(A, i1, "rpc/vp_guardar_cotizacion");
    ok("B06 reactivar y guardar: renovó ANTES de enviar; una sola solicitud, sin rechazo, con el token nuevo", A.renovaciones() === d.r + 1 && g2.length === 1 && g2[0].status === 200 && g2[0].jti !== d.viejo && !A.pedidos.slice(i1).some((x) => x.status === 401), { g2, ren: A.renovaciones() - d.r, rech: A.pedidos.slice(i1).filter((x) => x.status === 401).map((x) => x.obj) });
    ok("B07 reactivar y guardar: guardada exactamente una vez", version(cot.id) === v1 + 1 && revision(cot.id).observaciones === "justo al reactivar el equipo");
    ok("B07b el vencimiento se calcula con la hora del servidor (el reloj del equipo quedó 4 horas adelantado)", Math.abs((await est(p)).desfase_s + 4 * 3600) < 120 && (await est(p)).vence_en_s > 3000, await est(p));
    ok("B08 sin errores de página", !S.errs.length, S.errs.join(" | "));
    await S.ctx.close();
  }

  // ═══ C. Varias pestañas: una sola renovación, sesión compartida, cierre de sesión y pestaña desactualizada ═════════════════
  if (corre("C")) {
    const A = crearAuth(); const cot = nuevaCot(); const S = await iniciar(browser, A);
    const T2 = await iniciar(browser, A, { ctx: S.ctx }); const T3 = await iniciar(browser, A, { ctx: S.ctx });
    const tabs = [S.p, T2.p, T3.p];
    ok("C00 tres pestañas con la misma sesión guardada", new Set(await Promise.all(tabs.map(tokenGuardado))).size === 1 && A.renovaciones() === 0);
    // C1. Las tres deben renovar al mismo tiempo: se renueva UNA vez y las demás adoptan.
    let n0 = A.llamadas.length; await ponerSesion(S.aux, queVenceEn(A, U.ana, 200));
    await Promise.all(tabs.map((t) => t.evaluate(() => { window.dispatchEvent(new Event("focus")); })));
    await espera(S.p, 2500);
    let ll = A.llamadas.slice(n0).filter((x) => x.tipo === "renovar"); let es = await Promise.all(tabs.map(est));
    ok("C01 renovación simultánea en 3 pestañas: UNA sola renovación, ninguna con un refresh token ya usado", ll.length === 1 && ll[0].resultado === "ok", ll);
    ok("C02 las tres pestañas quedan con la misma sesión vigente", new Set(await Promise.all(tabs.map(tokenGuardado))).size === 1 && es.every((e) => e.estado === "vigente" && e.vence_en_s > 3000), es);
    // C2. Las tres reciben «JWT expired» a la vez: una sola renovación y todas reintentan con el token nuevo.
    await espera(S.p, 1500); A.vencerAhora(); n0 = A.llamadas.length;
    const res = await Promise.all(tabs.map((t) => t.evaluate(async (k) => { const s = JSON.parse(localStorage.getItem(k));
      const r = await fetch("https://gypywxaugwuxbgmcqntp.supabase.co/rest/v1/vp_cotizaciones?select=id&limit=1", { headers: { apikey: "x", Authorization: `Bearer ${s.access_token}` } }); return r.status; }, LLAVE)));
    ll = A.llamadas.slice(n0).filter((x) => x.tipo === "renovar");
    ok("C03 rechazo simultáneo en 3 pestañas: una sola renovación y las tres solicitudes terminan aceptadas", ll.length === 1 && ll[0].resultado === "ok" && res.every((x) => x === 200), { ll, res });
    ok("C04 ningún intento con refresh token ya usado en todo el recorrido", A.renovaciones("reuso") === 0);

    // C3. Pestaña desactualizada: no sobrescribe; recupera lo escrito y resuelve campo por campo.
    const [p1, p2] = [S.p, T2.p];
    await abrirCot(p1, cot.folio); await abrirCot(p2, cot.folio);
    await campo(p1, "plazo").fill("20 días (pestaña 1)"); await campo(p1, "pago").fill("Contado (pestaña 1)"); await guardar(p1);
    const v1 = version(cot.id);
    await campo(p2, "plazo").fill("5 días (pestaña 2)"); await campo(p2, "observaciones").fill("nota de la pestaña 2"); await espera(p2, 700);
    const iC = A.pedidos.length; await guardar(p2);
    const dlg = p2.locator("[data-conflicto-version]");
    ok("C05 pestaña desactualizada: se detecta antes de enviar (nada llega a guardarse) y NO se sobrescribe lo guardado después", desde(A, iC, "rpc/vp_guardar_cotizacion").length === 0 && version(cot.id) === v1 && revision(cot.id).plazo_entrega === "20 días (pestaña 1)" && revision(cot.id).observaciones === "inicial");
    const estados = await dlg.locator("[data-campo-conflicto]").evaluateAll((l) => Object.fromEntries(l.map((x) => [x.dataset.campoConflicto, x.dataset.estadoConflicto]))).catch(() => ({}));
    ok("C06 se abre la comparación: plazo cambió en ambos; observaciones solo en esta; condiciones de pago solo en BFK", estados.plazo_entrega === "conflicto" && estados.observaciones === "solo_mio" && estados.condiciones_pago === "solo_bfk" && Object.keys(estados).length === 3, JSON.stringify(estados) + " · " + ((await cuerpo(p2)).match(/.{0,80}(No se guard|No se pudo)[^\n]{0,300}/) || ["sin aviso"])[0] + " · " + T2.errs.join("|"));
    ok("C07 lo escrito sigue en la pantalla y en la copia local", (await campo(p2, "plazo").inputValue()) === "5 días (pestaña 2)" && (await borradores(p2)).some((b) => b.cotId === cot.id && b.obs === "nota de la pestaña 2"), await borradores(p2));
    await dlg.locator("[data-combinar-conflicto]").click(); await espera(p2, 500);
    ok("C08 combinar (sin elegir): toma lo de BFK en el conflicto, conserva lo propio; queda sin guardar", (await campo(p2, "plazo").inputValue()) === "20 días (pestaña 1)" && (await campo(p2, "observaciones").inputValue()) === "nota de la pestaña 2"
      && (await campo(p2, "pago").inputValue()) === "Contado (pestaña 1)" && version(cot.id) === v1 && (await ui.hoja(p2).locator('[data-estado-guardado="local"]').count()) === 1);
    await guardar(p2);
    const rv = revision(cot.id);
    ok("C09 guardar tras combinar: una versión nueva con lo de ambas pestañas", version(cot.id) === v1 + 1 && rv.plazo_entrega === "20 días (pestaña 1)" && rv.condiciones_pago === "Contado (pestaña 1)" && rv.observaciones === "nota de la pestaña 2", rv);
    // Copia local escrita sobre una versión anterior (la pestaña se cerró sin guardar): al reabrir se ofrece combinar.
    await ui.hoja(p1).locator("[data-cerrar-hoja]").first().click(); await espera(p1, 400); await abrirCot(p1, cot.folio);
    await campo(p1, "plazo").fill("30 días (copia local)"); await espera(p1, 900);
    await campo(p2, "observaciones").fill("guardado después por la pestaña 2"); await guardar(p2);
    const v2 = version(cot.id);
    await p1.reload({ waitUntil: "load" }); await espera(p1, 3500); await abrirCot(p1, cot.folio);
    const av = ui.hoja(p1).locator('[data-aviso-linea="borrador-desactualizado"]');
    ok("C10 copia local de una versión anterior: no se borra; se ofrece «Revisar y combinar»", (await av.count()) === 1 && /Revisar y combinar/.test(await av.innerText()) && /no se sobrescribirá/.test(await av.innerText()), await ui.hoja(p1).innerText().then((t) => t.slice(0, 300)));
    await av.click({ position: { x: 14, y: 14 } }); const dlg1 = p1.locator("[data-conflicto-version]"); await dlg1.waitFor();
    const est1 = await dlg1.locator("[data-campo-conflicto]").evaluateAll((l) => Object.fromEntries(l.map((x) => [x.dataset.campoConflicto, x.dataset.estadoConflicto])));
    ok("C11 comparación de la copia local: plazo solo propio; observaciones solo de BFK", est1.plazo_entrega === "solo_mio" && est1.observaciones === "solo_bfk", est1);
    await dlg1.locator("[data-combinar-conflicto]").click(); await espera(p1, 400); await guardar(p1);
    const rv2 = revision(cot.id);
    ok("C12 se guarda sobre la versión vigente, sin perder lo de la otra pestaña", version(cot.id) === v2 + 1 && rv2.plazo_entrega === "30 días (copia local)" && rv2.observaciones === "guardado después por la pestaña 2", rv2);

    // La versión cambia justo entre la comprobación y el envío: la base rechaza (VP409) y la API puede no responder → la app deja
    // de esperar, comprueba, y abre la misma comparación (nada se sobrescribe).
    await campo(p2, "plazo").fill("45 días (pestaña 2, carrera)"); await espera(p2, 600);
    await campo(p1, "pago").fill("30 días (pestaña 1, carrera)"); await espera(p1, 300);
    const vC = version(cot.id);
    psql(`${comoUsuario(U.ana)}select public.vp_guardar_cotizacion((select jsonb_build_object('id', c.id, 'version', c.version, 'cliente_id', c.cliente_id, 'plazo_entrega', 'cambiado por otra persona', 'items', (select jsonb_agg(to_jsonb(i) - 'id' - 'revision_id' order by i.orden) from public.vp_cotizacion_items i where i.revision_id = r.id)) from public.vp_cotizaciones c join public.vp_cotizacion_revisiones r on r.cotizacion_id = c.id and r.numero = c.revision_actual where c.id = '${cot.id}'));`);
    A.cortes.push({ patron: /^GET .*\/vp_cotizaciones$/, modo: "antes", veces: 1 });   // la comprobación previa no alcanza a ver el cambio
    const iR = A.pedidos.length; await ui.hoja(p2).locator("[data-guardar-cotizacion]").click();
    await p2.locator("[data-conflicto-version]").waitFor({ timeout: 70000 }).catch(() => {});
    ok("C12b carrera: la base rechaza la versión antigua; la app deja de esperar, comprueba y abre la comparación", await p2.locator("[data-conflicto-version]").isVisible() && version(cot.id) === vC + 1 && revision(cot.id).plazo_entrega === "cambiado por otra persona"
      && (await campo(p2, "plazo").inputValue()) === "45 días (pestaña 2, carrera)", { v: version(cot.id), vC, n: desde(A, iR, "rpc/vp_guardar_cotizacion").length });
    await p2.locator("[data-cancelar-conflicto]").click().catch(() => {}); await espera(p2, 300);

    // C4. Cierre de sesión en otra pestaña: las demás vuelven al ingreso con un aviso (no siguen con un token ajeno).
    await ponerSesion(S.aux, null); await espera(p2, 800);
    ok("C13 cierre de sesión en otra pestaña: esta vuelve al ingreso y lo explica", (await p2.locator('input[type="password"]').count()) === 1 && /otra pestaña/i.test(await cuerpo(p2)), (await cuerpo(p2)).slice(0, 200));
    ok("C14 sin errores de página", ![...S.errs, ...T2.errs, ...T3.errs].length, [...S.errs, ...T2.errs, ...T3.errs].join(" | "));
    await S.ctx.close();
  }

  // ═══ D. Pérdida de conexión: antes de enviar y con respuesta incierta (guardar, crear, EETT, venta) ════════════════════════
  if (corre("D")) {
    const A = crearAuth(); const cot = nuevaCot(); const S = await iniciar(browser, A); const p = S.p;
    await abrirCot(p, cot.folio);
    // D1. Sin conexión al guardar: nada se guarda, lo escrito queda; al volver la conexión se guarda una vez.
    await campo(p, "observaciones").fill("escrito sin conexión"); await espera(p, 700);
    let v0 = version(cot.id); let i0 = A.pedidos.length;
    await conexion(S, A, false); let visto = await guardarViendo(p, /No se guardó/);
    ok("D01 sin conexión: no se guardó, se informa y lo escrito sigue en pantalla y en la copia local", version(cot.id) === v0 && visto && (await campo(p, "observaciones").inputValue()) === "escrito sin conexión"
      && (await borradores(p)).some((b) => b.cotId === cot.id && b.obs === "escrito sin conexión") && desde(A, i0, "rpc/vp_guardar_cotizacion").length === 0, (await cuerpo(p)).slice(-300));
    await conexion(S, A, true); await espera(p, 1500); await guardar(p);
    ok("D02 al volver la conexión: guardada exactamente una vez", version(cot.id) === v0 + 1 && revision(cot.id).observaciones === "escrito sin conexión" && desde(A, i0, "rpc/vp_guardar_cotizacion", 200).length === 1);
    // D2. Respuesta incierta: el servidor guardó, pero la respuesta no llegó → se comprueba; no se repite.
    await campo(p, "observaciones").fill("respuesta perdida"); v0 = version(cot.id); i0 = A.pedidos.length;
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_guardar_cotizacion$/, modo: "despues", veces: 1 }); visto = await guardarViendo(p, /Cotización guardada\n|Cotización guardada$/);
    ok("D03 respuesta incierta al guardar: la app comprobó que SÍ quedó guardada y no la repitió", version(cot.id) === v0 + 1 && desde(A, i0, "rpc/vp_guardar_cotizacion").length === 1 && visto
      && (await ui.hoja(p).locator('[data-estado-guardado="local"]').count()) === 0, (await cuerpo(p)).slice(-300));
    // D3. La solicitud no alcanzó a salir: se comprueba que NO quedó guardada; reintentar guarda una vez.
    await campo(p, "observaciones").fill("no alcanzó a salir"); v0 = version(cot.id); i0 = A.pedidos.length;
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_guardar_cotizacion$/, modo: "antes", veces: 1 }); visto = await guardarViendo(p, /NO quedó guardada/);
    ok("D04 corte antes de enviar: se comprobó que NO quedó guardada y se informa", version(cot.id) === v0 && visto && (await campo(p, "observaciones").inputValue()) === "no alcanzó a salir", (await cuerpo(p)).slice(-300));
    await guardar(p);
    ok("D05 reintento: guardada exactamente una vez", version(cot.id) === v0 + 1 && desde(A, i0, "rpc/vp_guardar_cotizacion", 200).length === 1);
    // D4. Respuesta incierta y tampoco se puede comprobar: el siguiente intento comprueba primero (no duplica).
    await campo(p, "observaciones").fill("incierta y sin poder comprobar"); v0 = version(cot.id); i0 = A.pedidos.length;
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_guardar_cotizacion$/, modo: "despues", veces: 1 }, { patron: /^GET .*\/vp_cotizaciones$/, modo: "antes", veces: 2 }); visto = await guardarViendo(p, /comprobará primero/);
    ok("D06 incierta sin poder comprobar: lo dice y no asegura nada", version(cot.id) === v0 + 1 && visto && (await ui.hoja(p).locator('[data-estado-guardado="local"]').count()) === 1, (await cuerpo(p)).slice(-300));
    await guardar(p);
    ok("D07 siguiente intento: comprobó primero; NO volvió a guardar (una sola ejecución, una versión)", version(cot.id) === v0 + 1 && desde(A, i0, "rpc/vp_guardar_cotizacion").length === 1 && (await ui.hoja(p).locator('[data-estado-guardado="local"]').count()) === 0, desde(A, i0, "rpc/vp_guardar_cotizacion"));
    ok("D08 cada guardado dejó una sola versión en el historial de la revisión", nRev(cot.id) === 1);

    // D5. EETT con respuestas inciertas: al reintentar se usa el mismo borrador y la misma emisión.
    await ui.pestana(p, "eett"); await espera(p, 500); i0 = A.pedidos.length;
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_guardar_eett$/, modo: "despues", veces: 1 });
    await ui.hoja(p).locator("[data-generar-eett]").click(); visto = await ve(p, /[Nn]o se generó la EETT/); await espera(p, 2500);
    ok("D09 EETT, respuesta incierta al preparar: se informa; quedó UN borrador y nada emitido", nEETT(cot.id) === 1 && nEETT(cot.id, "emitida") === 0 && visto, (await cuerpo(p)).slice(-300));
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_emitir_eett$/, modo: "despues", veces: 1 });
    await ui.hoja(p).locator("[data-generar-eett]").click(); visto = await ve(p, /no se emite dos veces/); await espera(p, 2500);
    ok("D10 EETT, respuesta incierta al emitir: el servidor la emitió una vez (mismo borrador)", nEETT(cot.id) === 1 && nEETT(cot.id, "emitida") === 1 && visto, (await cuerpo(p)).slice(-300));
    const nom = await descarga(p, () => ui.hoja(p).locator("[data-generar-eett]").click()); await espera(p, 1200);
    ok("D11 EETT, reintento: comprueba, encuentra la emisión y la descarga; NO emite otra", /_Rev0\.pdf$/.test(nom) && nEETT(cot.id) === 1 && desde(A, i0, "rpc/vp_emitir_eett").length === 1 && q1(`select max(revision) from public.vp_eett where cotizacion_id = '${cot.id}';`) === "0", nom);

    // D6. Crear la venta con respuesta incierta: el reintento no crea otra.
    psql(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cot.id}', 'enviada', '{}'::jsonb, ${version(cot.id)});`);
    psql(`${comoUsuario(U.ana)}select public.vp_cotizacion_estado('${cot.id}', 'aceptada', '{}'::jsonb, ${version(cot.id)});`);
    await ui.hoja(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 500); await abrirCot(p, cot.folio);
    await ui.hoja(p).locator('[data-accion-cot="crear-venta"]').click(); const cv = p.locator('[data-ventana="crear-venta"]'); await cv.waitFor(); i0 = A.pedidos.length; const nV0 = Number(q1(`select count(*) from public.vp_ventas;`));
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_crear_venta_desde_cotizacion$/, modo: "despues", veces: 1 });
    await cv.locator("[data-confirmar-venta]").click(); await espera(p, 2500);
    ok("D12 venta, respuesta incierta: el servidor la creó; la ventana sigue abierta con el error", nVentas(cot.id) === 1 && await cv.isVisible());
    await cv.locator("[data-confirmar-venta]").click(); await p.locator('[data-hoja-lateral="ficha-venta"]').waitFor({ timeout: 15000 }); await espera(p, 600);
    ok("D13 venta, reintento con la misma clave: NO se crea otra (la base devuelve la que ya existía)", nVentas(cot.id) === 1 && desde(A, i0, "rpc/vp_crear_venta_desde_cotizacion", 200).length === 2 && Number(q1(`select count(*) from public.vp_ventas;`)) === nV0 + 1, { n: nVentas(cot.id), ped: desde(A, i0, "rpc/vp_crear_venta_desde_cotizacion").map((x) => x.status) });
    await p.locator('[data-hoja-lateral="ficha-venta"] [data-cerrar-hoja]').first().click().catch(() => {}); await espera(p, 500);

    // D7. Crear una cotización NUEVA con respuesta incierta: no se duplica.
    await irACotizaciones(p); const n0 = nCots();
    await p.locator("[data-nueva-cotizacion]").click(); await ui.hoja(p).waitFor(); await espera(p, 600);
    await ui.elegirCliente(p, "Maderas", "76.086.428-5"); await ui.pestana(p, "productos");
    await ui.ingresarManual(p, { tipo: "servicio", nombre: "Instalación (prueba de sesión)", generales: "Alcance: instalación en planta", cantidad: 1, unidad: "GL", precio: 80000, incluyeIva: false, biblioteca: false });
    await ui.pestana(p, "precios"); await ui.fijarPrecio(p, 1, 120000); i0 = A.pedidos.length;
    A.cortes.push({ patron: /^POST .*\/rpc\/vp_guardar_cotizacion$/, modo: "despues", veces: 1 }); visto = await guardarViendo(p, /Cotización CP-\d{4}-\d{4} creada/);
    ok("D14 cotización nueva, respuesta incierta: se comprobó que quedó creada; UNA sola cotización nueva", nCots() === n0 + 1 && desde(A, i0, "rpc/vp_guardar_cotizacion").length === 1 && visto, { n: nCots() - n0, t: (await cuerpo(p)).slice(-200) });
    await guardar(p);
    ok("D15 volver a presionar Guardar no crea otra", nCots() === n0 + 1);
    ok("D16 sin errores de página", !S.errs.length, S.errs.join(" | "));
    await S.ctx.close();
  }

  // ═══ E. Fallo de renovación: aviso claro, cambios conservados, reingreso con la misma cuenta ═══════════════════════════════
  if (corre("E")) {
    const A = crearAuth(); const cot = nuevaCot(); const S = await iniciar(browser, A); const p = S.p;
    await abrirCot(p, cot.folio);
    // E1. Falla de CONEXIÓN al renovar: no es una sesión vencida (no se pide reingresar); se recupera sola.
    A.fallar = "red"; let r0 = A.renovaciones(); await ponerSesion(S.aux, queVenceEn(A, U.ana, 200)); await p.evaluate(() => window.dispatchEvent(new Event("focus"))); await espera(p, 1500);
    ok("E01 renovación sin conexión: no se da por vencida ni se pide reingresar", (await est(p)).estado === "vigente" && !(await p.locator("[data-aviso-sesion]").count()) && A.renovaciones("red") >= 1);
    A.fallar = null; await p.evaluate(() => window.dispatchEvent(new Event("online"))); await espera(p, 1500);
    ok("E02 al volver la conexión renueva sola", A.renovaciones() === r0 + 1 && (await est(p)).vence_en_s > 3000);
    // E2. El servidor RECHAZA la renovación y el token vence: aviso para volver a ingresar; nada se pierde.
    await campo(p, "observaciones").fill("escrito antes de vencer la sesión"); await campo(p, "plazo").fill("7 días (pendiente)"); await espera(p, 800);
    const v0 = version(cot.id); let i0 = A.pedidos.length; A.fallar = "rechazo";
    await ponerSesion(S.aux, queVenceEn(A, U.ana, 5)); await p.evaluate(() => window.dispatchEvent(new Event("focus")));
    const vent = p.locator('[data-aviso-sesion="ventana"]'); await vent.waitFor({ timeout: 20000 }).catch(() => {});
    ok("E03 renovación rechazada y token vencido: aviso claro para volver a ingresar", await vent.isVisible() && /sesión venció/i.test(await vent.innerText()) && (await est(p)).estado === "vencida", await est(p));
    ok("E04 el editor sigue abierto con lo escrito, y la copia local existe para esta cuenta", (await campo(p, "observaciones").inputValue()) === "escrito antes de vencer la sesión"
      && (await borradores(p)).some((b) => b.usuario === `vp:${U.ana}` && b.cotId === cot.id && b.obs === "escrito antes de vencer la sesión"), await borradores(p));
    const ren = A.llamadas.filter((x) => x.tipo === "renovar").length; await espera(p, 3000);
    ok("E05 nada se guardó y la app no insiste contra el servidor con la sesión rechazada", version(cot.id) === v0 && desde(A, i0, "rpc/vp_guardar_cotizacion").length === 0 && A.llamadas.filter((x) => x.tipo === "renovar").length === ren);
    A.fallar = null;
    await vent.locator("[data-clave-reingreso]").fill("clave-equivocada"); await vent.locator("[data-confirmar-reingreso]").click(); await espera(p, 900);
    ok("E06 contraseña incorrecta: lo dice y sigue pidiendo ingresar (sin perder la pantalla)", await vent.isVisible() && (await campo(p, "observaciones").inputValue()) === "escrito antes de vencer la sesión");
    await vent.locator("[data-clave-reingreso]").fill("clave-correcta"); await vent.locator("[data-confirmar-reingreso]").click(); await espera(p, 1500);
    ok("E07 reingreso con la misma cuenta: el aviso se cierra y la sesión queda vigente", !(await p.locator("[data-aviso-sesion]").count()) && (await est(p)).estado === "vigente" && (await est(p)).vence_en_s > 3000, await est(p));
    i0 = A.pedidos.length; await guardar(p);
    const rv = revision(cot.id);
    ok("E08 guardar tras reingresar: lo escrito se guarda exactamente una vez", version(cot.id) === v0 + 1 && rv.observaciones === "escrito antes de vencer la sesión" && rv.plazo_entrega === "7 días (pendiente)" && desde(A, i0, "rpc/vp_guardar_cotizacion", 200).length === 1, rv);
    // E3. Rechazo mientras el token aún sirve para el navegador (el servidor lo da por vencido): franja con el aviso.
    await campo(p, "observaciones").fill("segunda sesión rechazada"); await espera(p, 800); A.fallar = "rechazo";
    A.vencerAhora(); const v1 = version(cot.id); await guardar(p, 3000);
    const franja = p.locator('[data-aviso-sesion="franja"]');
    ok("E09 «JWT expired» y renovación rechazada: no se guarda, se avisa y lo escrito queda", version(cot.id) === v1 && await franja.isVisible() && (await campo(p, "observaciones").inputValue()) === "segunda sesión rechazada", (await cuerpo(p)).slice(-250));
    // E4. Se recarga con la sesión vencida: vuelve al ingreso con el aviso; tras ingresar se ofrece recuperar lo escrito.
    await ponerSesion(S.aux, queVenceEn(A, U.ana, 3)); await espera(p, 4500);   // el token termina de vencer y la renovación sigue rechazada
    await p.reload({ waitUntil: "load" }); await espera(p, 3000);
    ok("E10 recarga con la sesión rechazada: pantalla de ingreso con el aviso", (await p.locator('input[type="password"]').count()) === 1 && !(await ui.hoja(p).count()) && /sesi[oó]n/i.test(await cuerpo(p)), (await cuerpo(p)).slice(0, 250));
    A.fallar = null;
    await p.locator('input[type="email"]').fill(A.usuario(U.ana).email); await p.locator('input[type="password"]').fill("clave-correcta"); await p.getByRole("button", { name: "Ingresar", exact: true }).click(); await espera(p, 2500);
    ok("E11 tras ingresar con la misma cuenta se avisa que hay cambios por recuperar", /sin guardar|recuperar/i.test(await cuerpo(p)), (await cuerpo(p)).slice(-250));
    await abrirCot(p, cot.folio);
    const rec = ui.hoja(p).locator('[data-aviso-linea="borrador-recuperado"]');
    ok("E12 la cotización ofrece «Recuperar cambios»", (await rec.count()) === 1);
    await rec.click({ position: { x: 14, y: 14 } }); await espera(p, 500);
    ok("E13 lo escrito vuelve al editor", (await campo(p, "observaciones").inputValue()) === "segunda sesión rechazada");
    await guardar(p);
    ok("E14 y se guarda exactamente una vez", version(cot.id) === v1 + 1 && revision(cot.id).observaciones === "segunda sesión rechazada");
    // E5. Otra cuenta en el mismo equipo no ve esas copias.
    ok("E15 las copias locales son solo de la cuenta que las escribió", (await borradores(p)).every((b) => b.usuario === `vp:${U.ana}`));
    ok("E16 sin errores de página", !S.errs.length, S.errs.join(" | "));
    await S.ctx.close();
  }
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_sesion_vp: ${nOk} OK, ${F.length} fallas${F.length ? " · " + F.join(" | ") : ""}`);
process.exit(F.length ? 1 : 0);
