#!/usr/bin/env bash
# Pruebas de CONTACTOS INSTITUCIONALES — SOLO en base desechable o copia restaurada (nunca producción).
# Uso: DB_URL=postgresql://... bash ejecutar.sh      (requiere 2 perfiles no admin en la base)
# Cada caso corre en su PROPIA conexión psql (sesión independiente) con el rol ya fijado.
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../.."; DB="${DB_URL:?}"
T="${RUNNER_TEMP:-/tmp}/ci_contactos"; mkdir -p "$T"
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -At "$@" > "$T/out" 2> "$T/err"; }
huella() { run -v pfx=h_ -f "$D/huella.sql" -c '\echo :h_huella' && tail -1 "$T/out"; }
fn_ent() { run -c "select md5(pg_get_functiondef('public.registrar_entidad_desde_oc(text,text,text,text,text)'::regprocedure))" && cat "$T/out"; }
obj() { run -c "select (select count(*) from pg_tables where schemaname='public' and tablename like 'contactos\_institucionales%')||'/'||(select count(*) from pg_proc where pronamespace='public'::regnamespace and (proname like 'ci\_%' or proname in ('conciliar_contactos_oc','guardar_contacto_institucional','resolver_contacto_pendiente','marcar_contacto_obsoleto')))" && cat "$T/out"; }
ocs_prueba() { run -c "select md5(string_agg(id||contacto||correo_cliente||rut_cliente, ',' order by id)) from public.ordenes_compra_v2 where id like 'ci\_t\_%'" && cat "$T/out"; }
fallar() { echo "FALLA: $*"; head -3 "$T/err" 2>/dev/null | sed 's/^/FALLA|detalle|/'; exit 1; }
MIG="${MIGRACION:-$M/BORRADOR-2026-10-21-contactos-institucionales.sql}"; DES="${DESHACER:-$M/BORRADOR-2026-10-21-contactos-institucionales-deshacer.sql}"
U1="$(psql "$DB" -X -At -c "select id from public.perfiles where rol <> 'admin' order by id limit 1")"
U2="$(psql "$DB" -X -At -c "select id from public.perfiles where id::text <> '$U1' order by (rol <> 'admin') desc, id limit 1")"
[ -n "$U1" ] && [ -n "$U2" ] || fallar "se necesitan 2 perfiles (uno no admin)"
[ "$(obj)" = "0/0" ] && echo "RESULT|base_sin_contactos_institucionales|OK" || fallar "la base ya tiene los objetos ($(obj))"
H0="$(huella)"; E0="$(fn_ent)"; echo "INFO|huella_inicial|${H0:0:12}"
run -f "$MIG" || fallar "instalación"
[ "$(obj)" = "3/13" ] && echo "RESULT|instalada_3_tablas_13_funciones|OK" || fallar "objetos $(obj)"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_instalar|OK" || fallar "la instalación cambió datos o esquema existentes"
if [ -n "${CARGA_INICIAL:-}" ]; then
  run -f "$CARGA_INICIAL" || fallar "carga inicial"; grep '^CARGA|' "$T/out" | sed 's/^/INFO|/' 
  [ "$(huella)" = "$H0" ] && echo "RESULT|carga_inicial_no_toca_nada_existente|OK" || fallar "la carga inicial cambió datos existentes"
  run -f "$CARGA_INICIAL" && grep -q '^CARGA|nuevos_en_esta_pasada|0$' "$T/out" && echo "RESULT|carga_inicial_repetida_no_duplica|OK" || fallar "carga inicial repetida"
