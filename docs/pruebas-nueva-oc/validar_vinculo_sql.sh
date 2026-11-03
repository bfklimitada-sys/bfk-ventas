#!/bin/bash
# «Nueva OC» (03/11/2026): valida el VÍNCULO de una cotización con la función REAL cz_guardar_cotizacion_v2 y sus
# disparadores (protección de adjudicadas, vendedor responsable, columnas tributarias y guardas de exentas) en un
# PostgreSQL LOCAL y DESECHABLE (nunca en Supabase). No se instala ni se cambia ninguna migración: se usan los archivos
# existentes tal como están. El parámetro lo arma el mismo código de la app (payload_vinculo.mjs → payloadVinculo).
# Comprueba que, al vincular, la cotización, sus líneas (identificador, cantidades, precios, costos, unitarios de venta,
# fichas) y sus despachos quedan IDÉNTICOS; solo cambian estado → adjudicada, oc_codigo y la versión.
# Uso: bash docs/pruebas-nueva-oc/validar_vinculo_sql.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"
PGBIN=/usr/lib/postgresql/16/bin; D=$(mktemp -d); chmod 777 "$D"
U=claude; PORT=55436
runuser -u $U -- $PGBIN/initdb -D "$D/db" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null || exit 1
runuser -u $U -- $PGBIN/pg_ctl -D "$D/db" -o "-p $PORT -k $D" -l "$D/log" start -w >/dev/null || { cat "$D/log"; exit 1; }
trap 'runuser -u '$U' -- '$PGBIN'/pg_ctl -D "'$D'/db" stop -m fast >/dev/null; rm -rf "'$D'"' EXIT
Q() { psql -h "$D" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
F=0; N=0; ok() { N=$((N+1)); if [ "$2" = "$3" ]; then echo "OK    $1"; else echo "FALLA $1 :: esperado [$3] obtenido [$2]"; F=$((F+1)); fi; }

# ── Entorno mínimo (como Supabase): roles, auth.uid(), perfiles, vendedores, OC y Storage ──
Q <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('prueba.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
create table public.perfiles (id uuid primary key, nombre text, rol text);
grant select on public.perfiles to authenticated;
insert into public.perfiles values ('11111111-1111-1111-1111-111111111111','Ana Usuaria','usuario'), ('22222222-2222-2222-2222-222222222222','Kevin Admin','admin');
create table public.ordenes_compra_v2 (id text primary key, numero_oc text, vendedor_id text, capitalizacion_bfk boolean not null default false);
insert into public.ordenes_compra_v2 values ('oc_n1','2600-77-SE26',null,false), ('oc_n2','OTRA-1-SE26',null,false);
create table public.vendedores (id text primary key, nombre text not null, comision_pct numeric default 0, activo boolean default true);
insert into public.vendedores values ('v1','Vendedor Uno',10,true);
grant select on public.vendedores to authenticated;
create schema storage; create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id serial primary key, bucket_id text, name text); alter table storage.objects enable row level security;
grant usage on schema storage to authenticated, anon; grant select, insert on storage.objects to authenticated; grant usage on sequence storage.objects_id_seq to authenticated;
create function public.fin_es_importacion() returns boolean language sql stable as $$ select false $$;
SQL
for m in BORRADOR-2026-10-cotizaciones.sql BORRADOR-2026-10-cotizaciones-v2.sql BORRADOR-2026-10-21-vendedor-responsable.sql; do
  Q -1 -f "$MIG/$m" > "$D/m.log" 2>&1 || { echo "No se pudo instalar $m"; tail -5 "$D/m.log"; exit 1; }
done
# Columnas y disparadores tributarios de cotizaciones, copiados de las migraciones existentes (sin cambios).
ext() { awk -v f="$2" 'index($0,"create or replace function public." f "(")==1{p=1} p{print} p&&/\$\$;[[:space:]]*$/{exit}' "$1"; }
{
  echo "alter table public.cotizaciones add column tratamiento_iva text, add column fundamento_iva text, add column respaldo_iva text, add column tratamiento_aprobado_por uuid, add column tratamiento_aprobado_en timestamptz, add column clasificacion_id uuid;"
  ext "$MIG/2026-10-20-clasificacion-tributaria.sql" trib_escritura_api
  ext "$MIG/2026-10-20-clasificacion-tributaria.sql" trib_proteger_columnas
  echo "create trigger trib_proteger_cotizacion before insert or update on public.cotizaciones for each row execute function public.trib_proteger_columnas();"
  ext "$MIG/BORRADOR-2026-10-20-fase3-guardas-exentas.sql" trib3_cotizacion_exenta
  echo "create trigger trib_v_cotizacion_exenta before insert or update on public.cotizaciones for each row execute function public.trib3_cotizacion_exenta();"
} > "$D/trib.sql"
Q -1 -f "$D/trib.sql" > "$D/t.log" 2>&1 || { echo "No se pudieron crear las guardas tributarias"; tail -5 "$D/t.log"; exit 1; }
ok "E00_disparadores_activos" "$(Q -c "select count(*) from pg_trigger where tgrelid='public.cotizaciones'::regclass and not tgisinternal")" 3

USR=11111111-1111-1111-1111-111111111111; ADM=22222222-2222-2222-2222-222222222222
# Llamada como la app (PostgREST): rol authenticated y claims del JWT presentes.
RPC() { local uid=$1 p=$2; printf '%s\n' "set role authenticated; set prueba.uid = '$uid'; set request.jwt.claims = '{\"sub\":\"$uid\",\"role\":\"authenticated\"}'; select cz_guardar_cotizacion_v2(:'p'::jsonb);" \
  | psql -h "$D" -p $PORT -U postgres -d postgres -qAt -v p="$p" 2>&1 | grep -Ev '^(SET|CONTEXT|PL/pgSQL|SQL (statement|function))' | head -1; }
NUEVA() { RPC $USR "$1" | sed -n 's/.*"id": *"\([^"]*\)".*/\1/p'; }
ITEMS='[{"key":"i1","envio_key":"e1","enlace":"https://tienda.cl/monitor","enlace_original":"https://tienda.cl/monitor-v1","proveedor":"Tienda","disponibilidad":"Stock","fecha_consulta":"2026-10-01T12:00:00Z","origen_datos":"manual","cantidad":2,"precio_origen":450000.5,"precio_incluye_iva":true,"con_factura":true,"iva_compra":143698,"envio_asignado":8790,"costo_bruto":908791,"costo_neto":763690,"recargo":0.25,"unitario_venta_neto":477307,"ficha":{"nombre":"Monitor 24","marca":"LG","modelo":"24MK430","imagenes":["img/abc.jpg"],"especificaciones":[{"etiqueta":"Tamaño","valor":"24\""}]},"ficha_aprobada":true},
 {"key":"i2","envio_key":"e1","enlace":"https://tienda.cl/teclado","proveedor":"Tienda","cantidad":4,"precio_origen":90000,"precio_incluye_iva":false,"con_factura":true,"iva_compra":68400,"envio_asignado":3200,"costo_bruto":431600,"costo_neto":363200,"unitario_venta_neto":118560,"ficha":{"nombre":"Teclado","marca":"Logitech","modelo":"K270"},"ficha_aprobada":false}]'
