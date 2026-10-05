"""Diagnóstico de entidades_catalogo sobre la COPIA restaurada. Solo lectura.
No imprime contactos ni correos; para grupos que requieren revisión imprime RUT y nombre de la entidad (institución)."""
import json, os, re, subprocess, unicodedata, sys
ENV = dict(os.environ)
def q(sql):
    p = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-A", "-t"], input=sql, capture_output=True, text=True, env=ENV)
    if p.returncode: raise RuntimeError(p.stderr[:400])
    return p.stdout.strip()
def jq(sql): o = q(sql); return json.loads(o) if o else None
def dv(b):
    s, f = 0, 2
    for ch in reversed(b): s += int(ch) * f; f = 2 if f == 7 else f + 1
    r = 11 - s % 11; return "0" if r == 11 else "K" if r == 10 else str(r)
def limpio(r): return re.sub(r"[\s.\-‐-―]", "", str(r or "")).upper()
def clave(r): return re.sub(r"^0+(?=.)", "", re.sub(r"[^0-9K]", "", str(r or "").upper()))
def valido(r):
    l = limpio(r); return bool(re.fullmatch(r"[0-9]{7,8}[0-9K]", l)) and int(l[:-1]) >= 1000000 and dv(l[:-1]) == l[-1]
def fmt(r):
    l = limpio(r); c, d = l[:-1], l[-1]; return f"{int(c):,}".replace(",", ".") + "-" + d
def nt(s):
    s = unicodedata.normalize("NFD", str(s or "")); s = "".join(ch for ch in s if unicodedata.category(ch) != "Mn")
    s = re.sub(r"[.,;:'\"´`()\-_/]", " ", s.lower()); return re.sub(r"\s+", " ", s).strip()

print("===== 1. ESQUEMA Y REFERENCIAS =====")
print("FK hacia entidades_catalogo:", q("select coalesce(string_agg(conrelid::regclass||'.'||conname,', '),'ninguna') from pg_constraint where confrelid='public.entidades_catalogo'::regclass"))
cols = jq("""select json_agg(json_build_object('t',table_name,'c',column_name)) from information_schema.columns where table_schema='public' and data_type in ('text','character varying')
  and table_name<>'entidades_catalogo' and (column_name ilike '%rut%' or column_name ilike '%entidad%')""") or []
for c in cols:
    n = q(f'select count(*) filter (where nullif(btrim("{c["c"]}"),\'\') is not null) from public."{c["t"]}"')
    print(f"  columna {c['t']}.{c['c']}: {n} valores no vacíos")
ids = set(q("select id from public.entidades_catalogo").split("\n"))
txt = jq("""select json_agg(json_build_object('t',c.table_name,'c',c.column_name)) from information_schema.columns c join information_schema.tables t using (table_schema,table_name)
  where c.table_schema='public' and t.table_type='BASE TABLE' and c.data_type in ('text','character varying') and c.table_name<>'entidades_catalogo'""") or []
refs = []
for c in txt:
    n = int(q(f'select count(*) from public."{c["t"]}" x where x."{c["c"]}" in (select id from public.entidades_catalogo)'))
    if n: refs.append(f"{c['t']}.{c['c']}={n}")
print("Columnas de texto que contienen IDs de entidades:", refs or "ninguna")
jsonc = jq("""select json_agg(json_build_object('t',table_name,'c',column_name)) from information_schema.columns where table_schema='public' and data_type in ('json','jsonb')""") or []
jr = []
for c in jsonc:
    n = int(q(f'select count(*) from public."{c["t"]}" x where x."{c["c"]}"::text ~ \'"ent_[0-9]\''))
    if n: jr.append(f"{c['t']}.{c['c']}={n}")
print("Columnas JSON que mencionan IDs ent_:", jr or "ninguna")

E = jq("""select json_agg(json_build_object('id',id,'rut',rut,'nombre',nombre_entidad,'comuna',comuna,'contacto',contacto,'correo',correo,'creado',"creadoEn",'por',creado_por) order by id) from public.entidades_catalogo""")
OCS = jq("""select json_agg(json_build_object('id',id,'rut',rut_cliente,'cliente',cliente,'entidad',entidad,'comuna',comuna,'contacto',contacto,'correo',correo_cliente,'creado',"creadoEn",'por',creado_por)) from public.ordenes_compra_v2""") or []
CC = []
if q("select count(*) from information_schema.columns where table_name='contactos_cobranza' and column_name='rut'") == "1":
    CC = jq("select json_agg(json_build_object('rut',rut)) from public.contactos_cobranza") or []
