-- Huella de TODO lo existente (public, auth, storage) EXCEPTO los objetos nuevos del módulo Proyectos Industriales
-- (tablas/vistas/funciones pi_*, bfk_lineas_negocio, depósito pi-documentos y sus políticas).
-- Incluye datos, columnas, políticas, funciones, permisos y disparadores. Uso: \set pfx h_ ; \i huella.sql → :h_huella
select md5(string_agg(l, E'\n' order by l)) as huella from (
  select 'T|' || table_schema || '.' || table_name || '|' ||
    (xpath('/row/h/text()', query_to_xml(format(
      'select md5(coalesce(string_agg(t::text, E''\n'' order by t::text collate "C"), '''')) as h from %I.%I t %s',
      table_schema, table_name, case when table_schema = 'storage' then 'where t::text !~ ''pi-documentos''' else '' end), false, true, '')))[1]::text as l
  from information_schema.tables
  where (table_schema in ('public', 'auth') or (table_schema = 'storage' and table_name in ('buckets', 'objects'))) and table_type = 'BASE TABLE'
    and table_name not like 'pi\_%' and table_name <> 'bfk_lineas_negocio'
  union all select 'K|' || string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable, ',' order by table_schema, table_name, column_name)
    from information_schema.columns where table_schema in ('public', 'auth', 'storage') and table_name not like 'pi\_%' and table_name <> 'bfk_lineas_negocio'
  union all select 'P|' || string_agg(schemaname||tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,'')||roles::text, ',' order by schemaname, tablename, policyname)
    from pg_policies where tablename not like 'pi\_%' and tablename <> 'bfk_lineas_negocio' and policyname not like 'pi\_storage%'
  union all select 'F|' || string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace in ('public'::regnamespace, 'auth'::regnamespace, 'storage'::regnamespace) and p.prokind = 'f' and p.proname not like 'pi\_%'
  union all select 'G|' || string_agg(grantee||table_schema||table_name||privilege_type, ',' order by grantee, table_schema, table_name, privilege_type)
    from information_schema.role_table_grants where table_schema in ('public', 'auth', 'storage') and table_name not like 'pi\_%' and table_name <> 'bfk_lineas_negocio'
  union all select 'R|' || coalesce(string_agg(tgrelid::regclass::text || tgname || md5(pg_get_triggerdef(oid)), ',' order by tgrelid::regclass::text, tgname), '') from pg_trigger
   where not tgisinternal and tgrelid::regclass::text not like '%pi\_%'
  union all select 'C|' || coalesce(string_agg(conrelid::regclass::text || conname || md5(pg_get_constraintdef(oid)), ',' order by conrelid::regclass::text, conname), '') from pg_constraint
   where connamespace in ('public'::regnamespace, 'storage'::regnamespace) and conrelid::regclass::text not like '%pi\_%' and conrelid::regclass::text <> 'bfk_lineas_negocio'
  union all select 'X|' || coalesce(string_agg(c.relname || ':' || c.relrowsecurity || c.relforcerowsecurity, ',' order by c.relname), '') from pg_class c
   where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace) and c.relkind = 'r' and c.relname not like 'pi\_%' and c.relname <> 'bfk_lineas_negocio'
) x
\gset :pfx
