#!/bin/bash
# Valida el BORRADOR SQL del módulo en un PostgreSQL LOCAL y desechable (nunca en Supabase).
# Simula lo mínimo de Supabase: roles anon/authenticated, auth.uid(), perfiles y storage.
# Uso: bash docs/pruebas-cotizaciones/validar_sql.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"
U=claude; PORT=55432
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || { cat "$D/log"; exit 1; }
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
Q() { psql -h "$D" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
Q <<'SQL'
create role anon nologin; create role authenticated nologin;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text);
grant select on public.perfiles to authenticated;
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Usuario','usuario'), ('22222222-2222-2222-2222-222222222222','Admin','admin');
create table public.ordenes_compra_v2 (id serial primary key, numero_oc text); insert into public.ordenes_compra_v2 (numero_oc) values ('OC-EXISTENTE');
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
SQL
F=0; ok() { if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
ANTES=$(Q -c "select md5(string_agg(numero_oc, ',')) from public.ordenes_compra_v2")
Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones.sql" > "$D/apl.log" 2>&1; ok "S1_aplica_en_una_transaccion" $? 0
ok "S2_reaplicar_se_rechaza" "$(Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones.sql" 2>&1 | grep -c 'ya existe')" 1
ok "S3_tablas_existentes_intactas" "$(Q -c "select md5(string_agg(numero_oc, ',')) from public.ordenes_compra_v2")" "$ANTES"
ok "S4_parte_vacia" "$(Q -c "select (select count(*) from cotizaciones)+(select count(*) from productos_catalogo)")" 0
COMO() { local uid=$1; shift; Q -c "set role authenticated; set prueba.uid = '$uid'; $*" 2>&1 | grep -Ev '^(CONTEXT|PL/pgSQL|SQL statement)' | head -1; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222; EXT=33333333-3333-3333-3333-333333333333
P='{"id_externo":"1525570-33-COT26","institucion":"Municipio","recargo":0.3,"estado":"borrador","subtotal_neto":271575,"impuestos":51599,"total":323174,
 "envios":[{"key":"e1","proveedor":"Falabella","monto":"5990","estado":"confirmado","con_factura":true}],
 "items":[{"key":"i1","envio_key":"e1","enlace":"https://falabella.com/x","proveedor":"Falabella","cantidad":3,"precio_origen":82865,"unitario_venta_neto":90525,"ficha":{"nombre":"Silla","marca":"X"},"ficha_aprobada":true},
          {"key":"i2","envio_key":"e1","cantidad":1,"precio_origen":1000,"ficha":{"nombre":"Cable"}}]}'
R=$(COMO $USR "select cz_guardar_cotizacion('$P'::jsonb)"); ID=$(echo "$R" | sed -E 's/.*"id": "([^"]+)".*/\1/')
ok "S5_usuario_guarda_por_rpc" "$(echo "$R" | grep -c '"version": 1')" 1
ok "S6_lineas_y_envios_guardados" "$(Q -c "select (select count(*) from cotizacion_items where cotizacion_id='$ID')||'/'||(select count(*) from cotizacion_envios where cotizacion_id='$ID')||'/'||(select count(*) from cotizacion_versiones)")" "2/1/1"
ok "S7_escritura_directa_bloqueada" "$(COMO $USR "insert into cotizaciones (institucion) values ('x')" | grep -c 'permission denied')" 1
ok "S8_borrado_directo_bloqueado" "$(COMO $ADM "delete from cotizaciones" | grep -c 'permission denied')" 1
ok "S9_sin_perfil_no_lee" "$(COMO $EXT "select count(*) from cotizaciones")" 0
ok "S10_sin_perfil_no_guarda" "$(COMO $EXT "select cz_guardar_cotizacion('$P'::jsonb)" | grep -c 'sin perfil')" 1
ok "S11_anonimo_sin_acceso" "$(Q -c "set role anon; select count(*) from cotizacion_items" 2>&1 | grep -c 'permission denied')" 1
P2=$(echo "$P" | sed "s/\"id_externo\"/\"id\":\"$ID\",\"version\":1,\"id_externo\"/")
ok "S12_segundo_guardado_version_2" "$(COMO $USR "select cz_guardar_cotizacion('$P2'::jsonb)->>'version'")" 2
ok "S13_guardado_concurrente_rechazado" "$(COMO $ADM "select cz_guardar_cotizacion('$P2'::jsonb)" | grep -c 'CZ409')" 1
ok "S14_versiones_conservadas" "$(Q -c "select count(*) from cotizacion_versiones where cotizacion_id='$ID'")" 2
ok "S15_lineas_reemplazadas_sin_duplicar" "$(Q -c "select count(*) from cotizacion_items where cotizacion_id='$ID'")" 2
PR='{"nombre":"Impresora Smart Tank","marca":"HP","modelo":"580","especificaciones":[{"etiqueta":"Tipo","valor":"Tinta"}],"precio_origen":99999,"enlace":"https://x"}'
PID=$(COMO $USR "select cz_guardar_producto('$PR'::jsonb)")
ok "S16_producto_a_biblioteca" "$(Q -c "select count(*) from productos_catalogo where id='$PID' and estado='aprobado'")" 1
ok "S17_biblioteca_sin_datos_comerciales" "$(Q -c "select count(*) from productos_catalogo where row_to_json(productos_catalogo)::text ~ '99999|https://x'")" 0
ok "S18_archivar_solo_admin" "$(COMO $USR "select cz_archivar_producto('$PID')" | grep -c 'Solo un administrador')" 1
COMO $ADM "select cz_archivar_producto('$PID')" >/dev/null
ok "S19_admin_archiva_sin_borrar" "$(Q -c "select estado from productos_catalogo where id='$PID'")" archivado
H=$(printf 'a%.0s' {1..64})
COMO $USR "select cz_registrar_eett('$ID', 2, 'eett/$ID/v2.pdf', '$H', 3)" >/dev/null; COMO $USR "select cz_registrar_eett('$ID', 2, 'eett/$ID/v2b.pdf', '$H', 3)" >/dev/null
ok "S20_eett_anterior_reemplazado" "$(Q -c "select string_agg(estado, ',' order by fecha, ubicacion_pdf) from eett_documentos")" "reemplazado,generado"
ok "S21_depositos_privados" "$(Q -c "select string_agg(id||':'||public::text, ',' order by id) from storage.buckets")" "eett:false,productos:false"
ok "S22_cantidad_cero_rechazada" "$(COMO $USR "select cz_guardar_cotizacion('$(echo "$P" | sed 's/"cantidad":3/"cantidad":0/')'::jsonb)" | grep -c 'violates check')" 1
Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-deshacer.sql" >/dev/null 2>&1
ok "S23_deshacer_limpia_todo" "$(Q -c "select count(*) from pg_class where relname in ('cotizaciones','productos_catalogo','cotizacion_items','eett_documentos') union all select count(*) from pg_proc where proname like 'cz\_%'" | tr '\n' ',')" "0,0,"
ok "S24_deshacer_no_toca_existentes" "$(Q -c "select md5(string_agg(numero_oc, ',')) from public.ordenes_compra_v2")" "$ANTES"
echo; echo "$((24-F)) OK · $F fallas"; exit $F
