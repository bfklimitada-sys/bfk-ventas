// Renovación de sesión y sesiones vencidas (10/11/2026) — Cotizaciones de Mercado Público, navegador real, Supabase SIMULADO
// (el simulador de siempre: nada sale a la red) con un servicio de sesión simulado que exige el token vigente (rechaza con
// «JWT expired»), rota el refresh token y permite cortar la conexión antes de enviar o perder la respuesta.
// Comprueba que guardar la cotización y registrar la EETT ocurren EXACTAMENTE UNA VEZ con sesión vencida, respuesta incierta,
// pérdida de conexión y fallo de renovación, y que lo escrito se conserva para la misma cuenta.
// Uso: node docs/pruebas-sesion/e2e_sesion_mp.mjs http://127.0.0.1:4330/
process.env.JWT_SECRET ||= "secreto-de-prueba-solo-local-0123456789abcdef";
const { crearAuth } = await import("../pruebas-ventas-privadas/arnes_vp.mjs");
const { chromium, CHROME, crearBase, instalarRutas } = await import("../pruebas-oc/mock_estado.mjs");
const { crearDatos } = await import("../pruebas-oc/datos_oc.mjs");
const { moduloSimulado } = await import("../pruebas-cotizaciones/modulo_simulado.mjs");
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url)); const LOGO = join(AQUI, "../../src/assets/bfk-logo.jpg");
const URL_APP = process.argv[2] || "http://127.0.0.1:4330/"; const LLAVE = "bfk_supabase_session_v2";
let nOk = 0; const F = [];
const ok = (n, c, det = "") => { if (c) { nOk++; console.log("OK   ", n); } else { F.push(n); console.log("FALLA", n, typeof det === "string" ? det.slice(0, 700) : JSON.stringify(det).slice(0, 700)); } };
const espera = (p, ms = 400) => p.waitForTimeout(ms);
const H = (p) => p.locator('[data-hoja-lateral="cotizacion"]');
const tab = (p, k) => H(p).locator(`[role="tab"][data-tab="${k}"]`).click().then(() => espera(p, 300));
const cuerpo = (p) => p.locator("body").innerText();
const ve = async (p, re, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (re.test(await cuerpo(p))) return true; await p.waitForTimeout(120); } return false; };
const est = (p) => p.evaluate(() => window.__bfkSesion.estado());
const llenar = async (loc, v) => { await loc.fill(""); await loc.fill(String(v)); };
const COT = { id: "c-7", version: 3, id_externo: "697036-78-COT26", nombre: "Impresoras", institucion: "Municipio", rut: "1-9", direccion_entrega: "Calle 1", comuna: "Laja", estado: "borrador", fecha: "2026-10-05", recargo: 0.3, plazo: "2 DIAS", observaciones: "", actualizado_en: "2026-10-05", vendedor_id: null, vendedor_nombre: "",
  envios: [{ key: "e1", proveedor: "Falabella", monto: 5990, con_factura: true, estado: "confirmado", destino: "Calle 1, Laja", evidencia: "simulación" }],
  items: [{ key: "i1", producto_id: null, ficha: { nombre: "Impresora", marca: "HP", modelo: "520", especificaciones: [{ etiqueta: "Tipo", valor: "Tinta" }], imagenes: ["img/abc.jpg"] }, ficha_aprobada: true, enlace: "https://falabella.com/x", proveedor: "Falabella", cantidad: 3, precio_origen: 82865, precio_incluye_iva: true, con_factura: true, envio_key: "e1", recargo: null, disponibilidad: "En stock", origen_datos: "enlace" }] };
const borradores = (p) => p.evaluate(() => new Promise((res) => { const r = indexedDB.open("bfk-borradores"); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("cotizaciones")) { db.close(); return res([]); }
  const q = db.transaction("cotizaciones").objectStore("cotizaciones").getAll(); q.onsuccess = () => { db.close(); res(q.result.map((x) => ({ usuario: x.usuario, cotId: x.cotId, inst: x.cot?.institucion, base: !!x.base }))); }; q.onerror = () => res([]); }; r.onerror = () => res([]); }));

