#!/usr/bin/env bash
# Pruebas de VENDEDOR RESPONSABLE — SOLO en base desechable o copia restaurada. Cada caso en su PROPIA conexión.
# Uso: DB_URL=postgresql://... bash ejecutar.sh
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../.."; DB="${DB_URL:?}"
T="${RUNNER_TEMP:-/tmp}/vr"; mkdir -p "$T"
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -At "$@" > "$T/out" 2> "$T/err"; }
huella() { run -v pfx=h_ -f "$D/huella.sql" -c '\echo :h_huella' && tail -1 "$T/out"; }
obj() { run -c "select (select count(*) from pg_trigger where tgname='cz_vendedor_responsable')||'/'||(select count(*) from pg_proc where proname in ('cz_vendedor_catalogo','cz_trg_vendedor_responsable','cz_transferir_vendedor_a_oc'))||'/'||(case when to_regclass('public.cotizacion_vendedor_historial') is null then 0 else 1 end)" && cat "$T/out"; }
fallar() { echo "FALLA: $*"; head -3 "$T/err" 2>/dev/null | sed 's/^/FALLA|detalle|/'; exit 1; }
MIG="${MIGRACION:-$M/BORRADOR-2026-10-21-vendedor-responsable.sql}"; DES="${DESHACER:-$M/BORRADOR-2026-10-21-vendedor-responsable-deshacer.sql}"
USR="$(psql "$DB" -X -At -c "select id from public.perfiles where rol <> 'admin' order by id limit 1")"
ADM="$(psql "$DB" -X -At -c "select id from public.perfiles where rol = 'admin' order by id limit 1")"
V1="$(psql "$DB" -X -At -c "select id from public.vendedores where activo is not false and id::text not like 'vr\_%' order by id limit 1")"
[ -n "$USR" ] && [ -n "$ADM" ] && [ -n "$V1" ] || fallar "faltan perfiles o vendedores"
[ "$(obj)" = "0/0/0" ] && echo "RESULT|base_sin_objetos_de_vendedor|OK" || fallar "la base ya tiene los objetos ($(obj))"
H0="$(huella)"; echo "INFO|huella_inicial|${H0:0:12}"
run -f "$MIG" || fallar "instalación"
[ "$(obj)" = "1/3/1" ] && echo "RESULT|instalado_disparador_3_funciones_bitacora|OK" || fallar "objetos $(obj)"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_instalar|OK" || fallar "la instalación cambió datos o esquema existentes"
run -v adm="$ADM" -v v_oc2="$V1" -f "$D/preparar.sql" || fallar "preparar"
: > "$T/res"
for f in "$D"/casos/*.sql; do psql "$DB" -X -At -v usr="$USR" -v adm="$ADM" -v v1="$V1" -f "$f" 2>>"$T/err_casos" | grep '^VR|' >> "$T/res"; done
ESP="$(grep -ho "'VR|" "$D"/casos/*.sql | wc -l)"; OK="$(grep -c '|true$' "$T/res")"; MAL="$(grep -vc '|true$' "$T/res")"
tr '\n' ' ' < "$T/res" | cut -c1-3800 | sed 's/^/PRUEBAS|/'; echo
[ "$OK" = "$ESP" ] && [ "$MAL" = 0 ] && echo "RESULT|${OK}_de_${ESP}_pruebas_en_sesiones_independientes|OK" || { grep -v '|true$' "$T/res" | sed 's/^/FALLA|/'; fallar "pruebas $OK/$ESP"; }
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_excepto_datos_de_prueba|OK" || fallar "las pruebas cambiaron datos existentes"
psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "$DES" > "$T/out" 2> "$T/err"; grep -q REVERSION_DETENIDA "$T/err" && [ "$(obj)" = "1/3/1" ] && echo "RESULT|deshacer_se_detiene_si_hay_bitacora|OK" || fallar "deshacer no se detuvo"
run -f "$D/limpiar.sql" || fallar "limpiar"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_limpiar|OK" || fallar "huella tras limpiar"
psql "$DB" -X -v ON_ERROR_STOP=1 -At -c "set bfk.vend_descartar = 'si'" -f "$DES" > "$T/out" 2> "$T/err" || fallar "deshacer"
[ "$(obj)" = "0/0/0" ] && [ "$(huella)" = "$H0" ] && echo "RESULT|deshacer_sin_rastro|OK" || fallar "deshacer dejó rastro"
run -f "$MIG" && run -c "set bfk.vend_descartar = 'si'" -f "$DES" && [ "$(obj)" = "0/0/0" ] && echo "RESULT|reinstalar_y_deshacer|OK" || fallar "reinstalar"
echo "RESULT|vendedor_responsable|OK"
