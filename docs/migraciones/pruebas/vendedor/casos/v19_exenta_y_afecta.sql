\ir ../_ini.sql
select version from public.cotizaciones where id = '7e000000-0000-4000-8000-0000000000e1' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl('7e000000-0000-4000-8000-0000000000e1', :version, 'presentada', null, '{"n":"exenta","neto":2704000,"iva":0,"formula":{"exenta":true,"base_exenta":"costo_bruto"}}'));
\set m1 :LAST_ERROR_MESSAGE
select public.cz_guardar_cotizacion_v2(pg_temp.pl('7e000000-0000-4000-8000-0000000000e1', :version, 'presentada', :'v1', '{"n":"exenta","neto":2704000,"iva":0,"formula":{"exenta":true,"base_exenta":"costo_bruto"}}')) \gset _
select 'VR|v19_exenta_aprobada_presentada_con_vendedor|' || (:'m1' like 'CZ_VENDEDOR%' and exists(select 1 from public.cotizaciones where id = '7e000000-0000-4000-8000-0000000000e1' and estado = 'presentada' and vendedor_id = :'v1' and impuestos = 0 and tratamiento_iva = 'exenta_fora'))::text;
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'presentada', :'v1', '{"n":"afecta","neto":1000000,"iva":190000}'))->>'id') as af \gset
select 'VR|v19_afecta_presentada_con_vendedor_igual_que_antes|' || exists(select 1 from public.cotizaciones where id = :'af'::uuid and impuestos = 190000 and subtotal_neto = 1000000 and tratamiento_iva is null)::text;
