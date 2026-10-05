// BD (PostgreSQL local) -> exportador real -> Excel -> lector/planificador real -> payload -> RPC -> BD.
// Uso: node roundtrip_json.mjs   (requiere la base local `imp` con schema-local.sql y la migración aplicadas)
import { execFileSync } from "node:child_process";
import * as XLSX from "xlsx";
import { construirLibroRespaldo } from "../../../src/lib/exportacion.js";
import { leerArchivoImportable, planificarImportacion, aplicarPlan } from "../../../src/lib/importacion.js";
const PSQL = process.env.PSQL || "/usr/lib/postgresql/16/bin/psql";
const ENV = { ...process.env, PGHOST: process.env.PGHOST || "/tmp/pgimp", PGPORT: process.env.PGPORT || "55432", PGUSER: process.env.PGUSER || "postgres" };
const sh = (sql) => execFileSync(PSQL, ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-d", "imp"], { input: sql, env: ENV, encoding: "utf8", maxBuffer: 1 << 28 }).trim();
const ADMIN = "11111111-1111-1111-1111-111111111111";
// "PostgREST" local: devuelve las filas como JSON con limit/offset (igual que Supabase)
const sel = async (tabla, _t, q) => { const lim = +(q.match(/limit=(\d+)/)?.[1] ?? 1e9), off = +(q.match(/offset=(\d+)/)?.[1] ?? 0);
  return JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from (select * from ${tabla} order by id offset ${off} limit ${lim}) t`)); };
const rpc = async (payload, simular) => { const f = `/tmp/rt_${process.pid}.json`; (await import("node:fs")).writeFileSync(f, JSON.stringify({ p_payload: payload, p_simular: simular }));
  try { return JSON.parse(execFileSync(PSQL, ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", "-d", "imp"], { input: `set role authenticated; select set_config('request.jwt.claim.sub','${ADMIN}',false), set_config('request.jwt.claim.role','authenticated',false) \\gset i_\n\\set a \`cat ${f}\`\nselect public.importar_respaldo_excel((:'a'::jsonb)->'p_payload', ${simular});`, env: ENV, encoding: "utf8" }).split("\n").filter((l) => l.startsWith("{")).pop()); }
  catch (e) { throw Object.assign(new Error(String(e.stderr || e.message)), { rpcStatus: 400, rpcCuerpo: { message: String(e.stderr || e.message) } }); } };
const R = {}; const chk = (k, v) => { R[k] = v; };
const tablas = [{ hoja: "Vendedores", tabla: "vendedores" }];
const instantanea = () => sh("select jsonb_agg(to_jsonb(v) - 'creadoEn' order by id) from vendedores v");

// Datos de prueba: objeto, array, anidado, {}, [], null, texto que parece JSON, comas/comillas en array de texto
sh(`truncate vendedores cascade;
insert into vendedores(id,nombre,meta,etiquetas,notas) values
 ('v1','Uno','{"a":1,"b":"texto"}','{x,y}','[1,2]'),
 ('v2','Dos','{"anidado":{"x":[1,{"y":null}],"z":true},"lista":[]}','{"con,coma","con \\"comillas\\"",z}','{"parece":"json"}'),
 ('v3','Tres','{}','{}','texto normal'),
 ('v4','Cuatro','[1,"dos",{"tres":3}]',NULL,NULL),
 ('v5','Cinco',NULL,'{a}','');`);
const original = instantanea();
const exportar = async () => { const { wb, resumen } = await construirLibroRespaldo({ sel, token: "t", hojas: tablas }); return { buf: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }), resumen }; };
const { buf, resumen } = await exportar();
R.nota_resumen_export = resumen[0].Nota;

// 1) Excel -> sin cambios respecto a la base: no se propone ningún cambio
let { datos, problemas } = leerArchivoImportable(buf, tablas); chk("lectura_sin_problemas", problemas.length === 0);
let plan = await planificarImportacion({ sel, token: "t", tablas, datos });
chk("1_round_trip_sin_cambios_0_operaciones", plan[0].ops.length === 0);

