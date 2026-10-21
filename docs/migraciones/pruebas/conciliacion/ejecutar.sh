#!/usr/bin/env bash
# Pruebas de DECISIONES DE CONCILIACIÓN — SOLO base desechable o copia restaurada. Cada caso en su PROPIA conexión y con
# ROLLBACK. Uso: DB_URL=postgresql://... bash ejecutar.sh
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../.."; DB="${DB_URL:?}"
T="${RUNNER_TEMP:-/tmp}/conc"; mkdir -p "$T"
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -At "$@" > "$T/out" 2> "$T/err"; }
huella() { run -f "$D/huella.sql" && tail -1 "$T/out"; }
obj() { run -c "select (select count(*) from pg_trigger where tgname='conciliacion_guardia')||'/'||(select count(*) from pg_proc where proname in ('conciliacion_decidir','conciliacion_anular','conciliacion_guardia_registro'))||'/'||(case when to_regclass('public.conciliacion_decisiones') is null then 0 else 1 end)" && cat "$T/out"; }
fallar() { echo "FALLA: $*"; head -3 "$T/err" 2>/dev/null | sed 's/^/FALLA|detalle|/'; exit 1; }
MIG="${MIGRACION:-$M/BORRADOR-2026-10-21-conciliacion-decisiones.sql}"; DES="${DESHACER:-$M/BORRADOR-2026-10-21-conciliacion-decisiones-deshacer.sql}"
USR="$(psql "$DB" -X -At -c "select id from public.perfiles where rol <> 'admin' order by id limit 1")"
[ -n "$USR" ] || fallar "falta un perfil de usuario"
[ "$(obj)" = "0/0/0" ] && echo "RESULT|base_sin_objetos|OK" || fallar "la base ya tiene los objetos ($(obj))"
H0="$(huella)"; echo "INFO|huella_inicial|${H0:0:12}"
run -f "$MIG" || fallar "instalación"
[ "$(obj)" = "5/3/1" ] && echo "RESULT|instalado_5_disparadores_3_funciones_tabla|OK" || fallar "objetos $(obj)"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_instalar|OK" || fallar "la instalación cambió datos"
run -f "$D/preparar.sql" || fallar "preparar"
H1="$(huella)"
: > "$T/res"
for f in "$D"/casos/*.sql; do psql "$DB" -X -At -v usr="$USR" -f "$f" 2>>"$T/err_casos" | grep '^CN|' >> "$T/res"; done
ESP="$(grep -ho "'CN|" "$D"/casos/*.sql | wc -l)"; OK="$(grep -c '|true$' "$T/res")"; MAL="$(grep -vc '|true$' "$T/res")"
cat "$T/res" | sed 's/^/PRUEBA|/'
[ "$OK" = "$ESP" ] && [ "$MAL" = 0 ] && echo "RESULT|${OK}_de_${ESP}_pruebas_en_sesiones_independientes|OK" || { grep -v '|true$' "$T/res" | sed 's/^/FALLA|/'; grep -i error "$T/err_casos" | head -5; fallar "pruebas $OK/$ESP"; }
[ "$(huella)" = "$H1" ] && [ "$(psql "$DB" -X -At -c 'select count(*) from public.conciliacion_decisiones')" = 0 ] && echo "RESULT|pruebas_sin_rastro_huella_identica|OK" || fallar "las pruebas dejaron rastro"
# Reversión: se detiene si hay decisiones guardadas; con descarte explícito, quita todo.
psql "$DB" -X -At -c "select set_config('request.jwt.claims', json_build_object('sub','$USR','role','authenticated')::text, false)" -c "set role authenticated" -c "select public.conciliacion_decidir('cart:20261014:250000:0:500000:1','vinculado','gastos_indirectos',array['cs_g1'])" > /dev/null 2>"$T/err" || fallar "decisión para probar la reversión"
psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "$DES" > "$T/out" 2> "$T/err"; grep -q REVERSION_DETENIDA "$T/err" && [ "$(obj)" = "5/3/1" ] && echo "RESULT|deshacer_se_detiene_si_hay_decisiones|OK" || fallar "deshacer no se detuvo"
PGOPTIONS="-c bfk.conc_descartar=si" psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "$DES" > "$T/out" 2> "$T/err" && [ "$(obj)" = "0/0/0" ] && echo "RESULT|deshacer_con_descarte_explicito|OK" || fallar "deshacer"
run -f "$D/limpiar.sql" || fallar "limpiar"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_al_final|OK" || fallar "huella final"
