#!/bin/bash
# Inteligencia Comercial (04/11/2026): valida la migración BORRADOR-2026-11-04-inteligencia-comercial.sql en un
# PostgreSQL LOCAL y DESECHABLE (nunca en Supabase). Entorno mínimo como Supabase (roles, auth.uid(), perfiles,
# seguridad BFK) con el módulo Cotizaciones REAL (migraciones existentes v1, v2 y vendedor responsable, sin cambios) y
# tablas financieras de muestra para comprobar que nada fuera del módulo cambia.
# Comprueba: instalación atómica e idempotencia, RLS y permisos (anónimo, sin perfil, usuario, administrador),
# escritura solo por función y solo de códigos BFK presentados, reintentos/espera, conservación de lo verificado,
# historial, ausencia de duplicados, unidad de análisis, igualdad SQL = JavaScript (sql_vs_js.mjs), rendimiento con
# 5.000 oportunidades, integridad financiera (huellas idénticas) y reversión completa + reinstalación.
# Uso: bash docs/pruebas-inteligencia/validar_sql.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"; IC="$MIG/BORRADOR-2026-11-04-inteligencia-comercial.sql"; ICD="$MIG/BORRADOR-2026-11-04-inteligencia-comercial-deshacer.sql"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"
U=claude; PORT=55447
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || { cat "$D/log"; exit 1; }
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
export PGHOST="$D" PGPORT=$PORT
Q() { psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
F=0; N=0; ok() { N=$((N+1)); if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }
USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222; SINP=33333333-3333-3333-3333-333333333333
# Ejecuta SQL como la app (PostgREST): rol, uid y claims del JWT. Devuelve la última línea (o el error resumido).
COMO() { local uid=$1; shift; printf '%s\n' "set role ${ROL:-authenticated}; set prueba.uid = '$uid'; set request.jwt.claims = '{\"sub\":\"$uid\",\"role\":\"${ROL:-authenticated}\"}'; $*" \
  | psql -U postgres -d postgres -qAt 2>&1 | grep -Ev '^(SET|CONTEXT|PL/pgSQL|SQL (statement|function))' | tail -1; }
codigo_err() { sed -n 's/.*\(IC[0-9]\{3\}\|permission denied\|BFK_SIN_PERFIL\).*/\1/p' | head -1; }

# ── Entorno mínimo (como Supabase) ──
Q <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role' $$;
grant usage on schema auth to anon, authenticated; grant execute on all functions in schema auth to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text);
grant select on public.perfiles to authenticated;
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana Usuaria','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin Admin','admin');
-- Seguridad BFK (igual que BORRADOR-2026-10-23-seguridad-perfil-bfk.sql, instalada en producción el 27/10/2026)
create function public.bfk_es_usuario() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.perfiles p where p.id = auth.uid()) $$;
create function public.bfk_es_admin() returns boolean language sql stable security definer set search_path = '' as $$ select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin') $$;
grant execute on function public.bfk_es_usuario(), public.bfk_es_admin() to anon, authenticated;
-- Muestras de tablas FINANCIERAS y de OC (solo para comprobar que no cambian)
create table public.ordenes_compra_v2 (id text primary key, numero_oc text, vendedor_id text, capitalizacion_bfk boolean not null default false, monto_total numeric);
insert into public.ordenes_compra_v2 values ('oc_1','OC-FICT-1',null,false,119000), ('oc_2','OC-FICT-13',null,false,66640), ('oc_3','2600-77-SE26',null,false,50000);
create table public.vendedores (id text primary key, nombre text not null, comision_pct numeric default 0, activo boolean default true);
grant select on public.vendedores to authenticated;
create table public.eventos_compra (id text primary key, oc_id text, costo_compra numeric); insert into public.eventos_compra values ('e1','oc_1',80000),('e2','oc_2',40000);
create table public.eventos_factura (id text primary key, oc_id text, monto numeric, numero_factura text); insert into public.eventos_factura values ('f1','oc_1',119000,'101');
create table public.gastos_indirectos (id text primary key, monto numeric); insert into public.gastos_indirectos values ('g1',15000);
create table public.iva_mensual (id text primary key, anio int, mes int, iva_pagado numeric); insert into public.iva_mensual values ('i1',2026,10,12345);
create table public.pagos_vendedor (id text primary key, vendedor_id text, monto_pagado numeric); insert into public.pagos_vendedor values ('p1','v1',30000);
create table public.eventos_pago_financiamiento (id text primary key, oc_id text, monto numeric); insert into public.eventos_pago_financiamiento values ('pf1','oc_1',80000);
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon; grant select, insert on storage.objects to authenticated; grant usage on sequence storage.objects_id_seq to authenticated;
create function public.fin_es_importacion() returns boolean language sql stable as $$ select false $$;
SQL
for m in BORRADOR-2026-10-cotizaciones.sql BORRADOR-2026-10-cotizaciones-v2.sql BORRADOR-2026-10-21-vendedor-responsable.sql; do
  Q -1 -f "$MIG/$m" > "$D/m.log" 2>&1 || { echo "No se pudo instalar $m"; tail -5 "$D/m.log"; exit 1; }
