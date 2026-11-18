// Consumo de Supabase, fase 1 — verificación sobre una COPIA RESTAURADA de los datos reales con PostgREST REAL (RLS y permisos
// de producción). Nunca producción: *.supabase.co/rest/v1 → PostgREST de la copia; /auth/v1 → sesión simulada con JWT de la copia;
// /api/* y Storage → bloqueados. Se corre una vez por versión (cada una con su propia copia) y luego se comparan las salidas.
// Comprueba: (1) que TODAS las consultas de la app (incluidas las nuevas: enlaces cortos con «not.like», «in.("…")», correos con
// «or/gt», historial con «gte», contactos con «limit=1») responden sin error; (2) pantallas financieras; (3) operaciones reales
// (pago a financiador, pago de cliente, cambio de vendedor, factura) con detección de TODAS las tablas que cambia la base y, en la
// versión optimizada, que el estado tras la recarga parcial = estado tras una carga completa; (4) dos usuarios: sin sobrescribir
// datos más nuevos; (5) una cuenta desautorizada pierde el acceso al volver a la app.
// Uso: PGRST_URL=… JWT_SECRET=… ADM=<uid admin> USR2=<uid admin 2> USR3=<uid a desautorizar> PSQL_URL=postgresql://…/copia
//      VERSION=antes|despues SALIDA=salida.json CHROME=… node e2e_real.mjs <url-app>
import { chromium } from "playwright-core";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const URL_APP = process.argv[2].replace(/\/$/, "") + "/";
const { PGRST_URL, JWT_SECRET, ADM, USR2, USR3, PSQL_URL, VERSION = "?", SALIDA } = process.env;
const OPT = VERSION === "despues";
// RETIRO_CORREOS=1: versión con el módulo «Correos de BFK» retirado (lib/modulos.js): no debe consultar correos_bfk nunca.
const RETIRO = process.env.RETIRO_CORREOS === "1";
let nOk = 0; const F = []; const OUT = { version: VERSION, pantallas: {}, operaciones: [], errores4xx: [], consultasNuevas: {}, consumo: {} };
const ok = (k, v, d) => { if (v) { nOk++; console.log("OK    " + k); } else { F.push(k); console.log("FALLA " + k + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 700) : "")); } };
const psql = (sql) => execFileSync("psql", [PSQL_URL, "-X", "-q", "-At", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub, n = 0) => { const a = Math.floor(Date.now() / 1000) + n; const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ sub, role: "authenticated", aud: "authenticated", exp: a + 7200, iat: a });
  return `${h}.${p}.${createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`; };
const rest = async (ruta, sub = ADM) => (await fetch(`${PGRST_URL}/${ruta}`, { headers: { Authorization: `Bearer ${jwt(sub)}` } })).json();
const espera = (p, ms) => p.waitForTimeout(ms);
const browser = await chromium.launch({ executablePath: process.env.CHROME, args: ["--no-sandbox"] });

// Tablas que la app descarga en la carga completa, y las que la recarga parcial vuelve a leer.
const CARGADAS = ["ordenes_compra_v2", "eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios",
  "financiadores", "vendedores", "categorias_gasto", "gastos_indirectos", "iva_mensual", "pagos_vendedor", "ajustes_saldo_financiador", "perfiles", "contactos_cobranza", "entidades_catalogo",
  "notificaciones", "historial_cambios", "oc_reclamos", "oc_responsables", "eventos_postventa", "aportes_socios", "cartolas_importadas", "saldo_banco", "banco_mensual", "fin_diferencias_historicas",
  "mp_cache_avisos", "correos_bfk", "oc_seguimientos", "trib_clasificaciones", "cotizaciones", "contactos_institucionales", "contactos_institucionales_oc", "comision_liquidaciones",
  "comision_liquidacion_ocs", "comision_decisiones"];
const PARCIAL = new Set(["ordenes_compra_v2", "eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "oc_productos_link", "oc_comentarios",
  "oc_reclamos", "oc_responsables", "eventos_postventa", "oc_seguimientos", "mp_cache_avisos", "financiadores", "notificaciones", "historial_cambios", "cartolas_importadas", "saldo_banco", "banco_mensual"]);
