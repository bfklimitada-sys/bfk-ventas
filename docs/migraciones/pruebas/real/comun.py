"""Utilidades comunes de la validación sobre COPIA (PostgreSQL efímero). No imprime filas de datos."""
import json, os, re, subprocess, tempfile, time
PSQL = os.environ.get("PSQL", "psql")
ENV = dict(os.environ)
for k, v in (("PGHOST", "localhost"), ("PGPORT", "5432"), ("PGUSER", "postgres"), ("PGDATABASE", "postgres")): ENV.setdefault(k, v)
assert ENV["PGHOST"] in ("localhost", "127.0.0.1") or ENV["PGHOST"].startswith("/"), "solo bases locales/efímeras"
assert "supabase" not in ENV["PGHOST"], "NUNCA contra Supabase"
AQUI = os.path.dirname(os.path.abspath(__file__))
MIG = os.path.join(AQUI, "..", "..", "2026-10-05-importar-respaldo-excel.sql")
DESHACER = os.path.join(AQUI, "..", "..", "2026-10-05-importar-respaldo-excel-deshacer.sql")
T14 = ["ordenes_compra_v2","eventos_compra","eventos_entrega","eventos_factura","eventos_pago_cliente","eventos_pago_financiamiento","financiadores","vendedores","categorias_gasto","gastos_indirectos","iva_mensual","pagos_vendedor","ajustes_saldo_financiador","contactos_cobranza"]
FP_TABLAS = T14 + ["historial_cambios", "perfiles"]
RES = {}

def limpio(txt, n=300):
    """Quita valores concretos de los mensajes de PostgreSQL (Key (a)=(b), DETAIL con datos)."""
    t = re.sub(r"\([^()]*\)=\([^()]*\)", "(…)=(…)", txt or "")
    t = re.sub(r"DETAIL:.*?(\||$)", "DETAIL:[omitido] ", t.replace("\n", " | "))
    return t[:n]

def psql(sql, role=None, sub=None, timeout=900, db=None):
    pre = ""
    if role: pre += f"set role {role};\n"
    if sub is not None:
        pre += (f"select set_config('request.jwt.claim.sub','{sub}',false), set_config('request.jwt.claim.role','authenticated',false), "
                f"set_config('request.jwt.claims', json_build_object('sub','{sub}','role','authenticated')::text, false) \\gset i_\n")
    env = dict(ENV); 
    if db: env["PGDATABASE"] = db
    p = subprocess.run([PSQL, "-X", "-At", "-q"], input=pre + sql, capture_output=True, text=True, env=env, timeout=timeout)
    return p.stdout.strip(), p.stderr.strip()

def jq(sql):
    out, err = psql(sql); assert not err, limpio(err); return json.loads(out) if out else None

def fp():
    q = " union all ".join(f"select '{t}' k, md5(coalesce(string_agg(x::text, ',' order by x::text),'')) h, count(*) n from public.{t} x" for t in FP_TABLAS)
    out, err = psql(f"select string_agg(k||':'||n||':'||h, ';' order by k) from ({q}) s"); assert not err, limpio(err); return out

def fp_tabla(t):
    out, err = psql(f"select md5(coalesce(string_agg(x::text, ',' order by x::text),''))||':'||count(*) from public.{t} x"); assert not err, limpio(err); return out

def llamar(payload, simular=False, sub=None, role="authenticated", pre="", con_sub=True, rollback=False):
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False); json.dump(payload, f); f.close()
    sim = "true" if simular else "false"
    llam = f"select public.importar_respaldo_excel(:'p'::jsonb, {sim});"
    cuerpo = f"begin;\n{llam}\nrollback;\n" if rollback else llam + "\n"
    sql = f"\\set p `cat {f.name}`\n{pre}{cuerpo}"
    t0 = time.time(); out, err = psql(sql, role=role, sub=(sub if con_sub else None)); dt = time.time() - t0
    tam = os.path.getsize(f.name); os.unlink(f.name)
    linea = next((l for l in out.splitlines() if l.startswith("{")), "")
    ok = '"ok": true' in linea
    return {"ok": ok, "resp": json.loads(linea) if ok else None, "err": err, "seg": dt, "bytes": tam}

def p(tablas): return {"version": 1, "tablas": tablas}
def chk(nombre, cond, info=""):
    RES[nombre] = bool(cond); print(("OK   " if cond else "FALLA"), nombre, ("" if cond else limpio(str(info))), flush=True)
