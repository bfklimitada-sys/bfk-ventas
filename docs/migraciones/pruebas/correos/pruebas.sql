-- Fase Correos · Pruebas de la migración 2026-10-07-correos-bfk.sql (requiere la migración aplicada).
-- Se ejecuta SIEMPRE dentro de una transacción que termina en ROLLBACK:  begin; \i pruebas.sql; rollback;
-- Crea sus propias OCs (ids tcor_*) con RUT y correos de prueba que no existen en datos reales.
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
create or replace function pg_temp.c(p_mid text) returns public.correos_bfk language sql as $$ select * from public.correos_bfk where message_id = p_mid $$;
create or replace function pg_temp.mail(p_mid text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('message_id', p_mid, 'buzon', 'prueba@correos-bfk.test', 'uid', 1, 'remitente_nombre', 'Remitente Prueba',
    'remitente_correo', 'desconocido@correos-bfk.test', 'asunto', 'Asunto ' || p_mid, 'fecha', '2026-10-06T12:00:00Z',
    'resumen', 'Resumen breve', 'categoria', 'general', 'prioridad', 0, 'candidatos', jsonb_build_object('ocs', '[]'::jsonb, 'ruts', '[]'::jsonb, 'folios', '[]'::jsonb)) || p_extra
$$;

-- ── Estructura y permisos (solo lectura del catálogo) ────────────────────────────────────
select pg_temp.ok('E_tabla_con_rls', (select relrowsecurity from pg_class where oid = 'public.correos_bfk'::regclass)) \g /dev/null
select pg_temp.ok('E_message_id_unico', exists (select 1 from pg_indexes where tablename = 'correos_bfk' and indexdef ~* 'unique.*\(message_id\)')) \g /dev/null
select pg_temp.ok('P_anon_sin_lectura', not has_table_privilege('anon', 'public.correos_bfk', 'select')) \g /dev/null
select pg_temp.ok('P_autenticados_solo_leen', has_table_privilege('authenticated', 'public.correos_bfk', 'select')
  and not has_table_privilege('authenticated', 'public.correos_bfk', 'insert')
  and not has_table_privilege('authenticated', 'public.correos_bfk', 'update')
  and not has_table_privilege('authenticated', 'public.correos_bfk', 'delete')) \g /dev/null
select pg_temp.ok('P_sync_solo_registrar', has_function_privilege('correo_sync_bfk', 'public.correos_bfk_registrar(jsonb)', 'execute')
  and not has_function_privilege('correo_sync_bfk', 'public.correo_bfk_marcar(bigint,text)', 'execute')
  and not has_table_privilege('correo_sync_bfk', 'public.correos_bfk', 'select')
  and not has_table_privilege('correo_sync_bfk', 'public.ordenes_compra_v2', 'select')
  and not has_table_privilege('correo_sync_bfk', 'public.eventos_factura', 'select')) \g /dev/null
select pg_temp.ok('P_sync_sin_rol_privilegiado', (select not rolsuper and not rolcreaterole and not rolcreatedb and not rolbypassrls and rolconnlimit = 3
  from pg_roles where rolname = 'correo_sync_bfk')) \g /dev/null
select pg_temp.ok('P_app_no_registra', not has_function_privilege('authenticated', 'public.correos_bfk_registrar(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.correos_bfk_registrar(jsonb)', 'execute')) \g /dev/null
select pg_temp.ok('P_anon_no_marca', not has_function_privilege('anon', 'public.correo_bfk_marcar(bigint,text)', 'execute')
  and has_function_privilege('authenticated', 'public.correo_bfk_marcar(bigint,text)', 'execute')) \g /dev/null

-- Precondición: los identificadores de prueba no existen en datos reales
select pg_temp.ok('D_identificadores_de_prueba_libres',
  not exists (select 1 from public.ordenes_compra_v2 where public.correos_bfk_rut(rut_cliente) in ('999999911', '999999922', '999999933')
               or correo_cliente ilike '%correos-bfk.test%' or numero_oc ilike 'TCOR-%')
  and not exists (select 1 from public.eventos_factura where ltrim(numero_factura, '0') in ('9876501', '9876502'))) \g /dev/null

-- Huella de datos que la fase NO debe tocar
create temp table _tcor_antes as
  select 'oc' t, md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.id), '')) h from public.ordenes_compra_v2 o where o.id not like 'tcor\_%'
  union all select 'fac', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_factura x where x.id not like 'tcor\_%'
  union all select 'cob', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_pago_cliente x;

