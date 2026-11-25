// Pruebas de BORRADOR-2026-11-25-documentos-oferta.sql (y su recuperación) contra una base DESECHABLE local (nunca producción).
// Uso: eval "$(bash docs/pruebas-ventas-privadas/entorno.sh instalar)"; node docs/pruebas-documentos/sql_documentos.test.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";

const DB = process.env.VP_DB_URL;
if (!DB) { console.error("Falta VP_DB_URL (entorno.sh instalar)"); process.exit(2); }
const MIG = path.resolve("docs/migraciones");
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333", extrano: randomUUID() };
let ok = 0, fallas = 0;
const check = (c, n, det = "") => { if (c) { ok++; console.log("OK   ", n); } else { fallas++; console.log("FALLA:", n, det); } };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const psqlEn = (url, sql, extra = []) => { try { return { out: execFileSync("psql", [url, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", ...extra], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; } catch (e) { return { err: String(e.stderr || e.message), code: e.status }; } };
const owner = DB.replace("postgres@", "bfk_owner@");
const archivo = (f, extra = []) => psqlEn(owner, "", [...extra, "-f", `${MIG}/${f}`]);
const prefijo = (u) => `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n`;
const como = (u, sql) => psqlEn(DB, prefijo(u) + sql);
const rpc = (u, fn, ...a) => como(u, `select public.${fn}(${a.join(", ")});`);
const rpcJ = (u, fn, ...a) => { const r = rpc(u, fn, ...a); if (r.err) throw new Error(`${fn}: ${r.err}`); return JSON.parse(r.out); };
const root = (sql) => { const r = psqlEn(DB, sql); if (r.err) throw new Error(r.err); return r.out; };
const falla = (r, patron, n) => check(!!r.err && new RegExp(patron).test(r.err), n, r.err ? r.err.split("\n").find((l) => /ERROR/.test(l)) : `sin error (${r.out})`);
const H = (c) => c.repeat(64);
const emitir = (u, canal, cot, tipo, version, huellaC, huellaM = huellaC) => rpc(u, "oferta_emitir_documento", `'${canal}'`, `'${cot}'`, `'${tipo}'`, String(version),
  j({ version, referencia: "X", items: [] }), "'oferta-1'", `'${huellaC}'`, `'${huellaM}'`, `'${H("f")}'`, "2", `'${tipo.toUpperCase()}_X_v${version}.pdf'`);

try {
  // ── 0. Datos previos: una cotización de Mercado Público y una privada (responsable: ana) ──
  root(`insert into public.perfiles (id, nombre, rol) values ('${U.beto}', 'Beto Prueba', 'usuario') on conflict (id) do nothing;`);
  const cotMP = root(`insert into public.cotizaciones (id_externo, nombre, institucion, creado_por) values ('1540-1372-COT26', 'Prueba', 'Municipalidad', '${U.ana}') returning id;`);
  const cli = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "76086428-5", razon_social: "Maderas del Sur SpA", tipo_persona: "empresa", giro: "Aserradero" }));
  const cotVP = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, items: [{ tipo: "producto", descripcion: "Silla", unidad: "UN", cantidad: 1, precio_unitario: 1000 }] })).id;
  const huella = () => root(`select md5(string_agg(t, '|' order by t)) from (select table_name::text || ':' || column_name::text t from information_schema.columns where table_schema = 'public' and table_name not like 'oferta_%') x;`);
  const antes = huella();
  const datosAntes = root(`select md5(coalesce((select string_agg(to_jsonb(c)::text, ',' order by id) from public.cotizaciones c), '') || coalesce((select string_agg(to_jsonb(v)::text, ',' order by id) from public.vp_cotizaciones v), ''));`);

  // ── 1. Migración ──
  const m = archivo("BORRADOR-2026-11-25-documentos-oferta.sql");
  check(!m.err, "1.1 migración aplicada en una transacción", m.err);
  check(huella() === antes, "1.2 ninguna tabla existente cambia (columnas idénticas)");
  check(root(`select md5(coalesce((select string_agg(to_jsonb(c)::text, ',' order by id) from public.cotizaciones c), '') || coalesce((select string_agg(to_jsonb(v)::text, ',' order by id) from public.vp_cotizaciones v), ''));`) === datosAntes, "1.3 datos existentes idénticos");
  falla(archivo("BORRADOR-2026-11-25-documentos-oferta.sql"), "ya está aplicada", "1.4 no se aplica dos veces");
  check(root("select count(*) from public.oferta_documentos") === "0" && root("select count(*) from public.oferta_condiciones") === "0", "1.5 tablas nuevas vacías (sin datos inventados)");

  // ── 2. Permisos ──
  falla(psqlEn(DB, "set role anon;\nselect count(*) from public.oferta_documentos;"), "permission denied", "2.1 anónimo no lee");
  falla(psqlEn(DB, `set role anon;\nselect public.oferta_guardar_condiciones('mp', '${cotMP}', '{}', '[]');`), "permission denied", "2.2 anónimo no ejecuta");
  falla(rpc(U.extrano, "oferta_guardar_condiciones", "'mp'", `'${cotMP}'`, "'{}'", "'[]'"), "OFERTA_PERMISO", "2.3 sin perfil BFK no guarda condiciones de Mercado Público");
  check(!rpc(U.beto, "oferta_guardar_condiciones", "'mp'", `'${cotMP}'`, j({ garantia: "12 meses" }), j([{ item: 1, requisito: "43 pulgadas", ofertado: "43 pulgadas", estado: "cumple" }])).err, "2.4 usuario BFK guarda condiciones y matriz de Mercado Público");
  falla(rpc(U.beto, "oferta_guardar_condiciones", "'vp'", `'${cotVP}'`, "'{}'", "'[]'"), "OFERTA_PERMISO", "2.5 quien no es responsable no toca la cotización privada");
  check(!rpc(U.ana, "oferta_guardar_condiciones", "'vp'", `'${cotVP}'`, j({ despacho: "Incluido" }), "'[]'").err, "2.6 la responsable guarda condiciones de su cotización privada");
  check(como(U.beto, `select count(*) from public.oferta_condiciones where canal = 'vp';`).out === "0" && como(U.ana, `select count(*) from public.oferta_condiciones where canal = 'vp';`).out === "1", "2.7 lectura de condiciones privadas solo para su responsable");
  falla(rpc(U.beto, "oferta_guardar_condiciones", "'mp'", `'${cotMP}'`, "'{}'", j([{ requisito: "x", estado: "seguro" }])), "OFERTA_FORMATO", "2.8 estado de cumplimiento no válido rechazado");
  falla(como(U.beto, `insert into public.oferta_documentos (canal, cotizacion_id, tipo, version, modelo, generador, huella_contenido, huella_modelo, huella_pdf, paginas, nombre_archivo) values ('mp', '${cotMP}', 'eett', 9, '{}', 'x', '${H("a")}', '${H("a")}', '${H("a")}', 1, 'x');`), "permission denied", "2.9 sin escritura directa en el historial");

  // ── 3. Emisión y versiones ──
  const e1 = JSON.parse(emitir(U.beto, "mp", cotMP, "cotizacion", 1, H("1")).out || "{}");
  check(e1.version === 1 && e1.existente === false, "3.1 primera emisión: versión 1", JSON.stringify(e1));
  check(JSON.parse(emitir(U.beto, "mp", cotMP, "eett", 1, H("1")).out || "{}").version === 1, "3.2 misma información, otro documento: conserva la versión 1");
  falla(emitir(U.beto, "mp", cotMP, "oferta", 2, H("1")), "OFERTA_VERSION", "3.3 versión que no corresponde a la información: rechazada");
  check(JSON.parse(emitir(U.beto, "mp", cotMP, "cotizacion", 1, H("1")).out || "{}").existente === true, "3.4 repetir la misma emisión devuelve la existente (no duplica)");
  falla(emitir(U.beto, "mp", cotMP, "cotizacion", 1, H("1"), H("9")), "OFERTA_VERSION", "3.5 otro contenido no puede ocupar una versión emitida");
  falla(emitir(U.beto, "mp", cotMP, "cotizacion", 1, H("2")), "OFERTA_VERSION", "3.6 información modificada exige la versión siguiente");
  check(JSON.parse(emitir(U.beto, "mp", cotMP, "cotizacion", 2, H("2")).out || "{}").version === 2, "3.7 información modificada: versión 2");
  check(root(`select count(*) from public.oferta_documentos where canal = 'mp'`) === "3" && root(`select count(*) from public.oferta_documentos where canal = 'mp' and emitido_por = '${U.beto}' and emitido_por_nombre is not null`) === "3", "3.8 historial con quién emitió");
  falla(rpc(U.extrano, "oferta_emitir_documento", "'mp'", `'${cotMP}'`, "'eett'", "3", j({ version: 3 }), "'oferta-1'", `'${H("3")}'`, `'${H("3")}'`, `'${H("3")}'`, "1", "'x'"), "OFERTA_PERMISO", "3.9 sin perfil no emite");
  falla(emitir(U.beto, "vp", cotVP, "cotizacion", 1, H("4")), "OFERTA_PERMISO", "3.10 no responsable no emite documentos privados");
  check(JSON.parse(emitir(U.ana, "vp", cotVP, "oferta", 1, H("4")).out || "{}").version === 1, "3.11 la responsable emite su oferta privada (versión propia de esa cotización)");
  falla(como(U.beto, `update public.oferta_documentos set nombre_archivo = 'x';`), "permission denied", "3.12 documentos emitidos inalterables (sin UPDATE)");
  falla(como(U.beto, `delete from public.oferta_documentos;`), "permission denied", "3.13 documentos emitidos no se borran (sin DELETE)");
  falla(rpc(U.beto, "oferta_emitir_documento", "'mp'", `'${cotMP}'`, "'eett'", "3", j({ version: 4 }), "'oferta-1'", `'${H("5")}'`, `'${H("5")}'`, `'${H("5")}'`, "1", "'x'"), "OFERTA_FORMATO", "3.14 el modelo debe declarar la misma versión");

  // ── 4. Recuperación ──
  const d1 = archivo("BORRADOR-2026-11-25-documentos-oferta-deshacer.sql");
  check(!!d1.err && /no se deshace/.test(d1.err) && root("select to_regclass('public.oferta_documentos') is not null") === "t", "4.1 con documentos emitidos, deshacer se detiene sin -v forzar=1", d1.err);
  const d2 = archivo("BORRADOR-2026-11-25-documentos-oferta-deshacer.sql", ["-v", "forzar=1"]);
  check(!d2.err && root("select to_regclass('public.oferta_documentos') is null and to_regprocedure('public.oferta_puede(text,uuid)') is null") === "t", "4.2 con forzar=1 se quita todo lo nuevo", d2.err);
  check(huella() === antes, "4.3 tras deshacer, el esquema existente queda idéntico");
  check(!archivo("BORRADOR-2026-11-25-documentos-oferta.sql").err, "4.4 se puede volver a aplicar");
} catch (e) { fallas++; console.log("FALLA (excepción):", e.message); }

console.log(`\nRESUMEN sql_documentos: ${ok} OK, ${fallas} FALLA(S)`);
process.exit(fallas ? 1 : 0);
