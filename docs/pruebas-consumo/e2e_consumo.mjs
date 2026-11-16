// Consumo de Supabase, fase 1 (15/11/2026) — medición ANTES/DESPUÉS y equivalencia de datos.
// Corre los mismos escenarios contra dos versiones de la app (la publicada 8ea74b0 y la optimizada), con Supabase SIMULADO
// con estado y datos del volumen de producción (datos_produccion.mjs). Mide solicitudes, bytes (sin comprimir y gzip) y
// duración de cada escenario; compara las pantallas financieras entre versiones y, en la optimizada, que el estado tras
// cada recarga parcial sea idéntico al de una carga completa. Nada sale a la red.
// Uso: node docs/pruebas-consumo/e2e_consumo.mjs http://127.0.0.1:4401/ http://127.0.0.1:4402/   [SALIDA=archivo.json]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { chromium, CHROME, crearBase } from "../pruebas-oc/mock_estado.mjs";
import { RESPUESTAS_MP } from "../pruebas-oc/datos_oc.mjs";
import { irSeccionFicha } from "../pruebas-oc/indice_ficha.mjs";
import { datosProduccion } from "./datos_produccion.mjs";
// Clave de institución como lib/contactosInstitucionales.js (RUT válido: dígitos + verificador, sin ceros a la izquierda).
const claveInstitucion = (rut) => String(rut || "").replace(/[^0-9kK]/g, "").toUpperCase().replace(/^0+(?=.)/, "");

const VERSIONES = { antes: process.argv[2] || "http://127.0.0.1:4401/", despues: process.argv[3] || "http://127.0.0.1:4402/" };
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
let nOk = 0; const F = [];
const ok = (k, v, det) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (det !== undefined ? " :: " + JSON.stringify(det).slice(0, 600) : "")); } };
const espera = (p, ms) => p.waitForTimeout(ms);

// ── Supabase simulado: la base con estado de las pruebas + los operadores de PostgREST que usa la versión optimizada ──
function partir(s) { const r = []; let n = 0, a = ""; for (const ch of s) { if (ch === "(") n++; if (ch === ")") n--; if (ch === "," && n === 0) { r.push(a); a = ""; } else a += ch; } if (a) r.push(a); return r; }
const likeRe = (pat) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/_/g, ".") + "$", "s");
function cumple(f, campo, expr) {
  const v = f[campo]; const s = v === null || v === undefined ? null : String(v);
  const [op, ...resto] = expr.split("."); const x = decodeURIComponent(resto.join("."));
  if (op === "not") return !cumple(f, campo, resto.join("."));
  if (op === "is") return x === "null" ? s === null : true;
  if (s === null) return false;
  if (op === "eq") return s === x; if (op === "gt") return s > x; if (op === "gte") return s >= x; if (op === "lt") return s < x; if (op === "lte") return s <= x;
  if (op === "like") return likeRe(x).test(s);
  if (op === "in") return x.slice(1, -1).split(",").map((y) => decodeURIComponent(y.replace(/^"|"$/g, ""))).includes(s);
  return true;
}
function crearBaseMedida(datos) {
  const b = crearBase(datos, { mp: RESPUESTAS_MP });
  const leer = b.leer;
  b.leer = (tabla, params) => {
    let filas = leer(tabla, params);
    for (const [k, v] of params) {
      if (["select", "order", "limit", "offset"].includes(k)) continue;
      if (k === "or") { const c = partir(v.slice(1, -1)); filas = filas.filter((f) => c.some((x) => { const [campo, ...r] = x.split("."); return cumple(f, campo, r.join(".")); })); continue; }
      if (/^(gt|gte|lt|lte|not)\./.test(v)) filas = filas.filter((f) => cumple(f, k, v));
    }
    const orden = params.get("order");
    if (orden) { const ks = orden.split(",").map((x) => x.split(".")); filas = filas.slice().sort((a, c) => { for (const [k, dir] of ks) { const x = String(a[k] ?? ""), y = String(c[k] ?? ""); if (x !== y) return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1); } return 0; }); }
    if (params.get("limit")) filas = filas.slice(0, Number(params.get("limit")));
    const sel = params.get("select") || "*";
    const embebidas = {}; for (const m of sel.matchAll(/([a-z_]+)\(([^)]*)\)/g)) embebidas[m[1]] = m[2];
    const propias = partir(sel).filter((x) => !x.includes("(")).map((x) => x.trim());
    filas = filas.map((f) => {
      let g = propias.includes("*") ? f : Object.fromEntries(propias.filter((c) => c in f).map((c) => [c, f[c]]));
      for (const [t, cols] of Object.entries(embebidas)) if (Array.isArray(f[t]) && cols !== "*") { const cs = cols.split(","); g = { ...g, [t]: f[t].map((h) => Object.fromEntries(cs.filter((c) => c in h).map((c) => [c, h[c]]))) }; }
      return g;
    });
    return filas;
  };
  const rpc = b.rpc;
  b.rpc = (fn, cuerpo, yo) => {
    if (fn === "asignar_vendedor_oc") { const o = b.db.ordenes_compra_v2.find((x) => x.id === cuerpo.p_oc_id); const antes = o.vendedor_id; o.vendedor_id = cuerpo.p_vendedor_id; return { status: 200, json: { antes, despues: (b.db.vendedores.find((v) => v.id === cuerpo.p_vendedor_id) || {}).nombre || "Sin definir", sin_cambios: antes === cuerpo.p_vendedor_id } }; }
    return rpc(fn, cuerpo, yo);
  };
  return b;
}

