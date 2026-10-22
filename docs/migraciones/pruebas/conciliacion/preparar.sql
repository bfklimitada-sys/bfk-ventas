-- SOLO base desechable: datos ficticios (marcadores 'cs_' / 'CS-').
\set ON_ERROR_STOP on
begin;
insert into public.financiadores (id, nombre, tipo) values ('cs_fin_bfk', 'Cuenta BFK CS', 'propio'), ('cs_fin_ext', 'Financista Externo CS', 'externo') on conflict (id) do nothing;
insert into public.categorias_gasto (id, nombre) values ('cat_impuesto', 'Impuesto SII'), ('cs_cat_otros', 'Otros CS') on conflict (id) do nothing;
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, rut_cliente, financiador_id, monto_total) values
  ('cs_oc1', 'CS-1-AG26', 'UNIVERSIDAD FICTICIA', '70.000.000-1', 'cs_fin_bfk', 124798),
  ('cs_oc2', 'CS-2-AG26', 'MUNICIPALIDAD FICTICIA', '69.000.000-2', 'cs_fin_ext', 500000),
  ('cs_oc3', 'CS-3-AG26', 'UNIVERSIDAD FICTICIA', '70.000.000-1', 'cs_fin_bfk', 676001);
insert into public.eventos_pago_cliente (id, oc_id, fecha, monto, medio_pago, cobrado_en_banco) values
  ('cs_c1', 'cs_oc1', '2026-10-15', 124798, 'transferencia', false),
  ('cs_c2', 'cs_oc2', '2026-10-15', 300000, 'vale_vista', false),
  ('cs_c3', 'cs_oc2', '2026-10-15', 50000, 'retencion', false),
  ('cs_c4', 'cs_oc2', '2026-09-30', 70000, 'transferencia', false),
  ('cs_c5', 'cs_oc3', '2026-10-16', 676001, 'transferencia', false);
insert into public.gastos_indirectos (id, categoria_id, subcategoria, monto, mes, anio, fecha, detalle) values
  ('cs_g_iva', 'cat_impuesto', 'IVA Mensual', 400000, 10, 2026, '2026-10-20', 'IVA septiembre'),
  ('cs_g_ppm', 'cat_impuesto', 'PPM', 35000, 10, 2026, '2026-10-20', 'PPM septiembre'),
  ('cs_g1', 'cs_cat_otros', null, 250000, 10, 2026, '2026-10-14', 'Arriendo'),
  ('cs_g2', 'cs_cat_otros', null, 250000, 10, 2026, '2026-10-14', 'Servicio');
insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, financiador_id, proveedor) values
  ('cs_k1', 'cs_oc1', '2026-10-16', 100000, 80000, 'cs_fin_bfk', 'Proveedor CS'),
  ('cs_k2', 'cs_oc2', '2026-10-16', 100000, 90000, 'cs_fin_ext', 'Proveedor CS');
commit;
