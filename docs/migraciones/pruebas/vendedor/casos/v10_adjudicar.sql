\ir ../_ini.sql
select id, version from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'adjudicada', 'vr_v2', '{"n":"borrador A","oc":"VR-1-AG26"}')) \gset _
select 'VR|v10_adjudicada_conserva_vendedor|' || exists(select 1 from public.cotizaciones where id = :'id'::uuid and estado = 'adjudicada' and vendedor_id = 'vr_v2' and vendedor_nombre = 'Vendedora Dos VR' and oc_codigo = 'VR-1-AG26')::text;
