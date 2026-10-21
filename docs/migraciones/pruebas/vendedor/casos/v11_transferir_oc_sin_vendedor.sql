\ir ../_ini.sql
select id from public.cotizaciones where nombre = 'VR borrador A' \gset
select public.cz_transferir_vendedor_a_oc(:'id'::uuid) as r \gset
select 'VR|v11_oc_sin_vendedor_recibe_el_de_la_cotizacion|' || ((:'r')::jsonb->>'ok' = 'true' and exists(select 1 from public.ordenes_compra_v2 where id = 'vr_oc_1' and vendedor_id = 'vr_v2') and exists(select 1 from public.historial_cambios where oc_id = 'vr_oc_1' and campo = 'vendedor_id'))::text;
select public.cz_transferir_vendedor_a_oc(:'id'::uuid)->>'sin_cambios' as s \gset
select 'VR|v11_repetir_no_cambia_nada|' || (:'s' = 'true')::text;
