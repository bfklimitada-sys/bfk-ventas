#!/usr/bin/env python3
"""Pruebas destructivas LOCALES de importar_respaldo_excel (A–M). Requiere un PostgreSQL local desechable.
Uso: PGHOST=/tmp/pgimp PGPORT=55432 PGUSER=postgres python3 atomicidad.py
NUNCA apuntar a Supabase real: cada prueba recrea el esquema `public` (drop schema ... cascade)."""
import json, os, subprocess, sys, tempfile, time, threading
AQUI = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(AQUI, "..", "2026-10-05-importar-respaldo-excel.sql")
PSQL = os.environ.get("PSQL", "/usr/lib/postgresql/16/bin/psql")
ENV = dict(os.environ); ENV.setdefault("PGHOST", "/tmp/pgimp"); ENV.setdefault("PGPORT", "55432"); ENV.setdefault("PGUSER", "postgres")
assert ENV["PGHOST"].startswith("/") or ENV["PGHOST"] in ("localhost", "127.0.0.1"), "solo base local"
ADMIN = "11111111-1111-1111-1111-111111111111"; USUARIO = "22222222-2222-2222-2222-222222222222"
TABLAS14 = ["ordenes_compra_v2","eventos_compra","eventos_entrega","eventos_factura","eventos_pago_cliente","eventos_pago_financiamiento","financiadores","vendedores","categorias_gasto","gastos_indirectos","iva_mensual","pagos_vendedor","ajustes_saldo_financiador","contactos_cobranza"]
FP_TABLAS = TABLAS14 + ["historial_cambios", "perfiles"]
RES = {}; DB = "imp"

def psql(sql, db=None, role=None, sub=None, extra=None, timeout=300):
    pre = ""
    if role: pre += f"set role {role};\n"
    if sub is not None: pre += f"select set_config('request.jwt.claim.sub','{sub}',false), set_config('request.jwt.claim.role','authenticated',false) \\gset ignore_\n"
    p = subprocess.run([PSQL, "-X", "-At", "-q", "-d", db or DB] + (extra or []), input=pre + sql, capture_output=True, text=True, env=ENV, timeout=timeout)
    return p.stdout.strip(), p.stderr.strip()
