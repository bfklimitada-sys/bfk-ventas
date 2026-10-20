\ir ../_usuario.sql
select id as b from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'bruno@muni-alfa.cl' \gset
select public.guardar_contacto_institucional(:'b'::uuid, '99.111.333-9', '{"nombre":"Bruno Soto"}'::jsonb);
select 'CI|p11|un contacto no puede moverse a otra institución|' || (:'LAST_ERROR_MESSAGE' like '%no puede cambiar de institución%')::text;
