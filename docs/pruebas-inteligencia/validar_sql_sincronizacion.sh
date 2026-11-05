#!/bin/bash
# Inteligencia Comercial — corrección de la sincronización y criterio de fecha (05/11/2026). Valida la migración
# BORRADOR-2026-11-05-inteligencia-sincronizacion.sql en un PostgreSQL LOCAL y DESECHABLE (nunca en Supabase), instalada
# SOBRE el módulo del 04/11/2026 con resultados ya guardados (incluidas filas «heredadas» con la espera antigua).
# Comprueba: instalación atómica, que NINGUNA fila cambie al instalar (tampoco en ic_), permisos, prioridad de la cola,
# esperas nuevas, estado de la cola, ausencia de duplicados, SQL = JavaScript con ambos criterios de fecha
# (sql_vs_js.mjs en modo v2), integridad financiera, rendimiento y reversión exacta a las funciones del 04/11.
# El entorno (roles, auth.uid(), perfiles, seguridad BFK, Cotizaciones real, tablas financieras de muestra y semilla) es
# el MISMO de validar_sql.sh: se toma de ese archivo para no duplicarlo.
# Uso: bash docs/pruebas-inteligencia/validar_sql_sincronizacion.sh
set -u
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migraciones"; IC="$MIG/BORRADOR-2026-11-04-inteligencia-comercial.sql"; ICD="$MIG/BORRADOR-2026-11-04-inteligencia-comercial-deshacer.sql"
IC2="$MIG/BORRADOR-2026-11-05-inteligencia-sincronizacion.sql"; IC2D="$MIG/BORRADOR-2026-11-05-inteligencia-sincronizacion-deshacer.sql"
export PGTZ=UTC
eval "$(sed -n '/^PGBIN=/,/^H0=/p' "$AQUI/validar_sql.sh" | sed '$d' | sed 's/PORT=55447/PORT=55449/')"
H0=$(Q -c "$HUELLA"); K0=$(Q -c "$CATALOGO")
# Huella de TODAS las tablas (incluidas las ic_): instalar la corrección no debe cambiar ni una fila.
TODO="select md5(string_agg(t || ':' || h, ',' order by t)) from (select table_name t, (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, E''\n'' order by (x::text) collate \"C\"), '''')) as h from public.%I x', table_name), false, true, '')))[1]::text h
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE') z"
FN_IC="select string_agg(p.oid::regprocedure::text || '=' || md5(pg_get_functiondef(p.oid)) || '/' || coalesce(array_to_string(p.proacl, ','), ''), ' ' order by p.oid::regprocedure::text) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname ~ '^ic_'"
REG() { COMO $ADM "select public.ic_registrar_resultado('$1');" >/dev/null; }
seg() { Q -c "select round(extract(epoch from proximo_intento - now()))::int from public.ic_resultados where codigo = '$1'"; }

# ── Módulo del 04/11 instalado con resultados (como producción) ──
Q -1 -f "$IC" > "$D/i.log" 2>&1; ok "B01_modulo_04_11_instalado" "$?" 0
node "$AQUI/semilla_sql.mjs" --resultados > "$D/res.sql"
R=$(while IFS= read -r l; do COMO $ADM "$l"; done < "$D/res.sql" | grep -c '"consulta_estado": "ok"'); ok "B02_resultados_registrados" "$R" "$(wc -l < "$D/res.sql")"
# Filas «heredadas» con la regla ANTIGUA (función del 04/11): 1001-8 por verificar (detalle 504), 1001-12 por verificar
# «sin tiempo en esta llamada» y 1001-4 con el listado caído.
REG '{"codigo":"1001-12-COT26","estado_proceso":"proveedor_seleccionado","resultado":"sin_informacion","detalle_consultado":false,"consulta_error":"Detalle no disponible: sin tiempo en esta llamada","fuente":"API Compra Ágil v2 (ChileCompra) · listado"}'
REG '{"codigo":"1001-4-COT26","consulta_estado":"error","consulta_error":"Sin respuesta (demora)","fuente":"x"}'
# Simula que pasaron 10 minutos desde esas consultas (solo en esta base desechable): la regla antigua aún las haría esperar.
Q -c "update public.ic_resultados set consultado_en = consultado_en - interval '10 minutes' where codigo in ('1001-8-COT26','1001-12-COT26','1001-4-COT26')" >/dev/null
ok "B03_regla_antigua_aun_no_las_ofrece" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100) where codigo in ('1001-8-COT26','1001-12-COT26','1001-4-COT26');")" 0
FN0=$(Q -c "$FN_IC"); T0=$(Q -c "$TODO")

