"""Fase 4B · Pruebas de concurrencia con dos usuarios (sesiones) reales, en una base DESECHABLE.

Uso: python3 concurrencia.py [--modelo-anterior]
  Conexión por variables PG* (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE). Escribe datos de prueba (ids tc_*).
  --modelo-anterior: base SIN la migración 4B; reproduce cómo la aplicación anterior pierde un pago.
Imprime líneas RESULT|nombre|OK o FALLA|nombre|detalle (sin datos de clientes).
"""
import os, sys, threading, time, random, datetime, json
import psycopg2

ANTERIOR = "--modelo-anterior" in sys.argv
HOY = datetime.date.today().isoformat()
fallas = 0


def con(uid=None, autocommit=True):
    c = psycopg2.connect("")
    c.autocommit = autocommit
    if uid:
        cur = c.cursor()
        cur.execute("set role authenticated")
        cur.execute("select set_config('request.jwt.claim.sub', %s, false), set_config('request.jwt.claim.role', 'authenticated', false),"
                    " set_config('request.jwt.claims', %s, false)", (uid, json.dumps({"sub": uid, "role": "authenticated"})))
    return c


def q(c, sql, args=None):
    cur = c.cursor(); cur.execute(sql, args)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None


def ok(nombre, cond, det=""):
    global fallas
    if cond: print(f"RESULT|{nombre}|OK", flush=True)
    else: fallas += 1; print(f"FALLA|{nombre}|{det}", flush=True)


root = con()
ADM = q(root, "select id::text from public.perfiles where rol='admin' order by id limit 1")[0][0]
USR = q(root, "select id::text from public.perfiles where rol is distinct from 'admin' order by id limit 1")[0][0]
saldo = lambda f: q(root, "select saldo_deuda from public.financiadores where id=%s", (f,))[0][0]

# Datos de prueba comunes (confirmados, visibles para ambas sesiones)
a = con(ADM)
q(a, "insert into public.financiadores (id, nombre) values ('tc_fin', 'Concurrencia 4B'), ('tc_fin2', 'Concurrencia 4B (2)') on conflict do nothing")
for i in range(1, 7):
    q(a, "insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total, financiador_id) values (%s, %s, 'Prueba concurrencia', 900000, 'tc_fin') on conflict do nothing",
      (f"tc_oc{i}", f"TC-4B-{i}"))

if ANTERIOR:
    # ── Aplicación anterior (eff7ddb) sobre la base SIN 4B: cada navegador calcula el saldo con lo que tiene en pantalla.
    q(a, "update public.financiadores set saldo_deuda = 500000 where id = 'tc_fin'")
    s0 = saldo("tc_fin")
    A = con(ADM, autocommit=False); B = con(USR)
    visto_por_B = saldo("tc_fin")                      # pantalla de B (antes del pago de A)
    q(A, "select public.registrar_pago_financiador('tc_fin', %s, 100000, '[]', 'prueba')", (HOY,))   # A paga (RPC Fase 7)
    def compra_B():
        q(B, "insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, financiador_id) values ('tc_evc_old', 'tc_oc1', %s, 900000, 50000, 'tc_fin')", (HOY,))
        q(B, "update public.ordenes_compra_v2 set estado_compra='comprado', costo_total=50000 where id='tc_oc1'")
        q(B, "update public.financiadores set saldo_deuda = %s where id = 'tc_fin'", (visto_por_B + 50000,))   # valor calculado en el navegador
    t = threading.Thread(target=compra_B); t.start(); time.sleep(1.0); A.commit(); t.join()
    final = saldo("tc_fin")
    esperado = s0 - 100000 + 50000
    print(f"INFO|modelo_anterior|saldo_inicial={s0} pago=100000 compra=50000 esperado={esperado} final={final}", flush=True)
    ok("C0_modelo_anterior_la_compra_pisa_el_pago_(se_reproduce_el_error)", final == s0 + 50000, f"final={final}")
    sys.exit(0)

