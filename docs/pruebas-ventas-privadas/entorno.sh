#!/usr/bin/env bash
# Entorno de pruebas de Ventas privadas — SOLO base desechable local (nunca producción).
# Plantilla: réplica local de BFK + base Supabase de prueba + migraciones existentes que el módulo reutiliza (Cotizaciones v1-v3,
# seguridad perfil BFK, Proyectos Industriales), instaladas con el rol dueño SIN superusuario (como en Supabase).
# Luego copia la plantilla, instala la migración de Ventas privadas (modo instalar) y levanta PostgREST 12.
# Uso: bash docs/pruebas-ventas-privadas/entorno.sh [instalar|solo_0811|solo_0611|sin_modulo]   → imprime PGRST_URL, JWT_SECRET y VP_DB_URL
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../migraciones"
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; MODO="${1:-instalar}"
BASE="${VP_BASE:-bfk_vp_plantilla}"; DB="${VP_DB:-bfk_vp_e2e}"; PUERTO="${PGRST_PORT:-3911}"
P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
if [ -z "$(psql "${P[@]}" -U postgres -At -c "select 1 from pg_database where datname = '$BASE'")" ]; then
  psql "${P[@]}" -U postgres -c "create database $BASE"
  psql "${P[@]}" -U postgres -d "$BASE" -f "$M/pruebas/schema-local.sql" > /dev/null
  psql "${P[@]}" -U postgres -d "$BASE" -f "$M/pruebas/proyectos/base_supabase.sql" > /dev/null 2>&1
  # Cotizaciones v1 sin su bloque de Storage: base_supabase.sql ya reproduce los depósitos y políticas cz_* de producción.
  python3 -I - "$M/BORRADOR-2026-10-cotizaciones.sql" > "$D/.cz-v1-sin-storage.sql" <<'PY'
import sys, re
s = open(sys.argv[1], encoding="utf-8").read()
i = s.index("do $$ begin\n  if to_regclass('storage.buckets') is null then raise notice 'CZ|SIN_STORAGE|'")
j = s.index("end $$;", i) + len("end $$;")
print(s[:i] + s[j:])
PY
  for f in "$D/.cz-v1-sin-storage.sql" "$M/BORRADOR-2026-10-cotizaciones-v2.sql" "$M/BORRADOR-2026-10-cotizaciones-v3-eliminar.sql" \
           "$M/BORRADOR-2026-10-22-proyectos-industriales.sql"; do
    psql "${P[@]}" -U bfk_owner -d "$BASE" -1 -f "$f" > /dev/null 2>"$D/.plantilla.err" || { echo "FALLA plantilla: $f"; tail -5 "$D/.plantilla.err" >&2; psql "${P[@]}" -U postgres -c "drop database $BASE"; exit 1; }
  done
fi
pkill -f "postgrest $D/.pgrst-$PUERTO.conf" 2>/dev/null || true
psql "${P[@]}" -U postgres -c "drop database if exists $DB with (force)" -c "create database $DB template $BASE"
if [ "$MODO" = instalar ] || [ "$MODO" = solo_0611 ] || [ "$MODO" = solo_0811 ]; then
  psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-06-ventas-privadas.sql" > /dev/null
  # Cotización privada con la experiencia de Mercado Público (08/11/2026). «solo_0611»: base tal como quedó en producción el 07/11.
  [ "$MODO" = instalar ] || [ "$MODO" = solo_0811 ] && psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql" > /dev/null
  # EETT con el recorrido de Mercado Público (09/11/2026). «solo_0811»: base tal como está en producción el 09/11 (sin esta migración).
  [ "$MODO" = instalar ] && psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-09-vp-eett-como-mp.sql" > /dev/null
  [ -f "$D/semilla.sql" ] && psql -h "$PGHOST" -p "$PGPORT" -X -q -At -U postgres -d "$DB" -f "$D/semilla.sql" | grep '^SEMILLA' >&2 || true
fi
SECRETO="${JWT_SECRET:-$(openssl rand -hex 32)}"
cat > "$D/.pgrst-$PUERTO.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRETO"
server-host = "127.0.0.1"
server-port = $PUERTO
db-tx-end = "commit-allow-override"
CONF
nohup "${POSTGREST:-postgrest}" "$D/.pgrst-$PUERTO.conf" > "$D/.pgrst-$PUERTO.log" 2>&1 &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO/" > /dev/null 2>&1 && break; sleep 0.5; done
echo "export PGRST_URL=http://127.0.0.1:$PUERTO JWT_SECRET=$SECRETO VP_DB_URL=postgresql://postgres@127.0.0.1:$PGPORT/$DB"