# ── Instalación de la corrección ──
Q -1 -f "$IC2" > "$D/i2.log" 2>&1; ok "M01_instala_en_una_transaccion" "$?" 0; [ -s "$D/i2.log" ] && grep -i error "$D/i2.log" | head -3
ok "M02_segunda_instalacion_rechazada" "$(Q -1 -f "$IC2" 2>&1 | grep -c 'ya está instalada')" 1
ok "M03_ninguna_fila_cambio_al_instalar_incluidas_ic" "$(Q -c "$TODO")" "$T0"
ok "M04_nada_fuera_del_modulo_cambio" "$(Q -c "$HUELLA")|$(Q -c "$CATALOGO")" "$H0|$K0"
ok "M05_resumen_y_detalle_originales_intactos" "$(Q -c "$FN_IC" | tr ' ' '\n' | grep -E '^ic_(resumen|detalle)\(' | tr '\n' ' ')" "$(echo "$FN0" | tr ' ' '\n' | grep -E '^ic_(resumen|detalle)\(' | tr '\n' ' ')"
ok "M06_funciones_nuevas" "$(Q -c "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('ic_proxima_consulta','ic_estado_sincronizacion','ic_resumen_v2','ic_detalle_v2')")" 4
ok "M07_sin_tablas_vistas_ni_indices_nuevos" "$(Q -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname ~ '^ic_'")" "$(Q -c "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname ~ '^ic_' and oid < (select min(oid) from pg_proc where proname = 'ic_proxima_consulta')")"
# Misma guardia que usa la publicación: sin DROP/TRUNCATE/DELETE ni control de transacción (los UPDATE solo dentro de
# ic_registrar_resultado, igual que en la función original).
ok "M08_sin_drop_truncate_delete_ni_control_de_transaccion" "$(grep -c -i -E '^\s*(drop|truncate|delete)\b|\b(drop|truncate)\s+(table|view|function|schema|index|policy|trigger|type)\b|^\s*(begin|commit|rollback|end)\s*;' "$IC2")" 0
ok "M09_unico_update_es_el_de_la_funcion_original" "$(grep -c -i -E '^\s*update\b' "$IC2")|$(grep -c -i -E '^\s*update\b' "$IC")" "1|1"

# ── Permisos ──
ok "P01_anonimo_no_ejecuta_resumen_v2" "$(ROL=anon COMO "" "select public.ic_resumen_v2();" | codigo_err)" "permission denied"
ok "P02_anonimo_no_ejecuta_detalle_v2" "$(ROL=anon COMO "" "select public.ic_detalle_v2();" | codigo_err)" "permission denied"
ok "P03_anonimo_no_ejecuta_estado" "$(ROL=anon COMO "" "select public.ic_estado_sincronizacion();" | codigo_err)" "permission denied"
ok "P04_sin_perfil_resumen_v2_rechazado" "$(COMO $SINP "select public.ic_resumen_v2();" | codigo_err)" IC403
ok "P05_usuario_lee_resumen_v2_y_detalle_v2" "$(COMO $USR "select ((public.ic_resumen_v2())->'indicadores'->>'presentadas')::int > 0 and ((public.ic_detalle_v2())->>'total')::int > 0;")" t
ok "P06_usuario_no_ve_estado_de_la_cola" "$(COMO $USR "select public.ic_estado_sincronizacion();" | codigo_err)" IC403
ok "P07_regla_interna_no_ejecutable_por_la_app" "$(COMO $ADM "select public.ic_proxima_consulta(r) from public.ic_resultados r limit 1;" | codigo_err)" "permission denied"
ok "P08_usuario_sigue_sin_registrar" "$(COMO $USR "select public.ic_registrar_resultado('{\"codigo\":\"1001-3-COT26\",\"fuente\":\"x\"}');" | codigo_err)" IC403

# ── Cola: prioridad y reintento oportuno de las filas heredadas ──
ok "C01_por_verificar_primero" "$(COMO $ADM "select string_agg(codigo, ',') from public.ic_pendientes_sincronizar(2);")" "1001-8-COT26,1001-12-COT26"
ok "C02_heredadas_disponibles_con_espera_nueva" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100) where codigo in ('1001-8-COT26','1001-12-COT26','1001-4-COT26');")" 3
ok "C03_orden_completo_por_verificar_nunca_consultados_por_fecha_resto" "$(COMO $ADM "select string_agg(codigo, ',') from public.ic_pendientes_sincronizar(100);")" "1001-8-COT26,1001-12-COT26,1001-17-COT26,1001-19-COT26,1001-4-COT26"
ok "C04_finales_no_se_repiten" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100) p join public.ic_resultados r using (codigo) where r.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk');")" 0
ok "C05_sin_duplicados_en_la_cola" "$(COMO $ADM "select count(*) = count(distinct codigo) from public.ic_pendientes_sincronizar(100, true);")" t
ok "C06_forzar_incluye_todos" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100, true);")" 16
ok "C07_limite_respetado" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(2);")" 2

