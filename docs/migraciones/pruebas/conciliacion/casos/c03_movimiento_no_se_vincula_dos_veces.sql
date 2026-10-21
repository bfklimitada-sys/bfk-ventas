\ir ../_ini.sql
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']);
savepoint s;
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g2']);
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c03_un_movimiento_no_se_vincula_dos_veces|' || (:'msg' like '%ya está vinculado%')::text;
-- dos movimientos legítimos de igual monto: el segundo (otra marca) se vincula con el OTRO gasto
select public.conciliacion_decidir('cart:20261014:250000:0:250000:1', 'vinculado', 'gastos_indirectos', array['cs_g2']) is not null as ok2 \gset
select 'CN|c03_dos_operaciones_iguales_se_vinculan_por_separado|' || (:'ok2' = 't')::text;
rollback;
