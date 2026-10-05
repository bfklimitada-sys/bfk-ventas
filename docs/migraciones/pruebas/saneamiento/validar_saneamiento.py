"""Prueba del saneamiento de entidades en la COPIA restaurada. No imprime contactos ni correos."""
import json, os, re, subprocess, sys
ENV = dict(os.environ); RAIZ = os.path.join(os.path.dirname(__file__), "..", "..")
MIG = os.path.join(RAIZ, "2026-10-05-saneamiento-entidades.sql"); UND = os.path.join(RAIZ, "2026-10-05-saneamiento-entidades-deshacer.sql")
RPC = os.path.join(RAIZ, "2026-10-05-importar-entidades.sql")
FALLAS = []
def run(sql, single=False):
    a = ["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t"] + (["--single-transaction"] if single else [])
    p = subprocess.run(a, input=sql, capture_output=True, text=True, env=ENV); return p.stdout.strip(), p.stderr.strip(), p.returncode
def q(sql):
    o, e, rc = run(sql)
    if rc: raise RuntimeError(e[:400])
    return o
def chk(n, ok, d=""):
    print(("PASS " if ok else "FALLA ") + n + ("" if ok else f" :: {str(d)[:300]}"), flush=True)
    if not ok: FALLAS.append(n)
CLAVE = "regexp_replace(regexp_replace(upper(coalesce({c},'')),'[^0-9K]','','g'),'^0+(?=.)','')"
IDS_OC = None
def estado():
    return {
      "ent": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.entidades_catalogo t"),
      "oc": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.ordenes_compra_v2 t"),
      "oc_sin_61606800": q("select md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.ordenes_compra_v2 t where id not in (" + IDS_OC + ")"),
      "cc": q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.contactos_cobranza t"),
      "otras": q("select md5(string_agg(c.relname||':'||c.reltuples::bigint::text, ',' order by c.relname)) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname not in ('entidades_catalogo','ordenes_compra_v2','contactos_cobranza','entidades_saneamiento_respaldo')"),
      "rpc_respaldo": q("select coalesce(max(md5(pg_get_functiondef(oid))),'-') from pg_proc where proname='importar_respaldo_excel'"),
      "rpc_bloqueo": q("select coalesce(max(md5(pg_get_functiondef(oid))),'-') from pg_proc where proname='gestionar_bloqueo_oc'"),
      "rpc_entidades": q("select coalesce(max(md5(pg_get_functiondef(oid))),'-') from pg_proc where proname='importar_entidades_catalogo'"),
      "politicas": q("select md5(coalesce(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''),';' order by tablename,policyname),'')) from pg_policies where schemaname='public'"),
    }
def asociaciones():
    """Por OC con RUT: cuántas entidades coinciden por RUT normalizado (0, 1, >1)."""
    return q(f"""select count(*) filter (where n=0)||'|'||count(*) filter (where n=1)||'|'||count(*) filter (where n>1) from (
      select o.id, (select count(*) from public.entidades_catalogo e where {CLAVE.format(c='e.rut')} = {CLAVE.format(c='o.rut_cliente')}) n
      from public.ordenes_compra_v2 o where btrim(coalesce(o.rut_cliente,''))<>'') x""")
def mapa_oc_ent():
    return dict(l.split("|") for l in q(f"""select o.id||'|'||coalesce(string_agg(e.id, ',' order by e.id),'') from public.ordenes_compra_v2 o
      left join public.entidades_catalogo e on {CLAVE.format(c='e.rut')} = {CLAVE.format(c='o.rut_cliente')}
      where btrim(coalesce(o.rut_cliente,''))<>'' group by o.id""").splitlines())

print("===== PREPARACIÓN DE LA COPIA =====")
IDS_OC = ",".join("'" + i + "'" for i in q("select id from public.ordenes_compra_v2 where upper(regexp_replace(coalesce(rut_cliente,''),'[\\s.\\-]','','g'))='616068006'").splitlines()) or "''"
o, e, rc = run(open(RPC).read(), single=True); chk("rpc_importar_entidades_instalada_en_copia (como en producción)", rc == 0, e)
A = estado(); AS0 = asociaciones(); M0 = mapa_oc_ent()
print("antes:", {k: v for k, v in A.items() if k in ("ent", "oc", "cc")}, "OC por n° de entidades (0|1|>1):", AS0)
chk("copia_igual_a_lo_diagnosticado", A["ent"] == "252|0b94e9c026f8bcb11496e4ce1e4e4ecb", A["ent"])

print("\n===== APLICAR SANEAMIENTO =====")
o, e, rc = run(open(MIG).read(), single=True)
for l in e.splitlines():
    if "NOTICE" in l: print("  " + l.split("NOTICE:")[-1].strip())