print(f"\nentidades={len(E)} ocs={len(OCS)} contactos_cobranza_con_rut={sum(1 for c in CC if c['rut'])}")
oc_exact = {}; oc_key = {}
for o in OCS:
    if o["rut"]: oc_exact[o["rut"].strip()] = oc_exact.get(o["rut"].strip(), 0) + 1; oc_key.setdefault(clave(o["rut"]), []).append(o)
cc_exact = {}
for c in CC:
    if c["rut"]: cc_exact[c["rut"].strip()] = cc_exact.get(c["rut"].strip(), 0) + 1

print("\n===== 2. FORMATOS =====")
f_p = sum(1 for e in E if re.fullmatch(r"[0-9]{1,2}\.[0-9]{3}\.[0-9]{3}-[0-9Kk]", e["rut"])); f_g = sum(1 for e in E if re.fullmatch(r"[0-9]{7,8}-[0-9Kk]", e["rut"]))
print(f"con puntos={f_p} solo guion={f_g} otros={len(E)-f_p-f_g} k_minuscula={sum(1 for e in E if e['rut'].endswith('k'))} con_espacios={sum(1 for e in E if e['rut']!=e['rut'].strip())}")
otros = [e for e in E if not re.fullmatch(r"[0-9]{1,2}\.[0-9]{3}\.[0-9]{3}-[0-9Kk]", e["rut"]) and not re.fullmatch(r"[0-9]{7,8}-[0-9Kk]", e["rut"])]
for e in otros: print("  formato otro:", repr(e["rut"]), "| válido:", valido(e["rut"]))
print("OCs: rut con puntos=%d solo guion=%d vacio=%d invalido=%d" % (sum(1 for o in OCS if o['rut'] and '.' in o['rut']), sum(1 for o in OCS if o['rut'] and '.' not in o['rut']), sum(1 for o in OCS if not o['rut']), sum(1 for o in OCS if o['rut'] and not valido(o['rut']))))

print("\n===== 3. RUT INVÁLIDOS =====")
for e in E:
    if valido(e["rut"]): continue
    l = limpio(e["rut"]); cuerpo = re.sub(r"\D", "", l[:-1]) if l else ""
    mismo_cuerpo_oc = sorted({o["rut"] for o in OCS if o["rut"] and re.sub(r"\D", "", limpio(o["rut"])[:-1]) == cuerpo})
    mismo_cuerpo_ent = sorted({x["rut"] for x in E if x is not e and re.sub(r"\D", "", limpio(x["rut"])[:-1]) == cuerpo})
    print(f"  RUT {e['rut']!r} nombre={e['nombre']!r} dv_correcto_calculado={dv(cuerpo) if cuerpo.isdigit() and cuerpo else '?'}")
    print(f"     OCs con mismo RUT exacto={oc_exact.get(e['rut'].strip(),0)} | OCs con mismo cuerpo: {mismo_cuerpo_oc} | otras entidades con mismo cuerpo: {mismo_cuerpo_ent}")
    for o in OCS:
        if o["rut"] and re.sub(r"\D", "", limpio(o["rut"])[:-1]) == cuerpo:
            print(f"     OC: rut={o['rut']!r} válido={valido(o['rut'])} cliente_coincide_nombre={nt(o['cliente'])==nt(e['nombre']) or nt(o['entidad'])==nt(e['nombre'])}")

print("\n===== 4. CREADO_POR VACÍO =====")
sin = [e for e in E if not e["por"]]
print(f"sin creado_por={len(sin)}; de ellos con OC exacta={sum(1 for e in sin if oc_exact.get(e['rut'].strip()))}")
fechas = sorted(e["creado"][:10] for e in sin if e["creado"]); print("  rango creadoEn:", fechas[0] if fechas else "-", "→", fechas[-1] if fechas else "-")
amb = 0; uni = 0
for e in sin:
    autores = {o["por"] for o in oc_key.get(clave(e["rut"]), []) if o["por"]}
    if len(autores) == 1: uni += 1
    elif len(autores) > 1: amb += 1
print(f"  con un único autor de OCs del mismo RUT={uni}; con varios autores={amb}; sin OCs={len(sin)-uni-amb}")
print("  creadoEn de sin creado_por agrupado por día:", {d: fechas.count(d) for d in sorted(set(fechas))})

