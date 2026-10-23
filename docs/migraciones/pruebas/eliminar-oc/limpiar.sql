-- Quita los datos ficticios 'oe_' (solo base desechable).
\set ON_ERROR_STOP on
begin;
select set_config('bfk.importacion', 'on', true) as _i \gset
alter table public.conciliacion_decisiones disable trigger user;
delete from public.conciliacion_decisiones where registro_id like 'oe\_%';
alter table public.conciliacion_decisiones enable trigger user;
delete from public.cotizaciones where oc_codigo like 'OE-%';
delete from public.fin_diferencias_historicas where entidad_id like 'oe\_%';
alter table public.oc_seguimientos disable trigger user; delete from public.oc_seguimientos where oc_id like 'oe\_%'; alter table public.oc_seguimientos enable trigger user;
alter table public.trib_clasificaciones disable trigger user; delete from public.trib_clasificaciones where oc_id like 'oe\_%'; alter table public.trib_clasificaciones enable trigger user;
delete from public.correos_bfk where message_id = '<oe-b@ejemplo.invalid>';
delete from public.pagos_vendedor where id like 'oe\_%';
alter table public.eventos_pago_financiamiento disable trigger user; delete from public.eventos_pago_financiamiento where oc_id like 'oe\_%'; alter table public.eventos_pago_financiamiento enable trigger user;
delete from public.ordenes_compra_v2 where id like 'oe\_%';
delete from public.vendedores where id = 'oe_vend';
delete from public.financiadores where id like 'oe\_%';
delete from public.categorias_gasto where id like 'oe\_%';
commit;
