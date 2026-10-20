-- Una sola huella (md5) de TODO lo existente: datos de public, auth y storage; columnas; restricciones; políticas;
-- funciones; permisos y disparadores. Excluye SOLO lo nuevo de la migración de clasificación tributaria:
-- tabla trib_clasificaciones, columnas *_iva/tratamiento_*/clasificacion_id nuevas, objetos trib_*, depósito trib-respaldos
-- y cz_guardar_cotizacion_v2 (reemplazada a propósito: se verifica aparte por su huella esperada). Uso: \set pfx pre_ ; \i
select md5(string_agg(l, E'\n' order by l)) as huella from (
  select 'T|' || table_schema || '.' || table_name || '|' ||
    (xpath('/row/h/text()', query_to_xml(format(
      'select md5(coalesce(string_agg((to_jsonb(t) - %L::text[])::text, E''\n'' order by ((to_jsonb(t) - %L::text[])::text) collate "C"), '''')) as h from %I.%I t %s',
      '{tratamiento_iva,fundamento_iva,respaldo_iva,tratamiento_aprobado_por,tratamiento_aprobado_en,clasificacion_id}',
      '{tratamiento_iva,fundamento_iva,respaldo_iva,tratamiento_aprobado_por,tratamiento_aprobado_en,clasificacion_id}',
      table_schema, table_name, case when table_schema = 'storage' and table_name = 'buckets' then 'where id <> ''trib-respaldos''' else '' end), false, true, '')))[1]::text as l
  from information_schema.tables
  where (table_schema in ('public', 'auth') or (table_schema = 'storage' and table_name in ('buckets', 'objects'))) and table_type = 'BASE TABLE' and table_name <> 'trib_clasificaciones'
  union all select 'K|' || string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable, ',' order by table_schema, table_name, column_name)
    from information_schema.columns where (table_schema in ('public', 'auth') or (table_schema = 'storage' and table_name in ('buckets', 'objects'))) and table_name <> 'trib_clasificaciones'
     and not (table_name in ('cotizaciones', 'ordenes_compra_v2') and column_name in ('tratamiento_iva','fundamento_iva','respaldo_iva','tratamiento_aprobado_por','tratamiento_aprobado_en','clasificacion_id'))
  union all select 'C|' || string_agg(conrelid::regclass::text||conname||pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)
    from pg_constraint where connamespace in ('public'::regnamespace) and conrelid <> coalesce(to_regclass('public.trib_clasificaciones'), 0)
     and conname not in ('cotizaciones_tratamiento_iva_chk', 'ordenes_tratamiento_iva_chk')
  union all select 'I|' || string_agg(indexrelid::regclass::text || pg_get_indexdef(indexrelid), ',' order by indexrelid::regclass::text)
    from pg_index where indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) and indrelid <> coalesce(to_regclass('public.trib_clasificaciones'), 0)
  union all select 'P|' || string_agg(schemaname||tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,'')||roles::text, ',' order by schemaname, tablename, policyname)
    from pg_policies where policyname not like 'trib\_%'
  union all select 'F|' || string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like 'trib\_%' and p.proname not like 'trib3\_%' and p.proname <> 'cz_guardar_cotizacion_v2' and p.prokind = 'f'
  union all select 'G|' || string_agg(grantee||table_schema||table_name||privilege_type, ',' order by grantee, table_schema, table_name, privilege_type)
    from information_schema.role_table_grants where table_schema in ('public', 'storage') and table_name <> 'trib_clasificaciones'
  union all select 'R|' || coalesce(string_agg(tgrelid::regclass::text || tgname || md5(pg_get_triggerdef(oid)), ',' order by 1), '') from pg_trigger where not tgisinternal and tgname not like 'trib\_%'
) x
\gset :pfx
