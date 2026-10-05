"""Extrae el esquema REAL (solo estructura) de las 14 tablas desde la copia y lo compara con la réplica local."""
import json, sys
from comun import *

def cargar():
    lista = "array[" + ",".join(f"'{t}'" for t in T14) + "]"
    return jq(f"""select jsonb_build_object(
 'columnas', (select jsonb_agg(jsonb_build_object('t',c.relname,'n',a.attname,'tipo',format_type(a.atttypid,a.atttypmod),'udt',ty.typname,'cat',ty.typcategory,
      'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'generada',a.attgenerated,'identidad',a.attidentity) order by c.relname,a.attnum)
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_type ty on ty.oid=a.atttypid left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where c.relnamespace='public'::regnamespace and c.relname=any({lista}) and c.relkind='r' and a.attnum>0 and not a.attisdropped),
 'restricciones', (select jsonb_agg(jsonb_build_object('t',cl.relname,'tipo',c.contype,'nombre',c.conname,'def',pg_get_constraintdef(c.oid),'padre',pc.relname,
      'cols',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.conrelid and a.attnum=any(c.conkey)),
      'cols_padre',(select jsonb_agg(a.attname order by a.attnum) from pg_attribute a where a.attrelid=c.confrelid and a.attnum=any(c.confkey))) order by cl.relname,c.contype,c.conname)
    from pg_constraint c join pg_class cl on cl.oid=c.conrelid left join pg_class pc on pc.oid=c.confrelid
    where c.connamespace='public'::regnamespace and cl.relname=any({lista})),
 'unicos', (select jsonb_agg(jsonb_build_object('t',tablename,'indice',indexname,'def',indexdef)) from pg_indexes where schemaname='public' and tablename=any({lista}) and indexdef ilike '%unique%'),
 'triggers', (select jsonb_agg(jsonb_build_object('t',c.relname,'n',t.tgname,'def',pg_get_triggerdef(t.oid))) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relnamespace='public'::regnamespace and not t.tgisinternal and c.relname=any({lista})),
 'rls', (select jsonb_agg(jsonb_build_object('t',relname,'rls',relrowsecurity,'forzada',relforcerowsecurity)) from pg_class where relnamespace='public'::regnamespace and relname=any({lista}) and relkind='r'),
 'politicas', (select jsonb_agg(jsonb_build_object('t',tablename,'n',policyname,'cmd',cmd,'roles',roles::text,'usa',qual,'chequeo',with_check)) from pg_policies where schemaname='public' and tablename=any({lista})),
 'funciones', (select jsonb_agg(jsonb_build_object('n',p.proname,'secdef',p.prosecdef,'args',pg_get_function_identity_arguments(p.oid)) order by p.proname) from pg_proc p where p.pronamespace='public'::regnamespace)
)""")

# Supuestos de la réplica local (docs/migraciones/pruebas/schema-local.sql)
FK_REPLICA = {("ordenes_compra_v2","vendedor_id","vendedores"),("ordenes_compra_v2","financiador_id","financiadores"),("eventos_compra","oc_id","ordenes_compra_v2"),
 ("eventos_compra","financiador_id","financiadores"),("eventos_entrega","oc_id","ordenes_compra_v2"),("eventos_factura","oc_id","ordenes_compra_v2"),("eventos_pago_cliente","oc_id","ordenes_compra_v2"),
 ("eventos_pago_financiamiento","financiador_id","financiadores"),("eventos_pago_financiamiento","oc_id","ordenes_compra_v2"),("gastos_indirectos","categoria_id","categorias_gasto"),
 ("pagos_vendedor","vendedor_id","vendedores"),("ajustes_saldo_financiador","financiador_id","financiadores")}
OC_COLS_CONOCIDAS = "id numero_oc cliente rut_cliente comuna vendedor_id notas estado_compra estado_entrega estado_factura_propia estado_pago_cliente estado_pago_financiamiento monto_total costo_total monto_facturado monto_cobrado financiador_id creadoEn creado_por correo_cliente ultimo_reclamo_fecha ultimo_reclamo_por contacto entidad vendedor_pagado ultimo_editor ultima_edicion estado_postventa sync_pendiente tipo_despacho direccion_entrega dias_pago tipo_registro monto_pagado_fin fecha_emision_mp no_en_mp fecha_hora_emision_mp es_venta_propia".split()

