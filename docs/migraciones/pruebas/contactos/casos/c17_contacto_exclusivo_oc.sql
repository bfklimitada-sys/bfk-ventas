-- 5. Contacto exclusivo de una OC
\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"Felipe Díaz","correo":"felipe@muni-alfa.cl","alcance":"oc"}'::jsonb, 'ci_t_03')->>'ok' as ok \gset
select 'CI|c17a|contacto exclusivo de la OC, sin pasar a toda la institución|' || exists(select 1 from public.contactos_institucionales where correo_clave = 'felipe@muni-alfa.cl' and alcance = 'oc' and oc_exclusiva = 'ci_t_03' and not es_principal)::text;
