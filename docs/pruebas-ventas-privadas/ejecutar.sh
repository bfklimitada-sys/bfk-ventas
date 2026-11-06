#!/usr/bin/env bash
# Ejecuta TODAS las pruebas de Ventas privadas sobre bases desechables locales (nunca producción):
#   1. sql.test.mjs     — migración: permisos, duplicados, totales, revisiones, idempotencia, concurrencia, anulaciones, EETT, MP intacto
#   2. deshacer         — la reversión se niega con datos y, sin datos, deja el catálogo idéntico a la plantilla
#   3. reglas.test.mjs  — reglas puras, PDF sin costos y fórmula idéntica a la base
#   4. e2e              — navegador real (escritorio y celular), PostgREST real, recorrido completo
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
# e2e sobre una base limpia (la de sql.test quedó con datos de prueba)
eval "$(bash "$D/entorno.sh" instalar)"; export PGRST_URL JWT_SECRET VP_DB_URL
DIST="${TMPDIR:-/tmp}/dist-vp"; npx vite build --outDir "$DIST" --emptyOutDir > /dev/null 2>&1 || { echo "FALLA: build"; exit 1; }
npx vite preview --outDir "$DIST" --host 127.0.0.1 --port "$PUERTO_APP" --strictPort > /dev/null 2>&1 & PV=$!
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO_APP/" > /dev/null 2>&1 && break; sleep 0.5; done
echo "== e2e"; node "$D/e2e_ventas_privadas.mjs" "http://127.0.0.1:$PUERTO_APP/" 2>/dev/null | grep -E "FALLA|EXCEP|RESUMEN"; RC=$((RC | ${PIPESTATUS[0]}))
kill $PV 2>/dev/null; pkill -f "postgrest $D/.pgrst-" 2>/dev/null
exit $RC
