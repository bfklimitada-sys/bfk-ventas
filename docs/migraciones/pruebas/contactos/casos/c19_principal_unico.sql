-- 4b. Contacto principal: uno por institución
\ir ../_usuario.sql
\ir ../_ids.sql
select public.guardar_contacto_institucional(nullif(:'bruno','')::uuid, null, '{"es_principal":true}'::jsonb)->>'ok' as o1 \gset
select public.guardar_contacto_institucional(nullif(:'carla','')::uuid, null, '{"es_principal":true}'::jsonb)->>'ok' as o2 \gset
select 'CI|c19a|un solo principal por institución (el último elegido)|' || ((select count(*) from public.contactos_institucionales where rut_clave = '991112227' and es_principal) = 1 and exists(select 1 from public.contactos_institucionales where id = nullif(:'carla','')::uuid and es_principal))::text;
