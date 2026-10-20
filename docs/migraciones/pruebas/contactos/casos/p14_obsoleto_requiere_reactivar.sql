\ir ../_usuario.sql
select id as o from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.perez@muni-alfa.cl' \gset
select public.guardar_contacto_institucional(:'o'::uuid, null, '{"telefono":"1"}'::jsonb);
select 'CI|p14|un obsoleto no se edita sin reactivarlo explícitamente|' || (:'LAST_ERROR_MESSAGE' like '%reactívalo%')::text;
