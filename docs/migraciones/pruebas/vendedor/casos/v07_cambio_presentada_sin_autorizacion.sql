\ir ../_ini.sql
select id, version from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'presentada', 'vr_v2', '{"n":"borrador A"}'));
select 'VR|v07_cambio_en_presentada_sin_admin_bloqueado|' || (:'LAST_ERROR_MESSAGE' like '%solo un administrador puede cambiar su vendedor%' and exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_id = :'v1'))::text;
