-- Matriz de acceso por rol (SOLO base desechable / copia restaurada). TODO termina en ROLLBACK: no deja rastro.
-- Para cada tabla y vista de public (y storage.objects / storage.buckets), con cada cuenta, prueba SELECT, INSERT,
-- UPDATE y DELETE tal como lo haría la API (rol + JWT simulados). Luego prueba las funciones RPC ejecutables.
-- Variables psql: fase (antes|despues), adm y usr (uuid de perfiles admin y usuario existentes).
-- Salida: M|fase|cuenta|objeto|operación|resultado   (sin datos de negocio: solo conteos y códigos de error)
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;

-- Cuentas de prueba que no existen en producción (se crean dentro de esta transacción y desaparecen con el ROLLBACK).
--   nueva    : se registra como lo haría cualquier persona (antes de la corrección recibe perfil automático)
--   sinperfil: cuenta autenticada sin perfil BFK
--   respaldo : futura cuenta de respaldo documental, marcada como aislada (raw_app_meta_data.bfk_tipo)
insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at)
values ('5e9a0000-0000-4000-8000-000000000001', 'nueva.prueba@seguridad.invalid', now(), '{}', '{"nombre":"Cuenta nueva de prueba"}', now()),
       ('5e9a0000-0000-4000-8000-000000000002', 'sinperfil.prueba@seguridad.invalid', now(), '{}', '{}', now()),
       ('5e9a0000-0000-4000-8000-000000000003', 'respaldo.prueba@seguridad.invalid', now(), '{"bfk_tipo":"respaldo_documental"}', '{}', now());
select 'M|' || :'fase' || '|nueva|registro|perfil_automatico|' ||
       coalesce((select 'SI rol=' || rol from public.perfiles where id = '5e9a0000-0000-4000-8000-000000000001'), 'NO');
-- «sinperfil» y «respaldo» nunca deben tener perfil (si el disparador antiguo se los creó, se quita para la prueba).
select 'M|' || :'fase' || '|respaldo|registro|perfil_automatico|' ||
       coalesce((select 'SI rol=' || rol from public.perfiles where id = '5e9a0000-0000-4000-8000-000000000003'), 'NO');
alter table public.perfiles disable trigger user;
delete from public.perfiles where id in ('5e9a0000-0000-4000-8000-000000000002', '5e9a0000-0000-4000-8000-000000000003');
alter table public.perfiles enable trigger user;

\ir muestra.sql

-- Ejecuta una operación con los permisos de la cuenta activa y la deshace siempre (excepción deliberada).
create function seg_probe.probar(p_t text, p_op text) returns text language plpgsql security invoker as $f$
declare m seg_probe.muestra; n bigint; v_where text; v_cols text; v_set text;
begin
  select * into m from seg_probe.muestra where tabla = p_t;
  begin
    if p_op = 'select' then
      execute format('select count(*) from %s', p_t) into n;
      raise exception using errcode = 'P0SEG', message = 'LEE ' || n || '/' || m.total;
    end if;
    if m.fila is null then return 'SIN_FILAS'; end if;
    if p_op <> 'insert' and m.pk is null then return 'SIN_PK'; end if;
    if m.pk is not null then
      select string_agg(format('%I::text = %L', k, m.fila ->> k), ' and ') into v_where from unnest(m.pk) k;
    end if;
    if p_op = 'insert' then
      select string_agg(quote_ident(k), ', ') into v_cols from jsonb_object_keys(m.nueva) k;
      execute format('insert into %s (%s) select %s from jsonb_populate_record(null::%s, $1)', p_t, v_cols, v_cols, p_t) using m.nueva;
      get diagnostics n = row_count;
    elsif p_op = 'update' then
      v_set := format('%I = %I', m.pk[1], m.pk[1]);
      execute format('update %s set %s where %s', p_t, v_set, v_where);
      get diagnostics n = row_count;
    elsif p_op = 'delete' then
      execute format('delete from %s where %s', p_t, v_where);
      get diagnostics n = row_count;
    end if;
    raise exception using errcode = 'P0SEG', message = case when n = 0 then 'SIN_EFECTO 0 filas' else 'PERMITE ' || n end;
  exception
    when sqlstate 'P0SEG' then return sqlerrm;
    when insufficient_privilege then return 'DENEGADO ' || sqlstate;
    when others then return 'OTRO ' || sqlstate || ' ' || left(regexp_replace(sqlerrm, '\s+', ' ', 'g'), 90);
  end;
end $f$;
grant execute on function seg_probe.probar(text, text) to anon, authenticated;

-- Llamada a una función RPC con argumentos reales (de la muestra) o nulos; siempre se deshace.
create function seg_probe.rpc(p_sql text) returns text language plpgsql security invoker as $f$
declare v text;
begin
  begin
    execute p_sql into v;
    raise exception using errcode = 'P0SEG', message = 'EJECUTA ' || case when v is null then '(sin datos)' else 'DEVUELVE datos' end;
  exception
    when sqlstate 'P0SEG' then return sqlerrm;
    when insufficient_privilege then return 'DENEGADO ' || sqlstate || ' ' || left(regexp_replace(sqlerrm, '\s+', ' ', 'g'), 60);
    when others then return 'OTRO ' || sqlstate || ' ' || left(regexp_replace(sqlerrm, '\s+', ' ', 'g'), 90);
  end;
end $f$;
grant execute on function seg_probe.rpc(text) to anon, authenticated;

