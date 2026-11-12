// «Servidor» de la demostración: vive DENTRO de la página. Ninguna solicitud de datos sale a la red y no existe conexión con
// Supabase ni con la base de producción (la dirección de la base se reemplaza al compilar por ORIGEN_BD, un dominio que no existe).
//   · Mercado Público, finanzas y el resto de BFK → el simulador con estado de las pruebas (docs/pruebas-oc/mock_estado.mjs).
//   · Ventas privadas, Proyectos, Cotizaciones, perfiles y catálogos → PostgreSQL real compilado para el navegador (PGlite), con las
//     mismas migraciones, funciones, permisos (RLS) y datos ficticios de las pruebas, atendido por pgrest_nucleo.mjs.
//   · Sesión, depósito de archivos y funciones /api/* → respuestas locales.
// Los cambios se guardan solo en la memoria de la pestaña: al recargar, la demostración vuelve a su estado inicial.
import { PGlite } from "@electric-sql/pglite";
import urlMotor from "./node_modules/@electric-sql/pglite/dist/pglite.wasm?url";
import urlArchivos from "./node_modules/@electric-sql/pglite/dist/pglite.data?url";
import urlInitdb from "./node_modules/@electric-sql/pglite/dist/initdb.wasm?url";
import sqlBase from "./generado/base.sql?raw";   // dentro del código: el alojamiento no sirve archivos .sql
import { crearBase } from "../pruebas-oc/mock_estado.mjs";
import { atender } from "../pruebas-ventas-privadas/financiamiento/pgrest_nucleo.mjs";
import { crearDatosDemo, RESPUESTAS_MP_DEMO, ADMIN } from "./datos_mp.mjs";

export const ORIGEN_BD = "https://base-demo.invalid";
const red = window.fetch.bind(window);          // únicamente para los archivos propios de la demostración (mismo origen)
export const estado = { fase: "Preparando la demostración…", pgError: null, datos: 0, bloqueadas: [], avisos: [] };
const avisar = (t) => { estado.avisos.push(t); window.dispatchEvent(new CustomEvent("bfk-demo-aviso", { detail: t })); };
const fase = (t) => { estado.fase = t; window.dispatchEvent(new CustomEvent("bfk-demo-fase", { detail: t })); };

// ── Usuario de la demostración ──
const usuario = (id = ADMIN) => ({ id, email: "demo@bfk.invalid", app_metadata: { provider: "email" }, user_metadata: { nombre: "Administrador Demo" } });
export const sesionDemo = () => ({ access_token: "demo", refresh_token: "demo", token_type: "bearer", expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: usuario() });

// ── Base PostgreSQL en el navegador (Ventas privadas, Proyectos, Cotizaciones) ──
const binario = async (url) => { const r = await red(url); if (!r.ok) throw new Error(`No se pudo leer ${url} (${r.status})`); return r.arrayBuffer(); };
async function iniciarPG() {
  fase("Cargando la base de la demostración…");
  const [motor, initdb, archivos] = await Promise.all([binario(urlMotor), binario(urlInitdb), binario(urlArchivos)]); const sql = sqlBase;
  fase("Iniciando la base de la demostración…");
  const pg = await PGlite.create({ pgliteWasmModule: await WebAssembly.compile(motor), initdbWasmModule: await WebAssembly.compile(initdb), fsBundle: new Blob([archivos]) });
  fase("Cargando datos ficticios…");
  await pg.exec(sql);
  await pg.exec("reset all");
  return pg;
}
const sql1 = async (pg, texto, vals) => (await pg.query(texto, vals)).rows;

// ── Simulador de Mercado Público, con los catálogos alineados con la base ──
async function crearMP(pg) {
  const d = crearDatosDemo();
  if (pg) {
    // Vendedores y financiadores: una sola lista para toda la app (la de la base; Ventas privadas la lee de ahí).
    const vend = await sql1(pg, "select * from public.vendedores order by nombre"); const fin = await sql1(pg, "select * from public.financiadores order by nombre");
    const porNombre = (lista, n, i) => (lista.find((x) => x.nombre === n) || lista[i]);
    if (vend.length >= 2) { const m = { v1: porNombre(vend, "Daniela Fuentes", 0).id, v2: porNombre(vend, "Rodrigo Pino", 1).id }; d.vendedores = vend.map((v) => ({ comision_pct: 10, ...v }));
      for (const o of d.ordenes_compra_v2) if (o.vendedor_id) o.vendedor_id = m[o.vendedor_id] || o.vendedor_id;
      for (const p of d.perfiles) if (p.vendedor_id) p.vendedor_id = m[p.vendedor_id] || p.vendedor_id; }
    const externo = fin.find((f) => f.nombre === "Inversiones Los Coihues SpA") || fin.find((f) => f.tipo !== "propio"), propio = fin.find((f) => f.tipo === "propio");
    if (externo && propio) { const m = { f1: externo.id, f2: propio.id };
      d.financiadores = fin.map((f) => ({ ...f, saldo_deuda: f.id === externo.id ? 2500000 : 0 }));
      for (const t of ["ordenes_compra_v2", "eventos_compra", "eventos_pago_financiamiento"]) for (const x of d[t]) if (x.financiador_id) x.financiador_id = m[x.financiador_id] || x.financiador_id; }
    d.perfiles = await sql1(pg, "select * from public.perfiles");
  }
  return crearBase(d, { mp: RESPUESTAS_MP_DEMO });
}