def run_file(f, db=None):
    p = subprocess.run([PSQL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-d", db or DB, "-f", f], capture_output=True, text=True, env=ENV)
    assert p.returncode == 0, p.stderr
def reset(db=None):
    run_file(os.path.join(AQUI, "schema-local.sql"), db); run_file(MIG, db)
def fp(db=None):
    q = " union all ".join(f"select '{t}' k, md5(coalesce(string_agg(x::text, ',' order by x::text),'')) h, count(*) n from {t} x" for t in FP_TABLAS)
    out, _ = psql(f"select string_agg(k||':'||n||':'||h, ';' order by k) from ({q}) s", db)
    return out
def jq(sql, db=None):
    out, err = psql(sql, db); assert not err, err; return json.loads(out) if out else None
def llamar(payload, simular=False, sub=ADMIN, role="authenticated", db=None, pre="", con_sub=True):
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(payload, f); f.close()
    sim = "true" if simular else "false"
    sql = f"\\set p `cat {f.name}`\n{pre}select public.importar_respaldo_excel(:'p'::jsonb, {sim});\n"
    t0 = time.time(); out, err = psql(sql, db, role=role, sub=sub if con_sub else None); dt = time.time() - t0
    os.unlink(f.name)
    ok = out.startswith("{") and '"ok": true' in out
    return {"ok": ok, "resp": json.loads(out) if ok else None, "err": err, "seg": dt, "bytes": os.path.getsize(f.name) if os.path.exists(f.name) else None}
def ops_upd(n, off=0, etiqueta="NUEVA", extra=None):
    return jq(f"select jsonb_agg(jsonb_build_object('id',id,'cambios',jsonb_build_object('notas','{etiqueta} '||id),'esperado',jsonb_build_object('notas',notas)) order by id) from (select id,notas from ordenes_compra_v2 order by id offset {off} limit {n}) s")
def p(tablas): return {"version": 1, "tablas": tablas}
def chk(nombre, cond, info=""):
    RES[nombre] = bool(cond); print(("OK   " if cond else "FALLA"), nombre, info if not cond else "")
def n_nuevas(): return int(psql("select count(*) from ordenes_compra_v2 where notas like 'NUEVA %'")[0])
def error_de(r): return r["err"].replace("\n", " | ")[:260]

# ---------------------------------------------------------------- A. éxito
reset(); f0 = fp()
r = llamar(p({"ordenes_compra_v2": {"actualizar": ops_upd(100)}}))
chk("A_100_validas_100_aplicadas", r["ok"] and r["resp"]["total_actualizadas"] == 100 and n_nuevas() == 100, error_de(r))
chk("A_historial_traza_1_fila", psql("select count(*) from historial_cambios where accion='Importación de respaldo Excel'")[0] == "1")
RES["A_orden_usado"] = r["resp"]["orden"] if r["ok"] else None

# ---------------------------------------------------------------- B. error intermedio (operación 73)
def con_mala(pos, tipo):
    ops = ops_upd(100)
    if tipo == "validacion": ops[pos - 1]["cambios"] = {"columna_inventada": "x"}; ops[pos - 1]["esperado"] = {"columna_inventada": "x"}
    else: ops[pos - 1]["cambios"] = {"monto_total": -1}; ops[pos - 1]["esperado"] = {"monto_total": jq(f"select to_jsonb(monto_total) from ordenes_compra_v2 where id='{ops[pos-1]['id']}'")}
    return p({"ordenes_compra_v2": {"actualizar": ops}})
for nombre, pos, tipo in [("B1_op73_detectada_en_validacion", 73, "validacion"), ("B2_op73_falla_al_ESCRIBIR_check", 73, "escritura"),
                          ("C1_op100_detectada_en_validacion", 100, "validacion"), ("C2_op100_falla_al_ESCRIBIR_check", 100, "escritura")]:
    reset(); f0 = fp(); r = llamar(con_mala(pos, tipo))
    chk(nombre + "_0_aplicadas", (not r["ok"]) and fp() == f0 and n_nuevas() == 0 and "IMPORTACION_CANCELADA" in r["err"], error_de(r))
    RES[nombre + "_mensaje"] = error_de(r)[:200]

# ---------------------------------------------------------------- D. conflicto concurrente
reset(); f0 = fp(); pay = p({"ordenes_compra_v2": {"actualizar": ops_upd(100)}})
psql("update ordenes_compra_v2 set notas='cambio de otro usuario' where id='oc00050'")        # commit en otra sesión
f1 = fp(); r = llamar(pay)
chk("D_conflicto_0_aplicadas", (not r["ok"]) and fp() == f1 and n_nuevas() == 0 and "conflicto" in r["err"] and "oc00050" in r["err"], error_de(r))
chk("D_no_pisa_cambio_ajeno", psql("select notas from ordenes_compra_v2 where id='oc00050'")[0] == "cambio de otro usuario")
# D2: la fila se borra tras la comparación
reset(); pay = p({"ordenes_compra_v2": {"actualizar": ops_upd(5, 400)}}); out_d, err_d = psql("delete from ordenes_compra_v2 where id='oc00403'"); assert not err_d, err_d
r = llamar(pay); chk("D2_fila_borrada_0_aplicadas", (not r["ok"]) and n_nuevas() == 0 and "ya no existe" in r["err"], error_de(r))

# ---------------------------------------------------------------- E. ID nuevo ya existente
reset(); f0 = fp(); ops = ops_upd(99)
r = llamar(p({"ordenes_compra_v2": {"actualizar": ops, "insertar": [{"id": "oc00001", "numero_oc": "X-1"}]}}))
chk("E1_id_nuevo_ya_existe_0_aplicadas", (not r["ok"]) and fp() == f0 and "ya existe" in r["err"], error_de(r))
reset(); pay = p({"ordenes_compra_v2": {"actualizar": ops_upd(50), "insertar": [{"id": "ocNUEVA1", "numero_oc": "X-9"}]}})
psql("insert into ordenes_compra_v2(id,numero_oc) values ('ocNUEVA1','apareció después')"); f1 = fp(); r = llamar(pay)
chk("E2_id_aparecio_tras_comparacion_0_aplicadas", (not r["ok"]) and fp() == f1 and n_nuevas() == 0 and "ya existe" in r["err"], error_de(r))
reset(); r = llamar(p({"ordenes_compra_v2": {"insertar": [{"id": "ocDUP", "numero_oc": "a"}, {"id": "ocDUP", "numero_oc": "b"}]}}))
chk("E3_id_repetido_en_payload_0_aplicadas", (not r["ok"]) and psql("select count(*) from ordenes_compra_v2 where id='ocDUP'")[0] == "0" and "más de una vez" in r["err"], error_de(r))

# ---------------------------------------------------------------- F. tabla / columna no autorizada
reset(); f0 = fp(); base = ops_upd(10)
casos_f = {
 "F1_tabla_perfiles": {"perfiles": {"actualizar": [{"id": ADMIN, "cambios": {"rol": "usuario"}, "esperado": {"rol": "admin"}}]}, "ordenes_compra_v2": {"actualizar": base}},
 "F2_tabla_con_sql": {"ordenes_compra_v2; drop table perfiles": {"insertar": [{"id": "x"}]}},
 "F3_tabla_catalogo": {"pg_class": {"insertar": [{"id": "x"}]}},
 "F4_columna_inexistente": {"ordenes_compra_v2": {"actualizar": [{"id": "oc00001", "cambios": {"col_x": 1}, "esperado": {"col_x": 1}}]}},
 "F6_cambiar_id": {"ordenes_compra_v2": {"actualizar": [{"id": "oc00001", "cambios": {"id": "otro"}, "esperado": {"id": "oc00001"}}]}},
 "F7_clave_extra_payload": None,
}
for k, tablas in casos_f.items():
    if tablas is None: pay = {"version": 1, "tablas": {}, "sql": "drop table perfiles"}
    else: pay = p(tablas)
    r = llamar(pay); chk(k + "_0_aplicadas", (not r["ok"]) and fp() == f0, error_de(r))
chk("F_perfiles_intactos", psql("select rol from perfiles where id='" + ADMIN + "'")[0] == "admin")

# F5: una columna generada en `cambios` se ignora (no se escribe) y se informa
r = llamar(p({"vendedores": {"actualizar": [{"id": "v1", "cambios": {"nombre_mayus": "HACK"}, "esperado": {"nombre_mayus": "VENDEDOR 1"}}]}}))
chk("F5_columna_generada_se_ignora_y_no_se_escribe", r["ok"] and fp() == f0 and r["resp"]["columnas_generadas_ignoradas"] == ["vendedores.nombre_mayus"], error_de(r))
# F5b: cambiar `nombre` junto con el valor (viejo) de la generada del Excel: se aplica `nombre`, la generada se recalcula
r = llamar(p({"vendedores": {"actualizar": [{"id": "v1", "cambios": {"nombre": "Renombrado", "nombre_mayus": "OTRO"}, "esperado": {"nombre": "Vendedor 1", "nombre_mayus": "VENDEDOR 1"}}]}}))
chk("F5b_cambia_nombre_y_generada_se_recalcula", r["ok"] and psql("select nombre_mayus from vendedores where id='v1'")[0] == "RENOMBRADO", error_de(r))
reset(); f0 = fp()

# ---------------------------------------------------------------- G. JSON inválido / tipo incompatible
reset(); f0 = fp(); v = lambda c, e: {"vendedores": {"actualizar": [{"id": "v1", "cambios": c, "esperado": e}]}, "ordenes_compra_v2": {"actualizar": ops_upd(20)}}
casos_g = {
 "G1_json_invalido_en_jsonb": v({"meta": "{no es json"}, {"meta": {"a": 1, "b": "texto"}}),
 "G2_objeto_en_columna_numerica": v({"comision_pct": {"x": 1}}, {"comision_pct": 10}),
 "G3_texto_no_numerico": v({"comision_pct": "abc"}, {"comision_pct": 10}),
 "G4_objeto_en_array_text": v({"etiquetas": {"a": 1}}, {"etiquetas": ["x", "y"]}),
 "G5_texto_json_no_array_en_array": v({"etiquetas": "{\"a\":1}"}, {"etiquetas": ["x", "y"]}),
 "G6_fecha_invalida": {"gastos_indirectos": {"insertar": [{"id": "gNEW", "monto": 1, "fecha": "no-es-fecha"}]}},
 "G7_null_en_obligatoria": {"vendedores": {"actualizar": [{"id": "v1", "cambios": {"nombre": None}, "esperado": {"nombre": "Vendedor 1"}}]}},
 "G8_insert_sin_obligatoria": {"vendedores": {"insertar": [{"id": "vNEW"}]}},
}
for k, tablas in casos_g.items():
    r = llamar(p(tablas)); chk(k + "_0_aplicadas", (not r["ok"]) and fp() == f0 and "IMPORTACION_CANCELADA" in r["err"], error_de(r))
    RES[k + "_mensaje"] = error_de(r)[:170]

# ---------------------------------------------------------------- H/I. permisos
reset(); f0 = fp(); pay = p({"ordenes_compra_v2": {"actualizar": ops_upd(10)}})
r = llamar(pay, sub=USUARIO); chk("H_no_admin_rechazado_0_aplicadas", (not r["ok"]) and fp() == f0 and "solo el administrador" in r["err"], error_de(r))
r = llamar(pay, con_sub=False); chk("I1_sin_sesion_rechazado_0_aplicadas", (not r["ok"]) and fp() == f0 and "sesión válida" in r["err"], error_de(r))
r = llamar(pay, role="anon", sub=None, con_sub=False); chk("I2_anon_sin_permiso_de_ejecucion_0_aplicadas", (not r["ok"]) and fp() == f0 and "permission denied" in r["err"], error_de(r))
r = llamar(pay, sub=USUARIO, simular=True); chk("H2_no_admin_rechazado_tambien_en_simulacion", (not r["ok"]) and "solo el administrador" in r["err"], error_de(r))

# ---------------------------------------------------------------- J. dos importaciones simultáneas
reset(); f0 = fp()
payA = p({"ordenes_compra_v2": {"actualizar": ops_upd(100, 0, "A")}}); payB = p({"ordenes_compra_v2": {"actualizar": ops_upd(100, 100, "B")}})
fa = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(payA, fa); fa.close()
sqlA = f"set role authenticated; select set_config('request.jwt.claim.sub','{ADMIN}',false), set_config('request.jwt.claim.role','authenticated',false) \\gset i_\n\\set p `cat {fa.name}`\nbegin;\nselect public.importar_respaldo_excel(:'p'::jsonb,false);\nselect pg_sleep(4);\ncommit;\n"
hiloA = {}
def correrA(): hiloA["out"] = psql(sqlA)
th = threading.Thread(target=correrA); th.start(); time.sleep(1.5)
rB = llamar(payB); rSim = llamar(payB, simular=True)       # B real mientras A mantiene el bloqueo; simulación no se bloquea
th.join()
nA = int(psql("select count(*) from ordenes_compra_v2 where notas like 'A %'")[0]); nB = int(psql("select count(*) from ordenes_compra_v2 where notas like 'B %'")[0])
chk("J_segunda_importacion_rechazada_por_lock", (not rB["ok"]) and "otra importación en curso" in rB["err"], error_de(rB))
chk("J_primera_aplicada_completa_segunda_0", nA == 100 and nB == 0, f"A={nA} B={nB}")
chk("J_simulacion_no_se_bloquea_durante_importacion", rSim["ok"] and rSim["seg"] < 3, f"{rSim['seg']:.1f}s")
rB2 = llamar(payB); chk("J_tras_terminar_A_B_se_aplica", rB2["ok"] and int(psql("select count(*) from ordenes_compra_v2 where notas like 'B %'")[0]) == 100, error_de(rB2))
chk("J_sin_corrupcion_total_200", psql("select count(*) from ordenes_compra_v2 where notas like 'A %' or notas like 'B %'")[0] == "200")

# ---------------------------------------------------------------- K. orden por FK reales + padres nuevos en el mismo payload
reset(); f0 = fp()
pay = p({
 "eventos_compra": {"insertar": [{"id": "ecN", "oc_id": "ocN", "fecha": "2026-10-01", "monto": 5}]},
 "ordenes_compra_v2": {"insertar": [{"id": "ocN", "numero_oc": "N-1", "vendedor_id": "vN", "financiador_id": "fN", "monto_total": 10}]},
 "vendedores": {"insertar": [{"id": "vN", "nombre": "Vend Nuevo", "meta": "{\"a\":[1,2,{\"b\":null}]}", "etiquetas": "[\"p\",\"q\"]"}]},
 "financiadores": {"insertar": [{"id": "fN", "nombre": "Fin Nuevo"}]},
 "eventos_pago_financiamiento": {"insertar": [{"id": "pfSinOC", "financiador_id": "fN", "oc_id": None, "fecha": "2026-10-02", "monto": 7}]}})
r = llamar(pay)
orden = r["resp"]["orden"] if r["ok"] else []
chk("K_padres_nuevos_y_orden_por_FK", r["ok"] and orden.index("vendedores") < orden.index("ordenes_compra_v2") < orden.index("eventos_compra") and orden.index("financiadores") < orden.index("ordenes_compra_v2"), error_de(r) + str(orden))
RES["K_orden_calculado"] = orden
chk("K_pago_financiador_sin_oc_insertado", psql("select count(*) from eventos_pago_financiamiento where id='pfSinOC' and oc_id is null")[0] == "1")
# referencia inexistente: detectada en simulación (sin escribir)
reset(); f0 = fp(); r = llamar(p({"eventos_compra": {"insertar": [{"id": "ecX", "oc_id": "NO_EXISTE", "monto": 1}]}}), simular=True)
chk("K2_referencia_inexistente_detectada_en_simulacion", (not r["ok"]) and "no existe en ordenes_compra_v2" in r["err"] and fp() == f0, error_de(r))

# ---------------------------------------------------------------- L. dependencia circular
psql("drop database if exists imp_ciclo", db="postgres"); psql("create database imp_ciclo", db="postgres"); reset("imp_ciclo")
psql("alter table vendedores add column cat text references categorias_gasto(id); alter table categorias_gasto add column vend text references vendedores(id);", "imp_ciclo")
f0 = fp("imp_ciclo"); r = llamar(p({"vendedores": {"insertar": [{"id": "vC", "nombre": "x"}]}}), db="imp_ciclo")
chk("L_dependencia_circular_aborta_0_aplicadas", (not r["ok"]) and "dependencia circular" in r["err"] and fp("imp_ciclo") == f0, error_de(r))

# ---------------------------------------------------------------- M. simulación
reset(); f0 = fp(); r = llamar(p({"ordenes_compra_v2": {"actualizar": ops_upd(100)}}), simular=True)
chk("M1_simulacion_valida_100_y_0_persistentes", r["ok"] and r["resp"]["simulado"] and r["resp"]["total_actualizadas"] == 100 and fp() == f0, error_de(r))
r = llamar(p({"ordenes_compra_v2": {"actualizar": ops_upd(100)}}).copy())
sql_def = f"\\set p `echo '{{\"version\":1,\"tablas\":{{}}}}'`\nselect (public.importar_respaldo_excel(:'p'::jsonb))->>'simulado';"
out, err = psql(sql_def, role="authenticated", sub=ADMIN); chk("M2_valor_por_defecto_es_simulacion", out == "true", err)
reset(); f0 = fp(); mala = con_mala(73, "escritura")
rs = llamar(mala, simular=True); rr = llamar(mala)
chk("M3_limite_simulacion_check_solo_en_escritura", rs["ok"] and (not rr["ok"]) and fp() == f0, f"sim_ok={rs['ok']} real_ok={rr['ok']}")
# UNIQUE al escribir
reset(); f0 = fp(); r = llamar(p({"iva_mensual": {"insertar": [{"id": "ivaNEW", "anio": 2026, "mes": 7, "iva_ventas": 1}]}, "ordenes_compra_v2": {"actualizar": ops_upd(30)}}))
chk("M4_unique_violado_revierte_todo", (not r["ok"]) and fp() == f0 and "iva_mensual" in r["err"], error_de(r))
# RLS: usuario sin permiso para actualizar (política) => error y 0 aplicadas
reset(); psql("drop policy autenticados_editan on eventos_compra"); f0 = fp()
r = llamar(p({"ordenes_compra_v2": {"actualizar": ops_upd(30)}, "eventos_compra": {"actualizar": [{"id": "ec00001", "cambios": {"monto": 1}, "esperado": {"monto": jq("select to_jsonb(monto) from eventos_compra where id='ec00001'")}}]}}))
chk("M5_RLS_bloquea_y_revierte_todo", (not r["ok"]) and fp() == f0, error_de(r))

# ---------------------------------------------------------------- N. columnas generadas en el Excel exportado
reset(); r = llamar(p({"vendedores": {"insertar": [{"id": "vGen", "nombre": "nuevo", "nombre_mayus": "IGNORADO"}]}}))
chk("N1_insert_ignora_columna_generada_y_se_recalcula", r["ok"] and psql("select nombre_mayus from vendedores where id='vGen'")[0] == "NUEVO", error_de(r))

print("\nRESUMEN", json.dumps(RES, ensure_ascii=False, indent=1))
print("TODO_OK", all(v for k, v in RES.items() if isinstance(v, bool)))