# ── C1: un pago registrado y una compra simultánea (dos usuarios) ───────────────────────────
s0 = saldo("tc_fin")
q(a, "select public.registrar_compra_oc('tc_oc1', %s, 300000, 'tc_fin')", (HOY,))
s1 = saldo("tc_fin"); ok("C1a_compra_inicial", s1 == s0 + 300000, f"{s0}->{s1}")
A = con(ADM, autocommit=False); B = con(USR)
t0 = time.time()
q(A, "select public.registrar_pago_financiador('tc_fin', %s, 100000, '[{\"oc_id\":\"tc_oc1\",\"monto\":100000}]', 'prueba')", (HOY,))
espera = {}
def compra_B():
    t = time.time(); q(B, "select public.registrar_compra_oc('tc_oc2', %s, 50000, 'tc_fin')", (HOY,)); espera["s"] = time.time() - t
th = threading.Thread(target=compra_B); th.start(); time.sleep(1.5); A.commit(); th.join()
s2 = saldo("tc_fin")
print(f"INFO|C1|saldo {s1} - pago 100000 + compra 50000 = {s2}; la compra esperó {espera['s']:.2f}s al pago", flush=True)
ok("C1_compra_simultanea_no_pisa_el_pago", s2 == s1 - 100000 + 50000, f"final={s2}")
ok("C1b_la_compra_espero_el_bloqueo_del_pago", espera["s"] >= 1.0, f"{espera['s']:.2f}s")

# ── C2: al revés: compra en curso y pago simultáneo ─────────────────────────────────────────
s3 = saldo("tc_fin")
A = con(USR, autocommit=False); B = con(ADM)
q(A, "select public.registrar_compra_oc('tc_oc3', %s, 70000, 'tc_fin')", (HOY,))
def pago_B():
    q(B, "select public.registrar_pago_financiador('tc_fin', %s, 30000, '[{\"oc_id\":\"tc_oc2\",\"monto\":30000}]', 'prueba')", (HOY,))
th = threading.Thread(target=pago_B); th.start(); time.sleep(1.0); A.commit(); th.join()
s4 = saldo("tc_fin"); ok("C2_pago_simultaneo_no_pisa_la_compra", s4 == s3 + 70000 - 30000, f"{s3}->{s4}")

# ── C3: la aplicación ANTERIOR (escrituras de saldo desde el navegador) contra la base 4B ────
s5 = saldo("tc_fin")
A = con(ADM, autocommit=False); B = con(USR)
visto = saldo("tc_fin")
q(A, "insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto) values ('tc_pago_old', 'tc_fin', null, %s, 100000)", (HOY,))
q(A, "update public.financiadores set saldo_deuda = %s where id = 'tc_fin'", (visto - 100000,))
def compra_old():
    q(B, "insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, financiador_id) values ('tc_evc_old', 'tc_oc4', %s, 900000, 50000, 'tc_fin')", (HOY,))
    q(B, "update public.ordenes_compra_v2 set estado_compra='comprado', costo_total=50000, financiador_id='tc_fin' where id='tc_oc4'")
    q(B, "update public.financiadores set saldo_deuda = %s where id = 'tc_fin'", (visto + 50000,))
th = threading.Thread(target=compra_old); th.start(); time.sleep(1.0); A.commit(); th.join()
s6 = saldo("tc_fin")
ok("C3_app_anterior_contra_base_4B_tampoco_pierde_el_pago", s6 == s5 - 100000 + 50000, f"{s5}->{s6}")

