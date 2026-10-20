\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
select public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000002', 'version', (select version from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000002'), 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz afecta', 'subtotal_neto', 1000, 'impuestos', 0, 'total', 1000));
\set fallo :ERROR
rollback;
select 'G3|iva_0_sin_clasificacion_bloqueado|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ 'requiere una clasificación exenta')::text;
