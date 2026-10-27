#!/usr/bin/env bash
# Pruebas del módulo PROYECTOS INDUSTRIALES — SOLO en base desechable (nunca producción).
# Uso: DB_URL=postgresql://superusuario@…/base  DB_OWNER_URL=postgresql://bfk_owner@…/base  bash ejecutar.sh
#   DB_URL       : conexión con permisos para preparar ayudantes de prueba y simular sesiones (set role).
#   DB_OWNER_URL : rol dueño SIN superusuario (como "postgres" en Supabase) con el que se instala la migración.
#   RESTAURO_URL : (opcional) base vacía para comprobar recuperación desde respaldo (pg_dump public+auth).
# La base debe tener la réplica BFK (schema-local.sql) + base_supabase.sql. Cada caso corre en su PROPIA sesión.
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../.."; DB="${DB_URL:?}"; OWN="${DB_OWNER_URL:?}"
T="${RUNNER_TEMP:-/tmp}/pi_proyectos"; mkdir -p "$T"
MIG="${MIGRACION:-$M/BORRADOR-2026-10-22-proyectos-industriales.sql}"; DES="${DESHACER:-$M/BORRADOR-2026-10-22-proyectos-industriales-deshacer.sql}"
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -At "$@" > "$T/out" 2> "$T/err"; }
huella() { run -v pfx=h_ -f "$D/huella.sql" -c '\echo :h_huella' && tail -1 "$T/out"; }
obj() { psql "$DB" -X -At -c "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','v') and (relname like 'pi\_%' or relname = 'bfk_lineas_negocio'))
  ||'/'||(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'pi\_%')
  ||'/'||(select count(*) from pg_policies where policyname like 'pi\_storage%')||'/'||(select count(*) from storage.buckets where id = 'pi-documentos')"; }
fallar() { echo "FALLA: $*"; head -5 "$T/err" 2>/dev/null | sed 's/^/FALLA|detalle|/'; exit 1; }
[ "$(obj)" = "0/0/0/0" ] && echo "RESULT|base_sin_modulo|OK" || fallar "la base ya tiene objetos del módulo ($(obj))"
H0="$(huella)"; echo "INFO|huella_inicial|${H0:0:12}"
psql "$OWN" -X -v ON_ERROR_STOP=1 -q -f "$MIG" > "$T/out" 2> "$T/err" || fallar "instalación con rol sin superusuario"
OBJ="$(obj)"; [ "$OBJ" = "15/32/3/1" ] && echo "RESULT|instalada_13_tablas_2_vistas_32_funciones_3_politicas_storage_1_deposito|OK" || fallar "objetos $OBJ"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_instalar|OK" || fallar "la instalación cambió datos, esquema o permisos existentes"
psql "$OWN" -X -v ON_ERROR_STOP=1 -q -f "$MIG" > "$T/out" 2> "$T/err"; grep -q "PI: el módulo" "$T/err" && [ "$(obj)" = "$OBJ" ] && echo "RESULT|segunda_instalacion_se_detiene_sin_cambios|OK" || fallar "reinstalación"
run -f "$D/preparar.sql" || fallar "preparar ayudantes"
: > "$T/res"; : > "$T/err_casos"; rm -f "$T/conc"
for f in "$D"/casos/*.sql; do (cd "$D" && psql "$DB" -X -At -f "$f" 2>>"$T/err_casos" | grep '^PI|' >> "$T/res"); done
DB_URL="$DB" bash "$D/concurrencia.sh" | tee -a "$T/conc" | grep '^PI|' >> "$T/res"; grep '^INFO' "$T/conc" | tail -1
psql "$DB" -X -At -f "$D/aislamiento_mp.sql" 2>>"$T/err_casos" | grep '^PI|' >> "$T/res"
ESP="$(( $(grep -ho "'PI|c[0-9]" "$D"/casos/*.sql "$D/aislamiento_mp.sql" | wc -l) + 2 ))"; OK="$(grep -c '|true$' "$T/res")"; MAL="$(grep -vc '|true$' "$T/res")"
cat "$T/res" | sed 's/^/PRUEBA|/'
[ -s "$T/err_casos" ] && sed 's/^/ERROR_SQL|/' "$T/err_casos" | head -10
[ "$OK" = "$ESP" ] && [ "$MAL" = 0 ] && echo "RESULT|${OK}_de_${ESP}_pruebas_en_sesiones_independientes|OK" || { grep -v '|true$' "$T/res" | sed 's/^/FALLA|/'; fallar "pruebas $OK/$ESP"; }
[ "$(huella)" = "$H0" ] && echo "RESULT|mercado_publico_intacto_tras_pruebas_huella_identica|OK" || fallar "las pruebas cambiaron datos existentes"
if [ -n "${RESTAURO_URL:-}" ]; then   # Recuperación desde respaldo: mismas opciones que el respaldo diario (public+auth, sin dueños ni permisos)
  firma() { psql "$1" -X -At -c "select string_agg(t || ':' || n, ',' order by t) from (
    select 'pi_proyectos' t, count(*)||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) n from public.pi_proyectos x union all
    select 'pi_actividades', count(*)||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.pi_actividades x union all
    select 'pi_documentos', count(*)||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.pi_documentos x union all
    select 'pi_historial', count(*)||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.pi_historial x union all
    select 'pi_equipo', count(*)||md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.pi_equipo x union all
    select 'pi_correlativos', count(*)||md5(coalesce(string_agg(x::text, ',' order by x.anio), '')) from public.pi_correlativos x) z"; }
  pg_dump "$DB" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$T/respaldo.dump" 2> "$T/err" || fallar "pg_dump"
  pg_restore --no-owner --no-privileges --dbname="$RESTAURO_URL" "$T/respaldo.dump" 2> "$T/restauro.log" || true
  F1="$(firma "$DB")"; F2="$(firma "$RESTAURO_URL")"
  [ -n "$F1" ] && [ "$F1" = "$F2" ] && echo "RESULT|proyectos_recuperados_desde_respaldo_identicos|OK" || { grep -i error "$T/restauro.log" | head -3 | sed 's/^/FALLA|detalle|/'; fallar "restauración distinta"; }
fi
psql "$OWN" -X -v ON_ERROR_STOP=1 -At -f "$DES" > "$T/out" 2> "$T/err"; grep -q REVERSION_DETENIDA "$T/err" && [ "$(obj)" = "$OBJ" ] && echo "RESULT|deshacer_se_detiene_si_hay_datos|OK" || fallar "deshacer no se detuvo con datos"
psql "$DB" -X -At -c "select set_config('storage.allow_delete_query', 'true', false)" -c "delete from storage.objects where bucket_id = 'pi-documentos'" > /dev/null   # (en Supabase: vaciar el depósito desde el panel)
run -f "$D/limpiar.sql" || fallar "limpiar"
psql "$OWN" -X -v ON_ERROR_STOP=1 -At -c "set bfk.pi_descartar = 'si'" -f "$DES" > "$T/out" 2> "$T/err" || fallar "deshacer"
[ "$(obj)" = "0/0/0/0" ] && [ "$(huella)" = "$H0" ] && echo "RESULT|deshacer_sin_rastro_huella_identica|OK" || fallar "deshacer dejó rastro ($(obj))"
psql "$OWN" -X -v ON_ERROR_STOP=1 -q -f "$MIG" > "$T/out" 2> "$T/err" && psql "$OWN" -X -v ON_ERROR_STOP=1 -q -f "$DES" > "$T/out" 2> "$T/err" && [ "$(obj)" = "0/0/0/0" ] && [ "$(huella)" = "$H0" ] \
  && echo "RESULT|reinstalar_y_deshacer_de_nuevo|OK" || fallar "reinstalar"
echo "RESULT|proyectos_industriales|OK"
