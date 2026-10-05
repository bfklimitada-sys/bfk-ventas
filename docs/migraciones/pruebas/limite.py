#!/usr/bin/env python3
"""Límite de 1.000 operaciones (INSERT+UPDATE de las 14 tablas) dentro de la RPC. PostgreSQL LOCAL desechable (recrea public)."""
import json, os, importlib.util
spec = importlib.util.spec_from_file_location("at", os.path.join(os.path.dirname(os.path.abspath(__file__)), "atomicidad_lib.py")); at = importlib.util.module_from_spec(spec); spec.loader.exec_module(at)
chk, psql, jq, p = at.chk, at.psql, at.jq, at.p
def hist(): return int(psql("select count(*) from historial_cambios where accion='Importación de respaldo Excel'")[0])
def preparar():
    at.reset()
    n = int(psql("select count(*) from ordenes_compra_v2")[0])
    if n < 1100:   # completar con filas clonadas para disponer de >1.000 OC reales
        out, err = psql(f"""insert into ordenes_compra_v2 select (jsonb_populate_record(null::ordenes_compra_v2, to_jsonb(o) || jsonb_build_object('id','base'||lpad(g::text,5,'0'),'numero_oc','B-'||g))).* 
          from generate_series(1,{1100-n}) g join lateral (select * from ordenes_compra_v2 order by id limit 1) o on true""")
        assert not err, err
def ins(k, pref):
    return jq(f"select jsonb_agg((to_jsonb(o) - 'creadoEn' - 'g') || jsonb_build_object('id','{pref}'||lpad(g::text,5,'0'),'numero_oc','{pref}-'||g) order by g) from (select row_number() over (order by id) g, * from (select * from ordenes_compra_v2 where id not like 'LIM%' order by id limit {k}) q) o")
def caso(nombre, pay, esperado_ok, nuevas=None, simular=False, msg=None):
    antes = at.fp(); h0 = hist()
    r = at.llamar(pay, simular=simular)
    despues = at.fp(); h1 = hist()
    if esperado_ok:
        chk(nombre + "_aplicada" if not simular else nombre + "_simulacion_ok", r["ok"], at.error_de(r))
        if simular: chk(nombre + "_simulacion_0_cambios_y_0_historial", antes == despues and h1 == h0)
        else:
            chk(nombre + "_exactamente_1_historial", h1 == h0 + 1, f"{h0}->{h1}")
            if nuevas is not None: chk(nombre + "_total_aplicado", r["ok"] and r["resp"]["total_insertadas"] + r["resp"]["total_actualizadas"] == nuevas, str(r["resp"] and (r["resp"]["total_insertadas"], r["resp"]["total_actualizadas"])))
    else:
        chk(nombre + "_rechazada", (not r["ok"]) and "IMPORTACION_CANCELADA" in r["err"], at.error_de(r))
        chk(nombre + "_0_cambios_persistentes", antes == despues)
        chk(nombre + "_0_historial", h1 == h0)
        if msg: chk(nombre + "_mensaje", msg in r["err"].replace("\n", " "), at.error_de(r))
    return r
for n_upd in (999, 1000):
    preparar(); caso(f"limite_{n_upd}_update", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(n_upd)}}), True, nuevas=n_upd)
preparar(); caso("limite_1000_simulacion", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(1000)}}), True, simular=True)
preparar()
r = caso("limite_1001_update", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(1001)}}), False, msg="contiene 1001 cambios y supera el máximo permitido de 1.000. No se aplicó ningún cambio.")
chk("limite_1001_detalle_estructurado", '"causa": "limite_excedido"' in r["err"].replace('"causa":"limite_excedido"', '"causa": "limite_excedido"') and '"total":1001' in r["err"].replace(" ", ""), at.error_de(r))
preparar(); caso("limite_1001_simulacion", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(1001)}}), False, simular=True, msg="supera el máximo permitido de 1.000")
# suma entre tablas: 600 UPDATE + 400 INSERT = 1000 permitido; +1 INSERT = 1001 rechazado
preparar(); caso("limite_mixto_1000", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(600), "insertar": ins(400, "LIMA")}}), True, nuevas=1000)
preparar(); caso("limite_mixto_1001", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(600), "insertar": ins(401, "LIMB")}}), False, msg="1001 cambios")
preparar(); caso("limite_1001_con_op_final_invalida", p({"ordenes_compra_v2": {"actualizar": at.ops_upd(1000, 0) + at.ops_upd(1, 1000)}}), False, msg="1001 cambios")
# error en la operación 1.000 (última permitida) → rollback completo
preparar()
ops = at.ops_upd(1000); ops[-1]["cambios"] = {"monto_total": -5}; ops[-1]["esperado"] = {"monto_total": jq(f"select to_jsonb(monto_total) from ordenes_compra_v2 where id='{ops[-1]['id']}'")}
r = caso("limite_error_en_operacion_1000", p({"ordenes_compra_v2": {"actualizar": ops}}), False)
# conflicto optimista en la operación 500 de 1000 → rollback completo
preparar()
ops = at.ops_upd(1000); ops[499]["esperado"] = {"notas": "valor-que-ya-no-es"}
r = caso("limite_conflicto_en_1000", p({"ordenes_compra_v2": {"actualizar": ops}}), False)
chk("limite_conflicto_es_IM002", "conflicto" in r["err"].lower() or "IM002" in r["err"] or "modific" in r["err"].lower(), at.error_de(r))
ok = all(at.RES.values()); print("RESUMEN_LIMITE", json.dumps(at.RES)); print("TODO_OK", ok); raise SystemExit(0 if ok else 1)
