#!/usr/bin/env bash
# Ejecuta en la COPIA restaurada (PG* apunta a PostgreSQL efímero). Nunca contra producción.
set -uo pipefail
D="$(cd "$(dirname "$0")" && pwd)"
case "$(psql -XAtc "select current_setting('cluster_name', true)||'|'||inet_server_addr()")" in *127.0.0.1*|*::1*|*172.*) ;; *) echo "ABORTA: no parece la copia local"; exit 9;; esac
python3 "$D/diagnostico.py"
