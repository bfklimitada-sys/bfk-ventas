\ir ../_ini.sql
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'rechazado', 'gastos_indirectos', array['cs_g1'])->'ids'->>0 as rid \gset
savepoint s;
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']);
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_anular(:rid, 'prueba') is not null as anulada \gset
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']) is not null as ok \gset
select 'CN|c09_rechazo_impide_vincular_sin_deshacer|' || (:'msg' like '%decisión vigente%')::text;
select 'CN|c09_deshacer_y_vincular|' || (:'anulada' = 't' and :'ok' = 't' and (select anulado_por is not null from public.conciliacion_decisiones where id = :rid))::text;
rollback;