ENVIOS='[{"key":"e1","proveedor":"Tienda","origen_publicacion":"web","destino":"Balmaceda 292, Laja","monto":11990,"con_factura":true,"cobertura":"Laja","fecha_cotizacion":"2026-10-01","estado":"confirmado","evidencia":"Simulación de compra"}]'
FORM='{"confirmada":true,"base":"neto","redondeo":"arriba","prorrateo":"valor"}'
cab() { echo "{\"id_externo\":\"$1\",\"nombre\":\"Monitores $1\",\"institucion\":\"Municipalidad de Laja\",\"rut\":\"69.170.300-K\",\"direccion_entrega\":\"Balmaceda 292\",\"comuna\":\"Laja\",\"plazo\":\"10 días\",\"estado\":\"$2\",\"recargo\":0.3,$3\"subtotal_neto\":2382468,\"impuestos\":452668.92,\"total\":2835136.92,\"costo_neto\":1126890,\"iva_credito\":212088.5,\"vendedor_id\":\"v1\",\"envios\":$ENVIOS,\"items\":$ITEMS"; }
QA=$(NUEVA "$(cab 5602-1-COT26 presentada "\"formula\":$FORM,")}")
QB=$(NUEVA "$(cab 5602-2-COT26 adjudicada "\"formula\":$FORM,")}")
QF=$(NUEVA "$(cab 5602-6-COT26 presentada "")}")
QD=$(NUEVA "$(cab 5602-4-COT26 adjudicada "\"formula\":$FORM,\"oc_codigo\":\"OTRA-1-SE26\",")}")
# Exenta: clasificación aprobada (solo las funciones trib_* la escriben) y precios con fórmula exenta, IVA de venta $0.
QC=$(NUEVA "$(cab 5602-3-COT26 borrador "\"formula\":$FORM,")}")
Q -c "begin; select set_config('bfk.trib_rpc','1',true); update cotizaciones set tratamiento_iva='exenta_fora', fundamento_iva='Art. ficticio (PRUEBA)', respaldo_iva='Oficio ficticio', tratamiento_aprobado_por='$ADM', tratamiento_aprobado_en=now(), clasificacion_id='00000000-0000-4000-8000-0000000000e1' where id='$QC'; commit;" >/dev/null
VC=$(Q -c "select version from cotizaciones where id='$QC'")
IDS=$(Q -c "select string_agg(id::text, ',' order by orden) from cotizacion_items where cotizacion_id='$QC'"); I1=${IDS%,*}; I2=${IDS#*,}
PEX="$(cab 5602-3-COT26 adjudicada "\"id\":\"$QC\",\"version\":$VC,\"formula\":{\"confirmada\":true,\"base\":\"neto\",\"redondeo\":\"arriba\",\"prorrateo\":\"valor\",\"exenta\":true,\"base_exenta\":\"costo_bruto\"},")}"
PEX=$(echo "$PEX" | sed "s/\"impuestos\":452668.92/\"impuestos\":0/; s/\"key\":\"i1\"/\"key\":\"$I1\"/; s/\"key\":\"i2\"/\"key\":\"$I2\"/")
ok "E01_semilla_exenta_adjudicada" "$(RPC $USR "$PEX" | grep -c '"version"')" 1
# Histórica: presentada SIN vendedor (escrita antes de la regla, sin pasar por la app).
QE=$(Q -c "insert into cotizaciones (nombre, estado, creado_por) values ('Histórica sin vendedor','presentada','$ADM') returning id" | head -1)
[ -n "$QA" ] && [ -n "$QB" ] && [ -n "$QC" ] && [ -n "$QD" ] && [ -n "$QF" ] && [ -n "$QE" ] || { echo "No se pudieron crear las cotizaciones de prueba"; exit 1; }

