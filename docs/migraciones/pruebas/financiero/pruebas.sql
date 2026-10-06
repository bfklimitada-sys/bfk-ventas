-- Fase 4B · Pruebas funcionales de la integridad financiera.
-- Se ejecuta SIEMPRE dentro de una transacción que termina en ROLLBACK (base desechable o producción):
--   begin; \i pruebas.sql; rollback;
-- Crea sus propias OCs y financiadores de prueba (ids t4b_*), usa usuarios reales (administrador y usuario normal)
-- y verifica también que las diferencias históricas quedan protegidas. No imprime datos de clientes.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned

select id as adm from public.perfiles where rol = 'admin' order by id limit 1 \gset
select id as usr from public.perfiles where rol is distinct from 'admin' order by id limit 1 \gset
select set_config('t.adm', :'adm', true), set_config('t.usr', :'usr', true) \g /dev/null

create function pg_temp.ok(p_nombre text, p_cond boolean, p_det text default '') returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RESULT|%|OK', p_nombre; else raise notice 'FALLA|%|%', p_nombre, p_det; end if;
end $$;
create function pg_temp.error(p_nombre text, p_sql text, p_patron text) returns void language plpgsql as $$
begin
  begin execute p_sql; raise notice 'FALLA|%|no falló', p_nombre;
  exception when others then
    if sqlerrm ~* p_patron then raise notice 'RESULT|%|OK', p_nombre; else raise notice 'FALLA|%|%', p_nombre, sqlerrm; end if;
  end;
end $$;
create function pg_temp.como(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_uid, true), set_config('request.jwt.claim.role', 'authenticated', true),
          set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $$;
create function pg_temp.oc(p_id text) returns public.ordenes_compra_v2 language sql as $$ select * from public.ordenes_compra_v2 where id = p_id $$;
create function pg_temp.saldo(p_id text) returns numeric language sql as $$ select saldo_deuda from public.financiadores where id = p_id $$;

-- Foto de lo que NO debe cambiar: todas las OCs y financiadores reales.
create temp table _t_antes as select o.id, md5(to_jsonb(o)::text) h from public.ordenes_compra_v2 o;
create temp table _t_antes_fin as select f.id, f.saldo_deuda from public.financiadores f;
create temp table _t_hist as select count(*) total from public.historial_cambios;
grant all on _t_antes, _t_antes_fin, _t_hist to authenticated;

set local role authenticated;
select pg_temp.como(current_setting('t.adm')) \g /dev/null

