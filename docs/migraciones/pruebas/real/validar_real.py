"""Validación de importar_respaldo_excel sobre la COPIA del backup (PostgreSQL efímero). No imprime filas."""
import json, re, subprocess, sys, tempfile, threading, time, uuid
from comun import *
import catalogo

M = catalogo.cargar(); catalogo.informe(M)
COLS = {}
for c in M["columnas"]: COLS.setdefault(c["t"], []).append(c)
RESTR = M["restricciones"] or []
def cols_restringidas(t): return {c for r in RESTR if r["t"] == t for c in (r["cols"] or [])} | {c for r in RESTR if r["tipo"] == "f" and r["padre"] == t for c in (r["cols_padre"] or [])}
def libres(t, udts): return [c["n"] for c in COLS[t] if c["udt"] in udts and not c["generada"] and c["identidad"] != "a" and c["n"] != "id" and c["n"] not in cols_restringidas(t)]
def texto_libre(t): return libres(t, ("text", "varchar", "bpchar"))
def n_filas(t): return int(psql(f"select count(*) from public.{t}")[0])
ADMIN = jq("select to_jsonb(id) from public.perfiles where rol='admin' limit 1"); USUARIO = jq("select to_jsonb(id) from public.perfiles where rol<>'admin' limit 1")
OC = "ordenes_compra_v2"; COL_OC = "notas" if "notas" in texto_libre(OC) else texto_libre(OC)[0]
funciones_antes = None

# --- privilegios (pg_restore --no-privileges los omite; se reponen como los defaults de Supabase)
psql("""grant usage on schema public to anon, authenticated, service_role; grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;""")
# --- migración (solo en la copia)
out, err = psql(open(MIG).read()); chk("migracion_instalada_en_la_copia", not err, err)
existe = psql("select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and proname='importar_respaldo_excel'")[0]
chk("funcion_existe_y_es_security_invoker", existe == "1" and psql("select prosecdef from pg_proc where proname='importar_respaldo_excel'")[0] == "f")
chk("ejecucion_solo_authenticated", psql("select string_agg(grantee, ',' order by grantee) from information_schema.routine_privileges where routine_name='importar_respaldo_excel' and grantee in ('anon','public','PUBLIC','authenticated')")[0] in ("authenticated", ""), "")
FP0 = fp(); H0 = int(psql("select count(*) from public.historial_cambios")[0])
funciones_antes = psql("select string_agg(proname||'('||pg_get_function_identity_arguments(oid)||')', ';' order by proname) from pg_proc where pronamespace='public'::regnamespace and proname<>'importar_respaldo_excel'")[0]
print("\n===== 3. SIMULACIÓN con datos reales =====", flush=True)

def alteracion_por_tabla():
    """1 UPDATE por cada tabla no vacía (columna libre) + 1 INSERT clonado: ejercita todos los tipos reales."""
    tablas = {}
    for t in T14:
        if n_filas(t) == 0: continue
        e = {}; lib = texto_libre(t)
        r = jq(f"select to_jsonb(x) from (select * from public.{t} order by id limit 1) x")
        if lib:
            c = lib[0]; e["actualizar"] = [{"id": r["id"], "cambios": {c: (r.get(c) or "") + " [SIM]"}, "esperado": {c: r.get(c)}}]
        e["insertar"] = clonar(t, 1, "SIM")
        tablas[t] = e
    return p(tablas)

def unicos(t):
    u = {tuple(r["cols"]) for r in RESTR if r["t"] == t and r["tipo"] == "u"}
    for x in (M["unicos"] or []):
        if x["t"] == t:
            cols_txt = x["def"].split(" USING ")[-1].split("(", 1)[-1].rsplit(")", 1)[0]
            if "(" in cols_txt: continue   # indice sobre expresion (p. ej. upper(regexp_replace(numero_oc…))): se respeta por la columna base ya desplazada
            u.add(tuple(s.strip().strip('"') for s in cols_txt.split(",")))
    pk = {tuple(r["cols"]) for r in RESTR if r["t"] == t and r["tipo"] == "p"}
    return [c for c in u if c not in pk]

