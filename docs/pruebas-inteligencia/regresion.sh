#!/bin/bash
# Regresión comparativa de TODAS las suites existentes (unitarias y de interfaz) contra una compilación servida localmente.
# Se ejecuta dos veces (main y la rama) y se comparan los resultados con comparar_regresion.py.
# Uso: bash docs/pruebas-inteligencia/regresion.sh <etiqueta> <url-de-la-vista-local> [salida.tsv]
# Ej.: bash docs/pruebas-inteligencia/regresion.sh main http://127.0.0.1:4301/ /tmp/reg-main.tsv
# Requisitos: node, playwright-core (npm i --no-save playwright-core) y Chromium en CHROME.
# Nada sale a la red: las suites de interfaz simulan Supabase y Mercado Público.
set -u
ETQ=${1:?etiqueta}; URL=${2:?url}; OUT=${3:-/tmp/reg-$ETQ.tsv}
RAIZ="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$RAIZ"
export CHROME=${CHROME:-$(ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome 2>/dev/null | sort | tail -1)}
LOGS=/tmp/reg-logs-$ETQ; rm -rf "$LOGS"; mkdir -p "$LOGS"
printf 'suite\tsalida\tok\tfallas\tultima_linea\n' > "$OUT"
# Las carpetas con ejecutar.mjs empaquetan sus pruebas unitarias con esbuild (imports de src/ y JSX): se ejecuta ese
# archivo en lugar de sus *.test.mjs. SOLO_EJECUTAR=1 corre solo esos empaquetadores.
LISTA=$(for f in $(find docs -name "*.test.mjs" -o -name "e2e_*.mjs" -o -name "*.e2e.mjs" -o -name "ejecutar.mjs" | sort); do
  d=$(dirname "$f"); b=$(basename "$f")
  if [ "$b" = ejecutar.mjs ]; then echo "$f"; continue; fi
  [ "${SOLO_EJECUTAR:-0}" = 1 ] && continue
  case "$b" in *.test.mjs) [ -f "$d/ejecutar.mjs" ] && continue;; esac
  echo "$f"
done)
for f in $LISTA; do
  n=$(echo "$f" | tr '/' '_'); arg=""
  grep -q 'process.argv\[2\]' "$f" && arg="$URL"
  timeout 300 node "$f" $arg > "$LOGS/$n.log" 2>&1; rc=$?
  ok=$(grep -cE '^(OK|✓|ok)\b' "$LOGS/$n.log"); fa=$(grep -cE '^(FALLA|✗|not ok|FAIL)\b' "$LOGS/$n.log")
  ul=$(grep -v '^\s*$' "$LOGS/$n.log" | tail -1 | tr '\t' ' ' | cut -c1-160)
  printf '%s\t%s\t%s\t%s\t%s\n' "$f" "$rc" "$ok" "$fa" "$ul" >> "$OUT"
done
echo "Listo: $OUT"