// ── Navegador con contador: cada solicitud a Supabase se anota en la fase vigente (bytes de la respuesta) ──
async function abrirApp(url, b, { usuario = "u1", escritorio = true } = {}) {
  const ctx = await browser.newContext(escritorio ? { viewport: { width: 1440, height: 900 }, timezoneId: "America/Santiago" } : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Santiago" });
  const p = await ctx.newPage(); const R = { fase: "apertura", log: [], errs: [] }; let nTok = 0;
  p.on("pageerror", (e) => R.errs.push(e.message)); p.on("dialog", (d) => d.accept());
  const responder = (route, status, json) => {
    const s = JSON.stringify(json ?? null); const u = new URL(route.request().url());
    R.log.push({ fase: R.fase, metodo: route.request().method(), ruta: u.pathname.replace(/^.*\/(rest|auth)\/v1\//, ""), consulta: decodeURIComponent(u.search).slice(0, 160), parcial: /[?&](id|oc_id)=in\./.test(decodeURIComponent(u.search)), bytes: Buffer.byteLength(s), gz: zlib.gzipSync(s).length, t: Date.now() });
    return route.fulfill({ status, contentType: "application/json", body: s });
  };
  await p.clock.install({ time: new Date() });
  await p.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname === "127.0.0.1" && u.pathname.startsWith("/api/oc")) { const r = b.respuestaMP(u); R.log.push({ fase: R.fase, metodo: "GET", ruta: "api/oc", consulta: u.search, bytes: 0, gz: 0, t: Date.now() }); return route.fulfill({ status: r.status, json: r.body }); }
    if (u.hostname === "127.0.0.1") return route.continue();
    if (!u.hostname.endsWith("supabase.co")) return route.abort();
    if (u.pathname.includes("/auth/v1/token")) return responder(route, 200, { access_token: `t${usuario}.${++nTok}`, refresh_token: "r" + nTok, expires_in: 3600, token_type: "bearer", user: { id: usuario, email: usuario + "@prueba.cl" } });
    if (u.pathname.includes("/auth/v1/user")) return responder(route, 200, { id: usuario });
    if (u.pathname.includes("/auth/v1/logout")) return responder(route, 200, {});
    let c = null; try { c = JSON.parse(req.postData() || "null"); } catch {}
    if (u.pathname.includes("/rest/v1/rpc/")) { const r = b.rpc(u.pathname.split("/").pop(), c || {}, usuario); return responder(route, r.status, r.json); }
    const tabla = u.pathname.split("/").pop();
    if (m === "GET") return responder(route, 200, b.leer(tabla, u.searchParams));
    const r = b.escribir(m, tabla, u.searchParams, c, usuario); return responder(route, r.status, r.json);
  });
  await p.addInitScript((id) => { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify({ access_token: "t" + id + ".0", refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: id + "@prueba.cl" } }));
    let v = "visible"; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v }); Object.defineProperty(document, "hidden", { configurable: true, get: () => v !== "visible" });
    window.__vis = (x) => { v = x; document.dispatchEvent(new Event("visibilitychange")); }; }, usuario);
  await p.goto(url); await quieto(p, R);
  return { p, ctx, R };
}
// Espera a que no haya solicitudes a Supabase durante 1,2 s (máx. 25 s).
async function quieto(p, R, max = 25000) { const t0 = Date.now(); let n = -1; while (Date.now() - t0 < max) { await p.waitForTimeout(1200); if (R.log.length === n) return; n = R.log.length; } }
const resumen = (R, fase) => { const l = R.log.filter((x) => x.fase === fase); return { solicitudes: l.length, bytes: l.reduce((a, x) => a + x.bytes, 0), gz: l.reduce((a, x) => a + x.gz, 0), ms: l.length ? l[l.length - 1].t - l[0].t : 0, cargasCompletas: l.filter((x) => x.ruta === "ordenes_compra_v2" && x.metodo === "GET" && !x.parcial).length,
  // tiempo de la recarga tras guardar: desde la respuesta de la escritura hasta la última lectura
  msRecarga: (() => { const w = l.findIndex((x) => x.metodo !== "GET" && !/token|gestionar_bloqueo_oc/.test(x.ruta)); const g = l.filter((x, i) => i > w && x.metodo === "GET"); return w >= 0 && g.length ? g[g.length - 1].t - l[w].t : null; })() }; };