def clonar(t, n, prefijo, unico=True, offset=0):
    """Filas existentes clonadas con id nuevo (y columnas UNIQUE desplazadas). Devuelve lista de objetos (sin columnas generadas)."""
    gen = [c["n"] for c in COLS[t] if c["generada"] or c["identidad"] == "a"]
    over = []
    if unico:
        for tup in unicos(t):
            for c in tup:
                if c == "id": continue
                ci = next(x for x in COLS[t] if x["n"] == c)
                if ci["udt"] in ("text", "varchar", "bpchar"): over.append(f"'{c}', to_jsonb(coalesce(o.\"{c}\", '')::text || '_{prefijo}' || g)")
                elif ci["udt"] in ("int4", "int8", "numeric", "float8"): over.append(f"'{c}', to_jsonb(coalesce(o.\"{c}\", 0) + g * 1000003)")
    ov = ("|| jsonb_build_object(" + ",".join(over) + ")") if over else ""
    q = (f"select jsonb_agg(((to_jsonb(o) - array{gen!r}::text[]) || jsonb_build_object('id', '{prefijo}_' || lpad(g::text, 6, '0')) {ov}) order by g) "
         f"from generate_series({offset + 1},{offset + n}) g join lateral (select * from public.{t} order by id offset ((g - 1) % greatest((select count(*) from public.{t}),1)) limit 1) o on true")
    return jq(q)

pay = alteracion_por_tabla(); f_a = fp()
r = llamar(pay, simular=True, sub=ADMIN)
chk("sim_catalogo_real_aceptado_14_tablas_ok", r["ok"], r["err"])
if r["ok"]:
    orden = r["resp"]["orden"]; RES["sim_orden_aplicado"] = orden
    tablas_payload = set(pay["tablas"])
    chk("sim_reconoce_todas_las_tablas_no_vacias", set(orden) == tablas_payload, f"{sorted(tablas_payload - set(orden))}")
    fk14 = [(r_["t"], r_["padre"]) for r_ in RESTR if r_["tipo"] == "f" and r_["padre"] in T14 and r_["t"] != r_["padre"]]
    chk("sim_orden_respeta_FK_reales", all(orden.index(pd) < orden.index(h) for h, pd in fk14 if h in orden and pd in orden), str(fk14))
    chk("sim_ninguna_columna_valida_rechazada", r["resp"]["total_insertadas"] == len(tablas_payload))
    RES["sim_columnas_generadas_ignoradas"] = r["resp"]["columnas_generadas_ignoradas"]
chk("sim_cero_modificaciones_persistentes", fp() == f_a and fp() == FP0)

print("\n===== 5/6. ATOMICIDAD sobre el esquema real + HISTORIAL =====", flush=True)
def ops_upd(n, off=0, tag="NUEVA", t=OC, col=None):
    col = col or (COL_OC if t == OC else texto_libre(t)[0])
    return jq(f"select jsonb_agg(jsonb_build_object('id',id,'cambios',jsonb_build_object('{col}','{tag} '||coalesce({col},'')),'esperado',jsonb_build_object('{col}',{col})) order by id) from (select id,{col} from public.{t} order by id offset {off} limit {n}) s")
def n_marcadas(tag, t=OC, col=None): return int(psql(f"select count(*) from public.{t} where {col or COL_OC} like '{tag} %'")[0])
def hist(): return int(psql("select count(*) from public.historial_cambios where accion='Importación de respaldo Excel'")[0]), int(psql("select count(*) from public.historial_cambios")[0])
def cancelada(r): return (not r["ok"]) and "IMPORTACION_CANCELADA" in r["err"] or (not r["ok"] and "statement timeout" in r["err"])

