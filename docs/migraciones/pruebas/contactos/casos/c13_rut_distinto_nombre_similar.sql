-- 8. Instituciones con nombres similares y RUT distintos: nunca se mezclan
\ir ../_usuario.sql
select count(*) as na from public.contactos_institucionales where rut_clave = '991112227' \gset
select public.conciliar_contactos_oc('ci_t_10', 'mp')->'resultados'->0->>'accion' as a \gset
select public.guardar_contacto_institucional(null, '99.111.333-9', '{"nombre":"Bruno Soto","correo":"bruno@muni-alfa.cl"}'::jsonb)->>'ok' as ok \gset
select 'CI|c13a|«Alfa.» con otro RUT crea sus propios contactos|' || (:'a' = 'nuevo' and :'ok' = 'true' and (select count(*) from public.contactos_institucionales where rut_clave = '991113339') = 2)::text;
select 'CI|c13b|la institución A no cambia (ni revive su correo obsoleto)|' || ((select count(*) from public.contactos_institucionales where rut_clave = '991112227') = :na and exists(select 1 from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.perez@muni-alfa.cl' and estado = 'obsoleto'))::text;
