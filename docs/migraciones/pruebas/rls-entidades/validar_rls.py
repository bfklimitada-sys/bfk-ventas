"""Pruebas de Migración A (RPC registrar_entidad_desde_oc) y Migración B (RLS solo admin) sobre la COPIA restaurada.
No imprime filas reales, IDs de perfiles, contactos ni correos."""
import json, os, subprocess, sys, threading, time
D = os.path.dirname(os.path.abspath(__file__)); M = os.path.join(D, "..", "..")
A = os.path.join(M, "2026-10-05-rpc-entidad-desde-oc.sql"); AU = os.path.join(M, "2026-10-05-rpc-entidad-desde-oc-deshacer.sql")
B = os.path.join(M, "2026-10-05-rls-entidades-admin.sql"); BU = os.path.join(M, "2026-10-05-rls-entidades-admin-deshacer.sql")
IMP = os.path.join(M, "2026-10-05-importar-entidades.sql")
F = []
def run(sql, single=False):
    p = subprocess.run(["psql","-X","-q","-v","ON_ERROR_STOP=1","-A","-t"] + (["--single-transaction"] if single else []), input=sql, capture_output=True, text=True)
    return p.stdout.strip(), p.stderr.strip(), p.returncode
def q(sql):
    o, e, rc = run(sql)
    if rc: raise RuntimeError(e[:300])
    return o
def chk(n, ok, d=""):
    print(("PASS " if ok else "FALLA ") + n + ("" if ok else f" :: {str(d)[:300]}"), flush=True)
    if not ok: F.append(n)
def dv(b):
    s, f = 0, 2
    for c in reversed(b): s += int(c) * f; f = 2 if f == 7 else f + 1
    r = 11 - s % 11; return "0" if r == 11 else "K" if r == 10 else str(r)
def canon(b): return f"{int(b):,}".replace(",", ".") + "-" + dv(b)
K = "regexp_replace(regexp_replace(upper(coalesce({c},'')),'[^0-9K]','','g'),'^0+(?=.)','')"
ADMIN = q("select id from public.perfiles where rol='admin' limit 1"); USR = q("select id from public.perfiles where rol is distinct from 'admin' limit 1")
def ses(sub, rol="authenticated"):
    s = f"set local role {rol};\n"
    if sub: s += f"select set_config('request.jwt.claim.sub','{sub}',true), set_config('request.jwt.claim.role','{rol}',true), set_config('request.jwt.claims','{json.dumps({'sub':sub,'role':rol})}',true) \\g /dev/null\n"
    return s
def lit(v): return "null" if v is None else "'" + str(v).replace("'", "''") + "'"
def rpc_sql(rut, nom=None, com=None, con=None, cor=None):
    return f"select public.registrar_entidad_desde_oc({lit(rut)},{lit(nom)},{lit(com)},{lit(con)},{lit(cor)});\n"
def en_tx(sub, cuerpo, rol="authenticated", commit=False):
    o, e, rc = run(f"begin;\n{ses(sub, rol)}{cuerpo}{'commit' if commit else 'rollback'};\n")
    return o, e, rc
def j(o):
    l = [x for x in o.splitlines() if x.startswith("{")]; return json.loads(l[0]) if l else None
def estado():
    return {"ent": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.entidades_catalogo t"),
            "oc": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.ordenes_compra_v2 t"),
            "cc": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.contactos_cobranza t"),
            "pol": q("select coalesce(string_agg(policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'-')||'|'||coalesce(with_check,'-'),' ;; ' order by policyname),'') from pg_policies where schemaname='public' and tablename='entidades_catalogo'"),
            "otras_pol": q("select md5(coalesce(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''),';' order by tablename,policyname),'')) from pg_policies where schemaname='public' and tablename<>'entidades_catalogo'"),
            "fn": q("select md5(coalesce(string_agg(proname||md5(pg_get_functiondef(oid)),';' order by proname),'')) from pg_proc where proname in ('importar_respaldo_excel','gestionar_bloqueo_oc','importar_entidades_catalogo','normalizar_rut_entidad')"),
            "trg": q("select coalesce(string_agg(tgname::text||tgenabled::text,';'),'-') from pg_trigger where tgrelid='public.entidades_catalogo'::regclass and not tgisinternal"),
            "rpc": q("select count(*) from pg_proc where proname='registrar_entidad_desde_oc'")}