fi
run -f "$D/preparar.sql" || fallar "preparar datos de prueba"
O0="$(ocs_prueba)"
: > "$T/res"
for f in "$D"/casos/*.sql; do psql "$DB" -X -At -v usr="$U1" -v usr2="$U2" -f "$f" 2>>"$T/err_casos" | grep '^CI|' >> "$T/res"; done
ESP="$(grep -ho "select 'CI|" "$D"/casos/*.sql | wc -l)"; OK="$(grep -c '|true$' "$T/res")"; MAL="$(grep -vc '|true$' "$T/res")"
tr '\n' ' ' < "$T/res" | cut -c1-3800 | sed 's/^/PRUEBAS|/'; echo
[ "$OK" = "$ESP" ] && [ "$MAL" = 0 ] && echo "RESULT|${OK}_de_${ESP}_pruebas_en_sesiones_independientes|OK" || { grep -v '|true$' "$T/res" | sed 's/^/FALLA|/'; fallar "pruebas $OK/$ESP"; }
[ "$(ocs_prueba)" = "$O0" ] && echo "RESULT|contactos_historicos_de_las_oc_intactos|OK" || fallar "se modificó el contacto de una OC"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_pruebas_excepto_datos_de_prueba|OK" || fallar "las pruebas cambiaron datos existentes"
if [ -n "${RESTAURO_URL:-}" ]; then   # 10. Recuperación desde respaldo: mismas opciones que el respaldo diario (public+auth, sin dueños ni permisos)
  firma() { psql "$1" -X -At -c "select (select count(*)||':'||md5(coalesce(string_agg((to_jsonb(c)-'correo_clave')::text, ',' order by c.id), '')) from public.contactos_institucionales c)
    ||'|'||(select count(*)||':'||md5(coalesce(string_agg(v::text, ',' order by v.contacto_id, v.oc_id), '')) from public.contactos_institucionales_oc v)
    ||'|'||(select count(*)||':'||md5(coalesce(string_agg(h::text, ',' order by h.id), '')) from public.contactos_institucionales_historial h)
    ||'|'||(select count(*) from pg_trigger where tgrelid::regclass::text like '%contactos_institucionales%' and not tgisinternal)
    ||'|'||(select count(*) from pg_indexes where tablename like 'contactos_institucionales%')
    ||'|'||(select count(*) from pg_policies where tablename like 'contactos_institucionales%')"; }
  pg_dump "$DB" --format=custom --no-owner --no-privileges --schema=public --schema=auth --file="$T/respaldo.dump" 2> "$T/err" || fallar "pg_dump"
  for e in public auth; do psql "$RESTAURO_URL" -X -q -c "create schema if not exists $e;" >/dev/null 2>&1; done
  pg_restore --no-owner --no-privileges --schema=public --schema=auth --dbname="$RESTAURO_URL" "$T/respaldo.dump" 2> "$T/restauro.log" || true
  F1="$(firma "$DB")"; F2="$(firma "$RESTAURO_URL")"; echo "INFO|firma_contactos|${F1:0:60}"
  [ -n "$F1" ] && [ "$F1" = "$F2" ] && echo "RESULT|contactos_recuperados_desde_respaldo_identicos|OK" || { grep -i error "$T/restauro.log" | grep -i contacto | head -3 | sed 's/^/FALLA|detalle|/'; fallar "restauración distinta ($F2)"; }
fi
psql "$DB" -X -v ON_ERROR_STOP=1 -At -f "$DES" > "$T/out" 2> "$T/err"; grep -q REVERSION_DETENIDA "$T/err" && [ "$(obj)" = "3/13" ] && echo "RESULT|deshacer_se_detiene_si_hay_datos|OK" || fallar "deshacer no se detuvo con datos"
run -f "$D/limpiar.sql" || fallar "limpiar"
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_identica_tras_limpiar|OK" || fallar "huella tras limpiar"
psql "$DB" -X -v ON_ERROR_STOP=1 -At -c "set bfk.ci_descartar = 'si'" -f "$DES" > "$T/out" 2> "$T/err" || fallar "deshacer"
[ "$(obj)" = "0/0" ] && [ "$(huella)" = "$H0" ] && [ "$(fn_ent)" = "$E0" ] && echo "RESULT|deshacer_sin_rastro_y_funcion_del_catalogo_restaurada|OK" || fallar "deshacer dejó rastro ($(obj))"
run -f "$MIG" && run -c "set bfk.ci_descartar = 'si'" -f "$DES" && [ "$(obj)" = "0/0" ] && echo "RESULT|reinstalar_y_deshacer_de_nuevo|OK" || fallar "reinstalar"
echo "RESULT|contactos_institucionales|OK"
