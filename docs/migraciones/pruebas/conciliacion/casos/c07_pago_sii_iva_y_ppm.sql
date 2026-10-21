\ir ../_ini.sql
\set QUIET 1
\set pfx h0_
\ir ../huella_gset.sql
select public.conciliacion_decidir('cart:20261020:435000:0:900000:1', 'vinculado', 'gastos_indirectos', array['cs_g_iva', 'cs_g_ppm']) is not null as ok \gset
\set pfx h1_
\ir ../huella_gset.sql
select 'CN|c07_iva_y_ppm_juntos_se_vinculan_al_pago_del_sii|' || (:'ok' = 't' and (select count(*) from public.conciliacion_decisiones where marca = 'cart:20261020:435000:0:900000:1') = 2)::text;
select 'CN|c07_sin_gasto_nuevo_y_huella_identica|' || ((select count(*) from public.gastos_indirectos where categoria_id = 'cat_impuesto' and id like 'cs\_%') = 2 and :'h0_huella' = :'h1_huella')::text;
rollback;
