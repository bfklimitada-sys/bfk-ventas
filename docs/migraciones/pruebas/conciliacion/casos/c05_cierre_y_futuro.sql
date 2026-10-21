\ir ../_ini.sql
savepoint s;
select public.conciliacion_decidir('cart:20260930:0:70000:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c4']);
\set msg1 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261230:0:124798:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1']);
\set msg2 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c05_anterior_al_cierre_solo_consulta|' || (:'msg1' like '%anterior al cierre%')::text;
select 'CN|c05_fecha_futura_rechazada|' || (:'msg2' like '%futura%')::text;
rollback;
