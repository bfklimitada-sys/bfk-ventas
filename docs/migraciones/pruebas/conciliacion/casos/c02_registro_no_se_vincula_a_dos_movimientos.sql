\ir ../_ini.sql
select public.conciliacion_decidir('cart:20261015:0:124798:1000000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1']);
savepoint s;
select public.conciliacion_decidir('cart:20261016:0:124798:2000000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1']);
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c02_un_registro_no_se_vincula_a_dos_movimientos|' || (:'msg' like '%ya está vinculado a otro movimiento%' or :'msg' like '%vinculado a otro%')::text;
rollback;