# --- defectos que fallan AL ESCRIBIR (restricciones reales); se elige el de tabla más tardía en el orden de aplicación
defectos = []   # (descripcion, tabla, fabrica(pos, relleno) -> lista 'actualizar' de esa tabla con el defecto insertado en pos)
def victima(t, k=0): return jq(f"select to_jsonb(x) from (select * from public.{t} order by id offset {k} limit 1) x")
for t in T14:
    if n_filas(t) < 2: continue
    for ch in [r_ for r_ in RESTR if r_["t"] == t and r_["tipo"] == "c"]:
        for c in (ch["cols"] or []):
            ci = next(x for x in COLS[t] if x["n"] == c)
            if ci["generada"]: continue
            cand = [-1, -1000000, 999999999999, "zz_invalido"] if ci["udt"] in ("numeric", "int4", "int8", "float8") else ["zz_invalido", ""] if ci["udt"] in ("text", "varchar") else []
            v0 = victima(t)
            for val in cand:
                o, e = psql(f"begin; update public.{t} set \"{c}\" = {json.dumps(val) if not isinstance(val, str) else repr(val)} where id='{v0['id']}'; rollback;")
                if "check constraint" in e or "violates check" in e:
                    defectos.append((f"CHECK {ch['nombre']}", t, {"id": v0["id"], "cambios": {c: val}, "esperado": {c: v0.get(c)}})); break
            if any(d[0] == f"CHECK {ch['nombre']}" for d in defectos): break
    for tup in unicos(t):
        v0, v1 = victima(t, 0), victima(t, 1)
        cambios = {x: v1[x] for x in tup if x != "id"}; esperado = {x: v0[x] for x in tup if x != "id"}
        if cambios:
            defectos.append((f"UNIQUE {'+'.join(tup)}", t, {"id": v0["id"], "cambios": cambios, "esperado": esperado}))
    for r_ in RESTR:
        if r_["t"] == t and r_["tipo"] == "f" and r_["padre"] not in T14 and len(r_["cols"]) == 1:
            ci = next(x for x in COLS[t] if x["n"] == r_["cols"][0]); v0 = victima(t)
            val = str(uuid.uuid4()) if ci["udt"] == "uuid" else "NO_EXISTE_FK"
            defectos.append((f"FK fuera de las 14: {r_['nombre']}", t, {"id": v0["id"], "cambios": {ci["n"]: val}, "esperado": {ci["n"]: v0.get(ci["n"])}}))
RES["defectos_reales_disponibles"] = [f"{d[0]} en {d[1]}" for d in defectos]
print("Defectos de escritura disponibles:", RES["defectos_reales_disponibles"], flush=True)
def armar(defecto_op, tdef, pos, n=100):
    """100 UPDATE sobre OC (+ relleno en la tabla del defecto) con el defecto en la posición `pos` de la lista de su tabla."""
    tablas = {OC: {"actualizar": ops_upd(n, 0, "NUEVA")}}
    if tdef == OC:
        lst = tablas[OC]["actualizar"]; lst = [o for o in lst if o["id"] != defecto_op["id"]]; lst.insert(pos - 1, defecto_op); tablas[OC]["actualizar"] = lst[:n] if pos <= n else lst
    else:
        rel = (ops_upd(min(60, max(0, n_filas(tdef) - 2)), 2, "REL", tdef) if texto_libre(tdef) else []) or []
        rel = [o for o in rel if o["id"] != defecto_op["id"]]; rel.insert(min(pos - 1, len(rel)), defecto_op); tablas[tdef] = {"actualizar": rel}
    return p(tablas)

def caso_atomico(nombre, payload, esperado_texto=None, marcador="NUEVA"):
    f0 = fp(); h0 = hist(); r_ = llamar(payload, sub=ADMIN)
    chk(nombre + "_0_cambios", (not r_["ok"]) and fp() == f0 and hist() == h0 and n_marcadas(marcador) == 0 and (esperado_texto is None or esperado_texto in r_["err"].lower() or esperado_texto in r_["err"]), limpio(r_["err"]))
    return r_

# 5.a validación: operación inválida al principio / a mitad / al final (100 operaciones)
for nom, pos in (("A_inicio", 1), ("B_mitad_op73", 73), ("C_final_op100", 100)):
    ops = ops_upd(100); ops[pos - 1] = {"id": ops[pos - 1]["id"], "cambios": {"columna_inexistente_xyz": 1}, "esperado": {"columna_inexistente_xyz": 1}}
    caso_atomico("atomico_validacion_" + nom, p({OC: {"actualizar": ops}}), "no existe")