# ── Esperas nuevas al registrar ──
I12=$(Q -c "select intentos from public.ic_resultados where codigo='1001-12-COT26'")
REG '{"codigo":"1001-12-COT26","estado_proceso":"proveedor_seleccionado","resultado":"sin_informacion","detalle_consultado":false,"reintento_detalle":"sin_tiempo","consulta_error":"Detalle no disponible: sin tiempo en esta llamada","fuente":"x"}'
ok "E01_sin_tiempo_de_inmediato_sin_contar_intento" "$(seg 1001-12-COT26)|$(Q -c "select intentos from public.ic_resultados where codigo='1001-12-COT26'")" "0|$I12"
I0=$(Q -c "select intentos from public.ic_resultados where codigo='1001-8-COT26'")
REG '{"codigo":"1001-8-COT26","estado_proceso":"proveedor_seleccionado","resultado":"sin_informacion","detalle_consultado":false,"reintento_detalle":"limite","consulta_error":"Detalle no disponible: HTTP 429","fuente":"x"}'; S1=$(seg 1001-8-COT26)
REG '{"codigo":"1001-8-COT26","estado_proceso":"proveedor_seleccionado","resultado":"sin_informacion","detalle_consultado":false,"reintento_detalle":"demora","consulta_error":"Detalle no disponible: sin respuesta (demora)","fuente":"x"}'; S2=$(seg 1001-8-COT26)
ok "E02_detalle_429_o_demora_minutos_crecientes (intentos previos $I0: $S1 s → $S2 s)" "$([ "$S1" = $((60 * 2 ** I0)) ] && [ "$S2" = $((60 * 2 ** (I0 + 1))) ] && echo si)" si
for i in 1 2 3 4 5 6 7 8 9; do REG '{"codigo":"1001-8-COT26","estado_proceso":"proveedor_seleccionado","resultado":"sin_informacion","detalle_consultado":false,"reintento_detalle":"demora","fuente":"x"}'; done
ok "E03_detalle_espera_maxima_1_hora" "$(seg 1001-8-COT26)" 3600
REG '{"codigo":"1001-3-COT26","consulta_estado":"error","consulta_error":"HTTP 504","fuente":"x"}'; A=$(seg 1001-3-COT26)
REG '{"codigo":"1001-3-COT26","consulta_estado":"error","consulta_error":"HTTP 504","fuente":"x"}'; B=$(seg 1001-3-COT26)
ok "E04_listado_con_error_2_y_4_min" "$A|$B" "120|240"
for i in 1 2 3 4 5 6 7 8 9; do REG '{"codigo":"1001-3-COT26","consulta_estado":"error","fuente":"x"}'; done
ok "E05_listado_con_error_maximo_4_h" "$(seg 1001-3-COT26)" 14400
ok "E06_error_conserva_lo_verificado" "$(Q -c "select resultado from public.ic_resultados where codigo='1001-3-COT26'")" pendiente
REG '{"codigo":"1001-6-COT26","consulta_estado":"limite","fuente":"x"}'
ok "E07_final_no_se_reprograma_por_un_429" "$(Q -c "select resultado || '|' || coalesce(proximo_intento::text, 'null') from public.ic_resultados where codigo='1001-6-COT26'")" "cancelada|null"
REG '{"codigo":"1001-17-COT26","consulta_estado":"limite","fuente":"x"}'
ok "E08_listado_429_un_minuto" "$(seg 1001-17-COT26)" 60
REG '{"codigo":"1001-17-COT26","consulta_estado":"no_encontrada","fuente":"x"}'
ok "E09_no_encontrada_como_antes_30_min" "$(seg 1001-17-COT26)" 1800
REG '{"codigo":"1001-4-COT26","estado_proceso":"cerrada","resultado":"pendiente","fuente":"x"}'
ok "E10_pendiente_6_horas_y_reinicia_intentos" "$(seg 1001-4-COT26)|$(Q -c "select intentos from public.ic_resultados where codigo='1001-4-COT26'")" "21600|0"
REG '{"codigo":"1001-12-COT26","estado_proceso":"proveedor_seleccionado","resultado":"ganada","detalle_consultado":true,"bfk_oferto":true,"adjudicatario_rut":"77.322.317-3","adjudicatario_nombre":"INGENIERIA Y SERVICIOS BFK LIMITADA","monto_total":66640,"fuente":"x"}'
ok "E11_ganador_confirmado_sale_de_la_cola" "$(Q -c "select resultado || '|' || detalle_consultado || '|' || intentos || '|' || coalesce(proximo_intento::text, 'null') from public.ic_resultados where codigo='1001-12-COT26'")" "ganada|true|0|null"
ok "E12_sin_duplicados_en_resultados" "$(Q -c "select count(*) = count(distinct codigo) from public.ic_resultados")" t

