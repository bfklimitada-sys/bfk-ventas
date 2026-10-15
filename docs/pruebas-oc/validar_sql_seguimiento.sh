#!/bin/bash
# Valida BORRADOR-2026-10-15-seguimiento-especial.sql (y su deshacer) en un PostgreSQL LOCAL y desechable.
# Uso: bash docs/pruebas-oc/validar_sql_seguimiento.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"; U=claude; PORT=55436
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || exit 1
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
Q() { psql -h "$D" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
Q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select case when current_setting('prueba.uid', true) <> '' then 'authenticated' else 'anon' end $$;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text); grant select on public.perfiles to authenticated;
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin','admin');
create table public.ordenes_compra_v2 (id text primary key, numero_oc text, monto_total numeric, costo_total numeric);
insert into public.ordenes_compra_v2 values ('oc1','1234-56-AG26',2380000,1271990), ('oc2','2000-1-SE26',500000,300000);
grant select, insert, update, delete on public.ordenes_compra_v2 to authenticated;
SQL
F=0; ok() { if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
COMO() { local uid=$1; shift; Q -c "set role authenticated; set prueba.uid = '$uid'; $*" 2>&1 | grep -Ev '^(CONTEXT|PL/pgSQL|SQL (statement|function))' | head -1; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222
ANTES=$(Q -c "select md5(string_agg(t::text, ',' order by id)) from public.ordenes_compra_v2 t")
Q -1 -f "$MIG/BORRADOR-2026-10-15-seguimiento-especial.sql" >/dev/null 2>&1; ok "S01_aplica" $? 0
COMO $USR "insert into oc_seguimientos (id, oc_id, categoria, descripcion, prioridad, sobrecosto_estimado, creado_por, creado_por_nombre) values ('s1','oc1','sobrecosto','Aumento del costo de despacho','media',25000,'$ADM','Falso')" >/dev/null
ok "S02_autor_lo_fija_la_base" "$(Q -c "select creado_por||' '||creado_por_nombre||' '||estado from oc_seguimientos where id='s1'")" "$USR Ana pendiente"
ok "S03_no_se_crea_resuelto" "$(COMO $USR "insert into oc_seguimientos (id, oc_id, categoria, descripcion, estado, solucion) values ('s2','oc1','otro','x','resuelto','y')" | grep -c 'se crea abierto')" "1"
ok "S04_categoria_invalida" "$(COMO $USR "insert into oc_seguimientos (id, oc_id, categoria, descripcion) values ('s3','oc1','inventada','x')" | grep -c 'violates check')" "1"
ok "S05_sobrecosto_negativo" "$(COMO $USR "insert into oc_seguimientos (id, oc_id, categoria, descripcion, sobrecosto_estimado) values ('s4','oc1','otro','x',-5)" | grep -c 'violates check')" "1"
COMO $USR "insert into oc_seguimientos (id, oc_id, categoria, descripcion, prioridad) values ('s5','oc1','postventa','Posible garantía del monitor','alta')" >/dev/null
COMO $USR "update oc_seguimientos set estado='en_gestion', prioridad='alta', responsable_id='$ADM', responsable_nombre='Kevin' where id='s1'" >/dev/null
ok "S06_en_gestion_y_responsable" "$(Q -c "select estado||' '||prioridad||' '||responsable_nombre||' '||(actualizado_por='$USR') from oc_seguimientos where id='s1'")" "en_gestion alta Kevin true"
ok "S07_resolver_exige_solucion" "$(COMO $USR "update oc_seguimientos set estado='resuelto' where id='s1'" | grep -c 'describe brevemente la solución')" "1"
COMO $USR "update oc_seguimientos set estado='resuelto', solucion='Proveedor asumió el despacho' where id='s1'" >/dev/null
ok "S08_resuelto_registra_quien_y_cuando" "$(Q -c "select estado||' '||resuelto_por_nombre||' '||(resuelto_en is not null) from oc_seguimientos where id='s1'")" "resuelto Ana true"
ok "S09_resuelto_congelado_para_usuario" "$(COMO $USR "update oc_seguimientos set descripcion='otra' where id='s1'" | grep -c 'ya está resuelto')" "1"
COMO $ADM "update oc_seguimientos set descripcion='Aumento del costo de despacho (corregido)' where id='s1'" >/dev/null
ok "S10_admin_puede_corregir_resuelto" "$(Q -c "select descripcion||' · '||resuelto_por_nombre from oc_seguimientos where id='s1'")" "Aumento del costo de despacho (corregido) · Ana"
ok "S11_no_cambia_oc_ni_autor" "$(COMO $USR "update oc_seguimientos set oc_id='oc2' where id='s5'" | grep -c 'No se puede cambiar')" "1"
ok "S12_usuario_no_borra" "$(COMO $USR "delete from oc_seguimientos where id='s5'"; Q -c "select count(*) from oc_seguimientos where id='s5'")" "1"
ok "S13_anonimo_no_lee" "$(Q -c "set role anon; select count(*) from oc_seguimientos" 2>&1 | grep -c 'permission denied')" "1"
ok "S14_oc_con_seguimiento_no_se_borra" "$(COMO $ADM "delete from ordenes_compra_v2 where id='oc1'" | grep -c 'violates foreign key')" "1"
COMO $ADM "delete from oc_seguimientos where id='s5'" >/dev/null
ok "S15_admin_borra" "$(Q -c "select count(*) from oc_seguimientos where id='s5'")" "0"
ok "S16_tablas_existentes_intactas" "$(Q -c "select md5(string_agg(t::text, ',' order by id)) from public.ordenes_compra_v2 t")" "$ANTES"
Q -1 -f "$MIG/BORRADOR-2026-10-15-seguimiento-especial-deshacer.sql" >/dev/null 2>&1; ok "S17_deshacer" $? 0
ok "S18_deshacer_limpio" "$(Q -c "select count(*) from pg_class where relname='oc_seguimientos'")|$(Q -c "select count(*) from pg_proc where proname in ('seg_es_admin','seg_antes_guardar')")|$(Q -c "select md5(string_agg(t::text, ',' order by id)) from public.ordenes_compra_v2 t")" "0|0|$ANTES"
Q -1 -f "$MIG/BORRADOR-2026-10-15-seguimiento-especial.sql" >/dev/null 2>&1; ok "S19_reaplicable" $? 0
echo; echo "$((19-F)) OK · $F fallas"; exit $F
