# Genera la migración «perfil BFK obligatorio» y su reversión a partir del catálogo de PRODUCCIÓN leído en SOLO LECTURA:
#   - public_esquema.sql : pg_dump --schema-only --schema=public (textos literales de las funciones)
#   - politicas.json     : pg_policies de public (json_agg de t, p, cmd, roles, q, c)
#   - tablas.tsv         : ACL de cada tabla (para devolver exactamente los permisos en la reversión)
#   - huella             : huella del catálogo (seg/huella_catalogo.sql) con la que se ensayó
# Uso: python3 generar.py public_esquema.sql politicas.json tablas.tsv HUELLA migracion.sql deshacer.sql
import json, re, sys

esquema, politicas_json, tablas_tsv, huella, out_mig, out_des = sys.argv[1:7]
S = open(esquema, encoding="utf-8", newline="").read()

def funcion(nombre):
    i = S.index(f"CREATE FUNCTION public.{nombre}(")
    m = re.compile(r"\n    AS (\$[A-Za-z_]*\$)").search(S, i)
    tag = m.group(1)
    fin = S.index(tag + ";", m.end() + len(tag)) + len(tag) + 1
    return S[i:fin].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)

GUARDA = "  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK\n"
def con_guarda_plpgsql(t):
    assert t.count("\nbegin\n") == 1, "se esperaba un único 'begin'"
    return t.replace("\nbegin\n", "\nbegin\n" + GUARDA, 1)
def con_guarda_sql(t):
    # Función LANGUAGE sql: la consulta original queda intacta dentro de una subconsulta y la guarda va afuera, como
    # filtro de una sola evaluación (sin alterar la precedencia de AND/OR de la consulta original).
    m = re.compile(r"\n    AS (\$[A-Za-z_]*\$)").search(t); tag = m.group(1)
    ini = m.end(); fin = t.rindex(tag + ";")
    cuerpo = t[ini:fin].rstrip().rstrip(";")
    return t[:ini] + "\n  select z.* from (" + cuerpo + "\n  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026\n" + t[fin:]

# Funciones SECURITY DEFINER que la app (o sus funciones, vistas y pruebas como usuario) ejecuta y que no exigían perfil.
PLPGSQL = ["cartola_manuales", "cartola_vincular", "cartola_quitar_alerta", "fin_calculo_oc", "fin_exigir_sin_bloqueo", "trib_motivo_incompatible"]
SQLF = ["fin_facturas_vigentes", "fin_fila_bloqueada", "fin_tipo_financiamiento", "fin_dif_estado", "fin_dif_monto", "fin_monto_tributario",
        "fin_motivo_bloqueo", "fin_periodo_comision"]
originales = {n: funcion(n) for n in PLPGSQL + list(SQLF) + ["handle_new_user"]}
nuevas = {n: con_guarda_plpgsql(originales[n]) for n in PLPGSQL}
nuevas.update({n: con_guarda_sql(originales[n]) for n in SQLF})

# Funciones de disparador o de sistema que nadie debe llamar desde la API: se les quita EXECUTE a anon/authenticated.
QUITAR_EXEC = {  # nombre(firma): roles que hoy pueden ejecutarla y la pierden (funciones de disparador y de sistema)
    "handle_new_user()": ["PUBLIC", "anon", "authenticated"],
    "oc_trg_proteger_vendedor()": ["PUBLIC", "anon", "authenticated"],
    "rls_auto_enable()": ["PUBLIC", "anon", "authenticated"],
    "pv_es_admin()": ["anon"],
}

# Políticas RLS: las que hoy dejan pasar a CUALQUIER cuenta autenticada, tenga o no perfil BFK.
AUT = "(auth.role() = 'authenticated'::text)"
pols = json.load(open(politicas_json, encoding="utf-8"))
alter, revert = [], []
def expr_nueva(p, e):
    if e is None: return None
    if p["t"] == "oc_bloqueos":
        return "public.bfk_es_usuario()" if e == "true" else f"(public.bfk_es_usuario() AND {e})"
    if p["t"] == "perfiles" and p["p"] == "perfiles_lectura_autenticados":
        return "(public.bfk_es_usuario() OR (id = auth.uid()))"
    if e == AUT: return "public.bfk_es_usuario()"
    if e == "true" and p["roles"] == ["authenticated"]: return "public.bfk_es_usuario()"
    return e
cambiadas = 0
for p in pols:
    if p["t"] == "perfiles" and p["p"] == "perfiles_propio_insert":
        continue
    q, c = expr_nueva(p, p["q"]), expr_nueva(p, p["c"])
    if (q, c) == (p["q"], p["c"]): continue
    cambiadas += 1
    def sent(q_, c_):
        s = f'alter policy {p["p"]} on public.{p["t"]}'
        if q_ is not None: s += f" using ({q_})"
        if c_ is not None: s += f" with check ({c_})"
        return s + ";"
    alter.append(sent(q, c)); revert.append(sent(p["q"], p["c"]))
