\ir ../_ini.sql
reset role;
\set oc oe_C
\ir ../huella_oc.sql
\set h0 :h
select md5(to_jsonb(o)::text) oc0 from public.ordenes_compra_v2 o where id='oe_C' \gset
set role authenticated;
select public.oc_eliminar_definitivamente('oe_C','OE-3-AG26','Creada por error') ->> 'eliminacion' eid \gset
reset role;
select 'OE|e04_sin_movimientos_eliminable_sin_original|' || (not exists (select 1 from public.ordenes_compra_v2 where id='oe_C'))::text;
select 'OE|e04_borra_entrega_historial_y_clasificacion_tributaria|' || (not exists (select 1 from public.eventos_entrega where oc_id='oe_C') and not exists (select 1 from public.historial_cambios where oc_id='oe_C') and not exists (select 1 from public.trib_clasificaciones where oc_id='oe_C'))::text;
\ir ../huella_oc.sql
select 'OE|e04_nada_ajeno_cambia|' || (:'h' = :'h0')::text;
-- Auditoría inmutable: ni el dueño la modifica ni la borra.
savepoint s; update public.oc_eliminaciones set motivo='x' where id=:'eid'; \set m1 :LAST_ERROR_MESSAGE
rollback to savepoint s; delete from public.oc_eliminaciones where id=:'eid'; \set m2 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'OE|e04_auditoria_inmutable|' || (:'m1' like '%no se modifica%' and :'m2' like '%no se borra%')::text;
set role authenticated;
savepoint s; update public.oc_eliminaciones set motivo='x' where id=:'eid'; \set m3 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'OE|e04_app_no_puede_escribir_auditoria|' || (:'m3' like '%permission denied%')::text;
select count(*) n from public.oc_eliminaciones where id=:'eid' \gset
select 'OE|e04_admin_lee_auditoria|' || (:n = 1)::text;
-- Restaurar: vuelve exactamente como estaba.
savepoint s; select public.oc_eliminacion_restaurar(:'eid','otra'); \set m4 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.oc_eliminacion_restaurar(:'eid','OE-3-AG26') ->> 'restaurada' rr \gset
reset role;
select 'OE|e04_restaurar_pide_confirmacion|' || (:'m4' like '%confirmación%')::text;
select 'OE|e04_restaurada_identica|' || ((select md5(to_jsonb(o)::text) from public.ordenes_compra_v2 o where id='oe_C') = :'oc0'
  and (select count(*) from public.eventos_entrega where oc_id='oe_C')=1 and (select count(*) from public.historial_cambios where oc_id='oe_C')=1 and (select count(*) from public.trib_clasificaciones where oc_id='oe_C')=1)::text;
select 'OE|e04_auditoria_registra_restauracion|' || ((select restaurado_en is not null and restaurado_por is not null from public.oc_eliminaciones where id=:'eid'))::text;
set role authenticated;
savepoint s; select public.oc_eliminacion_restaurar(:'eid','OE-3-AG26'); \set m5 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'OE|e04_no_se_restaura_dos_veces|' || (:'m5' like '%ya fue restaurada%')::text;
rollback;