done
ext() { awk -v f="$2" 'index($0,"create or replace function public." f "(")==1{p=1} p{print} p&&/\$\$;[[:space:]]*$/{exit}' "$1"; }
ext "$MIG/2026-10-20-clasificacion-tributaria.sql" trib_escritura_api > "$D/trib.sql"
Q -1 -f "$D/trib.sql" >/dev/null 2>&1 || { echo "No se pudo crear trib_escritura_api"; exit 1; }
node "$AQUI/semilla_sql.mjs" > "$D/semilla.sql" && Q -1 -f "$D/semilla.sql" >/dev/null || { echo "No se pudo cargar la semilla"; exit 1; }
# Una cotización REAL por la función de la app: borrador → presentada (la fecha de presentación sale de su versión).
P0='{"id_externo":"1001-19-COT26","nombre":"Por RPC","institucion":"Municipalidad de Laja","estado":"borrador","vendedor_id":"v1","subtotal_neto":10000,"impuestos":1900,"total":11900,"envios":[],"items":[{"cantidad":1,"unitario_venta_neto":10000,"ficha":{"nombre":"X"}}]}'
RID=$(COMO $USR "select (public.cz_guardar_cotizacion_v2('$P0'::jsonb))->>'id';")
P1=$(echo "$P0" | sed "s/\"estado\":\"borrador\"/\"estado\":\"presentada\",\"id\":\"$RID\",\"version\":1/")
ok "S00_cotizacion_por_rpc_presentada" "$(COMO $USR "select (public.cz_guardar_cotizacion_v2('$P1'::jsonb))->>'version';")" 2

HUELLA="select md5(string_agg(t || ':' || h, ',' order by t)) from (
  select 'cot' t, md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) h from public.cotizaciones c union all
  select 'items', md5(coalesce(string_agg(to_jsonb(i)::text, '|' order by i.id), '')) from public.cotizacion_items i union all
  select 'vers', md5(coalesce(string_agg(to_jsonb(v)::text, '|' order by v.cotizacion_id, v.version), '')) from public.cotizacion_versiones v union all
  select 'oc', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.ordenes_compra_v2 o union all
  select 'ec', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.eventos_compra o union all
  select 'ef', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.eventos_factura o union all
  select 'gi', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.gastos_indirectos o union all
  select 'iva', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.iva_mensual o union all
  select 'pv', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.pagos_vendedor o union all
  select 'pf', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.eventos_pago_financiamiento o union all
  select 'vend', md5(coalesce(string_agg(to_jsonb(o)::text, '|' order by o.id), '')) from public.vendedores o) z"
