#!/bin/bash
# Entorno AISLADO para revisar Ventas privadas y Proyectos con datos representativos (SOLO base desechable local; nunca producción).
# Crea la base desechable con todas las migraciones (06/11 → 11/11), levanta el sustituto local de PostgREST y siembra:
#   · Proyectos: docs/pruebas-proyectos/semilla.sql (4 proyectos en distintos estados, actividades, hitos, equipo)
#   · Ventas privadas: semilla_vp.mjs (5 clientes, 6 cotizaciones y 5 ventas en todos los estados, con textos largos)
# Requisitos: PostgreSQL local (PGHOST/PGPORT, superusuario postgres) y POSTGREST apuntando a un PostgREST o al sustituto
#   docs/pruebas-ventas-privadas/financiamiento/pgrest_local.mjs. Imprime PGRST_URL, JWT_SECRET y VP_DB_URL.
# Uso: eval "$(bash docs/pruebas-orden-visual/entorno.sh)"; export PGRST_URL JWT_SECRET VP_DB_URL
#      node docs/pruebas-orden-visual/modulos.mjs http://127.0.0.1:4179/ /tmp/capturas [pc|cel|cel360]
R="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$R"; export PGHOST="${PGHOST:-/var/tmp/pgl}" PGPORT="${PGPORT:-5499}"
pkill -f pgrest_local.mjs 2>/dev/null; sleep 0.3
D=docs/pruebas-ventas-privadas
[ "$(psql -h $PGHOST -p $PGPORT -U postgres -At -c "select 1 from pg_database where datname='bfk_vp_plantilla'")" = 1 ] && [ "$(psql -h $PGHOST -p $PGPORT -U postgres -d bfk_vp_plantilla -At -c "select count(*) from information_schema.columns where table_name='financiadores' and column_name='tipo'")" != 1 ] && psql -h $PGHOST -p $PGPORT -U postgres -d bfk_vp_plantilla -q -f $D/financiamiento/catalogos_prueba.sql > /dev/null
V="$(bash $D/entorno.sh instalar 2>/tmp/entorno-vp.err)"; eval "$V"
psql -h $PGHOST -p $PGPORT -X -q -v ON_ERROR_STOP=1 -U bfk_owner -d bfk_vp_e2e -f docs/migraciones/BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql > /dev/null 2>>/tmp/entorno-vp.err
psql -h $PGHOST -p $PGPORT -X -q -At -U postgres -d bfk_vp_e2e -f docs/pruebas-proyectos/semilla.sql 2>>/tmp/entorno-vp.err | grep '^SEMILLA' >&2
VP_DB_URL="$VP_DB_URL" node docs/pruebas-orden-visual/semilla_vp.mjs >&2
echo "$V"