def libres(n, base):
    usados = set(q(f"select {K.format(c='rut')} from public.entidades_catalogo").splitlines()); out = []; c = base
    while len(out) < n:
        c += 1
        if str(c) + dv(str(c)) not in usados: out.append(str(c))
    return out

print("===== PREPARACIÓN =====")
q("grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role; grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;")
if q("select count(*) from pg_proc where proname='importar_entidades_catalogo'") == "0":
    o, e, rc = run(open(IMP).read(), single=True); chk("rpc_importador_presente_en_copia", rc == 0, e)
S0 = estado()
print("antes:", {k: S0[k] for k in ("ent", "oc", "cc", "trg", "rpc")}); print("politicas antes:", S0["pol"])
chk("estado_inicial_esperado (199 entidades, 286 OCs, 45 contactos)", S0["ent"].startswith("199|") and S0["oc"].startswith("286|") and S0["cc"].startswith("45|"))
chk("politica_original_unica", S0["pol"] == "rw_autenticados_entidades|ALL|{public}|(auth.role() = 'authenticated'::text)|-", S0["pol"])
EXIST = json.loads(q("select json_build_object('id',id,'rut',rut) from public.entidades_catalogo where rut ~ '^[0-9]{2}\\.' order by id limit 1"))
L = libres(6, 79300000)

print("\n===== MIGRACIÓN B ANTES DE A (debe abortar) =====")
o, e, rc = run(open(B).read(), single=True); chk("B_sin_A_aborta", rc != 0 and "MIGRACION_B_ABORTADA" in e, e[-200:])

print("\n===== MIGRACIÓN A =====")
o, e, rc = run(open(A).read(), single=True); chk("A_aplicada", rc == 0, e[-300:])
SA = estado()
chk("A_no_cambia_datos_ni_politicas_ni_otras_funciones", all(SA[k] == S0[k] for k in ("ent", "oc", "cc", "pol", "otras_pol", "fn", "trg")))
info = q("select prosecdef::text||'|'||array_to_string(proconfig,',')||'|'||pg_get_userbyid(proowner)||'|'||has_function_privilege('anon',oid,'execute')::text||'|'||has_function_privilege('public',oid,'execute')::text||'|'||has_function_privilege('authenticated',oid,'execute')::text from pg_proc where proname='registrar_entidad_desde_oc'")
chk("rpc_security_definer_search_path_fijo_owner_postgres_solo_authenticated", info == "true|search_path=public, pg_temp|postgres|false|false|true", info)
o, e, rc = run(open(A).read(), single=True); chk("A_reaplicar_aborta", rc != 0 and "MIGRACION_A_ABORTADA" in e)
o, e, rc = en_tx(USR, rpc_sql(L[0] + "-" + dv(L[0]), "PRUEBA A", "LAJA"))
chk("con_A_y_politica_antigua_usuario_normal_crea_por_RPC", (j(o) or {}).get("accion") == "creada", e[-200:])

print("\n===== MIGRACIÓN B =====")
o, e, rc = run(open(B).read(), single=True); chk("B_aplicada", rc == 0, e[-300:])
SB = estado(); print("politicas despues de B:", SB["pol"])
chk("B_cuatro_politicas", SB["pol"].count("ent_") == 4 and "rw_autenticados_entidades" not in SB["pol"])
chk("B_no_cambia_datos_ni_otras_politicas_ni_funciones", all(SB[k] == S0[k] for k in ("ent", "oc", "cc", "otras_pol", "fn", "trg")))
o, e, rc = run(open(B).read(), single=True); chk("B_reaplicar_aborta", rc != 0 and "MIGRACION_B_ABORTADA" in e)

