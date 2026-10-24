#!/usr/bin/env bash
# Ensayo COMPLETO de la corrección de seguridad sobre una COPIA RESTAURADA (base desechable). Nunca contra producción:
# a producción solo se le hacen lecturas del catálogo (permisos, políticas, funciones) en transacción de solo lectura.
# Variables: DB (copia), PROD_RO (opcional, producción solo lectura), VENTAS (clon de bfk-ventas), PGRST_URL, JWT_SECRET,
#            SAL (carpeta de resultados). Imprime RESULT|…|OK, FALLA|…, INFO|… (sin datos de negocio).
set -uo pipefail; set +x
D="$(cd "$(dirname "$0")" && pwd)"; SAL="${SAL:-/tmp/seg}"; mkdir -p "$SAL"; F=0
q() { psql "$DB" -X -At -v ON_ERROR_STOP=1 "$@"; }
res() { if [ "$2" = OK ]; then echo "RESULT|$1|OK"; else echo "FALLA|$1|${3:-}"; F=$((F+1)); fi; }
hdatos() { q -f "$D/huella_datos.sql" | grep '^DATOS|' | cut -d'|' -f2; }
hfin() { q -f "$D/huella_fin.sql" | tail -1; }
hcat() { q -f "$D/huella_catalogo.sql"; }

ADM="$(q -c "select id from public.perfiles where rol = 'admin' order by id limit 1")"
USR="$(q -c "select id from public.perfiles where rol <> 'admin' order by id limit 1")"
[ -n "$ADM" ] && [ -n "$USR" ] || { echo "FALLA|perfiles|falta admin o usuario"; exit 1; }
echo "INFO|copia|perfiles $(q -c "select string_agg(rol || '=' || n, ' ') from (select rol, count(*) n from public.perfiles group by rol) z") · cuentas $(q -c 'select count(*) from auth.users')"

# ── 1. Fidelidad de la copia: mismo catálogo de seguridad y mismos permisos que producción ──
HC0="$(hcat)"; echo "INFO|huella_catalogo_copia|$HC0"
q -f "$D/acl_catalogo.sql" > "$SAL/acl_copia_0.txt"
if [ -n "${PROD_RO:-}" ]; then
  HCP="$(PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -X -At -f "$D/huella_catalogo.sql")"
  [ "$HCP" = "$HC0" ] && res copia_mismo_catalogo_de_seguridad_que_produccion OK || res copia_mismo_catalogo_de_seguridad_que_produccion FALLA "prod $HCP copia $HC0"
  PGOPTIONS='-c default_transaction_read_only=on' psql "$PROD_RO" -X -At -f "$D/acl_catalogo.sql" > "$SAL/acl_prod.txt"
  N="$(diff "$SAL/acl_prod.txt" "$SAL/acl_copia_0.txt" | grep -c '^[<>]')"
  [ "$N" = 0 ] && res copia_mismos_permisos_que_produccion OK || res copia_mismos_permisos_que_produccion FALLA "$N diferencias: $(diff "$SAL/acl_prod.txt" "$SAL/acl_copia_0.txt" | grep '^[<>]' | head -6 | tr '\n' ' ')"
fi
HD0="$(hdatos)"; HF0="$(hfin)"; echo "INFO|huella_datos_inicial|$HD0 · $HF0"

