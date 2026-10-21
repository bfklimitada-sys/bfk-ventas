\set ON_ERROR_STOP on
begin;
delete from public.eventos_compra where id like 'cs\_%';
delete from public.gastos_indirectos where id like 'cs\_%';
delete from public.eventos_pago_cliente where id like 'cs\_%';
delete from public.ordenes_compra_v2 where id like 'cs\_%';
delete from public.categorias_gasto where id = 'cs_cat_otros';
delete from public.financiadores where id like 'cs\_%';
commit;
