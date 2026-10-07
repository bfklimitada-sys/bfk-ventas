-- Pruebas de 2026-10-07-vendedor-financiador.sql (requiere la migración aplicada).
-- SIEMPRE dentro de una transacción que termina en ROLLBACK:  begin; \i pruebas.sql; rollback;
-- Crea sus propios vendedores, financiadores y OCs (ids tvf_*), como usuario autenticado (igual que la app).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
reset role;
select id as adm from public.perfiles order by (rol = 'admin') desc, id limit 1 \gset
select set_config('t.adm', :'adm', true) \g /dev/null

create or replace function pg_temp.ok(p_nombre text, p_cond boolean, p_det text default '') returns void language plpgsql as $$
begin
  if coalesce(p_cond, false) then raise notice 'RESULT|%|OK', p_nombre; else raise notice 'FALLA|%|%', p_nombre, p_det; end if;
end $$;
create or replace function pg_temp.error(p_nombre text, p_sql text, p_patron text) returns void language plpgsql as $$
begin
  begin execute p_sql; raise notice 'FALLA|%|no falló', p_nombre;
  exception when others then
    if sqlerrm ~* p_patron then raise notice 'RESULT|%|OK', p_nombre; else raise notice 'FALLA|%|%', p_nombre, sqlerrm; end if;
  end;
end $$;
create or replace function pg_temp.oc(p_id text) returns public.ordenes_compra_v2 language sql as $$ select * from public.ordenes_compra_v2 where id = p_id $$;
create or replace function pg_temp.saldo(p_id text) returns numeric language sql as $$ select saldo_deuda from public.financiadores where id = p_id $$;

select pg_temp.ok('P_anon_sin_rpc', not has_function_privilege('anon', 'public.asignar_vendedor_oc(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.asignar_financiador_oc(text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.asignar_vendedor_oc(text,text)', 'execute')) \g /dev/null
select pg_temp.ok('P_disparador_vendedor', exists (select 1 from pg_trigger where tgname = 'oc_proteger_vendedor' and not tgisinternal)) \g /dev/null

-- Huella de lo que no debe cambiar (datos reales)
create temp table _tvf_antes as select 'oc' t, md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.id), '')) h from public.ordenes_compra_v2 o
  union all select 'fin', md5(coalesce(string_agg(to_jsonb(f)::text, ',' order by f.id), '')) from public.financiadores f
  union all select 'pv', md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.id), '')) from public.pagos_vendedor p;
grant select on _tvf_antes to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.adm'), true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.adm'), 'role', 'authenticated')::text, true) \g /dev/null

insert into public.vendedores (id, nombre, activo) values ('tvf_v1', 'Vendedor Prueba Uno', true), ('tvf_v2', 'Vendedor Prueba Dos', true);
insert into public.financiadores (id, nombre, tipo, activo) values ('tvf_f1', 'Vendedor Prueba Uno', 'externo', true), ('tvf_f2', 'Financiador Prueba Dos', 'externo', true);
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values
  ('tvf_a', 'TVF-A-SE26', 'Prueba', 119000), ('tvf_b', 'TVF-B-SE26', 'Prueba', 119000), ('tvf_c', 'TVF-C-SE26', 'Prueba', 119000), ('tvf_d', 'TVF-D-SE26', 'Prueba', 119000);

-- Crear OC: queda Sin definir
select pg_temp.ok('C_oc_nueva_sin_definir', (pg_temp.oc('tvf_a')).vendedor_id is null and (pg_temp.oc('tvf_a')).financiador_id is null) \g /dev/null

-- Vendedor: asignar, cambiar, sin definir
select public.asignar_vendedor_oc('tvf_a', 'tvf_v1') \g /dev/null
select pg_temp.ok('V_asignar', (pg_temp.oc('tvf_a')).vendedor_id = 'tvf_v1'
  and exists (select 1 from public.historial_cambios h where h.oc_id = 'tvf_a' and h.campo = 'vendedor_id' and h.valor_nuevo = 'Vendedor Prueba Uno')) \g /dev/null
