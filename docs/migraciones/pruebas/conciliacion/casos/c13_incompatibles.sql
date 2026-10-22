\ir ../_ini.sql
-- Vinculado a una compra; luego otro tipo (gasto) para el MISMO movimiento → bloqueado. Un cobro a un cargo → bloqueado.
select public.conciliacion_decidir('cart:20261016:80000:0:900000:1', 'vinculado', 'eventos_compra', array['cs_k1']);
savepoint s;
insert into public.gastos_indirectos (id, categoria_id, monto, mes, anio, fecha, detalle) values ('cs_g80', 'cs_cat_otros', 80000, 10, 2026, '2026-10-16', 'otro');
select public.conciliacion_decidir('cart:20261016:80000:0:900000:1', 'vinculado', 'gastos_indirectos', array['cs_g80']);
\set msg1 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261015:124798:0:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1']);
\set msg2 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261015:0:174798:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1', 'cs_c3']);
\set msg3 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c13_no_mezcla_tipos_en_un_movimiento|' || (:'msg1' like '%ya está vinculado%' and (select count(*) from public.conciliacion_decisiones where marca = 'cart:20261016:80000:0:900000:1') = 1)::text;
select 'CN|c13_cobro_no_se_vincula_a_un_cargo|' || (:'msg2' like '%sentido%')::text;
select 'CN|c13_no_vincula_un_cobro_fuera_del_banco_junto_a_otro|' || (:'msg3' like '%no pasó por el banco%')::text;
rollback;
