\ir ../_ini.sql
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']);
savepoint s;
select public.registrar_movimiento_cartola('cart:20261014:250000:0:500000:1', 'gasto',
  jsonb_build_array(jsonb_build_object('id', 'cs_gnuevo', 'categoria_id', 'cs_cat_otros', 'monto', 250000, 'mes', 10, 'anio', 2026, 'fecha', '2026-10-14', 'detalle', 'Desde cartola')));
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c10_no_se_registra_un_gasto_nuevo_para_un_movimiento_ya_vinculado|' || (:'msg' like '%ya está conciliado con un registro existente%' and not exists (select 1 from public.gastos_indirectos where id = 'cs_gnuevo'))::text;
rollback;
