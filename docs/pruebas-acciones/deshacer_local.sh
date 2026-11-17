#!/usr/bin/env bash
# Deshacer y volver a aplicar (base local). Uso: bash docs/pruebas-acciones/deshacer_local.sh
set -euo pipefail
D="${ACC_DB_URL:-postgresql://postgres@/postgres?host=/tmp&port=5433}"; A=docs/pruebas-acciones; M=docs/migraciones
q() { psql "$D" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
datos() { q -c "select md5(coalesce((select string_agg(t::text, ',' order by t.id) from public.oc_seguimientos t),''))||'|'||(select count(*) from public.historial_cambios)||'|'||md5(coalesce((select string_agg(t::text, ',' order by t.id) from public.eventos_postventa t),''))"; }
# 1) Sin acciones en uso: deshacer deja la estructura EXACTAMENTE como antes
q -f $A/base-local.sql 2>/dev/null; q -c "update public.eventos_postventa set estado='resuelto' where id='pv1'"
q -f $A/catalogo.sql > /tmp/acc_c0.txt
q -f $M/2026-11-17-centro-acciones.sql 2>&1 | grep -o 'ACC_RESUMEN.*' || true
q -f $M/2026-11-17-centro-acciones-deshacer.sql 2>&1 | grep -o 'ACC-DESHACER.*' || true
q -f $A/catalogo.sql > /tmp/acc_c1.txt
diff /tmp/acc_c0.txt /tmp/acc_c1.txt > /dev/null && echo "OK    D1 deshacer sin datos en uso: estructura idéntica a la original ($(wc -l < /tmp/acc_c0.txt) líneas de catálogo)" || { echo "FALLA D1"; diff /tmp/acc_c0.txt /tmp/acc_c1.txt | head -20; exit 1; }
# 2) Con datos (la acción automática de la instalación + una sin OC + un comentario): deshacer conserva todo y se puede volver a aplicar
q -f $A/base-local.sql 2>/dev/null
q -f $M/2026-11-17-centro-acciones.sql > /dev/null 2>&1
q <<'SQL'
begin; set role authenticated; select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',false);
insert into public.oc_seguimientos(id,titulo,categoria,descripcion,cliente) values ('t_sinoc','Cotizar instalación','instalacion','Cliente pide instalación','Colegio X');
insert into public.historial_cambios(id,oc_id,usuario_id,usuario_nombre,accion,campo,valor_nuevo) values ('hc_av1',null,'22222222-2222-2222-2222-222222222222','Ana Prueba','Acción: avance','seguimiento:t_sinoc','Llamé al cliente');
commit;
SQL
D0="$(datos)"
q -f $M/2026-11-17-centro-acciones-deshacer.sql 2>&1 | grep -o 'ACC-DESHACER.*' | sed 's/^/      /'
D1="$(datos)"
[ "$D0" = "$D1" ] && echo "OK    D2 deshacer con datos: acciones, comentarios e historial conservados" || { echo "FALLA D2 $D0 != $D1"; exit 1; }
[ "$(q -c "select count(*) from pg_trigger where tgname in ('acc_historial','acc_postventa','acc_entrega')")" = 0 ] && [ -z "$(q -c "select to_regprocedure('public.acc_registrar_entrega_fallida(text,text,text)')")" ] \
  && echo "OK    D3 deshacer retira la generación automática y el historial automático" || { echo "FALLA D3"; exit 1; }
R="$(q -c "begin; set role authenticated; select set_config('request.jwt.claims','{\"sub\":\"22222222-2222-2222-2222-222222222222\",\"role\":\"authenticated\"}',false); update public.oc_seguimientos set prioridad='alta' where id='t_sinoc' returning prioridad; rollback;" 2>&1 | tail -1)"
[ "$R" = alta ] && echo "OK    D4 tras deshacer, la app anterior sigue editando acciones" || { echo "FALLA D4 $R"; exit 1; }
q -f $M/2026-11-17-centro-acciones.sql 2>&1 | grep -o 'ACC_RESUMEN.*' | sed 's/^/      /'
D2="$(datos)"
[ "$(q -c "select count(*) from pg_trigger where tgname in ('acc_historial','acc_postventa','acc_entrega')")" = 3 ] && [ "${D2%%|*}" = "${D0%%|*}" ] \
  && echo "OK    D5 volver a aplicar sobre los datos conservados: sin duplicar ni cambiar acciones" || { echo "FALLA D5 $D0 / $D2"; exit 1; }
echo "RESUMEN deshacer y volver a aplicar: OK"