# ── 2. ANTES de la corrección: matriz SQL, REST y pruebas existentes ──
fase() {  # $1 = antes|despues
  q -v fase="$1" -v adm="$ADM" -v usr="$USR" -f "$D/matriz.sql" > "$SAL/matriz_$1.txt" 2> "$SAL/matriz_$1.err" \
    && echo "INFO|matriz_$1|$(grep -c '^M|' "$SAL/matriz_$1.txt") pruebas" || res "matriz_$1" FALLA "$(head -3 "$SAL/matriz_$1.err" | tr '\n' ' ')"
  # Cuentas de prueba para REST (se borran al terminar; no existen en producción)
  q -c "insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, created_at) values
          ('5e9a0000-0000-4000-8000-000000000011', 'nueva.rest@seguridad.invalid', now(), '{}', now()),
          ('5e9a0000-0000-4000-8000-000000000012', 'sinperfil.rest@seguridad.invalid', now(), '{}', now()),
          ('5e9a0000-0000-4000-8000-000000000013', 'respaldo.rest@seguridad.invalid', now(), '{\"bfk_tipo\":\"respaldo_documental\"}', now());" > /dev/null
  echo "INFO|rest_$1|cuenta nueva recibe perfil: $(q -c "select coalesce((select rol from public.perfiles where id = '5e9a0000-0000-4000-8000-000000000011'), 'NO')")"
  q -c "alter table public.perfiles disable trigger user; delete from public.perfiles where id in ('5e9a0000-0000-4000-8000-000000000012', '5e9a0000-0000-4000-8000-000000000013'); alter table public.perfiles enable trigger user;" > /dev/null
  q -f "$D/muestras_rest.sql" -q | grep '^\[' > "$SAL/muestras.json"
  FASE="$1" MUESTRAS="$SAL/muestras.json" ADM="$ADM" USR="$USR" NUEVA=5e9a0000-0000-4000-8000-000000000011 SINPERFIL=5e9a0000-0000-4000-8000-000000000012 \
    RESPALDO=5e9a0000-0000-4000-8000-000000000013 node "$D/rest.mjs" > "$SAL/rest_$1.txt" 2> "$SAL/rest_$1.err" \
    && echo "INFO|rest_$1|$(grep -c '^R|' "$SAL/rest_$1.txt") pruebas por la API REST" || res "rest_$1" FALLA "$(head -3 "$SAL/rest_$1.err" | tr '\n' ' ')"
  rm -f "$SAL/muestras.json"
  q -c "alter table public.perfiles disable trigger user; delete from public.perfiles where id::text like '5e9a0000-%'; alter table public.perfiles enable trigger user;
        delete from auth.users where id::text like '5e9a0000-%';" > /dev/null
  # Pruebas existentes (todas con ROLLBACK): FIFO/financiamiento 4B, tributario SII/IVA/F29, vendedor-financiador,
  # comisiones (capitalización), correos MP, guardas de exentas.
  for s in financiero sii vendfin capitalizacion correos; do
    (cd "$VENTAS/docs/migraciones/pruebas/$s" && { echo "begin;"; echo "\\i pruebas.sql"; echo "rollback;"; } | psql "$DB" -X -At 2>&1) > "$SAL/suite_${s}_$1.txt"
    echo "INFO|suite_${s}_$1|$(grep -c 'NOTICE:  RESULT|' "$SAL/suite_${s}_$1.txt") OK · $(grep -c 'FALLA|' "$SAL/suite_${s}_$1.txt") FALLA · $(grep -c '^ERROR' "$SAL/suite_${s}_$1.txt") ERROR"
  done
  (cd "$VENTAS/docs/migraciones/pruebas/exentas" && psql "$DB" -X -At -f fase3_guardas.sql 2>&1) > "$SAL/suite_exentas_$1.txt"
  echo "INFO|suite_exentas_$1|$(grep -c '|true$' "$SAL/suite_exentas_$1.txt") OK · $(grep -c '|false$' "$SAL/suite_exentas_$1.txt") FALLA · $(grep -c '^ERROR' "$SAL/suite_exentas_$1.txt") ERROR"
}
fase antes
H="$(hdatos)"; [ "$H" = "$HD0" ] && res antes_pruebas_sin_rastro OK || res antes_pruebas_sin_rastro FALLA "$H"

# ── 3. Instalar la corrección (generada del catálogo de producción y de las políticas de esta copia) ──
q -c "select json_agg(json_build_object('t', tablename, 'p', policyname, 'cmd', cmd, 'roles', roles, 'q', qual, 'c', with_check) order by tablename, policyname) from pg_policies where schemaname = 'public'" > "$SAL/politicas.json"
python3 "$D/generar.py" "$D/../catalogo/public_esquema.sql" "$SAL/politicas.json" "$D/../catalogo/tablas.tsv" "$HC0" "$SAL/migracion.sql" "$SAL/deshacer.sql" | sed 's/^/INFO|generada|/'
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$SAL/migracion.sql" > "$SAL/mig.out" 2> "$SAL/mig.err" && res migracion_instalada OK || res migracion_instalada FALLA "$(head -3 "$SAL/mig.err" | tr '\n' ' ')"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$SAL/migracion.sql" > /dev/null 2> "$SAL/mig2.err"; grep -q "ya estaba aplicada" "$SAL/mig2.err" && res migracion_no_se_aplica_dos_veces OK || res migracion_no_se_aplica_dos_veces FALLA "$(head -2 "$SAL/mig2.err" | tr '\n' ' ')"
H="$(hdatos)"; HF="$(hfin)"; [ "$H" = "$HD0" ] && [ "$HF" = "$HF0" ] && res huella_datos_identica_tras_instalar OK || res huella_datos_identica_tras_instalar FALLA "$H $HF"

