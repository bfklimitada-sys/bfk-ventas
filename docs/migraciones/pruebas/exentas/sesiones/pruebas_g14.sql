\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
with c as (select public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000002', 'version', (select version from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000002'), 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz afecta', 'formula', '{"base":"neto","redondeo":"arriba","prorrateo":"valor","confirmada":true}'::jsonb, 'subtotal_neto', 1000, 'impuestos', 190, 'total', 1190)) r)
select 'G3|cotizacion_afecta_igual_que_antes|' || ((select (r->>'version') is not null from c))::text;
rollback;
