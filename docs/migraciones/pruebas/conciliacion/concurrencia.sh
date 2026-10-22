#!/usr/bin/env bash
# DOS USUARIOS conciliando A LA VEZ — SOLO base desechable con la migración instalada y preparar.sql cargado.
# Sesión A toma el bloqueo y espera; sesión B intenta lo mismo en paralelo. Al final todo se revierte (decisiones de prueba anuladas y borradas).
# Uso: DB_URL=postgresql://... USR=<id perfil> bash concurrencia.sh
set -uo pipefail; set +x
DB="${DB_URL:?}"; U="${USR:?}"; T="${RUNNER_TEMP:-/tmp}/concur"; mkdir -p "$T"
D="$(cd "$(dirname "$0")" && pwd)"
ses() { printf "select set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false);\nset role authenticated;\n" "$U"; }
H0="$(psql "$DB" -X -At -f "$D/huella.sql" | tail -1)"
ok=0; mal=0; res() { if [ "$2" = true ]; then ok=$((ok+1)); echo "PRUEBA|$1|OK"; else mal=$((mal+1)); echo "FALLA|$1|$3"; fi; }

# 1. Mismo registro, dos movimientos distintos, al mismo tiempo: solo uno queda vinculado.
{ ses; echo "begin; select public.conciliacion_decidir('cart:20261015:0:124798:1000000:1','vinculado','eventos_pago_cliente',array['cs_c1']); select pg_sleep(2); commit;"; } > "$T/a.sql"
{ ses; echo "select pg_sleep(0.5); select public.conciliacion_decidir('cart:20261016:0:124798:2000000:1','vinculado','eventos_pago_cliente',array['cs_c1']);"; } > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!
psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
N="$(psql "$DB" -X -At -c "select count(*) from public.conciliacion_decisiones where registro_id='cs_c1' and decision='vinculado' and anulado_en is null")"
res "u1_mismo_registro_dos_movimientos_simultaneos_solo_uno" "$([ "$N" = 1 ] && grep -qiE 'vinculado a otro|conc_dec_registro_vinculado' "$T/b.err" && echo true || echo false)" "vinculos=$N $(head -1 "$T/b.err")"

# 2. Mismo movimiento, dos registros distintos (gastos iguales de $250.000), al mismo tiempo: un solo vínculo para el movimiento.
{ ses; echo "begin; select public.conciliacion_decidir('cart:20261014:250000:0:500000:1','vinculado','gastos_indirectos',array['cs_g1']); select pg_sleep(2); commit;"; } > "$T/a.sql"
{ ses; echo "select pg_sleep(0.5); select public.conciliacion_decidir('cart:20261014:250000:0:500000:1','vinculado','gastos_indirectos',array['cs_g2']);"; } > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!
psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
N="$(psql "$DB" -X -At -c "select count(*) from public.conciliacion_decisiones where marca='cart:20261014:250000:0:500000:1' and decision='vinculado' and anulado_en is null")"
res "u2_mismo_movimiento_dos_registros_simultaneos_un_vinculo" "$([ "$N" = 1 ] && [ -s "$T/b.err" ] && echo true || echo false)" "vinculos=$N $(head -1 "$T/b.err")"

# 3. Dos usuarios, dos operaciones legítimas distintas a la vez: ambas se guardan.
{ ses; echo "select public.conciliacion_decidir('cart:20261016:0:676001:3000000:1','vinculado','eventos_pago_cliente',array['cs_c5']);"; } > "$T/a.sql"
{ ses; echo "select public.conciliacion_decidir('cart:20261014:250000:0:250000:2','rechazado','gastos_indirectos',array['cs_g2']);"; } > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!
psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
res "u3_dos_decisiones_independientes_simultaneas_ambas_guardadas" "$([ ! -s "$T/a.err" ] && [ ! -s "$T/b.err" ] && echo true || echo false)" "$(head -1 "$T/a.err") $(head -1 "$T/b.err")"

# Huella financiera: las decisiones no tocan cobros, gastos, pagos ni OC.
H1="$(psql "$DB" -X -At -f "$D/huella.sql" | tail -1)"
res "u4_huella_financiera_identica_tras_decisiones_simultaneas" "$([ "$H1" = "$H0" ] && echo true || echo false)" "${H0:0:12}≠${H1:0:12}"
# Limpieza de la base desechable.
psql "$DB" -X -At -c "alter table public.conciliacion_decisiones disable trigger user" -c "delete from public.conciliacion_decisiones where registro_id like 'cs_%'" -c "alter table public.conciliacion_decisiones enable trigger user" > /dev/null 2>&1
echo "RESULT|concurrencia|$ok OK, $mal FALLA(S)"; [ "$mal" = 0 ]
