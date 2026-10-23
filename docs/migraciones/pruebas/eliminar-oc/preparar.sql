-- SOLO base desechable: datos ficticios (marcadores 'oe_' / 'OE-'). Réplica del caso Melipilla A (original) y B (duplicada).
\set ON_ERROR_STOP on
begin;
insert into public.financiadores (id, nombre, tipo) values ('oe_fin', 'Financista Prueba OE', 'externo'), ('oe_bfk', 'Cuenta BFK OE', 'propio') on conflict (id) do nothing;
insert into public.vendedores (id, nombre) values ('oe_vend', 'Vendedor Prueba OE') on conflict (id) do nothing;
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, rut_cliente, financiador_id, vendedor_id, monto_total, archivada) values
  ('oe_A', 'OE-1-AG26',   'HOSPITAL FICTICIO', '61.000.000-0', 'oe_fin', 'oe_vend', 130000, false),
  ('oe_B', 'OE-1-AG26-B', 'POR COMPLETAR',     '',             'oe_fin', 'oe_vend', 130000, false),
  ('oe_C', 'OE-3-AG26',   'SIN MOVIMIENTOS',   '',             null,     null,      50000,  false),
  ('oe_D', 'OE-1-AG26-D', 'DUPLICADA CON COBRO EXTRA', '',     'oe_fin', null,      130000, false),
  ('oe_E', 'OE-1-AG26-E', 'DUPLICADA CON CARTOLA', '',         'oe_fin', null,      130000, false),
  ('oe_F', 'OE-6-AG26',   'PAGO REPARTIDO 1', '',              'oe_fin', null,      90000,  false),
  ('oe_G', 'OE-7-AG26',   'PAGO REPARTIDO 2', '',              'oe_fin', null,      90000,  false),
  ('oe_H', 'OE-8-AG26',   'DEVOLUCION PARCIAL', '',            'oe_fin', null,      120000, false),
  ('oe_J', 'OE-9-AG26',   'COMISION SIN VERIFICAR', '',        'oe_bfk', 'oe_vend', 80000,  false),
  ('oe_K', 'OE-10-AG26',  'CORRECCION PENDIENTE', '',          null,     null,      10000,  false),
  ('oe_L', 'OE-11-AG26',  'CON SEGUIMIENTO', '',               null,     null,      10000,  false),
  ('oe_M', 'OE-12-AG26',  'CON COTIZACION', '',                null,     null,      10000,  false),
  ('oe_N', 'OE-13-AG26',  'CON DECISION', '',                  'oe_bfk', null,      70000,  false);
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values
  ('oe_fA', 'oe_A', '2026-04-20', '150', 130000), ('oe_fB', 'oe_B', '2026-04-20', '150', 130000),
  ('oe_fD', 'oe_D', '2026-04-20', '150', 130000), ('oe_fE', 'oe_E', '2026-04-20', '150', 130000),
  ('oe_fJ', 'oe_J', '2026-05-10', '160', 80000);
insert into public.eventos_pago_cliente (id, oc_id, fecha, monto, medio_pago, cobrado_en_banco) values
  ('oe_cA', 'oe_A', '2026-04-20', 130000, 'transferencia', true), ('oe_cB', 'oe_B', '2026-04-20', 130000, 'transferencia', true),
  ('oe_cD', 'oe_D', '2026-04-20', 130000, 'transferencia', true), ('oe_cD2', 'oe_D', '2026-05-02', 50000, 'transferencia', true),
  ('oe_cN', 'oe_N', '2026-10-15', 70000, 'transferencia', true);
insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, financiador_id) values
  ('oe_kA', 'oe_A', '2026-04-17', 130000, 104970, 'oe_fin'), ('oe_kB', 'oe_B', '2026-04-20', 130000, 104970, 'oe_fin'),
  ('oe_kD', 'oe_D', '2026-04-20', 130000, 104970, 'oe_fin'), ('oe_kE', 'oe_E', '2026-04-20', 130000, 104970, 'oe_fin'),
  ('oe_kF', 'oe_F', '2026-06-01', 90000, 60000, 'oe_fin'), ('oe_kG', 'oe_G', '2026-06-02', 90000, 60000, 'oe_fin'),
  ('oe_kH', 'oe_H', '2026-06-03', 120000, 100000, 'oe_fin');
insert into public.eventos_pago_financiamiento (id, oc_id, financiador_id, fecha, monto, creado_por, notas) values
  ('oe_pA', 'oe_A', 'oe_fin', '2026-07-01', 104970, '11111111-1111-1111-1111-111111111111', 'Pago real'),
  ('oe_pB', 'oe_B', 'oe_fin', '2026-04-20', 104970, null, ''),
  ('oe_pD', 'oe_D', 'oe_fin', '2026-04-20', 104970, null, ''),
  ('oe_pH', 'oe_H', 'oe_fin', '2026-07-10', 60000, null, '');