CATALOGO="select md5(string_agg(x, ',' order by x)) from (select 'f:' || p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' and p.proname !~ '^ic_'
  union all select 'p:' || schemaname || tablename || policyname || coalesce(qual, '') || coalesce(with_check, '') from pg_policies where tablename !~ '^ic_'
  union all select 'i:' || indexname || indexdef from pg_indexes where schemaname = 'public' and tablename !~ '^ic_'
  union all select 'g:' || table_name || grantee || privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name !~ '^ic_'
  union all select 't:' || tgname || tgrelid::regclass::text from pg_trigger where not tgisinternal and tgrelid::regclass::text !~ '^(public\.)?ic_') z"
H0=$(Q -c "$HUELLA"); K0=$(Q -c "$CATALOGO")

# ── Instalación ──
Q -1 -f "$IC" > "$D/i.log" 2>&1; ok "I01_instala_en_una_transaccion" "$?" 0; [ -s "$D/i.log" ] && grep -i error "$D/i.log" | head -3
ok "I02_segunda_instalacion_rechazada" "$(Q -1 -f "$IC" 2>&1 | grep -c 'IC: el módulo ya existe')" 1
ok "I03_objetos_creados" "$(Q -c "select count(*) from pg_class where relname in ('ic_resultados','ic_resultados_historial','ic_sincronizaciones','ic_oportunidades')")" 4
ok "I04_nada_fuera_del_modulo_cambio_al_instalar" "$(Q -c "$HUELLA")|$(Q -c "$CATALOGO")" "$H0|$K0"
ok "I05_vista_security_invoker" "$(Q -c "select coalesce((select option_value from pg_options_to_table((select reloptions from pg_class where relname='ic_oportunidades')) where option_name='security_invoker'),'')")" true

# ── Permisos y RLS ──
ok "P01_anonimo_no_lee_resultados" "$(ROL=anon COMO "" "select count(*) from public.ic_resultados;" | codigo_err)" "permission denied"
ok "P02_anonimo_no_lee_vista" "$(ROL=anon COMO "" "select count(*) from public.ic_oportunidades;" | codigo_err)" "permission denied"
ok "P03_anonimo_no_ejecuta_resumen" "$(ROL=anon COMO "" "select public.ic_resumen();" | codigo_err)" "permission denied"
ok "P17_anonimo_no_ejecuta_detalle" "$(ROL=anon COMO "" "select public.ic_detalle();" | codigo_err)" "permission denied"
ok "P18_sin_perfil_detalle_rechazado" "$(COMO $SINP "select public.ic_detalle();" | codigo_err)" IC403
ok "P19_usuario_lee_detalle" "$(COMO $USR "select (public.ic_detalle())->>'total' <> '0';")" t
ok "P04_sin_perfil_resumen_rechazado" "$(COMO $SINP "select public.ic_resumen();" | codigo_err)" IC403
ok "P05_sin_perfil_vista_vacia" "$(COMO $SINP "select count(*) from public.ic_oportunidades;")" 0
ok "P06_usuario_lee_vista" "$(COMO $USR "select count(*) > 0 from public.ic_oportunidades;")" t
ok "P07_usuario_no_registra_resultados" "$(COMO $USR "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"fuente\":\"x\"}');" | codigo_err)" IC403
ok "P08_usuario_no_lista_pendientes" "$(COMO $USR "select count(*) from public.ic_pendientes_sincronizar();" | codigo_err)" IC403
ok "P09_insercion_directa_rechazada_admin" "$(COMO $ADM "insert into public.ic_resultados (codigo, fuente) values ('1001-3-COT26','x');" | codigo_err)" "permission denied"
ok "P10_borrado_directo_rechazado" "$(COMO $ADM "delete from public.ic_resultados;" | codigo_err)" "permission denied"
ok "P11_usuario_no_registra_sincronizacion" "$(COMO $USR "select public.ic_registrar_sincronizacion('{}');" | codigo_err)" IC403
ok "P12_codigo_ajeno_rechazado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"9999-1-COT26\",\"fuente\":\"x\"}');" | codigo_err)" IC404
ok "P13_codigo_borrador_rechazado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-13-COT26\",\"fuente\":\"x\"}');" | codigo_err)" IC404
ok "P14_codigo_invalido_rechazado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1234-56-LE26\",\"fuente\":\"x\"}');" | codigo_err)" IC400
ok "P15_monto_negativo_rechazado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"monto_total\":-1,\"fuente\":\"x\"}');" | codigo_err)" IC400
ok "P16_estado_fuera_de_rango" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"resultado\":\"ganadisima\",\"fuente\":\"x\"}');" | codigo_err)" IC400