do $$
declare v jsonb; ev text; o public.ordenes_compra_v2; v_hoy date := current_date;
begin
  -- T01-T02: el navegador no puede fijar totales al crear
  insert into public.financiadores (id, nombre, saldo_deuda) values ('t4b_fin_a', 'Prueba 4B A', 999), ('t4b_fin_b', 'Prueba 4B B', 5);
  perform pg_temp.ok('T01_saldo_de_financiador_nuevo_lo_fija_la_base', pg_temp.saldo('t4b_fin_a') = 0 and pg_temp.saldo('t4b_fin_b') = 0);
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total, costo_total, estado_compra, monto_cobrado, estado_pago_cliente, monto_pagado_fin, estado_pago_financiamiento)
  values ('t4b_oc1', 'T4B-PRUEBA-1', 'Prueba 4B', 500000, 123, 'comprado', 77, 'pagado', 5, 'pagado');
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T02_totales_de_oc_nueva_los_fija_la_base',
    o.costo_total = 0 and o.estado_compra = 'pendiente' and o.monto_cobrado = 0 and o.estado_pago_cliente = 'pendiente'
    and o.monto_pagado_fin = 0 and o.estado_pago_financiamiento = 'pendiente');

  -- T03: compra atómica
  v := public.registrar_compra_oc('t4b_oc1', v_hoy, 300000, 't4b_fin_a', 'Proveedor prueba');
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T03_compra_actualiza_oc_y_deuda', o.costo_total = 300000 and o.estado_compra = 'comprado'
    and o.estado_pago_financiamiento = 'pendiente' and o.financiador_id = 't4b_fin_a' and pg_temp.saldo('t4b_fin_a') = 300000
    and (v ->> 'saldo_financiador')::numeric = 300000, v::text);

  -- T04: pago parcial
  v := public.registrar_pago_financiador('t4b_fin_a', v_hoy, 100000, '[{"oc_id":"t4b_oc1","monto":100000}]', 'prueba');
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T04_pago_parcial', o.monto_pagado_fin = 100000 and o.estado_pago_financiamiento = 'parcial' and pg_temp.saldo('t4b_fin_a') = 200000, v::text);

  -- T05: asignación mayor que la deuda: rechazada sin cambios
  perform pg_temp.error('T05_asignacion_mayor_que_deuda_rechazada',
    $q$select public.registrar_pago_financiador('t4b_fin_a', current_date, 250000, '[{"oc_id":"t4b_oc1","monto":250000}]')$q$, 'supera lo que se adeuda');
  perform pg_temp.ok('T05b_sin_cambios_tras_rechazo', pg_temp.saldo('t4b_fin_a') = 200000 and (pg_temp.oc('t4b_oc1')).monto_pagado_fin = 100000);

  -- T06: corregir compra
  select e.id into ev from public.eventos_compra e where e.oc_id = 't4b_oc1';
  v := public.editar_compra_oc(ev, v_hoy, 350000);
  perform pg_temp.ok('T06_corregir_compra_recalcula', (pg_temp.oc('t4b_oc1')).costo_total = 350000 and pg_temp.saldo('t4b_fin_a') = 250000
    and (pg_temp.oc('t4b_oc1')).estado_pago_financiamiento = 'parcial', v::text);
  perform pg_temp.error('T06b_costo_bajo_lo_pagado_rechazado', format($q$select public.editar_compra_oc(%L, current_date, 50000)$q$, ev), 'bajo lo ya pagado');

  -- T07: la versión anterior de la aplicación escribe totales calculados en el navegador: se ignoran
  update public.ordenes_compra_v2 set costo_total = 1, monto_pagado_fin = 999999, estado_pago_financiamiento = 'pagado',
         monto_facturado = 5, estado_factura_propia = 'emitida', monto_cobrado = 5, estado_pago_cliente = 'pagado', estado_compra = 'pendiente'
   where id = 't4b_oc1';
  update public.financiadores set saldo_deuda = 0 where id = 't4b_fin_a';
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T07_escrituras_de_totales_desde_el_navegador_ignoradas', o.costo_total = 350000 and o.monto_pagado_fin = 100000
    and o.estado_pago_financiamiento = 'parcial' and o.monto_facturado = 0 and o.estado_compra = 'comprado' and pg_temp.saldo('t4b_fin_a') = 250000);

  -- T08: un evento escrito directamente (versión anterior) también recalcula
  insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto) values ('t4b_pago_directo', 't4b_fin_a', 't4b_oc1', v_hoy, 50000);
  perform pg_temp.ok('T08_evento_directo_recalcula', (pg_temp.oc('t4b_oc1')).monto_pagado_fin = 150000 and pg_temp.saldo('t4b_fin_a') = 200000);

  -- T09-T11: corregir y eliminar pagos
  v := public.editar_pago_financiador('t4b_pago_directo', v_hoy, 60000);
  perform pg_temp.ok('T09_corregir_pago', (pg_temp.oc('t4b_oc1')).monto_pagado_fin = 160000 and pg_temp.saldo('t4b_fin_a') = 190000, v::text);
  perform pg_temp.error('T10_pago_que_supera_el_costo_rechazado', $q$select public.editar_pago_financiador('t4b_pago_directo', current_date, 300000)$q$, 'superarían su costo');
  v := public.eliminar_pago_financiador('t4b_pago_directo');
  perform pg_temp.ok('T11_eliminar_pago_revierte_monto_pagado_y_deuda', (pg_temp.oc('t4b_oc1')).monto_pagado_fin = 100000
    and pg_temp.saldo('t4b_fin_a') = 250000 and (pg_temp.oc('t4b_oc1')).estado_pago_financiamiento = 'parcial', v::text);

  -- T12: pago sin OC mayor que la deuda: el exceso queda a favor de BFK (ya no se pierde en cero)
  v := public.registrar_pago_financiador('t4b_fin_a', v_hoy, 400000, '[]', 'prueba');
  perform pg_temp.ok('T12_saldo_a_favor_no_se_pierde', pg_temp.saldo('t4b_fin_a') = -150000 and (v ->> 'sobrante')::numeric = 400000, v::text);
  select p.id into ev from public.eventos_pago_financiamiento p where p.financiador_id = 't4b_fin_a' and p.oc_id is null;
  perform public.eliminar_pago_financiador(ev);

  -- T13-T14: pago que completa la OC
  v := public.registrar_pago_financiador('t4b_fin_a', v_hoy, 250000, '[{"oc_id":"t4b_oc1","monto":250000}]', 'prueba');
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T13_pago_completo', o.monto_pagado_fin = 350000 and o.estado_pago_financiamiento = 'pagado' and pg_temp.saldo('t4b_fin_a') = 0, v::text);
  perform pg_temp.error('T14_pago_a_oc_ya_pagada_rechazado',
    $q$select public.registrar_pago_financiador('t4b_fin_a', current_date, 1000, '[{"oc_id":"t4b_oc1","monto":1000}]')$q$, 'ya figura con el financiamiento pagado');

  -- T15: fondos propios no reciben pagos (regla 2)
  perform pg_temp.error('T15_pago_a_fondos_propios_rechazado',
    $q$select public.registrar_pago_financiador('fin_cuenta_bfk', current_date, 1000, '[]')$q$, 'fondos propios');

  -- T16: cambiar financiamiento con pagos registrados: rechazado
  perform pg_temp.error('T16_cambio_de_financiamiento_con_pagos_rechazado',
    $q$select public.cambiar_financiamiento_oc('t4b_oc1', 'externo', 't4b_fin_b')$q$, 'tiene pagos al financiador');
