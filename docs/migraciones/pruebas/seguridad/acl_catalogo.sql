-- Solo lectura: todos los permisos de public (tablas, funciones, privilegios por defecto) para comparar antes/después.
select 'r|' || c.relname || '|' || coalesce(array_to_string(array(select x from unnest(c.relacl) x order by x::text collate "C"), ' '), '')
  from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','v','m','p','S')
union all
select 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || coalesce(array_to_string(array(select x::text from unnest(p.proacl) x order by 1 collate "C"), ' '), '')
  from pg_proc p where p.pronamespace = 'public'::regnamespace
union all
select 'd|' || pg_get_userbyid(d.defaclrole) || '|' || d.defaclobjtype::text || '|' || array_to_string(array(select x::text from unnest(d.defaclacl) x order by 1 collate "C"), ' ')
  from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace
order by 1 collate "C";
