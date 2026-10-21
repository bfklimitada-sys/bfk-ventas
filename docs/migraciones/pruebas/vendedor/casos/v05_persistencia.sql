\ir ../_ini_admin.sql
select 'VR|v05_persistencia_en_otra_sesion|' || exists(select 1 from public.cotizaciones where nombre = 'VR borrador A' and estado = 'presentada' and vendedor_id = :'v1')::text;
select 'VR|v05_bitacora_de_la_asignacion|' || exists(select 1 from public.cotizacion_vendedor_historial h join public.cotizaciones c on c.id = h.cotizacion_id where c.nombre = 'VR borrador A' and h.anterior_id is null and h.nuevo_id = :'v1' and h.usuario = :'usr')::text;
