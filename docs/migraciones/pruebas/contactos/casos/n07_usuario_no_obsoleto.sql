\ir ../_usuario.sql
select id as b from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'bruno@muni-alfa.cl' \gset
select public.marcar_contacto_obsoleto(:'b'::uuid, 'x');
select 'CI|n07|usuario no marca obsoletos|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador%' and exists(select 1 from public.contactos_institucionales where id = :'b'::uuid and estado = 'vigente'))::text;
