\ir ../_ini.sql
\set QUIET 1
\set pfx h0_
\ir ../huella_gset.sql
-- Abono conjunto de $800.799 = cobro cs_c1 ($124.798) + cs_c5 ($676.001): se vincula a ambos, sin crear nada.
savepoint s;
select public.conciliacion_decidir('cart:20261016:0:924798:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1', 'cs_c5']);
\set msg_mas :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261016:0:700000:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1', 'cs_c5']);
\set msg_menos :LAST_ERROR_MESSAGE
rollback to savepoint s;
select public.conciliacion_decidir('cart:20261016:0:800799:900000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1', 'cs_c5']) is not null as ok \gset
\set pfx h1_
\ir ../huella_gset.sql
savepoint s2;
select public.conciliacion_decidir('cart:20261017:0:124798:950000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1']);
\set msg_otra :LAST_ERROR_MESSAGE
rollback to savepoint s2;
select 'CN|c14_abono_conjunto_vincula_varios_cobros|' || (:'ok' = 't' and (select count(*) from public.conciliacion_decisiones where marca = 'cart:20261016:0:800799:900000:1') = 2)::text;
select 'CN|c14_no_supera_ni_queda_bajo_lo_abonado|' || (:'msg_mas' like '%suman%' and :'msg_menos' like '%suman%')::text;
select 'CN|c14_cobro_del_conjunto_no_se_usa_en_otro_abono|' || (:'msg_otra' like '%vinculado a otro%')::text;
select 'CN|c14_sin_cobros_nuevos_y_huella_identica|' || ((select count(*) from public.eventos_pago_cliente where id like 'cs\_%') = 5 and :'h0_huella' = :'h1_huella')::text;
rollback;