-- ── Datos de prueba (como usuario autenticado, igual que la app) ─────────────────────────
set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('t.adm'), true), set_config('request.jwt.claim.role', 'authenticated', true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('t.adm'), 'role', 'authenticated')::text, true) \g /dev/null
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, rut_cliente, correo_cliente, monto_total) values
  ('tcor_a', 'TCOR-1-SE26', 'Cliente Prueba A', '99.999.991-1', 'cliente.a@correos-bfk.test', 119000),
  ('tcor_b', 'TCOR-2-SE26', 'Cliente Prueba B', '99.999.992-2', 'compras@correos-bfk.test, jefe.b@correos-bfk.test', 119000),
  ('tcor_c', 'TCOR-3-SE26', 'Cliente Prueba B', '99.999.992-2', 'compras@correos-bfk.test', 119000),
  ('tcor_d', 'TCOR-4-SE26', 'Cliente Prueba D', '99.999.993-3', 'cliente.d@correos-bfk.test', 119000);
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values
  ('tcor_f1', 'tcor_a', current_date, '9876501', 119000, 33),
  ('tcor_f2', 'tcor_b', current_date, '9876502', 119000, 33),
  ('tcor_f3', 'tcor_c', current_date, '9876502', 119000, 33);

-- La app no puede escribir la tabla ni registrar correos
select pg_temp.error('P_app_no_inserta', $q$insert into public.correos_bfk (message_id, buzon, fecha, categoria, prioridad) values ('x','x',now(),'general',0)$q$, 'permission denied|permiso') \g /dev/null
select pg_temp.error('P_app_no_ejecuta_registrar', $q$select public.correos_bfk_registrar('[]')$q$, 'permission denied|permiso') \g /dev/null
reset role;

-- ── Asociación ───────────────────────────────────────────────────────────────────────────
create temp table _tcor_res as select public.correos_bfk_registrar(jsonb_build_array(
  pg_temp.mail('<tcor-1@x>', '{"asunto":"Consulta OC tcor-1-se26","candidatos":{"ocs":["tcor-1-se26"]}}'),
  pg_temp.mail('<tcor-2@x>', '{"candidatos":{"ocs":["TCOR-1-SE26","TCOR-2-SE26"]}, "categoria":"entrega","prioridad":2}'),
  pg_temp.mail('<tcor-3@x>', '{"remitente_correo":"Cliente.A@correos-bfk.test","categoria":"facturacion","prioridad":2,"candidatos":{"folios":["09876501"]}}'),
  pg_temp.mail('<tcor-4@x>', '{"categoria":"facturacion","prioridad":2,"candidatos":{"folios":["9876501"]}}'),
  pg_temp.mail('<tcor-5@x>', '{"categoria":"cobranza","prioridad":2,"candidatos":{"folios":["9876502"],"ruts":["99999992-2"]}}'),
  pg_temp.mail('<tcor-6@x>', '{"categoria":"solicitud","prioridad":1,"candidatos":{"ruts":["99.999.993-3"]}}'),
  pg_temp.mail('<tcor-7@x>', '{"candidatos":{"ruts":["99999992-2"]}}'),
  pg_temp.mail('<tcor-8@x>', '{"remitente_correo":"cliente.d@correos-bfk.test"}'),
  pg_temp.mail('<tcor-9@x>', '{"remitente_correo":"jefe.b@correos-bfk.test"}'),
  pg_temp.mail('<tcor-10@x>', '{}'),
  pg_temp.mail('<tcor-11@x>', '{"categoria":"reclamo","prioridad":3}'),
  pg_temp.mail('<tcor-12@x>', '{"candidatos":{"ocs":["TCOR-999-XX99"]}}')
)) r;

