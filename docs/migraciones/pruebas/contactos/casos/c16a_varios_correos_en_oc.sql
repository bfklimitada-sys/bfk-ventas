-- OC con varios correos: el nombre va con el primero; el resto queda pendiente
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_09', 'mp') as r \gset
select 'CI|c16a|primer correo: contacto nuevo con nombre y teléfono|' || ((:'r')::jsonb->'resultados'->0->>'accion' = 'nuevo' and exists(select 1 from public.contactos_institucionales where correo_clave = 'carla@muni-alfa.cl' and nombre = 'Carla Ruiz' and telefono = '22 334 4555' and estado = 'vigente'))::text;
select 'CI|c16b|segundo correo: pendiente sin nombre|' || exists(select 1 from public.contactos_institucionales where correo_clave = 'licitaciones@muni-alfa.cl' and nombre = '' and estado = 'pendiente')::text;
