#!/usr/bin/env bash
# Pruebas del financiamiento de compras y vendedor «BFK» (11/11/2026) + regresión de TODO Ventas privadas y de Mercado Público,
# con la migración del 11/11 instalada, en bases DESECHABLES locales (nunca producción).
# Requisitos: PostgreSQL local (PGHOST/PGPORT), servidor PostgREST (POSTGREST=ruta; aquí puede ser la envoltura de pgrest_local.mjs),
#             Chromium (CHROME=ruta), npm install + playwright-core y pg.
# Uso: bash docs/pruebas-ventas-privadas/financiamiento/ejecutar.sh [carpeta_capturas]
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; V="$D/.."; R="$(cd "$D/../../.." && pwd)"; M="$R/docs/migraciones"; cd "$R"
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; PUERTO_APP="${PUERTO_APP:-4330}"; CAP="${1:-}"; RC=0
export CHROME="${CHROME:-/opt/pw-browsers/chromium-1243/chrome-linux64/chrome}"
P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
corre() { local n="$1"; shift; echo "== $n"; "$@" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN|^OK +R"; local c=${PIPESTATUS[0]}; RC=$((RC | c)); }
# La réplica local no tiene financiadores.tipo (existe en producción desde la Fase 4B): se agrega a la plantilla con catálogos de prueba.
[ "$(psql "${P[@]}" -U postgres -d bfk_vp_plantilla -At -c "select count(*) from information_schema.columns where table_name='financiadores' and column_name='tipo'" 2>/dev/null)" = 1 ] \
  || psql "${P[@]}" -U postgres -d bfk_vp_plantilla -f "$D/catalogos_prueba.sql" > /dev/null
entorno() { pkill -f pgrest_local.mjs 2>/dev/null; sleep 0.3; eval "$(bash "$V/entorno.sh" instalar 2>/dev/null)"; export PGRST_URL JWT_SECRET VP_DB_URL
  [ "${1:-fin}" = fin ] && psql "${P[@]}" -U bfk_owner -d "${VP_DB:-bfk_vp_e2e}" -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql" > /dev/null; }
export VP_PLANTILLA_URL="postgresql://postgres@127.0.0.1:$PGPORT/bfk_vp_plantilla"

# 1. Base: reglas, permisos, concurrencia y recuperación
eval "$(bash "$D/base.sh" instalar 2>/dev/null)"; export VP_DB_URL
corre "financiamiento y vendedor: base (permisos, reglas, reintentos, concurrencia)" node "$D/sql_financiamiento.test.mjs"
corre "financiamiento: reglas de la interfaz = vistas de la base" node "$D/reglas_financiamiento.test.mjs"
corre "recuperación sin pérdida de datos" bash "$D/recuperacion.test.sh"
# 2. Regresión de la base de Ventas privadas con la migración instalada
entorno; corre "regresión: Ventas privadas 06/11" node "$V/sql.test.mjs"
entorno; corre "regresión: cotización como Mercado Público 08/11" node "$V/sql_como_mp.test.mjs"
entorno; corre "regresión: EETT como Mercado Público 09/11" node "$V/sql_eett_como_mp.test.mjs"
corre "regresión: compra desde la cotización (cálculo)" node "$V/compra_vp.test.mjs"
corre "regresión: reglas" node "$V/reglas.test.mjs"
corre "regresión: reglas como Mercado Público" node "$V/reglas_como_mp.test.mjs"
corre "regresión: EETT de Mercado Público sin cambios" node "$V/eett_mp_sin_cambios.test.mjs"
# 3. Navegador (escritorio y celular)
DIST="${TMPDIR:-/tmp}/dist-vpfin"; npx vite build --outDir "$DIST" --emptyOutDir > /dev/null 2>&1 || { echo "FALLA: build"; exit 1; }
npx vite preview --outDir "$DIST" --host 127.0.0.1 --port "$PUERTO_APP" --strictPort > /dev/null 2>&1 & PV=$!
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO_APP/" > /dev/null 2>&1 && break; sleep 0.5; done
U="http://127.0.0.1:$PUERTO_APP/"
entorno; corre "financiamiento y vendedor: navegador (escritorio y celular)" node "$D/e2e_financiamiento.mjs" "$U" ${CAP:+"$CAP"}
entorno; corre "regresión: compra desde la cotización (navegador)" node "$V/e2e_compra_vp.mjs" "$U"
entorno; corre "regresión: Ventas privadas (navegador)" node "$V/e2e_ventas_privadas.mjs" "$U"
entorno; corre "regresión: cotización como Mercado Público (navegador)" node "$V/e2e_cotizacion_como_mp.mjs" "$U"
for MODO in escritorio celular; do entorno; corre "regresión: EETT CP-2026-0001 ($MODO)" node "$V/e2e_eett_cp_2026_0001.mjs" "$U" "$MODO"; done
entorno; corre "regresión: sesión en Ventas privadas" node "$R/docs/pruebas-sesion/e2e_sesion_vp.mjs" "$U"
entorno; corre "regresión: sesión en Mercado Público" node "$R/docs/pruebas-sesion/e2e_sesion_mp.mjs" "$U"
# 4. Sin la migración (estado actual de producción): la interfaz nueva funciona como 1d47499
entorno sin; corre "interfaz nueva SIN la migración: compra desde la cotización" node "$V/e2e_compra_vp.mjs" "$U"
# 5. Mercado Público byte a byte: versión publicada (REF_PUBLICADA, por defecto origin/main) vs nueva
WT="${TMPDIR:-/tmp}/wt-publicada"; git worktree remove --force "$WT" > /dev/null 2>&1; git worktree prune
if git worktree add -q --detach "$WT" "${REF_PUBLICADA:-origin/main}" && ln -s "$R/node_modules" "$WT/node_modules" && (cd "$WT" && npx vite build --outDir "${TMPDIR:-/tmp}/dist-publicada" --emptyOutDir > /dev/null 2>&1); then
  npx vite preview --outDir "${TMPDIR:-/tmp}/dist-publicada" --host 127.0.0.1 --port $((PUERTO_APP + 1)) --strictPort > /dev/null 2>&1 & PP=$!
  for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$((PUERTO_APP + 1))/" > /dev/null 2>&1 && break; sleep 0.5; done
  entorno; corre "Mercado Público byte a byte (publicada vs nueva)" node "$V/mp_byte_a_byte.mjs" "http://127.0.0.1:$((PUERTO_APP + 1))/" "$U"
  kill $PP 2>/dev/null
else echo "FALLA: no se pudo compilar la versión publicada"; RC=1; fi
git worktree remove --force "$WT" > /dev/null 2>&1
kill $PV 2>/dev/null; pkill -f pgrest_local.mjs 2>/dev/null
echo "RESULTADO GENERAL: $([ $RC = 0 ] && echo CORRECTO || echo CON FALLAS)"
exit $RC
