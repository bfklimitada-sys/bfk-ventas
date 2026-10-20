-- Resolver como adicional (otra casilla de la misma persona/departamento)
\ir ../_usuario.sql
select id as lic from public.contactos_institucionales where correo_clave = 'licitaciones@muni-alfa.cl' \gset
select public.resolver_contacto_pendiente(:'lic'::uuid, 'adicional')->>'ok' as ok \gset
select 'CI|c24a|pendiente confirmado como contacto adicional|' || exists(select 1 from public.contactos_institucionales where id = :'lic'::uuid and estado = 'vigente' and confirmado_manual)::text;
