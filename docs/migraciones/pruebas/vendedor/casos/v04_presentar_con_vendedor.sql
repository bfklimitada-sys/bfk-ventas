\ir ../_ini.sql
select id, version from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'presentada', :'v1', '{"n":"borrador A","vn":"Otro Nombre"}')) \gset _
select 'VR|v04_presentar_con_vendedor_y_nombre_del_catalogo|' || exists(select 1 from public.cotizaciones c join public.vendedores v on v.id::text = c.vendedor_id where c.id = :'id'::uuid and c.estado = 'presentada' and c.vendedor_nombre = v.nombre)::text;
