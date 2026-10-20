\ir ../_admin.sql
select (select id from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'bruno@muni-alfa.cl') as a, (select id from public.contactos_institucionales where rut_clave = '991113339' and correo_clave = 'bruno@muni-alfa.cl') as b \gset
select public.fusionar_contactos(:'a'::uuid, :'b'::uuid);
select 'CI|n10|no se fusionan contactos de instituciones distintas|' || (:'LAST_ERROR_MESSAGE' like '%misma institución%')::text;