select pg_temp.ok('A_numero_oc_insensible_mayusculas', (pg_temp.c('<tcor-1@x>')).oc_id = 'tcor_a' and (pg_temp.c('<tcor-1@x>')).asociacion = 'numero_oc'
  and (pg_temp.c('<tcor-1@x>')).evidencia ~ 'TCOR-1-SE26') \g /dev/null
select pg_temp.ok('A_dos_numeros_de_oc_no_asocia', (pg_temp.c('<tcor-2@x>')).oc_id is null and (pg_temp.c('<tcor-2@x>')).asociacion = 'ninguna') \g /dev/null
select pg_temp.ok('A_folio_con_remitente_del_cliente', (pg_temp.c('<tcor-3@x>')).oc_id = 'tcor_a' and (pg_temp.c('<tcor-3@x>')).asociacion = 'factura') \g /dev/null
select pg_temp.ok('A_folio_sin_respaldo_no_asocia', (pg_temp.c('<tcor-4@x>')).oc_id is null) \g /dev/null
select pg_temp.ok('A_folio_en_dos_ocs_no_asocia', (pg_temp.c('<tcor-5@x>')).oc_id is null and (pg_temp.c('<tcor-5@x>')).rut_detectado = '99.999.992-2') \g /dev/null
select pg_temp.ok('A_rut_con_una_oc_abierta', (pg_temp.c('<tcor-6@x>')).oc_id = 'tcor_d' and (pg_temp.c('<tcor-6@x>')).asociacion = 'rut_unico') \g /dev/null
select pg_temp.ok('A_rut_con_dos_ocs_queda_general_pero_relevante', (pg_temp.c('<tcor-7@x>')).oc_id is null and (pg_temp.c('<tcor-7@x>')).message_id is not null) \g /dev/null
select pg_temp.ok('A_remitente_de_una_oc', (pg_temp.c('<tcor-8@x>')).oc_id = 'tcor_d' and (pg_temp.c('<tcor-8@x>')).asociacion = 'remitente_unico') \g /dev/null
select pg_temp.ok('A_remitente_en_lista_de_correos', (pg_temp.c('<tcor-9@x>')).oc_id = 'tcor_b') \g /dev/null
select pg_temp.ok('R_general_sin_vinculo_se_descarta', (pg_temp.c('<tcor-10@x>')).message_id is null) \g /dev/null
select pg_temp.ok('R_accion_sin_oc_queda_general', (pg_temp.c('<tcor-11@x>')).oc_id is null and (pg_temp.c('<tcor-11@x>')).prioridad = 3
  and (pg_temp.c('<tcor-11@x>')).estado = 'pendiente') \g /dev/null
select pg_temp.ok('R_oc_inexistente_no_inventa', (pg_temp.c('<tcor-12@x>')).message_id is null) \g /dev/null
select pg_temp.ok('R_resumen_conteos', (select r from _tcor_res) = '{"recibidos":12,"nuevos":10,"existentes":0,"descartados":2,"asociados":5}'::jsonb,
  (select r::text from _tcor_res)) \g /dev/null

-- OC cobrada deja de contar como "abierta" (si el modelo deja marcarla como pagada)
update public.ordenes_compra_v2 set estado_pago_cliente = 'pagado' where id = 'tcor_d';
select public.correos_bfk_registrar(jsonb_build_array(pg_temp.mail('<tcor-13@x>', '{"candidatos":{"ruts":["999999933"]}}'))) \g /dev/null
select pg_temp.ok('A_rut_ignora_oc_cobrada',
  case when (select estado_pago_cliente from public.ordenes_compra_v2 where id = 'tcor_d') = 'pagado'
       then (pg_temp.c('<tcor-13@x>')).oc_id is null else true end) \g /dev/null