# ── Estado de la cola (avance real) ──
EST=$(COMO $ADM "select public.ic_estado_sincronizacion();")
J() { echo "$EST" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print($1)"; }
ok "Q01_estado_total" "$(J "d['total']")" 16
ok "Q02_sin_consultar" "$(J "d['sin_consultar']")" 1
ok "Q03_elegibles_igual_a_la_cola" "$(J "d['elegibles_ahora']")" "$(COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(100);")"
ok "Q04_por_verificar_y_ganadas_coinciden_con_la_base" "$(J "str(d['por_verificar']) + ' ' + str(d['ganadas'])")" "$(Q -c "select count(*) filter (where resultado = 'sin_informacion' and estado_proceso in ('proveedor_seleccionado','oc_emitida')) || ' ' || count(*) filter (where resultado = 'ganada') from public.ic_resultados")"
ok "Q05_proximo_reintento_futuro" "$(J "d['proximo_reintento'] is not None")" True

# ── SQL = JavaScript (v2, ambos criterios) ──
node "$AQUI/sql_vs_js.mjs" $ADM > "$D/svj.log" 2>&1; R=$?; grep -E "^FALLA|Error|error" "$D/svj.log" | head -20; cp "$D/svj.log" /tmp/svj2.log; ok "J01_sql_igual_a_javascript_v2 ($(tail -1 "$D/svj.log"))" "$R" 0
ok "J02_modo_v2_usado" "$(grep -c 'modo v2' "$D/svj.log")" 1
ok "A01_pendientes_sin_fecha_de_adjudicacion" "$(COMO $USR "select (public.ic_resumen_v2(null,null,'','','','adjudicacion'))->'indicadores'->>'pendientes';")" 0
ok "A02_criterio_informado" "$(COMO $USR "select ((public.ic_resumen_v2(null,null,'','','','adjudicacion'))->>'criterio') || '|' || ((public.ic_resumen_v2())->>'criterio');")" "adjudicacion|presentacion"
ok "A03_perdida_presentada_en_octubre_adjudicada_en_noviembre" "$(COMO $USR "select fecha_presentacion || '|' || (fecha_resultado at time zone 'UTC')::date from public.ic_oportunidades where codigo = '1001-2-COT26';")" "2026-10-05|2026-11-02"
ok "A04_detalle_trae_fecha_adjudicacion" "$(COMO $USR "select (public.ic_detalle_v2(null,null,'','','','adjudicacion','','fecha_adjudicacion',true,1,0))->'filas'->0->>'fecha_adjudicacion' is not null;")" t

# ── Integridad: nada fuera del módulo cambió con toda la operación ──
ok "F01_financieros_y_cotizaciones_intactos" "$(Q -c "$HUELLA")" "$H0"
ok "F02_catalogo_fuera_del_modulo_intacto" "$(Q -c "$CATALOGO")" "$K0"

# ── Rendimiento: 5.000 oportunidades sintéticas ──
Q <<'SQL' >/dev/null
insert into public.cotizaciones (id, id_externo, nombre, institucion, fecha, estado, subtotal_neto, impuestos, total, vendedor_id, vendedor_nombre, actualizado_en, creado_por)
select gen_random_uuid(), '9' || g || '-1-COT26', 'Sintética ' || g, 'Institución ' || (g % 40), date '2026-10-01' + (g % 60), 'presentada', 1000 * (g % 97 + 1), 190 * (g % 97 + 1), 1190 * (g % 97 + 1),
  case when g % 2 = 0 then 'v1' else 'v2' end, case when g % 2 = 0 then 'Vendedor Uno' else 'Vendedora Dos' end, now(), '22222222-2222-2222-2222-222222222222'
