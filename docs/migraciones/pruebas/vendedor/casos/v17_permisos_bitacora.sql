\ir ../_ini.sql
insert into public.cotizacion_vendedor_historial (cotizacion_id) values ('7e000000-0000-4000-8000-0000000000a1');
\set m1 :LAST_ERROR_MESSAGE
reset role;
set role anon;
select count(*) from public.cotizacion_vendedor_historial;
select 'VR|v17_bitacora_sin_escritura_directa_y_anon_sin_lectura|' || (:'m1' like 'permission denied%' and :'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