# ── Pendientes antes de sincronizar: solo Compra Ágil presentadas, sin duplicados ──
ok "S01_pendientes_iniciales" "$(COMO $ADM "select string_agg(codigo, ',' order by codigo) from public.ic_pendientes_sincronizar(100);")" "1001-1-COT26,1001-10-COT26,1001-11-COT26,1001-12-COT26,1001-14-COT26,1001-15-COT26,1001-17-COT26,1001-19-COT26,1001-2-COT26,1001-3-COT26,1001-4-COT26,1001-5-COT26,1001-6-COT26,1001-7-COT26,1001-8-COT26,1001-9-COT26"
ok "S02_limite_respetado" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(3);")" 3

# ── Resultados (parámetros armados por normalizarResultadoMP, igual que el servidor) ──
node "$AQUI/semilla_sql.mjs" --resultados > "$D/res.sql"
R=$(while IFS= read -r l; do COMO $ADM "$l"; done < "$D/res.sql" | grep -c '"consulta_estado": "ok"'); ok "S03_resultados_registrados" "$R" "$(wc -l < "$D/res.sql")"
ok "S04_resultados_por_tipo" "$(Q -c "select string_agg(resultado || '=' || n, ',' order by resultado) from (select resultado, count(*) n from public.ic_resultados group by 1) z")" "cancelada=1,desierta=1,ganada=2,pendiente=2,perdida=5,sin_informacion=2,sin_oferta_bfk=1"
ok "S05_historial_uno_por_codigo" "$(Q -c "select count(*) = (select count(*) from public.ic_resultados) from public.ic_resultados_historial")" t
ok "S06_finales_sin_proximo_intento" "$(Q -c "select count(*) from public.ic_resultados where resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') and proximo_intento is not null")" 0
ok "S07_pendientes_con_proximo_intento" "$(Q -c "select count(*) from public.ic_resultados where resultado in ('pendiente','sin_informacion') and proximo_intento is null")" 0
ok "S08_ganador_y_montos_de_1001_2" "$(Q -c "select adjudicatario_rut||'|'||adjudicatario_nombre||'|'||monto_neto||'|'||monto_impuesto||'|'||monto_total||'|'||base_tributaria||'|'||bfk_oferto from public.ic_resultados where codigo='1001-2-COT26'")" "76.111.111-1|Comercial Sur SpA|180000|34200|214200|afecta|true"
# Repetir el mismo resultado: sin cambios ni historial nuevo.
H1=$(Q -c "select count(*) from public.ic_resultados_historial"); L=$(grep '"1001-2-COT26"' "$D/res.sql")
ok "S09_repetir_no_cambia" "$(COMO $ADM "$L" | grep -o '"cambio": [a-z]*')" '"cambio": false'
ok "S10_repetir_sin_historial_nuevo" "$(Q -c "select count(*) from public.ic_resultados_historial")" "$H1"
# Consulta posterior SOLO con listado (detalle caído), mismo estado: conserva adjudicatario y montos verificados.
ok "S11_sin_detalle_conserva_lo_verificado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-2-COT26\",\"estado_proceso\":\"proveedor_seleccionado\",\"resultado\":\"sin_informacion\",\"detalle_consultado\":false,\"fuente\":\"API Compra Ágil v2 (ChileCompra) · listado\"}')->>'resultado';")|$(Q -c "select adjudicatario_nombre||'|'||monto_total||'|'||detalle_consultado from public.ic_resultados where codigo='1001-2-COT26'")" "perdida|Comercial Sur SpA|214200|true"
# Falla de la API: no borra lo verificado; intentos y espera crecen; límite → al menos 1 hora.
ok "S12_error_conserva_resultado" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"consulta_estado\":\"error\",\"consulta_error\":\"HTTP 504\",\"fuente\":\"x\"}')->>'resultado';")|$(Q -c "select resultado||'|'||consulta_estado||'|'||intentos from public.ic_resultados where codigo='1001-3-COT26'")" "pendiente|pendiente|error|1"
E1=$(Q -c "select extract(epoch from proximo_intento - now())::int from public.ic_resultados where codigo='1001-3-COT26'")
COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"consulta_estado\":\"error\",\"fuente\":\"x\"}');" >/dev/null
E2=$(Q -c "select extract(epoch from proximo_intento - now())::int from public.ic_resultados where codigo='1001-3-COT26'")
ok "S13_espera_creciente" "$([ "$E2" -gt "$E1" ] && echo si)" si
COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-4-COT26\",\"consulta_estado\":\"limite\",\"fuente\":\"x\"}');" >/dev/null
ok "S14_limite_espera_una_hora" "$(Q -c "select proximo_intento >= now() + interval '59 minutes' from public.ic_resultados where codigo='1001-4-COT26'")" t
ok "S15_exito_reinicia_intentos" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"estado_proceso\":\"publicada\",\"resultado\":\"pendiente\",\"fuente\":\"x\"}')->>'consulta_estado';")|$(Q -c "select intentos||'|'||consulta_estado from public.ic_resultados where codigo='1001-3-COT26'")" "ok|0|ok"
ok "S16_error_en_codigo_nuevo" "$(COMO $ADM "select public.ic_registrar_resultado('{\"codigo\":\"1001-17-COT26\",\"consulta_estado\":\"no_encontrada\",\"fuente\":\"x\"}')->>'resultado';")|$(Q -c "select estado_proceso||'|'||resultado from public.ic_resultados where codigo='1001-17-COT26'")" "sin_informacion|no_encontrada|sin_informacion"
ok "S17_pendientes_despues" "$(COMO $ADM "select string_agg(codigo, ',' order by codigo) from public.ic_pendientes_sincronizar(100);")" "1001-19-COT26"
ok "S18_forzar_incluye_finales" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100, true);")" 16
ok "S19_sincronizacion_registrada" "$(COMO $ADM "select public.ic_registrar_sincronizacion('{\"origen\":\"manual\",\"solicitados\":15,\"consultados\":15,\"actualizados\":15,\"errores\":1}') > 0;")" t
S20=$(printf '%s\n' "set role authenticated; set prueba.uid = '$ADM'; select public.ic_registrar_sincronizacion('{\"origen\":\"robot\"}');" | psql -U postgres -d postgres -qAt 2>&1)
ok "S20_origen_invalido_rechazado" "$(echo "$S20" | grep -c 'violates check constraint')" 1

