\ir ../_ini.sql
savepoint s;
select public.conciliacion_decidir('cart:20261015:0:300000:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c2']);
\set msg1 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261015:0:50000:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c3']);
\set msg2 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c06_vale_vista_sin_cobrar_no_se_vincula|' || (:'msg1' like '%no pasó por el banco%')::text;
select 'CN|c06_retencion_no_se_vincula|' || (:'msg2' like '%no pasó por el banco%')::text;
rollback;