select pg_temp.ok('V_sin_cambios', (public.asignar_vendedor_oc('tvf_a', 'tvf_v1') ->> 'sin_cambios')::boolean) \g /dev/null
select public.asignar_vendedor_oc('tvf_a', null) \g /dev/null
select pg_temp.ok('V_sin_definir', (pg_temp.oc('tvf_a')).vendedor_id is null
  and exists (select 1 from public.historial_cambios h where h.oc_id = 'tvf_a' and h.valor_nuevo = 'Sin definir')) \g /dev/null
select pg_temp.error('V_vendedor_inexistente', $q$select public.asignar_vendedor_oc('tvf_a', 'no_existe')$q$, 'no existe') \g /dev/null
select pg_temp.error('V_oc_inexistente', $q$select public.asignar_vendedor_oc('no_existe', 'tvf_v1')$q$, 'no existe') \g /dev/null

-- Comisión ya pagada: el vendedor no se puede cambiar (ni por RPC ni directo); el pago no se toca
select public.asignar_vendedor_oc('tvf_b', 'tvf_v1') \g /dev/null
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tvf_fb', 'tvf_b', '2026-05-10', '990001', 119000, 33);
insert into public.pagos_vendedor (id, vendedor_id, anio, mes, monto_pagado, fecha, estado) values ('tvf_pv1', 'tvf_v1', 2026, 5, 1000, '2026-05-31', 'pagado');
select pg_temp.ok('V_periodo_comision', (select anio = 2026 and mes = 5 from public.fin_periodo_comision('tvf_b'))) \g /dev/null
select pg_temp.error('V_comision_pagada_rpc', $q$select public.asignar_vendedor_oc('tvf_b', 'tvf_v2')$q$, 'ya se pagó') \g /dev/null
select pg_temp.error('V_comision_pagada_directo', $q$update public.ordenes_compra_v2 set vendedor_id = 'tvf_v2' where id = 'tvf_b'$q$, 'ya se pagó') \g /dev/null
select pg_temp.error('V_comision_pagada_a_sin_definir', $q$select public.asignar_vendedor_oc('tvf_b', null)$q$, 'ya se pagó') \g /dev/null
select pg_temp.ok('V_pago_intacto', (select monto_pagado = 1000 from public.pagos_vendedor where id = 'tvf_pv1') and (pg_temp.oc('tvf_b')).vendedor_id = 'tvf_v1') \g /dev/null
-- Pago del NUEVO vendedor en ese mes: sí se permite (queda como comisión adicional)
select public.asignar_vendedor_oc('tvf_c', 'tvf_v2') \g /dev/null
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tvf_fc', 'tvf_c', '2026-05-12', '990002', 119000, 33);
select public.asignar_vendedor_oc('tvf_c', 'tvf_v1') \g /dev/null
select pg_temp.ok('V_cambio_hacia_vendedor_con_pago', (pg_temp.oc('tvf_c')).vendedor_id = 'tvf_v1') \g /dev/null

-- Financiador: asignar, sin definir (sin compra), misma persona que el vendedor
select public.asignar_financiador_oc('tvf_a', 'tvf_f1') \g /dev/null
select public.asignar_vendedor_oc('tvf_a', 'tvf_v1') \g /dev/null
select pg_temp.ok('F_asignar_y_misma_persona', (pg_temp.oc('tvf_a')).financiador_id = 'tvf_f1' and (pg_temp.oc('tvf_a')).vendedor_id = 'tvf_v1') \g /dev/null
select public.asignar_financiador_oc('tvf_a', null) \g /dev/null
select pg_temp.ok('F_sin_definir_sin_compra', (pg_temp.oc('tvf_a')).financiador_id is null) \g /dev/null
select pg_temp.error('F_inexistente', $q$select public.asignar_financiador_oc('tvf_a', 'no_existe')$q$, 'no existe') \g /dev/null

