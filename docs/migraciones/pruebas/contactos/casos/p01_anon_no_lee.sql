\set ON_ERROR_STOP 0
set role anon;
select count(*) from public.contactos_institucionales;
select 'CI|p01|anon no puede leer contactos|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
