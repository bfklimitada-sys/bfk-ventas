\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"X","correo":"a@b.cl, c@d.cl"}'::jsonb);
select 'CI|p13|alta manual con correo inválido o varios: rechazada con mensaje claro|' || (:'LAST_ERROR_MESSAGE' like '%no es válido (un correo por contacto)%')::text;