chk("saneamiento_aplicado_en_una_transaccion", rc == 0, e)
B = estado(); AS1 = asociaciones(); M1 = mapa_oc_ent()
print("después:", {k: v for k, v in B.items() if k in ("ent", "oc", "cc")}, "OC por n° de entidades (0|1|>1):", AS1)

print("\n===== VERIFICACIONES =====")
chk("entidades_252_a_211", B["ent"].startswith("211|"), B["ent"])
dups = q(f"select count(*) from (select {CLAVE.format(c='rut')} k from public.entidades_catalogo group by 1 having count(*)>1) x")
man = q(f"select count(*) from (select {CLAVE.format(c='rut')} k from public.entidades_catalogo group by 1 having count(*)>1) x where k not in (select grupo from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)")
chk("solo_quedan_duplicados_marcados_manual (12)", dups == "12" and man == "0", f"dups={dups} no_marcados={man}")
chk("mismo_numero_de_OCs", A["oc"].split("|")[0] == B["oc"].split("|")[0])
chk("OCs_identicas_salvo_la_del_RUT_61606800-6", A["oc_sin_61606800"] == B["oc_sin_61606800"])
chk("una_sola_OC_corregida", q("select count(*) from public.entidades_saneamiento_respaldo where tabla='ordenes_compra_v2'") == "1")
chk("contactos_cobranza_mismo_numero", A["cc"].split("|")[0] == B["cc"].split("|")[0])
chk("otras_tablas_sin_cambios", A["otras"] == B["otras"])
n0, n1, n2 = map(int, AS1.split("|")); a0, a1, a2 = map(int, AS0.split("|"))
chk("ninguna_OC_pierde_su_entidad (OCs sin entidad no aumentan)", n0 <= a0, f"antes={AS0} despues={AS1}")
perd = [k for k, v in M0.items() if v and not M1.get(k)]
chk("ninguna_OC_que_tenia_entidad_queda_sin_entidad", not perd, len(perd))
chk("OCs_con_mas_de_una_entidad_solo_en_grupos_manuales", n2 == int(q(f"""select count(*) from public.ordenes_compra_v2 o where {CLAVE.format(c='o.rut_cliente')} in (select grupo from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)""")), AS1)
print(f"  OCs con exactamente 1 entidad: {a1} -> {n1}; con más de una (manuales): {a2} -> {n2}; sin entidad: {a0} -> {n0}")
nul = q(f"select count(*)||'|'||count(*) filter (where {CLAVE.format(c='rut')} in (select grupo from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)) from public.entidades_catalogo where creado_por is null")
chk("creado_por_vacios: 52 -> 12, todos en grupos manuales (no se tocan)", nul == "12|12", nul)
chk("ruts_validos_en_formato_canonico_salvo_manuales", q(f"""select count(*) from public.entidades_catalogo where upper(regexp_replace(rut,'[\\s.\\-]','','g')) ~ '^[0-9]{{7,8}}[0-9K]$' and rut !~ '^[0-9]{{1,2}}\\.[0-9]{{3}}\\.[0-9]{{3}}-[0-9K]$' and rut <> '69001030-2' and {CLAVE.format(c='rut')} not in (select grupo from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)""") == "0")
chk("k_minuscula_0_fuera_de_manuales", q(f"select count(*) from public.entidades_catalogo where rut ~ 'k$' and {CLAVE.format(c='rut')} not in (select grupo from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)") == "0")
chk("invalidos_restantes_solo_69001030-2", q("select string_agg(rut, ',') from public.entidades_catalogo where upper(regexp_replace(rut,'[\\s.\\-]','','g')) !~ '^[0-9]{7,8}[0-9K]$' or rut in ('69001030-2')") == "69001030-2")
chk("registro_TEST_eliminado", q("select count(*) from public.entidades_catalogo where rut='Twst'") == "0")
chk("61606800-6_fusionado_en_61.606.800-8", q("select count(*) from public.entidades_catalogo where rut like '61%606%800%'") == "1" and q("select count(*) from public.ordenes_compra_v2 where rut_cliente='61.606.800-8'") == "2")
# sin pérdida de información: cada fila eliminada está íntegra en el respaldo y cada valor no vacío está en la canónica (normalizado) o fue un conflicto resuelto por OCs
chk("toda_fila_eliminada_respaldada_integra", q("""select count(*) from public.entidades_saneamiento_respaldo r where accion='eliminada' and tabla='entidades_catalogo'
   and fila_original = (select fila_original from public.entidades_saneamiento_respaldo o where o.accion='original' and o.fila_id=r.fila_id)""") == "41")
