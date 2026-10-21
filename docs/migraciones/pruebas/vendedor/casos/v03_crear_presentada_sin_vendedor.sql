\ir ../_ini.sql
select public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'presentada', null, '{"n":"nace presentada"}'));
select 'VR|v03_crear_presentada_sin_vendedor_bloqueado|' || (:'LAST_ERROR_MESSAGE' like 'CZ_VENDEDOR: no se puede presentar%' and not exists(select 1 from public.cotizaciones where nombre = 'VR nace presentada'))::text;
