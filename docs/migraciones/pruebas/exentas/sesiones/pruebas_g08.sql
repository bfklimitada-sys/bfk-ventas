\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
with i as (insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('g3h', 'ocv2_g3_af', current_date, '8801', 1190000) returning tipo_dte, monto_exento, monto_iva)
select 'G3|dte33_afecta_igual_que_antes|' || (count(*) = 1 and bool_and(tipo_dte is null and monto_exento is null and monto_iva is null))::text from i;
rollback;
