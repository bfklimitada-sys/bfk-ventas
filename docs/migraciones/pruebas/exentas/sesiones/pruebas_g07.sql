\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3e', 'ocv2_g3_ex', current_date, '3401', 2704000, 34);
with u as (update public.eventos_factura set monto = 2600000 where id = 'g3e' returning monto_exento, monto_iva)
select 'G3|correccion_monto_dte34_sigue_exenta|' || (count(*) = 1 and bool_and(monto_exento = 2600000 and monto_iva = 0))::text from u;
rollback;
