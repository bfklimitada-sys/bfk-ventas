-- Fase 4B · Datos de prueba para la prueba de interfaz de punta a punta (navegador → PostgREST → base DESECHABLE).
-- Uso: psql -v ADM=<uuid admin> -f e2e_postgrest_preparar.sql   (nunca en producción: crea datos de prueba)
\set ON_ERROR_STOP on
do $$ begin
  if exists (select 1 from public.financiadores where id = 'e2e4b_fin') then raise exception 'ya preparada'; end if;
end $$;
insert into public.financiadores (id, nombre) values ('e2e4b_fin', 'Financiador E2E 4B');
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total, financiador_id, tipo_registro) values
  ('e2e4b_oc1', 'E2E4B-1', 'CLIENTE E2E 4B', 1000000, 'e2e4b_fin', 'venta'),
  ('e2e4b_oc2', 'E2E4B-2', 'CLIENTE E2E 4B', 900000, null, 'venta'),
  ('e2e4b_oc3', 'E2E4B-3', 'CLIENTE E2E 4B', 800000, null, 'venta');
-- Compra inicial de la OC 1 (600.000) registrada por el administrador con la operación atómica.
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'ADM', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.registrar_compra_oc('e2e4b_oc1', current_date, 600000, 'e2e4b_fin');
commit;
select 'PREPARADA|saldo=' || saldo_deuda from public.financiadores where id = 'e2e4b_fin';
