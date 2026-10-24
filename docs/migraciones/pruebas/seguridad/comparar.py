# Resume la matriz de acceso (SQL y REST) antes y después de la corrección.
# Uso: python3 comparar.py matriz_antes.txt matriz_despues.txt rest_antes.txt rest_despues.txt
# Imprime RESULT|nombre|OK o FALLA|nombre|detalle, e INFO con los conteos. Sin datos de negocio.
import re, sys
from collections import defaultdict

def leer(f):
    d = {}
    for l in open(f, encoding="utf-8"):
        p = l.rstrip("\n").split("|")
        if len(p) >= 6 and p[0] in ("M", "R"):
            d[(p[2], p[3], p[4])] = "|".join(p[5:])
    return d

ma, md, ra, rd = (leer(f) for f in sys.argv[1:5])
fallas = 0
def res(nombre, ok, det=""):
    global fallas
    if ok: print(f"RESULT|{nombre}|OK")
    else: fallas += 1; print(f"FALLA|{nombre}|{det[:900]}")

def violacion(obj, op, r):
    if obj.startswith("fn:") or op == "perfil_automatico": return False
    if re.match(r"^LEE [1-9]", r): return True
    if r.startswith("PERMITE"): return True
    if r.startswith("EJECUTA DEVUELVE") and r not in ("EJECUTA DEVUELVE false",): return True
    return False

RESTRINGIDAS_ANTES = ["anon", "sinperfil", "respaldo"]
RESTRINGIDAS_DESPUES = ["anon", "sinperfil", "respaldo", "nueva"]
for nombre, d, cuentas in [("sql_antes", ma, RESTRINGIDAS_ANTES + ["nueva"]), ("rest_antes", ra, RESTRINGIDAS_ANTES + ["nueva"])]:
    for c in cuentas:
        v = sorted(f"{o}:{op}={r}" for (cc, o, op), r in d.items() if cc == c and violacion(o, op, r))
        print(f"INFO|{nombre}|{c}|accesos_indebidos={len(v)}|{'; '.join(v[:12])}")
for nombre, d in [("sql_despues", md), ("rest_despues", rd)]:
    for c in RESTRINGIDAS_DESPUES:
        v = sorted(f"{o}:{op}={r}" for (cc, o, op), r in d.items() if cc == c and violacion(o, op, r))
        total = sum(1 for (cc, _, _) in d if cc == c)
        res(f"{nombre}_{c}_sin_acceso_financiero ({total} pruebas)", total > 0 and not v, "; ".join(v))

res("cuenta_nueva_ya_no_recibe_perfil", md.get(("nueva", "registro", "perfil_automatico")) == "NO", str(md.get(("nueva", "registro", "perfil_automatico"))))
print(f"INFO|antes|cuenta_nueva_recibia_perfil|{ma.get(('nueva', 'registro', 'perfil_automatico'))}")
res("cuenta_respaldo_no_recibe_perfil", md.get(("respaldo", "registro", "perfil_automatico")) == "NO")
res("admin_no_puede_autorizar_cuenta_aislada", (md.get(("admin", "rpc:autorizar_cuenta_respaldo", "call")) or "").startswith("DENEGADO"),
    str(md.get(("admin", "rpc:autorizar_cuenta_respaldo", "call"))))
res("admin_autoriza_cuenta_nueva", (md.get(("admin", "rpc:autorizar_cuenta_nueva", "call")) or "").startswith("EJECUTA"),
    str(md.get(("admin", "rpc:autorizar_cuenta_nueva", "call"))))
for c in ["usuario", "nueva", "sinperfil", "respaldo"]:
    for k in ["autopromocion_admin", "cambiar_su_vendedor", "autoinsertar_perfil", "bfk_autorizar_cuenta_a_si_misma"]:
        r = md.get((c, f"rpc:{k}", "call"), "")
        res(f"{c}_no_puede_{k}", r.startswith("DENEGADO") or r == "EJECUTA (sin datos)", r)
    r = rd.get((c, "perfiles", "autopromocion_admin"), "")
    res(f"rest_{c}_no_puede_autopromoverse", not r.startswith("PERMITE"), r)
res("usuario_puede_cambiar_su_nombre", md.get(("usuario", "rpc:cambiar_su_nombre", "call")) == "EJECUTA DEVUELVE datos")

# Usuarios legítimos: mismo resultado antes y después, salvo los cambios esperados. Un rechazo se compara por su tipo
# (código HTTP / SQLSTATE), no por el texto del mensaje (la corrección agrega mensajes más claros a rechazos que ya existían).
def norma(r):
    if r is None: return None
    t = r.split(" ")
    if t[0] in ("NO", "OTRO"): return " ".join(t[:2])
    if t[0] == "DENEGADO": return "DENEGADO"
    return r
ESPERADOS = re.compile(r"^(fn:|rpc:bfk_|rpc:autorizar_cuenta_|rpc:autoinsertar_perfil|rpc:autopromocion_admin|rpc:cambiar_su_vendedor|"
                       r"rpc:fin_dif_monto|rpc:fin_monto_tributario|rpc:fin_periodo_comision|public\.perfiles_autorizaciones|perfiles_autorizaciones|"
                       r"registro$)")
for nombre, a, d in [("sql", ma, md), ("rest", ra, rd)]:
    for c in ["usuario", "admin"]:
        difs = []
        for k in sorted(set(a) | set(d)):
            if k[0] != c or ESPERADOS.match(k[1]): continue
            if (k[1] in ("public.perfiles", "perfiles")) and k[2] in ("insert", "autoinsertar"): continue
            if k[1] in ("public.perfiles", "perfiles") and k[2] == "select":
                # Antes de la corrección, la cuenta «nueva» de la prueba recibía un perfil automático: había un perfil más.
                ma_ = re.match(r"LEE (\d+)/(\d+)", a.get(k) or ""); md_ = re.match(r"LEE (\d+)/(\d+)", d.get(k) or "")
                if ma_ and md_ and int(ma_.group(1)) - 1 == int(md_.group(1)) and int(ma_.group(2)) - 1 == int(md_.group(2)): continue
            if norma(a.get(k)) != norma(d.get(k)): difs.append(f"{k[1]}:{k[2]} {a.get(k)} → {d.get(k)}")
        n = sum(1 for k in d if k[0] == c)
        res(f"{nombre}_{c}_mismo_acceso_que_antes ({n} pruebas)", not difs, "; ".join(difs[:15]))
    # Lo esperado que sí cambia, para el informe
    for c in ["usuario", "admin"]:
        cambios = [f"{k[1]}:{k[2]} {a.get(k)} → {d.get(k)}" for k in sorted(set(a) | set(d))
                   if k[0] == c and not k[1].startswith("fn:") and a.get(k) != d.get(k)]
        print(f"INFO|{nombre}|{c}|cambios_esperados={len(cambios)}|{'; '.join(cambios[:10])}")

# Funciones SECURITY DEFINER ejecutables por anon después de la corrección (solo las de acceso, que devuelven booleanos).
anon_def = sorted(k[1] for k, r in md.items() if k[0] == "anon" and k[1].startswith("fn:") and r == "PUEDE (definer)")
res("anon_solo_ejecuta_funciones_de_acceso", all(re.match(r"fn:bfk_(es_usuario|es_admin|exigir_perfil_api)\(", f) for f in anon_def), "; ".join(anon_def))
print(f"INFO|resumen|fallas={fallas}")
sys.exit(1 if fallas else 0)
