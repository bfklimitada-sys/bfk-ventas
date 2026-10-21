\ir ../_ini.sql
select public.conciliacion_decidir('cart:20261016:80000:0:900000:1', 'vinculado', 'eventos_compra', array['cs_k1']) is not null as ok \gset
savepoint s;
select public.conciliacion_decidir('cart:20261016:90000:0:800000:1', 'vinculado', 'eventos_compra', array['cs_k2']);
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c08_compra_con_fondos_propios_se_vincula|' || (:'ok' = 't')::text;
select 'CN|c08_compra_de_financiador_externo_no_pasa_por_el_banco|' || (:'msg' like '%no pasó por el banco%')::text;
rollback;
