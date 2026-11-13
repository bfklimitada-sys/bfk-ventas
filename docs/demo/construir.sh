#!/usr/bin/env bash
# Construye la DEMOSTRACIÓN aislada (datos ficticios; sin conexión con Supabase ni con producción) en dos formatos:
#   docs/demo/dist (alojada en Claude) y docs/demo/dist-archivo (un solo HTML + ZIP con instrucciones).
#   1. Base desechable local con las migraciones reales y los datos ficticios de las pruebas (Ventas privadas, Proyectos, Cotizaciones).
#   2. Volcado de esa base a SQL (docs/demo/generado/base.sql): es lo que carga PostgreSQL dentro del navegador (PGlite).
#   3. Compilación con docs/demo/vite.config.mjs.
# Requisitos: PostgreSQL local (PGHOST/PGPORT, superusuario postgres), POSTGREST (o el sustituto local) y npm.
# Uso: bash docs/demo/construir.sh [--sin-base]     (--sin-base reutiliza generado/base.sql)
set -euo pipefail
D="$(cd "$(dirname "$0")" && pwd)"; R="$(cd "$D/../.." && pwd)"; cd "$R"
export PGHOST="${PGHOST:-/var/tmp/pgl}" PGPORT="${PGPORT:-5499}"; DB="${VP_DB:-bfk_vp_e2e}"
mkdir -p "$D/generado"
if [ "${1:-}" != "--sin-base" ]; then
  bash docs/pruebas-orden-visual/entorno.sh > /dev/null
  psql -X -q -v ON_ERROR_STOP=1 -U postgres -d "$DB" -f "$D/ajustes_demo.sql"
  { pg_dumpall -U postgres --roles-only | grep -E "^(CREATE|ALTER) ROLE" | grep -v "ROLE postgres"
    pg_dump -U postgres -d "$DB" --inserts --rows-per-insert=200 --no-comments | grep -vE '^\\(un)?restrict '; } > "$D/generado/base.sql"
  echo "base.sql: $(wc -c < "$D/generado/base.sql") bytes"
fi
[ -d "$D/node_modules/@electric-sql/pglite" ] || (cd "$D" && npm install --no-audit --no-fund > /dev/null)
rm -rf "$D/dist"; npx vite build --config "$D/vite.config.mjs" > "$D/generado/compilacion.log" 2>&1 || { tail -15 "$D/generado/compilacion.log"; echo "FALLA: compilación"; exit 1; }
grep -E "built in" "$D/generado/compilacion.log" || true; [ -f "$D/dist/index.html" ] || { echo "FALLA: no se generó index.html"; exit 1; }
# Versión de un solo archivo (se abre con doble clic, sin servidor ni internet) y su ZIP con instrucciones.
DEMO_ARCHIVO=1 npx vite build --config "$D/vite.config.mjs" > "$D/generado/compilacion-archivo.log" 2>&1 || { tail -15 "$D/generado/compilacion-archivo.log"; echo "FALLA: compilación de un solo archivo"; exit 1; }
node "$D/un_archivo.mjs" "$D/dist-archivo/index.html"
mv "$D/dist-archivo/index.html" "$D/dist-archivo/BFK-Ventas-demo.html"
sed "s/@COMMIT@/$(git -C "$R" rev-parse --short HEAD)/; s/@FECHA@/$(TZ=America/Santiago date +%d-%m-%Y)/" "$D/LEEME.txt" > "$D/dist-archivo/LEEME.txt"
(cd "$D/dist-archivo" && rm -f BFK-Ventas-demo.zip && zip -q -9 BFK-Ventas-demo.zip BFK-Ventas-demo.html LEEME.txt)
echo "OK: docs/demo/dist-archivo/BFK-Ventas-demo.zip ($(du -h "$D/dist-archivo/BFK-Ventas-demo.zip" | cut -f1))"
# Comprobación de aislamiento: el resultado no puede contener la dirección de la base real.
if grep -rIl "supabase\.co" "$D/dist" "$D/dist-archivo" > /dev/null 2>&1; then echo "FALLA: la demostración contiene una dirección de Supabase"; grep -rIl "supabase\.co" "$D/dist" "$D/dist-archivo"; exit 1; fi
echo "OK: docs/demo/dist ($(du -sh "$D/dist" | cut -f1)) sin direcciones de Supabase"
