\ir ../_ini_admin.sql
select (public.cz_guardar_cotizacion_v2(pg_temp.pl(null, null, 'presentada', 'vr_v2', '{"n":"adjudicada OC2"}'))->>'id') as id \gset
select version from public.cotizaciones where id = :'id'::uuid \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'adjudicada', 'vr_v2', '{"n":"adjudicada OC2","oc":"VR-2-AG26"}')) \gset _
\ir ../_ini.sql
select public.cz_transferir_vendedor_a_oc(:'id'::uuid);
select 'VR|v12_oc_con_otro_vendedor_no_se_sobrescribe|' || (:'LAST_ERROR_MESSAGE' like '%ya tiene un vendedor asignado distinto%' and exists(select 1 from public.ordenes_compra_v2 where id = 'vr_oc_2' and vendedor_id = :'v1'))::text;