perdidos = q(r"""
with nt as (select r.fila_id, r.detalle, r.fila_original f, e.* from public.entidades_saneamiento_respaldo r join public.entidades_catalogo e on e.id = r.detalle->>'fusionada_en'
            where r.accion='eliminada' and r.detalle ? 'fusionada_en')
select count(*) from nt, lateral (values ('nombre_entidad', f->>'nombre_entidad', nombre_entidad), ('comuna', f->>'comuna', comuna), ('contacto', f->>'contacto', contacto), ('correo', f->>'correo', correo)) v(campo, viejo, nuevo)
where btrim(coalesce(viejo,''))<>'' and lower(btrim(viejo)) <> lower(btrim(coalesce(nuevo,'')))
  and coalesce(detalle->>campo,'') not like 'conflicto_resuelto%'
  and translate(lower(regexp_replace(btrim(viejo),'[.,;:\s]','','g')),'áéíóúñ','aeioun') <> translate(lower(regexp_replace(btrim(coalesce(nuevo,'')),'[.,;:\s]','','g')),'áéíóúñ','aeioun')""")
chk("ningun_dato_util_perdido (solo difieren valores resueltos por OCs, que quedan en el respaldo)", perdidos == "0", perdidos)
chk("respaldo_sin_acceso_para_authenticated_ni_anon", q("select not has_table_privilege('authenticated','public.entidades_saneamiento_respaldo','select') and not has_table_privilege('anon','public.entidades_saneamiento_respaldo','select')") == "t")
chk("rpc_importador_respaldos_intacta", A["rpc_respaldo"] == B["rpc_respaldo"])
chk("rpc_bloqueo_oc_intacta", A["rpc_bloqueo"] == B["rpc_bloqueo"])
chk("rpc_importar_entidades_intacta", A["rpc_entidades"] == B["rpc_entidades"])
chk("politicas_RLS_sin_cambios", A["politicas"] == B["politicas"])
print("  manuales:", q("select count(distinct grupo)||' grupos, '||count(*)||' filas' from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null"))
print("  motivos manuales:", q("select string_agg(distinct regexp_replace(detalle->>'motivo','=\\d+','=n','g'), ' || ') from public.entidades_saneamiento_respaldo where accion='manual'"))

print("\n===== TRIGGER Y RPC (en transacción con ROLLBACK) =====")
libre = q(f"""select c::text from generate_series(79100001,79100500) c where c::text || (select case r when 11 then '0' when 10 then 'K' else r::text end from (select 11 - (sum(substr(reverse(c::text), i, 1)::int * (2 + (i-1) % 6)) % 11) r from generate_series(1, length(c::text)) i) x)
  not in (select {CLAVE.format(c='rut')} from public.entidades_catalogo) limit 1""")
def dvp(b):
    s, f = 0, 2
    for ch in reversed(b): s += int(ch) * f; f = 2 if f == 7 else f + 1
    r = 11 - s % 11; return "0" if r == 11 else "K" if r == 10 else str(r)
R = f"{libre}-{dvp(libre)}"; RD = f"{int(libre):,}".replace(",", ".") + "-" + dvp(libre)
admin = q("select id from public.perfiles where rol='admin' limit 1"); usuario = q("select id from public.perfiles where rol<>'admin' limit 1")
merged = q("select e.rut from public.entidades_catalogo e join public.entidades_saneamiento_respaldo r on r.fila_id=e.id and r.accion='actualizada' and (r.detalle->>'canonica')='true' order by e.id limit 1")
manual = q("select min(e.rut) from public.entidades_catalogo e where e.id in (select fila_id from public.entidades_saneamiento_respaldo where accion='manual' and grupo is not null)")
sin_puntos = merged.replace(".", "")
sql = f"""begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','{usuario}',true), set_config('request.jwt.claims','{{"sub":"{usuario}","role":"authenticated"}}',true) \\g /dev/null
insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_t1','{R}','T1');
select 'T1|'||rut from public.entidades_catalogo where id='ent_t1';
insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_t2','{libre}{dvp(libre).lower()}','T2');
"""
o, e, rc = run(sql + "rollback;\n")
chk("trigger_normaliza_sin_puntos_a_canonico", f"T1|{RD}" in o, o + e)
chk("trigger+UNIQUE_impiden_duplicado_por_formato (mismo RUT sin puntos y k)", rc != 0 and "duplicate key" in e, e[-200:])
o, e, rc = run(f"""begin; set local role authenticated;
select set_config('request.jwt.claim.sub','{usuario}',true), set_config('request.jwt.claims','{{"sub":"{usuario}","role":"authenticated"}}',true) \\g /dev/null
insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_t3','12.345.678-0','T3');
select 'T3|'||rut from public.entidades_catalogo where id='ent_t3';
update public.entidades_catalogo set nombre_entidad=nombre_entidad where rut='{merged}';
select 'T4|'||count(*) from public.entidades_catalogo where rut='{merged}';
rollback;""")
chk("trigger_no_inventa_dv_en_RUT_invalido", "T3|12.345.678-0" in o, o + e)
chk("update_sin_tocar_rut_funciona (flujo OC usuario normal)", "T4|1" in o and rc == 0, o + e)
def rpc(ops, sim=True, sub=admin):
    pay = json.dumps({"version": 1, "operaciones": ops}).replace("'", "''")
    o, e, rc = run(f"""begin; set local role authenticated;
select set_config('request.jwt.claim.sub','{sub}',true), set_config('request.jwt.claims','{{"sub":"{sub}","role":"authenticated"}}',true) \\g /dev/null
select public.importar_entidades_catalogo('{pay}'::jsonb, {str(sim).lower()});
select 'RUTNUEVO|'||coalesce(max(rut),'-') from public.entidades_catalogo where nombre_entidad='RPC NUEVA';
rollback;""")
    js = [l for l in o.splitlines() if l.startswith("{")]
    return (json.loads(js[0]) if js else None), e, o
