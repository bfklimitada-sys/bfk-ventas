#!/usr/bin/env bash
# DOS LOTES A LA VEZ (conciliación masiva, 23/10/2026) — SOLO base desechable con la migración y preparar.sql cargados.
# Cada sesión confirma varios vínculos seguidos (como el botón «Confirmar lote»); los lotes se cruzan en un registro y en
# un movimiento. Ningún registro ni movimiento puede quedar vinculado dos veces; lo que choca falla sin escribir.
# Uso: DB_URL=postgresql://... USR=<id perfil> bash concurrencia_lote.sh
set -uo pipefail; set +x
DB="${DB_URL:?}"; U="${USR:?}"; T="${RUNNER_TEMP:-/tmp}/concur_lote"; mkdir -p "$T"
D="$(cd "$(dirname "$0")" && pwd)"
H0="$(psql "$DB" -X -At -f "$D/huella.sql" | tail -1)"
ses() { printf "select set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false) as _j \\\\gset\nset role authenticated;\n\\\\set ON_ERROR_STOP off\n" "$U"; }
dec() { echo "select public.conciliacion_decidir('$1','vinculado','$2',array[$3]); select pg_sleep(0.2);"; }
# Lote A: cobro c1, gasto g1 (250.000) y cobro c5. Lote B (a la vez): cobro c1 desde OTRO movimiento, gasto g2 en el MISMO
# movimiento que A usó para g1, y cobro c5 en el MISMO movimiento que A.
{ ses; dec 'cart:20261015:0:124798:1000000:1' eventos_pago_cliente "'cs_c1'"; dec 'cart:20261014:250000:0:500000:1' gastos_indirectos "'cs_g1'"; dec 'cart:20261016:0:676001:3000000:1' eventos_pago_cliente "'cs_c5'"; } > "$T/a.sql"
{ ses; echo "select pg_sleep(0.1);"; dec 'cart:20261016:0:124798:2000000:1' eventos_pago_cliente "'cs_c1'"; dec 'cart:20261014:250000:0:500000:1' gastos_indirectos "'cs_g2'"; dec 'cart:20261016:0:676001:3000000:1' eventos_pago_cliente "'cs_c5'"; } > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!; psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
ok=0; mal=0; res() { if [ "$2" = true ]; then ok=$((ok+1)); echo "PRUEBA|$1|OK"; else mal=$((mal+1)); echo "FALLA|$1|$3"; fi; }
R="$(psql "$DB" -X -At -c "select (select count(*) from (select registro_id from public.conciliacion_decisiones where decision='vinculado' and anulado_en is null and registro_id like 'cs\_%' group by tabla, registro_id having count(distinct marca) > 1) x)||'/'||(select count(*) from (select marca from public.conciliacion_decisiones where decision='vinculado' and anulado_en is null and registro_id like 'cs\_%' group by marca having count(distinct tabla||registro_id) > 1 and bool_or(tabla='gastos_indirectos')) y)||'/'||(select count(*) from public.conciliacion_decisiones where decision='vinculado' and anulado_en is null and registro_id like 'cs\_%')")"
res "l1_ningun_registro_en_dos_movimientos_ni_movimiento_con_dos_gastos" "$([ "${R%%/*}" = 0 ] && [ "$(echo "$R" | cut -d/ -f2)" = 0 ] && echo true || echo false)" "$R"
res "l2_exactamente_tres_vinculos_uno_por_cruce" "$([ "${R##*/}" = 3 ] && echo true || echo false)" "$R"
NE="$(cat "$T/a.err" "$T/b.err" | grep -c 'ERROR')"
res "l3_los_tres_choques_fallan_sin_escribir" "$([ "$NE" = 3 ] && echo true || echo false)" "errores=$NE"
res "l4_huella_financiera_identica" "$([ "$(psql "$DB" -X -At -f "$D/huella.sql" | tail -1)" = "$H0" ] && echo true || echo false)"
psql "$DB" -X -At -c "alter table public.conciliacion_decisiones disable trigger user" -c "delete from public.conciliacion_decisiones where registro_id like 'cs_%'" -c "alter table public.conciliacion_decisiones enable trigger user" > /dev/null 2>&1
echo "RESULT|concurrencia_lote|$ok OK, $mal FALLA(S)"; [ "$mal" = 0 ]
