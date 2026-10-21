-- SOLO base desechable / copia: datos sintéticos (marcadores 'vr_' / 'VR-').
\set ON_ERROR_STOP on
begin;
insert into public.vendedores (id, nombre, activo) values ('vr_v2', 'Vendedora Dos VR', true), ('vr_v3', 'Vendedor Inactivo VR', false) on conflict (id) do nothing;
insert into public.cotizacion_vendedores (id, nombre, clave, activo, creado_por) values ('7e000000-0000-4000-8000-0000000000c1', 'Vendedor Solo Cotizaciones VR', 'vendedor solo cotizaciones vr', true, :'adm') on conflict do nothing;
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, vendedor_id) values
  ('vr_oc_1', 'VR-1-AG26', 'PRUEBA VENDEDOR', null), ('vr_oc_2', 'VR-2-AG26', 'PRUEBA VENDEDOR', :'v_oc2'), ('vr_oc_3', 'VR-3-AG26', 'PRUEBA VENDEDOR', null);
-- histórica: presentada SIN vendedor, escrita directamente (como las existentes antes de la regla)
insert into public.cotizaciones (id, nombre, estado, creado_por) values ('7e000000-0000-4000-8000-0000000000a1', 'VR histórica sin vendedor', 'presentada', :'adm');
-- cotización exenta con clasificación aprobada (para la compatibilidad con ventas exentas)
select set_config('bfk.trib_rpc', '1', true);
insert into public.cotizaciones (id, nombre, estado, creado_por) values ('7e000000-0000-4000-8000-0000000000e1', 'VR exenta', 'borrador', :'adm');
update public.cotizaciones set tratamiento_iva = 'exenta_fora', fundamento_iva = 'Art. 101 Ley 18.948 (PRUEBA)', respaldo_iva = 'Oficio ficticio',
  tratamiento_aprobado_por = :'adm', tratamiento_aprobado_en = now(), clasificacion_id = '00000000-0000-4000-8000-0000000000e1' where id = '7e000000-0000-4000-8000-0000000000e1';
commit;
