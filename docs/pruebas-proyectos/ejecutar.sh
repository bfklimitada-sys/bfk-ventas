#!/usr/bin/env bash
# Ejecuta TODAS las pruebas de interfaz de Proyectos Industriales sobre bases desechables locales (nunca producción):
#   1. reglas.test.mjs (listas, transiciones y permisos de pantalla contra el SQL y contra la base real)
#   2. e2e_proyectos.mjs (navegador real, PC y celular, 5 usuarios, PostgREST real; y la app sin la migración instalada)
# Requisitos: PostgreSQL local (PGHOST/PGPORT, superusuario postgres), postgrest (POSTGREST=ruta), Chromium (CHROME=ruta),
#             dependencias instaladas (npm install) y playwright-core en NODE_PATH.
# Uso: bash docs/pruebas-proyectos/ejecutar.sh
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$D/../.." && pwd)"; cd "$R"
PUERTO_APP="${PUERTO_APP:-4320}"; RC=0
eval "$(bash "$D/entorno.sh" instalar)"
export JWT_SECRET
PGRST_SIN_MODULO="$(PI_DB=bfk_pi_vacia PGRST_PORT=3902 bash "$D/entorno.sh" sin_modulo | sed -n 's/.*PGRST_URL=\([^ ]*\).*/\1/p')"; export PGRST_SIN_MODULO
echo "== reglas"; node "$D/reglas.test.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== reglas contra la base real"; PI_DB_URL="$PI_DB_URL" node "$D/reglas.test.mjs" | grep -E "FALLA|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
DIST="${TMPDIR:-/tmp}/dist-pi"; npx vite build --outDir "$DIST" --emptyOutDir > /dev/null 2>&1 || { echo "FALLA: build"; exit 1; }
npx vite preview --outDir "$DIST" --host 127.0.0.1 --port "$PUERTO_APP" --strictPort > /dev/null 2>&1 & PV=$!
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO_APP/" > /dev/null 2>&1 && break; sleep 0.5; done
echo "== e2e"; node "$D/e2e_proyectos.mjs" "http://127.0.0.1:$PUERTO_APP/"; RC=$((RC | $?))
kill $PV 2>/dev/null; pkill -f "postgrest $D/.pgrst-" 2>/dev/null
exit $RC