# 5.b escritura: restricción REAL violada al escribir
if defectos:
    # tabla del defecto lo más tarde posible en el orden real de aplicación
    sim = llamar(alteracion_por_tabla(), simular=True, sub=ADMIN); ord_full = sim["resp"]["orden"] if sim["ok"] else []
    defectos.sort(key=lambda d: (ord_full.index(d[1]) if d[1] in ord_full else -1), reverse=True)
    desc, tdef, op = defectos[0]
    RES["defecto_usado_para_escritura"] = f"{desc} en {tdef}"
    for nom, pos in (("A_inicio", 1), ("B_mitad", 73), ("C_final", 100)):
        r_ = caso_atomico("atomico_escritura_real_" + nom, armar(op, tdef, pos))
        RES["atomico_escritura_real_" + nom + "_error"] = limpio(r_["err"], 160)
    # cada TIPO de restricción real (CHECK / UNIQUE / FK externa) en la posición intermedia: 0 cambios persistentes
    for tipo in ("CHECK", "UNIQUE", "FK fuera"):
        cand = [d for d in defectos if d[0].startswith(tipo)]
        if not cand: RES["atomico_tipo_" + tipo.split()[0] + "_no_disponible"] = True; continue
        d_, t_, o_ = cand[0]
        r_ = caso_atomico("atomico_restriccion_real_" + tipo.split()[0] + "_mitad", armar(o_, t_, 73))
        RES["atomico_restriccion_" + tipo.split()[0] + "_usada"] = f"{d_} en {t_}"
        RES["atomico_restriccion_" + tipo.split()[0] + "_error"] = limpio(r_["err"], 160)
    prev = 100 if (ord_full and tdef in ord_full and OC in ord_full and ord_full.index(OC) < ord_full.index(tdef)) else 0
    RES["escrituras_de_OC_previas_al_fallo_posibles"] = prev
else:
    RES["atomico_escritura_real_sin_defectos"] = "no hay CHECK/UNIQUE/FK externa utilizables en las 14 tablas reales"
# 5.c FK real: OC clonada con vendedor/financiador inexistente
fkoc = [r_ for r_ in RESTR if r_["t"] == OC and r_["tipo"] == "f" and r_["padre"] in T14 and len(r_["cols"]) == 1]
if fkoc:
    cl = clonar(OC, 1, "FKX")[0]; cl[fkoc[0]["cols"][0]] = "NO_EXISTE_REAL"
    caso_atomico("atomico_FK_real_referencia_inexistente", p({OC: {"actualizar": ops_upd(99), "insertar": [cl]}}), "no existe")
# 5.d conflicto optimista (otra sesión cambia la fila después de la comparación)
pay = p({OC: {"actualizar": ops_upd(100)}}); psql(f"update public.{OC} set {COL_OC} = 'cambio de otro usuario' where id=(select id from public.{OC} order by id offset 49 limit 1)")
f1 = fp(); h0 = hist(); r_ = llamar(pay, sub=ADMIN)
chk("atomico_conflicto_optimista_0_cambios", (not r_["ok"]) and fp() == f1 and hist() == h0 and n_marcadas("NUEVA") == 0 and "conflicto" in r_["err"], limpio(r_["err"]))
# 5.e id nuevo ya existente
cl = clonar(OC, 1, "DUP")[0]; cl["id"] = jq(f"select to_jsonb(id) from public.{OC} order by id limit 1")
caso_atomico("atomico_id_existente", p({OC: {"actualizar": ops_upd(99, 5), "insertar": [cl]}}), "ya existe")
# 5.f usuario no admin / sin sesión / anon
f0 = fp(); h0 = hist(); pay = p({OC: {"actualizar": ops_upd(10)}})
r_ = llamar(pay, sub=USUARIO); chk("atomico_no_admin_rechazado_0_cambios", (not r_["ok"]) and "solo el administrador" in r_["err"] and fp() == f0 and hist() == h0, limpio(r_["err"]))
r_ = llamar(pay, con_sub=False); chk("atomico_sin_sesion_rechazado_0_cambios", (not r_["ok"]) and "sesión válida" in r_["err"] and fp() == f0, limpio(r_["err"]))
r_ = llamar(pay, role="anon", con_sub=False); chk("atomico_anon_sin_permiso_0_cambios", (not r_["ok"]) and "permission denied" in r_["err"] and fp() == f0, limpio(r_["err"]))
# 5.g operación concurrente: segunda importación mientras la primera retiene el bloqueo
payA = p({OC: {"actualizar": ops_upd(100, 0, "CONA")}}); payB = p({OC: {"actualizar": ops_upd(100, 100, "CONB")}})
fa = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(payA, fa); fa.close()
sqlA = (f"set role authenticated; select set_config('request.jwt.claim.sub','{ADMIN}',false), set_config('request.jwt.claim.role','authenticated',false), set_config('request.jwt.claims', json_build_object('sub','{ADMIN}','role','authenticated')::text,false) \\gset i_\n"
        f"\\set p `cat {fa.name}`\nbegin;\nselect public.importar_respaldo_excel(:'p'::jsonb,false);\nselect pg_sleep(4);\ncommit;\n")
