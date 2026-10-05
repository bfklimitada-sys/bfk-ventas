// Ida y vuelta con el EXCEL del exportador real, sobre la COPIA (PostgreSQL efímero). No imprime valores de filas.
// estado original -> Excel -> alteración controlada (y borrado de filas) -> importación (simulación y real) -> estado original
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { HOJAS_RESPALDO } from "../../../../src/lib/hojasRespaldo.js";
import { construirLibroRespaldo } from "../../../../src/lib/exportacion.js";
import { leerArchivoImportable, planificarImportacion, construirPayloadRPC, aplicarPlan, simularPlan } from "../../../../src/lib/importacion.js";

const PSQL = process.env.PSQL || "psql";
const env = { PGHOST: "localhost", PGPORT: "5432", PGUSER: "postgres", PGDATABASE: "postgres", ...process.env };
if (!(env.PGHOST === "localhost" || env.PGHOST === "127.0.0.1" || env.PGHOST.startsWith("/"))) throw new Error("solo bases locales");
const sh = (sql, extra = []) => execFileSync(PSQL, ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", ...extra], { input: sql, env, encoding: "utf8", maxBuffer: 1 << 29 }).trim();
const limpio = (t) => String(t).replace(/\([^()]*\)=\([^()]*\)/g, "(…)=(…)").replace(/DETAIL:[^\n]*/g, "DETAIL:[omitido]").replace(/\s+/g, " ").slice(0, 300);
const T14 = HOJAS_RESPALDO.filter((h) => h.importable);
const R = {}; const chk = (k, v, info) => { R[k] = !!v; console.log(v ? "OK   " : "FALLA", k, v ? "" : limpio(info ?? "")); };
const ADMIN = sh("select id from public.perfiles where rol='admin' limit 1");

const sel = async (tabla, _t, q) => {
  const lim = +(q.match(/limit=(\d+)/)?.[1] ?? 1e9), off = +(q.match(/offset=(\d+)/)?.[1] ?? 0), orden = /order=id/.test(q) ? "order by id" : "";
  return JSON.parse(sh(`select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from (select * from public.${tabla} ${orden} offset ${off} limit ${lim}) t`));
};
const rpc = async (payload, simular) => {
  const f = `/tmp/rt_${process.pid}.json`; writeFileSync(f, JSON.stringify({ p_payload: payload, p_simular: simular }));
  const sql = `set role authenticated;\nselect set_config('request.jwt.claim.sub','${ADMIN}',false), set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','${ADMIN}','role','authenticated')::text,false) \\gset i_\n\\set a \`cat ${f}\`\nselect public.importar_respaldo_excel((:'a'::jsonb)->'p_payload', ${simular});`;
  try { const out = execFileSync(PSQL, ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1"], { input: sql, env, encoding: "utf8", maxBuffer: 1 << 28 });
        return JSON.parse(out.split("\n").filter((l) => l.startsWith("{")).pop()); }
  catch (e) { const msg = String(e.stderr || e.message); const m = msg.match(/DETAIL:\s*(\{.*\})/); throw Object.assign(new Error(msg), { rpcStatus: 400, rpcCuerpo: { message: msg.split("\n")[0].replace(/^ERROR:\s*/, ""), details: m ? m[1] : "{}", code: "IM001" } }); }
};
const fpTabla = (t) => sh(`select md5(coalesce(string_agg(x::text, ',' order by x::text),''))||':'||count(*) from public.${t} x`);
const fpTodas = () => Object.fromEntries(["ordenes_compra_v2", ...T14.map((h) => h.tabla), "aportes_socios", "perfiles", "saldo_banco", "banco_mensual", "cartolas_importadas", "entidades_catalogo", "historial_cambios", "notificaciones"].filter((v, i, a) => a.indexOf(v) === i).map((t) => [t, fpTabla(t)]));

// --- metadatos para alterar sin violar restricciones: columnas "libres" (sin PK/FK/UNIQUE/CHECK/generada)
const meta = JSON.parse(sh(`select jsonb_object_agg(t, cols) from (select c.relname t, jsonb_agg(jsonb_build_object('n',a.attname,'udt',ty.typname,'cat',ty.typcategory,'notnull',a.attnotnull,'gen',a.attgenerated<>'' or a.attidentity='a',
   'restr',exists(select 1 from pg_constraint k where k.conrelid=a.attrelid and a.attnum=any(k.conkey)) or exists(select 1 from pg_index i where i.indrelid=a.attrelid and i.indisunique and a.attnum=any(i.indkey))) order by a.attnum) cols
   from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_type ty on ty.oid=a.atttypid where c.relnamespace='public'::regnamespace and c.relkind='r' and a.attnum>0 and not a.attisdropped
   and c.relname in (${T14.map((h) => `'${h.tabla}'`).join(",")}) group by c.relname) z`));
const libres = (t) => meta[t].filter((c) => !c.restr && !c.gen && c.n !== "id");
const clases = (t) => ({ texto: libres(t).filter((c) => ["text", "varchar", "bpchar"].includes(c.udt)), num: libres(t).filter((c) => ["numeric", "int4", "int8", "float8"].includes(c.udt)), bool: libres(t).filter((c) => c.udt === "bool"), json: libres(t).filter((c) => ["json", "jsonb"].includes(c.udt)), arr: libres(t).filter((c) => c.cat === "A") });

// 1) Excel del exportador real (todas las hojas) y lectura por el importador
const antes = fpTodas();
const filasAntes = Object.fromEntries(T14.map((h) => [h.tabla, null]));
for (const h of T14) filasAntes[h.tabla] = await sel(h.tabla, "", "&order=id&limit=100000&offset=0");
const { wb, resumen, errores } = await construirLibroRespaldo({ sel, token: "t", hojas: HOJAS_RESPALDO });
chk("excel_exportado_sin_hojas_en_ERROR", errores.length === 0, JSON.stringify(errores.map((e) => e.Hoja)));
const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
R.hojas_en_excel = wb.SheetNames.length; R.json_array_columnas_serializadas = resumen.filter((r) => /JSON/.test(r.Nota)).map((r) => r.Hoja + ": " + r.Nota);
const tablasImp = T14.map(({ hoja, tabla }) => ({ hoja, tabla }));
let { datos, problemas } = leerArchivoImportable(buf, tablasImp);
chk("importador_reconoce_las_14_hojas_sin_problemas", problemas.length === 0 && Object.keys(datos).length === 14, problemas.join(" "));
chk("importador_cuenta_filas_igual_a_la_base", T14.every((h) => (datos[h.tabla] || []).length === filasAntes[h.tabla].length));
let plan = await planificarImportacion({ sel, token: "t", tablas: tablasImp, datos });
const espurias = {}; for (const p of plan) if (p.ops.length) espurias[p.tabla] = { ops: p.ops.length, columnas: [...new Set(p.ops.flatMap((o) => Object.keys(o.cambios || {})))] };
R.ops_espurias_sobre_base_intacta = espurias;
chk("round_trip_sin_cambios_propone_0_operaciones", Object.keys(espurias).length === 0, JSON.stringify(espurias));

// 2) Alteración controlada + borrado de filas hojas (el importador no borra: debe re-insertarlas)
const altas = []; const sqlAlt = [];
for (const h of T14) {
  const t = h.tabla; const k = clases(t); const n = filasAntes[t].length; if (!n) { altas.push(`${t}: vacía`); continue; }
  const sets = [];
  if (k.texto[0]) sets.push(`${k.texto[0].n} = coalesce(${k.texto[0].n},'') || ' [ALT]'`);
  if (k.num[0]) sets.push(`${k.num[0].n} = coalesce(${k.num[0].n},0) + 7`);
  if (k.bool[0]) sets.push(`${k.bool[0].n} = not coalesce(${k.bool[0].n}, false)`);
  if (k.json[0]) sets.push(`${k.json[0].n} = jsonb_build_object('alt', true)`);
  if (k.arr[0]) sets.push(`${k.arr[0].n} = null`);
  if (k.texto[1] && !k.texto[1].notnull) sets.push(`${k.texto[1].n} = null`);
  if (sets.length) { sqlAlt.push(`update public.${t} set ${sets.join(", ")} where id in (select id from public.${t} order by id limit 3);`); altas.push(`${t}: ${sets.length} columnas en hasta 3 filas`); } else altas.push(`${t}: sin columnas libres`);
}
for (const q of sqlAlt) { try { sh(q); } catch (e) { altas.push("ERROR al alterar: " + limpio(e.stderr || e.message).slice(0, 80)); } }
// borrado de filas en tablas hoja (las que PostgreSQL deje borrar sin violar FK)
const borradas = {}; 
for (const t of ["eventos_pago_financiamiento", "eventos_pago_cliente", "eventos_entrega", "eventos_factura", "gastos_indirectos", "pagos_vendedor", "ajustes_saldo_financiador", "contactos_cobranza", "eventos_compra"]) {
  if (!filasAntes[t]?.length) continue;
  const lista = (q) => sh(q).split("\n").filter(Boolean);
  const ids = t === "eventos_pago_financiamiento"
    ? [...lista(`select id from public.${t} where oc_id is null order by id limit 2`), ...lista(`select id from public.${t} where oc_id is not null order by id limit 2`)]
    : lista(`select id from public.${t} order by id limit 3`);
  try { sh(`delete from public.${t} where id in (${ids.map((i) => `'${i}'`).join(",")})`); borradas[t] = ids; } catch (e) { borradas[t] = "no borrable (FK): " + limpio(e.stderr || e.message).slice(0, 60); }
}
R.alteraciones = altas; R.borrado = Object.fromEntries(Object.entries(borradas).map(([t, v]) => [t, Array.isArray(v) ? v.length + " filas" : v]));
const pagosSinOcBorrados = (borradas.eventos_pago_financiamiento || []).filter((id) => filasAntes.eventos_pago_financiamiento.find((r) => r.id === id && r.oc_id === null));
R.pagos_financiador_sin_oc_en_la_copia = filasAntes.eventos_pago_financiamiento.filter((r) => r.oc_id === null).length;
const alterado = fpTodas();
chk("la_alteracion_cambio_el_estado", T14.some((h) => alterado[h.tabla] !== antes[h.tabla]));

// 3) Excel con hojas EXTRA alteradas (no deben importarse) -> plan -> simulación -> restauración real
const wb2 = XLSX.read(buf);
const alt = (hoja, fn) => { if (!wb2.Sheets[hoja]) return; const f = XLSX.utils.sheet_to_json(wb2.Sheets[hoja]); fn(f); wb2.Sheets[hoja] = XLSX.utils.json_to_sheet(f.length ? f : [{}]); };
alt("AportesSocios", (f) => { if (f[0]) { const k = Object.keys(f[0]).find((c) => c !== "id" && typeof f[0][c] === "number"); if (k) f[0][k] = 1; } f.push({ id: "extra_no_importar" }); });
alt("Perfiles", (f) => { if (f[0]) f[0].rol = "rol_alterado"; }); alt("SaldoBanco", (f) => { if (f[0]) { const k = Object.keys(f[0]).find((c) => c !== "id" && typeof f[0][c] === "number"); if (k) f[0][k] = 1; } });
alt("HistorialCambios", (f) => { f.push({ id: "hc_extra_no_importar", accion: "x" }); }); alt("EntidadesCatalogo", (f) => { f.push({ id: "ent_extra" }); });
const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx" });
({ datos, problemas } = leerArchivoImportable(buf2, tablasImp));
chk("excel_con_hojas_extra_alteradas_se_lee_sin_problemas", problemas.length === 0, problemas.join(" "));
plan = await planificarImportacion({ sel, token: "t", tablas: tablasImp, datos });
const payload = construirPayloadRPC(plan);
R.operaciones_planificadas = Object.fromEntries(Object.entries(payload.tablas).map(([t, v]) => [t, { insertar: (v.insertar || []).length, actualizar: (v.actualizar || []).length }]));
chk("payload_solo_contiene_tablas_de_las_14", Object.keys(payload.tablas).every((t) => T14.some((h) => h.tabla === t)));
const fpAntesSim = fpTodas();
let sim; try { sim = await simularPlan({ rpc, plan }); } catch (e) { sim = { error: limpio(e.message) }; }
chk("simulacion_con_datos_reales_ok", sim.ok === true, JSON.stringify(sim));
const fpTrasSim = fpTodas();
chk("simulacion_0_modificaciones_persistentes", JSON.stringify(fpAntesSim) === JSON.stringify(fpTrasSim));
R.simulacion = sim.ok ? { orden: sim.orden, total_insertadas: sim.total_insertadas, total_actualizadas: sim.total_actualizadas } : sim;
let real; const hist0 = +sh("select count(*) from public.historial_cambios where accion='Importación de respaldo Excel'");
try { real = await aplicarPlan({ rpc, plan }); } catch (e) { real = { error: limpio(e.message) }; }
chk("importacion_real_en_la_copia_ok", real.ok === true, JSON.stringify(real));
const despues = fpTodas();
const desiguales = T14.map((h) => h.tabla).filter((t) => despues[t] !== antes[t]);
chk("estado_restaurado_identico_al_original_14_tablas", desiguales.length === 0, "tablas distintas: " + desiguales.join(", "));
// diagnóstico por columna (solo nombres) si hay diferencias
const difCols = {};
for (const t of desiguales) {
  const ahora = await sel(t, "", "&order=id&limit=100000&offset=0"); const m0 = new Map(filasAntes[t].map((r) => [r.id, r])); const m1 = new Map(ahora.map((r) => [r.id, r]));
  const cols = new Set(); let faltan = 0, sobran = 0;
  for (const [id, r0] of m0) { const r1 = m1.get(id); if (!r1) { faltan++; continue; } for (const k of Object.keys(r0)) if (JSON.stringify(r0[k]) !== JSON.stringify(r1[k])) cols.add(`${k}(${typeof r0[k]}->${typeof r1[k]})`); }
  for (const id of m1.keys()) if (!m0.has(id)) sobran++;
  difCols[t] = { columnas_distintas: [...cols], filas_que_faltan: faltan, filas_nuevas: sobran };
}
R.diferencias_por_columna = difCols;
chk("pagos_financiador_sin_oc_conservados_oc_id_null", pagosSinOcBorrados.length === 0 ? true : pagosSinOcBorrados.every((id) => sh(`select (oc_id is null)::text from public.eventos_pago_financiamiento where id='${id}'`) === "true"),
    "no restaurados");
chk("pago_financiador_sin_oc_probado", pagosSinOcBorrados.length > 0, "la copia no tiene pagos sin OC borrables");
chk("hojas_extra_no_se_restauraron", ["aportes_socios", "perfiles", "saldo_banco", "entidades_catalogo"].every((t) => despues[t] === antes[t]) && sh("select count(*) from public.historial_cambios where id in ('hc_extra_no_importar')") === "0" && sh("select count(*) from public.aportes_socios where id='extra_no_importar'") === "0");
chk("historial_exactamente_1_fila_resumen_nueva", +sh("select count(*) from public.historial_cambios where accion='Importación de respaldo Excel'") === hist0 + 1 && +sh("select count(*) from public.historial_cambios") === +antes.historial_cambios.split(":")[1] + 1);
// 4) idempotencia
({ datos } = leerArchivoImportable(buf, tablasImp)); plan = await planificarImportacion({ sel, token: "t", tablas: tablasImp, datos });
chk("reimportar_el_mismo_excel_propone_0_operaciones", plan.every((p) => p.ops.length === 0), JSON.stringify(plan.filter((p) => p.ops.length).map((p) => p.tabla)));
console.log("RESULTADO_EXCEL " + JSON.stringify(R));
