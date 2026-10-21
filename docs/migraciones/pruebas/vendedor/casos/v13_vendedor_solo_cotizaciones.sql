\ir ../_ini.sql
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'presentada', 'cz:7e000000-0000-4000-8000-0000000000c1', '{"n":"cz vendedor"}'))->>'id') as id \gset
select version from public.cotizaciones where id = :'id'::uuid \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'adjudicada', 'cz:7e000000-0000-4000-8000-0000000000c1', '{"n":"cz vendedor","oc":"VR-3-AG26"}')) \gset _
select public.cz_transferir_vendedor_a_oc(:'id'::uuid);
select 'VR|v13_vendedor_solo_de_cotizaciones_no_se_transfiere|' || (:'LAST_ERROR_MESSAGE' like '%registrado solo en Cotizaciones%' and exists(select 1 from public.ordenes_compra_v2 where id = 'vr_oc_3' and vendedor_id is null) and exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_nombre = 'Vendedor Solo Cotizaciones VR'))::text;