end $$;

do $$
declare v jsonb; o public.ordenes_compra_v2; s_bfk numeric := pg_temp.saldo('fin_cuenta_bfk'); v_hoy date := current_date;
begin
  -- T17-T21: cambio de financiador y de tipo de financiamiento (M2)
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('t4b_oc2', 'T4B-PRUEBA-2', 'Prueba 4B', 300000);
  perform public.registrar_compra_oc('t4b_oc2', v_hoy, 200000, 't4b_fin_a');
  perform pg_temp.ok('T17a_deuda_con_financiador_a', pg_temp.saldo('t4b_fin_a') = 200000);
  v := public.cambiar_financiamiento_oc('t4b_oc2', 'externo', 't4b_fin_b');
  perform pg_temp.ok('T17_cambio_de_financiador_mueve_la_deuda', pg_temp.saldo('t4b_fin_a') = 0 and pg_temp.saldo('t4b_fin_b') = 200000
    and (select e.financiador_id from public.eventos_compra e where e.oc_id = 't4b_oc2') = 't4b_fin_b', v::text);
  v := public.cambiar_financiamiento_oc('t4b_oc2', 'fondos_propios');
  o := pg_temp.oc('t4b_oc2');
  perform pg_temp.ok('T18_fondos_propios_no_es_deuda', o.estado_pago_financiamiento = 'no_aplica' and o.financiador_id = 'fin_cuenta_bfk'
    and pg_temp.saldo('t4b_fin_b') = 0 and pg_temp.saldo('fin_cuenta_bfk') = s_bfk, v::text);
  perform pg_temp.error('T19_venta_propia_sin_vendedor_rechazada', $q$select public.cambiar_financiamiento_oc('t4b_oc2', 'venta_propia')$q$, 'requiere un vendedor');
  update public.ordenes_compra_v2 set vendedor_id = (select id from public.vendedores order by id limit 1) where id = 't4b_oc2';
  v := public.cambiar_financiamiento_oc('t4b_oc2', 'externo', 't4b_fin_a');
  perform pg_temp.ok('T19b_vuelve_a_externo', (pg_temp.oc('t4b_oc2')).estado_pago_financiamiento = 'pendiente' and pg_temp.saldo('t4b_fin_a') = 200000, v::text);
  v := public.cambiar_financiamiento_oc('t4b_oc2', 'venta_propia');
  o := pg_temp.oc('t4b_oc2');
  perform pg_temp.ok('T20_venta_propia_no_genera_deuda_y_no_aplica', o.es_venta_propia and o.estado_pago_financiamiento = 'no_aplica'
    and pg_temp.saldo('t4b_fin_a') = 0, v::text);
  perform pg_temp.error('T21_pago_a_venta_propia_rechazado',
    $q$select public.registrar_pago_financiador('t4b_fin_a', current_date, 1000, '[{"oc_id":"t4b_oc2","monto":1000}]')$q$, 'no aplica');
  -- venta propia desde la creación: la compra no genera deuda
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total, vendedor_id, es_venta_propia, financiador_id)
  values ('t4b_oc3', 'T4B-PRUEBA-3', 'Prueba 4B', 90000, (select id from public.vendedores order by id limit 1), true, 't4b_fin_b');
  perform pg_temp.ok('T21b_venta_propia_nueva_no_aplica_desde_el_inicio', (pg_temp.oc('t4b_oc3')).estado_pago_financiamiento = 'no_aplica');
  perform public.registrar_compra_oc('t4b_oc3', v_hoy, 60000, null);
  perform pg_temp.ok('T21c_compra_de_venta_propia_sin_deuda', (pg_temp.oc('t4b_oc3')).costo_total = 60000 and pg_temp.saldo('t4b_fin_b') = 0);
