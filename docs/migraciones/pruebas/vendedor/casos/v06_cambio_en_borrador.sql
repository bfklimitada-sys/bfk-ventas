\ir ../_ini.sql
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'borrador', :'v1', '{"n":"borrador B"}'))->>'id') as id \gset
select version from public.cotizaciones where id = :'id'::uuid \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'borrador', 'vr_v2', '{"n":"borrador B"}')) \gset _
select 'VR|v06_cambio_de_vendedor_en_borrador|' || (exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_id = 'vr_v2' and vendedor_nombre = 'Vendedora Dos VR') and exists(select 1 from public.cotizacion_vendedor_historial where cotizacion_id = :'id'::uuid and anterior_id = :'v1' and nuevo_id = 'vr_v2'))::text;