# Foto de una cotización: cabecera (sin estado, oc_codigo, versión ni fechas de actualización), líneas completas y despachos.
foto() { Q -c "select jsonb_build_object('cab', to_jsonb(c) - 'estado' - 'oc_codigo' - 'version' - 'actualizado_en' - 'actualizado_por',
  'its', (select jsonb_agg(to_jsonb(i) order by orden) from cotizacion_items i where cotizacion_id=c.id),
  'env', (select jsonb_agg(to_jsonb(e) - 'id' order by clave) from cotizacion_envios e where cotizacion_id=c.id)) from cotizaciones c where id='$1'"; }
filas() { Q -c "select json_build_object('c',(select row_to_json(c) from cotizaciones c where id='$1'),'items',(select coalesce(json_agg(i order by orden),'[]') from cotizacion_items i where cotizacion_id='$1'),'envios',(select coalesce(json_agg(e),'[]') from cotizacion_envios e where cotizacion_id='$1'),'numero','$2')"; }
payload() { filas "$1" "$2" | node "$AQUI/payload_vinculo.mjs"; }
iguales() { printf '%s\n' "select (:'a')::jsonb = (:'b')::jsonb;" | psql -h "$D" -p $PORT -U postgres -d postgres -qAt -v a="$1" -v b="$2"; }
NV() { Q -c "select count(*) from cotizacion_versiones where cotizacion_id='$1'"; }
NH() { Q -c "select count(*) from cotizacion_vendedor_historial where cotizacion_id='$1'"; }

