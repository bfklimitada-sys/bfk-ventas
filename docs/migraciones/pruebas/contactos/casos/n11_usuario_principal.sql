\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"Hugo","correo":"hugo@muni-alfa.cl","es_principal":true}'::jsonb);
select 'CI|n11|usuario no define el principal|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador define el contacto principal%')::text;
