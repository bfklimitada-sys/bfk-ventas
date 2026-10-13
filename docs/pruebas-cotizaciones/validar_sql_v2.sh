#!/bin/bash
# Valida BORRADOR-2026-10-cotizaciones-v2.sql (y su deshacer) en un PostgreSQL LOCAL y desechable (nunca en Supabase).
# Instala primero el módulo v1 (tal como está en producción), guarda datos con v1, aplica la v2 y verifica.
# Uso: bash docs/pruebas-cotizaciones/validar_sql_v2.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"
U=claude; PORT=55433
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
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
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana Usuaria','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin Admin','admin');
create table public.ordenes_compra_v2 (id serial primary key, numero_oc text); insert into public.ordenes_compra_v2 (numero_oc) values ('OC-EXISTENTE');
-- Catálogo de vendedores de BFK (usado por comisiones): solo debe LEERSE.
create table public.vendedores (id text primary key, nombre text not null, comision_pct numeric default 0, activo boolean default true);
insert into public.vendedores values ('v1','José Muñoz',10,true);
grant select on public.vendedores to authenticated;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
insert into storage.buckets values ('documentos','documentos',false); insert into storage.objects (bucket_id, name) values ('documentos','contrato.pdf');
create policy docs_leer on storage.objects for select to authenticated using (bucket_id = 'documentos');
grant usage on schema storage to authenticated, anon; grant select, insert on storage.objects to authenticated; grant usage on sequence storage.objects_id_seq to authenticated;
SQL
F=0; ok() { if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
COMO() { local uid=$1; shift; Q -c "set role authenticated; set prueba.uid = '$uid'; $*" 2>&1 | grep -Ev '^(CONTEXT|PL/pgSQL|SQL (statement|function))' | head -1; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222; EXT=33333333-3333-3333-3333-333333333333
AJENOS() { Q -c "select md5((select string_agg(numero_oc, ',') from ordenes_compra_v2)||(select string_agg(id||nombre||comision_pct||activo, ',') from vendedores)||(select string_agg(bucket_id||name, ',' order by id) from storage.objects where bucket_id not like 'cz-%'))"; }
DEF_V1() { Q -c "select md5(pg_get_functiondef('public.cz_guardar_cotizacion(jsonb)'::regprocedure))"; }
POL() { Q -c "select string_agg(policyname||':'||coalesce(with_check, qual), ',' order by policyname) from pg_policies where schemaname='storage' and policyname like 'cz\_%'"; }

Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones.sql" >/dev/null 2>&1 || { echo "No se pudo instalar v1"; exit 1; }
AJ0=$(AJENOS); FV1=$(DEF_V1); POL1=$(POL)
# Datos guardados con la v1 (como en producción).
P='{"id_externo":"3390-246-COT26","nombre":"Congeladoras","institucion":"Ejército","recargo":0.3,"estado":"borrador",
 "envios":[{"key":"e1","proveedor":"Tienda","monto":"0","estado":"sin_costo_confirmado","destino":"Av. X 1, Arica","evidencia":"simulación"}],
 "items":[{"key":"i1","envio_key":"e1","enlace":"https://tienda.cl/a","proveedor":"Tienda","cantidad":2,"precio_origen":500000,"unitario_venta_neto":546219,"ficha":{"nombre":"Congeladora","imagenes":["img/abc.jpg"]}}]}'
ID=$(COMO $USR "select cz_guardar_cotizacion('$P'::jsonb)->>'id'")
Q -c "insert into storage.objects (bucket_id,name) values ('cz-eett','$ID/v1-historico.pdf'), ('cz-productos','img/abc.jpg')"
COMO $USR "select cz_registrar_eett('$ID', 1, 'cz-eett/$ID/v1-historico.pdf', null, 2)" >/dev/null
PID=$(COMO $USR "select cz_guardar_producto('{\"nombre\":\"Congeladora vertical\",\"imagenes\":[\"img/abc.jpg\"]}'::jsonb)")
DATOS_V1=$(Q -c "select md5(row(c.*)::text) from cotizaciones c where id='$ID'")

Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v2.sql" > "$D/apl.log" 2>&1; ok "V1_aplica_en_una_transaccion" $? 0
[ "$(tail -c 300 "$D/apl.log" | grep -c ERROR)" = "0" ] || cat "$D/apl.log"
ok "V2_reaplicar_se_rechaza" "$(Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v2.sql" 2>&1 | grep -c 'ya existe')" 1
ok "V3_datos_v1_conservados" "$(Q -c "select count(*) from cotizaciones where id='$ID' and version=1 and requerimientos='[]' and vendedor_nombre is null")" 1
P2=$(echo "$P" | sed "s/\"id_externo\"/\"id\":\"$ID\",\"version\":1,\"vendedor_id\":\"v1\",\"vendedor_nombre\":\"José Muñoz\",\"descripcion\":\"Necesidad\",\"unidad_compra\":\"Brigada\",\"region\":\"Arica y Parinacota\",\"presupuesto_estimado\":6000000,\"fecha_publicacion\":\"2026-10-10T09:30\",\"requerimientos\":[{\"nombre\":\"Congeladora vertical\",\"cantidad\":2,\"unidad\":\"EA\"}],\"documentos_mp\":[{\"id\":\"d1\",\"nombre\":\"bases.pdf\"}],\"id_externo\"/")
ok "V4_guarda_vendedor_y_compra_agil" "$(COMO $USR "select cz_guardar_cotizacion_v2('$P2'::jsonb)->>'version'")" 2
ok "V4b_campos_persistidos" "$(Q -c "select vendedor_nombre||'|'||unidad_compra||'|'||presupuesto_estimado||'|'||jsonb_array_length(requerimientos)||'|'||fecha_publicacion from cotizaciones where id='$ID'")" "José Muñoz|Brigada|6000000|1|2026-10-10 09:30:00"
P3=$(echo "$P" | sed "s/\"id_externo\"/\"id\":\"$ID\",\"version\":2,\"id_externo\"/")
ok "V5_cliente_v1_no_borra_campos_nuevos" "$(COMO $USR "select cz_guardar_cotizacion('$P3'::jsonb)->>'version'")|$(Q -c "select vendedor_nombre from cotizaciones where id='$ID'")" "3|José Muñoz"
ok "V6_concurrencia_sigue_rechazada" "$(COMO $ADM "select cz_guardar_cotizacion_v2('$P3'::jsonb)" | grep -c 'CZ409')" 1
# Adjudicada con OC vinculada.
PA=$(echo "$P" | sed "s/\"id_externo\"/\"id\":\"$ID\",\"version\":3,\"oc_codigo\":\"1-2-AG26\",\"id_externo\"/; s/\"estado\":\"borrador\"/\"estado\":\"adjudicada\"/")
COMO $USR "select cz_guardar_cotizacion_v2('$PA'::jsonb)" >/dev/null
PB=$(echo "$PA" | sed 's/"version":3/"version":4/; s/"cantidad":2/"cantidad":3/')
ok "V7_adjudicada_protege_lo_ofertado" "$(COMO $USR "select cz_guardar_cotizacion_v2('$PB'::jsonb)" | grep -c 'CZ423')" 1
PC=$(echo "$PA" | sed 's/"version":3/"version":4/; s#https://tienda.cl/a#https://tienda.cl/nuevo", "enlace_original":"https://tienda.cl/a#')
ok "V7b_adjudicada_permite_actualizar_enlace" "$(COMO $USR "select cz_guardar_cotizacion_v2('$PC'::jsonb)->>'version'")|$(Q -c "select enlace||' '||enlace_original from cotizacion_items where cotizacion_id='$ID'")" "5|https://tienda.cl/nuevo https://tienda.cl/a"
PD=$(echo "$PC" | sed 's/"version":4/"version":5/; s/1-2-AG26/9-9-AG26/')
ok "V8_oc_vinculada_solo_admin" "$(COMO $USR "select cz_guardar_cotizacion_v2('$PD'::jsonb)" | grep -c 'CZ423')" 1
PE=$(echo "$PC" | sed 's/"version":4/"version":5/; s/"estado":"adjudicada"/"estado":"borrador"/')
ok "V9_estado_adjudicada_solo_admin" "$(COMO $USR "select cz_guardar_cotizacion_v2('$PE'::jsonb)" | grep -c 'CZ423')" 1
H=$(printf 'b%.0s' {1..64})
COMO $USR "select cz_registrar_eett_v2('{\"cotizacion_id\":\"$ID\",\"version\":5,\"hash\":\"$H\",\"paginas\":3,\"nombre_documento\":\"EETT_3390-246-COT26_v5.pdf\"}'::jsonb)" >/dev/null
ok "V10_eett_solo_metadatos" "$(Q -c "select coalesce(ubicacion_pdf,'SIN-PDF')||'|'||generado_por_nombre||'|'||vendedor_nombre||'|'||nombre_documento||'|'||estado from eett_documentos where cotizacion_id='$ID' order by fecha desc limit 1")" "SIN-PDF|Ana Usuaria|José Muñoz|EETT_3390-246-COT26_v5.pdf|generado"
ok "V10b_eett_historico_conservado" "$(Q -c "select count(*) from eett_documentos where ubicacion_pdf like 'cz-eett/%' and estado='reemplazado'")" 1
ok "V11_eett_version_invalida" "$(COMO $USR "select cz_registrar_eett_v2('{\"cotizacion_id\":\"$ID\",\"version\":99}'::jsonb)" | grep -c 'inválida')" 1
ok "V12_registra_vendedor" "$(COMO $USR "select cz_registrar_vendedor('  María   Pérez ')->>'nombre'")" "María Pérez"
ok "V12b_duplicado_rechazado" "$(COMO $USR "select cz_registrar_vendedor('MARIA PEREZ')" | grep -c 'ya está registrado')" 1
ok "V12c_no_duplica_catalogo_bfk" "$(COMO $USR "select cz_registrar_vendedor('jose munoz')" | grep -c 'ya está registrado')" 1
ok "V12d_sin_perfil_no_registra" "$(COMO $EXT "select cz_registrar_vendedor('Otro Nombre')" | grep -c 'sin perfil')" 1
ok "V13_eliminar_solo_admin" "$(COMO $USR "select cz_eliminar_cotizacion('$ID','3390-246-COT26')" | grep -c 'administrador')" 1
ok "V13b_no_elimina_adjudicada" "$(COMO $ADM "select cz_eliminar_cotizacion('$ID','3390-246-COT26')" | grep -c 'adjudicada')" 1
ID2=$(COMO $USR "select cz_guardar_cotizacion_v2('$(echo "$P" | sed 's/3390-246-COT26/1-1-COT26/')'::jsonb)->>'id'")
COMO $USR "select cz_registrar_eett_v2('{\"cotizacion_id\":\"$ID2\",\"version\":1}'::jsonb)" >/dev/null
ok "V13c_confirmacion_incorrecta" "$(COMO $ADM "select cz_eliminar_cotizacion('$ID2','otra cosa')" | grep -c 'no coincide')" 1
R=$(COMO $ADM "select cz_eliminar_cotizacion('$ID2','congeladoras')")
ok "V13d_elimina_solo_lo_asociado" "$(Q -c "select (select count(*) from cotizaciones where id='$ID2')||'/'||(select count(*) from cotizacion_items where cotizacion_id='$ID2')||'/'||(select count(*) from cotizacion_versiones where cotizacion_id='$ID2')||'/'||(select count(*) from eett_documentos where cotizacion_id='$ID2')||'/'||(select count(*) from cotizaciones)")" "0/0/0/0/1"
ok "V13e_auditoria_quien_cuando" "$(Q -c "select count(*) from cotizacion_eliminaciones where cotizacion_id='$ID2' and eliminado_por='$ADM' and eliminado_por_nombre='Kevin Admin' and eliminado_en is not null")" 1
ok "V13f_biblioteca_e_imagenes_intactas" "$(Q -c "select (select count(*) from productos_catalogo where id='$PID' and estado='aprobado')||'/'||(select count(*) from storage.objects where bucket_id like 'cz-%')")" "1/2"
ok "V13g_borrado_directo_sigue_bloqueado" "$(COMO $ADM "delete from cotizaciones" | grep -c 'permission denied')" 1
ok "V14_sube_imagenes" "$(COMO $USR "insert into storage.objects (bucket_id,name) values ('cz-productos','img/nueva.jpg') returning 1")" 1
ok "V14b_no_sube_pdf_eett" "$(COMO $USR "insert into storage.objects (bucket_id,name) values ('cz-eett','x.pdf')" | grep -c 'row-level security')" 1
ok "V15_pdf_historicos_legibles" "$(COMO $USR "select count(*) from storage.objects where bucket_id='cz-eett'")" 1
ok "V16_sin_perfil_no_lee_vendedores" "$(COMO $EXT "select count(*) from cotizacion_vendedores")" 0
ok "V16b_auditoria_solo_admin" "$(COMO $USR "select count(*) from cotizacion_eliminaciones")|$(COMO $ADM "select count(*) from cotizacion_eliminaciones")" "0|1"
ok "V16c_anonimo_sin_acceso" "$(Q -c "set role anon; select count(*) from cotizacion_vendedores" 2>&1 | grep -c 'permission denied')" 1
ok "V17_ajenos_intactos_tras_v2" "$(AJENOS)" "$AJ0"
Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v2-deshacer.sql" > "$D/des.log" 2>&1; ok "V18_deshacer_aplica" $? 0
ok "V18b_deshacer_restaura_funcion_v1" "$(DEF_V1)" "$FV1"
ok "V18c_deshacer_restaura_politicas" "$(POL)" "$POL1"
ok "V18d_deshacer_quita_objetos_v2" "$(Q -c "select (select count(*) from information_schema.columns where table_name in ('cotizaciones','cotizacion_items','eett_documentos') and column_name in ('vendedor_nombre','requerimientos','enlace_original','nombre_documento'))||'/'||(select count(*) from pg_proc where proname in ('cz_guardar_cotizacion_v2','cz_registrar_eett_v2','cz_registrar_vendedor','cz_eliminar_cotizacion','cz_clave_nombre'))||'/'||(select count(*) from pg_class where relname in ('cotizacion_vendedores','cotizacion_eliminaciones'))")" "0/0/0"
ok "V18e_deshacer_conserva_cotizaciones_v1" "$(Q -c "select count(*) from cotizaciones where id='$ID'")|$(Q -c "select count(*) from cotizacion_versiones where cotizacion_id='$ID'")" "1|5"
ok "V18f_ajenos_intactos_tras_deshacer" "$(AJENOS)" "$AJ0"
ok "V18g_reaplicar_v2_tras_deshacer" "$(Q -1 -f "$MIG/BORRADOR-2026-10-cotizaciones-v2.sql" >/dev/null 2>&1; echo $?)" 0
N=$(grep -c "^ok \"" "$0"); echo; echo "$((N-F)) OK · $F fallas"; exit $F