// 2) RESTAURAR en tabla vacía: BD -> Excel -> payload -> RPC -> BD (el cliente no sabe qué columnas son JSON; la base decide por tipo real)
sh("truncate vendedores cascade");
plan = await planificarImportacion({ sel, token: "t", tablas, datos });
chk("2_payload_tabla_vacia_5_inserts", plan[0].nuevas.length === 5);
const rs = await aplicarPlan({ rpc, plan }); chk("2_rpc_ok", rs.ok === true && rs.total_insertadas === 5);
const restaurado = instantanea();
chk("2_BD_estructuralmente_identica_al_original", restaurado === original || JSON.stringify(JSON.parse(restaurado)) === JSON.stringify(JSON.parse(original)));
chk("2_texto_que_parece_JSON_sigue_siendo_texto", sh("select pg_typeof(notas)::text||':'||notas from vendedores where id='v2'") === 'text:{"parece":"json"}' && sh("select notas from vendedores where id='v1'") === "[1,2]");
chk("2_jsonb_conserva_objeto_array_anidado_vacios", sh("select (meta='{\"a\":1,\"b\":\"texto\"}'::jsonb)::text||(select (meta='[1,\"dos\",{\"tres\":3}]'::jsonb)::text from vendedores where id='v4')||(select (meta='{}'::jsonb)::text from vendedores where id='v3')||(select (meta->'anidado'->'x'->1->'y' = 'null'::jsonb)::text from vendedores where id='v2') from vendedores where id='v1'") === "truetruetruetrue");
chk("2_arrays_text_con_comas_y_comillas", sh("select etiquetas::text from vendedores where id='v2'") === '{"con,coma","con \\"comillas\\"",z}' && sh("select etiquetas::text from vendedores where id='v3'") === "{}");

// 3) Edición en Excel de un objeto y de un array -> UPDATE con control optimista
const wb = XLSX.read(buf); const filas = XLSX.utils.sheet_to_json(wb.Sheets.Vendedores);
filas.find((f) => f.id === "v1").meta = JSON.stringify({ a: 2, b: "cambiado", nuevo: [1, 2, { k: true }] });
filas.find((f) => f.id === "v2").etiquetas = JSON.stringify(["uno", "dos"]);
filas.find((f) => f.id === "v3").notas = "[no es json pero es texto]";
wb.Sheets.Vendedores = XLSX.utils.json_to_sheet(filas); const buf2 = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
({ datos, problemas } = leerArchivoImportable(buf2, tablas));
plan = await planificarImportacion({ sel, token: "t", tablas, datos });
chk("3_tres_actualizaciones_solo_columnas_distintas", plan[0].ops.length === 3 && plan[0].ops.every((o) => Object.keys(o.cambios).length === 1));
const r3 = await aplicarPlan({ rpc, plan }); chk("3_rpc_ok", r3.ok === true && r3.total_actualizadas === 3);
chk("3_BD_refleja_cambios_estructurados", sh("select (meta='{\"a\":2,\"b\":\"cambiado\",\"nuevo\":[1,2,{\"k\":true}]}'::jsonb)::text||(select (etiquetas=array['uno','dos'])::text from vendedores where id='v2')||(select notas from vendedores where id='v3') from vendedores where id='v1'") === "truetrue[no es json pero es texto]");
// 4) Reimportar el mismo archivo ya aplicado -> idempotente (0 cambios)
plan = await planificarImportacion({ sel, token: "t", tablas, datos }); chk("4_idempotente_0_operaciones", plan[0].ops.length === 0);
// 5) JSON inválido en columna jsonb escrito a mano en el Excel -> la base rechaza TODO
filas.find((f) => f.id === "v1").meta = "{esto no es json"; const wb3 = XLSX.read(buf); wb3.Sheets.Vendedores = XLSX.utils.json_to_sheet(filas); const buf3 = XLSX.write(wb3, { type: "buffer", bookType: "xlsx" });
({ datos } = leerArchivoImportable(buf3, tablas)); const antes = instantanea();
let err5 = null; try { plan = await planificarImportacion({ sel, token: "t", tablas, datos }); await aplicarPlan({ rpc, plan }); } catch (e) { err5 = e.message; }
chk("5_json_invalido_cancelado_0_cambios", !!err5 && /JSON válido|IMPORTACIÓN CANCELADA/.test(err5) && instantanea() === antes);
R.mensaje_5 = err5;
console.log(JSON.stringify(R, null, 1)); console.log("TODO_OK", Object.entries(R).filter(([k]) => /^\d|lectura/.test(k)).every(([, v]) => v === true));
