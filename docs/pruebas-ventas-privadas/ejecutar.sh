#!/usr/bin/env bash
# Ejecuta TODAS las pruebas de Ventas privadas sobre bases desechables locales (nunca producción):
#   1. sql.test.mjs     — migración: permisos, duplicados, totales, revisiones, idempotencia, concurrencia, anulaciones, EETT, MP intacto
#   2. deshacer         — la reversión se niega con datos y, sin datos, deja el catálogo idéntico a la plantilla
#   3. reglas.test.mjs  — reglas puras, PDF sin costos y fórmula idéntica a la base
#      eett_mp_sin_cambios.test.mjs — las EETT de Mercado Público quedan byte a byte iguales a las de main
#      ejemplos_eett.mjs — un ejemplo de EETT por canal con el mismo generador (varios productos, textos largos)
#   4. e2e              — navegador real (escritorio y celular), PostgREST real, recorrido completo
#   5. sql_como_mp / reglas_como_mp / e2e_cotizacion_como_mp — cotización privada con la experiencia de Mercado Público (08/11/2026)
#   6. sql_eett_como_mp / eett_como_mp / e2e_eett_cp_2026_0001 — EETT privada con el recorrido de Mercado Público (09/11/2026),
#      verificada sobre una copia aislada de la cotización de la captura (CP-2026-0001, «Bolso Paramédico Mediano 47L»)
#   7. e2e_sesion_vp / e2e_sesion_mp — renovación de sesión y sesiones vencidas (10/11/2026)
#   8. mp_byte_a_byte — Mercado Público en la versión publicada y en la nueva: pantallas y PDF idénticos
# Requisitos: PostgreSQL local (PGHOST/PGPORT, superusuario postgres), postgrest 12 (POSTGREST=ruta), Chromium (CHROME=ruta),
#             npm install y playwright-core resoluble desde node_modules.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$D/../.." && pwd)"; cd "$R"
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; PUERTO_APP="${PUERTO_APP:-4330}"; RC=0
P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
export VP_PLANTILLA_URL="postgresql://postgres@127.0.0.1:$PGPORT/${VP_BASE:-bfk_vp_plantilla}"
echo "== sql"; node "$D/sql.test.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== deshacer"
psql "${P[@]}" -U postgres -c "drop database if exists bfk_vp_rev with (force)" -c "create database bfk_vp_rev template ${VP_BASE:-bfk_vp_plantilla}" > /dev/null
psql "${P[@]}" -U bfk_owner -d bfk_vp_rev -f docs/migraciones/BORRADOR-2026-11-06-ventas-privadas.sql > /dev/null 2>&1 || { echo "FALLA instalar en copia"; RC=1; }
H="select md5(string_agg(t,'|' order by t)) from (select 'c:'||c.relname::text||c.relkind::text||coalesce(c.relacl::text,'') t from pg_class c where c.relnamespace in ('public'::regnamespace,'storage'::regnamespace) union all select 'f:'||p.oid::regprocedure::text||md5(p.prosrc)||coalesce(p.proacl::text,'') from pg_proc p where p.pronamespace='public'::regnamespace union all select 'p:'||schemaname||tablename||policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies union all select 'b:'||id from storage.buckets union all select 'l:'||codigo from public.bfk_lineas_negocio) x"
SAL="$(psql "${P[@]}" -U bfk_owner -d "${VP_DB:-bfk_vp_e2e}" -f docs/migraciones/BORRADOR-2026-11-06-ventas-privadas-deshacer.sql 2>&1)"
grep -q "no se deshizo nada" <<< "$SAL" && [ -n "$(psql "${P[@]}" -At -U postgres -d "${VP_DB:-bfk_vp_e2e}" -c "select 1 from pg_class where relname = 'vp_ventas'")" ] && echo "OK deshacer se niega con datos (y no toca nada)" || { echo "FALLA deshacer con datos"; RC=1; }
psql "${P[@]}" -U bfk_owner -d bfk_vp_rev -f docs/migraciones/BORRADOR-2026-11-06-ventas-privadas-deshacer.sql > /dev/null 2>&1 || { echo "FALLA deshacer sin datos"; RC=1; }
[ "$(psql "${P[@]}" -At -U postgres -d bfk_vp_rev -c "$H")" = "$(psql "${P[@]}" -At -U postgres -d "${VP_BASE:-bfk_vp_plantilla}" -c "$H")" ] && echo "OK catálogo idéntico tras deshacer" || { echo "FALLA catálogo distinto tras deshacer"; RC=1; }
echo "== reglas"; node "$D/reglas.test.mjs" 2>/dev/null | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== cotización privada como Mercado Público: migración 08/11, persistencia y recuperación"; node "$D/sql_como_mp.test.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== cotización privada como Mercado Público: reglas"; node "$D/reglas_como_mp.test.mjs" 2>/dev/null | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== EETT de Mercado Público sin cambios"; node "$D/eett_mp_sin_cambios.test.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== plazo de entrega largo en la EETT (ambos canales; documentos emitidos iguales)"; REF_MP="${REF_PLAZO:-c48378a}" node "$D/eett_plazo_largo.test.mjs" 2>/dev/null | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== EETT privada como Mercado Público: migración 09/11, reglas y recuperación"; node "$D/sql_eett_como_mp.test.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== EETT privada como Mercado Público: ficha → PDF (copia de CP-2026-0001) y compatibilidad"; node "$D/eett_como_mp.test.mjs" 2>/dev/null | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
echo "== ejemplos de EETT (ambos canales)"; node "$D/ejemplos_eett.mjs" | tail -1; RC=$((RC | ${PIPESTATUS[0]}))
# e2e sobre una base limpia (la de sql.test quedó con datos de prueba)
eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
DIST="${TMPDIR:-/tmp}/dist-vp"; npx vite build --outDir "$DIST" --emptyOutDir > /dev/null 2>&1 || { echo "FALLA: build"; exit 1; }
npx vite preview --outDir "$DIST" --host 127.0.0.1 --port "$PUERTO_APP" --strictPort > /dev/null 2>&1 & PV=$!
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO_APP/" > /dev/null 2>&1 && break; sleep 0.5; done
echo "== e2e"; node "$D/e2e_ventas_privadas.mjs" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
# Recorrido completo de la cotización privada (escritorio y celular) sobre otra base limpia + capturas comparativas con Mercado Público.
eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
echo "== e2e cotización privada como Mercado Público"; node "$D/e2e_cotizacion_como_mp.mjs" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN|Capturas"; RC=$((RC | ${PIPESTATUS[0]}))
# EETT de la cotización de la captura (copia aislada) y comparación con Mercado Público, en escritorio y celular (base limpia cada vez).
for MODO in escritorio celular; do
  eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
  echo "== e2e EETT CP-2026-0001 ($MODO)"; node "$D/e2e_eett_cp_2026_0001.mjs" "http://127.0.0.1:$PUERTO_APP/" "$MODO" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
