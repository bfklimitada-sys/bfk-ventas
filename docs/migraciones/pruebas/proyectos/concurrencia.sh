#!/usr/bin/env bash
# Código único bajo concurrencia: N sesiones independientes crean proyectos AL MISMO TIEMPO (barrera con pg_sleep
# hasta un instante común). Verifica: sin errores, sin códigos repetidos, correlativo sin huecos.
set -uo pipefail
DB="${DB_URL:?}"; N="${N:-40}"; T="${TMPDIR:-/tmp}/pi_conc"; rm -rf "$T"; mkdir -p "$T"
CLI="$(psql "$DB" -X -At -c "select id from public.pi_clientes where razon_social = 'Minera Prueba SpA'")"
ANTES="$(psql "$DB" -X -At -c "select count(*) from public.pi_proyectos")"
INICIO="$(psql "$DB" -X -At -c "select extract(epoch from clock_timestamp()) + 2")"
for i in $(seq 1 "$N"); do
  U=$([ $((i % 2)) = 0 ] && echo 33333333-3333-3333-3333-333333333333 || echo 44444444-4444-4444-4444-444444444444)
  psql "$DB" -X -At -v ON_ERROR_STOP=1 > "$T/$i.out" 2> "$T/$i.err" <<SQL &
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '$U', 'role', 'authenticated')::text, false);
select pg_sleep(greatest(0, $INICIO - extract(epoch from clock_timestamp())));
select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Concurrencia $i', 'tipo', 'otro', 'cliente_id', '$CLI', 'responsable_id', '$U'))->>'codigo';
SQL
done
wait
ERR="$(cat "$T"/*.err | grep -c . || true)"
COD="$(grep -h '^PI-' "$T"/*.out | sort)"; NC="$(printf '%s\n' "$COD" | grep -c . )"; NU="$(printf '%s\n' "$COD" | sort -u | grep -c .)"
DESPUES="$(psql "$DB" -X -At -c "select count(*) from public.pi_proyectos")"
SEC="$(psql "$DB" -X -At -c "select bool_and(n = r) from (select right(codigo, 3)::int as n, row_number() over (order by codigo) as r from public.pi_proyectos) x")"
echo "INFO|concurrencia|sesiones=$N errores=$ERR codigos=$NC unicos=$NU proyectos=$ANTES→$DESPUES"
[ "$ERR" = 0 ] && [ "$NC" = "$N" ] && [ "$NU" = "$N" ] && [ "$DESPUES" = $((ANTES + N)) ] && echo "PI|c11_${N}_creaciones_simultaneas_sin_codigos_repetidos|true" || echo "PI|c11_${N}_creaciones_simultaneas_sin_codigos_repetidos|false"
[ "$SEC" = "t" ] && echo "PI|c11_correlativo_consecutivo_sin_huecos|true" || echo "PI|c11_correlativo_consecutivo_sin_huecos|false"
