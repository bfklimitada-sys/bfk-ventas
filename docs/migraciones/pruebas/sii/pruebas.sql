-- Fase SII · Pruebas del modelo tributario y de la conciliación (requiere ambos scripts aplicados).
-- Se ejecuta SIEMPRE dentro de una transacción que termina en ROLLBACK:  begin; \i pruebas.sql; rollback;
-- Crea sus propias OCs (ids tsii_*) como usuario autenticado real (la app escribe así) y verifica las reglas.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
reset role;

select id as adm from public.perfiles where rol = 'admin' order by id limit 1 \gset
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
create or replace function pg_temp.est(p_id text) returns text language sql as $$ select estado from public.documentos_tributarios where id = p_id $$;

-- Conciliación aplicada (datos reales; solo lectura)
do $$
declare o record; f record;
begin
  for f in select * from (values ('4454-401-AG25','34',284734),('1180830-57-AG25','96',192399),('1063534-14-AG26','195',330000),
                                 ('2986-198-AG26','199',224900),('3880-458-AG26','326',91000),('1525570-40-AG26','334',165201),
                                 ('4777-445-AG26','203',247000)) x(oc, folio, monto) loop
    select d.* into o from public.documentos_tributarios d where d.numero_oc = f.oc and d.folio = f.folio and d.tipo_dte = 33;
    perform pg_temp.ok('C_' || f.oc || '_factura_' || f.folio || '_vigente_verificada',
      o.id is not null and o.monto_total = f.monto and o.estado = 'vigente' and o.verificado_sii,
      coalesce(o.estado, 'no existe'));
    perform pg_temp.ok('C_' || f.oc || '_monto_facturado_igual', (select monto_facturado from public.ordenes_compra_v2 where numero_oc = f.oc) = f.monto);
  end loop;
  select d.* into o from public.documentos_tributarios d where d.numero_oc = '4777-445-AG26' and d.tipo_dte = 61 and d.folio = '44';
  perform pg_temp.ok('C_NC44_codigo2_sin_efecto', o.estado = 'nc_texto' and o.ref_folio = '203' and o.ref_codigo = 2 and o.monto_total = 0
    and o.fecha = '2026-08-05', coalesce(o.estado, 'no existe'));
  select * into o from public.ordenes_compra_v2 where numero_oc = '4777-445-AG26';
  perform pg_temp.ok('C_OC_4777_445_facturado_247000_emitida', o.monto_facturado = 247000 and o.estado_factura_propia = 'emitida' and o.estado_pago_cliente = 'pagado');
  perform pg_temp.ok('C_folios_antiguos_no_quedan', not exists (select 1 from public.eventos_factura e join public.ordenes_compra_v2 x on x.id = e.oc_id
     where (x.numero_oc, btrim(e.numero_factura)) in (('4454-401-AG25','24'),('1180830-57-AG25','120'),('1063534-14-AG26','198'),('2986-198-AG26','212'),
       ('3880-458-AG26','330'),('1525570-40-AG26','333'),('4777-445-AG26','206'))));
  perform pg_temp.ok('C_registro_auditoria', (select count(*) from public.fin_correcciones_registro where lote = 'sii-conciliacion-20261007' and revertida_en is null) >= 8);
  perform pg_temp.ok('C_consistencia_vacia', not exists (select 1 from public.fin_verificar_consistencia()));
end $$;

create temp table _tsii_antes as select o.id, md5(to_jsonb(o)::text) h from public.ordenes_compra_v2 o;
grant all on _tsii_antes to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.adm'), true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.adm'), 'role', 'authenticated')::text, true) \g /dev/null

