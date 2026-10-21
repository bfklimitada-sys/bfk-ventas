\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true), set_config('request.method', 'POST', true);
set local role anon;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3i', 'ocv2_g3_ex', current_date, '9', 1, 34);
\set fallo :ERROR
rollback;
select 'G3|anon_no_registra_facturas|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ '.')::text;
