\ir ../_usuario.sql
select id as p from public.contactos_institucionales where correo_clave = 'bruno.soto@otro-alfa.cl' \gset
select public.resolver_contacto_pendiente(:'p'::uuid, 'reemplaza');
select 'CI|n05|usuario no confirma reemplazos|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador%')::text;
