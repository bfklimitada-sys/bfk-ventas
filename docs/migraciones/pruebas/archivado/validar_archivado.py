"""Archivado reversible de OCs: pruebas sobre la COPIA restaurada del último respaldo (PostgreSQL efímero).
Ciclo completo: migración -> archivar una OC real con muchos datos relacionados -> verificar que nada se pierde ->
respaldo (pg_dump/pg_restore) -> restaurar -> estado funcional idéntico -> deshacer -> reaplicar.
No imprime filas reales, IDs de perfiles, correos ni montos."""
import json, os, subprocess

D = os.path.dirname(os.path.abspath(__file__)); M = os.path.join(D, "..", "..")
MIG = os.path.join(M, "2026-10-05-archivado-oc.sql"); UNDO = os.path.join(M, "2026-10-05-archivado-oc-deshacer.sql")
F = []
assert os.environ.get("PGHOST", "localhost") in ("localhost", "127.0.0.1"), "solo bases locales"

def run(sql, single=False, db=None):
    args = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t"] + (["--single-transaction"] if single else []) + (["-d", db] if db else [])
    p = subprocess.run(args, input=sql, capture_output=True, text=True)
    return p.stdout.strip(), p.stderr.strip(), p.returncode
def q(sql, db=None):
    o, e, rc = run(sql, db=db)
    if rc: raise RuntimeError(e[:300])
    return o
def chk(n, ok, d=""):
    print(("PASS " if ok else "FALLA ") + n + ("" if ok else f" :: {str(d)[:240]}"), flush=True)
    if not ok: F.append(n)
def ses(sub, rol="authenticated"):
    s = f"set local role {rol};\n"
    if sub: s += f"select set_config('request.jwt.claim.sub','{sub}',true), set_config('request.jwt.claim.role','{rol}',true), set_config('request.jwt.claims','{json.dumps({'sub': sub, 'role': rol})}',true) \\g /dev/null\n"
    return s
def tx(sub, cuerpo, rol="authenticated", commit=False):
    return run(f"begin;\n{ses(sub, rol)}{cuerpo}{'commit' if commit else 'rollback'};\n")
