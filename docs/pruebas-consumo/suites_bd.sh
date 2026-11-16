#!/usr/bin/env bash
# Consumo de Supabase, fase 1 — suites E2E que necesitan PostgreSQL y PostgREST REALES (bases desechables, nunca producción):
# Proyectos Industriales, Ventas privadas (recorrido, cotización y EETT como MP, compra) y sesión de Ventas privadas.
# Corre cada suite contra la versión de la app servida en <url> (la publicada o la optimizada) y resume el resultado.
# Requisitos: PostgreSQL en PGHOST/PGPORT (superusuario postgres), postgrest en el PATH (o POSTGREST), CHROME, node_modules.
# Uso: bash docs/pruebas-consumo/suites_bd.sh http://127.0.0.1:4402/
set -uo pipefail
R="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$R"; URL="${1:?url de la app}"; RC=0
export PGHOST="${PGHOST:-/var/tmp/pgl}" PGPORT="${PGPORT:-5499}" NODE_PATH="${NODE_PATH:-$R/node_modules}"
resumen() { grep -E "RESUMEN|FALLA|EXCEP|[0-9]+ OK" | grep -vE "^OK|^\s+at " | tail -3 | sed "s#^#  #"; }
corre() { local nombre="$1"; shift; echo "== $nombre"; local s; s="$("$@" 2>&1)"; local c=$?; echo "$s" | resumen; [ $c = 0 ] && echo "SUITE_OK|$nombre" || { echo "SUITE_FALLA|$nombre|codigo=$c"; RC=1; }; }

# Proyectos Industriales (con la migración y la app sin el módulo instalado)
eval "$(bash docs/pruebas-proyectos/entorno.sh instalar)"; export JWT_SECRET PGRST_URL PI_DB_URL
PGRST_SIN_MODULO="$(PI_DB=bfk_pi_vacia PGRST_PORT=3902 bash docs/pruebas-proyectos/entorno.sh sin_modulo | sed -n 's/.*PGRST_URL=\([^ ]*\).*/\1/p')"; export PGRST_SIN_MODULO
corre "proyectos" node docs/pruebas-proyectos/e2e_proyectos.mjs "$URL"
pkill -f "postgrest $R/docs/pruebas-proyectos/.pgrst-" 2>/dev/null

# Ventas privadas: cada suite sobre una base limpia
vp() { eval "$(bash docs/pruebas-ventas-privadas/entorno.sh instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL; }
vp; corre "ventas_privadas" node docs/pruebas-ventas-privadas/e2e_ventas_privadas.mjs "$URL"
vp; corre "cotizacion_como_mp" node docs/pruebas-ventas-privadas/e2e_cotizacion_como_mp.mjs "$URL"
for MODO in escritorio celular; do vp; corre "eett_cp_2026_0001_$MODO" node docs/pruebas-ventas-privadas/e2e_eett_cp_2026_0001.mjs "$URL" "$MODO"; done
vp; corre "compra_vp" node docs/pruebas-ventas-privadas/e2e_compra_vp.mjs "$URL"
vp; corre "sesion_vp" node docs/pruebas-sesion/e2e_sesion_vp.mjs "$URL"
pkill -f "postgrest $R/docs/pruebas-ventas-privadas/.pgrst-" 2>/dev/null
[ "$RC" = 0 ] && echo "SUITES_BD_CORRECTAS" || echo "SUITES_BD_CON_FALLAS"; exit $RC