vincular() {   # $1 caso, $2 id, $3 número OC, $4 usuario
  local antes v0 n0 h0 r; antes=$(foto "$2"); v0=$(Q -c "select version from cotizaciones where id='$2'"); n0=$(NV "$2"); h0=$(NH "$2")
  r=$(RPC "$4" "$(payload "$2" "$3")")
  ok "${1}_rpc_acepta" "$(echo "$r" | grep -c '"version"')" 1
  ok "${1}_estado_y_oc" "$(Q -c "select estado||'|'||oc_codigo||'|'||(version-$v0) from cotizaciones where id='$2'")" "adjudicada|$3|1"
  ok "${1}_cotizacion_lineas_y_despachos_identicos" "$(iguales "$antes" "$(foto "$2")")" "t"
  ok "${1}_version_registrada_y_sin_cambio_de_vendedor" "$(( $(NV "$2") - n0 ))|$(( $(NH "$2") - h0 ))" "1|0"
}
vincular VA "$QA" 2600-77-SE26 $USR     # presentada con vendedor → adjudicada y vinculada
vincular VB "$QB" 2600-78-SE26 $USR     # adjudicada sin OC → vinculada
vincular VC "$QC" 2600-79-SE26 $USR     # exenta aprobada (fórmula exenta, IVA $0): las guardas la aceptan sin cambios
vincular VF "$QF" 2600-80-SE26 $USR     # sin fórmula guardada: sigue sin fórmula
ok "VF_formula_sigue_vacia" "$(Q -c "select formula is null from cotizaciones where id='$QF'")" "t"
ok "VA_unitarios_y_costos_exactos" "$(Q -c "select string_agg(unitario_venta_neto||'/'||precio_origen||'/'||coalesce(recargo::text,'-')||'/'||costo_bruto, ' ' order by orden) from cotizacion_items where cotizacion_id='$QA'")" "477307/450000.5/0.25/908791 118560/90000/-/431600"
ok "VA_totales_exactos" "$(Q -c "select subtotal_neto||'|'||impuestos||'|'||total||'|'||iva_credito from cotizaciones where id='$QA'")" "2382468|452668.92|2835136.92|212088.5"
ok "VC_clasificacion_exenta_intacta" "$(Q -c "select tratamiento_iva||'|'||(formula->>'exenta')||'|'||impuestos from cotizaciones where id='$QC'")" "exenta_fora|true|0"

# Rechazos de la base (además de los de la app):
D0=$(foto "$QD"); r=$(RPC $USR "$(payload "$QD" 2600-77-SE26)")
ok "R01_vinculada_a_otra_oc_solo_admin" "$(echo "$r" | grep -c 'CZ423')|$(iguales "$D0" "$(foto "$QD")")|$(Q -c "select oc_codigo from cotizaciones where id='$QD'")" "1|t|OTRA-1-SE26"
r=$(RPC $USR "$(payload "$QE" 2600-81-SE26)")
ok "R02_sin_vendedor_no_se_adjudica" "$(echo "$r" | grep -c 'CZ_VENDEDOR')|$(Q -c "select estado||'|'||coalesce(oc_codigo,'-') from cotizaciones where id='$QE'")" "1|presentada|-"
P=$(payload "$QB" 2600-78-SE26); P=$(echo "$P" | sed 's/"version":\([0-9]*\)/"version":1/')
ok "R03_version_antigua_rechazada" "$(RPC $USR "$P" | grep -c 'CZ409')" 1
P=$(payload "$QB" 2600-78-SE26 | sed 's/"cantidad":2/"cantidad":3/')
ok "R04_adjudicada_no_acepta_otros_precios_o_cantidades" "$(RPC $USR "$P" | grep -c 'CZ423')" 1
B0=$(foto "$QB"); r=$(RPC $USR "$(payload "$QB" 2600-78-SE26)")
ok "R05_reintento_identico_no_cambia_lo_ofertado" "$(echo "$r" | grep -c '"version"')|$(iguales "$(foto "$QB")" "$B0")" "1|t"
ok "R06_ninguna_oc_modificada" "$(Q -c "select string_agg(id||':'||coalesce(vendedor_id,'-'), ',' order by id) from ordenes_compra_v2")" "oc_n1:-,oc_n2:-"

echo; echo "RESUMEN vínculo SQL (función real, base desechable): $((N-F)) OK, $F FALLA(S)"
exit $F
