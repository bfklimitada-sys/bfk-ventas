#!/usr/bin/env bash
# Ensayo de las guardas de la fase 3 SOLO en copia desechable. Uso: COPIA_DB_URL=... bash g3/ejecutar.sh copia
set -uo pipefail; set +x
T="${RUNNER_TEMP:-/tmp}/g3"; mkdir -p "$T"; DB="${COPIA_DB_URL:?}"
run() { psql "$DB" -X -v ON_ERROR_STOP=1 -At "$@" > "$T/out" 2> "$T/err"; }
huella() { run -v pfx=h_ -f g3/huella_solo.sql && cat "$T/out"; }
fin() { run -f trib/huella_financiera.sql && cat "$T/out"; }
obj() { run -c "select (select count(*) from pg_proc where proname like 'trib3\_%')||'/'||(select count(*) from pg_trigger where tgname like 'trib\_v\_%')" && cat "$T/out"; }
adm() { psql "$DB" -X -At -c "select id from public.perfiles where rol = 'admin' order by id limit 1"; }
usr() { psql "$DB" -X -At -c "select id from public.perfiles where rol <> 'admin' order by id limit 1"; }
# Estado igual a producción: permisos de tablas, permisos de funciones de la fase 2 y la corrección de trib_escritura_api.
run -f "${PERMISOS:-trib/permisos_produccion.sql}" || { echo "FALLA: permisos de producción"; exit 1; }
psql "$DB" -X -q -c "grant usage on schema auth to authenticated, anon;" >/dev/null 2>&1
run -f hf/acl_fase2.sql && run -c "grant execute on function public.trib_escritura_api() to authenticated" || { echo "FALLA: permisos de la fase 2"; exit 1; }
[ "$(obj)" = "0/0" ] && echo "RESULT|copia_sin_guardas|OK" || { echo "FALLA: la copia ya tiene guardas"; exit 1; }
DB_URL="$DB" bash scripts/prueba-permisos-api.sh > "$T/pa0" 2>&1; grep -q 'RESULT|permisos_api|OK' "$T/pa0" && echo "RESULT|app_escribe_oc_antes_de_guardas|OK" || { echo "FALLA: la copia no está como producción (permisos API)"; exit 1; }
H0="$(huella)"; F0="$(fin)"; echo "INFO|huellas_iniciales|${H0:0:12}/${F0:4:12}"
run -f g3/instalar.sql; grep -E '^(RESULT|FALLA)' "$T/out"; grep -q '^RESULT|guardas_instaladas_huellas_identicas|OK' "$T/out" || { head -3 "$T/err" | sed 's/^/FALLA|detalle|/'; echo "FALLA: instalación"; exit 1; }
[ "$(obj)" = "2/2" ] && echo "RESULT|objetos_2_funciones_2_disparadores|OK" || { echo "FALLA: objetos $(obj)"; exit 1; }
run -v adm="$(adm)" -f g3/preparar.sql || { head -3 "$T/err" | sed 's/^/FALLA|detalle|/'; echo "FALLA: preparar"; exit 1; }
U="$(usr)"; : > "$T/g3"
for f in g3/pruebas/*.sql; do psql "$DB" -X -At -v usr="$U" -f "$f" 2>>"$T/g3err" | grep '^G3|' >> "$T/g3"; done
tr '\n' ' ' < "$T/g3" | cut -c1-3800 | sed 's/^/PRUEBAS|/'; echo
N="$(grep -c '|true$' "$T/g3")"; M="$(grep -c '|false$' "$T/g3")"
[ "$N" = 16 ] && [ "$M" = 0 ] && echo "RESULT|16_pruebas_de_guardas_en_sesiones_independientes|OK" || { grep '|false$' "$T/g3" | sed 's/^/FALLA|/'; echo "FALLA: pruebas de guardas $N/16"; exit 1; }
DB_URL="$DB" bash scripts/prueba-permisos-api.sh > "$T/pa1" 2>&1; grep -q 'RESULT|permisos_api|OK' "$T/pa1" && echo "RESULT|app_crea_y_edita_oc_con_guardas_9_de_9|OK" || { grep -E 'FALLA|API' "$T/pa1" | head -5; echo "FALLA: la app no escribe OC con las guardas"; exit 1; }
run -f g3/limpiar.sql || { echo "FALLA: limpiar"; exit 1; }
[ "$(fin)" = "$F0" ] && echo "RESULT|huella_financiera_igual_tras_pruebas|OK" || { echo "FALLA: la huella financiera cambió"; exit 1; }
run --single-transaction -f g3/deshacer.sql && [ "$(obj)" = "0/0" ] && echo "RESULT|deshacer_sin_rastro|OK" || { echo "FALLA: deshacer"; exit 1; }
[ "$(huella)" = "$H0" ] && echo "RESULT|huella_tras_deshacer_identica|OK" || { echo "FALLA: la huella cambió tras deshacer"; exit 1; }
run -f g3/instalar.sql && grep -q '^RESULT|guardas_instaladas' "$T/out" && run --single-transaction -f g3/deshacer.sql && echo "RESULT|reinstalar_y_deshacer_de_nuevo|OK" || { echo "FALLA: reinstalar"; exit 1; }
