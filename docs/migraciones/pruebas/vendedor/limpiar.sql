\set ON_ERROR_STOP on
begin;
select set_config('bfk.importacion', 'on', true);
delete from public.historial_cambios where oc_id like 'vr\_oc\_%';
delete from public.cotizacion_versiones where cotizacion_id in (select id from public.cotizaciones where nombre like 'VR %');
delete from public.cotizacion_items where cotizacion_id in (select id from public.cotizaciones where nombre like 'VR %');
delete from public.cotizacion_envios where cotizacion_id in (select id from public.cotizaciones where nombre like 'VR %');
delete from public.cotizacion_vendedor_historial where cotizacion_id in (select id from public.cotizaciones where nombre like 'VR %');
delete from public.cotizaciones where nombre like 'VR %';
delete from public.ordenes_compra_v2 where id like 'vr\_oc\_%';
delete from public.cotizacion_vendedores where id = '7e000000-0000-4000-8000-0000000000c1';
delete from public.vendedores where id in ('vr_v2', 'vr_v3');
commit;
