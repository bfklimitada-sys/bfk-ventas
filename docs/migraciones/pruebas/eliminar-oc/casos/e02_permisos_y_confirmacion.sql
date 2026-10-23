\set usr 22222222-2222-2222-2222-222222222222
\ir ../_ini.sql
savepoint s; select public.oc_eliminacion_revisar('oe_C'); \set m1 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_C','OE-3-AG26','Sin movimientos'); \set m2 :LAST_ERROR_MESSAGE
rollback to savepoint s; select count(*) n from public.oc_eliminaciones \gset
select 'OE|e02_no_admin_no_revisa_ni_elimina|' || (:'m1' like '%solo un administrador%' and :'m2' like '%solo un administrador%')::text;
reset role;
select 'OE|e02_no_admin_no_ve_auditoria|' || (:n = 0)::text;
select 'OE|e02_oc_intacta|' || exists (select 1 from public.ordenes_compra_v2 where id='oe_C')::text;
rollback;
\set usr :adm
\ir ../_ini.sql
savepoint s; select public.oc_eliminar_definitivamente('oe_C','OE-3-AG2','Sin movimientos'); \set m1 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_C','OE-3-AG26',' '); \set m2 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_X','OE-X','Motivo largo'); \set m3 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'OE|e02_confirmacion_distinta_rechazada|' || (:'m1' like '%confirmación no coincide%')::text;
select 'OE|e02_motivo_obligatorio|' || (:'m2' like '%motivo%')::text;
select 'OE|e02_oc_inexistente|' || (:'m3' like '%no existe%')::text;
rollback;