ins = [p for p in pols if p["t"] == "perfiles" and p["p"] == "perfiles_propio_insert"][0]
assert ins["c"] == "((auth.uid() = id) AND (rol = 'usuario'::text))", ins

# Permisos de tablas: se quitan todos a anon y TRUNCATE/REFERENCES/TRIGGER/MAINTAIN a authenticated.
# La reversión vuelve a dar EXACTAMENTE lo que había (leído del catálogo).
LETRAS = {"a": "insert", "r": "select", "w": "update", "d": "delete", "D": "truncate", "x": "references", "t": "trigger", "m": "maintain"}
grants_rev = []
for l in open(tablas_tsv, encoding="utf-8"):
    f = l.rstrip("\n").split("\t")
    if f[0] != "public" or f[2] not in ("r", "v", "m", "p"): continue
    for item in f[5].split(" "):
        m = re.match(r"^(anon|authenticated)=([a-zA-Z]*)/", item)
        if not m: continue
        quien, letras = m.groups()
        if quien == "authenticated": letras = "".join(x for x in letras if x in "Dxtm")
        if letras:
            grants_rev.append((f[1], quien, [LETRAS[x] for x in letras]))

def lista_quitar():
    return "\n".join(f"revoke execute on function public.{fn} from {', '.join('public' if r == 'PUBLIC' else r for r in roles)};"
                     for fn, roles in QUITAR_EXEC.items())
def lista_devolver():
    return "\n".join(f"grant execute on function public.{fn} to {', '.join('public' if r == 'PUBLIC' else r for r in roles)};"
                     for fn, roles in QUITAR_EXEC.items())

CAB = open(__file__.replace("generar.py", "cabecera_migracion.sql"), encoding="utf-8").read()
FIN = open(__file__.replace("generar.py", "pie_migracion.sql"), encoding="utf-8").read()
CABD = open(__file__.replace("generar.py", "cabecera_deshacer.sql"), encoding="utf-8").read()
FIND = open(__file__.replace("generar.py", "pie_deshacer.sql"), encoding="utf-8").read()

partes = [CAB.replace("__HUELLA_CATALOGO__", huella),
  "-- ── 4. Políticas RLS: de «cualquier cuenta autenticada» a «perfil BFK autorizado» (%d políticas) ──" % cambiadas,
  "\n".join(alter),
  "drop policy perfiles_propio_insert on public.perfiles;   -- nadie crea su propio perfil: lo crea un administrador",
  "",
  "-- ── 5. Funciones SECURITY DEFINER que la app usa y no exigían perfil: misma función + guarda al inicio ──",
  "\n".join(nuevas[n] for n in PLPGSQL + list(SQLF)),
  "-- ── 6. Funciones internas: sin EXECUTE para las cuentas de la API ──",
  lista_quitar(),
  "",
  FIN]
open(out_mig, "w", encoding="utf-8", newline="").write("\n".join(partes))

rev_grants = "\n".join(f"grant {', '.join(p)} on table public.{t} to {q};" for t, q, p in grants_rev if not ("maintain" in p))
rev_grants_m = "\n".join(f"grant {', '.join(p)} on table public.{t} to {q};" for t, q, p in grants_rev if "maintain" in p)
partesd = [CABD.replace("__HUELLA_CATALOGO__", huella),
  "-- ── Políticas RLS a su texto original ──",
  "\n".join(revert),
  f"create policy perfiles_propio_insert on public.perfiles as permissive for insert to public with check ({ins['c']});",
  "",
  "-- ── Funciones a su texto original (copiado literal de producción) ──",
  "\n".join(originales[n] for n in PLPGSQL + list(SQLF) + ["handle_new_user"]),
  "-- ── EXECUTE devuelto exactamente a quien lo tenía ──",
  lista_devolver(),
  "",
  "-- ── Permisos de tablas devueltos exactamente como estaban ──",
  "do $do$ begin",
  "  -- MAINTAIN existe desde PostgreSQL 17 (producción); en una base local más antigua se omite solo ese privilegio.",
  "  if current_setting('server_version_num')::int >= 170000 then",
  "\n".join("    execute $g$" + x + "$g$;" for x in rev_grants_m.split("\n") if x),
  "  else",
  "\n".join("    execute $g$" + re.sub(r", maintain", "", x) + "$g$;" for x in rev_grants_m.split("\n") if x and not x.startswith("grant maintain on")),
  "  end if;",
  "end $do$;",
  rev_grants,
  "",
  FIND.replace("__HUELLA_CATALOGO__", huella)]
open(out_des, "w", encoding="utf-8", newline="").write("\n".join(partesd))
print(f"políticas cambiadas: {cambiadas} · funciones con guarda: {len(nuevas)} · EXECUTE quitados: {len(QUITAR_EXEC)} · grants a devolver: {len(grants_rev)}")
