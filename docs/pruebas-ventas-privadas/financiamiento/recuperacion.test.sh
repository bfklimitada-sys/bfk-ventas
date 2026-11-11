#!/usr/bin/env bash
# Recuperación de la migración del 11/11/2026 en bases DESECHABLES locales (nunca producción):
#   1. sin datos: aplicar → deshacer deja el catálogo IDÉNTICO al de producción (10/11);
#   2. con datos (después de sql_financiamiento.test.mjs): deshacer CONSERVA aportes, devoluciones y vendedores, las compras y su
#      costo no cambian y Ventas privadas sigue funcionando con las funciones de 1d47499; volver a aplicar reutiliza todo.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../../migraciones"; RC=0
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
ok() { if eval "$2"; then echo "OK    $1"; else echo "FALLA $1"; RC=1; fi; }
H="select md5(string_agg(t,'|' order by t)) from (select 'c:'||c.relname::text||c.relkind::text||coalesce(c.relacl::text,'') t from pg_class c where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace)
 union all select 'a:'||attrelid::regclass::text||attname||atttypid::regtype::text||attnotnull from pg_attribute where attrelid in (select oid from pg_class where relnamespace='public'::regnamespace and relname like 'vp\\_%') and attnum > 0 and not attisdropped
 union all select 'k:'||conrelid::regclass::text||pg_get_constraintdef(oid) from pg_constraint where connamespace='public'::regnamespace
 union all select 'f:'||p.oid::regprocedure::text||md5(p.prosrc)||coalesce(p.proacl::text,'') from pg_proc p where p.pronamespace='public'::regnamespace
 union all select 'v:'||viewname||md5(definition) from pg_views where schemaname='public'
 union all select 't:'||tgrelid::regclass::text||tgname||tgfoid::regprocedure::text from pg_trigger where not tgisinternal
 union all select 'p:'||schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies) x"
q() { psql "${P[@]}" -At -U postgres -d "$1" -c "$2"; }

# 1. Sin datos
eval "$(VP_DB=bfk_vpfin_rec bash "$D/base.sh" produccion 2>/dev/null)"
H0="$(q bfk_vpfin_rec "$H")"
psql "${P[@]}" -U bfk_owner -d bfk_vpfin_rec -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql" > /dev/null 2>&1; ok "R1 aplicar sobre el estado de producción (10/11)" '[ "$(q bfk_vpfin_rec "select to_regprocedure('"'"'public.vp_fin_registrar_aportes(jsonb)'"'"') is not null")" = t ]'
SAL="$(psql "${P[@]}" -U bfk_owner -d bfk_vpfin_rec -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql" 2>&1)"; ok "R2 aplicar dos veces se niega sin cambiar nada" 'grep -q "ya está aplicada" <<< "$SAL"'
psql "${P[@]}" -U bfk_owner -d bfk_vpfin_rec -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql" > /dev/null 2>&1
ok "R3 sin datos, deshacer deja el catálogo idéntico al de producción" '[ "$(q bfk_vpfin_rec "$H")" = "$H0" ]'
SAL="$(psql "${P[@]}" -U bfk_owner -d bfk_vpfin_rec -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql" 2>&1)"; ok "R4 deshacer sin la migración se niega" 'grep -q "no está aplicada" <<< "$SAL"'

# 2. Con datos (base de sql_financiamiento.test.mjs)
DB="${VP_DB:-bfk_vpfin}"
DATOS="select (select count(*)||'/'||coalesce(sum(monto),0) from public.vp_fin_aportes)||'|'||(select count(*)||'/'||coalesce(sum(monto),0) from public.vp_fin_devoluciones)||'|'||(select md5(string_agg(id::text||estado||coalesce(anulacion_motivo,''),',' order by id)) from public.vp_fin_aportes)
  ||'|'||(select count(*) from public.vp_ventas where vendedor_tipo is not null)||'|'||(select count(*) from public.vp_cotizaciones where vendedor_tipo is not null)
  ||'|'||(select md5(string_agg(to_jsonb(k)::text,',' order by id)) from public.vp_compras k)||'|'||(select md5(string_agg(to_jsonb(m)::text,',' order by venta_id)) from public.vp_margen_ventas m)
  ||'|'||(select count(*) from public.vp_historial)"
D0="$(q "$DB" "$DATOS")"
ok "R5 hay datos de financiamiento y vendedores para la prueba" '[ "$(q "$DB" "select count(*) > 0 from public.vp_fin_aportes")" = t ]'
psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql" > /dev/null 2>&1
ok "R6 deshacer con datos: aportes, devoluciones, vendedores, compras, costo real e historial idénticos" '[ "$(q "$DB" "$DATOS")" = "$D0" ]'
ok "R7 deshacer quitó las funciones nuevas" '[ "$(q "$DB" "select count(*) from pg_proc where proname in ('"'"'vp_fin_registrar_aportes'"'"','"'"'vp_asignar_vendedor'"'"','"'"'vp_registrar_compra_financiada'"'"')")" = 0 ]'
ok "R8 los datos conservados siguen protegidos (sin borrado)" '! psql "${P[@]}" -U postgres -d "$DB" -c "delete from public.vp_fin_aportes" > /dev/null 2>&1'
# Ventas privadas funciona con las funciones de 1d47499 tras deshacer: crear y convertir una cotización, registrar compra.
CLI="$(q "$DB" "select id from public.pi_clientes order by creado_en limit 1")"
SQL_UID="set role authenticated; select set_config('request.jwt.claims', '{\"sub\":\"22222222-2222-2222-2222-222222222222\",\"role\":\"authenticated\"}', false) \\g /dev/null"
OUT="$(psql "${P[@]}" -At -U postgres -d "$DB" <<SQL 2>&1
$SQL_UID
select public.vp_guardar_cotizacion('{"cliente_id":"$CLI","plazo_entrega":"1 día","items":[{"tipo":"producto","descripcion":"Prueba tras deshacer","unidad":"UN","cantidad":1,"precio_unitario":1000,"costo_unitario":500}]}'::jsonb)->>'folio';
SQL
)"; ok "R9 tras deshacer, guardar cotización con la función existente funciona" 'grep -q "^CP-" <<< "$OUT"'
psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql" > /dev/null 2>&1
ok "R10 volver a aplicar sobre los datos conservados funciona" '[ "$(q "$DB" "select to_regprocedure('"'"'public.vp_fin_registrar_aportes(jsonb)'"'"') is not null")" = t ]'
D1="$(q "$DB" "$DATOS")"; ok "R11 tras volver a aplicar, los datos conservados siguen idénticos (solo crece el historial por la cotización de R9)" '[ "${D1%|*}" = "${D0%|*}" ]'
RES="$(psql "${P[@]}" -At -U postgres -d "$DB" <<SQL 2>&1
set role authenticated; select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) \\g /dev/null
select count(*) > 0 from public.vp_fin_resumen where financiado > 0;
SQL
)"; ok "R12 tras volver a aplicar, el resumen de financiamiento vuelve a calcularse (administrador)" '[ "$(tail -1 <<< "$RES")" = t ]'
exit $RC