print("\n===== 5. GRUPOS DUPLICADOS =====")
G = {}
for e in E: G.setdefault(clave(e["rut"]), []).append(e)
grupos = {k: v for k, v in G.items() if len(v) > 1}
print(f"grupos={len(grupos)} tamaños={sorted({len(v) for v in grupos.values()})}")
CAMPOS = ["nombre", "comuna", "contacto", "correo"]
res = {"auto": 0, "contiene": 0, "manual": 0}; filas_finales = len(E)
detalle = []
for i, (k, rows) in enumerate(sorted(grupos.items()), 1):
    cat = {}
    for c in CAMPOS:
        vals = [r[c] for r in rows if str(r[c] or "").strip()]
        normd = sorted({nt(v) for v in vals})
        if len(normd) <= 1: cat[c] = "igual" if vals and len(vals) == len(rows) else ("uno_vacio" if vals else "vacios")
        else:
            larg = max(normd, key=len)
            cat[c] = "contiene" if all(n in larg for n in normd) else "distinto"
        if len(normd) <= 1 and len({str(v).strip() for v in vals}) > 1: cat[c] += "(solo_mayus/tildes/puntuacion)"
    usos = [oc_exact.get(r["rut"].strip(), 0) for r in rows]; llenos = [sum(1 for c in CAMPOS if str(r[c] or "").strip()) for r in rows]
    cc = [cc_exact.get(r["rut"].strip(), 0) for r in rows]
    estado = "manual" if any(v.startswith("distinto") for v in cat.values()) else ("contiene" if any(v.startswith("contiene") for v in cat.values()) else "auto")
    res[estado] += 1
    formatos = ["puntos" if "." in r["rut"] else "guion" for r in rows]
    detalle.append((i, k, estado, cat, usos, llenos, cc, formatos, [bool(r["por"]) for r in rows], [valido(r["rut"]) for r in rows]))
for d in detalle:
    i, k, estado, cat, usos, llenos, cc, formatos, por, val = d
    print(f"G{i:02d} {estado.upper():8s} formatos={formatos} ocs_exactas={usos} campos_llenos={llenos} contactos_cobranza={cc} creado_por={por} rut_valido={val} | " + " ".join(f"{c}:{v}" for c, v in cat.items()))
print(f"\nRESUMEN GRUPOS: automáticos(iguales)={res['auto']} contiene(uno incluye al otro)={res['contiene']} con_valores_distintos={res['manual']}")
# detalle de campos distintos por tipo
from collections import Counter
cnt = Counter()
for d in detalle:
    for c, v in d[3].items():
        if v.startswith("distinto"): cnt[c] += 1
print("campos con valores realmente distintos (n grupos):", dict(cnt))
# solo para grupos con NOMBRE distinto: mostrar RUT y nombres (instituciones)
for d in detalle:
    if d[3]["nombre"].startswith("distinto") or d[3]["nombre"].startswith("contiene"):
        rows = grupos[d[1]]; print(f"  G{d[0]:02d} rut={fmt(rows[0]['rut']) if valido(rows[0]['rut']) else rows[0]['rut']} nombres={[r['nombre'] for r in rows]}")
# OCs: contactos/correos más recientes por RUT ayudan a decidir? (solo conteo)
ayuda = 0
for d in detalle:
    if d[2] != "manual": continue
    rows = grupos[d[1]]; ocs = sorted(oc_key.get(d[1], []), key=lambda o: o["creado"] or "")
    if not ocs: continue
    ult = ocs[-1]; ok = True
    for c, oc_c in (("nombre", None), ("comuna", "comuna"), ("contacto", "contacto"), ("correo", "correo")):
        if not d[3][c].startswith("distinto"): continue
        if c == "nombre": cand = {nt(ult["cliente"]), nt(ult["entidad"])}
        else: cand = {nt(ult[oc_c])}
        if not any(nt(r[c]) in cand for r in rows): ok = False
    ayuda += ok
print(f"grupos con valores distintos donde la OC más reciente del RUT coincide con uno de los valores en todos los campos en conflicto: {ayuda}")
print("\n===== 6. ENTIDADES vs OCs =====")
ent_keys = {clave(e["rut"]) for e in E}
oc_keys = {clave(o["rut"]) for o in OCS if o["rut"]}
print(f"RUT distintos (normalizados) en OCs={len(oc_keys)}; con entidad={len(oc_keys & ent_keys)}; sin entidad={len(oc_keys - ent_keys)}")
print(f"OCs cuyo RUT coincide con una entidad SOLO normalizado (no exacto)={sum(1 for o in OCS if o['rut'] and clave(o['rut']) in ent_keys and o['rut'].strip() not in {e['rut'] for e in E})}")
print(f"entidades sin ninguna OC (normalizado)={sum(1 for e in E if clave(e['rut']) not in oc_keys)}")

