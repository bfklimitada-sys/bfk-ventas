#!/usr/bin/env bash
# Base DESECHABLE local para el financiamiento y vendedor BFK (nunca producción): plantilla de Ventas privadas + migraciones
# 06/11 → 10/11 (estado de producción) + catálogos de prueba + (MODO=instalar) la migración del 11/11.
# Uso: bash base.sh [instalar|produccion]   → imprime VP_DB_URL
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; M="$D/../../migraciones"; PV="$D/.."
PGHOST="${PGHOST:-/var/tmp/pgl}"; PGPORT="${PGPORT:-5499}"; MODO="${1:-instalar}"; DB="${VP_DB:-bfk_vpfin}"
P=(-h "$PGHOST" -p "$PGPORT" -X -q -v ON_ERROR_STOP=1)
if [ -z "$(psql "${P[@]}" -U postgres -At -c "select 1 from pg_database where datname = 'bfk_vp_plantilla'")" ]; then
  echo "Falta la plantilla: ejecuta primero docs/pruebas-ventas-privadas/entorno.sh" >&2; exit 2; fi
psql "${P[@]}" -U postgres -c "drop database if exists $DB with (force)" -c "create database $DB template bfk_vp_plantilla"
for f in BORRADOR-2026-11-06-ventas-privadas.sql BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql BORRADOR-2026-11-09-vp-eett-como-mp.sql BORRADOR-2026-11-10-vp-compras-como-mp.sql; do
  psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/$f" > /dev/null; done
psql "${P[@]}" -U postgres -d "$DB" -f "$D/catalogos_prueba.sql" > /dev/null
[ "$MODO" = instalar ] && psql "${P[@]}" -U bfk_owner -d "$DB" -f "$M/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql" > /dev/null
echo "export VP_DB_URL=postgresql://postgres@127.0.0.1:$PGPORT/$DB"
