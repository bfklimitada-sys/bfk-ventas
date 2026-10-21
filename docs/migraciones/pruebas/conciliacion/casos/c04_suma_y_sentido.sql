\ir ../_ini.sql
savepoint s;
select public.conciliacion_decidir('cart:20261020:435000:0:900000:1', 'vinculado', 'gastos_indirectos', array['cs_g_iva']);
\set msg1 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261014:0:250000:900000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']);
\set msg2 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c04_suma_distinta_rechazada|' || (:'msg1' like '%suman%')::text;
select 'CN|c04_sentido_incorrecto_rechazado|' || (:'msg2' like '%sentido%')::text;
rollback;