end $$;

do $$
declare o public.ordenes_compra_v2; v_hoy date := current_date;
begin
  -- T22: facturas vigentes y cobro (regla 4 y comportamiento futuro de facturación)
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('t4b_f1', 't4b_oc1', v_hoy, 'T4B-F1', 500000);
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T22a_factura_emitida', o.monto_facturado = 500000 and o.estado_factura_propia = 'emitida' and o.estado_pago_cliente = 'pendiente');
  insert into public.eventos_pago_cliente (id, oc_id, fecha, monto) values ('t4b_c1', 't4b_oc1', v_hoy, 200000);
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T22b_cobro_parcial', o.monto_cobrado = 200000 and o.estado_pago_cliente = 'parcial');
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, nota_credito, factura_anulada_numero)
  values ('t4b_f2', 't4b_oc1', v_hoy, 'T4B-F2', 450000, 'T4B-NC1', 'T4B-F1');
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T22c_reemision_solo_cuenta_la_vigente', o.monto_facturado = 450000 and o.estado_factura_propia = 'emitida');
  insert into public.eventos_pago_cliente (id, oc_id, fecha, monto) values ('t4b_c2', 't4b_oc1', v_hoy, 250000);
  perform pg_temp.ok('T22d_cobro_completo_contra_factura_vigente', (pg_temp.oc('t4b_oc1')).estado_pago_cliente = 'pagado');
  delete from public.eventos_factura where id = 't4b_f2';
  o := pg_temp.oc('t4b_oc1');
  perform pg_temp.ok('T22e_borrar_reemision_reactiva_la_anterior_y_recalcula_cobro', o.monto_facturado = 500000 and o.estado_pago_cliente = 'parcial');
  delete from public.eventos_pago_cliente where id = 't4b_c2';
  perform pg_temp.ok('T22f_borrar_cobro_recalcula', (pg_temp.oc('t4b_oc1')).monto_cobrado = 200000);
  update public.eventos_factura set monto = 480000 where id = 't4b_f1';
  perform pg_temp.ok('T22g_corregir_factura_recalcula', (pg_temp.oc('t4b_oc1')).monto_facturado = 480000);

  -- T23: ajustes manuales son dato fuente del saldo
  insert into public.ajustes_saldo_financiador (id, financiador_id, fecha, monto_ajuste, motivo) values ('t4b_aj1', 't4b_fin_b', v_hoy, 12345, 'prueba');
  perform pg_temp.ok('T23a_ajuste_suma_al_saldo', pg_temp.saldo('t4b_fin_b') = 12345);
  delete from public.ajustes_saldo_financiador where id = 't4b_aj1';
  perform pg_temp.ok('T23b_quitar_ajuste_revierte', pg_temp.saldo('t4b_fin_b') = 0);
end $$;