print("\n===== 7. EVIDENCIA DE OCs PARA CAMPOS EN CONFLICTO =====")
from collections import Counter
cnt = Counter(); por_grupo = []
for d in detalle:
    i, k = d[0], d[1]; rows = grupos[k]; ocs = sorted(oc_key.get(k, []), key=lambda o: o["creado"] or "")
    estado_g = "auto"
    for c, oc_c in (("nombre", None), ("comuna", "comuna"), ("contacto", "contacto"), ("correo", "correo")):
        cat = d[3][c]
        if not (cat.startswith("distinto") or cat.startswith("contiene")): continue
        cands = {nt(r[c]) for r in rows if str(r[c] or "").strip()}
        def vals(o): return {nt(o["cliente"]), nt(o["entidad"])} if c == "nombre" else {nt(o[oc_c])}
        matches = [(o, cands & vals(o)) for o in ocs]
        conval = [m for m in matches if m[1]]
        unicos = {next(iter(m[1])) for m in conval if len(m[1]) == 1}
        ambos = sum(1 for m in conval if len(m[1]) > 1)
        if conval and len(unicos) == 1 and not ambos and len(conval) == len([o for o in ocs if any(vals(o) - {""})]):
            r = "unanime_todas_las_ocs"
        elif conval and len(unicos) == 1:
            r = "unanime_entre_ocs_que_coinciden(otras_ocs_con_otro_texto)"
        elif conval and matches[-1][1] and len(matches[-1][1]) == 1:
            r = "solo_la_mas_reciente(ocs_divididas)"
        else:
            r = "sin_evidencia"
        cnt[(c, r)] += 1
        if r != "unanime_todas_las_ocs": estado_g = "manual"
        por_grupo.append(f"G{i:02d} {c}: {r} (ocs={len(ocs)}, ocs_que_coinciden={len(conval)}, coinciden_ambos={ambos})")
for l in por_grupo: print(" ", l)
for (c, r), n in sorted(cnt.items()): print(f"  {c} -> {r}: {n}")
# texto exacto de la OC más reciente vs candidatos (para nombre): ¿cliente o entidad?
cl = en = 0
for d in detalle:
    if not d[3]["nombre"].startswith(("distinto", "contiene")): continue
    rows = grupos[d[1]]; ocs = sorted(oc_key.get(d[1], []), key=lambda o: o["creado"] or "")
    if not ocs: continue
    u = ocs[-1]; cands = {nt(r["nombre"]) for r in rows}
    cl += nt(u["cliente"]) in cands; en += nt(u["entidad"]) in cands
print(f"  nombre coincide con OC.cliente={cl} con OC.entidad={en}")
# fila invalida 61606800-6: nombres
for e in E:
    if limpio(e["rut"])[:-1] == "61606800": print("  ent 61606800:", e["rut"], "| nombre_norm_igual_al_resto:", len({nt(x['nombre']) for x in E if limpio(x['rut'])[:-1]=='61606800'})==1, "| campos_llenos:", sum(1 for c in CAMPOS if str(e[c] or '').strip()), "| creado_por:", bool(e["por"]))
print("  contactos_cobranza con 61606800:", sum(1 for c in CC if c["rut"] and limpio(c["rut"])[:-1] == "61606800"))
print("  OCs con 61606800:", [(o["rut"], (o["creado"] or "")[:10], nt(o["cliente"])==nt(o["entidad"])) for o in OCS if o["rut"] and limpio(o["rut"])[:-1]=="61606800"])
sin_grupo = [e for e in sin if len(G[clave(e["rut"])]) == 1]
print("  sin creado_por fuera de grupos:", [(e["rut"], valido(e["rut"])) for e in sin_grupo])
print("  hyphen-only fuera de grupos:", [e["rut"] for e in E if re.fullmatch(r"[0-9]{7,8}-[0-9Kk]", e["rut"]) and len(G[clave(e["rut"])]) == 1])
print("  k minúscula: en grupos=", sum(1 for e in E if e["rut"].endswith("k") and len(G[clave(e["rut"])]) > 1), " fuera=", sum(1 for e in E if e["rut"].endswith("k") and len(G[clave(e["rut"])]) == 1))
# contactos_cobranza: formatos y coincidencia con entidades
print("  contactos_cobranza: con puntos=", sum(1 for c in CC if c["rut"] and "." in c["rut"]), " sin=", sum(1 for c in CC if c["rut"] and "." not in c["rut"]), " sin entidad (normalizado)=", sum(1 for c in CC if c["rut"] and clave(c["rut"]) not in ent_keys))