print("\n===== USUARIO NORMAL tras B =====")
R1 = L[1]; r_min = R1 + "-" + dv(R1).lower(); r_can = canon(R1)
cuerpo = rpc_sql(r_min, "ENTIDAD NUEVA", "LAJA", "Ana", "ana@x.cl") + f"select 'FILA|'||rut||'|'||nombre_entidad||'|'||comuna||'|'||(creado_por='{USR}'::uuid)::text from public.entidades_catalogo where {K.format(c='rut')}='{R1+dv(R1)}';\n"
o, e, rc = en_tx(USR, cuerpo)
chk("normal_RPC_crea_con_RUT_canonico_y_creado_por", (j(o) or {}).get("accion") == "creada" and f"FILA|{r_can}|ENTIDAD NUEVA|LAJA|true" in o, o + e[-200:])
cuerpo = (rpc_sql(r_min, "ENTIDAD NUEVA", "LAJA", "Ana", "ana@x.cl")
          + rpc_sql(R1 + dv(R1), "ENTIDAD NUEVA", "CONCEPCION", "", "")          # sin puntos ni guion: misma entidad
          + rpc_sql(r_can, "  ", "", None, "   ")                                 # vacíos: no deben borrar nada
          + rpc_sql(r_can, "ENTIDAD NUEVA", "CONCEPCION", "Ana", "ana@x.cl")      # iguales: sin cambios
          + f"select 'FILA|'||count(*)||'|'||max(rut)||'|'||max(nombre_entidad)||'|'||max(comuna)||'|'||max(contacto)||'|'||max(correo) from public.entidades_catalogo where {K.format(c='rut')}='{R1+dv(R1)}';\n")
o, e, rc = en_tx(USR, cuerpo); rs = [json.loads(x) for x in o.splitlines() if x.startswith("{")]
acc = [r.get("accion") for r in rs]
chk("normal_RPC_actualiza_solo_campo_con_valor (k/K, con y sin puntos)", acc == ["creada", "actualizada", "sin_cambios", "sin_cambios"] and rs[1].get("campos") == ["comuna"], acc)
chk("normal_RPC_vacios_no_borran_datos_y_RUT_no_cambia", f"FILA|1|{r_can}|ENTIDAD NUEVA|CONCEPCION|Ana|ana@x.cl" in o, o + e[-200:])
# entidad existente real: la RPC nunca cambia su RUT ni vacía campos
antes = q(f"select md5(t::text) from public.entidades_catalogo t where id='{EXIST['id']}'")
b_ex = "".join(ch for ch in EXIST["rut"] if ch.isdigit() or ch == "K")
o, e, rc = en_tx(USR, rpc_sql(b_ex, "", "", "", "") + rpc_sql(b_ex[:-1] + "-" + b_ex[-1].lower(), None, None, None, None)
                 + f"select 'MD5|'||md5(t::text) from public.entidades_catalogo t where id='{EXIST['id']}';\n")
chk("normal_RPC_sobre_entidad_existente_con_vacios_no_modifica_nada", [r.get("accion") for r in [json.loads(x) for x in o.splitlines() if x.startswith("{")]] == ["sin_cambios", "sin_cambios"] and f"MD5|{antes}" in o, o + e[-200:])
o, e, rc = en_tx(USR, rpc_sql(b_ex, "NOMBRE CAMBIADO POR OC") + f"select 'RUT|'||rut from public.entidades_catalogo where id='{EXIST['id']}';\n")
chk("normal_RPC_puede_actualizar_nombre_pero_el_RUT_queda_igual", (j(o) or {}).get("accion") == "actualizada" and f"RUT|{EXIST['rut']}" in o, o + e[-200:])
n0 = q("select count(*) from public.entidades_catalogo")
for nombre, rut in (("dv_incorrecto", R1 + ("0" if dv(R1) != "0" else "1")), ("texto", "abc"), ("corto", "123-4"), ("cero_inicial_dv_mal", "0" + R1 + "X")):
    o, e, rc = en_tx(USR, rpc_sql(rut, "X") + "select 'N|'||count(*) from public.entidades_catalogo;\n")
    chk(f"normal_RPC_rut_invalido_{nombre}_no_crea_ni_actualiza", (j(o) or {}).get("accion") == "rut_invalido" and f"N|{n0}" in o, o + e[-200:])
