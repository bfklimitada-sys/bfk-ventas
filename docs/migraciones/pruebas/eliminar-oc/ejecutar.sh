#!/usr/bin/env bash
# Pruebas de ELIMINACIÓN DE OC — SOLO base desechable. Cada caso en su propia conexión y con ROLLBACK.
# Requiere: la base con el esquema de BFK y la migración de conciliación. Uso: DB_URL=postgresql://... bash ejecutar.sh
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../.."; DB="${DB_URL:?}"; T="${RUNNER_TEMP:-/tmp}/oce"; mkdir -p "$T"
fallar() { echo "FALLA: $*"; head -3 "$T/err" 2>/dev/null | sed 's/^/FALLA|detalle|/'; exit 1; }
huella() { psql "$DB" -X -At -f "$M/pruebas/conciliacion/huella.sql" 2>/dev/null | tail -1; }
obj() { psql "$DB" -X -At -c "select (case when to_regclass('public.oc_eliminaciones') is null then 0 else 1 end)||'/'||(select count(*) from pg_proc where proname in ('oc_eliminacion_revisar','oc_eliminar_definitivamente','oc_eliminacion_restaurar','oce_firma_ajena'))"; }
ADM="$(psql "$DB" -X -At -c "select id from public.perfiles where rol = 'admin' order by id limit 1")"; [ -n "$ADM" ] || fallar "falta un perfil admin"
[ "$(obj)" = "0/0" ] && echo "RESULT|base_sin_objetos|OK" || fallar "la base ya tiene los objetos ($(obj))"
H0="$(huella)"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "${MIGRACION:-$M/BORRADOR-2026-10-23-eliminar-oc.sql}" > "$T/out" 2> "$T/err" || fallar "instalación"
[ "$(obj)" = "1/4" ] && echo "RESULT|instalado|OK" || fallar "objetos $(obj)"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_instalar|OK" || fallar "la instalación cambió datos"
sed "s/11111111-1111-1111-1111-111111111111/$ADM/g" "$D/preparar.sql" > "$T/preparar.sql"; (cd "$D" && psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$T/preparar.sql") > "$T/out" 2> "$T/err" || fallar "preparar"
H1="$(huella)"; : > "$T/res"; : > "$T/err_casos"
for f in "$D"/casos/*.sql; do (cd "$D/casos" && psql "$DB" -X -At -v usr="$ADM" -v adm="$ADM" -f "$f" 2>>"$T/err_casos" | grep '^OE|' >> "$T/res"); done
ESP="$(grep -ho "'OE|" "$D"/casos/*.sql | wc -l)"; OK="$(grep -c '|true$' "$T/res")"; MAL="$(grep -vc '|true$' "$T/res")"
sed 's/^/PRUEBA|/' "$T/res"
[ "$OK" -ge "$ESP" ] && [ "$MAL" = 0 ] && echo "RESULT|${OK}_pruebas_en_sesiones_independientes|OK" || { grep -v '|true$' "$T/res" | sed 's/^/FALLA|/'; grep -i error "$T/err_casos" | head -5; fallar "pruebas $OK/$ESP"; }
[ "$(huella)" = "$H1" ] && [ "$(psql "$DB" -X -At -c 'select count(*) from public.oc_eliminaciones')" = 0 ] && echo "RESULT|pruebas_sin_rastro|OK" || fallar "las pruebas dejaron rastro"
# ── Dos sesiones a la vez (con COMMIT real; se deshace al final restaurando desde la auditoría) ──
ses() { printf "select set_config('request.jwt.claims', json_build_object('sub','%s','role','authenticated')::text, false) as _j \\\\gset\nset role authenticated;\n" "$ADM"; }
{ ses; echo "begin; select public.oc_eliminar_definitivamente('oe_B','OE-1-AG26-B','Duplicada (sesión A)','oe_A'); select pg_sleep(2); commit;"; } > "$T/a.sql"
{ ses; echo "select pg_sleep(0.5); select public.oc_eliminar_definitivamente('oe_B','OE-1-AG26-B','Duplicada (sesión B)','oe_A');"; } > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!; psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
N="$(psql "$DB" -X -At -c "select count(*) from public.oc_eliminaciones where oc_id='oe_B'")"
[ "$N" = 1 ] && grep -q "no existe" "$T/b.err" && echo "RESULT|dos_sesiones_eliminan_a_la_vez_solo_una_vez|OK" || fallar "concurrencia eliminar ($N) $(head -1 "$T/b.err")"
EID="$(psql "$DB" -X -At -c "select id from public.oc_eliminaciones where oc_id='oe_B'")"
{ ses; echo "select public.oc_eliminacion_restaurar('$EID','OE-1-AG26-B');"; } | psql "$DB" -X -At > /dev/null 2> "$T/err" || fallar "restaurar tras concurrencia"
# Eliminar mientras otra sesión registra un cobro en la misma OC: la segunda espera y no deja un cobro huérfano.
{ ses; echo "begin; select public.oc_eliminar_definitivamente('oe_C','OE-3-AG26','Creada por error'); select pg_sleep(2); commit;"; } > "$T/a.sql"
echo "select pg_sleep(0.5); insert into public.eventos_pago_cliente (id, oc_id, fecha, monto, medio_pago) values ('oe_cC', 'oe_C', '2026-10-20', 1000, 'transferencia');" > "$T/b.sql"
psql "$DB" -X -At -f "$T/a.sql" > "$T/a.out" 2> "$T/a.err" & PA=$!; psql "$DB" -X -At -f "$T/b.sql" > "$T/b.out" 2> "$T/b.err" & PB=$!; wait $PA $PB
[ "$(psql "$DB" -X -At -c "select count(*) from public.eventos_pago_cliente where oc_id='oe_C' or id='oe_cC'")" = 0 ] && grep -qi "foreign key\|llave foránea" "$T/b.err" && echo "RESULT|cobro_simultaneo_no_queda_huerfano|OK" || fallar "cobro simultáneo $(head -1 "$T/b.err")"
EID="$(psql "$DB" -X -At -c "select id from public.oc_eliminaciones where oc_id='oe_C'")"
{ ses; echo "select public.oc_eliminacion_restaurar('$EID','OE-3-AG26');"; } | psql "$DB" -X -At > /dev/null 2> "$T/err" || fallar "restaurar C"
[ "$(huella)" = "$H1" ] && echo "RESULT|tras_eliminar_y_restaurar_huella_identica|OK" || fallar "huella tras restaurar"
# Reversión de la instalación: se detiene con eliminaciones registradas; con descarte explícito quita todo.
psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "${DESHACER:-$M/BORRADOR-2026-10-23-eliminar-oc-deshacer.sql}" > "$T/out" 2> "$T/err"; grep -q REVERSION_DETENIDA "$T/err" && [ "$(obj)" = "1/4" ] && echo "RESULT|deshacer_se_detiene_si_hay_eliminaciones|OK" || fallar "deshacer no se detuvo"
PGOPTIONS="-c bfk.oce_descartar=si" psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "${DESHACER:-$M/BORRADOR-2026-10-23-eliminar-oc-deshacer.sql}" > "$T/out" 2> "$T/err" && [ "$(obj)" = "0/0" ] && echo "RESULT|deshacer_con_descarte_explicito|OK" || fallar "deshacer"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$D/limpiar.sql" > "$T/out" 2> "$T/err" || fallar "limpiar"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_al_final|OK" || fallar "huella final"