async function preparar(browser) {
  const A = crearAuth({ usuarios: ["u1"] }); const b = crearBase(crearDatos(), {}); const M = moduloSimulado(2); M.cots.set("c-7", JSON.parse(JSON.stringify(COT)));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "America/Santiago", acceptDownloads: true });
  const p = await ctx.newPage(); const errs = []; p.setDefaultTimeout(9000);
  p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
  await instalarRutas(p, b, "u1"); await p.route("**/*", (route) => M.manejar(route));
  // Capa de sesión (se evalúa primero): exige token vigente, registra y aplica los cortes de conexión.
  await p.route("**/*", async (route) => {
    const req = route.request(); const u = new URL(req.url()); const m = req.method(); const cab = req.headers().authorization;
    if (!u.hostname.endsWith("supabase.co")) return route.fallback();
    if (A.sinConexion) return route.abort("internetdisconnected");
    if (u.pathname.startsWith("/auth/v1/token")) { let c = null; try { c = JSON.parse(req.postData() || "null"); } catch {} const r = A.responder(u, c); return r === "red" ? route.abort("connectionfailed") : route.fulfill(r); }
    if (!/^\/(rest|storage)\/v1\//.test(u.pathname)) return route.fallback();
    const obj = u.pathname.replace(/^\/(rest|storage)\/v1\//, ""); const modo = A.corte(m, u.pathname);
    if (modo === "antes") return route.abort("connectionfailed");
    if (A.vencido(cab)) { A.pedidos.push({ m, obj, status: 401, jti: A.datos(cab)?.jti }); return route.fulfill({ status: 401, json: { code: "PGRST301", details: null, hint: null, message: "JWT expired" } }); }
    A.pedidos.push({ m, obj, status: 200, jti: A.datos(cab)?.jti });
    if (modo === "despues") {   // el servidor ejecuta la solicitud, pero la respuesta no llega
      if (u.pathname.includes("/rpc/cz_") || /cotizacion|eett_documentos/.test(u.pathname)) await M.manejar({ request: () => req, fulfill: async () => {}, fallback: async () => {}, abort: async () => {} });
      return route.abort("connectionfailed");
    }
    return route.fallback();
  });
  await p.addInitScript(([k, s]) => { try { if (!sessionStorage.getItem("__i")) { sessionStorage.setItem("__i", "1"); if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify(s)); } } catch {} }, [LLAVE, A.sesion("u1")]);
  await p.goto(URL_APP, { waitUntil: "load" }); await espera(p, 2800);
  await p.locator('aside [data-nav="cotizaciones"]').click(); await espera(p, 1500);
  return { A, M, ctx, p, errs };
}
const guardados = (M, desdeN = 0) => M.rpc.slice(desdeN).filter((r) => /cz_guardar_cotizacion/.test(r.fn));
const guardarViendo = async (p, re) => { await H(p).locator("[data-guardar-cotizacion]").click(); const v = await ve(p, re); await espera(p, 1600); return v; };
const descarga = async (p, accion) => { const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), accion()]); return dl.suggestedFilename(); };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
try {
  const { A, M, ctx, p, errs } = await preparar(browser);
  ok("M00 Mercado Público abre con la sesión simulada", (await est(p)).estado === "vigente" && (await est(p)).vence_en_s > 3000 && (await p.locator('[data-cotizacion="697036-78-COT26"]').count()) === 1, await est(p));
  await p.locator('[data-cotizacion="697036-78-COT26"]').click(); await espera(p, 1500); await tab(p, "datos");

  // 1. Sesión vencida para el servidor al guardar.
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipio (sesión vencida)"); await espera(p, 600);
  A.vencerAhora(); let i0 = A.pedidos.length; let n0 = M.rpc.length; let r0 = A.renovaciones();
  let visto = await guardarViendo(p, /Cotización guardada/);
  ok("M01 guardar con «JWT expired»: una renovación, la solicitud rechazada se repite una vez y el guardado se ejecuta UNA vez", visto && A.renovaciones() === r0 + 1 && A.pedidos.slice(i0).filter((x) => x.status === 401).length === 1
    && guardados(M, n0).length === 1 && M.cots.get("c-7").version === 4 && M.cots.get("c-7").institucion === "Municipio (sesión vencida)", { ped: A.pedidos.slice(i0).map((x) => `${x.obj}:${x.status}`), v: M.cots.get("c-7").version });

  // 2. Respuesta incierta: el servidor guardó, la respuesta se perdió.
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipio (respuesta perdida)"); n0 = M.rpc.length;
  A.cortes.push({ patron: /^POST .*\/rpc\/cz_guardar_cotizacion/, modo: "despues", veces: 1 });
  visto = await guardarViendo(p, /Cotización guardada/);
  ok("M02 respuesta incierta: se comprobó que quedó guardada; NO se repitió", visto && guardados(M, n0).length === 1 && M.cots.get("c-7").version === 5 && (await H(p).locator("[data-estado-guardado]").getAttribute("data-estado-guardado")) === "bfk", { n: guardados(M, n0).length, v: M.cots.get("c-7").version });
  // 3. La solicitud no salió.
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipio (no salió)"); n0 = M.rpc.length;
  A.cortes.push({ patron: /^POST .*\/rpc\/cz_guardar_cotizacion/, modo: "antes", veces: 1 });
  visto = await guardarViendo(p, /NO quedó guardada/);
  ok("M03 corte antes de enviar: se comprobó que NO quedó guardada; lo escrito sigue", visto && guardados(M, n0).length === 0 && M.cots.get("c-7").version === 5 && (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipio (no salió)");
  visto = await guardarViendo(p, /Cotización guardada/);
  ok("M04 reintento: guardada exactamente una vez", visto && guardados(M, n0).length === 1 && M.cots.get("c-7").version === 6);
  // 4. Sin conexión.
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipio (sin conexión)"); await espera(p, 700); n0 = M.rpc.length;
  A.sinConexion = true; visto = await guardarViendo(p, /No se guardó/);
  ok("M05 sin conexión: no se guarda, se informa, lo escrito queda en pantalla y en la copia local", visto && guardados(M, n0).length === 0 && M.cots.get("c-7").version === 6 && (await borradores(p)).some((b) => b.usuario === "u1" && b.cotId === "c-7" && b.inst === "Municipio (sin conexión)" && b.base), await borradores(p));
  A.sinConexion = false; visto = await guardarViendo(p, /Cotización guardada/);
  ok("M06 al volver la conexión: guardada exactamente una vez", visto && guardados(M, n0).length === 1 && M.cots.get("c-7").version === 7);

  // 5. EETT: registro de la generación con sesión vencida y con respuesta incierta.
  await tab(p, "eett"); A.vencerAhora(); r0 = A.renovaciones();
  let nombre = await descarga(p, () => H(p).locator("[data-generar-eett]").click()); await espera(p, 1500);
  ok("M07 EETT con sesión vencida: descargada y registrada UNA vez (una renovación)", /\.pdf$/.test(nombre) && M.eett.length === 1 && A.renovaciones() === r0 + 1, { nombre, n: M.eett.length });
  A.cortes.push({ patron: /^POST .*\/rpc\/cz_registrar_eett/, modo: "despues", veces: 1 });
  nombre = await descarga(p, () => H(p).locator("[data-generar-eett]").click()); await espera(p, 2000);
  ok("M08 EETT con respuesta incierta al registrar: se comprobó; quedó UN registro más (no se repitió)", M.eett.length === 2 && M.rpc.filter((r) => /registrar_eett/.test(r.fn)).length === 2 && !/no se pudo registrar/.test(await cuerpo(p)), { n: M.eett.length, t: (await cuerpo(p)).slice(-200) });

  // 6. Cotización NUEVA con respuesta incierta: no se duplica.
  await H(p).locator("[data-cerrar-hoja]").first().click(); await espera(p, 600);
  await p.locator("[data-nueva-cotizacion]").click(); await espera(p, 800);
  await llenar(H(p).locator('[data-campo="institucion"]'), "Municipalidad de Laja"); await llenar(H(p).locator('[data-campo="direccion"]'), "Balmaceda 292"); await llenar(H(p).locator('[data-campo="comuna"]'), "Laja");
  await tab(p, "productos"); await H(p).locator("[data-ingreso-manual]").click(); await espera(p);
  const f = p.locator("[data-editor-ficha]");
  await llenar(f.locator('[data-campo="nombre"]'), "TALADRO PERCUTOR 750W"); await llenar(f.locator('[data-campo="especificaciones"]'), "Potencia: 750 W\nMandril: 13 mm");
  await f.locator('input[type="file"]').setInputFiles(LOGO); await espera(p, 900);
  await llenar(f.locator('[data-campo="enlace"]'), "https://www.sodimac.cl/sodimac-cl/product/123/taladro"); await llenar(f.locator('[data-campo="proveedor"]'), "Sodimac");
  await llenar(f.locator('[data-campo="cantidad"]'), 3); await llenar(f.locator('[data-campo="precio"]'), 45990); await f.locator('[data-campo="monto-despacho"]').fill("5990");
  await f.locator("[data-guardar-ficha]").click(); await espera(p, 700);
  const c0 = M.cots.size; n0 = M.rpc.length;
  A.cortes.push({ patron: /^POST .*\/rpc\/cz_guardar_cotizacion/, modo: "despues", veces: 1 });
  visto = await guardarViendo(p, /Cotización guardada/);
  ok("M09 cotización nueva con respuesta incierta: se comprobó que quedó creada; UNA sola", visto && M.cots.size === c0 + 1 && guardados(M, n0).length === 1, { n: M.cots.size - c0, g: guardados(M, n0).length });
  await tab(p, "datos"); await llenar(H(p).locator('[data-campo="comuna"]'), "Laja, Biobío"); visto = await guardarViendo(p, /Cotización guardada/);
  ok("M10 seguir guardando actualiza la misma (no crea otra)", visto && M.cots.size === c0 + 1 && guardados(M, n0).length === 2 && guardados(M, n0)[1].b.p.id === [...M.cots.keys()].pop());

  // 7. Fallo de renovación: aviso, cambios conservados, reingreso con la misma cuenta.
  await tab(p, "datos"); await llenar(H(p).locator('[data-campo="institucion"]'), "Municipalidad de Laja (pendiente)"); await espera(p, 800);
  A.fallar = "rechazo"; A.vencerAhora(); n0 = M.rpc.length;
  await H(p).locator("[data-guardar-cotizacion]").click(); await p.locator("[data-aviso-sesion]").first().waitFor({ timeout: 10000 }).catch(() => {}); await espera(p, 800);
  ok("M11 renovación rechazada: aviso para volver a ingresar; nada guardado; lo escrito sigue en pantalla y en la copia local", (await p.locator('[data-aviso-sesion="franja"]').count()) === 1 && (await est(p)).estado === "vencida" && guardados(M, n0).length === 0
    && (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipalidad de Laja (pendiente)" && (await borradores(p)).some((b) => b.usuario === "u1" && b.inst === "Municipalidad de Laja (pendiente)"), { e: await est(p), b: await borradores(p) });
  A.fallar = null;
  await p.locator("[data-reingresar]").click(); const vent = p.locator('[data-aviso-sesion="ventana"]'); await vent.waitFor();
  await vent.locator("[data-clave-reingreso]").fill("otra-clave"); await vent.locator("[data-confirmar-reingreso]").click(); await espera(p, 900);
  ok("M12 contraseña incorrecta: sigue pidiendo ingresar", await vent.isVisible() && (await est(p)).estado === "vencida");
  await vent.locator("[data-clave-reingreso]").fill("clave-correcta"); await vent.locator("[data-confirmar-reingreso]").click(); await espera(p, 1500);
  ok("M13 reingreso con la misma cuenta: aviso cerrado, sesión vigente, editor intacto", !(await p.locator("[data-aviso-sesion]").count()) && (await est(p)).estado === "vigente" && (await H(p).locator('[data-campo="institucion"]').inputValue()) === "Municipalidad de Laja (pendiente)");
  visto = await guardarViendo(p, /Cotización guardada/);
  ok("M14 guardar tras reingresar: exactamente una vez", visto && guardados(M, n0).length === 1 && [...M.cots.values()].pop().institucion === "Municipalidad de Laja (pendiente)");
  ok("M15 ningún refresh token reutilizado y sin errores de página", A.renovaciones("reuso") === 0 && !errs.length, errs.join(" | "));
  await ctx.close();
} catch (e) { F.push("EXCEPCIÓN: " + e.message.split("\n")[0]); console.log("EXCEPCIÓN", e.stack); }
finally { await browser.close(); }
console.log(`RESUMEN e2e_sesion_mp: ${nOk} OK, ${F.length} fallas${F.length ? " · " + F.join(" | ") : ""}`);
process.exit(F.length ? 1 : 0);