-- Pago repartido FIFO entre F y G: mismas fecha, financiador y transacción.
insert into public.eventos_pago_financiamiento (id, oc_id, financiador_id, fecha, monto, creado_por) values
  ('oe_pF', 'oe_F', 'oe_fin', '2026-07-15', 60000, '11111111-1111-1111-1111-111111111111'),
  ('oe_pG', 'oe_G', 'oe_fin', '2026-07-15', 60000, '11111111-1111-1111-1111-111111111111');
insert into public.eventos_entrega (id, oc_id, fecha) values ('oe_eA', 'oe_A', '2026-04-20'), ('oe_eB', 'oe_B', '2026-04-20'), ('oe_eC', 'oe_C', '2026-05-01');
insert into public.oc_productos_link (id, oc_id, descripcion, url) values ('oe_lA', 'oe_A', 'Producto', 'https://ejemplo.invalid/a'), ('oe_lB', 'oe_B', 'Producto', 'https://ejemplo.invalid/b');
insert into public.oc_comentarios (id, oc_id, usuario_nombre, texto) values ('oe_coB', 'oe_B', 'Prueba', 'Duplicada de la importación');
insert into public.historial_cambios (id, oc_id, oc_numero, usuario_nombre, accion) values ('oe_hA', 'oe_A', 'OE-1-AG26', 'Prueba', 'Creada'), ('oe_hB', 'oe_B', 'OE-1-AG26-B', 'Prueba', 'Importada'), ('oe_hB2', 'oe_B', 'OE-1-AG26-B', 'Prueba', 'OC restaurada'), ('oe_hC', 'oe_C', 'OE-3-AG26', 'Prueba', 'Creada');
insert into public.trib_clasificaciones (ambito, oc_id, tratamiento, solicitado_por) values ('oc', 'oe_C', 'afecta', '11111111-1111-1111-1111-111111111111');
insert into public.correos_bfk (message_id, buzon, fecha, categoria, prioridad, asociacion, oc_id) values ('<oe-b@ejemplo.invalid>', 'ventas', now(), 'general', 1, 'numero_oc', 'oe_B');
insert into public.notificaciones (id, tipo, oc_id, oc_numero, mensaje) values ('oe_nB', 'aviso', 'oe_B', 'OE-1-AG26-B', 'Aviso');
-- Comisión: abril pagado CON monto verificado (B); mayo pagado SIN verificar (J).
insert into public.pagos_vendedor (id, vendedor_id, anio, mes, monto_calculado, monto_pagado, monto_verificado, fecha) values
  ('oe_pv4', 'oe_vend', 2026, 4, 12000, 12000, 12000, '2026-04-30'), ('oe_pv5', 'oe_vend', 2026, 5, 9000, 9000, null, '2026-05-31');
insert into public.fin_diferencias_historicas (entidad, entidad_id, campo, causa, clasificacion, estado, bloquea) values ('oc', 'oe_K', 'monto_cobrado', 'Prueba', 'decision', 'pendiente', array['cobro']);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true) as _jwt \gset
insert into public.oc_seguimientos (id, oc_id, categoria, descripcion) values ('oe_sL', 'oe_L', 'otro', 'Seguimiento');
insert into public.cotizaciones (nombre, oc_codigo, estado, vendedor_id, vendedor_nombre) values ('Cotización OE', 'OE-12-AG26', 'adjudicada', 'oe_vend', 'Vendedor Prueba OE');
commit;
-- Cartola: devolución de E conciliada con el banco (solo la vía de la cartola pone la marca).
begin;
select set_config('bfk.cartola_rpc', '1', true);
insert into public.eventos_pago_financiamiento (id, oc_id, financiador_id, fecha, monto, marca_cartola, marca_parte, marca_partes) values ('oe_pE', 'oe_E', 'oe_fin', '2026-04-20', 104970, 'cart:20260420:104970:0:1:1', 1, 1);
commit;
insert into public.conciliacion_decisiones (marca, decision, tabla, registro_id, monto_registro, mov_fecha, mov_monto, mov_sentido, usuario)
values ('cart:20261015:0:70000:1:1', 'vinculado', 'eventos_pago_cliente', 'oe_cN', 70000, '2026-10-15', 70000, 'entra', '11111111-1111-1111-1111-111111111111');
select public.fin_recalcular(array(select id from public.ordenes_compra_v2 where id like 'oe\_%'), array['oe_fin','oe_bfk']);
