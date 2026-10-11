#!/bin/bash
# Prepara el entorno de iva_ui.mjs: compila la versión actual y la regla anterior de IVA (commit 754c466,
# congelada también en ./anterior) y las sirve a la vez: actual en 127.0.0.1:4175 y anterior en 127.0.0.1:4176.
# Solo archivos temporales; no toca el repositorio ni datos. Detener con: pkill -f "vite preview --outDir ${TMPDIR:-/tmp}/bfk-iva-ui"
# Uso: bash docs/pruebas-iva/servir_compilaciones.sh   (desde la raíz del repositorio, con node_modules instalado)
set -e
RAIZ="$(git rev-parse --show-toplevel)"; TMP="${TMPDIR:-/tmp}/bfk-iva-ui"; rm -rf "$TMP"; mkdir -p "$TMP/anterior-src"
git -C "$RAIZ" cat-file -e 754c466^{commit} 2>/dev/null || git -C "$RAIZ" fetch -q --depth=400 origin main
git -C "$RAIZ" archive 754c466 | tar -x -C "$TMP/anterior-src"
ln -s "$RAIZ/node_modules" "$TMP/anterior-src/node_modules"
( cd "$RAIZ" && npx vite build --outDir "$TMP/actual" --emptyOutDir --logLevel error )
( cd "$TMP/anterior-src" && npx vite build --outDir "$TMP/anterior" --emptyOutDir --logLevel error )
# Servidores en segundo plano, desligados de la terminal (no retienen la salida del script).
( cd "$RAIZ" && exec npx vite preview --outDir "$TMP/actual" --port 4175 --strictPort ) < /dev/null > "$TMP/actual.log" 2>&1 & echo $! >> "$TMP/pids"
( cd "$TMP/anterior-src" && exec npx vite preview --outDir "$TMP/anterior" --port 4176 --strictPort ) < /dev/null > "$TMP/anterior.log" 2>&1 & echo $! >> "$TMP/pids"
sleep 3; echo "actual: http://127.0.0.1:4175/ · anterior (754c466): http://127.0.0.1:4176/"
