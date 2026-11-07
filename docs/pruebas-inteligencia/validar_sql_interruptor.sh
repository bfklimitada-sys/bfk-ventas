#!/bin/bash
# Interruptor de Inteligencia Comercial (06/11/2026): valida BORRADOR-2026-11-06-ic-interruptor.sql en un PostgreSQL
# LOCAL y DESECHABLE (nunca en Supabase). Uso: bash docs/pruebas-inteligencia/validar_sql_interruptor.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
M="$MIG/BORRADOR-2026-11-06-ic-interruptor.sql"; MD="$MIG/BORRADOR-2026-11-06-ic-interruptor-deshacer.sql"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"; U=claude; PORT=55451
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || { cat "$D/log"; exit 1; }
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
export PGHOST="$D" PGPORT=$PORT
Q() { psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
F=0; N=0; ok() { N=$((N+1)); if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222
COMO() { local rol=$1 uid=$2; shift 2; printf '%s\n' "set role $rol; set prueba.uid = '$uid'; $*" | psql -U postgres -d postgres -qAt 2>&1 | grep -Ev '^(SET|CONTEXT|PL/pgSQL|SQL (statement|function))' | tail -1; }
err() { sed -n 's/.*\(ICI[0-9]\{3\}\|permission denied\|does not exist\).*/\1/p' | head -1; }
Q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text);
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana Usuaria','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin Admin','admin');
create function public.bfk_es_usuario() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.perfiles p where p.id = auth.uid()) $$;
create function public.bfk_es_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin') $$;
grant execute on function public.bfk_es_usuario(), public.bfk_es_admin() to anon, authenticated;
-- Datos ic_ existentes de muestra (deben quedar intactos)
create table public.ic_sincronizaciones (id serial primary key, consultados int); insert into public.ic_sincronizaciones (consultados) values (10),(20);
SQL
H0=$(Q -c "select md5(string_agg(to_jsonb(s)::text,'|' order by id)) from public.ic_sincronizaciones s")
Q -1 -f "$M" > "$D/i.log" 2>&1; ok "S01_instala_en_una_transaccion" "$?" 0
ok "S02_segunda_instalacion_rechazada" "$(Q -1 -f "$M" 2>&1 | grep -c 'ya está instalado')" 1
ok "S03_queda_desactivada_al_instalar" "$(COMO anon '' "select public.ic_interruptor_estado();")" '{"habilitada": false}'
ok "S04_anon_no_ve_quien_cambio" "$(COMO anon '' "select public.ic_interruptor_estado() ? 'cambiado_por';")" "f"
ok "S05_usuario_ve_detalle" "$(COMO authenticated $USR "select public.ic_interruptor_estado()->>'motivo' like 'Instalación%';")" "t"
ok "S06_usuario_no_puede_cambiar" "$(COMO authenticated $USR "select public.ic_cambiar_interruptor(true,'REACTIVAR INTELIGENCIA COMERCIAL','x');" | err)" "ICI403"
ok "S07_anon_no_puede_cambiar" "$(COMO anon '' "select public.ic_cambiar_interruptor(true,'REACTIVAR INTELIGENCIA COMERCIAL','x');" | err)" "permission denied"
ok "S08_sin_lectura_directa_de_la_tabla" "$(COMO authenticated $ADM "select * from public.ic_interruptor;" | err)" "permission denied"
ok "S09_sin_escritura_directa" "$(COMO authenticated $ADM "update public.ic_interruptor set habilitada = true;" | err)" "permission denied"
ok "S10_admin_sin_frase_rechazado" "$(COMO authenticated $ADM "select public.ic_cambiar_interruptor(true,'reactivar','motivo');" | err)" "ICI400"
ok "S11_admin_sin_motivo_rechazado" "$(COMO authenticated $ADM "select public.ic_cambiar_interruptor(true,'REACTIVAR INTELIGENCIA COMERCIAL','  ');" | err)" "ICI400"
ok "S12_admin_nulo_rechazado" "$(COMO authenticated $ADM "select public.ic_cambiar_interruptor(null,'','');" | err)" "ICI400"
ok "S13_sigue_desactivada_tras_rechazos" "$(COMO anon '' "select public.ic_interruptor_estado()->>'habilitada';")" "false"
ok "S14_admin_reactiva_explicito" "$(COMO authenticated $ADM "select public.ic_cambiar_interruptor(true,'REACTIVAR INTELIGENCIA COMERCIAL','Prueba local')->>'habilitada';")" "true"
ok "S15_queda_registrado_quien" "$(COMO authenticated $USR "select public.ic_interruptor_estado()->>'cambiado_por';")" "Kevin Admin"
ok "S16_admin_desactiva_sin_frase" "$(COMO authenticated $ADM "select public.ic_cambiar_interruptor(false)->>'habilitada';")" "false"
ok "S17_historial_completo" "$(Q -c "select string_agg(habilitada::text, ',' order by id) from public.ic_interruptor_historial")" "false,true,false"
ok "S18_datos_ic_intactos" "$(Q -c "select md5(string_agg(to_jsonb(s)::text,'|' order by id)) from public.ic_sincronizaciones s")" "$H0"
# Fila borrada (configuración ausente) → desactivada
Q -c "delete from public.ic_interruptor" >/dev/null
ok "S19_sin_fila_es_desactivada" "$(COMO anon '' "select public.ic_interruptor_estado()->>'habilitada';")" "false"
Q -1 -f "$MD" > "$D/d.log" 2>&1; ok "S20_deshacer" "$?" 0
ok "S21_tras_deshacer_la_funcion_no_existe" "$(Q -c "select to_regprocedure('public.ic_interruptor_estado()') is null and to_regclass('public.ic_interruptor') is null")" "t"
ok "S22_tras_deshacer_datos_ic_intactos" "$(Q -c "select md5(string_agg(to_jsonb(s)::text,'|' order by id)) from public.ic_sincronizaciones s")" "$H0"
Q -1 -f "$M" > /dev/null 2>&1; ok "S23_reinstalar_vuelve_desactivada" "$(COMO anon '' "select public.ic_interruptor_estado()->>'habilitada';")" "false"
echo "interruptor SQL: $((N-F))/$N correctas"; exit $F
