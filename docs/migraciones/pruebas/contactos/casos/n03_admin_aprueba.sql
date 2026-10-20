\ir ../_admin.sql
select id as d from public.contactos_institucionales where rut_clave = '991112227' and nombre = 'Diego Mora' \gset
select public.resolver_propuesta_contacto(:'d'::uuid, true)->>'aprobada' as a \gset
select 'CI|n03a|administrador aprueba: se aplica y queda confirmado|' || (:'a' = 'true' and exists(select 1 from public.contactos_institucionales where id = :'d'::uuid and correo = 'diego.mora@muni-alfa.cl' and telefono = '22 111 9999' and confirmado_manual and propuesta is null))::text;
select 'CI|n03b|historial conserva el teléfono anterior|' || exists(select 1 from public.contactos_institucionales_historial where contacto_id = :'d'::uuid and anterior->>'telefono' = '22 111 2222' and nuevo->>'telefono' = '22 111 9999')::text;
