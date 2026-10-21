\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
select public.cz_guardar_cotizacion_v2(jsonb_build_object('items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO nueva exenta', 'formula', '{"exenta":true}'::jsonb, 'subtotal_neto', 1000, 'impuestos', 0, 'total', 1000));
\set fallo :ERROR
rollback;
select 'G3|cotizacion_nueva_no_nace_exenta|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ 'no tiene una clasificación exenta aprobada')::text;