do $$
declare v_oc text; v_num text; v_fac text; v_aj text; v_pf text; s0 numeric; v jsonb; v_hoy date := current_date;
begin
  -- T24: las OCs con diferencia histórica pendiente quedan bloqueadas en su dominio
  select d.entidad_id into v_oc from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.estado = 'pendiente' and 'financiamiento' = any(d.bloquea) order by d.entidad_id limit 1;
  if v_oc is null then
    perform pg_temp.ok('T24_bloqueo_financiamiento_historico', true);
  else
    perform set_config('t.oc', v_oc, true);
    perform pg_temp.error('T24a_compra_en_oc_historica_bloqueada', format($q$select public.registrar_compra_oc(%L, current_date, 1000)$q$, v_oc), 'corrección histórica pendiente');
    perform pg_temp.error('T24b_pago_directo_en_oc_historica_bloqueado',
      format($q$insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto) select 't4b_x', financiador_id, id, current_date, 1 from public.ordenes_compra_v2 where id = %L$q$, v_oc), 'corrección histórica pendiente');
    perform pg_temp.error('T24c_cambio_de_financiador_bloqueado', format($q$update public.ordenes_compra_v2 set financiador_id = 't4b_fin_a' where id = %L$q$, v_oc), 'corrección histórica pendiente');
    perform pg_temp.error('T24d_borrar_compra_historica_bloqueado', format($q$delete from public.eventos_compra where oc_id = %L$q$, v_oc), 'corrección histórica pendiente');
  end if;
  select d.entidad_id into v_fac from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.estado = 'pendiente' and 'facturacion' = any(d.bloquea) order by d.entidad_id limit 1;
  if v_fac is not null then
    perform pg_temp.error('T24e_factura_en_oc_con_facturacion_pendiente_bloqueada',
      format($q$insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('t4b_fx', %L, current_date, 'T4B-FX', 1)$q$, v_fac), 'corrección histórica pendiente');
  else
    perform pg_temp.ok('T24e_factura_en_oc_con_facturacion_pendiente_bloqueada', true);
  end if;
  -- T25: filas fuente de una diferencia de financiador no se pueden editar ni borrar
  select substr(f, length('ajustes_saldo_financiador:') + 1) into v_aj from public.fin_diferencias_historicas d, unnest(d.filas) f
   where d.estado = 'pendiente' and f like 'ajustes_saldo_financiador:%' limit 1;
  if v_aj is not null then
    perform pg_temp.error('T25a_ajuste_historico_bloqueado', format($q$update public.ajustes_saldo_financiador set monto_ajuste = monto_ajuste + 1 where id = %L$q$, v_aj), 'corrección histórica pendiente');
  else perform pg_temp.ok('T25a_ajuste_historico_bloqueado', true); end if;
  select substr(f, length('eventos_pago_financiamiento:') + 1) into v_pf from public.fin_diferencias_historicas d, unnest(d.filas) f
   where d.estado = 'pendiente' and f like 'eventos_pago_financiamiento:%' limit 1;
  if v_pf is not null then
    perform pg_temp.error('T25b_pago_historico_bloqueado', format($q$select public.eliminar_pago_financiador(%L)$q$, v_pf), 'corrección histórica pendiente');
  else perform pg_temp.ok('T25b_pago_historico_bloqueado', true); end if;

  -- T29: con diferencias congeladas, las operaciones nuevas suman exacto sobre el saldo guardado
  select f.id into v_aj from public.financiadores f join public.fin_diferencias_historicas d on d.entidad = 'financiador' and d.entidad_id = f.id
   where f.tipo = 'externo' order by f.id limit 1;
  v_aj := coalesce(v_aj, (select f.id from public.financiadores f where f.tipo = 'externo' and f.id not like 't4b%' order by f.id limit 1));
  s0 := pg_temp.saldo(v_aj);
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('t4b_oc4', 'T4B-PRUEBA-4', 'Prueba 4B', 200000);
  perform public.registrar_compra_oc('t4b_oc4', v_hoy, 123456, v_aj);
  perform public.registrar_pago_financiador(v_aj, v_hoy, 23456, '[{"oc_id":"t4b_oc4","monto":23456}]', 'prueba');
  perform pg_temp.ok('T29_saldo_historico_mas_operaciones_nuevas_exacto', pg_temp.saldo(v_aj) = s0 + 100000, s0::text || ' -> ' || pg_temp.saldo(v_aj)::text);
end $$;

