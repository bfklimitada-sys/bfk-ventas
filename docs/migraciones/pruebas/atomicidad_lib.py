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

