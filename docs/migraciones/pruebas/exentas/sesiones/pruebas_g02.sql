\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, monto_iva) values ('g3b', 'ocv2_g3_ex', current_date, '2', 2704000, 34, 431714);
\set fallo :ERROR
rollback;
select 'G3|dte34_con_iva_bloqueada|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ 'no lleva IVA de venta')::text;