const textoFinanzas = async (p) => {
  const T = {};
  for (const k of ["vendedores", "impuestos", "financiamiento", "banco", "gastos"]) {
    if (!(await p.locator(`[data-tab="${k}"]`).count())) { await p.locator('aside [data-nav="finanzas"]').click(); await espera(p, 500); }
    if (!(await p.locator(`[data-tab="${k}"]`).count())) continue;
    await p.locator(`[data-tab="${k}"]`).first().click(); await espera(p, 900);
    T[k] = (await p.evaluate(() => (document.querySelector("main") || document.body).innerText)).replace(/\d{1,2}:\d{2}(:\d{2})?/g, "hh:mm");
  }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 700);
  return T;
};
async function abrirOC(p, numero) {
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1300);
}
async function etapa(p, numero, key) {
  await abrirOC(p, numero); const fila = p.locator(`[data-oc="${numero}"]`);
  const SECCION = { financ: "Compra y financiamiento", factura: "Facturación SII", cobro: "Cobranza" };
  await irSeccionFicha(fila, SECCION[key]); await espera(p, 400);
  return fila.locator(key === "factura" ? "[data-facturacion-sii]" : `[data-etapa-seccion="${key}"]`);
}
const enModal = (p) => p.locator("[role=dialog]").last();
// Estado comparable (versión optimizada): listas ordenadas por id; los contactos (a pedido) aparte.
const normal = (d) => { const o = {}; for (const [k, v] of Object.entries(d || {})) { if (["contactosInst", "vinculosInst"].includes(k)) continue; o[k] = Array.isArray(v) ? v.slice().sort((a, c) => String(a.id).localeCompare(String(c.id))) : v; } return JSON.stringify(o); };
const difEstado = (a, c) => { const A = JSON.parse(a), B = JSON.parse(c); return Object.keys({ ...A, ...B }).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])); };

