-- Huella financiera (misma consulta que trib/huella_financiera.sql de los respaldos).
select md5(concat_ws('|',
  (select md5(coalesce(string_agg((to_jsonb(o) - '{tratamiento_iva,fundamento_iva,respaldo_iva,tratamiento_aprobado_por,tratamiento_aprobado_en,clasificacion_id}'::text[])::text, ',' order by o.id), '')) from public.ordenes_compra_v2 o),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.eventos_factura t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.eventos_compra t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.eventos_pago_financiamiento t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.eventos_pago_cliente t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.financiadores t),
  (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.iva_mensual t),
  (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.pagos_vendedor t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.gastos_indirectos t),
  (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.aportes_socios t),
  (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.ajustes_saldo_financiador t))) as huella;