from generate_series(1, 5000) g;
insert into public.cotizacion_versiones (cotizacion_id, version, contenido, guardado_por, guardado_en)
select id, 1, '{"estado":"presentada"}', '22222222-2222-2222-2222-222222222222', (fecha + time '12:00') at time zone 'America/Santiago' from public.cotizaciones where nombre like 'Sintética %';
insert into public.ic_resultados (codigo, estado_proceso, resultado, adjudicatario_rut, adjudicatario_nombre, monto_neto, monto_impuesto, monto_total, base_tributaria, fuente, detalle_consultado, verificado_en, fecha_resultado)
select upper(id_externo), 'proveedor_seleccionado', 'perdida', '76.' || (row_number() over () % 30) || '-1', 'Competidor ' || (row_number() over () % 30), subtotal_neto * 0.9, impuestos * 0.9, total * 0.9, 'afecta', 'prueba', true, now(), fecha + 3
from public.cotizaciones where nombre like 'Sintética %' and id_externo ~ '^9[0-9]*[02468]-';
analyze;
SQL
for c in presentacion adjudicacion; do
  T0=$(date +%s%N); COMO $USR "select public.ic_resumen_v2('2026-10-01','2026-11-30','','','','$c');" >/dev/null; T1=$(date +%s%N); MS=$(( (T1 - T0) / 1000000 ))
  ok "R01_resumen_v2_${c}_5000_menos_de_2_s (${MS} ms)" "$([ $MS -lt 2000 ] && echo si)" si
  T0=$(date +%s%N); COMO $USR "select public.ic_detalle_v2('2026-10-01','2026-10-31','','','','$c','','fecha_presentacion',true,15,0);" >/dev/null; T1=$(date +%s%N); MS=$(( (T1 - T0) / 1000000 ))
  ok "R02_detalle_v2_${c}_menos_de_2_s (${MS} ms)" "$([ $MS -lt 2000 ] && echo si)" si
done
T0=$(date +%s%N); COMO $ADM "select public.ic_estado_sincronizacion();" >/dev/null; COMO $ADM "select count(*) from public.ic_pendientes_sincronizar(40);" >/dev/null; T1=$(date +%s%N); MS=$(( (T1 - T0) / 1000000 ))
ok "R03_cola_y_estado_con_5000_menos_de_2_s (${MS} ms)" "$([ $MS -lt 2000 ] && echo si)" si
Q -c "delete from public.ic_resultados_historial where codigo like '9%'; delete from public.ic_resultados where codigo like '9%'; delete from public.cotizacion_versiones where cotizacion_id in (select id from public.cotizaciones where nombre like 'Sintética %'); delete from public.cotizaciones where nombre like 'Sintética %';" >/dev/null

# ── Reversión exacta y protección del orden de reversión ──
NRES1=$(Q -c "select count(*) from public.ic_resultados"); T1=$(Q -c "$TODO")
ok "D01_deshacer_del_04_11_bloqueado_mientras_exista_la_correccion" "$(Q -1 -f "$ICD" 2>&1 | grep -q -i 'depend' && echo si)" si
ok "D02_nada_cambio_tras_el_intento_bloqueado" "$(Q -c "$TODO")" "$T1"
Q -1 -f "$IC2D" > "$D/d.log" 2>&1; ok "D03_deshacer_en_una_transaccion" "$?" 0; [ -s "$D/d.log" ] && grep -i error "$D/d.log" | head -3
ok "D04_funciones_identicas_a_las_del_04_11_incluidos_permisos" "$(Q -c "$FN_IC")" "$FN0"
ok "D05_datos_conservados" "$(Q -c "select count(*) from public.ic_resultados")|$(Q -c "$TODO")" "$NRES1|$T1"
ok "D06_deshacer_dos_veces_rechazado" "$(Q -1 -f "$IC2D" 2>&1 | grep -c 'no está instalada')" 1
ok "D07_todo_lo_demas_identico" "$(Q -c "$HUELLA")|$(Q -c "$CATALOGO")" "$H0|$K0"
Q -1 -f "$IC2" > "$D/i3.log" 2>&1; ok "D08_reinstalar" "$?" 0
Q -1 -f "$IC2D" > /dev/null 2>&1 && Q -1 -f "$ICD" > /dev/null 2>&1; ok "D09_reversion_completa_en_orden" "$?" 0
ok "D10_sin_objetos_ic" "$(Q -c "select count(*) from pg_class where relname like 'ic\_%'")|$(Q -c "select count(*) from pg_proc where proname like 'ic\_%'")" "0|0"

echo "validar_sql_sincronizacion: $((N-F))/$N correctas"
[ $F -eq 0 ]
