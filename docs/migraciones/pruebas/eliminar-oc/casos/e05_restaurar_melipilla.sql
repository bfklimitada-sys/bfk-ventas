\ir ../_ini.sql
reset role;
\i ../../conciliacion/huella.sql
\gset
\set hf0 :huella
select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) b0 from (select id from public.eventos_pago_cliente where oc_id='oe_B' union all select id from public.eventos_pago_financiamiento where oc_id='oe_B' union all select id from public.historial_cambios where oc_id='oe_B') x \gset
set role authenticated;
select public.oc_eliminar_definitivamente('oe_B','OE-1-AG26-B','Duplicada','oe_A') ->> 'eliminacion' eid \gset
reset role;
\i ../../conciliacion/huella.sql
\gset
select 'OE|e05_huella_financiera_cambia_al_eliminar|' || (:'huella' <> :'hf0')::text;
set role authenticated;
select public.oc_eliminacion_restaurar(:'eid','OE-1-AG26-B') rr \gset
reset role;
\i ../../conciliacion/huella.sql
\gset
select 'OE|e05_restaurar_devuelve_la_huella_financiera_exacta|' || (:'huella' = :'hf0')::text;
select 'OE|e05_restaurar_devuelve_ids_e_historial|' || ((select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) from (select id from public.eventos_pago_cliente where oc_id='oe_B' union all select id from public.eventos_pago_financiamiento where oc_id='oe_B' union all select id from public.historial_cambios where oc_id='oe_B') x) = :'b0'
  and (select count(*) from public.correos_bfk where oc_id='oe_B')=1)::text;
rollback;
