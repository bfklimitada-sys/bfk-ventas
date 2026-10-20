\ir ../_usuario.sql
select id as p from public.contactos_institucionales where correo_clave = 'bruno.soto@otro-alfa.cl' \gset
select public.resolver_contacto_pendiente(:'p'::uuid, 'descartar');
select 'CI|n06|usuario no descarta (obsolescencia)|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador%')::text;
