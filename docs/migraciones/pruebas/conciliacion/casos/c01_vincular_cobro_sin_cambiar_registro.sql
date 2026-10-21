\ir ../_ini.sql
\set QUIET 1
select (select md5(t::text) from public.eventos_pago_cliente t where id = 'cs_c1') as fila0 \gset
\set pfx h0_
\ir ../huella_gset.sql
select public.conciliacion_decidir('cart:20261015:0:124798:1000000:1', 'vinculado', 'eventos_pago_cliente', array['cs_c1'], '123', 'TEF DE UNIVERSIDAD FICTICIA') is not null as ok \gset
\set pfx h1_
\ir ../huella_gset.sql
select 'CN|c01_vincula_cobro_existente|' || (:'ok' = 't' and (select count(*) from public.conciliacion_decisiones where marca = 'cart:20261015:0:124798:1000000:1' and decision = 'vinculado' and registro_id = 'cs_c1') = 1)::text;
select 'CN|c01_registro_financiero_sin_cambios|' || ((select md5(t::text) from public.eventos_pago_cliente t where id = 'cs_c1') = :'fila0' and (select marca_cartola from public.eventos_pago_cliente where id = 'cs_c1') is null)::text;
select 'CN|c01_huella_financiera_identica_al_vincular|' || (:'h0_huella' = :'h1_huella')::text;
rollback;