# ── Unidad de análisis y reglas ──
ok "U01_una_oportunidad_por_codigo" "$(COMO $USR "select count(*) = count(distinct clave) from public.ic_oportunidades;")" t
ok "U02_total_oportunidades" "$(COMO $USR "select count(*) from public.ic_oportunidades;")" 18
ok "U03_duplicado_toma_adjudicada" "$(COMO $USR "select estado_cotizacion||'|'||n_cotizaciones||'|'||resultado from public.ic_oportunidades where codigo='1001-12-COT26';")" "adjudicada|2|ganada"
ok "U04_varios_productos_una_vez" "$(COMO $USR "select count(*)||'|'||max(oferta_neto) from public.ic_oportunidades where codigo='1001-15-COT26';")" "1|300000"
ok "U05_borrador_lista_descartada_excluidas" "$(COMO $USR "select count(*) from public.ic_oportunidades where codigo in ('1001-13-COT26','1001-16-COT26','1001-18-COT26');")" 0
ok "U06_por_verificar" "$(COMO $USR "select resultado||'|'||verificacion from public.ic_oportunidades where codigo='1001-8-COT26';")" "pendiente|por_verificar"
ok "U07_desierta_y_cancelada_no_son_perdidas" "$(COMO $USR "select string_agg(resultado, ',' order by codigo) from public.ic_oportunidades where codigo in ('1001-5-COT26','1001-6-COT26');")" "desierta,cancelada"
ok "U08_comparable_misma_base" "$(COMO $USR "select comparable||'|'||diferencia||'|'||diferencia_pct from public.ic_oportunidades where codigo='1001-2-COT26';")" "true|23800|11.1"
ok "U09_exenta_vs_afecta_no_comparable" "$(COMO $USR "select comparable||'|'||motivo_no_comparable from public.ic_oportunidades where codigo='1001-7-COT26';")" "false|Base tributaria distinta (afecta/exenta)"
ok "U10_sin_oferta_bfk" "$(COMO $USR "select resultado from public.ic_oportunidades where codigo='1001-11-COT26';")" sin_oferta_bfk
ok "U11_aviso_adjudicada_vs_externo" "$(COMO $USR "select resultado||'|'||(aviso is not null) from public.ic_oportunidades where codigo='1001-14-COT26';")" "ganada|true"
ok "U12_aviso_presentada_ganada" "$(COMO $USR "select resultado||'|'||(aviso like '%regularizar%') from public.ic_oportunidades where codigo='1001-10-COT26';")" "ganada|true"
ok "U13_sin_codigo_y_licitacion" "$(COMO $USR "select string_agg(verificacion, ',' order by verificacion) from public.ic_oportunidades where codigo is null or codigo='1234-56-LE26';")" "no_compra_agil,sin_codigo"
ok "U14_fecha_desde_version" "$(COMO $USR "select fecha_presentacion||'|'||fecha_presentacion_registrada from public.ic_oportunidades where codigo='1001-19-COT26';")" "$(TZ=America/Santiago date +%F)|true"
ok "U15_fecha_sin_version" "$(COMO $USR "select fecha_presentacion||'|'||fecha_presentacion_registrada from public.ic_oportunidades where codigo='1001-17-COT26';")" "2026-10-31|false"
ok "U16_tasa_octubre" "$(COMO $USR "select (public.ic_resumen('2026-10-01','2026-10-31'))->'indicadores'->>'tasa_exito';")" "42.9"
ok "U17_resultado_externo_no_toca_cotizacion" "$(Q -c "select estado from public.cotizaciones where id_externo='1001-10-COT26'")" presentada

