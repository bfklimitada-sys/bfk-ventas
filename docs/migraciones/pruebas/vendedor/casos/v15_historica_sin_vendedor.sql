\ir ../_ini.sql
select version from public.cotizaciones where id = '7e000000-0000-4000-8000-0000000000a1' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl('7e000000-0000-4000-8000-0000000000a1', :version, 'presentada', null, '{"n":"histórica sin vendedor"}')) \gset _
select 'VR|v15_historica_presentada_sin_vendedor_sigue_editable|' || exists(select 1 from public.cotizaciones where id = '7e000000-0000-4000-8000-0000000000a1' and version = :version + 1 and vendedor_id is null)::text;
