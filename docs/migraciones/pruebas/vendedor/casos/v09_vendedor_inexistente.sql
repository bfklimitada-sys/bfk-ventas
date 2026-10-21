\ir ../_ini.sql
select public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'borrador', 'no-existe', '{"n":"inexistente"}'));
\set m1 :LAST_ERROR_MESSAGE
select public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'borrador', 'vr_v3', '{"n":"inactivo"}'));
select 'VR|v09_vendedor_inexistente_o_inactivo_rechazado|' || (:'m1' like '%no existe o no está activo%' and :'LAST_ERROR_MESSAGE' like '%no existe o no está activo%')::text;