-- Con compra: el cambio traspasa la deuda (base recalcula saldos); no puede quedar sin definir
select public.asignar_financiador_oc('tvf_d', 'tvf_f1') \g /dev/null
insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, financiador_id) values ('tvf_cd', 'tvf_d', current_date, 119000, 70000, 'tvf_f1');
select pg_temp.ok('F_deuda_inicial', pg_temp.saldo('tvf_f1') = 70000 and pg_temp.saldo('tvf_f2') = 0, pg_temp.saldo('tvf_f1')::text) \g /dev/null
select pg_temp.error('F_sin_definir_con_compra', $q$select public.asignar_financiador_oc('tvf_d', null)$q$, 'compra registrada') \g /dev/null
select public.asignar_financiador_oc('tvf_d', 'tvf_f2') \g /dev/null
select pg_temp.ok('F_cambio_traspasa_deuda', pg_temp.saldo('tvf_f1') = 0 and pg_temp.saldo('tvf_f2') = 70000
  and (select financiador_id from public.eventos_compra where id = 'tvf_cd') = 'tvf_f2', pg_temp.saldo('tvf_f1') || '/' || pg_temp.saldo('tvf_f2')) \g /dev/null
-- Financiamiento ya pagado: no se permite cambiar
insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto) values ('tvf_pf', 'tvf_f2', 'tvf_d', current_date, 70000);
select pg_temp.ok('F_pagado', (pg_temp.oc('tvf_d')).estado_pago_financiamiento = 'pagado' and pg_temp.saldo('tvf_f2') = 0) \g /dev/null
select pg_temp.error('F_cambio_con_pagos', $q$select public.asignar_financiador_oc('tvf_d', 'tvf_f1')$q$, 'pagos al financiador') \g /dev/null
select pg_temp.ok('F_pagado_intacto', (pg_temp.oc('tvf_d')).financiador_id = 'tvf_f2' and pg_temp.saldo('tvf_f1') = 0 and pg_temp.saldo('tvf_f2') = 0) \g /dev/null
-- Fondos propios (Cuenta BFK)
select public.asignar_financiador_oc('tvf_c', (select id from public.financiadores where tipo = 'propio' order by id limit 1)) \g /dev/null
select pg_temp.ok('F_fondos_propios', public.fin_tipo_financiamiento('tvf_c') = 'fondos_propios') \g /dev/null

-- Venta propia exige vendedor
select public.asignar_financiador_oc('tvf_a', 'tvf_f1') \g /dev/null
select public.cambiar_financiamiento_oc('tvf_a', 'venta_propia', 'tvf_f1') \g /dev/null
select pg_temp.error('V_venta_propia_exige_vendedor', $q$select public.asignar_vendedor_oc('tvf_a', null)$q$, 'venta propia') \g /dev/null
select public.asignar_financiador_oc('tvf_a', 'tvf_f2') \g /dev/null
select pg_temp.ok('F_venta_propia_conserva', (pg_temp.oc('tvf_a')).es_venta_propia and (pg_temp.oc('tvf_a')).financiador_id = 'tvf_f2') \g /dev/null

select pg_temp.ok('N_consistencia', not exists (select 1 from public.fin_verificar_consistencia())) \g /dev/null
reset role;
set local role anon;
select pg_temp.error('P_anon_no_ejecuta', $q$select public.asignar_vendedor_oc('tvf_a', null)$q$, 'permission denied|permiso') \g /dev/null
reset role;
select pg_temp.ok('N_datos_reales_intactos', not exists (
  select 'oc' t, md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.id), '')) h from public.ordenes_compra_v2 o where o.id not like 'tvf\_%'
  union all select 'fin', md5(coalesce(string_agg(to_jsonb(f)::text, ',' order by f.id), '')) from public.financiadores f where f.id not like 'tvf\_%'
  union all select 'pv', md5(coalesce(string_agg(to_jsonb(p)::text, ',' order by p.id), '')) from public.pagos_vendedor p where p.id not like 'tvf\_%'
  except select t, h from _tvf_antes)) \g /dev/null
