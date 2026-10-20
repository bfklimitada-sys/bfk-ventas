\ir ../_usuario.sql
select id as b from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'bruno@muni-alfa.cl' \gset
select public.guardar_contacto_institucional(:'b'::uuid, null, '{"telefono":"000"}'::jsonb)->>'propuesta' as p \gset
\ir ../_admin.sql
select public.resolver_propuesta_contacto(:'b'::uuid, false)->>'aprobada' as a \gset
select 'CI|n04|administrador rechaza: nada cambia y la propuesta se limpia|' || (:'p' = 'true' and :'a' = 'false' and exists(select 1 from public.contactos_institucionales where id = :'b'::uuid and telefono = '+56 2 2222 2222' and propuesta is null))::text;
