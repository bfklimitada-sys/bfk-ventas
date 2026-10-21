\ir ../_ini.sql
select id, version from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'presentada', null, '{"n":"borrador A"}'));
select 'VR|v02_presentar_sin_vendedor_bloqueado|' || (:'LAST_ERROR_MESSAGE' like 'CZ_VENDEDOR: no se puede presentar%' and exists(select 1 from public.cotizaciones where id = :'id'::uuid and estado = 'borrador'))::text;
