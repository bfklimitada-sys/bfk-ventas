#!/usr/bin/env bash
# Entorno de pruebas de interfaz de Proyectos Industriales — SOLO base desechable local (nunca producción).
# Crea una base nueva con la réplica de BFK + la base Supabase de prueba + la migración del módulo (instalada con el rol
# dueño SIN superusuario, como en Supabase) + datos ficticios (semilla.sql), y levanta PostgREST 12 sobre ella.
# Requisitos: PostgreSQL local (PGHOST/PGPORT) con superusuario «postgres» y el binario postgrest (POSTGREST=ruta).
# Uso: bash docs/pruebas-proyectos/entorno.sh [instalar|sin_modulo]     → imprime las variables PGRST_URL, JWT_SECRET y PI_DB_URL
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../migraciones"
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; MODO="${1:-instalar}"
BASE="${PI_BASE:-bfk_pi_plantilla}"; DB="${PI_DB:-bfk_pi_e2e}"; PUERTO="${PGRST_PORT:-3901}"
P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
# 1. Plantilla (una vez): réplica local + base Supabase de prueba.
if [ -z "$(psql "${P[@]}" -U postgres -At -c "select 1 from pg_database where datname = '$BASE'")" ]; then
  psql "${P[@]}" -U postgres -c "create database $BASE"
  psql "${P[@]}" -U postgres -d "$BASE" -f "$M/pruebas/schema-local.sql" > /dev/null
  psql "${P[@]}" -U postgres -d "$BASE" -f "$M/pruebas/proyectos/base_supabase.sql" > /dev/null 2>&1
fi
# 2. Base de la prueba: copia limpia de la plantilla.
pkill -f "postgrest $D/.pgrst-$PUERTO.conf" 2>/dev/null || true
psql "${P[@]}" -U postgres -c "drop database if exists $DB with (force)" -c "create database $DB template $BASE"
if [ "$MODO" = instalar ]; then
  psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-10-22-proyectos-industriales.sql" > /dev/null
  psql -h "$PGHOST" -p "$PGPORT" -X -At -U postgres -d "$DB" -f "$D/semilla.sql" | grep '^SEMILLA' >&2
fi
# 3. PostgREST (mismo servidor que usa Supabase) con un secreto aleatorio.
SECRETO="${JWT_SECRET:-$(openssl rand -hex 32)}"
cat > "$D/.pgrst-$PUERTO.conf" <<EOF
db-uri = "postgres://authenticator@127.0.0.1:$PGPORT/$DB"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$SECRETO"
server-host = "127.0.0.1"
server-port = $PUERTO
db-tx-end = "commit-allow-override"
EOF
nohup "${POSTGREST:-postgrest}" "$D/.pgrst-$PUERTO.conf" > "$D/.pgrst-$PUERTO.log" 2>&1 &
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PUERTO/" > /dev/null 2>&1 && break; sleep 0.5; done
echo "export PGRST_URL=http://127.0.0.1:$PUERTO JWT_SECRET=$SECRETO PI_DB_URL=postgresql://postgres@127.0.0.1:$PGPORT/$DB"
