-- Solo lectura: catálogo de seguridad (sin datos de negocio).
\pset format unaligned
\pset fieldsep '\t'
\pset tuples_only on
\o catalogo/tablas.tsv
select n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity, coalesce(array_to_string(c.relacl, ' '),'(default)'),
       coalesce((select string_agg(o,',') from unnest(c.reloptions) o),'')
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','storage','auth') and c.relkind in ('r','v','m','p','f') order by 1,2;
\o catalogo/politicas.tsv
select schemaname, tablename, policyname, permissive, array_to_string(roles,','), cmd, coalesce(qual,''), coalesce(with_check,'')
from pg_policies where schemaname in ('public','storage') order by 1,2,3;
\o catalogo/funciones.tsv
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid), p.prosecdef, coalesce(array_to_string(p.proacl,' '),'(default)'),
       coalesce(array_to_string(p.proconfig,' '),''), p.provolatile, pg_get_function_result(p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','storage') or (n.nspname='auth' and p.proname not like 'pg_%') order by 1,2,3;
\o catalogo/disparadores.tsv
select n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where not t.tgisinternal and n.nspname in ('public','auth','storage') order by 1,2,3;
\o catalogo/default_acl.tsv
select r.rolname, coalesce(n.nspname,'(global)'), d.defaclobjtype, array_to_string(d.defaclacl,' ') from pg_default_acl d join pg_roles r on r.oid=d.defaclrole left join pg_namespace n on n.oid=d.defaclnamespace order by 1,2,3;
\o catalogo/roles.tsv
select rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit from pg_roles where rolname !~ '^pg_' order by 1;
\o catalogo/esquemas.tsv
select nspname, coalesce(array_to_string(nspacl,' '),'(default)') from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' order by 1;
\o catalogo/columnas_perfiles.tsv
select column_name, data_type, coalesce(column_default,''), is_nullable from information_schema.columns where table_schema='public' and table_name='perfiles' order by ordinal_position;
\o catalogo/vistas.tsv
select n.nspname, c.relname, pg_get_viewdef(c.oid, true) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m') and n.nspname in ('public','storage') order by 1,2;
\o catalogo/columna_acl.tsv
select table_schema, table_name, column_name, grantee, privilege_type from information_schema.column_privileges
where table_schema='public' and grantee in ('anon','authenticated') and (table_schema, table_name) not in (select table_schema, table_name from information_schema.table_privileges tp where tp.grantee=column_privileges.grantee and tp.privilege_type=column_privileges.privilege_type) order by 1,2,3,4;
\o