# ── C4: carga concurrente (16 sesiones, operaciones al azar) sobre 3 financiadores ──────────
HISTORICO = q(root, "select id from public.financiadores where tipo='externo' and id not like 'tc%' order by (select count(*) from public.fin_diferencias_historicas d where d.entidad_id=financiadores.id) desc, id limit 1")[0][0]
fins = ["tc_fin", "tc_fin2", HISTORICO]
ini = {f: saldo(f) for f in fins}
errores = []; ops_ok = {"compra": 0, "pago": 0, "editar": 0, "borrar": 0}; cand = threading.Lock()
def trabajador(n):
    c = con(ADM if n % 2 == 0 else USR); r = random.Random(n)
    mias = []
    for k in range(30):
        try:
            op = r.random()
            if op < 0.35 or not mias:
                oc = f"tc_w{n}_{k}"; f = r.choice(fins)
                q(c, "insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values (%s, %s, 'Carga', 500000)", (oc, f"TC-W-{n}-{k}"))
                q(c, "select public.registrar_compra_oc(%s, %s, %s, %s)", (oc, HOY, r.randint(1, 50) * 1000, f)); mias.append((oc, f))
                with cand: ops_ok["compra"] += 1
            elif op < 0.75:
                oc, f = r.choice(mias)
                debe = q(c, "select costo_total - monto_pagado_fin from public.ordenes_compra_v2 where id=%s", (oc,))[0][0]
                if debe > 0:
                    m = min(debe, r.randint(1, 30) * 1000)
                    q(c, "select public.registrar_pago_financiador(%s, %s, %s, %s, 'carga')", (f, HOY, m, json.dumps([{"oc_id": oc, "monto": float(m)}])))
                    with cand: ops_ok["pago"] += 1
            elif op < 0.9:
                oc, f = r.choice(mias)
                ev = q(c, "select id from public.eventos_compra where oc_id=%s", (oc,))[0][0]
                pag = q(c, "select monto_pagado_fin from public.ordenes_compra_v2 where id=%s", (oc,))[0][0]
                q(c, "select public.editar_compra_oc(%s, %s, %s)", (ev, HOY, max(pag, r.randint(1, 60) * 1000)))
                with cand: ops_ok["editar"] += 1
            elif n % 2 == 0:
                oc, f = r.choice(mias)
                p = q(c, "select id from public.eventos_pago_financiamiento where oc_id=%s order by id limit 1", (oc,))
                if p:
                    q(c, "select public.eliminar_pago_financiador(%s)", (p[0][0],))
                    with cand: ops_ok["borrar"] += 1
        except psycopg2.Error as e:
            if "deadlock" in str(e).lower() or "could not serialize" in str(e).lower(): errores.append(str(e).split("\n")[0])
            # validaciones de negocio (p. ej. saldo insuficiente) no son errores de concurrencia
hilos = [threading.Thread(target=trabajador, args=(n,)) for n in range(16)]
t0 = time.time(); [h.start() for h in hilos]; [h.join() for h in hilos]
dur = time.time() - t0
print(f"INFO|C4|{sum(ops_ok.values())} operaciones en {dur:.1f}s: {ops_ok}", flush=True)
ok("C4a_sin_bloqueos_mutuos_ni_conflictos", not errores, "; ".join(errores[:3]))
for f in fins:
    compras = q(root, "select coalesce(sum(e.costo_compra),0) from public.eventos_compra e join public.ordenes_compra_v2 o on o.id=e.oc_id where o.id like 'tc_w%%' and o.financiador_id=%s", (f,))[0][0]
    pagos = q(root, "select coalesce(sum(p.monto),0) from public.eventos_pago_financiamiento p where p.oc_id like 'tc_w%%' and p.financiador_id=%s", (f,))[0][0]
    ok(f"C4b_saldo_exacto_{'historico' if f == HISTORICO else f}", saldo(f) == ini[f] + compras - pagos, f"{ini[f]} + {compras} - {pagos} != {saldo(f)}")
inc = q(root, "select count(*) from public.fin_verificar_consistencia()")[0][0]
ok("C4c_todo_coherente_tras_la_carga", inc == 0, str(inc))
print(f"RESUMEN|concurrencia|fallas={fallas}", flush=True)
sys.exit(1 if fallas else 0)