nom = q(f"select nombre_entidad from public.entidades_catalogo where rut='{merged}'")
r, e, o = rpc([{"fila": 2, "rut": sin_puntos, "nombre_entidad": nom}])
chk("importador: grupo consolidado con RUT sin puntos = 1 coincidencia, sin cambios", r and r["sin_cambios"] == 1, e)
r, e, o = rpc([{"fila": 2, "rut": merged, "nombre_entidad": nom + " X"}])
chk("importador: actualización simulada sobre grupo consolidado", r and r["actualizadas"] == 1, e)
r, e, o = rpc([{"fila": 2, "rut": manual, "nombre_entidad": "X"}])
chk("importador: grupo manual sigue AMBIGUO (no elige)", r is None and "duplicado histórico" in e, e[-200:])
r, e, o = rpc([{"fila": 2, "rut": R, "nombre_entidad": "RPC NUEVA"}], sim=False)
chk("importador: alta real queda con RUT canónico (luego ROLLBACK)", r and r["creadas"] == 1 and f"RUTNUEVO|{RD}" in o, o[-200:] + e[-200:])
r, e, o = rpc([{"fila": 2, "rut": R, "nombre_entidad": "X"}], sub=usuario)
chk("importador: usuario normal sigue rechazado", r is None and "solo el administrador" in e)
C = estado(); chk("pruebas_en_transaccion_no_dejaron_cambios", C["ent"] == B["ent"])

print("\n===== SEGUNDA EJECUCIÓN (debe abortar sin tocar nada) =====")
o, e, rc = run(open(MIG).read(), single=True)
chk("reaplicar_aborta_por_guardia", rc != 0 and "SANEAMIENTO_ABORTADO" in e, e[-200:])
chk("reaplicar_sin_cambios", estado()["ent"] == B["ent"])

print("\n===== ROLLBACK =====")
o, e, rc = run(open(UND).read()); chk("rollback_ejecuta", rc == 0, e)
D = estado()
chk("rollback_entidades_identicas_al_original (252 + hash)", D["ent"] == A["ent"], D["ent"])
chk("rollback_OCs_identicas", D["oc"] == A["oc"])
chk("rollback_contactos_identicos", D["cc"] == A["cc"])
chk("rollback_retira_trigger_y_respaldo", q("select count(*) from pg_trigger where tgname='normalizar_rut_entidad'") == "0" and q("select count(*) from pg_proc where proname='normalizar_rut_entidad'") == "0" and q("select to_regclass('public.entidades_saneamiento_respaldo') is null") == "t")
chk("rollback_asociaciones_OC_identicas", asociaciones() == AS0 and mapa_oc_ent() == M0)
chk("rollback_RPCs_y_politicas_intactas", all(D[k] == A[k] for k in ("rpc_respaldo", "rpc_bloqueo", "rpc_entidades", "politicas")))
print("\n===== REAPLICAR TRAS ROLLBACK Y DESHACER OTRA VEZ =====")
o, e, rc = run(open(MIG).read(), single=True); chk("reaplicar_tras_rollback", rc == 0 and estado()["ent"] == B["ent"], e[-200:])
# entidad nueva creada DESPUÉS del saneamiento se conserva al deshacer
o, e, rc = run(f"insert into public.entidades_catalogo(id,rut,nombre_entidad) values ('ent_post','{R}','POST');")
o, e, rc = run(open(UND).read()); chk("rollback_2", rc == 0, e)
E2 = q("select count(*)||'|'||md5(coalesce(string_agg(t::text,'|' order by id),'')) from public.entidades_catalogo t where id<>'ent_post'")
chk("rollback_2_original_identico_y_conserva_entidad_posterior", E2 == A["ent"] and q("select count(*) from public.entidades_catalogo where id='ent_post'") == "1")
run("delete from public.entidades_catalogo where id='ent_post';")
print(f"\nRESULTADO: {'TODO OK' if not FALLAS else 'FALLAS: ' + ', '.join(FALLAS)}")
sys.exit(1 if FALLAS else 0)
