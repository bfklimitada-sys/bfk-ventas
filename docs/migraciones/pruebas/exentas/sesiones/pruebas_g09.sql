\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
with c as (select public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000001', 'version', (select version from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000001'), 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz exenta', 'formula', '{"exenta":true,"base_exenta":"costo_bruto"}'::jsonb, 'subtotal_neto', 2704000, 'impuestos', 0, 'total', 2704000)) r)
select 'G3|cotizacion_exenta_aprobada_se_guarda|' || ((select (r->>'version') is not null from c))::text;
rollback;