done
# Renovación de sesión y sesiones vencidas (10/11/2026): sesión vencida, varias pestañas, suspensión, pérdida de conexión, fallo de
# renovación y pestaña desactualizada; guardar, emitir EETT y crear ventas ocurren una sola vez (base limpia; MP con su simulador).
eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
echo "== sesión: Ventas privadas"; node "$R/docs/pruebas-sesion/e2e_sesion_vp.mjs" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
echo "== sesión: Mercado Público"; node "$R/docs/pruebas-sesion/e2e_sesion_mp.mjs" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
# Mercado Público sin cambios en navegador: misma ruta en la versión publicada (REF_PUBLICADA, por defecto origin/main) y en la
# nueva → pantallas idénticas píxel a píxel y PDF de EETT idénticos byte a byte.
WT="${TMPDIR:-/tmp}/wt-publicada"; git worktree remove --force "$WT" > /dev/null 2>&1; git worktree prune
if git worktree add -q --detach "$WT" "${REF_PUBLICADA:-origin/main}" && ln -s "$R/node_modules" "$WT/node_modules" && (cd "$WT" && npx vite build --outDir "${TMPDIR:-/tmp}/dist-publicada" --emptyOutDir > /dev/null 2>&1); then
  npx vite preview --outDir "${TMPDIR:-/tmp}/dist-publicada" --host 127.0.0.1 --port $((PUERTO_APP + 1)) --strictPort > /dev/null 2>&1 & PP=$!
  for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$((PUERTO_APP + 1))/" > /dev/null 2>&1 && break; sleep 0.5; done
  echo "== Mercado Público byte a byte (publicada vs nueva)"; node "$D/mp_byte_a_byte.mjs" "http://127.0.0.1:$((PUERTO_APP + 1))/" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
  kill $PP 2>/dev/null
else echo "FALLA: no se pudo compilar la versión publicada"; RC=1; fi
git worktree remove --force "$WT" > /dev/null 2>&1
kill $PV 2>/dev/null; pkill -f "postgrest $D/.pgrst-" 2>/dev/null
exit $RC
