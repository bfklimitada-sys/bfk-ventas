\ir ../_ini.sql
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'presentada', :'v1', jsonb_build_object('n', 'varios', 'items', jsonb_build_array(
  jsonb_build_object('key','a','cantidad',1,'ficha','{"nombre":"VR A"}'::jsonb), jsonb_build_object('key','b','cantidad',2,'ficha','{"nombre":"VR B"}'::jsonb), jsonb_build_object('key','c','cantidad',3,'ficha','{"nombre":"VR C"}'::jsonb)))))->>'id') as id \gset
select 'VR|v20_varios_productos_con_vendedor|' || ((select count(*) from public.cotizacion_items where cotizacion_id = :'id'::uuid) = 3 and exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_id = :'v1'))::text;