const MED = {}; const FIN = {};
for (const [ver, url] of Object.entries(VERSIONES)) {
  console.log(`\n=== Versión ${ver} (${url}) ===`);
  const b = crearBaseMedida(datosProduccion());
  const { p, ctx, R } = await abrirApp(url, b);
  const opt = ver === "despues";
  const estado = () => p.evaluate(() => window.__bfkDatos ? window.__bfkDatos() : null);
  const fase = async (nombre, fn, esperaMs) => { R.fase = nombre; await fn(); await quieto(p, R); if (esperaMs) await espera(p, esperaMs); };
  const equivalente = async (nombre) => {
    if (!opt) return;
    const parcial = normal(await estado());
    const antesN = R.log.length; R.fase = "_verificacion";
    await p.locator('aside [data-nav="actualizar"]').click(); await quieto(p, R);
    const completo = normal(await estado());
    ok(`[${ver}] ${nombre}: estado tras la recarga parcial = estado tras una carga completa`, parcial === completo, difEstado(parcial, completo));
    ok(`[${ver}] ${nombre}: «Actualizar datos» hace una carga completa`, R.log.slice(antesN).some((x) => x.ruta === "ordenes_compra_v2" && !x.parcial));
  };
  await fase("renovacion_x3", async () => { for (let i = 0; i < 3; i++) { await p.evaluate(() => window.__bfkSesion.renovarAhora()); await espera(p, 1500); } });
  await fase("pestana_x10", async () => { for (let i = 0; i < 10; i++) { await p.evaluate(() => window.__vis("hidden")); await espera(p, 150); await p.evaluate(() => window.__vis("visible")); await espera(p, 400); } });
  await fase("pestana_tras_16min", async () => { await p.evaluate(() => window.__vis("hidden")); await p.clock.fastForward("16:00"); await p.evaluate(() => window.__vis("visible")); });
  // Correos: llega uno nuevo a la base; a los 5 minutos la app (visible) lo consulta
  b.db.correos_bfk.push({ id: 99999, message_id: "<nuevo@bfk>", buzon: "INBOX", remitente_nombre: "Nuevo", remitente_correo: "n@cliente.cl", asunto: "Correo nuevo de prueba", fecha: new Date(Date.now() + 17 * 60000).toISOString(), resumen: "nuevo", categoria: "consulta", prioridad: 2, oc_id: "oc2", asociacion: "oc", estado: "pendiente", gestionado_en: null, sincronizado_en: new Date(Date.now() + 17 * 60000).toISOString() });
  await fase("correos_5min", async () => { await p.clock.fastForward("05:01"); });
  if (opt) ok(`[${ver}] correos: el nuevo llega por la consulta incremental`, (await estado()).correosBfk.some((c) => c.id === 99999));
  // Mercado Público según su programación (cada 30 min con la app visible), sin depender de una recarga completa
  await fase("mp_30min", async () => { await p.clock.fastForward("30:30"); }, 1500);
  if (opt) { const l = R.log.filter((x) => x.fase === "mp_30min");
    ok(`[${ver}] Mercado Público: a los 30 min se ejecuta su tarea (pendientes o revisión con marca de 6 h)`, l.some((x) => x.ruta === "api/oc" || /mp_cache_avisos/.test(x.ruta)), l.map((x) => x.ruta)); }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  FIN[ver] = { inicio: await textoFinanzas(p) };
  if (opt) ok(`[${ver}] contactos institucionales no se descargan al abrir la app`, (await estado()).contactosInst === null);
  await fase("abrir_oc", async () => { await abrirOC(p, "2002-102-SE26"); });
  await espera(p, 800);
  const rutOC2 = b.db.ordenes_compra_v2.find((o) => o.id === "oc2").rut_cliente;
  const esperado = b.db.contactos_institucionales.find((c) => c.rut_clave === claveInstitucion(rutOC2) && c.estado !== "obsoleto")?.nombre;
  const fichaTxt = await p.locator('[data-oc="2002-102-SE26"]').innerText().catch(() => "");
  console.log(`  contacto esperado en la ficha de 2002-102-SE26: ${esperado || "(ninguno con ese RUT)"}`);
  if (esperado) ok(`[${ver}] la ficha de la OC muestra sus contactos institucionales`, fichaTxt.includes(esperado), fichaTxt.slice(0, 300));
  if (opt) ok(`[${ver}] contactos institucionales descargados al abrir la primera OC`, ((await estado()).contactosInst || []).length === b.db.contactos_institucionales.length);
  if (opt) { const oc1 = async () => (await estado()).ocs.find((o) => o.id === "oc1");
    ok(`[${ver}] enlace extenso no viene en la carga general`, ((await oc1()).oc_productos_link || []).find((l) => l.id === "lnk_extensa")?.url === undefined);
    R.fase = "abrir_oc_enlace_extenso"; await abrirOC(p, "2001-101-SE26"); await quieto(p, R);
    ok(`[${ver}] enlace extenso se descarga al abrir su OC`, ((await oc1()).oc_productos_link || []).find((l) => l.id === "lnk_extensa")?.url?.length > 317000); }
  // Guardado y modificación de OC: pago al financiador (OC 2001-101) → recarga parcial
  await fase("guardar_pago_financiador", async () => {
    const det = await etapa(p, "2001-101-SE26", "financ");
    await det.getByRole("button", { name: /Registrar pago/ }).click(); await espera(p, 500);
    await enModal(p).locator("input[type=number]").fill("100000");
    await enModal(p).getByRole("button", { name: /Registrar pago a financiador/ }).click(); await espera(p, 1500);
  });
  ok(`[${ver}] pago al financiador registrado en la base`, b.db.eventos_pago_financiamiento.some((e) => e.oc_id === "oc1" && Number(e.monto) === 100000));
  await equivalente("pago a financiador");
  // Refacturación: re-emitir la factura de la OC 2002-102
  await fase("refacturacion", async () => {
    const det = await etapa(p, "2002-102-SE26", "factura");
    await det.getByRole("button", { name: /re-emitir/i }).click(); await espera(p, 500);
    await enModal(p).getByPlaceholder("ej: 215").fill("9702"); await enModal(p).getByPlaceholder("ej: 123").fill("55");
    await enModal(p).getByRole("button", { name: /Reemitir factura/ }).click(); await espera(p, 1500);
  });
  ok(`[${ver}] refacturación registrada`, b.db.eventos_factura.some((e) => e.numero_factura === "9702" && e.factura_anulada_numero === "702"));
  await equivalente("refacturación");
  // Cambio de vendedor (OC 2003-103: v1 → v2)
  await fase("cambio_vendedor", async () => {
    await abrirOC(p, "2003-103-SE26"); const f = p.locator('[data-ficha-oc="2003-103-SE26"] [data-asignacion="vendedor"]');
    await f.locator("[data-asignacion-editar]").click(); await f.locator("[data-asignacion-select]").selectOption("v2"); await f.locator("[data-asignacion-guardar]").click(); await espera(p, 1500);
  });
  ok(`[${ver}] cambio de vendedor en la base`, b.db.ordenes_compra_v2.find((o) => o.id === "oc3").vendedor_id === "v2");
  const txtV = await p.locator('[data-ficha-oc="2003-103-SE26"] [data-asignacion="vendedor"]').innerText().catch((e) => "sin ficha: " + e.message.slice(0, 80));
  ok(`[${ver}] cambio de vendedor visible en la ficha`, txtV.includes(b.db.vendedores.find((v) => v.id === "v2").nombre), txtV);
  await equivalente("cambio de vendedor");
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  // Varios usuarios: u2 (celular) abierto antes; u1 registra un pago de cliente; u2 lo ve al abrir esa OC (o al volver tras 15 min)
  const U2 = await abrirApp(url, b, { usuario: "u2", escritorio: false });
  await fase("guardar_pago_cliente", async () => {
    const det = await etapa(p, "2002-102-SE26", "cobro");
    await det.getByRole("button", { name: /Registrar (pago|cobro)/ }).first().click(); await espera(p, 500);
    const m = enModal(p); await m.locator("input[type=number]").first().fill("50000");
    await m.getByRole("button", { name: /Registrar (pago|cobro)/ }).last().click(); await espera(p, 1500);
  });
  ok(`[${ver}] pago de cliente registrado`, b.db.eventos_pago_cliente.some((e) => e.oc_id === "oc2" && Number(e.monto) === 50000));
  await equivalente("pago de cliente");
  U2.R.fase = "u2_abre_oc";
  await U2.p.locator('[data-nav="compras"]').first().click(); await espera(U2.p, 700);
  await U2.p.locator('[data-oc="2002-102-SE26"] > div').first().click(); await quieto(U2.p, U2.R); await espera(U2.p, 800);
  const vistoU2 = /50\.000/.test(await U2.p.locator('[data-oc="2002-102-SE26"]').innerText().catch(() => ""));
  console.log(`  u2 ve el cobro de u1 al abrir la OC: ${vistoU2 ? "sí" : "no"}`);
  if (opt) ok(`[${ver}] otro usuario ve el cambio al abrir la OC (relectura de esa OC)`, vistoU2);
  MED[ver + "_u2"] = { abre_oc: resumen(U2.R, "u2_abre_oc") };
  await U2.ctx.close();
  // Comisiones, liquidaciones cerradas, F29, financiamiento, banco y gastos tras todos los cambios
  FIN[ver].final = await textoFinanzas(p);
  MED[ver] = Object.fromEntries(["apertura", "renovacion_x3", "pestana_x10", "pestana_tras_16min", "correos_5min", "mp_30min", "abrir_oc", "abrir_oc_enlace_extenso", "guardar_pago_financiador", "refacturacion", "cambio_vendedor", "guardar_pago_cliente"].map((f) => [f, resumen(R, f)]));
  ok(`[${ver}] sin errores de página`, R.errs.length === 0, R.errs);
  await ctx.close();
}