def informe(m):
    por = {}
    for c in m["columnas"]: por.setdefault(c["t"], []).append(c)
    print("=== TABLAS (14 esperadas) ===")
    for t in T14: print(f"{t}: {len(por.get(t, []))} columnas" if t in por else f"{t}: NO EXISTE")
    print("\n=== COLUMNAS (nombre tipo [NOT NULL] [default] [generada/identidad]) ===")
    for t in T14:
        print(f"-- {t}")
        for c in por.get(t, []):
            ex = ("" if not c["notnull"] else " NOT NULL") + (f" default {c['default']}" if c["default"] else "") + (" GENERADA" if c["generada"] else "") + (f" IDENTIDAD({c['identidad']})" if c["identidad"] else "")
            print(f"   {c['n']} {c['tipo']}{ex}")
    print("\n=== RESTRICCIONES ===")
    for r in m["restricciones"] or []: print(f"{r['t']} {r['tipo']} {r['nombre']}: {r['def']}")
    print("\n=== ÍNDICES ÚNICOS ===")
    for u in m["unicos"] or []: print(f"{u['t']}: {u['def']}")
    print("\n=== TRIGGERS ===");  [print(f"{x['t']}: {x['def']}") for x in (m["triggers"] or [])] or None
    if not m["triggers"]: print("(ninguno)")
    print("\n=== RLS ===");  [print(f"{x['t']}: rls={x['rls']} forzada={x['forzada']}") for x in (m["rls"] or [])]
    print("\n=== POLÍTICAS ===");  [print(f"{x['t']} {x['n']} {x['cmd']} {x['roles']} USING({x['usa']}) CHECK({x['chequeo']})") for x in (m["politicas"] or [])]
    print("\n=== FUNCIONES EN public ===");  [print(f"{x['n']}({x['args']}) security_definer={x['secdef']}") for x in (m["funciones"] or [])]
    # --- comparación con la réplica
    print("\n=== DIFERENCIAS vs RÉPLICA LOCAL ===")
    dif = []
    for t in T14:
        if t not in por: dif.append(f"{t}: no existe en la copia"); continue
        pk = [r for r in m["restricciones"] if r["t"] == t and r["tipo"] == "p"]
        if not pk or pk[0]["cols"] != ["id"]: dif.append(f"{t}: PK real {pk[0]['cols'] if pk else 'ninguna'} (la réplica supone id)")
        idc = next((c for c in por[t] if c["n"] == "id"), None)
        if idc and idc["udt"] != "text": dif.append(f"{t}.id es {idc['tipo']} (la réplica supone text)")
        for c in por[t]:
            if c["cat"] == "A" or c["udt"] in ("json", "jsonb"): dif.append(f"{t}.{c['n']} es {c['tipo']} (json/array real)")
            if c["generada"]: dif.append(f"{t}.{c['n']} es columna GENERADA")
            if c["identidad"]: dif.append(f"{t}.{c['n']} es IDENTITY({c['identidad']})")
    fks = {(r["t"], r["cols"][0], r["padre"]) for r in m["restricciones"] if r["tipo"] == "f" and len(r["cols"]) == 1}
    fk_comp = [r for r in m["restricciones"] if r["tipo"] == "f" and len(r["cols"]) > 1]
    for f in sorted(FK_REPLICA - fks): dif.append(f"FK supuesta y NO existe: {f[0]}.{f[1]} -> {f[2]}")
    for f in sorted(fks - FK_REPLICA): dif.append(f"FK real no supuesta: {f[0]}.{f[1]} -> {f[2]}")
    for r in fk_comp: dif.append(f"FK compuesta: {r['t']} {r['def']}")
    ch = [r for r in m["restricciones"] if r["tipo"] == "c"]; un = [r for r in m["restricciones"] if r["tipo"] == "u"]
    dif.append(f"CHECK reales: {len(ch)} (la réplica solo tenía vendedores.comision_pct y ordenes_compra_v2.monto_total)"); dif.append(f"UNIQUE reales (constraint): {len(un)}")
    if m["triggers"]: dif.append(f"TRIGGERS reales: {len(m['triggers'])} (la réplica no tenía)")
    oc = {c["n"] for c in por.get("ordenes_compra_v2", [])}
    if oc != set(OC_COLS_CONOCIDAS): dif.append(f"ordenes_compra_v2: faltan {sorted(set(OC_COLS_CONOCIDAS)-oc)} / sobran {sorted(oc-set(OC_COLS_CONOCIDAS))}")
    for d in dif: print("-", d)
    return dif

if __name__ == "__main__":
    m = cargar(); informe(m)
    json.dump(m, open(os.path.join(os.environ.get("RUNNER_TEMP", "/tmp"), "catalogo_real.json"), "w"))