# ── SQL = JavaScript (misma regla en la base y en la app) ──
node "$AQUI/sql_vs_js.mjs" $ADM > "$D/svj.log" 2>&1; R=$?; grep -E "^FALLA|Error|error" "$D/svj.log" | head -20; cp "$D/svj.log" /tmp/svj.log; ok "J01_sql_igual_a_javascript ($(tail -1 "$D/svj.log"))" "$R" 0

# ── Integridad: nada fuera del módulo cambió con toda la operación ──
ok "F01_financieros_y_cotizaciones_intactos" "$(Q -c "$HUELLA")" "$H0"
ok "F02_catalogo_fuera_del_modulo_intacto" "$(Q -c "$CATALOGO")" "$K0"

# ── Rendimiento: 5.000 oportunidades sintéticas ──
Q <<'SQL' >/dev/null
insert into public.cotizaciones (id, id_externo, nombre, institucion, fecha, estado, subtotal_neto, impuestos, total, vendedor_id, vendedor_nombre, actualizado_en, creado_por)
select gen_random_uuid(), '9' || g || '-1-COT26', 'Sintética ' || g, 'Institución ' || (g % 40), date '2026-10-01' + (g % 60), 'presentada', 1000 * (g % 97 + 1), 190 * (g % 97 + 1), 1190 * (g % 97 + 1),
  case when g % 2 = 0 then 'v1' else 'v2' end, case when g % 2 = 0 then 'Vendedor Uno' else 'Vendedora Dos' end, now(), '22222222-2222-2222-2222-222222222222'
