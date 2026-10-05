#!/usr/bin/env python3
"""Mide tiempo y tamaño de payload de importar_respaldo_excel en PostgreSQL LOCAL (100/500/1000/2500 operaciones).
Emula el tiempo límite de Supabase para el rol authenticated (statement_timeout=8s) en una segunda columna."""
import json, sys, importlib.util, os
spec = importlib.util.spec_from_file_location("at", os.path.join(os.path.dirname(os.path.abspath(__file__)), "atomicidad_lib.py")); at = importlib.util.module_from_spec(spec); spec.loader.exec_module(at)
def payload(tipo, n):
    if tipo == "update_1_columna":
        return at.p({"ordenes_compra_v2": {"actualizar": at.ops_upd(n)}})
    if tipo == "update_ancho":
        cols = ["cliente","rut_cliente","comuna","notas","contacto","entidad","direccion_entrega","tipo_despacho","correo_cliente","estado_entrega"]
        ops = at.jq(f"""select jsonb_agg(jsonb_build_object('id',id,
          'cambios', (select jsonb_object_agg(k, to_jsonb(coalesce(v,'')||' *')) from jsonb_each_text(to_jsonb(o) - 'id') e(k,v) where k = any(array{cols!r}::text[]))
                     || jsonb_build_object('monto_total', monto_total+1, 'costo_total', costo_total+1),
          'esperado', (select jsonb_object_agg(k, to_jsonb(v)) from jsonb_each_text(to_jsonb(o) - 'id') e(k,v) where k = any(array{cols!r}::text[]))
                     || jsonb_build_object('monto_total', monto_total, 'costo_total', costo_total)) order by id)
          from (select * from ordenes_compra_v2 order by id limit {n}) o""")
        return at.p({"ordenes_compra_v2": {"actualizar": ops}})
    if tipo == "insert_fila_completa_38_cols":
        ops = at.jq(f"""select jsonb_agg((to_jsonb(o) - 'creadoEn' - 'g') || jsonb_build_object('id','ocP'||lpad(g::text,5,'0'),'numero_oc','P-'||g) order by g)
          from (select row_number() over (order by id) g, * from ordenes_compra_v2 limit {n}) o""")
        return at.p({"ordenes_compra_v2": {"insertar": ops}})
filas = []
for tipo in (sys.argv[1:] or ["update_1_columna", "update_ancho", "insert_fila_completa_38_cols"]):
    for n in [100, 500, 1000]:   # >1000 lo rechaza la RPC (límite)
        fila = {"tipo": tipo, "n": n}
        for etiqueta, pre in [("sin_limite", ""), ("limite_8s", "set statement_timeout='8s';\n")]:
            at.reset()
            pay = payload(tipo, n); tam = len(json.dumps(pay))
            rs = at.llamar(pay, simular=True, pre=pre); rr = at.llamar(pay, pre=pre)
            fila.update({"payload_KB": round(tam / 1024), f"simular_s_{etiqueta}": round(rs["seg"], 2) if rs["ok"] else "ERROR " + at.error_de(rs)[:80],
                         f"real_s_{etiqueta}": round(rr["seg"], 2) if rr["ok"] else "ERROR " + at.error_de(rr)[:80]})
        filas.append(fila); print(json.dumps(fila, ensure_ascii=False))
