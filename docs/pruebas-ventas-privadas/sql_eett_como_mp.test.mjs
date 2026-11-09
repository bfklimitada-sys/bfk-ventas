// Pruebas de BORRADOR-2026-11-09-vp-eett-como-mp.sql (y su recuperación) contra bases DESECHABLES locales (nunca producción).
//   A. Base como está en producción el 09/11 (migraciones del 06/11 y del 08/11) CON datos: la cotización CP-2026-0001 copiada
//      de producción (solo datos técnicos, fixture_cp_2026_0001.json) con su borrador ET-2026-0001 armado por la ventana
//      anterior, y otra cotización con una EETT emitida (formato anterior) vinculada a su venta → se aplica la migración →
//      ningún dato cambia y solo cambia vp_emitir_eett.
//   B. Con la versión nueva: el contenido del recorrido de Mercado Público (formato «mp», sin objeto ni requisitos) se emite
//      completando el borrador existente (mismo folio y revisión); se mantienen las demás reglas (ítems de la revisión con su
//      numeración/cantidad/unidad, sin datos comerciales, sin «No informado») y se exige el nombre del producto; el formato
//      anterior sigue exigiendo el objeto; las revisiones y el vínculo con la venta funcionan como antes.
//   C. Recuperación: restituye la función exacta del 07/11 sin tocar las EETT emitidas con el formato nuevo; se puede volver a
//      aplicar.
// Uso: VP_PLANTILLA_URL=postgresql://postgres@127.0.0.1:5499/bfk_vp_plantilla node docs/pruebas-ventas-privadas/sql_eett_como_mp.test.mjs
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { contenidoEETTVP } from "../../src/lib/vpEETT.js";
import { itemEETTDesde } from "../../src/lib/ventasPrivadas.js";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PLANTILLA = process.env.VP_PLANTILLA_URL || "postgresql://postgres@127.0.0.1:5499/bfk_vp_plantilla";
const SERVIDOR = PLANTILLA.replace(/\/[^/]+$/, "");
const NOMBRE_PLANTILLA = PLANTILLA.split("/").pop();
const MIG = resolve(AQUI, "../migraciones");
const FX = JSON.parse(readFileSync(resolve(AQUI, "fixture_cp_2026_0001.json"), "utf8"));
const U = { admin: "11111111-1111-1111-1111-111111111111", ana: "22222222-2222-2222-2222-222222222222", beto: "33333333-3333-3333-3333-333333333333" };
let ok = 0, fallas = 0;
const check = (c, n, det = "") => { if (c) { ok++; console.log("OK   ", n); } else { fallas++; console.log("FALLA:", n, det); } };
const lit = (s) => { const t = "q" + Math.random().toString(36).slice(2, 8); return `$${t}$${s}$${t}$`; };
const j = (o) => `${lit(JSON.stringify(o))}::jsonb`;
const psqlEn = (db, sql, extra = []) => { try { return { out: execFileSync("psql", [`${SERVIDOR}/${db}`, "-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", ...extra], { input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim() }; } catch (e) { return { err: String(e.stderr || e.message).trim() }; } };
const archivo = (db, f, extra = []) => { try { return { out: execFileSync("psql", [`${SERVIDOR.replace("postgres@", "bfk_owner@")}/${db}`, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...extra, "-f", `${MIG}/${f}`], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) }; } catch (e) { return { err: String(e.stderr || e.message).trim() }; } };
const nuevaBase = (db) => { psqlEn("postgres", `drop database if exists ${db} with (force);`); const r = psqlEn("postgres", `create database ${db} template ${NOMBRE_PLANTILLA};`); if (r.err) throw new Error(r.err); };
const prefijo = (u) => `set role authenticated;\nselect set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: u, role: "authenticated" }))}, false) \\g /dev/null\n`;
let DB = "";
const como = (u, sql) => psqlEn(DB, prefijo(u) + sql);
const valor = (u, sql) => { const r = como(u, sql); if (r.err) throw new Error(r.err); return r.out; };
const rpc = (u, fn, ...a) => como(u, `select public.${fn}(${a.join(", ")});`);
const rpcJ = (u, fn, ...a) => { const r = rpc(u, fn, ...a); if (r.err) throw new Error(`${fn}: ${r.err}`); return JSON.parse(r.out); };
const root = (sql) => { const r = psqlEn(DB, sql); if (r.err) throw new Error(r.err); return r.out; };
// jsonb ordena las claves: se compara en forma canónica (claves ordenadas).
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const falla = (r, patron, n) => check(!!r.err && new RegExp(patron).test(r.err), n, r.err ? r.err.split("\n")[0] : `sin error (${r.out})`);
const huellaEmitir = () => root("select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname='vp_emitir_eett';");
const ORIGINAL = "c5710ab071ea0f70b4d75d655b723be4", NUEVA = "4fcf22e7c4094015175f53c55a3afac6";
// Catálogo completo salvo vp_emitir_eett (para comprobar que la migración no cambia nada más).
const CATALOGO = "select md5(string_agg(t,'|' order by t)) from (select 'c:'||c.relname::text||c.relkind::text||coalesce(c.relacl::text,'') t from pg_class c where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) union all select 'a:'||attrelid::regclass::text||attname||atttypid::regtype::text||attnotnull from pg_attribute where attrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname like 'vp\\_%') and attnum > 0 and not attisdropped union all select 'k:'||conrelid::regclass::text||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace and conrelid::regclass::text like 'vp\\_%' union all select 'f:'||p.oid::regprocedure::text||md5(p.prosrc)||coalesce(p.proacl::text,'') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname <> 'vp_emitir_eett' union all select 'g:'||coalesce(p.proacl::text,'') from pg_proc p where p.pronamespace='public'::regnamespace and p.proname = 'vp_emitir_eett' union all select 'v:'||viewname||md5(definition) from pg_views where schemaname='public' union all select 'p:'||schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies) x";
// Foto de los datos: EETT (todas las columnas), vínculos de ventas, cotizaciones y líneas.
const FOTO = "select md5(string_agg(x, '|' order by x)) from (select 'e'||to_jsonb(e)::text x from public.vp_eett e union all select 'v'||id||coalesce(eett_id::text,'')||total||estado from public.vp_ventas union all select 'c'||to_jsonb(c)::text from public.vp_cotizaciones c union all select 'i'||to_jsonb(i)::text from public.vp_cotizacion_items i union all select 'r'||to_jsonb(r)::text from public.vp_cotizacion_revisiones r) y";

const ver = (cid) => String(Number(valor(U.ana, `select version from public.vp_cotizaciones where id='${cid}';`)));
const lineas = (rev) => JSON.parse(valor(U.ana, `select json_agg(to_jsonb(i) order by orden) from public.vp_cotizacion_items i where revision_id = '${rev}';`));
const contenidoMP = (cot, rev, ls, previo, extra = {}) => contenidoEETTVP({ cotizacion: { folio: cot.folio, revision: 0 }, cliente: FX.cliente, plazo_entrega: FX.rev.plazo_entrega, fecha: "2026-11-09",
  responsable: "Ana", elaborado_por: "Ana", items: ls, previo, ...extra });

try {
  // ═══ A. Migración sobre la base de producción del 09/11 con datos ════════════════════════════════════════════════════
  DB = "bfk_vpet_a"; nuevaBase(DB);
  check(!archivo(DB, "BORRADOR-2026-11-06-ventas-privadas.sql").err && !archivo(DB, "BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql").err, "A0 base como en producción el 09/11 (06/11 + 08/11)");
  check(huellaEmitir() === ORIGINAL, "A0b vp_emitir_eett con la huella del 07/11 que exige la migración");
  const cli = rpcJ(U.ana, "vp_guardar_cliente", j({ rut: "61513003-6", razon_social: FX.cliente.razon_social, tipo_persona: "empresa", direccion_entrega: "Santiago", comuna_entrega: "Santiago" }));
  // Copia aislada de CP-2026-0001: una línea con la ficha del «Bolso Paramédico Mediano 47L» tal como está en producción.
  const cot = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, plazo_entrega: FX.rev.plazo_entrega, vigencia_dias: 15,
    items: [{ tipo: "producto", descripcion: FX.item.descripcion, unidad: FX.item.unidad, cantidad: FX.item.cantidad, precio_unitario: 50000, ficha: FX.item.ficha, ficha_aprobada: false }] }));
  cot.folio = valor(U.ana, `select folio from public.vp_cotizaciones where id = '${cot.id}';`);
  const lin = lineas(cot.revision_id);
  // Borrador armado por la ventana anterior (mismo contenido que ET-2026-0001 en producción: objeto vacío, textos como características sin valor).
  const legado = { ...FX.eett.contenido, cotizacion: { folio: cot.folio, revision: 0 }, items: lin.map((l) => itemEETTDesde(l, null, null)) };
  const borr = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: cot.id, contenido: legado }));
  falla(rpc(U.ana, "vp_emitir_eett", `'${borr.id}'`, String(borr.version)), "falta el objeto del suministro", "A1 hoy el borrador de la captura no se puede emitir (pide «objeto del suministro»)");
  // Otra cotización con EETT emitida en el formato anterior y su venta (deben quedar intactas).
  const c2 = rpcJ(U.ana, "vp_guardar_cotizacion", j({ cliente_id: cli.id, vigencia_dias: 15, items: [{ tipo: "producto", descripcion: "Bomba", unidad: "UN", cantidad: 2, precio_unitario: 350000 }] }));
  rpcJ(U.ana, "vp_cotizacion_estado", `'${c2.id}'`, `'enviada'`, j({}), ver(c2.id)); rpcJ(U.ana, "vp_cotizacion_estado", `'${c2.id}'`, `'aceptada'`, j({}), ver(c2.id));
  const l2 = lineas(c2.revision_id);
  const e2 = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: c2.id, contenido: { objeto: "Suministro", items: [{ item_id: l2[0].id, orden: 1, cantidad: 2, unidad: "UN", nombre: "Bomba", caracteristicas: [{ caracteristica: "Potencia", valor: "2", unidad: "HP" }] }] } }));
  const em2 = rpcJ(U.ana, "vp_emitir_eett", `'${e2.id}'`, String(e2.version));
  const v2 = rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${c2.id}'`, `'${randomUUID()}'`, j({}));
  const foto0 = root(FOTO), cat0 = root(CATALOGO);
  const m = archivo(DB, "BORRADOR-2026-11-09-vp-eett-como-mp.sql");
  check(!m.err && huellaEmitir() === NUEVA, "A2 migración aplicada", m.err);
  check(root(FOTO) === foto0, "A3 ningún dato cambia (EETT emitidas y en borrador, ventas y vínculos, cotizaciones, líneas, revisiones)");
  check(root(CATALOGO) === cat0, "A4 solo cambia vp_emitir_eett (tablas, columnas, restricciones, demás funciones, vistas, políticas y permisos idénticos)");
  check(root("select proacl::text from pg_proc where proname = 'vp_emitir_eett';") === "{bfk_owner=X/bfk_owner,authenticated=X/bfk_owner}", "A5 mismos permisos de ejecución");
  falla(archivo(DB, "BORRADOR-2026-11-09-vp-eett-como-mp.sql"), "no es la versión del 07/11/2026", "A6 aplicarla dos veces se detiene sin cambios");

  // ═══ B. Comportamiento nuevo ══════════════════════════════════════════════════════════════════════════════════════════
  const verB = () => Number(valor(U.ana, `select version from public.vp_eett where id = '${borr.id}';`));
  falla(rpc(U.ana, "vp_emitir_eett", `'${borr.id}'`, String(verB())), "falta el objeto del suministro", "B1 el formato anterior (borrador sin «formato») sigue exigiendo el objeto");
  const cMP = contenidoMP(cot, cot.revision_id, lin, legado);
  check(!("objeto" in cMP) && cMP.items[0].caracteristicas.every((k) => k.valor.trim() && k.valor !== "No informado") && cMP.items[0].caracteristicas.length === 7, "B2 contenido del recorrido de Mercado Público: sin objeto y con 7 características con valor", JSON.stringify(cMP.items[0].caracteristicas.map((k) => k.caracteristica)));
  // Reglas que se mantienen (sobre una copia del contenido nuevo).
  const prueba = (cambio, patron, n) => {
    const g = rpcJ(U.ana, "vp_guardar_eett", j({ id: borr.id, version: verB(), cotizacion_id: cot.id, contenido: cambio(JSON.parse(JSON.stringify(cMP))) }));
    falla(rpc(U.ana, "vp_emitir_eett", `'${borr.id}'`, String(g.version)), patron, n);
  };
  prueba((c) => { c.items[0].nombre = " "; return c; }, "falta el nombre exacto del producto", "B3 sin nombre del producto no se emite (regla de Mercado Público)");
  prueba((c) => { c.items[0].caracteristicas[0].valor = "No informado"; return c; }, "No informado", "B4 una característica «No informado» sigue bloqueando");
  prueba((c) => { c.items[0].precio_unitario = 1; return c; }, "costos, márgenes o precios", "B5 un dato comercial sigue bloqueando");
  prueba((c) => { c.items[0].cantidad = 3; return c; }, "no coincide con la cotización", "B6 la cantidad debe coincidir con la cotización");
  prueba((c) => { c.items[0].requisitos = [{ requisito: "Impermeable", cumplimiento: "cumple" }]; return c; }, "sin respaldo", "B7 un cumplimiento sin respaldo sigue bloqueando");
  check(valor(U.ana, `select estado from public.vp_eett where id = '${borr.id}';`) === "borrador", "B8 los intentos rechazados no emiten nada");
  falla(rpc(U.beto, "vp_emitir_eett", `'${borr.id}'`, String(verB())), "VP_PERMISO", "B9 otro usuario no emite la EETT");
  const g = rpcJ(U.ana, "vp_guardar_eett", j({ id: borr.id, version: verB(), cotizacion_id: cot.id, contenido: cMP }));
  const em = rpcJ(U.ana, "vp_emitir_eett", `'${borr.id}'`, String(g.version));
  const fila = JSON.parse(valor(U.ana, `select to_jsonb(e) from public.vp_eett e where id = '${borr.id}';`));
  check(em.items === 1 && fila.estado === "emitida" && fila.folio === "ET-" + fila.folio.slice(3) && fila.revision === 0 && fila.contenido.formato === "mp" && /^[0-9a-f]{64}$/.test(fila.hash),
    "B10 el borrador existente se completa y se emite con su mismo folio y revisión (Rev. 0), formato «mp» y huella", JSON.stringify({ e: fila.estado, f: fila.folio, r: fila.revision }));
  check(canon(fila.contenido) === canon(cMP) && fila.contenido.items[0].descripcion === cMP.items[0].descripcion, "B11 lo emitido es exactamente el contenido generado (descripción y características del bolso)");
  // Una nueva generación con cambios (revisión nueva de la cotización) emite Rev. 1 y conserva la anterior como reemplazada.
  rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, `'enviada'`, j({}), ver(cot.id));
  const r1 = rpcJ(U.ana, "vp_cotizacion_nueva_revision", `'${cot.id}'`, ver(cot.id));
  const lin1 = lineas(r1.revision_id);
  const ultima = JSON.parse(valor(U.ana, `select contenido from public.vp_eett where id = '${borr.id}';`));
  const c1 = contenidoMP({ ...cot }, r1.revision_id, lin1, ultima);
  c1.cotizacion.revision = 1;
  const g1 = rpcJ(U.ana, "vp_guardar_eett", j({ cotizacion_id: cot.id, contenido: c1 }));
  const em1 = rpcJ(U.ana, "vp_emitir_eett", `'${g1.id}'`, String(g1.version));
  check(em1.revision === 1 && em1.folio === fila.folio && valor(U.ana, `select estado from public.vp_eett where id = '${borr.id}';`) === "reemplazada", "B12 nueva generación: Rev. 1 con el mismo folio; la Rev. 0 se conserva como reemplazada");
  rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, `'enviada'`, j({}), ver(cot.id)); rpcJ(U.ana, "vp_cotizacion_estado", `'${cot.id}'`, `'aceptada'`, j({}), ver(cot.id));
  const v = rpcJ(U.ana, "vp_crear_venta_desde_cotizacion", `'${cot.id}'`, `'${randomUUID()}'`, j({}));
  check(valor(U.ana, `select eett_id from public.vp_ventas where id = '${v.id}';`) === g1.id, "B13 la venta toma la EETT emitida de la revisión aceptada (vínculo como antes)");
  check(valor(U.ana, `select estado||'|'||coalesce(hash,'')||'|'||(select eett_id from public.vp_ventas where id = '${v2.id}') from public.vp_eett where id = '${e2.id}';`) === `emitida|${em2.hash}|${e2.id}`, "B14 la EETT emitida con el formato anterior sigue emitida, con su huella y vinculada a su venta");

  // ═══ C. Recuperación ══════════════════════════════════════════════════════════════════════════════════════════════════
  const eettAntes = root("select md5(string_agg(to_jsonb(e)::text, '|' order by id)) from public.vp_eett e;");
  const ventasAntes = root("select md5(string_agg(id||coalesce(eett_id::text,''), '|' order by id)) from public.vp_ventas;");
  const rec = archivo(DB, "BORRADOR-2026-11-09-vp-eett-como-mp-deshacer.sql");
  check(!rec.err && huellaEmitir() === ORIGINAL, "C1 recuperación: vp_emitir_eett exactamente igual a la del 07/11", rec.err);
  check(root("select md5(string_agg(to_jsonb(e)::text, '|' order by id)) from public.vp_eett e;") === eettAntes && root("select md5(string_agg(id||coalesce(eett_id::text,''), '|' order by id)) from public.vp_ventas;") === ventasAntes, "C2 la recuperación no toca las EETT emitidas (formato nuevo y anterior) ni los vínculos con las ventas");
  check(root(CATALOGO) === cat0 && root("select proacl::text from pg_proc where proname = 'vp_emitir_eett';") === "{bfk_owner=X/bfk_owner,authenticated=X/bfk_owner}", "C3 catálogo idéntico al del 09/11 tras recuperar");
  falla(archivo(DB, "BORRADOR-2026-11-09-vp-eett-como-mp-deshacer.sql"), "nada que recuperar", "C4 recuperar dos veces se detiene sin cambios");
  const re = archivo(DB, "BORRADOR-2026-11-09-vp-eett-como-mp.sql");
  check(!re.err && huellaEmitir() === NUEVA, "C5 la migración se vuelve a aplicar después de recuperar", re.err);
} catch (e) { fallas++; console.log("EXCEPCIÓN:", e.message.split("\n").slice(0, 3).join(" | ")); }
finally { for (const db of ["bfk_vpet_a"]) psqlEn("postgres", `drop database if exists ${db} with (force);`); }
console.log(`RESUMEN sql_eett_como_mp: ${ok} OK, ${fallas} fallas`);
process.exit(fallas ? 1 : 0);
