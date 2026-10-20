-- 5b. No se puede atar un contacto a una OC de otra institución
\ir ../_usuario.sql
select public.guardar_contacto_institucional(null, '99.111.222-7', '{"nombre":"Gina","correo":"gina@muni-alfa.cl","alcance":"oc","oc_exclusiva":"ci_t_10"}'::jsonb);
select 'CI|c18a|OC exclusiva de otro RUT: rechazado|' || (:'LAST_ERROR_MESSAGE' like '%no pertenece a esta institución%')::text;
