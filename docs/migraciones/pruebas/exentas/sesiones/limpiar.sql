-- SOLO COPIA: retira los datos sintéticos de preparar.sql.
\set ON_ERROR_STOP on
begin;
delete from public.eventos_factura where oc_id in ('ocv2_g3_ex', 'ocv2_g3_af');
delete from public.historial_cambios where oc_id in ('ocv2_g3_ex', 'ocv2_g3_af');
delete from public.ordenes_compra_v2 where id in ('ocv2_g3_ex', 'ocv2_g3_af');
delete from public.cotizacion_versiones where cotizacion_id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002');
delete from public.cotizaciones where id in ('e3000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000002');
commit;