def lit(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"

NUEVAS = ["archivada", "archivada_en", "archivada_por", "archivada_por_nombre", "archivo_motivo"]
REL = ["eventos_compra", "eventos_entrega", "eventos_factura", "eventos_pago_cliente", "eventos_pago_financiamiento", "eventos_postventa",
       "oc_productos_link", "oc_comentarios", "oc_reclamos", "oc_responsables", "historial_cambios", "oc_bloqueos", "notificaciones"]
TABLAS = q("select string_agg(relname, ',' order by relname) from pg_class where relnamespace='public'::regnamespace and relkind='r'").split(",")
def h_tabla(t, quitar=False, db=None):
    expr = "to_jsonb(x)" + ("".join(f" - '{c}'" for c in NUEVAS) if quitar else "")
    return q(f"select count(*)||'|'||md5(coalesce(string_agg(({expr})::text, '|' order by ({expr})::text),'')) from public.{t} x", db=db)
def tiene_cols(): return q("select count(*) from information_schema.columns where table_schema='public' and table_name='ordenes_compra_v2' and column_name='archivada'") == "1"
def estado(quitar=False, db=None):
    return {t: h_tabla(t, quitar and t == "ordenes_compra_v2", db) for t in TABLAS}
def meta():
    return {"pol": q("select md5(coalesce(string_agg(tablename||policyname||cmd||roles::text||coalesce(qual,'')||coalesce(with_check,''),';' order by tablename,policyname),'')) from pg_policies where schemaname='public'"),
            "fn_otras": q("select md5(coalesce(string_agg(p.proname||md5(pg_get_functiondef(p.oid)),';' order by p.proname),'')) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f' and p.proname not in ('archivar_oc','restaurar_oc','proteger_archivo_oc')"),
            "trg_otros": q("select coalesce(string_agg(c.relname||'.'||t.tgname::text||t.tgenabled::text,';' order by c.relname,t.tgname),'-') from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace and t.tgname<>'proteger_archivo_oc'"),
            "idx_otros": q("select md5(string_agg(indexdef,';' order by indexname)) from pg_indexes where schemaname='public' and indexname<>'ordenes_compra_v2_archivada_idx'"),
            "cols_otras": q("select md5(string_agg(table_name||column_name||data_type||coalesce(column_default,'')||is_nullable,';' order by table_name,ordinal_position)) from information_schema.columns where table_schema='public' and not (table_name='ordenes_compra_v2' and column_name in ('archivada','archivada_en','archivada_por','archivada_por_nombre','archivo_motivo'))")}
def oc_row(oid): return q(f"select to_jsonb(o)::text from public.ordenes_compra_v2 o where id={lit(oid)}")
def rel_h(oid): return {t: q(f"select count(*)||'|'||md5(coalesce(string_agg(to_jsonb(x)::text,'|' order by to_jsonb(x)::text),'')) from public.{t} x where oc_id={lit(oid)}") for t in REL}
def hist_previo(): return q("select count(*)||'|'||md5(coalesce(string_agg(to_jsonb(h)::text,'|' order by to_jsonb(h)::text),'')) from public.historial_cambios h where accion not in ('OC archivada','OC restaurada')")
def otras(): return q(f"select md5(string_agg(to_jsonb(o)::text,'|' order by id)) from public.ordenes_compra_v2 o where id<>{lit(OC)}")
def difs(a, b): return [k for k in a if a[k] != b.get(k)]

print("===== PREPARACIÓN =====")
q("grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;")
ADMIN = q("select id from public.perfiles where rol='admin' order by id limit 1"); USR = q("select id from public.perfiles where rol is distinct from 'admin' order by id limit 1")
chk("hay_admin_y_usuario_normal_en_la_copia", bool(ADMIN) and bool(USR))
S0, M0 = estado(), meta()
print("tablas public:", len(TABLAS), "· OCs:", S0["ordenes_compra_v2"].split("|")[0])
chk("estado_inicial_286_ocs", S0["ordenes_compra_v2"].startswith("286|"), S0["ordenes_compra_v2"])
o, e, rc = run(open(UNDO).read(), single=True); chk("deshacer_sin_migracion_es_inocuo", rc == 0 and estado() == S0, e[-200:])

print("\n===== MIGRACIÓN =====")
o, e, rc = run(open(MIG).read(), single=True); chk("migracion_aplicada", rc == 0, e[-300:])
S1, M1 = estado(), meta()
chk("ninguna_otra_tabla_cambia", difs({k: v for k, v in S0.items() if k != "ordenes_compra_v2"}, S1) == [], difs(S0, S1))
chk("ocs_286_columnas_originales_identicas", h_tabla("ordenes_compra_v2", quitar=True) == S0["ordenes_compra_v2"])
chk("ocs_286_todas_activas_sin_datos_de_archivo", q("select count(*) filter (where not archivada and archivada_en is null and archivada_por is null and archivada_por_nombre is null and archivo_motivo is null) from public.ordenes_compra_v2") == "286")
chk("politicas_funciones_triggers_indices_columnas_existentes_sin_cambios", M0 == M1, difs(M0, M1))
info = q("select string_agg(proname||':'||prosecdef::text||':'||has_function_privilege('anon',oid,'execute')::text||':'||has_function_privilege('authenticated',oid,'execute')::text||':'||array_to_string(proconfig,','),' ' order by proname) from pg_proc where proname in ('archivar_oc','restaurar_oc')")
chk("rpcs_security_invoker_search_path_fijo_sin_anon", info == "archivar_oc:false:false:true:search_path=public, pg_temp restaurar_oc:false:false:true:search_path=public, pg_temp", info)
o, e, rc = run(open(MIG).read(), single=True); chk("reaplicar_aborta_sin_cambios", rc != 0 and "ARCHIVADO_ABORTADO" in e and estado() == S1)

print("\n===== OC REAL CON MUCHOS DATOS RELACIONADOS =====")
suma = " + ".join(f"(select count(*) from public.{t} r where r.oc_id=o.id)" for t in REL)
OC = q(f"select id from public.ordenes_compra_v2 o order by ({suma}) desc, id limit 1")
R0, ROW0 = rel_h(OC), oc_row(OC)
print("registros relacionados por tabla:", {t: int(v.split("|")[0]) for t, v in R0.items() if not v.startswith("0|")})
chk("oc_elegida_tiene_eventos_de_varias_etapas", sum(1 for t in REL if not R0[t].startswith("0|")) >= 4)
num = q(f"select numero_oc from public.ordenes_compra_v2 where id={lit(OC)}")

print("\n===== PERMISOS (en transacciones que se deshacen) =====")
o, e, rc = tx(USR, f"select public.archivar_oc({lit(OC)}, 'x');\n"); chk("usuario_normal_no_puede_archivar_por_rpc", rc != 0 and "solo un administrador" in e, e[-150:])
o, e, rc = tx(USR, f"update public.ordenes_compra_v2 set archivada=true where id={lit(OC)};\n"); chk("usuario_normal_no_puede_archivar_por_patch", rc != 0 and "Solo un administrador" in e, e[-150:])
o, e, rc = tx(USR, f"update public.ordenes_compra_v2 set archivo_motivo='x' where id={lit(OC)};\n"); chk("usuario_normal_no_puede_tocar_columnas_de_archivo", rc != 0 and "Solo un administrador" in e, e[-150:])
col_txt = q("select column_name from information_schema.columns where table_schema='public' and table_name='ordenes_compra_v2' and data_type='text' and column_name not in ('id','numero_oc','archivada_por_nombre','archivo_motivo') order by ordinal_position limit 1")
o, e, rc = tx(USR, f"update public.ordenes_compra_v2 set {col_txt}=coalesce({col_txt},'')||' ' where id={lit(OC)} returning 1;\n")
chk("usuario_normal_sigue_editando_otros_campos_de_la_oc", rc == 0 and o.strip().endswith("1"), e[-150:])
o, e, rc = tx(USR, "insert into public.ordenes_compra_v2 (id, numero_oc, archivada) values ('prueba_arch_x','PRUEBA-ARCH-X', true);\n"); chk("usuario_normal_no_inserta_oc_archivada", rc != 0 and "Solo un administrador" in e, e[-150:])
o, e, rc = tx(None, f"select public.archivar_oc({lit(OC)}, 'x');\n", rol="anon"); chk("anonimo_no_puede_ejecutar", rc != 0 and "permission denied" in e, e[-150:])
o, e, rc = tx(ADMIN, "select public.archivar_oc('no-existe-xyz', null);\n"); chk("oc_inexistente_rechazada", rc != 0 and "no existe" in e)
o, e, rc = tx(ADMIN, f"select public.archivar_oc({lit(OC)}, repeat('a',501));\n"); chk("motivo_demasiado_largo_rechazado", rc != 0 and "demasiado largo" in e)
o, e, rc = tx(ADMIN, f"select public.restaurar_oc({lit(OC)});\n"); chk("restaurar_oc_activa_rechazado", rc != 0 and "no está archivada" in e)
chk("pruebas_de_permisos_no_dejaron_cambios", estado() == S1)

print("\n===== ARCHIVAR (administrador) =====")
HC0 = int(q("select count(*) from public.historial_cambios")); HIST0 = hist_previo(); OTRAS0 = otras()
ARCH0 = int(q(f"select count(*) from public.historial_cambios where accion='OC archivada' and oc_id={lit(OC)}")); REST0 = int(q(f"select count(*) from public.historial_cambios where accion='OC restaurada' and oc_id={lit(OC)}"))
o, e, rc = tx(ADMIN, f"select public.archivar_oc({lit(OC)}, 'Prueba de archivado');\n", commit=True); chk("admin_archiva", rc == 0 and '"ok": true' in o, e[-200:])
S2 = estado()
a = json.loads(q(f"select json_build_object('a',archivada,'en',archivada_en is not null,'por',archivada_por::text={lit(ADMIN)},'nom',archivada_por_nombre=(select nombre from public.perfiles where id={lit(ADMIN)}),'mot',archivo_motivo) from public.ordenes_compra_v2 where id={lit(OC)}"))
chk("registra_quien_cuando_y_motivo", a == {"a": True, "en": True, "por": True, "nom": True, "mot": "Prueba de archivado"}, a)
R1 = rel_h(OC)
chk("datos_relacionados_intactos_salvo_historial", all(R1[t] == R0[t] for t in REL if t != "historial_cambios"), [t for t in REL if R1[t] != R0[t]])
chk("historial_previo_de_la_oc_intacto_y_una_entrada_nueva", int(R1["historial_cambios"].split("|")[0]) == int(R0["historial_cambios"].split("|")[0]) + 1
    and q(f"select count(*) from public.historial_cambios where oc_id={lit(OC)} and accion='OC archivada' and usuario_id::text={lit(ADMIN)} and valor_nuevo='archivada · motivo: Prueba de archivado'") == str(ARCH0 + 1))
chk("columnas_originales_de_la_oc_sin_cambios", q(f"select (to_jsonb(o){''.join(f' - {lit(c)}' for c in NUEVAS)})::text from public.ordenes_compra_v2 o where id={lit(OC)}") == q(f"select ({lit(ROW0)}::jsonb{''.join(f' - {lit(c)}' for c in NUEVAS)})::text"))
chk("otras_285_ocs_sin_cambios", otras() == OTRAS0)
chk("otras_tablas_sin_cambios", difs({k: v for k, v in S1.items() if k not in ("ordenes_compra_v2", "historial_cambios")}, S2) == [])
chk("historial_total_mas_1", int(q("select count(*) from public.historial_cambios")) == HC0 + 1)
o, e, rc = tx(USR, f"select archivada::text from public.ordenes_compra_v2 where id={lit(OC)};\n"); chk("oc_archivada_sigue_consultable_por_usuarios", rc == 0 and o.strip() == "true")
o, e, rc = tx(USR, f"select count(*) from public.eventos_compra where oc_id={lit(OC)};\n"); chk("eventos_de_oc_archivada_consultables", rc == 0 and o.strip() == R0["eventos_compra"].split("|")[0])
o, e, rc = tx(ADMIN, f"select public.archivar_oc({lit(OC)}, null);\n"); chk("archivar_dos_veces_rechazado", rc != 0 and "ya está archivada" in e)
o, e, rc = tx(USR, f"select public.restaurar_oc({lit(OC)});\n"); chk("usuario_normal_no_puede_restaurar", rc != 0 and "solo un administrador" in e)
o, e, rc = tx(USR, f"update public.ordenes_compra_v2 set archivada=false where id={lit(OC)};\n"); chk("usuario_normal_no_puede_desarchivar_por_patch", rc != 0 and "Solo un administrador" in e)
o, e, rc = run(open(UNDO).read(), single=True); chk("deshacer_se_niega_con_oc_archivada", rc != 0 and "DESHACER_ARCHIVADO_ABORTADO" in e and estado() == S2, e[-200:])
num_unico = q(f"select count(*) from pg_indexes where schemaname='public' and tablename='ordenes_compra_v2' and indexdef ilike '%unique%numero_oc%'")
if num_unico != "0":
    o, e, rc = tx(ADMIN, f"insert into public.ordenes_compra_v2 (id, numero_oc) values ('prueba_dup_x', {lit(num)});\n")
    chk("no_se_puede_crear_otra_oc_con_el_numero_de_una_archivada", rc != 0)

print("\n===== RESPALDO (pg_dump -> pg_restore en otra base) =====")
q("drop database if exists copia_respaldo"); q("create database copia_respaldo")
q("create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists \"uuid-ossp\" with schema extensions;", db="copia_respaldo")
p1 = subprocess.run("pg_dump -Fc -n public -n auth -f /tmp/arch_pub.dump && pg_restore --no-owner -d copia_respaldo /tmp/arch_pub.dump", shell=True, capture_output=True, text=True)
SR = estado(db="copia_respaldo")
print("pg_restore:", "sin errores" if p1.returncode == 0 else "con avisos: " + " | ".join(l[:120] for l in p1.stderr.splitlines() if "error" in l.lower() and "already exists" not in l and "errors ignored" not in l)[:600])
chk("respaldo_restaurado_identico_tabla_por_tabla", difs(S2, SR) == [], difs(S2, SR) or p1.stderr[-200:])
chk("respaldo_conserva_la_oc_archivada_y_sus_datos", q(f"select archivada::text||'|'||archivo_motivo from public.ordenes_compra_v2 where id={lit(OC)}", db="copia_respaldo") == "true|Prueba de archivado")
q("drop database copia_respaldo"); os.remove("/tmp/arch_pub.dump")

print("\n===== RESTAURAR (administrador) =====")
o, e, rc = tx(ADMIN, f"select public.restaurar_oc({lit(OC)});\n", commit=True); chk("admin_restaura", rc == 0 and '"ok": true' in o, e[-200:])
S3 = estado()
chk("oc_restaurada_identica_al_estado_previo_al_archivo", oc_row(OC) == ROW0)
R2 = rel_h(OC)
chk("datos_relacionados_identicos_salvo_2_entradas_de_historial", all(R2[t] == R0[t] for t in REL if t != "historial_cambios")
    and int(R2["historial_cambios"].split("|")[0]) == int(R0["historial_cambios"].split("|")[0]) + 2
    and q(f"select count(*) from public.historial_cambios where oc_id={lit(OC)} and accion='OC restaurada' and valor_anterior like 'archivada el %Prueba de archivado' and valor_nuevo='activa'") == str(REST0 + 1))
chk("todas_las_tablas_identicas_al_estado_post_migracion_salvo_historial", difs({k: v for k, v in S1.items() if k != "historial_cambios"}, S3) == [], difs(S1, S3))
chk("historial_previo_intacto", hist_previo() == HIST0)
o, e, rc = tx(ADMIN, f"select public.restaurar_oc({lit(OC)});\n"); chk("restaurar_dos_veces_rechazado", rc != 0 and "no está archivada" in e)
o, e, rc = tx(USR, f"update public.ordenes_compra_v2 set {col_txt}=coalesce({col_txt},'')||' ' where id={lit(OC)} returning 1;\n"); chk("oc_restaurada_editable_por_usuarios", rc == 0)

print("\n===== DESHACER Y REAPLICAR =====")
o, e, rc = run(open(UNDO).read(), single=True); chk("deshacer_sin_archivadas_ok", rc == 0, e[-200:])
S4, M4 = estado(), meta()
chk("deshacer_deja_ocs_byte_a_byte_como_antes_de_migrar", S4["ordenes_compra_v2"] == S0["ordenes_compra_v2"] and not tiene_cols())
chk("deshacer_otras_tablas_iguales_al_inicio_salvo_historial", difs({k: v for k, v in S0.items() if k != "historial_cambios"}, S4) == [], difs(S0, S4))
chk("deshacer_conserva_historial_de_archivo_y_restauracion", int(S4["historial_cambios"].split("|")[0]) == int(S0["historial_cambios"].split("|")[0]) + 2)
chk("deshacer_politicas_funciones_triggers_indices_como_al_inicio", M4 == M0 and q("select count(*) from pg_proc where proname in ('archivar_oc','restaurar_oc','proteger_archivo_oc')") == "0", difs(M0, M4))
o, e, rc = run(open(MIG).read(), single=True); chk("reaplicar_tras_deshacer_ok", rc == 0 and h_tabla("ordenes_compra_v2", quitar=True) == S0["ordenes_compra_v2"], e[-200:])
o, e, rc = run(open(UNDO).read(), single=True); chk("segundo_deshacer_ok", rc == 0 and estado()["ordenes_compra_v2"] == S0["ordenes_compra_v2"])

if os.environ.get("DEJAR_ARCHIVADA_PARA_EXCEL") == "1":
    o, e, rc = run(open(MIG).read(), single=True); chk("migracion_para_prueba_excel", rc == 0)
    o, e, rc = tx(ADMIN, f"select public.archivar_oc({lit(OC)}, 'Prueba Excel');\n", commit=True); chk("oc_archivada_para_prueba_excel", rc == 0)

print("\nRESUMEN:", "TODO OK" if not F else f"{len(F)} FALLA(S): " + ", ".join(F))
raise SystemExit(1 if F else 0)
