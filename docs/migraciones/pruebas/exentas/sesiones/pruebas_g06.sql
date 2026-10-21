\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3e', 'ocv2_g3_ex', current_date, '3401', 2704000, 34);
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_tipo_dte, ref_folio, ref_codigo, ref_motivo) values ('g3f', 'ocv2_g3_ex', current_date, '61', 2704000, 61, 34, '3401', 1, 'Anula');
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, factura_anulada_numero, nota_credito) values ('g3g', 'ocv2_g3_ex', current_date, '3402', 2600000, 34, '3401', '61');
select 'G3|nc_y_refacturacion_dte34|' || ((select string_agg(numero_factura, ',') from public.fin_facturas_vigentes('ocv2_g3_ex')) = '3402' and (select monto_facturado from public.ordenes_compra_v2 where id = 'ocv2_g3_ex') = 2600000)::text;
rollback;