o, e, rc = en_tx(USR, rpc_sql("", "X")); chk("normal_RPC_sin_rut", (j(o) or {}).get("accion") == "sin_rut")
o, e, rc = en_tx(USR, rpc_sql(r_can, "x" * 201)); chk("normal_RPC_texto_largo_rechazado", (j(o) or {}).get("accion") == "datos_invalidos")
o, e, rc = en_tx(USR, f"insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_dir1','{canon(L[2])}','X');\n")
chk("normal_INSERT_directo_rechazado", rc != 0 and "row-level security" in e, e[-200:])
o, e, rc = en_tx(USR, f"with u as (update public.entidades_catalogo set nombre_entidad='HACK', rut='1.111.111-1' where id='{EXIST['id']}' returning 1) select 'U|'||count(*) from u;\n")
chk("normal_UPDATE_directo_sin_efecto (0 filas)", "U|0" in o and rc == 0, o + e[-200:])
o, e, rc = en_tx(USR, f"with d as (delete from public.entidades_catalogo where id='{EXIST['id']}' returning 1) select 'D|'||count(*) from d;\n")
chk("normal_DELETE_directo_sin_efecto (0 filas)", "D|0" in o and rc == 0, o + e[-200:])
o, e, rc = en_tx(USR, f"select 'R|'||count(*) from public.entidades_catalogo;\n"); chk("normal_sigue_leyendo_el_catalogo", f"R|{n0}" in o)
# ambigüedad: dos filas del mismo RUT con distinto formato (creadas como dueño, sin trigger) -> la RPC no toca nada
R3 = L[3]
o, e, rc = run(f"""begin; alter table public.entidades_catalogo disable trigger normalizar_rut_entidad;
insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_amb1','{canon(R3)}','A1'),('ent_amb2','{R3}-{dv(R3)}','A2');
alter table public.entidades_catalogo enable trigger normalizar_rut_entidad;
{ses(USR)}{rpc_sql(R3 + dv(R3), 'NUEVO NOMBRE', 'X')}select 'AMB|'||string_agg(nombre_entidad,',' order by id) from public.entidades_catalogo where id in ('ent_amb1','ent_amb2');
rollback;""")
chk("normal_RPC_ambigua_no_toca_nada", (j(o) or {}).get("accion") == "ambigua" and "AMB|A1,A2" in o, o + e[-200:])

print("\n===== SIN SESIÓN / SIN PERFIL / ANÓNIMO =====")
o, e, rc = en_tx(None, rpc_sql(r_can, "X")); chk("autenticado_sin_uid_rechazado", rc != 0 and "sesión válida" in e, e[-200:])
o, e, rc = en_tx("00000000-0000-0000-0000-000000000000", rpc_sql(r_can, "X")); chk("uid_sin_perfil_rechazado", rc != 0 and "sin perfil" in e, e[-200:])
o, e, rc = en_tx(None, rpc_sql(r_can, "X"), rol="anon"); chk("anonimo_sin_permiso_de_ejecucion", rc != 0 and "permission denied" in e.lower(), e[-200:])
o, e, rc = en_tx(None, f"insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_anon','{canon(L[2])}','X');", rol="anon"); chk("anonimo_INSERT_rechazado", rc != 0)
o, e, rc = en_tx(None, "select 'A|'||count(*) from public.entidades_catalogo;\n", rol="anon"); chk("anonimo_no_lee", "A|0" in o, o)