res = {}
th = threading.Thread(target=lambda: res.setdefault("A", psql(sqlA))); th.start(); time.sleep(1.5)
rB = llamar(payB, sub=ADMIN); rS = llamar(payB, simular=True, sub=ADMIN); th.join()
chk("concurrencia_segunda_importacion_rechazada", (not rB["ok"]) and "otra importación en curso" in rB["err"], limpio(rB["err"]))
chk("concurrencia_primera_completa_segunda_0", n_marcadas("CONA") == 100 and n_marcadas("CONB") == 0)
chk("concurrencia_simulacion_no_se_bloquea", rS["ok"] and rS["seg"] < 3.5, f"{rS['seg']:.1f}s")
chk("concurrencia_sin_corrupcion", n_marcadas("CONA") + n_marcadas("CONB") == 100)
# 5.h JSON/array/tipos reales
jcols = [(c["t"], c["n"], c["udt"]) for t in T14 for c in COLS[t] if c["udt"] in ("json", "jsonb") or c["cat"] == "A"]
RES["columnas_json_o_array_reales_en_las_14"] = [f"{t}.{n}:{u}" for t, n, u in jcols]
if jcols:
    t, n, u = jcols[0]; v0 = victima(t)
    f0 = fp(); r_ = llamar(p({t: {"actualizar": [{"id": v0["id"], "cambios": {n: "{no es json"}, "esperado": {n: v0.get(n)}}]}}), sub=ADMIN)
    chk("json_array_real_invalido_0_cambios", (not r_["ok"]) and fp() == f0, limpio(r_["err"]))
num = next(((t, c["n"]) for t in (OC,) for c in COLS[t] if c["udt"] in ("numeric", "int4") and c["n"] != "id" and not c["generada"]), None)
if num:
    f0 = fp(); v0 = victima(num[0]); r_ = llamar(p({num[0]: {"actualizar": [{"id": v0["id"], "cambios": {num[1]: "abc"}, "esperado": {num[1]: v0.get(num[1])}}]}}), sub=ADMIN)
    chk("tipo_incompatible_texto_en_numerico_0_cambios", (not r_["ok"]) and fp() == f0, limpio(r_["err"]))
# 6. historial: éxito = exactamente 1 fila resumen
(h_res0, h_tot0) = hist(); r_ = llamar(p({OC: {"actualizar": ops_upd(50, 200, "HIST")}}), sub=ADMIN)
(h_res1, h_tot1) = hist()
chk("historial_exito_exactamente_1_fila_resumen", r_["ok"] and h_res1 == h_res0 + 1 and h_tot1 == h_tot0 + 1, limpio(r_["err"]))
chk("historial_no_una_fila_por_operacion", h_tot1 - h_tot0 == 1)
fila = psql("select accion||' | '||coalesce(campo,'')||' | '||coalesce(valor_nuevo,'') from public.historial_cambios where accion='Importación de respaldo Excel' order by \"creadoEn\" desc limit 1")[0]
RES["historial_fila_resumen"] = fila
chk("historial_fallo_no_deja_fila", True)   # cubierto: cada caso atómico compara el recuento de historial antes/después

print("\n===== 7. RENDIMIENTO sobre la copia =====", flush=True)
objetivo = 3000; actual = n_filas(OC)
if actual < objetivo:   # siembra solo en la copia efímera: clones de OC reales para poder actualizar 2.500 filas
    gen = [c["n"] for c in COLS[OC] if c["generada"] or c["identidad"] == "a"]
    ccl = clonar(OC, objetivo - actual, "SEMILLA")
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(ccl, f); f.close()
    colsql = ",".join(f'"{c["n"]}"' for c in COLS[OC] if c["n"] not in gen)
    o, e = psql(f"\\set j `cat {f.name}`\ninsert into public.{OC} ({colsql}) select {colsql} from jsonb_populate_recordset(null::public.{OC}, :'j'::jsonb);"); assert not e, limpio(e)