-- Llamadas RPC realistas a las funciones SECURITY DEFINER que exponen o escriben datos financieros.
create table seg_probe.llamadas (nombre text primary key, sql text);
grant select on seg_probe.llamadas to anon, authenticated;
insert into seg_probe.llamadas
select 'fin_calculo_oc', format('select public.fin_calculo_oc(%L)::text', (select id from public.ordenes_compra_v2 order by id limit 1))
union all select 'fin_facturas_vigentes', format('select count(*)::text from public.fin_facturas_vigentes(%L)', (select oc_id from public.eventos_factura order by id limit 1))
union all select 'fin_tipo_financiamiento', format('select public.fin_tipo_financiamiento(%L)', (select id from public.ordenes_compra_v2 order by id limit 1))
union all select 'fin_fila_bloqueada', format('select public.fin_fila_bloqueada(''eventos_pago_cliente'', %L)', (select id from public.eventos_pago_cliente order by id limit 1))
union all select 'fin_dif_monto', format('select public.fin_dif_monto(''oc'', %L, ''costo_total'')::text', (select id from public.ordenes_compra_v2 order by id limit 1))
union all select 'fin_monto_tributario', format('select public.fin_monto_tributario(%L)::text', (select id from public.ordenes_compra_v2 order by id limit 1))
union all select 'fin_periodo_comision', format('select public.fin_periodo_comision(%L)::text', (select oc_id from public.eventos_factura order by id limit 1))
union all select 'cartola_manuales', format('select count(*)::text from public.cartola_manuales(''eventos_pago_cliente'', array[]::text[], %L::date, %s)',
                  (select fecha from public.eventos_pago_cliente order by id limit 1), coalesce((select monto from public.eventos_pago_cliente order by id limit 1), 0))
union all select 'cartola_quitar_alerta', format('select public.cartola_quitar_alerta(''eventos_pago_cliente'', %L)::text', (select id from public.eventos_pago_cliente order by id limit 1))
union all select 'bfk_cuentas_por_autorizar', 'select count(*)::text from public.bfk_cuentas_por_autorizar()'
union all select 'bfk_autorizar_cuenta_a_si_misma', 'select public.bfk_autorizar_cuenta(auth.uid(), ''Intento'', ''admin'')::text'
union all select 'autoinsertar_perfil', 'insert into public.perfiles (id, nombre, rol) values (auth.uid(), ''Intento'', ''usuario'') returning ''insertado'''
union all select 'autopromocion_admin', 'update public.perfiles set rol = ''admin'' where id = auth.uid() returning ''promovido'''
union all select 'cambiar_su_vendedor', 'update public.perfiles set vendedor_id = ''vend_otro'' where id = auth.uid() returning ''cambiado'''
union all select 'cambiar_su_nombre', 'update public.perfiles set nombre = nombre where id = auth.uid() returning ''cambiado''';

-- Ejecución por cuenta: cada una con su rol de base y su JWT, como la API.
create temp table seg_res (linea text);
grant insert, select on seg_res to anon, authenticated;
\set QUIET on
select set_config('request.jwt.claims', '{"role":"anon"}', true) \g /dev/null
set local role anon;
insert into seg_res select 'M|' || :'fase' || '|anon|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|anon|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l
  where l.nombre not in ('autoinsertar_perfil', 'autopromocion_admin', 'cambiar_su_vendedor', 'cambiar_su_nombre');
reset role;
\set QUIET off

-- Cuentas con sesión
\set QUIET on
select set_config('request.jwt.claims', json_build_object('sub', '5e9a0000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
insert into seg_res select 'M|' || :'fase' || '|nueva|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|nueva|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '5e9a0000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
insert into seg_res select 'M|' || :'fase' || '|sinperfil|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|sinperfil|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', '5e9a0000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
insert into seg_res select 'M|' || :'fase' || '|respaldo|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|respaldo|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
insert into seg_res select 'M|' || :'fase' || '|usuario|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|usuario|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'adm', 'role', 'authenticated')::text, true) \g /dev/null
set local role authenticated;
insert into seg_res select 'M|' || :'fase' || '|admin|' || m.tabla || '|' || op || '|' || seg_probe.probar(m.tabla, op)
  from seg_probe.muestra m cross join unnest(array['select', 'insert', 'update', 'delete']) op;
insert into seg_res select 'M|' || :'fase' || '|admin|rpc:' || l.nombre || '|call|' || seg_probe.rpc(l.sql) from seg_probe.llamadas l
  where l.nombre not in ('bfk_autorizar_cuenta_a_si_misma');
-- El administrador autoriza la cuenta nueva y la de respaldo (esta última debe rechazarse).
insert into seg_res select 'M|' || :'fase' || '|admin|rpc:autorizar_cuenta_nueva|call|' ||
  seg_probe.rpc('select public.bfk_autorizar_cuenta(''5e9a0000-0000-4000-8000-000000000002'', ''Cuenta autorizada de prueba'', ''usuario'')::text');
insert into seg_res select 'M|' || :'fase' || '|admin|rpc:autorizar_cuenta_respaldo|call|' ||
  seg_probe.rpc('select public.bfk_autorizar_cuenta(''5e9a0000-0000-4000-8000-000000000003'', ''Respaldo'', ''usuario'')::text');
reset role;
\set QUIET off

-- Permisos estáticos de ejecución de funciones (EXECUTE) por rol de la API.
insert into seg_res
select 'M|' || :'fase' || '|' || r || '|fn:' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|execute|' ||
       case when has_function_privilege(r, p.oid, 'execute') then 'PUEDE' else 'NO' end || case when p.prosecdef then ' (definer)' else '' end
  from pg_proc p cross join unnest(array['anon', 'authenticated']) r
 where p.pronamespace = 'public'::regnamespace;

select linea from seg_res order by 1;
rollback;
