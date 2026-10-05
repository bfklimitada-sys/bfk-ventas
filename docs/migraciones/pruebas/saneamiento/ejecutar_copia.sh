#!/usr/bin/env bash
# Ejecuta en la COPIA restaurada (PG* apunta a PostgreSQL efímero localhost). Nunca contra producción.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
[ "${PGHOST:-}" = "localhost" ] || { echo "ABORTA: PGHOST no es localhost"; exit 9; }
python3 "$D/validar_saneamiento.py"
