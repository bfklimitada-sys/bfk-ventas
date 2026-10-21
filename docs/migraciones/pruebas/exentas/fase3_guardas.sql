-- Pruebas de las guardas de la fase 3 (BASE DESECHABLE con la fase 2 instalada). Todo termina en ROLLBACK.
\set ON_ERROR_STOP on
begin;
select id as adm from public.perfiles where rol = 'admin' order by id limit 1 \gset
create temp table r (k text, v text); grant all on r to authenticated, anon;
create temp table h0 as select md5(coalesce(string_agg(f::text, ',' order by f.id), '')) h from public.eventos_factura f;
-- OC sintéticas: una exenta aprobada (por conexión directa, como la deja trib_resolver) y una afecta.
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('ocv2_g3_ex', '9971-1-ENS', 'ENSAYO EXENTA', 2704000), ('ocv2_g3_af', '9972-2-ENS', 'ENSAYO AFECTA', 1190000);
select set_config('bfk.trib_rpc', '1', true);
update public.ordenes_compra_v2 set tratamiento_iva = 'exenta_fora', fundamento_iva = 'Art. 101 Ley 18.948', respaldo_iva = 'Oficio ficticio', tratamiento_aprobado_por = :'adm', tratamiento_aprobado_en = now(), clasificacion_id = gen_random_uuid() where id = 'ocv2_g3_ex';
insert into public.cotizaciones (id, nombre, estado, creado_por) values ('e3000000-0000-4000-8000-000000000001', 'ENSAYO cz exenta', 'borrador', :'adm'), ('e3000000-0000-4000-8000-000000000002', 'ENSAYO cz afecta', 'borrador', :'adm');
update public.cotizaciones set tratamiento_iva = 'exenta_fora', fundamento_iva = 'Art. 101 Ley 18.948', respaldo_iva = 'Oficio ficticio', tratamiento_aprobado_por = :'adm', tratamiento_aprobado_en = now(), clasificacion_id = gen_random_uuid() where id = 'e3000000-0000-4000-8000-000000000001';
select set_config('bfk.trib_rpc', '', true);
-- Como la API (usuario autenticado).
select set_config('request.jwt.claims', json_build_object('sub', :'adm', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
do $$ begin
  begin insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3a', 'ocv2_g3_af', current_date, '1', 1190000, 34); insert into r values ('dte34_en_oc_afecta_bloqueada', 'false');
  exception when insufficient_privilege then insert into r values ('dte34_en_oc_afecta_bloqueada', (sqlerrm ~ 'no tiene una clasificación exenta')::text); end;
  begin insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, monto_iva) values ('g3b', 'ocv2_g3_ex', current_date, '2', 2704000, 34, 431714); insert into r values ('dte34_con_iva_bloqueada', 'false');
  exception when invalid_parameter_value then insert into r values ('dte34_con_iva_bloqueada', 'true'); end;
  begin insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3c', 'ocv2_g3_ex', current_date, '3', 2704000, 33); insert into r values ('dte33_en_oc_exenta_bloqueada', 'false');
  exception when insufficient_privilege then insert into r values ('dte33_en_oc_exenta_bloqueada', 'true'); end;
  begin insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('g3d', 'ocv2_g3_ex', current_date, '4', 2704000); insert into r values ('sin_tipo_en_oc_exenta_bloqueada', 'false');
  exception when insufficient_privilege then insert into r values ('sin_tipo_en_oc_exenta_bloqueada', 'true'); end;
end $$;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3e', 'ocv2_g3_ex', current_date, '3401', 2704000, 34);
insert into r select 'dte34_en_oc_exenta_monto_exento_iva_0', (monto_exento = 2704000 and monto_iva = 0)::text from public.eventos_factura where id = 'g3e';
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_tipo_dte, ref_folio, ref_codigo, ref_motivo) values ('g3f', 'ocv2_g3_ex', current_date, '61', 2704000, 61, 34, '3401', 1, 'Anula');
insert into r select 'nc_sobre_dte34_permitida', (count(*) = 1)::text from public.eventos_factura where id = 'g3f';
update public.eventos_factura set monto = 2600000 where id = 'g3e';
insert into r select 'correccion_monto_dte34_sigue_exenta', (monto_exento = 2600000 and monto_iva = 0)::text from public.eventos_factura where id = 'g3e';
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('g3g', 'ocv2_g3_af', current_date, '8801', 1190000);
insert into r select 'dte33_afecta_igual_que_antes', (tipo_dte is null and monto_exento is null and monto_iva is null)::text from public.eventos_factura where id = 'g3g';
-- Cotizaciones (por la función de guardado, como la app).
do $$ declare v integer; begin
  select version into v from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000002';
  begin perform public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000002', 'version', v, 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz afecta', 'formula', '{"exenta":true}'::jsonb, 'subtotal_neto', 1000, 'impuestos', 0, 'total', 1000));
    insert into r values ('cotizacion_afecta_no_se_guarda_exenta', 'false');
  exception when insufficient_privilege then insert into r values ('cotizacion_afecta_no_se_guarda_exenta', (sqlerrm ~ 'CZ423')::text); end;
  begin perform public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000002', 'version', v, 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz afecta', 'subtotal_neto', 1000, 'impuestos', 0, 'total', 1000));
    insert into r values ('iva_0_sin_clasificacion_bloqueado', 'false');
  exception when insufficient_privilege then insert into r values ('iva_0_sin_clasificacion_bloqueado', 'true'); end;
  begin perform public.cz_guardar_cotizacion_v2(jsonb_build_object('items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO nueva exenta', 'formula', '{"exenta":true}'::jsonb, 'subtotal_neto', 1000, 'impuestos', 0, 'total', 1000));
    insert into r values ('cotizacion_nueva_no_nace_exenta', 'false');
  exception when insufficient_privilege then insert into r values ('cotizacion_nueva_no_nace_exenta', 'true'); end;
  select version into v from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000001';
  begin perform public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000001', 'version', v, 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz exenta', 'formula', '{"exenta":true}'::jsonb, 'subtotal_neto', 2704000, 'impuestos', 514760, 'total', 3218760));
    insert into r values ('cotizacion_exenta_sin_iva', 'false');
  exception when invalid_parameter_value then insert into r values ('cotizacion_exenta_sin_iva', 'true'); end;