from generate_series(1, 5000) g;
insert into public.cotizacion_versiones (cotizacion_id, version, contenido, guardado_por, guardado_en)
select id, 1, '{"estado":"presentada"}', '22222222-2222-2222-2222-222222222222', (fecha + time '12:00') at time zone 'America/Santiago' from public.cotizaciones where nombre like 'Sintética %';
insert into public.ic_resultados (codigo, estado_proceso, resultado, adjudicatario_rut, adjudicatario_nombre, monto_neto, monto_impuesto, monto_total, base_tributaria, fuente, detalle_consultado, verificado_en)
select upper(id_externo), 'proveedor_seleccionado', 'perdida', '76.' || (row_number() over () % 30) || '-1', 'Competidor ' || (row_number() over () % 30), subtotal_neto * 0.9, impuestos * 0.9, total * 0.9, 'afecta', 'prueba', true, now()
from public.cotizaciones where nombre like 'Sintética %' and id_externo ~ '^9[0-9]*[02468]-';
analyze;
SQL
T0=$(date +%s%N); COMO $USR "select public.ic_resumen('2026-10-01','2026-11-30');" >/dev/null; T1=$(date +%s%N); MS=$(( (T1 - T0) / 1000000 ))
ok "R01_resumen_5000_menos_de_2_segundos (${MS} ms)" "$([ $MS -lt 2000 ] && echo si)" si
T0=$(date +%s%N); COMO $USR "select count(*) from (select * from public.ic_oportunidades where fecha_presentacion between '2026-10-01' and '2026-10-31' order by fecha_presentacion desc limit 15 offset 0) z;" >/dev/null; T1=$(date +%s%N); MS=$(( (T1 - T0) / 1000000 ))
ok "R02_pagina_del_detalle_menos_de_2_segundos (${MS} ms)" "$([ $MS -lt 2000 ] && echo si)" si
Q -c "delete from public.ic_resultados_historial where codigo like '9%'; delete from public.ic_resultados where codigo like '9%'; delete from public.cotizacion_versiones where cotizacion_id in (select id from public.cotizaciones where nombre like 'Sintética %'); delete from public.cotizaciones where nombre like 'Sintética %';" >/dev/null

# ── Reversión y reinstalación ──
Q -1 -f "$ICD" > "$D/d.log" 2>&1; ok "D01_deshacer_en_una_transaccion" "$?" 0
ok "D02_sin_objetos_ic" "$(Q -c "select count(*) from pg_class where relname like 'ic\_%'")|$(Q -c "select count(*) from pg_proc where proname like 'ic\_%'")" "0|0"
ok "D03_todo_lo_demas_identico_tras_deshacer" "$(Q -c "$HUELLA")|$(Q -c "$CATALOGO")" "$H0|$K0"
ok "D04_deshacer_dos_veces_rechazado" "$(Q -1 -f "$ICD" 2>&1 | grep -c 'no está instalado')" 1
Q -1 -f "$IC" > "$D/i2.log" 2>&1; ok "D05_reinstalar" "$?" 0
ok "D06_modulo_reinstalado_vacio" "$(Q -c "select count(*) from public.ic_resultados")" 0

echo "validar_sql: $((N-F))/$N correctas"
[ $F -eq 0 ]