RES["oc_filas_para_rendimiento"] = n_filas(OC)
def payload_perf(tipo, n):
    if tipo == "update_pequeno": return p({OC: {"actualizar": ops_upd(n, 0, "PERF")}})
    if tipo == "update_amplio":
        cs = texto_libre(OC)[:8]; ncs = libres(OC, ("numeric", "int4"))[:2]
        sets = ",".join(f"'{c}', coalesce({c}::text,'') || ' *'" for c in cs); esp = ",".join(f"'{c}', {c}" for c in cs)
        if ncs: sets += "," + ",".join(f"'{c}', coalesce({c},0) + 1" for c in ncs); esp += "," + ",".join(f"'{c}', {c}" for c in ncs)
        return p({OC: {"actualizar": jq(f"select jsonb_agg(jsonb_build_object('id',id,'cambios',jsonb_build_object({sets}),'esperado',jsonb_build_object({esp})) order by id) from (select * from public.{OC} order by id limit {n}) s")}})
    return p({OC: {"insertar": clonar(OC, n, "INS", offset=100000)}})
PERF = []
for tipo in ("update_pequeno", "update_amplio", "insert"):
    for n in (100, 500, 1000, 1500, 2500):
        pay = payload_perf(tipo, n); f0 = fp()
        rs = llamar(pay, simular=True, sub=ADMIN, pre="set statement_timeout='8s';\n"); rr = llamar(pay, sub=ADMIN, pre="set statement_timeout='8s';\n", rollback=True)
        rl = llamar(pay, sub=ADMIN, rollback=True)
        fila = {"tipo": tipo, "n": n, "payload_KB": round(rs["bytes"] / 1024), "simular_8s": round(rs["seg"], 2) if rs["ok"] else "ERROR", "real_8s": round(rr["seg"], 2) if rr["ok"] else "ERROR: " + limpio(rr["err"], 70), "real_sin_limite": round(rl["seg"], 2) if rl["ok"] else "ERROR"}
        PERF.append(fila); print("PERF", json.dumps(fila, ensure_ascii=False), flush=True)
        assert fp() == f0, "la medición dejó cambios (rollback falló)"
RES["rendimiento"] = PERF
ok_n = {}
for f_ in PERF:
    t_ = f_["real_sin_limite"]
    ok_n.setdefault(f_["tipo"], []).append((f_["n"], t_))
RES["limite_sugerido_regla"] = "mayor N cuyo tiempo real x3 < 8 s en todos los tipos"
lim = 0
for n in (100, 500, 1000, 1500, 2500):
    ts = [f_["real_sin_limite"] for f_ in PERF if f_["n"] == n]
    if all(isinstance(x, float) and x * 3 < 8 for x in ts): lim = n
RES["limite_sugerido_N"] = lim

print("\n===== 9. ROLLBACK de la migración =====", flush=True)
f_pre = fp(); out, err = psql(open(DESHACER).read()); chk("rollback_ejecutado_sin_error", not err, err)
chk("rollback_solo_desaparece_la_funcion", psql("select count(*) from pg_proc where proname='importar_respaldo_excel'")[0] == "0")
chk("rollback_funciones_restantes_intactas", psql("select string_agg(proname||'('||pg_get_function_identity_arguments(oid)||')', ';' order by proname) from pg_proc where pronamespace='public'::regnamespace")[0] == funciones_antes)
chk("rollback_tablas_y_datos_intactos", fp() == f_pre)
r_ = llamar(p({}), sub=ADMIN); chk("rollback_la_funcion_ya_no_se_puede_llamar", (not r_["ok"]) and ("does not exist" in r_["err"] or "no existe" in r_["err"]), limpio(r_["err"]))
out, err = psql(open(MIG).read()); chk("migracion_reinstalable_tras_rollback", not err, err)
print("\nRESUMEN_VALIDACION " + json.dumps(RES, ensure_ascii=False))
print("TODO_OK", all(v for k, v in RES.items() if isinstance(v, bool)))