print("\n===== ADMINISTRADOR tras B =====")
o, e, rc = en_tx(ADMIN, f"""insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_adm1','{L[4]}-{dv(L[4])}','ADM');
select 'I|'||rut from public.entidades_catalogo where id='ent_adm1';
with u as (update public.entidades_catalogo set comuna='ADMCOMUNA' where id='ent_adm1' returning 1) select 'U|'||count(*) from u;
with d as (delete from public.entidades_catalogo where id='ent_adm1' returning 1) select 'D|'||count(*) from d;
insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_adm2','{L[4]}{dv(L[4]).lower()}','ADM2');
""")
chk("admin_INSERT_directo (trigger normaliza)", f"I|{canon(L[4])}" in o, o + e[-200:])
chk("admin_UPDATE_y_DELETE_directos", "U|1" in o and "D|1" in o, o)
o, e, rc = en_tx(ADMIN, f"insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_adm1','{canon(L[4])}','A'),('ent_adm2','{L[4]}-{dv(L[4])}','B');")
chk("UNIQUE_impide_duplicado_por_formato_incluso_para_admin", rc != 0 and "duplicate key" in e, e[-200:])
pay = json.dumps({"version": 1, "operaciones": [{"fila": 2, "rut": canon(L[5]), "nombre_entidad": "IMP NUEVA"}]}).replace("'", "''")
o, e, rc = en_tx(ADMIN, f"select public.importar_entidades_catalogo('{pay}'::jsonb, false);\nselect 'IMP|'||count(*) from public.entidades_catalogo where rut='{canon(L[5])}';\n")
chk("importador_admin_escribe_tras_B", '"creadas": 1' in o and "IMP|1" in o, o + e[-200:])
o, e, rc = en_tx(USR, f"select public.importar_entidades_catalogo('{pay}'::jsonb, true);")
chk("importador_usuario_normal_sigue_rechazado", rc != 0 and "solo el administrador" in e, e[-200:])

print("\n===== CONCURRENCIA (dos usuarios normales, mismo RUT nuevo, formatos distintos, con COMMIT) =====")
R5 = libres(1, 79400000)[0]; res = {}
def llamar(nombre, rut):
    sql = f"begin;\n{ses(USR)}select pg_sleep(0.5);\n{rpc_sql(rut, 'CONC ' + nombre, 'LAJA')}commit;\n"
    res[nombre] = run(sql)
t1 = threading.Thread(target=llamar, args=("A", canon(R5))); t2 = threading.Thread(target=llamar, args=("B", R5 + dv(R5).lower()))
t1.start(); t2.start(); t1.join(); t2.join()
acc = sorted((j(res[k][0]) or {}).get("accion", "ERROR:" + res[k][1][-80:]) for k in res)
n = q(f"select count(*) from public.entidades_catalogo where {K.format(c='rut')}='{R5+dv(R5)}'")
chk("concurrencia_una_sola_entidad (creada + actualizada/sin_cambios)", n == "1" and acc[0] in ("actualizada", "sin_cambios") and acc[1] == "creada", (n, acc))
q(f"delete from public.entidades_catalogo where {K.format(c='rut')}='{R5+dv(R5)}'")   # limpieza de la prueba (como dueño)
chk("datos_identicos_tras_todas_las_pruebas", estado()["ent"] == S0["ent"] and estado()["oc"] == S0["oc"] and estado()["cc"] == S0["cc"])

print("\n===== ROLLBACK =====")
o, e, rc = run(open(AU).read()); chk("deshacer_A_antes_que_B_se_niega", rc != 0 and "Primero deshaga la Migración B" in e, e[-200:])
o, e, rc = run(open(BU).read()); chk("deshacer_B_ejecuta", rc == 0, e[-200:])
S1 = estado(); chk("deshacer_B_restaura_politica_original_exacta", S1["pol"] == S0["pol"], S1["pol"])
o, e, rc = en_tx(USR, f"insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_rb','{canon(L[2])}','X');select 'OK';\n")
chk("tras_deshacer_B_usuario_normal_vuelve_a_escribir_directo (comportamiento original)", rc == 0 and "OK" in o, e[-200:])
o, e, rc = run(open(AU).read()); chk("deshacer_A_ejecuta", rc == 0, e[-200:])
S2 = estado(); chk("rollback_completo_identico_al_inicial", all(S2[k] == S0[k] for k in S0), {k: (S0[k], S2[k]) for k in S0 if S0[k] != S2[k]})
print("\n===== REAPLICAR A+B Y DESHACER OTRA VEZ =====")
ok = run(open(A).read(), single=True)[2] == 0 and run(open(B).read(), single=True)[2] == 0
S3 = estado(); ok = ok and S3["pol"] == SB["pol"] and S3["ent"] == S0["ent"]
ok = ok and run(open(BU).read())[2] == 0 and run(open(AU).read())[2] == 0 and estado() == S0
chk("ciclo_completo_reaplicar_y_deshacer", ok)
print(f"\nRESULTADO: {'TODO OK' if not F else 'FALLAS: ' + ', '.join(F)}"); sys.exit(1 if F else 0)
