-- Usuario no administrador: su corrección queda como PROPUESTA; el contacto no cambia
\ir ../_usuario.sql
select id as d from public.contactos_institucionales where rut_clave = '991112227' and nombre = 'Diego Mora' \gset
select public.guardar_contacto_institucional(:'d'::uuid, null, '{"correo":"diego.mora@muni-alfa.cl","telefono":"22 111 9999"}'::jsonb, 'ci_t_13') as r \gset
select 'CI|n01a|usuario: la corrección queda como propuesta|' || ((:'r')::jsonb->>'propuesta' = 'true' and exists(select 1 from public.contactos_institucionales where id = :'d'::uuid and propuesta->>'correo' = 'diego.mora@muni-alfa.cl' and propuesta_por = :'usr'))::text;
select 'CI|n01b|el contacto no cambia hasta la aprobación|' || exists(select 1 from public.contactos_institucionales where id = :'d'::uuid and correo = '' and telefono = '22 111 2222')::text;
select 'CI|n01c|la propuesta queda en la bitácora|' || exists(select 1 from public.contactos_institucionales_historial where contacto_id = :'d'::uuid and accion = 'propuesta_usuario' and usuario = :'usr')::text;
