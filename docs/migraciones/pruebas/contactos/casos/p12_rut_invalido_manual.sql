\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-1', '{"nombre":"X","correo":"x@x.cl"}'::jsonb);
select 'CI|p12|alta manual con RUT inválido: rechazada|' || (:'LAST_ERROR_MESSAGE' like '%RUT de la institución no es válido%')::text;
