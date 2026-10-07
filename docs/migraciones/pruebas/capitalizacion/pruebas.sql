-- Pruebas de 2026-10-07-capitalizacion-comisiones.sql (requiere la migración aplicada). SIEMPRE en una transacción con ROLLBACK.
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
create or replace function pg_temp.oc(p_num text) returns public.ordenes_compra_v2 language sql as $$ select * from public.ordenes_compra_v2 where numero_oc = p_num $$;

-- Datos aplicados
select pg_temp.ok('D_5_capitalizacion', (select count(*) from public.ordenes_compra_v2 where capitalizacion_bfk) = 5
  and (select bool_and(vendedor_id is null and not es_venta_propia) from public.ordenes_compra_v2 where capitalizacion_bfk)
  and (select string_agg(numero_oc, ',' order by numero_oc) from public.ordenes_compra_v2 where capitalizacion_bfk)
      = 'PUENTE-INALAMBRICO,SOC-RAMIREZ-ALDANA-1,SOC-RAMIREZ-ALDANA-2,SOC-RAMIREZ-ALDANA-3,SOC-RAMIREZ-ALDANA-4') \g /dev/null
select pg_temp.ok('D_capitalizacion_conserva_financiador', (select bool_and(financiador_id = 'fin_cuenta_bfk') from public.ordenes_compra_v2 where capitalizacion_bfk)) \g /dev/null
select pg_temp.ok('D_19_excluidas_matias', (select count(*) from public.ordenes_compra_v2 where comision_excluida and vendedor_id = 'vend_matias') = 19
  and (select count(*) from public.ordenes_compra_v2 where comision_excluida) = 19) \g /dev/null
select pg_temp.ok('D_agosto_incluidas', (select bool_and(vendedor_id = 'vend_matias' and not comision_excluida) from public.ordenes_compra_v2
  where numero_oc in ('2905-498-AG26','233-40-AG26','4168-1088-AG26','2279-468-AG26'))) \g /dev/null
select pg_temp.ok('D_ningun_sin_vendedor_activo', not exists (select 1 from public.ordenes_compra_v2 where not archivada and vendedor_id is null and not capitalizacion_bfk
  and coalesce(tipo_registro, 'venta') <> 'aporte_socio')) \g /dev/null
select pg_temp.ok('D_registro_e_historial', (select count(*) from public.fin_correcciones_registro where lote = 'capitalizacion-comisiones-20261007' and revertida_en is null) = 47
  and (select count(*) from public.historial_cambios where usuario_nombre = 'Migración vendedor/financiador' and (accion like 'Marcada como venta de capitalización%' or accion like 'Vendedor completado desde Contabilidad General%')) >= 28) \g /dev/null
select pg_temp.ok('N_consistencia', not exists (select 1 from public.fin_verificar_consistencia())) \g /dev/null

-- Reglas (como usuario autenticado)
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.adm'), true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.adm'), 'role', 'authenticated')::text, true) \g /dev/null
select pg_temp.error('R_capitalizacion_no_admite_vendedor', $q$update public.ordenes_compra_v2 set vendedor_id = 'vend_matias' where numero_oc = 'PUENTE-INALAMBRICO'$q$, 'capitalizacion|check') \g /dev/null
insert into public.vendedores (id, nombre, activo) values ('tcap_v1', 'Vendedor Cap Uno', true);
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('tcap_a', 'TCAP-A-SE26', 'Prueba', 119000), ('tcap_b', 'TCAP-B-SE26', 'Prueba', 119000);
select public.asignar_vendedor_oc('tcap_a', '__capitalizacion__') \g /dev/null
select pg_temp.ok('R_rpc_marca_capitalizacion', (pg_temp.oc('TCAP-A-SE26')).capitalizacion_bfk and (pg_temp.oc('TCAP-A-SE26')).vendedor_id is null
  and exists (select 1 from public.historial_cambios where oc_id = 'tcap_a' and valor_nuevo = 'BFK Ltda. · Capitalización')) \g /dev/null
select pg_temp.ok('R_rpc_capitalizacion_sin_cambios', (public.asignar_vendedor_oc('tcap_a', '__capitalizacion__') ->> 'sin_cambios')::boolean) \g /dev/null
select public.asignar_vendedor_oc('tcap_a', 'tcap_v1') \g /dev/null
select pg_temp.ok('R_rpc_de_capitalizacion_a_vendedor', not (pg_temp.oc('TCAP-A-SE26')).capitalizacion_bfk and (pg_temp.oc('TCAP-A-SE26')).vendedor_id = 'tcap_v1'
  and exists (select 1 from public.historial_cambios where oc_id = 'tcap_a' and valor_anterior = 'BFK Ltda. · Capitalización')) \g /dev/null
select public.asignar_financiador_oc('tcap_b', 'fin_kevin') \g /dev/null
select public.asignar_vendedor_oc('tcap_b', 'tcap_v1') \g /dev/null
select public.cambiar_financiamiento_oc('tcap_b', 'venta_propia', 'fin_kevin') \g /dev/null
select pg_temp.error('R_venta_propia_no_capitalizacion', $q$select public.asignar_vendedor_oc('tcap_b', '__capitalizacion__')$q$, 'venta propia') \g /dev/null
-- OC con comisión excluida (julio, mes pagado): su vendedor se puede corregir (no está en la comisión pagada)
select public.asignar_vendedor_oc((pg_temp.oc('3786-91-AG26')).id, 'tcap_v1') \g /dev/null
select pg_temp.ok('R_excluida_corregible', (pg_temp.oc('3786-91-AG26')).vendedor_id = 'tcap_v1' and (pg_temp.oc('3786-91-AG26')).comision_excluida) \g /dev/null
-- OC normal de julio (incluida en la comisión pagada): sigue protegida
select pg_temp.error('R_incluida_protegida', format('select public.asignar_vendedor_oc(%L, %L)',
  (select o.id from public.ordenes_compra_v2 o, public.fin_periodo_comision(o.id) p where o.vendedor_id = 'vend_matias' and not o.comision_excluida and p.anio = 2026 and p.mes = 7 limit 1), 'tcap_v1'), 'ya se pagó') \g /dev/null
reset role;
select pg_temp.ok('N_consistencia_final', not exists (select 1 from public.fin_verificar_consistencia())) \g /dev/null