const huellas = () => Object.fromEntries(psql(`select string_agg(relname || '=' || n, ',') from (select c.relname, (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) as h from public.%I t', '|', '', c.relname), false, true, '')))[1]::text n from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r') x`).split(",").map((x) => x.split("=")));
const cambiadas = (a, b) => Object.keys(b).filter((k) => a[k] !== b[k]).sort();

async function abrirApp(uid, { escritorio = true } = {}) {
  const R = { fase: "apertura", log: [], errs: [] }; let nTok = 0;
  const user = { id: uid, aud: "authenticated", role: "authenticated", email: "verificacion@copia.invalid" };
  const ses = () => ({ access_token: jwt(uid, nTok++), refresh_token: "r" + nTok, token_type: "bearer", expires_in: 7200, expires_at: Math.floor(Date.now() / 1000) + 7200, user });
  const ctx = await browser.newContext(escritorio ? { viewport: { width: 1440, height: 900 }, timezoneId: "America/Santiago", locale: "es-CL", serviceWorkers: "block" }
    : { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/Santiago", locale: "es-CL", serviceWorkers: "block" });
  await ctx.addInitScript((s) => { try { localStorage.setItem("bfk_supabase_session_v2", JSON.stringify(s)); } catch {}
    let v = "visible"; Object.defineProperty(document, "visibilityState", { configurable: true, get: () => v }); Object.defineProperty(document, "hidden", { configurable: true, get: () => v !== "visible" });
    window.__vis = (x) => { v = x; document.dispatchEvent(new Event("visibilitychange")); }; }, ses());
  await ctx.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method();
    if (u.hostname.endsWith("supabase.co")) {
      if (u.pathname.startsWith("/auth/v1/")) {
        if (u.pathname.endsWith("/user")) return route.fulfill({ json: user });
        if (u.pathname.startsWith("/auth/v1/token")) return route.fulfill({ json: ses() });
        return route.fulfill({ status: 204, body: "" }); }
      if (!u.pathname.startsWith("/rest/v1/")) return route.fulfill({ status: 404, json: { message: "no disponible en la prueba" } });
      const obj = u.pathname.replace(/^\/rest\/v1\//, "");
      const hd = { ...req.headers(), authorization: req.headers().authorization || "" };
      for (const k of ["apikey", "host", "connection", "content-length", "origin", "referer"]) delete hd[k];
      const r = await fetch(PGRST_URL + "/" + obj + u.search, { method: m, headers: hd, body: ["GET", "HEAD"].includes(m) ? undefined : req.postData() });
      const cuerpo = Buffer.from(await r.arrayBuffer());
      const q = decodeURIComponent(u.search);
      R.log.push({ fase: R.fase, metodo: m, ruta: obj.split("?")[0], q: q.slice(0, 220), status: r.status, bytes: cuerpo.length, parcial: /[?&](id|oc_id)=in\./.test(q), t: Date.now() });
      if (r.status >= 400) OUT.errores4xx.push(`${r.status} ${m} ${obj.split("?")[0]} ${q.slice(0, 120)} :: ${cuerpo.toString().slice(0, 160)}`);
      return route.fulfill({ status: r.status, headers: Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length"].includes(k))), body: cuerpo }); }
    if (u.origin === new URL(URL_APP).origin) { if (u.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "bloqueado en la prueba" } }); return route.continue(); }
    if (/fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) return route.continue();
    return route.abort(); });
  const p = await ctx.newPage(); p.on("pageerror", (e) => R.errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await p.clock.install({ time: new Date() });
  await p.goto(URL_APP, { waitUntil: "load" }); await quieto(p, R);
  return { p, ctx, R };
}
async function quieto(p, R, max = 40000) { const t0 = Date.now(); let n = -1; while (Date.now() - t0 < max) { await p.waitForTimeout(1500); if (R.log.length === n) return; n = R.log.length; } }
const estado = (p) => p.evaluate(() => window.__bfkDatos ? window.__bfkDatos() : null);
// Forma canónica para comparar CONTENIDO: toda lista ordenada por id (o por su contenido) y claves ordenadas, a cualquier
// profundidad. El orden de las listas embebidas que entrega PostgreSQL no está definido (p. ej. lecturas en paralelo) y
// cambia entre dos cargas completas cualesquiera; se informa aparte.
const canon = (v) => Array.isArray(v) ? v.map(canon).sort((a, c) => { const x = a && a.id !== undefined ? String(a.id) : JSON.stringify(a), y = c && c.id !== undefined ? String(c.id) : JSON.stringify(c); return x < y ? -1 : x > y ? 1 : 0; })
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const normal = (d) => { const o = {}; for (const [k, v] of Object.entries(d || {})) { if (["contactosInst", "vinculosInst"].includes(k)) continue; o[k] = canon(v); } return JSON.stringify(o); };
const normalOrden = (d) => { const o = {}; for (const [k, v] of Object.entries(d || {})) { if (["contactosInst", "vinculosInst"].includes(k)) continue; o[k] = Array.isArray(v) ? v.slice().sort((a, c) => String(a.id).localeCompare(String(c.id))) : v; } return JSON.stringify(o); };
// Diferencias (solo nombres de listas, cuántos registros y qué campos; sin valores ni identificadores).
const difEstado = (a, c) => { const A = JSON.parse(a), B = JSON.parse(c);
  return Object.keys({ ...A, ...B }).filter((k) => JSON.stringify(A[k]) !== JSON.stringify(B[k])).map((k) => {
    if (!Array.isArray(A[k]) || !Array.isArray(B[k])) return k;
    const mb = new Map(B[k].map((x) => [x.id, x])); const campos = {}; let n = 0, soloA = 0;
    for (const x of A[k]) { const y = mb.get(x.id); if (!y) { soloA++; continue; } if (JSON.stringify(x) === JSON.stringify(y)) continue; n++;
      for (const f of Object.keys({ ...x, ...y })) if (JSON.stringify(x[f]) !== JSON.stringify(y[f])) {
        if (Array.isArray(x[f]) && Array.isArray(y[f])) { const my = new Map(y[f].map((z) => [z.id, z])); for (const z of x[f]) { const w = my.get(z.id); if (!w) { campos[f + "[+parcial]"] = (campos[f + "[+parcial]"] || 0) + 1; continue; } for (const g of Object.keys({ ...z, ...w })) if (JSON.stringify(z[g]) !== JSON.stringify(w[g])) campos[f + "." + g] = (campos[f + "." + g] || 0) + 1; } if (y[f].length > x[f].length) campos[f + "[+completa]"] = (campos[f + "[+completa]"] || 0) + 1; }
        else campos[f] = (campos[f] || 0) + 1; } }
    return `${k}: ${n} registros distintos, ${soloA} solo en la parcial, ${B[k].length - A[k].length + soloA} solo en la completa; campos ${JSON.stringify(campos)}`;
  }); };
const textoFinanzas = async (p) => {
  const T = {};
  for (const k of ["vendedores", "impuestos", "financiamiento", "banco", "gastos"]) {
    if (!(await p.locator(`[data-tab="${k}"]`).count())) { await p.locator('aside [data-nav="finanzas"]').click(); await espera(p, 700); }
    if (!(await p.locator(`[data-tab="${k}"]`).count())) continue;
    await p.locator(`[data-tab="${k}"]`).first().click(); await espera(p, 1200);
    T[k] = (await p.evaluate(() => (document.querySelector("main") || document.body).innerText)).replace(/\d{1,2}:\d{2}(:\d{2})?/g, "hh:mm");
  }
  await p.locator('aside [data-nav="compras"]').click(); await espera(p, 900);
  return T;
};
async function abrirOC(p, numero) {
  if (await p.locator("[data-hoja-lateral]").count()) { await p.keyboard.press("Escape"); await espera(p, 400); }
  const buscar = p.locator('input[type="search"], input[placeholder*="Buscar"]').first();
  if (await buscar.count()) { await buscar.fill(numero); await espera(p, 600); }
  await p.locator(`[data-oc="${numero}"] > div`).first().click(); await espera(p, 1500);
}
const { irSeccionFicha } = await import("../pruebas-oc/indice_ficha.mjs").catch(() => import("./indice_ficha.mjs"));
async function etapa(p, numero, key) {
  await abrirOC(p, numero); const fila = p.locator(`[data-oc="${numero}"]`);
  const SECCION = { financ: "Compra y financiamiento", factura: "Facturación SII", cobro: "Cobranza" };
  await irSeccionFicha(fila, SECCION[key]); await espera(p, 500);
  return fila.locator(key === "factura" ? "[data-facturacion-sii]" : `[data-etapa-seccion="${key}"]`);
}
const enModal = (p) => p.locator("[role=dialog]").last();

// ── 1. Apertura y consultas ──
const A = await abrirApp(ADM);
await A.p.locator('aside [data-nav="compras"]').click().catch(() => {}); await espera(A.p, 1500);
const pantallaInicial = (await A.p.locator("body").innerText().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
ok(`[${VERSION}] la app abre con los datos reales de la copia`, (await A.p.locator("[data-nav]").count()) > 0 && (await A.p.locator("[data-oc]").count()) > 0,
  { pantalla: pantallaInicial, consultas: A.R.log.length, errores: OUT.errores4xx.slice(0, 5), pagina: A.R.errs.slice(0, 3) });
const nuevas = { enlaces_cortos: (x) => x.ruta === "oc_productos_link" && /url\.not\.like/.test(x.q), contactos_sonda: (x) => x.ruta === "contactos_institucionales" && /limit=1/.test(x.q) };
for (const [k, f] of Object.entries(nuevas)) { const l = A.R.log.filter(f); OUT.consultasNuevas[k] = l.map((x) => x.status); if (OPT) ok(`[${VERSION}] consulta nueva «${k}» responde 200 en PostgREST real`, l.length > 0 && l.every((x) => x.status === 200), l); }
if (OPT) {   // los enlaces de largo normal llegan completos; los extensos (≥ 2000) quedan para cuando se abra su OC
  const e = await estado(A.p); const lineas = e.ocs.flatMap((o) => o.oc_productos_link || []);
  const largos = Number(psql("select count(*) from public.oc_productos_link where length(url) >= 2000"));
  ok(`[${VERSION}] enlaces: ${lineas.filter((l) => l.url === undefined).length} sin descargar = ${largos} extensos en la base (de las OCs activas o menos)`, lineas.filter((l) => l.url === undefined).length <= largos);
  const muestra = lineas.find((l) => typeof l.url === "string" && l.url.length > 10);
  if (muestra) ok(`[${VERSION}] enlace normal idéntico al de la base`, muestra.url === psql(`select url from public.oc_productos_link where id = '${muestra.id.replace(/'/g, "''")}'`));
}
OUT.pantallas.inicio = await textoFinanzas(A.p);

// ── 2. Renovación de sesión, regreso a la pestaña y correos (consultas incrementales en PostgREST real) ──
A.R.fase = "renovacion"; await A.p.evaluate(() => window.__bfkSesion.renovarAhora()); await quieto(A.p, A.R);
A.R.fase = "pestana"; for (let i = 0; i < 3; i++) { await A.p.evaluate(() => window.__vis("hidden")); await A.p.evaluate(() => window.__vis("visible")); await espera(A.p, 500); } await quieto(A.p, A.R);
A.R.fase = "correos"; await A.p.clock.fastForward("05:30"); await quieto(A.p, A.R);
const cuenta = (f) => A.R.log.filter((x) => x.fase === f);
OUT.consumo.renovacion = cuenta("renovacion").length; OUT.consumo.pestana = cuenta("pestana").length;
if (OPT) {
  ok(`[${VERSION}] renovación: solo confirma el perfil (sin carga completa)`, cuenta("renovacion").every((x) => x.ruta === "perfiles") && cuenta("renovacion").length > 0, cuenta("renovacion").map((x) => x.ruta));
  // Desde el Centro de Acciones (17/11/2026) el regreso también pide solo las acciones nuevas (oc_seguimientos e historial).
  ok(`[${VERSION}] regreso a la pestaña: solo confirma el perfil (y lo nuevo del Centro de Acciones), sin recarga completa`, cuenta("pestana").some((x) => x.ruta === "perfiles") && cuenta("pestana").every((x) => ["perfiles", "oc_seguimientos", "historial_cambios"].includes(x.ruta)), cuenta("pestana").map((x) => x.ruta));
  const c = cuenta("correos").filter((x) => x.ruta === "correos_bfk"); OUT.consultasNuevas.correos_incremental = c.map((x) => x.status);
  if (!RETIRO) ok(`[${VERSION}] correos incrementales (or/gt) responden 200`, c.length > 0 && c.every((x) => x.status === 200 && /sincronizado_en\.gt/.test(x.q)), c);
  else ok(`[${VERSION}] correos retirados: a los 5 min no se consulta correos_bfk`, !cuenta("correos").some((x) => /correos?_bfk/.test(x.ruta)), cuenta("correos").map((x) => x.ruta));
}

// ── 3. Operaciones reales sobre OCs elegidas en la copia ──
const cand = psql(`select o.numero_oc from public.ordenes_compra_v2 o
  where not coalesce(o.archivada,false) and o.financiador_id is not null and coalesce(o.estado_pago_cliente,'') <> 'pagado'
    and exists (select 1 from public.eventos_factura f where f.oc_id = o.id) and exists (select 1 from public.eventos_compra c where c.oc_id = o.id)
    and not exists (select 1 from public.comision_liquidacion_ocs l where l.oc_id = o.id)
  order by o."creadoEn" desc limit 3`).split("\n").filter(Boolean);
ok(`[${VERSION}] hay OCs reales candidatas para operar (${cand.length})`, cand.length >= 2, cand);
const [OC1, OC2] = cand;
const vendedorOtro = (num) => psql(`select v.id from public.vendedores v, public.ordenes_compra_v2 o where o.numero_oc = '${num}' and v.id is distinct from o.vendedor_id and coalesce(v.activo,true) order by v.nombre limit 1`);
const operar = async (nombre, num, accion, verificar) => {
  const h0 = huellas(); A.R.fase = nombre;
  try { await accion(); } catch (e) { ok(`[${VERSION}] ${nombre}: la operación se completa en la interfaz`, false, e.message); return; }
  await quieto(A.p, A.R); const h1 = huellas();
  const t = cambiadas(h0, h1); const fuera = t.filter((x) => CARGADAS.includes(x) && !PARCIAL.has(x));
  const l = A.R.log.filter((x) => x.fase === nombre);
  OUT.operaciones.push({ nombre, oc: num, tablas: t, fueraDeLaRecargaParcial: fuera, solicitudes: l.length, bytes: l.reduce((a, x) => a + x.bytes, 0), completas: l.filter((x) => x.ruta === "ordenes_compra_v2" && x.metodo === "GET" && !x.parcial).length });
  ok(`[${VERSION}] ${nombre}: quedó registrado en la base`, verificar());
  console.log(`  ${nombre} (${num}): tablas que cambió la base → ${t.join(", ") || "(ninguna)"}`);
  if (OPT) {
    ok(`[${VERSION}] ${nombre}: toda tabla cargada que cambió la base se vuelve a leer en la recarga parcial`, fuera.length === 0, fuera);
    ok(`[${VERSION}] ${nombre}: sin carga completa`, OUT.operaciones.at(-1).completas === 0, OUT.operaciones.at(-1));
    const eP = await estado(A.p); A.R.fase = "_verif";
    await A.p.locator('aside [data-nav="actualizar"]').click(); await quieto(A.p, A.R);
    const eC = await estado(A.p);
    const parcial = normal(eP), completo = normal(eC);
    ok(`[${VERSION}] ${nombre}: estado tras la recarga parcial = carga completa (contenido, datos reales)`, parcial === completo, difEstado(parcial, completo));
    if (normalOrden(eP) !== normalOrden(eC)) console.log(`  ${nombre}: mismo contenido, distinto orden en listas embebidas (${difEstado(normalOrden(eP), normalOrden(eC)).join(" · ").slice(0, 200)})`);
  }
};
if (OC1) await operar("pago_financiador", OC1, async () => {
  const det = await etapa(A.p, OC1, "financ"); await det.getByRole("button", { name: /Registrar pago/ }).click(); await espera(A.p, 600);
  await enModal(A.p).locator("input[type=number]").first().fill("1000"); await enModal(A.p).getByRole("button", { name: /Registrar pago a financiador/ }).click(); await espera(A.p, 2000);
}, () => Number(psql(`select count(*) from public.eventos_pago_financiamiento e join public.ordenes_compra_v2 o on o.id = e.oc_id where o.numero_oc = '${OC1}' and e.monto = 1000`)) > 0);
if (OC1) await operar("pago_cliente", OC1, async () => {
  const det = await etapa(A.p, OC1, "cobro"); await det.getByRole("button", { name: /Registrar (pago|cobro)/ }).first().click(); await espera(A.p, 600);
  const m = enModal(A.p); await m.locator("input[type=number]").first().fill("1000"); await m.getByRole("button", { name: /Registrar (pago|cobro)/ }).last().click(); await espera(A.p, 2000);
}, () => Number(psql(`select count(*) from public.eventos_pago_cliente e join public.ordenes_compra_v2 o on o.id = e.oc_id where o.numero_oc = '${OC1}' and e.monto = 1000`)) > 0);
let V2 = OC2 ? vendedorOtro(OC2) : "";
if (OC2 && V2) await operar("cambio_vendedor", OC2, async () => {
  await abrirOC(A.p, OC2); const f = A.p.locator(`[data-ficha-oc="${OC2}"] [data-asignacion="vendedor"]`);
  await f.locator("[data-asignacion-editar]").click(); await f.locator("[data-asignacion-select]").selectOption(V2); await f.locator("[data-asignacion-guardar]").click(); await espera(A.p, 2000);
}, () => psql(`select vendedor_id from public.ordenes_compra_v2 where numero_oc = '${OC2}'`) === V2);

// ── 4. Dos usuarios: B con datos anteriores no sobrescribe lo que A acaba de guardar ──
if (OC2 && USR2) {
  const B = await abrirApp(USR2, { escritorio: false });
  const V3 = vendedorOtro(OC2);   // A vuelve a cambiar el vendedor mientras B tiene la app abierta (datos de antes)
  A.R.fase = "conc_a"; await abrirOC(A.p, OC2);
  const f = A.p.locator(`[data-ficha-oc="${OC2}"] [data-asignacion="vendedor"]`);
  await f.locator("[data-asignacion-editar]").click(); await f.locator("[data-asignacion-select]").selectOption(V3); await f.locator("[data-asignacion-guardar]").click(); await espera(A.p, 2000);
  if (await A.p.locator("[data-hoja-lateral]").count()) await A.p.keyboard.press("Escape");
  await A.p.locator('aside [data-nav="compras"]').click().catch(() => {}); await espera(A.p, 1200);   // A suelta la OC (deja de editarla)
  ok(`[${VERSION}] concurrencia: A guardó el vendedor nuevo`, psql(`select vendedor_id from public.ordenes_compra_v2 where numero_oc = '${OC2}'`) === V3);
  B.R.fase = "conc_b"; await B.p.locator('[data-nav="compras"]').first().click(); await espera(B.p, 800);
  const buscarB = B.p.locator('input[type="search"], input[placeholder*="Buscar"]').first(); if (await buscarB.count()) { await buscarB.fill(OC2); await espera(B.p, 600); }
  await B.p.locator(`[data-oc="${OC2}"] > div`).first().click(); await quieto(B.p, B.R); await espera(B.p, 800);
  const nombreV3 = psql(`select nombre from public.vendedores where id = '${V3}'`);
  const veB = (await B.p.locator(`[data-oc="${OC2}"]`).innerText().catch(() => "")).includes(nombreV3);
  OUT.concurrencia = { b_ve_cambio_de_a_al_abrir: veB };
  console.log(`  B ve el vendedor que guardó A al abrir la OC: ${veB ? "sí" : "no"}`);
  if (OPT) ok(`[${VERSION}] concurrencia: B ve el cambio de A al abrir la OC (relectura)`, veB);
  // B registra un pago de cliente en esa OC: el vendedor de A sigue intacto
  try {
    const { irSeccionFicha: ir } = await import("../pruebas-oc/indice_ficha.mjs").catch(() => import("./indice_ficha.mjs"));
    const fila = B.p.locator(`[data-oc="${OC2}"]`); await ir(fila, "Cobranza"); await espera(B.p, 500);
    const det = fila.locator('[data-etapa-seccion="cobro"]'); await det.getByRole("button", { name: /Registrar (pago|cobro)/ }).first().click(); await espera(B.p, 600);
    const m = enModal(B.p); await m.locator("input[type=number]").first().fill("777"); await m.getByRole("button", { name: /Registrar (pago|cobro)/ }).last().click(); await espera(B.p, 2000);
  } catch (e) { console.log("  (B no pudo registrar el pago en la interfaz: " + e.message.slice(0, 120) + ")"); }
  const pagoB = Number(psql(`select count(*) from public.eventos_pago_cliente e join public.ordenes_compra_v2 o on o.id = e.oc_id where o.numero_oc = '${OC2}' and e.monto = 777`)) > 0;
  ok(`[${VERSION}] concurrencia: tras guardar B, el vendedor guardado por A sigue en la base (sin sobrescritura)`, psql(`select vendedor_id from public.ordenes_compra_v2 where numero_oc = '${OC2}'`) === V3);
  OUT.concurrencia.pago_b_registrado = pagoB;
  await B.ctx.close();
}

// ── 5. Cuenta desautorizada: pierde el acceso al volver a la app (sin esperar 15 min) ──
if (USR3) {
  const D = await abrirApp(USR3, { escritorio: false });
  ok(`[${VERSION}] cuenta autorizada entra`, (await D.p.locator("[data-nav]").count()) > 0);
  psql(`delete from public.perfiles where id = '${USR3}'`);
  await D.p.evaluate(() => window.__vis("hidden")); await D.p.evaluate(() => window.__vis("visible")); await espera(D.p, 4000);
  const fuera = (await D.p.locator("[data-cuenta-por-autorizar]").count()) > 0 && (await D.p.locator('[data-nav="compras"]').count()) === 0;
  ok(`[${VERSION}] cuenta desautorizada pierde el acceso al volver a la app`, fuera, await D.p.locator("body").innerText().then((t) => t.slice(0, 200)));
  const leeOC = await rest("ordenes_compra_v2?select=id&limit=1", USR3);
  ok(`[${VERSION}] la base (RLS) no le entrega datos a la cuenta desautorizada`, !Array.isArray(leeOC) || leeOC.length === 0, leeOC);
  await D.ctx.close();
}

// ── 6. Pantallas financieras tras las operaciones; errores de PostgREST ──
OUT.pantallas.final = await textoFinanzas(A.p);
const err = OUT.errores4xx.filter((x) => !/^4(01|03) .* perfiles/.test(x));
ok(`[${VERSION}] ninguna consulta de la app falló en PostgREST real`, err.length === 0, err.slice(0, 8));
ok(`[${VERSION}] sin errores de página`, A.R.errs.length === 0, A.R.errs);
{ const cb = A.R.log.filter((x) => /correos?_bfk/.test(x.ruta)); OUT.consumo.correos = { solicitudes: cb.length, bytes: cb.reduce((a, x) => a + x.bytes, 0) };
  console.log(`  correos_bfk en la sesión (datos reales): ${cb.length} solicitudes, ${(OUT.consumo.correos.bytes / 1024).toFixed(1)} KB`);
  if (RETIRO) ok(`[${VERSION}] correos retirados: ninguna solicitud a correos_bfk en toda la sesión (ingreso, guardados, actualizar)`, cb.length === 0, cb.map((x) => x.fase)); }
OUT.consumo.total = { solicitudes: A.R.log.length, bytes: A.R.log.reduce((a, x) => a + x.bytes, 0), completas: A.R.log.filter((x) => x.ruta === "ordenes_compra_v2" && x.metodo === "GET" && !x.parcial).length };
await browser.close();
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(OUT, null, 1));
console.log(`\nRESUMEN e2e_real (${VERSION}): ${nOk} OK, ${F.length} FALLA(S)${F.length ? ": " + F.join(" | ") : ""}`); process.exit(F.length ? 1 : 0);
