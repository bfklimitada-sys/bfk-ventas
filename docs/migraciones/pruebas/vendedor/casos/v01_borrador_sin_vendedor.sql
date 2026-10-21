\ir ../_ini.sql
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'borrador', null, '{"n":"borrador A"}'))->>'id') as id \gset
select 'VR|v01_borrador_sin_vendedor_permitido|' || exists(select 1 from public.cotizaciones where id = :'id'::uuid and estado = 'borrador' and vendedor_id is null)::text;
