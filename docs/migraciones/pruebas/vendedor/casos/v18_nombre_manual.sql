\ir ../_ini.sql
select id, version from public.cotizaciones where nombre = 'VR borrador B' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'borrador', 'vr_v2', '{"n":"borrador B","vn":"Nombre Falso"}')) \gset _
select 'VR|v18_nombre_no_se_reemplaza_a_mano|' || exists(select 1 from public.cotizaciones where id = :'id'::uuid and vendedor_nombre = 'Vendedora Dos VR')::text;