do $$
declare o public.ordenes_compra_v2;
begin
  insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values
    ('tsii_1', 'TSII-1', 'Prueba SII', 119000), ('tsii_2', 'TSII-2', 'Prueba SII', 119000), ('tsii_3', 'TSII-3', 'Prueba SII', 119000),
    ('tsii_4', 'TSII-4', 'Prueba SII', 200000), ('tsii_5', 'TSII-5', 'Prueba SII', 119000);

  -- Código 2: corrige texto, no anula ni cambia monto
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_f1', 'tsii_1', current_date, '90001', 119000, 33);
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_folio, ref_codigo, ref_motivo)
    values ('tsii_nc1', 'tsii_1', current_date, '90501', 0, 61, '90001', 2, 'Corrige giro');
  o := pg_temp.oc('tsii_1');
  perform pg_temp.ok('T01_nc_codigo2_no_anula', o.monto_facturado = 119000 and o.estado_factura_propia = 'emitida' and pg_temp.est('tsii_f1') = 'vigente'
    and pg_temp.est('tsii_nc1') = 'nc_texto', o.monto_facturado::text);

  -- Código 1: anula; sin refacturar queda sin factura vigente
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_f2', 'tsii_2', current_date, '90002', 119000, 33);
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_folio, ref_codigo)
    values ('tsii_nc2', 'tsii_2', current_date, '90502', 119000, 61, '90002', 1);
  o := pg_temp.oc('tsii_2');
  perform pg_temp.ok('T02_nc_codigo1_anula', o.monto_facturado = 0 and o.estado_factura_propia = 'pendiente' and pg_temp.est('tsii_f2') = 'anulada', o.monto_facturado::text);
  -- Refacturación tras NC código 1
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_f2b', 'tsii_2', current_date, '90003', 119000, 33);
  o := pg_temp.oc('tsii_2');
  perform pg_temp.ok('T03_refacturacion_vigente', o.monto_facturado = 119000 and o.estado_factura_propia = 'emitida'
    and pg_temp.est('tsii_f2') = 'anulada' and pg_temp.est('tsii_f2b') = 'vigente');

  -- Código 3: corrige montos (NC parcial)
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_f3', 'tsii_3', current_date, '90004', 119000, 33);
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_folio, ref_codigo)
    values ('tsii_nc3', 'tsii_3', current_date, '90503', 19000, 61, '90004', 3);
  o := pg_temp.oc('tsii_3');
  perform pg_temp.ok('T04_nc_parcial_codigo3', o.monto_facturado = 100000 and o.estado_factura_propia = 'emitida' and pg_temp.est('tsii_f3') = 'vigente'
    and pg_temp.est('tsii_nc3') = 'nc_monto', o.monto_facturado::text);
  insert into public.eventos_pago_cliente (id, oc_id, fecha, monto) values ('tsii_c3', 'tsii_3', current_date, 100000);
  o := pg_temp.oc('tsii_3');
  perform pg_temp.ok('T05_cobro_total_sobre_monto_tributario', o.monto_cobrado = 100000 and o.estado_pago_cliente = 'pagado');

  -- Múltiples facturas por OC + reemisión antigua (compatibilidad)
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values
    ('tsii_f4a', 'tsii_4', current_date, '90005', 100000), ('tsii_f4b', 'tsii_4', current_date, '90006', 100000);
  o := pg_temp.oc('tsii_4');
  perform pg_temp.ok('T06_multiples_facturas', o.monto_facturado = 200000);
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, nota_credito, factura_anulada_numero)
    values ('tsii_f4c', 'tsii_4', current_date, '90007', 100000, '90504', '90006');
  o := pg_temp.oc('tsii_4');
  perform pg_temp.ok('T07_reemision_antigua_sigue_anulando', o.monto_facturado = 200000 and pg_temp.est('tsii_f4b') = 'anulada' and pg_temp.est('tsii_f4c') = 'vigente');
  insert into public.eventos_pago_cliente (id, oc_id, fecha, monto) values ('tsii_c4', 'tsii_4', current_date, 50000);
  o := pg_temp.oc('tsii_4');
  perform pg_temp.ok('T08_cobro_parcial_pendiente', o.estado_pago_cliente = 'parcial' and o.monto_facturado - o.monto_cobrado = 150000);

  -- Nota de débito suma
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_f5', 'tsii_5', current_date, '90008', 100000, 33);
  insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_folio, ref_codigo)
    values ('tsii_nd5', 'tsii_5', current_date, '90601', 19000, 56, '90008', 3);
  perform pg_temp.ok('T09_nota_debito_suma', (pg_temp.oc('tsii_5')).monto_facturado = 119000);

  -- Restricciones
  perform pg_temp.error('T10_nc_sin_referencia_rechazada',
    $q$insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('tsii_x', 'tsii_5', current_date, '90509', 1, 61)$q$, 'ref_nc_chk');
  perform pg_temp.error('T11_codigo_invalido_rechazado',
    $q$insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_folio, ref_codigo) values ('tsii_y', 'tsii_5', current_date, '90510', 1, 61, '90008', 4)$q$, 'ref_codigo_chk');
  -- Borrar la NC código 1 devuelve la factura a vigente
  delete from public.eventos_factura where id = 'tsii_nc2';
  perform pg_temp.ok('T12_borrar_nc_restaura', (pg_temp.oc('tsii_2')).monto_facturado = 238000 and pg_temp.est('tsii_f2') = 'vigente');
  -- Las OCs reales no cambiaron
  perform pg_temp.ok('T13_ocs_reales_intactas', not exists (select 1 from _tsii_antes a join public.ordenes_compra_v2 x on x.id = a.id where md5(to_jsonb(x)::text) <> a.h));
end $$;
reset role;
-- Limpieza: deja libres los nombres temporales para otras pruebas de la misma transacción.
drop function pg_temp.ok(text, boolean, text); drop function pg_temp.error(text, text, text);
drop function pg_temp.oc(text); drop function pg_temp.est(text); drop table _tsii_antes;