-- T26-T27: usuario normal (no administrador)
select pg_temp.como(current_setting('t.usr')) \g /dev/null
do $$
declare ev text; v jsonb;
begin
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('t4b_oc5', 'T4B-PRUEBA-5', 'Prueba 4B', 100000);
  v := public.registrar_compra_oc('t4b_oc5', current_date, 40000, 't4b_fin_b');
  perform pg_temp.ok('T26_usuario_normal_registra_compras', (pg_temp.oc('t4b_oc5')).costo_total = 40000 and pg_temp.saldo('t4b_fin_b') = 40000, v::text);
  select e.id into ev from public.eventos_compra e where e.oc_id = 't4b_oc5';
  perform pg_temp.error('T27a_usuario_normal_no_elimina_compras', format($q$select public.eliminar_compra_oc(%L)$q$, ev), 'Solo un administrador');
  v := public.registrar_pago_financiador('t4b_fin_b', current_date, 10000, '[{"oc_id":"t4b_oc5","monto":10000}]', 'prueba');
  select p.id into ev from public.eventos_pago_financiamiento p where p.oc_id = 't4b_oc5';
  perform pg_temp.error('T27b_usuario_normal_no_elimina_pagos', format($q$select public.eliminar_pago_financiador(%L)$q$, ev), 'Solo un administrador');
  perform pg_temp.ok('T27c_sin_cambios_tras_rechazos', (pg_temp.oc('t4b_oc5')).monto_pagado_fin = 10000 and pg_temp.saldo('t4b_fin_b') = 30000);
end $$;
select pg_temp.como(current_setting('t.adm')) \g /dev/null

do $$
declare ev text;
begin
  -- T32: eliminar la única compra con pagos: rechazado; sin pagos: permitido y recalcula
  select e.id into ev from public.eventos_compra e where e.oc_id = 't4b_oc5';
  perform pg_temp.error('T32a_eliminar_unica_compra_con_pagos_rechazado', format($q$select public.eliminar_compra_oc(%L)$q$, ev), 'elimínelos antes');
  select e.id into ev from public.eventos_compra e where e.oc_id = 't4b_oc3';
  perform public.eliminar_compra_oc(ev);
  perform pg_temp.ok('T32b_eliminar_compra_recalcula', (pg_temp.oc('t4b_oc3')).costo_total = 0 and (pg_temp.oc('t4b_oc3')).estado_compra = 'pendiente');
end $$;

reset role;
-- T28: anónimo sin permiso de ejecución
set local role anon;
do $$ begin
  begin perform public.registrar_compra_oc('t4b_oc1', current_date, 1); raise notice 'FALLA|T28_anonimo_sin_permiso|ejecutó';
  exception when insufficient_privilege then raise notice 'RESULT|T28_anonimo_sin_permiso|OK';
            when others then raise notice 'FALLA|T28_anonimo_sin_permiso|%', sqlerrm; end;
end $$;
reset role;

-- T30-T31: coherencia total, valores reales intactos y trazabilidad
do $$
declare n int;
begin
  select count(*) into n from public.fin_verificar_consistencia();
  perform pg_temp.ok('T30_todo_coherente_tras_las_pruebas', n = 0, n::text);
  select count(*) into n from _t_antes a join public.ordenes_compra_v2 o on o.id = a.id where a.h <> md5(to_jsonb(o)::text);
  perform pg_temp.ok('T31a_ninguna_oc_real_cambio', n = 0, n::text);
  select count(*) into n from _t_antes_fin a join public.financiadores f on f.id = a.id
   where f.saldo_deuda is distinct from a.saldo_deuda and f.id <> (select f2.id from public.financiadores f2 join public.eventos_compra e on e.financiador_id = f2.id where e.oc_id = 't4b_oc4');
  perform pg_temp.ok('T31b_ningun_saldo_real_cambio_salvo_el_de_la_prueba_T29', n = 0, n::text);
  select count(*) - (select h.total from _t_hist h) into n from public.historial_cambios;
  perform pg_temp.ok('T31c_historial_registra_las_operaciones', n >= 15, n::text);
  perform pg_temp.ok('T31d_importacion_exacta_sin_recalculo',
    exists (select 1 from pg_proc p where p.proname = 'importar_respaldo_excel' and 'bfk.importacion=on' = any(p.proconfig)));
end $$;
