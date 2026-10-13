#!/bin/bash
# Valida BORRADOR-2026-10-cotizaciones-v3-eliminar.sql (y su deshacer) en un PostgreSQL LOCAL y desechable.
# Uso: bash docs/pruebas-cotizaciones/validar_sql_v3.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"; U=claude; PORT=55434
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || exit 1
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
Q() { psql -h "$D" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
Q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated; grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text); grant select on public.perfiles to authenticated;
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin','admin');
create table public.vendedores (id text primary key, nombre text not null, activo boolean default true); grant select on public.vendedores to authenticated;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean); create table storage.objects (id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
SQL
for f in BORRADOR-2026-10-cotizaciones.sql BORRADOR-2026-10-cotizaciones-v2.sql; do Q -1 -f "$MIG/$f" >/dev/null 2>&1 || { echo "No se pudo instalar $f"; exit 1; }; done
F=0; ok() { if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
COMO() { local uid=$1; shift; Q -c "set role authenticated; set prueba.uid = '$uid'; $*" 2>&1 | grep -Ev '^(CONTEXT|PL/pgSQL|SQL (statement|function))' | head -1; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222
DEF() { Q -c "select md5(pg_get_functiondef('public.cz_eliminar_cotizacion(uuid,text)'::regprocedure))"; }
F2=$(DEF)
Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v3-eliminar.sql" >/dev/null 2>&1; ok "E1_aplica" $? 0
SIN=$(COMO $USR "select cz_guardar_cotizacion_v2('{\"institucion\":\"Municipio\",\"envios\":[],\"items\":[]}'::jsonb)->>'id'")
CON=$(COMO $USR "select cz_guardar_cotizacion_v2('{\"id_externo\":\"1-1-COT26\",\"nombre\":\"Sillas\",\"envios\":[],\"items\":[]}'::jsonb)->>'id'")
ADJ=$(COMO $USR "select cz_guardar_cotizacion_v2('{\"institucion\":\"X\",\"estado\":\"adjudicada\",\"envios\":[],\"items\":[]}'::jsonb)->>'id'")
CORTO=$(echo "${SIN:0:8}" | tr a-f A-F); CORTO_ADJ=$(echo "${ADJ:0:8}" | tr a-f A-F)
ok "E2_usuario_no_elimina" "$(COMO $USR "select cz_eliminar_cotizacion('$SIN','$CORTO')" | grep -c 'administrador')" 1
ok "E3_sin_codigo_confirmacion_vacia_rechazada" "$(COMO $ADM "select cz_eliminar_cotizacion('$SIN','')" | grep -c 'identificador interno')" 1
ok "E4_sin_codigo_otro_id_rechazado" "$(COMO $ADM "select cz_eliminar_cotizacion('$SIN','$CORTO_ADJ')" | grep -c 'identificador interno')" 1
ok "E5_adjudicada_sin_codigo_bloqueada" "$(COMO $ADM "select cz_eliminar_cotizacion('$ADJ','$CORTO_ADJ')" | grep -c 'adjudicada')" 1
ok "E6_con_codigo_no_acepta_id_interno" "$(COMO $ADM "select cz_eliminar_cotizacion('$CON','$(echo "${CON:0:8}" | tr a-f A-F)')" | grep -c 'código ni con el nombre')" 1
COMO $ADM "select cz_eliminar_cotizacion('$SIN','$(echo "${SIN:0:8}" | tr A-F a-f)')" >/dev/null
ok "E7_sin_codigo_se_elimina_con_id_interno" "$(Q -c "select (select count(*) from cotizaciones where id='$SIN')||'/'||(select count(*) from cotizacion_eliminaciones where cotizacion_id='$SIN' and eliminado_por='$ADM')")" "0/1"
COMO $ADM "select cz_eliminar_cotizacion('$CON','sillas')" >/dev/null
ok "E8_con_codigo_sigue_funcionando" "$(Q -c "select count(*) from cotizaciones where id='$CON'")" 0
ok "E9_adjudicada_intacta" "$(Q -c "select count(*) from cotizaciones where id='$ADJ'")" 1
Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v3-eliminar-deshacer.sql" >/dev/null 2>&1; ok "E10_deshacer_aplica" $? 0
ok "E11_deshacer_restaura_v2" "$(DEF)" "$F2"
ok "E12_permisos_tras_deshacer" "$(Q -c "select has_function_privilege('authenticated','public.cz_eliminar_cotizacion(uuid,text)','execute')::text || '/' || has_function_privilege('anon','public.cz_eliminar_cotizacion(uuid,text)','execute')::text")" "true/false"
N=$(grep -o "ok \"E[0-9]*_" "$0" | wc -l); echo; echo "$((N-F)) OK · $F fallas"; exit $F
