-- Huella de TODO lo existente (public, auth, storage) EXCEPTO las tablas nuevas de contactos institucionales y los
-- datos de prueba (filas con 'ci_t_' o RUT 99.111.xxx). Uso: \set pfx h_ ; \i huella.sql  → :h_huella
select md5(string_agg(l, E'\n' order by l)) as huella from (
  select 'T|' || table_schema || '.' || table_name || '|' ||
    (xpath('/row/h/text()', query_to_xml(format(
      'select md5(coalesce(string_agg(t::text, E''\n'' order by t::text collate "C"), '''')) as h from %I.%I t where t::text !~ ''(ci_t_|99\.?111\.?(222|333|444)|9911122|9911133|9911144)''',
      table_schema, table_name), false, true, '')))[1]::text as l
  from information_schema.tables
  where (table_schema in ('public', 'auth') or (table_schema = 'storage' and table_name in ('buckets', 'objects'))) and table_type = 'BASE TABLE'
    and table_name not like 'contactos\_institucionales%'
  union all select 'K|' || string_agg(table_schema||'.'||table_name||'.'||column_name||':'||data_type||':'||coalesce(column_default,'')||':'||is_nullable, ',' order by table_schema, table_name, column_name)
    from information_schema.columns where table_schema in ('public', 'auth') and table_name not like 'contactos\_institucionales%'
  union all select 'P|' || string_agg(schemaname||tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,'')||roles::text, ',' order by schemaname, tablename, policyname)
    from pg_policies where tablename not like 'contactos\_institucionales%'
  union all select 'F|' || string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not like 'ci\_%' and p.proname not in ('conciliar_contactos_oc','guardar_contacto_institucional','resolver_contacto_pendiente','marcar_contacto_obsoleto','registrar_entidad_desde_oc')
  union all select 'G|' || string_agg(grantee||table_schema||table_name||privilege_type, ',' order by grantee, table_schema, table_name, privilege_type)
    from information_schema.role_table_grants where table_schema in ('public', 'storage') and table_name not like 'contactos\_institucionales%'
  union all select 'R|' || coalesce(string_agg(tgrelid::regclass::text || tgname || md5(pg_get_triggerdef(oid)), ',' order by 1), '') from pg_trigger
   where not tgisinternal and tgrelid::regclass::text not like '%contactos\_institucionales%'
) x
\gset :pfx
