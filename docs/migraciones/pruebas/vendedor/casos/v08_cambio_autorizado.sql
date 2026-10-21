\ir ../_ini_admin.sql
select id, version from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'presentada', 'vr_v2', '{"n":"borrador A"}')) \gset _
select 'VR|v08_cambio_autorizado_por_admin_con_historial|' || (exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_id = 'vr_v2') and exists(select 1 from public.cotizacion_vendedor_historial where cotizacion_id = :'id'::uuid and anterior_id = :'v1' and anterior_nombre is not null and nuevo_id = 'vr_v2' and es_admin and usuario = :'adm' and estado = 'presentada'))::text;