// ── Comparaciones antes / después ──
for (const k of Object.keys(FIN.antes.final)) {
  ok(`Pantalla ${k} idéntica antes/después (al inicio)`, FIN.antes.inicio[k] === FIN.despues.inicio[k], [FIN.antes.inicio[k]?.length, FIN.despues.inicio[k]?.length]);
  ok(`Pantalla ${k} idéntica antes/después (tras pagos, refacturación y cambio de vendedor)`, FIN.antes.final[k] === FIN.despues.final[k], [FIN.antes.final[k]?.length, FIN.despues.final[k]?.length]);
}
const A = MED.antes, D = MED.despues;
ok("Renovación de sesión: ya no descarga la base", D.renovacion_x3.cargasCompletas === 0 && A.renovacion_x3.cargasCompletas >= 3, [A.renovacion_x3, D.renovacion_x3]);
ok("Cambio de pestaña (<15 min): ya no descarga la base (solo confirma el perfil)", D.pestana_x10.cargasCompletas === 0 && A.pestana_x10.cargasCompletas >= 10 && D.pestana_x10.bytes < 20000, [A.pestana_x10, D.pestana_x10]);
ok("Cambio de pestaña tras 15 min: una carga completa", D.pestana_tras_16min.cargasCompletas === 1, D.pestana_tras_16min);
ok("Guardados: sin carga completa (recarga parcial)", ["guardar_pago_financiador", "refacturacion", "cambio_vendedor", "guardar_pago_cliente"].every((f) => D[f].cargasCompletas === 0), D);
ok("Carga completa más liviana (sin enlace extenso ni contactos)", D.apertura.bytes < A.apertura.bytes * 0.85, [A.apertura.bytes, D.apertura.bytes]);
ok("Correos cada 5 min: mucho menos que la lista completa", D.correos_5min.bytes < A.correos_5min.bytes / 10, [A.correos_5min, D.correos_5min]);
const tabla = Object.keys(D).map((f) => ({ escenario: f, antes: A[f] || null, despues: D[f] }));
console.log("\nEscenario | solicitudes antes→después | cargas completas | KB antes→después | KB gzip antes→después | ms (lecturas) antes→después | ms recarga tras guardar");
for (const r of tabla) { const a = r.antes || { solicitudes: 0, bytes: 0, gz: 0, ms: 0, cargasCompletas: 0 }, d = r.despues; console.log(`${r.escenario} | ${a.solicitudes}→${d.solicitudes} | ${a.cargasCompletas}→${d.cargasCompletas} | ${(a.bytes / 1024).toFixed(1)}→${(d.bytes / 1024).toFixed(1)} | ${(a.gz / 1024).toFixed(1)}→${(d.gz / 1024).toFixed(1)} | ${a.ms}→${d.ms} | ${a.msRecarga ?? "—"}→${d.msRecarga ?? "—"}`); }
console.log(`u2 abre la OC | ${MED.antes_u2.abre_oc.solicitudes}→${MED.despues_u2.abre_oc.solicitudes} | ${(MED.antes_u2.abre_oc.bytes / 1024).toFixed(1)}→${(MED.despues_u2.abre_oc.bytes / 1024).toFixed(1)}`);
if (process.env.SALIDA) writeFileSync(process.env.SALIDA, JSON.stringify({ MED, FIN_iguales: Object.keys(FIN.antes.final).map((k) => [k, FIN.antes.final[k] === FIN.despues.final[k]]) }, null, 1));
await browser.close();
console.log(`\nRESUMEN consumo fase 1: ${nOk} OK, ${F.length} FALLA(S)${F.length ? ": " + F.join(" | ") : ""}`); process.exit(F.length ? 1 : 0);
