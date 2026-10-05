"""Validación de importar_entidades_catalogo sobre la COPIA del backup (PostgreSQL efímero). No imprime filas ni IDs."""
import json, os, subprocess, sys, threading, time

ENV = dict(os.environ)
RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
MIG = os.path.join(RAIZ, "2026-10-05-importar-entidades.sql")
UND = os.path.join(RAIZ, "2026-10-05-importar-entidades-deshacer.sql")
BOR = os.path.join(RAIZ, "BORRADOR-rls-entidades-catalogo.sql")
RES, FALLAS = [], []

def psql(sql, tuples=True):
    p = subprocess.run([ENV.get("PSQL", "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t", "-F", "|"], input=sql, capture_output=True, text=True, env=ENV)
    return p.stdout.strip(), p.stderr.strip(), p.returncode

def q(sql):
    o, e, rc = psql(sql)
    if rc: raise RuntimeError(e[:300])
    return o

def chk(nombre, ok, detalle=""):
    print(("PASS " if ok else "FALLA ") + nombre + ("" if ok else f" :: {detalle}"), flush=True)
    if not ok: FALLAS.append(nombre)

def dv(c):
    s, f = 0, 2
    for ch in reversed(c):
        s += int(ch) * f; f = 2 if f == 7 else f + 1
    r = 11 - s % 11
    return "0" if r == 11 else "K" if r == 10 else str(r)

def rut_valido(n): c = str(n); return f"{c}-{dv(c)}"
def dotted(n): c = str(n); return f"{int(c):,}".replace(",", ".") + "-" + dv(c)

def hash_tabla(): return q("select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.entidades_catalogo t")
def n_ent(): return int(q("select count(*) from public.entidades_catalogo"))
def sinuuid(sub): return sub

ADMIN = q("select id from public.perfiles where rol='admin' limit 1")
USUARIO = q("select id from public.perfiles where rol<>'admin' limit 1")

def sesion(sub, rol="authenticated"):
    pre = f"set role {rol};\n"
    if sub:
        pre += f"select 1 as x from (select set_config('request.jwt.claim.sub','{sub}',true), set_config('request.jwt.claims','{json.dumps({'sub': sub, 'role': rol})}',true), set_config('request.jwt.claim.role','{rol}',true)) s \\gset\n"
    return pre

def rpc(ops, sub=ADMIN, simular=False, rol="authenticated", extra=""):
    """Llama a la RPC en su propia transacción. Devuelve (resp|None, err|None, sqlstate)."""
    pay = json.dumps({"version": 1, "operaciones": ops}).replace("'", "''")
    sql = f"begin;\n{sesion(sub, rol)}{extra}select public.importar_entidades_catalogo('{pay}'::jsonb, {str(simular).lower()});\ncommit;\n"
    o, e, rc = psql(sql)
    if rc:
        m = [l for l in e.splitlines() if "ERROR" in l]
        return None, (m[0] if m else e)[:300], e
    return json.loads([l for l in o.splitlines() if l.startswith("{")][-1]), None, ""

def op(fila, rut, nombre="Entidad", comuna=None, contacto=None, correo=None):
    return {"fila": fila, "rut": rut, "nombre_entidad": nombre, "comuna": comuna, "contacto": contacto, "correo": correo}

# ruts libres (no existentes en el catálogo, por clave normalizada)
usados = set(q("select regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') from public.entidades_catalogo").splitlines())
def libres(n, base=70000000):
    out, c = [], base
    while len(out) < n:
        c += 1
        if (str(c) + dv(str(c))) not in usados: out.append(c)
    return out

print("===== PREPARACIÓN =====", flush=True)
psql("""grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;""")
psql("drop table if exists public.zz_ent_orig; create table public.zz_ent_orig as select * from public.entidades_catalogo;")
HORIG = q("select md5(string_agg(t::text,'|' order by id)) from public.zz_ent_orig t")
def hash_orig(): return q("select md5(string_agg(t::text,'|' order by id)) from public.entidades_catalogo t where id in (select id from public.zz_ent_orig)")
N0 = n_ent(); H0 = hash_tabla()
grupos = q("""select count(*) from (select 1 from public.entidades_catalogo group by regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') having count(*)>1) g""")
print(f"entidades={N0} grupos_duplicados_normalizados={grupos} admin={'si' if ADMIN else 'NO'} usuario_normal={'si' if USUARIO else 'NO'}", flush=True)
o, e, rc = psql(open(MIG).read()); chk("migracion_instalada_en_la_copia", rc == 0, e)
chk("security_invoker", q("select prosecdef from pg_proc where proname='importar_entidades_catalogo'") == "f")
chk("ejecucion_solo_authenticated", q("select coalesce(string_agg(grantee,',' order by grantee),'') from information_schema.routine_privileges where routine_name='importar_entidades_catalogo' and grantee in ('anon','public','PUBLIC','authenticated')") == "authenticated")
chk("migracion_no_cambia_datos", hash_tabla() == H0)

print("\n===== SEGURIDAD =====", flush=True)
H = hash_tabla(); L = libres(3)
r, e, _ = rpc([op(2, dotted(L[0]), "X")], sub=USUARIO); chk("usuario_normal_rechazado_IE003", r is None and "solo el administrador" in (e or ""), e); chk("usuario_normal_0_cambios", hash_tabla() == H)
r, e, _ = rpc([op(2, dotted(L[0]), "X")], sub=None, rol="anon"); chk("anonimo_rechazado", r is None and ("permission denied" in (e or "").lower()), e); chk("anonimo_0_cambios", hash_tabla() == H)
r, e, _ = rpc([op(2, dotted(L[0]), "X")], sub=None); chk("autenticado_sin_uid_rechazado_IE003", r is None and "sesión válida" in (e or ""), e)
r, e, _ = rpc([op(2, dotted(L[0]), "X")], sub="00000000-0000-0000-0000-000000000000"); chk("uid_sin_perfil_rechazado", r is None and "solo el administrador" in (e or ""), e)

print("\n===== VALIDACIONES DEL SERVIDOR =====", flush=True)
casos = {
 "payload_vacio": [], "dv_incorrecto": [op(2, "76.123.456-9", "X")], "rut_vacio": [op(2, "", "X")], "rut_corto": [op(2, "1-9", "X")],
 "nombre_vacio": [op(2, dotted(L[0]), "  ")], "correo_invalido": [op(2, dotted(L[0]), "X", correo="nada")],
 "texto_largo": [op(2, dotted(L[0]), "x" * 201)],
 "campo_extra": [{**op(2, dotted(L[0]), "X"), "id": "hack"}], "tabla_arbitraria": [{**op(2, dotted(L[0]), "X"), "tabla": "perfiles"}],
 "tipo_invalido": [{**op(2, dotted(L[0]), "X"), "comuna": 5}],
}
for k, ops in casos.items():
    r, e, _ = rpc(ops); chk(f"servidor_rechaza_{k}", r is None and "IMPORTACION_CANCELADA" in (e or ""), e)
chk("servidor_rechazos_0_cambios", hash_tabla() == H)
r, e, _ = rpc([op(2, dotted(L[0]), "X"), op(3, rut_valido(L[0]).replace("-", ""), "Y")]); chk("duplicado_interno_con_y_sin_puntos", r is None and "repetido" in (e or ""), e)
r, e, _ = rpc([op(2, dotted(L[0]), "X"), op(3, "7" + str(L[0])[1:] + dv(str(L[0])).lower(), "Y")]); chk("duplicado_interno_con_k_minuscula_o_dv", r is None, e)
chk("duplicados_internos_0_cambios", hash_tabla() == H)

print("\n===== SIMULACIÓN, CREAR, IDEMPOTENCIA =====", flush=True)
ops3 = [op(2, dotted(L[0]), "Nueva A", "Santiago", "Ana", "a@x.cl"), op(3, rut_valido(L[1]), "Nueva B"), op(4, dotted(L[2]), "Nueva C", "Ñuñoa")]
r, e, _ = rpc(ops3, simular=True); chk("simulacion_cuenta_y_no_escribe", r and r["creadas"] == 3 and r["simulado"] is True and hash_tabla() == H, e)
r, e, _ = rpc(ops3); chk("importar_3_nuevas", r and r["creadas"] == 3 and r["actualizadas"] == 0 and n_ent() == N0 + 3, e)
chk("nuevas_con_formato_y_creado_por", q(f"select count(*) from public.entidades_catalogo where rut in ('{dotted(L[0])}','{dotted(L[1])}','{dotted(L[2])}') and creado_por='{ADMIN}'::uuid") == "3")
chk("nuevas_con_id_ent", q(f"select count(*) from public.entidades_catalogo where rut='{dotted(L[0])}' and id like 'ent\\_%'") == "1")
H1 = hash_tabla()
r, e, _ = rpc(ops3); chk("reimportar_0_cambios", r and r["creadas"] == 0 and r["actualizadas"] == 0 and r["sin_cambios"] == 3 and hash_tabla() == H1, e)
r, e, _ = rpc([op(2, rut_valido(L[0]), "Nueva A", "Santiago", "Ana", "a@x.cl"), op(3, dotted(L[1]).lower(), "Nueva B")]); chk("mismo_rut_con_y_sin_puntos_no_duplica", r and r["creadas"] == 0 and r["sin_cambios"] == 2 and n_ent() == N0 + 3 and hash_tabla() == H1, e)

L7 = [c for c in libres(40, 5000000) if c < 10000000][:1]
r, e, _ = rpc([op(2, rut_valido(L7[0]), "Siete digitos")]); chk("nueva_de_7_digitos_formato_x.xxx.xxx-d", r and r["creadas"] == 1 and q(f"select count(*) from public.entidades_catalogo where rut='{dotted(L7[0])}'") == "1", e)
N0 += 1
print("\n===== ACTUALIZAR SIN VACIAR =====", flush=True)
r, e, _ = rpc([op(2, dotted(L[0]), "Nueva A renombrada", None, None, None)]); chk("update_solo_nombre", r and r["actualizadas"] == 1, e)
chk("update_no_vacia_campos", q(f"select comuna||'|'||contacto||'|'||correo||'|'||nombre_entidad from public.entidades_catalogo where rut='{dotted(L[0])}'") == "Santiago|Ana|a@x.cl|Nueva A renombrada")
r, e, _ = rpc([op(2, dotted(L[0]), "Nueva A renombrada", "", "  ", "")]); chk("campos_vacios_no_borran", r and r["sin_cambios"] == 1 and q(f"select comuna||'|'||contacto||'|'||correo from public.entidades_catalogo where rut='{dotted(L[0])}'") == "Santiago|Ana|a@x.cl", e)
r, e, _ = rpc([op(2, dotted(L[0]), "Nueva A renombrada", "Maipú")]); chk("update_con_valor_cambia_solo_ese_campo", r and r["actualizadas"] == 1 and q(f"select comuna||'|'||contacto||'|'||correo from public.entidades_catalogo where rut='{dotted(L[0])}'") == "Maipú|Ana|a@x.cl", e)
chk("update_no_cambia_rut_ni_id_ni_creado_por", q(f"select count(*) from public.entidades_catalogo where rut='{dotted(L[0])}' and creado_por='{ADMIN}'::uuid") == "1")

print("\n===== COINCIDENCIA CON RUT HISTÓRICOS (distintos formatos) =====", flush=True)
# entidad existente (única por clave) con RUT válido y distinto formato
filas = q("""select id||'|'||rut from public.entidades_catalogo e where id not in (select id from public.entidades_catalogo where false)
  and regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') in (
    select regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') from public.entidades_catalogo group by 1 having count(*)=1)""").splitlines()
def valido_db(rut):
    import re
    l = re.sub(r"[\s.\-]", "", rut).upper()
    return bool(re.fullmatch(r"[0-9]{7,8}[0-9K]", l)) and dv(l[:-1]) == l[-1]
hist = [(i, r) for i, r in (f.split("|", 1) for f in filas) if valido_db(r)]
guion = next((x for x in hist if "." not in x[1] and "-" in x[1]), None)
con_k = next((x for x in hist if x[1].upper().endswith("K")), None)
punt = next((x for x in hist if "." in x[1]), None)
for nom, x in (("hist_solo_guion", guion), ("hist_con_puntos", punt), ("hist_con_k", con_k)):
    if not x: print(f"INFO sin ejemplo {nom}"); continue
    import re
    l = re.sub(r"[\s.\-]", "", x[1]).upper(); cuerpo = l[:-1]
    Hn = hash_tabla(); nombre_ant = q(f"select nombre_entidad from public.entidades_catalogo where id='{x[0]}'")
    variantes = [f"{cuerpo}-{l[-1]}", f"{cuerpo}{l[-1]}".lower(), dotted(cuerpo)[:-1] + l[-1].lower(), "  " + dotted(cuerpo) + " "]
    ok = True
    for v in variantes:
        r, e, _ = rpc([op(2, v, nombre_ant)]); ok = ok and r is not None and r["creadas"] == 0 and r["sin_cambios"] == 1
    chk(f"{nom}_coincide_en_todas_las_variantes_sin_crear", ok and n_ent() == N0 + 3 and hash_tabla() == Hn)
    r, e, _ = rpc([op(2, variantes[1], nombre_ant + " (ed)")]); chk(f"{nom}_update_conserva_rut_historico", r and r["actualizadas"] == 1 and q(f"select rut from public.entidades_catalogo where id='{x[0]}'") == x[1], e)
    psql(f"update public.entidades_catalogo set nombre_entidad='{nombre_ant.replace(chr(39), chr(39)*2)}' where id='{x[0]}'")

print("\n===== AMBIGUOS (los 51 grupos históricos) =====", flush=True)
dup = q("""select k||'|'||min(rut) from (select regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') k, rut from public.entidades_catalogo) x group by k having count(*)>1""").splitlines()
dup_validos = [d.split("|") for d in dup if valido_db(d.split("|")[1])]
chk("grupos_duplicados_presentes", len(dup) >= 1, str(len(dup)))
Hd = hash_tabla(); amb_ok = 0; amb_0 = True
for clave, rut in dup_validos:
    r, e, _ = rpc([op(2, rut_valido(clave[:-1]), "X")], simular=True); a = r is None and "duplicado histórico" in (e or "")
    r2, e2, _ = rpc([op(2, rut_valido(clave[:-1]), "X")]); b = r2 is None and "duplicado histórico" in (e2 or "")
    amb_ok += 1 if a and b else 0
chk(f"cada_grupo_valido_es_ambiguo_y_no_escribe ({amb_ok}/{len(dup_validos)})", amb_ok == len(dup_validos) and hash_tabla() == Hd)
if dup_validos:
    c, rut = dup_validos[0]; Lx = libres(2, 71000000)
    r, e, _ = rpc([op(2, dotted(Lx[0]), "Nueva valida"), op(3, rut_valido(c[:-1]), "X"), op(4, dotted(Lx[1]), "Otra valida")])
    chk("ambiguo_en_medio_cancela_todo_0_cambios", r is None and hash_tabla() == Hd, e)

print("\n===== ATOMICIDAD: error primera / mitad / última operación =====", flush=True)
Ha = hash_tabla(); Lm = libres(10, 72000000)
base = [op(i + 2, dotted(Lm[i]), f"Atom {i}") for i in range(9)]
for nombre, pos in (("primera", 0), ("mitad", 4), ("ultima", 9)):
    ops = list(base); ops.insert(pos, op(99, "76.123.456-9", "MALA"))
    r, e, _ = rpc(ops); chk(f"error_en_{nombre}_operacion_0_cambios", r is None and "dígito verificador" in (e or "") and hash_tabla() == Ha, e)
# error de BASE en medio (trigger temporal) => todo revertido
psql("""create or replace function public.tmp_falla_ent() returns trigger language plpgsql as $$ begin if new.nombre_entidad='FORZAR_ERROR_BASE' then raise unique_violation using message='unique forzado'; end if; return new; end $$;
create trigger tmp_falla_ent before insert on public.entidades_catalogo for each row execute function public.tmp_falla_ent();""")
ops = list(base); ops.insert(5, op(77, dotted(Lm[9]), "FORZAR_ERROR_BASE"))
r, e, _ = rpc(ops); chk("error_de_base_UNIQUE_en_medio_0_cambios", r is None and "IMPORTACION_CANCELADA" in (e or "") and hash_tabla() == Ha, e)
psql("drop trigger tmp_falla_ent on public.entidades_catalogo; drop function public.tmp_falla_ent();")
# conflicto concurrente: otra sesión con INSERT sin confirmar; la importación espera el bloqueo y falla con lock_timeout => 0 cambios
Lc = libres(1, 73000000)[0]
hold = subprocess.Popen([ENV.get("PSQL", "psql"), "-X", "-q", "-v", "ON_ERROR_STOP=1"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=True, env=ENV)
hold.stdin.write(f"begin; insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_hold_x','{dotted(Lc)}','HOLD'); select pg_sleep(8); rollback;\n"); hold.stdin.flush(); time.sleep(2)
r, e, _ = rpc([op(2, dotted(Lc), "Conc")], extra="set local lock_timeout='1500ms';\n"); chk("conflicto_concurrente_falla_y_no_escribe", r is None and "IMPORTACION_CANCELADA" in (e or ""), e)
hold.wait(); chk("conflicto_concurrente_0_cambios", hash_tabla() == Ha)

print("\n===== LÍMITE 499 / 500 / 501 =====", flush=True)
for n in (499, 500, 501):
    Lb = libres(n, 74000000 + n * 1000); Hb = hash_tabla(); Nb = n_ent()
    ops = [op(i + 2, dotted(Lb[i]), f"Lote {n}-{i}") for i in range(n)]
    t0 = time.time(); r, e, _ = rpc(ops); dt = time.time() - t0
    if n < 501: chk(f"limite_{n}_acepta_y_crea", r and r["creadas"] == n and n_ent() == Nb + n, e); print(f"  tiempo {n} ops: {dt:.1f}s", flush=True)
    else: chk("limite_501_rechazado_IE004_0_cambios", r is None and "máximo 500" in (e or "") and hash_tabla() == Hb, e)
    if n == 500:
        r2, e2, _ = rpc(ops); chk("limite_500_reimportar_0_cambios", r2 and r2["sin_cambios"] == 500 and r2["creadas"] == 0, e2)
    if n == 501:
        r3, e3, _ = rpc(ops, simular=True); chk("limite_501_tambien_rechazado_en_simulacion", r3 is None and "máximo 500" in (e3 or ""), e3)

print("\n===== INTEGRIDAD =====", flush=True)
chk("sin_ruts_duplicados_exactos", q("select count(*) from (select rut from public.entidades_catalogo group by rut having count(*)>1) g") == "0")
chk("grupos_historicos_intactos", q("""select count(*) from (select 1 from public.entidades_catalogo group by regexp_replace(regexp_replace(upper(rut),'[^0-9K]','','g'),'^0+(?=.)','') having count(*)>1) g""") == grupos)
chk("ninguna_entidad_historica_borrada_ni_modificada_(hash_de_las_%d_originales)" % N0, hash_orig() == HORIG)

print("\n===== RLS: BORRADORES A y B (solo en la copia) =====", flush=True)
import re
txt = open(BOR).read()
def bloque(nombre):
    ini = txt.index(f"-- ===== OPCIÓN {nombre} =====") + len(f"-- ===== OPCIÓN {nombre} =====")
    fin = txt.find("-- =====", ini); fin = fin if fin > 0 else txt.index("-- Deshacer")
    return "\n".join(l[3:] if l.startswith("-- ") else l for l in txt[ini:fin].splitlines())
RESTAURAR = "drop policy if exists ent_leer on public.entidades_catalogo; drop policy if exists ent_insertar on public.entidades_catalogo; drop policy if exists ent_actualizar on public.entidades_catalogo; drop policy if exists ent_borrar_admin on public.entidades_catalogo; drop policy if exists ent_insertar_admin on public.entidades_catalogo; drop policy if exists ent_actualizar_admin on public.entidades_catalogo; drop policy if exists rw_autenticados_entidades on public.entidades_catalogo; create policy rw_autenticados_entidades on public.entidades_catalogo for all to public using (auth.role() = 'authenticated'::text);"
def como(sub, sql):
    o, e, rc = psql(f"begin;\n{sesion(sub)}{sql}\nrollback;\n"); return rc == 0, e
Lr = libres(6, 75000000)
fila = lambda n, x: f"insert into public.entidades_catalogo(id,rut,nombre_entidad,creado_por) values ('ent_t{n}','{dotted(x)}','T','{USUARIO}'::uuid)"
for nom, esperado_usuario_ins in (("A", False), ("B", True)):
    o, e, rc = psql(bloque(nom)); chk(f"borrador_{nom}_aplica_en_la_copia", rc == 0, e)
    ok, e = como(USUARIO, f"select count(*) from public.entidades_catalogo;"); chk(f"borrador_{nom}_usuario_normal_lee", ok, e)
    ok, e = como(USUARIO, fila(1, Lr[0]) + ";"); print(f"  INFO borrador {nom}: usuario normal INSERT directo (flujo OC) {'PERMITIDO' if ok else 'BLOQUEADO'}", flush=True)
    chk(f"borrador_{nom}_flujo_OC_usuario_normal_{'funciona' if esperado_usuario_ins else 'se_rompe (demostrado)'}", ok == esperado_usuario_ins, e)
    ok, e = como(USUARIO, f"update public.entidades_catalogo set comuna='x' where id=(select id from public.entidades_catalogo limit 1);select 1 from public.entidades_catalogo where comuna='x' and false;")
    ok_upd, _ = como(USUARIO, "with u as (update public.entidades_catalogo set comuna='x' where id=(select id from public.entidades_catalogo order by id limit 1) returning 1) select 1/(select count(*) from u);")
    chk(f"borrador_{nom}_usuario_normal_UPDATE_{'funciona' if esperado_usuario_ins else 'bloqueado'}", ok_upd == esperado_usuario_ins)
    ok_del, _ = como(USUARIO, "with d as (delete from public.entidades_catalogo where id=(select id from public.entidades_catalogo order by id limit 1) returning 1) select 1/(select count(*) from d);"); chk(f"borrador_{nom}_usuario_normal_DELETE_bloqueado", not ok_del)
    ok_del_a, e = como(ADMIN, "with d as (delete from public.entidades_catalogo where id=(select id from public.entidades_catalogo order by id limit 1) returning 1) select 1/(select count(*) from d);"); chk(f"borrador_{nom}_admin_DELETE_permitido", ok_del_a, e)
    ok, e = como(ADMIN, fila(2, Lr[1]) + ";"); chk(f"borrador_{nom}_admin_INSERT_permitido", ok, e)
    Hr = hash_tabla(); Lq = libres(1, 76000000 + (1 if nom == "A" else 2) * 1000)[0]
    r, e, _ = rpc([op(2, dotted(Lq), "Con RLS " + nom)]); chk(f"borrador_{nom}_RPC_admin_funciona", r and r["creadas"] == 1, e)
    r, e, _ = rpc([op(2, dotted(Lq), "X")], sub=USUARIO); chk(f"borrador_{nom}_RPC_usuario_normal_rechazado", r is None, e)
    psql(RESTAURAR)
chk("politica_original_restaurada", q("select count(*) from pg_policies where tablename='entidades_catalogo' and policyname='rw_autenticados_entidades'") == "1")

print("\n===== ROLLBACK DE LA MIGRACIÓN =====", flush=True)
Hz = hash_tabla(); pol0 = q("select string_agg(policyname||cmd,',' order by policyname) from pg_policies where tablename='entidades_catalogo'")
o, e, rc = psql(open(UND).read()); chk("rollback_ejecuta", rc == 0, e)
chk("rollback_retira_la_funcion", q("select count(*) from pg_proc where proname='importar_entidades_catalogo'") == "0")
chk("rollback_no_toca_datos_ni_politicas", hash_tabla() == Hz and q("select string_agg(policyname||cmd,',' order by policyname) from pg_policies where tablename='entidades_catalogo'") == pol0)
o, e, rc = psql(open(MIG).read()); chk("reinstalacion_tras_rollback", rc == 0, e)
o, e, rc = psql(open(UND).read()); chk("rollback_idempotente", rc == 0, e)

psql("drop table if exists public.zz_ent_orig;")
print(f"\nRESULTADO: {'TODO OK' if not FALLAS else 'FALLAS: ' + ', '.join(FALLAS)}", flush=True)
sys.exit(1 if FALLAS else 0)
