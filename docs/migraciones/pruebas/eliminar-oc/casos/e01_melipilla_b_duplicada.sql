\set oc oe_B
\ir ../_ini.sql
reset role; \ir ../huella_oc.sql
\set h0 :h
select (select saldo_deuda from public.financiadores where id='oe_fin') s0 \gset
select public.oce_firma_ajena('oe_B') f0 \gset
set role authenticated;
select (public.oc_eliminacion_revisar('oe_B','oe_A') ->> 'eliminable') rev \gset
select 'OE|e01_revisar_duplicada_con_original_es_eliminable|' || (:'rev' = 'true')::text;
select public.oc_eliminar_definitivamente('oe_B', 'oe-1-ag26-b', 'Duplicada de la importación del 29/07', 'oe_A') ->> 'oc' r \gset
reset role; \ir ../huella_oc.sql
select 'OE|e01_eliminada|' || (not exists (select 1 from public.ordenes_compra_v2 where id='oe_B'))::text;
select 'OE|e01_sin_filas_huerfanas|' || (not exists (select 1 from public.eventos_pago_cliente where oc_id='oe_B') and not exists (select 1 from public.eventos_pago_financiamiento where oc_id='oe_B')
  and not exists (select 1 from public.eventos_factura where oc_id='oe_B') and not exists (select 1 from public.eventos_compra where oc_id='oe_B') and not exists (select 1 from public.historial_cambios where oc_id='oe_B')
  and not exists (select 1 from public.notificaciones where oc_id='oe_B') and not exists (select 1 from public.oc_comentarios where oc_id='oe_B') and not exists (select 1 from public.oc_productos_link where oc_id='oe_B'))::text;
select 'OE|e01_original_y_todo_lo_ajeno_identico|' || (:'h' = :'h0')::text;
select 'OE|e01_saldo_financiador_sin_cambio|' || ((select saldo_deuda from public.financiadores where id='oe_fin') = :s0)::text;
select 'OE|e01_firma_ajena_identica|' || (public.oce_firma_ajena('oe_B') = :'f0')::text;
select 'OE|e01_original_conserva_factura_cobro_compra_devolucion|' || ((select count(*) from public.eventos_factura where oc_id='oe_A')=1 and (select count(*) from public.eventos_pago_cliente where oc_id='oe_A')=1
  and (select count(*) from public.eventos_compra where oc_id='oe_A')=1 and (select count(*) from public.eventos_pago_financiamiento where oc_id='oe_A')=1
  and (select monto_cobrado from public.ordenes_compra_v2 where id='oe_A')=130000 and (select monto_pagado_fin from public.ordenes_compra_v2 where id='oe_A')=104970)::text;
select 'OE|e01_correo_conservado_sin_oc|' || ((select count(*) from public.correos_bfk where message_id='<oe-b@ejemplo.invalid>' and oc_id is null)=1)::text;
select 'OE|e01_auditoria_quien_cuando_que|' || (select count(*)=1 and bool_and(eliminado_por=:'usr'::uuid and eliminado_por_nombre is not null and eliminado_en is not null
  and original_id='oe_A' and motivo like 'Duplicada%' and jsonb_array_length(copia->'historial_cambios')=2 and jsonb_array_length(copia->'eventos_pago_financiamiento')=1
  and (resumen->'registros'->>'eventos_pago_cliente')::int=1) from public.oc_eliminaciones where oc_id='oe_B')::text;
rollback;
