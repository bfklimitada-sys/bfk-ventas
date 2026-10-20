-- 7. Correos duplicados (mayúsculas): rechazado en la misma institución
\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"Otro","correo":"BRUNO@Muni-Alfa.cl"}'::jsonb);
select 'CI|c12a|mismo correo con otras mayúsculas en la misma institución: rechazado|' || (:'LAST_ERROR_MESSAGE' like 'CONTACTO_DUPLICADO%')::text;