end $$;
select version as v1 from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000001' \gset
select public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000001', 'version', :v1, 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz exenta', 'formula', '{"exenta":true,"base_exenta":"costo_bruto"}'::jsonb, 'subtotal_neto', 2704000, 'impuestos', 0, 'total', 2704000)) ->> 'version' as v1b \gset
insert into r select 'cotizacion_exenta_aprobada_se_guarda', (impuestos = 0 and total = 2704000 and formula ->> 'exenta' = 'true')::text from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000001';
select version as v2 from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000002' \gset
select public.cz_guardar_cotizacion_v2(jsonb_build_object('id', 'e3000000-0000-4000-8000-000000000002', 'version', :v2, 'items', '[]'::jsonb, 'envios', '[]'::jsonb, 'nombre', 'ENSAYO cz afecta', 'formula', '{"base":"neto","redondeo":"arriba","prorrateo":"valor","confirmada":true}'::jsonb, 'subtotal_neto', 1000, 'impuestos', 190, 'total', 1190)) ->> 'version' as v2b \gset
insert into r select 'cotizacion_afecta_igual_que_antes', (impuestos = 190 and total = 1190)::text from public.cotizaciones where id = 'e3000000-0000-4000-8000-000000000002';
reset role;
-- Restauración por conexión directa (sin claims): no se bloquea.
select set_config('request.jwt.claims', '', true), set_config('request.method', '', true);
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3h', 'ocv2_g3_af', current_date, '77', 1190000, 34);
insert into r select 'restauracion_directa_no_bloqueada', (count(*) = 1)::text from public.eventos_factura where id = 'g3h';
delete from public.eventos_factura where id like 'g3%';
insert into r select 'facturas_reales_intactas', ((select md5(coalesce(string_agg(f::text, ',' order by f.id), '')) from public.eventos_factura f) = (select h from h0))::text;
select 'G3|' || k || '|' || v from r order by k;
rollback;
-- Transacciones NUEVAS como la API (sin ninguna sentencia previa del administrador de la base): así se detectan
-- permisos faltantes que dentro de una misma transacción podrían quedar ocultos.
\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'adm', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
with i as (insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('g3_fresca', (select min(id) from public.ordenes_compra_v2 where tratamiento_iva is null), current_date, '99999', 1000) returning id)
select 'G3|fresca_factura_afecta_por_la_api|' || (count(*) = 1)::text from i;
rollback;
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'adm', 'role', 'authenticated')::text, true), set_config('request.method', 'PATCH', true);
set local role authenticated;
with u as (update public.ordenes_compra_v2 set notas = coalesce(notas, '') where id = (select min(id) from public.ordenes_compra_v2) returning id)
select 'G3|fresca_editar_oc_por_la_api|' || (count(*) = 1)::text from u;
rollback;
