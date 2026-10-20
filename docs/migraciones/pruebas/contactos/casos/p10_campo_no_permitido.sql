\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"X","confirmado_manual":false}'::jsonb);
select 'CI|p10|campos internos no se pueden enviar|' || (:'LAST_ERROR_MESSAGE' like '%campo no permitido%')::text;
