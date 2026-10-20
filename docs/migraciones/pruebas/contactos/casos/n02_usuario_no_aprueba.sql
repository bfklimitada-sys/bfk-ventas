\ir ../_usuario.sql
select id as d from public.contactos_institucionales where rut_clave = '991112227' and nombre = 'Diego Mora' \gset
select public.resolver_propuesta_contacto(:'d'::uuid, true);
select 'CI|n02|usuario no puede aprobar propuestas|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador%')::text;
