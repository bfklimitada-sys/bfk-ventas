\ir ../_ini.sql
-- g1 vinculado al movimiento M; otro movimiento M2 intenta marcar g1 con la función antigua (cartola_vincular) → bloqueado
select public.conciliacion_decidir('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', array['cs_g1']);
savepoint s;
select public.registrar_movimiento_cartola('cart:20261014:250000:0:250000:1', 'gasto', null, '{}', array['cs_g1']);
\set msg :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'CN|c11_registro_vinculado_no_se_marca_con_otro_movimiento|' || (:'msg' like '%conciliado con otro movimiento%' and (select marca_cartola from public.gastos_indirectos where id = 'cs_g1') is null)::text;
-- un gasto manual nuevo (sin marca) se registra igual que hoy
insert into public.gastos_indirectos (id, categoria_id, monto, mes, anio, fecha, detalle) values ('cs_gmanual', 'cs_cat_otros', 1234, 10, 2026, '2026-10-18', 'manual');
select 'CN|c11_registro_manual_sin_cambios|' || exists (select 1 from public.gastos_indirectos where id = 'cs_gmanual')::text;
rollback;