let pg = null; let mp = null;
export const listo = (async () => {
  try { pg = await iniciarPG(); }
  catch (e) { estado.pgError = String(e?.message || e); console.error("[demo] base no disponible:", e);
    avisar("Este dispositivo no pudo iniciar la base de Ventas privadas, Proyectos y Cotizaciones. Mercado Público y Finanzas funcionan igual."); }
  mp = await crearMP(pg);
  fase("");
})();

// ── Qué atiende la base y qué el simulador (misma división que los arneses de pruebas, más Cotizaciones) ──
const enBase = (obj, busqueda) => /^(rpc\/)?(vp_|pi_|cz_)/.test(obj) || ["perfiles", "productos_catalogo"].includes(obj)
  || (obj === "gastos_indirectos" && /select=id(%2C|,)fecha(%2C|,)monto(%2C|,)descripcion/.test(busqueda))
  || (["vendedores", "financiadores"].includes(obj) && /order=nombre\.asc/.test(busqueda));

const json = (status, cuerpo, extra = {}) => new Response(status === 204 || status === 205 || cuerpo === undefined ? null : JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json; charset=utf-8", ...extra } });
const SIN_BASE = (obj) => json(404, { code: "PGRST205", details: null, hint: null, message: `Could not find the table 'public.${obj}' in the schema cache` });

async function enTransaccion(fn) {
  return pg.transaction(async (tx) => { const r = await fn({ query: (s, v) => tx.query(s, v) }); if (r && r.status >= 400) await tx.rollback(); return r; });
}
async function pedirBase(metodo, obj, u, cuerpo, prefer) {
  if (!pg) return SIN_BASE(obj);
  const claims = { sub: ADMIN, role: "authenticated", email: "demo@bfk.invalid" };
  const r = await enTransaccion((cli) => atender(cli, { metodo, ruta: obj, params: [...u.searchParams], cuerpo, prefer, rol: "authenticated", claims }));
  const extra = {};
  if (metodo === "GET" && /count=exact/.test(prefer) && r.status < 400) {
    // Total para la paginación (PostgREST lo informa en Content-Range): misma consulta sin límite ni orden.
    const p = new URLSearchParams(u.searchParams); for (const k of ["limit", "offset", "order"]) p.delete(k); p.set("select", "id");
    const t = await enTransaccion((cli) => atender(cli, { metodo: "GET", ruta: obj, params: [...p], cuerpo: null, prefer: "", rol: "authenticated", claims }));
    const n = Array.isArray(t.json) ? t.json.length : 0; const desde = Number(u.searchParams.get("offset") || 0); const filas = Array.isArray(r.json) ? r.json.length : 0;
    extra["content-range"] = `${filas ? `${desde}-${desde + filas - 1}` : "*"}/${n}`;
  }
  return json(r.status, r.json, extra);
}

// ── Depósito de archivos: el contenido queda en memoria; el registro, en storage.objects con los permisos reales ──
const archivos = new Map();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
async function deposito(metodo, u, cuerpo, tipo) {
  const m = /^\/storage\/v1\/object\/(authenticated\/|public\/|sign\/)?([^/]+)\/(.+)$/.exec(u.pathname);
  if (!m) return json(400, { message: "operación no permitida en el depósito" });
  const bucket = m[2]; const ruta = m[3].split("/").map(decodeURIComponent).join("/"); const clave = bucket + "/" + ruta;
  if (metodo === "POST" || metodo === "PUT") {
    if (archivos.has(clave) && metodo === "POST") return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
    const datos = cuerpo instanceof Blob ? cuerpo : new Blob([cuerpo ?? ""], { type: tipo || "application/octet-stream" });
    if (pg && /^(vp-documentos|pi-documentos|cz-productos)$/.test(bucket)) {
      const r = await enTransaccion(async (cli) => { try {
        await cli.query("set local role authenticated"); await cli.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [JSON.stringify({ sub: ADMIN, role: "authenticated" }), ADMIN]);
        await cli.query(`insert into storage.objects (bucket_id, name, owner, metadata) values (${lit(bucket)}, ${lit(ruta)}, ${lit(ADMIN)}::uuid, jsonb_build_object('size', ${Number(datos.size) || 0}))`);
        return { status: 200 }; } catch (e) { return { status: 400, error: e }; } });
      if (r.status >= 400) return json(400, { statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" });
    }
    archivos.set(clave, datos);
    return json(200, { Key: clave, Id: clave });
  }
  if (metodo === "GET") { const a = archivos.get(clave); if (!a) return json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    const t = /\.jpe?g$/i.test(ruta) ? "image/jpeg" : /\.png$/i.test(ruta) ? "image/png" : /\.pdf$/i.test(ruta) ? "application/pdf" : a.type || "application/octet-stream";
    return new Response(a, { status: 200, headers: { "content-type": t } }); }
  if (metodo === "DELETE") { archivos.delete(clave); return json(200, []); }
  return json(400, { message: "operación no permitida en el depósito" });
}

async function cuerpoDe(entrada, opciones) {
  let c = opciones?.body; if (c === undefined && entrada instanceof Request) { try { c = await entrada.clone().blob(); } catch { c = null; } }
  return c ?? null;
}
const textoDe = async (c) => (c == null ? null : typeof c === "string" ? c : c instanceof Blob ? c.text() : c instanceof ArrayBuffer || ArrayBuffer.isView(c) ? new TextDecoder().decode(c) : String(c));
const jsonDe = (t) => { try { return JSON.parse(t || "null"); } catch { return null; } };

// ── Reemplazo de fetch: todo lo que la app pide a su servidor se responde aquí ──
export async function atenderSolicitud(entrada, opciones = {}) {
  const u = new URL(entrada instanceof Request ? entrada.url : String(entrada), location.href);
  const metodo = String(opciones.method || (entrada instanceof Request ? entrada.method : "GET")).toUpperCase();
  const esBase = u.origin === ORIGEN_BD; const esApi = u.origin === location.origin && u.pathname.startsWith("/api/");
  if (!esBase && !esApi) {
    if (u.origin === location.origin || u.protocol === "data:" || u.protocol === "blob:") return red(entrada, opciones);   // archivos de la propia demostración
    estado.bloqueadas.push(u.origin + u.pathname); throw new TypeError("Demostración sin conexión: no se consulta ningún servidor externo");
  }
  estado.datos++;
  await listo;
  const cab = new Headers(opciones.headers || (entrada instanceof Request ? entrada.headers : undefined)); const prefer = cab.get("prefer") || "";
  const cuerpo = await cuerpoDe(entrada, opciones);
  try {
    if (esApi) {
      if (u.pathname.startsWith("/api/oc")) { const r = mp.respuestaMP(u); return json(r.status, r.body); }
      return json(503, { ok: false, error: "Esta función usa servicios externos y no está disponible en la demostración." });
    }
    if (u.pathname.startsWith("/auth/v1/")) {
      if (u.pathname.includes("/logout")) return json(204);
      if (u.pathname.includes("/user")) return json(200, usuario());
      if (u.pathname.includes("/recover")) return json(200, {});
      return json(200, sesionDemo());   // ingreso (cualquier correo y clave) y renovación
    }
    if (u.pathname.startsWith("/storage/v1/")) return await deposito(metodo, u, cuerpo, cab.get("content-type"));
    if (!u.pathname.startsWith("/rest/v1/")) return json(404, { message: "No disponible en la demostración" });
    const obj = decodeURIComponent(u.pathname.replace(/^\/rest\/v1\//, "")); const texto = await textoDe(cuerpo);
    // Sin la base (dispositivo que no permite WebAssembly): perfiles y catálogos los da el simulador, para que Mercado Público
    // y Finanzas sigan funcionando; Ventas privadas, Proyectos y Cotizaciones responden «no disponible».
    if (enBase(obj, u.search) && (pg || /^(rpc\/)?(vp_|pi_|cz_)/.test(obj))) return await pedirBase(metodo, obj, u, texto, prefer);
    const datos = jsonDe(texto);
    if (obj.startsWith("rpc/")) { const r = mp.rpc(obj.slice(4), datos || {}, ADMIN); return json(r.status, r.json); }
    if (metodo === "GET" || metodo === "HEAD") return json(200, mp.leer(obj, u.searchParams));
    const r = mp.escribir(metodo, obj, u.searchParams, datos, ADMIN);
    return json(/return=minimal/.test(prefer) && r.status < 300 ? (metodo === "POST" ? 201 : 204) : r.status, /return=minimal/.test(prefer) && r.status < 300 ? undefined : r.json);
  } catch (e) {
    console.error("[demo]", metodo, u.pathname, e);
    return json(500, { code: "DEMO", message: "Error interno de la demostración: " + (e?.message || e) });
  }
}

// Para las pruebas automáticas de la demostración.
export const depurar = { get pg() { return pg; }, get mp() { return mp; }, archivos };