-- ── Idempotencia ─────────────────────────────────────────────────────────────────────────
select pg_temp.ok('I_reprocesar_no_duplica',
  public.correos_bfk_registrar(jsonb_build_array(pg_temp.mail('<tcor-1@x>', '{"asunto":"otro"}'), pg_temp.mail('<tcor-1@x>')))
    = '{"recibidos":2,"nuevos":0,"existentes":2,"descartados":0,"asociados":0}'::jsonb
  and (select count(*) from public.correos_bfk where message_id = '<tcor-1@x>') = 1
  and (pg_temp.c('<tcor-1@x>')).asunto = 'Consulta OC tcor-1-se26') \g /dev/null
select pg_temp.error('V_message_id_vacio', $q$select public.correos_bfk_registrar(jsonb_build_array(pg_temp.mail('  ')))$q$, 'message_id') \g /dev/null
select pg_temp.error('V_no_arreglo', $q$select public.correos_bfk_registrar('{}')$q$, 'arreglo') \g /dev/null
select public.correos_bfk_registrar(jsonb_build_array(pg_temp.mail('<tcor-14@x>', jsonb_build_object('categoria','reclamo','prioridad',9,'resumen', repeat('a', 900)))))\g /dev/null
select pg_temp.ok('V_resumen_400_y_prioridad_acotada', (pg_temp.c('<tcor-14@x>')).prioridad = 3 and char_length((pg_temp.c('<tcor-14@x>')).resumen) = 400) \g /dev/null

-- ── Estado pendiente / gestionado ────────────────────────────────────────────────────────
select id as cid from public.correos_bfk where message_id = '<tcor-11@x>' \gset
set local role authenticated;
select pg_temp.ok('G_usuario_lee', (select count(*) from public.correos_bfk where message_id like '<tcor-%') = 12) \g /dev/null
select public.correo_bfk_marcar(:cid, 'gestionado') \g /dev/null
select pg_temp.ok('G_marca_gestionado_con_autor', (select estado = 'gestionado' and gestionado_por::text = current_setting('t.adm') and gestionado_en is not null
  from public.correos_bfk where id = :cid)) \g /dev/null
select pg_temp.error('P_usuario_no_edita_directo', format('update public.correos_bfk set estado = %L where id = %s', 'pendiente', :cid), 'permission denied|permiso') \g /dev/null
select pg_temp.error('P_usuario_no_borra', format('delete from public.correos_bfk where id = %s', :cid), 'permission denied|permiso') \g /dev/null
select public.correo_bfk_marcar(:cid, 'pendiente') \g /dev/null
select pg_temp.ok('G_reabrir_limpia_autor', (select estado = 'pendiente' and gestionado_por is null and gestionado_en is null from public.correos_bfk where id = :cid)) \g /dev/null
select pg_temp.error('G_estado_invalido', format('select public.correo_bfk_marcar(%s, %L)', :cid, 'borrado'), 'inválido') \g /dev/null
select pg_temp.error('G_correo_inexistente', 'select public.correo_bfk_marcar(-1, ''gestionado'')', 'no encontrado') \g /dev/null
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000ff', true),
       set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000ff', 'role', 'authenticated')::text, true) \g /dev/null
select pg_temp.ok('P_sin_perfil_no_lee', (select count(*) from public.correos_bfk) = 0) \g /dev/null
select pg_temp.error('P_sin_perfil_no_marca', format('select public.correo_bfk_marcar(%s, %L)', :cid, 'gestionado'), 'perfil') \g /dev/null
reset role;
set local role anon;
select pg_temp.error('P_anon_no_lee', 'select count(*) from public.correos_bfk', 'permission denied|permiso') \g /dev/null
reset role;

-- ── Nada fuera de la fase cambia (OCs, facturas y cobros reales) ─────────────────────────
select pg_temp.ok('N_ocs_facturas_cobros_intactos', not exists (
  select 'oc' t, md5(coalesce(string_agg(to_jsonb(o)::text, ',' order by o.id), '')) h from public.ordenes_compra_v2 o where o.id not like 'tcor\_%'
  union all select 'fac', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_factura x where x.id not like 'tcor\_%'
  union all select 'cob', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_pago_cliente x
  except select t, h from _tcor_antes)) \g /dev/null