# ── 4. DESPUÉS de la corrección ──
fase despues
H="$(hdatos)"; HF="$(hfin)"; [ "$H" = "$HD0" ] && [ "$HF" = "$HF0" ] && res huella_datos_identica_tras_todas_las_pruebas OK || res huella_datos_identica_tras_todas_las_pruebas FALLA "$H $HF"
python3 "$D/comparar.py" "$SAL/matriz_antes.txt" "$SAL/matriz_despues.txt" "$SAL/rest_antes.txt" "$SAL/rest_despues.txt" > "$SAL/comparar.txt"; cat "$SAL/comparar.txt"
F=$((F + $(grep -c '^FALLA|' "$SAL/comparar.txt")))
for s in financiero sii vendfin capitalizacion correos exentas; do
  OKA="$(grep -cE 'NOTICE:  RESULT\||\|true$' "$SAL/suite_${s}_antes.txt")"; OKD="$(grep -cE 'NOTICE:  RESULT\||\|true$' "$SAL/suite_${s}_despues.txt")"
  FD="$(grep -cE 'FALLA\||\|false$|^ERROR' "$SAL/suite_${s}_despues.txt")"; FA="$(grep -cE 'FALLA\||\|false$|^ERROR' "$SAL/suite_${s}_antes.txt")"
  [ "$OKD" -ge "$OKA" ] && [ "$FD" -le "$FA" ] && [ "$OKD" -gt 0 ] && res "suite_${s}_igual_o_mejor_despues ($OKD OK, $FD fallas; antes $OKA OK, $FA fallas)" OK \
    || res "suite_${s}_igual_o_mejor_despues" FALLA "antes $OKA OK/$FA fallas · después $OKD OK/$FD fallas · $(grep -hE 'FALLA\||\|false$|^ERROR' "$SAL/suite_${s}_despues.txt" | head -3 | cut -c1-200 | tr '\n' ' ')"
done

# ── 5. Storage: lo prueba la matriz SQL (storage.objects / storage.buckets con el rol y JWT de cada cuenta) ──
grep -E '^M\|despues\|(anon|sinperfil|respaldo|nueva)\|storage\.objects\|' "$SAL/matriz_despues.txt" | cut -d'|' -f3,5,6 | tr '\n' ' ' | sed 's/^/INFO|storage_cuentas_restringidas|/'; echo
grep -E '^M\|(antes|despues)\|(usuario|admin)\|storage\.objects\|select' "$SAL/matriz_antes.txt" "$SAL/matriz_despues.txt" -h | cut -d'|' -f2,3,6 | tr '\n' ' ' | sed 's/^/INFO|storage_usuarios_bfk|/'; echo

# ── 6. Reversión: catálogo, permisos y datos vuelven exactamente al estado inicial ──
q -c "insert into auth.users (id, email, created_at) values ('5e9a0000-0000-4000-8000-000000000021', 'autorizada.prueba@seguridad.invalid', now());" > /dev/null
q -c "select set_config('request.jwt.claims', json_build_object('sub', '$ADM', 'role', 'authenticated')::text, false); set role authenticated; select public.bfk_autorizar_cuenta('5e9a0000-0000-4000-8000-000000000021', 'Autorizada de prueba', 'usuario');" > /dev/null 2> "$SAL/aut.err" \
  && res admin_autoriza_por_rpc_con_commit OK || res admin_autoriza_por_rpc_con_commit FALLA "$(head -2 "$SAL/aut.err" | tr '\n' ' ')"
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$SAL/deshacer.sql" > /dev/null 2> "$SAL/des1.err"; grep -q REVERSION_DETENIDA "$SAL/des1.err" && res deshacer_se_detiene_si_hay_autorizaciones OK || res deshacer_se_detiene_si_hay_autorizaciones FALLA "$(head -2 "$SAL/des1.err" | tr '\n' ' ')"
PGOPTIONS="-c bfk.seg_descartar_registro=si" psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$SAL/deshacer.sql" > /dev/null 2> "$SAL/des2.err" && res deshacer_aplicado OK || res deshacer_aplicado FALLA "$(head -3 "$SAL/des2.err" | tr '\n' ' ')"
q -c "delete from public.perfiles where id = '5e9a0000-0000-4000-8000-000000000021'; delete from auth.users where id = '5e9a0000-0000-4000-8000-000000000021';" > /dev/null
[ "$(hcat)" = "$HC0" ] && res deshacer_catalogo_identico_al_original OK || res deshacer_catalogo_identico_al_original FALLA "$(hcat)"
q -f "$D/acl_catalogo.sql" > "$SAL/acl_copia_1.txt"; N="$(diff "$SAL/acl_copia_0.txt" "$SAL/acl_copia_1.txt" | grep -c '^[<>]')"
[ "$N" = 0 ] && res deshacer_permisos_identicos_al_original OK || res deshacer_permisos_identicos_al_original FALLA "$N: $(diff "$SAL/acl_copia_0.txt" "$SAL/acl_copia_1.txt" | grep '^[<>]' | head -5 | tr '\n' ' ')"
H="$(hdatos)"; HF="$(hfin)"; [ "$H" = "$HD0" ] && [ "$HF" = "$HF0" ] && res deshacer_huella_datos_identica OK || res deshacer_huella_datos_identica FALLA "$H $HF"
# Y se puede volver a instalar después de deshacer (ciclo completo)
psql "$DB" -X -q -v ON_ERROR_STOP=1 -f "$SAL/migracion.sql" > /dev/null 2> "$SAL/mig3.err" && res reinstalar_tras_deshacer OK || res reinstalar_tras_deshacer FALLA "$(head -2 "$SAL/mig3.err" | tr '\n' ' ')"
echo "INFO|resumen|fallas=$F"
[ "$F" = 0 ]
