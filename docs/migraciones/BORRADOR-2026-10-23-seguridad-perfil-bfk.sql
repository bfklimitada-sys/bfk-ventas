-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR 2026-10-23 · SEGURIDAD: PERFIL BFK OBLIGATORIO PARA LOS DATOS FINANCIEROS DE MERCADO PÚBLICO
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Problema (auditoría del catálogo de producción, solo lectura, 23/10/2026):
--   · El registro de cuentas está abierto y el disparador handle_new_user crea un perfil 'usuario' a TODA cuenta nueva.
--     Además la política perfiles_propio_insert deja que cualquier cuenta se cree su propio perfil 'usuario'.
--   · 39 políticas permiten leer/escribir con solo «auth.role() = 'authenticated'» (gastos, IVA, OC, cobros, pagos,
--     financiadores, saldos, ventas…) y 5 con «true»: basta cualquier cuenta con sesión, con o sin perfil BFK.
--   · 14 funciones SECURITY DEFINER que la API puede ejecutar no exigen perfil (dos de ellas escriben).
-- Regla nueva: SOLO una cuenta con perfil en public.perfiles es usuario BFK. Una cuenta nueva NO recibe perfil:
--   queda «por autorizar» hasta que un administrador la autoriza (bfk_autorizar_cuenta). Una cuenta marcada como aislada
--   (auth.users.raw_app_meta_data ->> 'bfk_tipo', p. ej. la futura cuenta de respaldo documental) nunca puede recibir
--   perfil, por lo que nunca ve datos financieros.
-- No modifica ningún dato financiero (la huella financiera debe ser idéntica antes y después). No crea cuentas.
-- Reversión: BORRADOR-2026-10-23-seguridad-perfil-bfk-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';

-- ── 0. Precondiciones: el catálogo es el mismo que se ensayó; hay al menos un administrador; nada de esto existe aún ──
do $pre$
declare v_huella text;
begin
  if to_regprocedure('public.bfk_es_usuario()') is not null or to_regclass('public.perfiles_autorizaciones') is not null then
    raise exception 'SEGURIDAD_DETENIDA: la migración ya estaba aplicada. No se aplicó nada.';
  end if;
  select md5(string_agg(x, E'\n' order by x)) into v_huella from (
    select 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef || '|' || md5(p.prosrc)
           || '|' || coalesce(array_to_string(p.proconfig, ','), '') x
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cartola_manuales', 'cartola_vincular', 'cartola_quitar_alerta', 'fin_calculo_oc', 'fin_exigir_sin_bloqueo',
                         'fin_facturas_vigentes', 'fin_fila_bloqueada', 'fin_tipo_financiamiento', 'handle_new_user',
                         'fin_dif_estado', 'fin_dif_monto', 'fin_monto_tributario', 'fin_motivo_bloqueo', 'fin_periodo_comision',
                         'trib_motivo_incompatible', 'oc_trg_proteger_vendedor', 'rls_auto_enable', 'pv_es_admin')
    union all
    select 'p|' || tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'c|' || column_name || '|' || data_type from information_schema.columns where table_schema = 'public' and table_name = 'perfiles'
    union all
    select 't|' || t.tgname || '|' || pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid in ('auth.users'::regclass, 'public.perfiles'::regclass) and not t.tgisinternal
  ) z;
  if v_huella is distinct from '74a6920a90c24527f799e3955314443c' then
    raise exception 'SEGURIDAD_DETENIDA: el catálogo de seguridad cambió desde el ensayo (huella %). No se aplicó nada.', v_huella;
  end if;
  if not exists (select 1 from public.perfiles where rol = 'admin') then
    raise exception 'SEGURIDAD_DETENIDA: no hay ningún administrador. No se aplicó nada.';
  end if;
end $pre$;

-- ── 1. Funciones de acceso (una sola definición para toda la base) ──
create function public.bfk_es_usuario() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid())
$$;
comment on function public.bfk_es_usuario() is 'Seguridad 23/10/2026: verdadero solo si la cuenta de la sesión tiene perfil BFK (autorizado por un administrador).';
create function public.bfk_es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
$$;
-- Guarda para funciones SECURITY DEFINER: si la llamada viene de la API (sesión anon/authenticated o con usuario),
-- exige perfil BFK. Las conexiones internas sin sesión (tareas programadas, service_role) no se ven afectadas.
create function public.bfk_exigir_perfil_api() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null or coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if auth.uid() is null or not exists (select 1 from public.perfiles p where p.id = auth.uid()) then
      raise exception 'BFK_SIN_PERFIL: esta cuenta no tiene un perfil BFK autorizado' using errcode = '42501';
    end if;
  end if;
  return true;
end $$;
revoke all on function public.bfk_es_usuario(), public.bfk_es_admin(), public.bfk_exigir_perfil_api() from public;
grant execute on function public.bfk_es_usuario(), public.bfk_es_admin(), public.bfk_exigir_perfil_api() to anon, authenticated, service_role;

-- ── 2. Cuentas nuevas: SIN perfil automático ──
-- El disparador on_auth_user_created se conserva (no se toca el esquema auth); su función ya no crea perfiles.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Seguridad 23/10/2026: una cuenta nueva NO recibe perfil ni acceso. Queda «por autorizar» hasta que un
  -- administrador la autorice desde Administración → Usuarios (public.bfk_autorizar_cuenta).
  return new;
end $$;

-- ── 3. Perfiles: nadie se crea su perfil ni se sube de rol; siempre queda al menos un administrador ──
create table public.perfiles_autorizaciones (
  id bigint generated always as identity primary key,
  perfil_id uuid not null,
  correo text,
  nombre text not null,
  rol text not null,
  autorizado_por uuid not null,
  autorizado_por_nombre text,
  autorizado_en timestamptz not null default now()
);
comment on table public.perfiles_autorizaciones is 'Seguridad 23/10/2026: registro de cada cuenta autorizada como usuario BFK (quién, cuándo, con qué rol).';
alter table public.perfiles_autorizaciones enable row level security;
create policy perfiles_autorizaciones_admin_lee on public.perfiles_autorizaciones for select to authenticated using (public.bfk_es_admin());
revoke all on public.perfiles_autorizaciones from anon, authenticated;
grant select on public.perfiles_autorizaciones to authenticated;

create function public.perfiles_proteger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_api boolean := auth.uid() is not null or coalesce(auth.role(), '') in ('anon', 'authenticated');
        v_admin boolean := exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin');
begin
  if tg_op = 'INSERT' then
    if v_api and not v_admin then
      raise exception 'BFK_PERFIL: solo un administrador puede autorizar cuentas' using errcode = '42501';
    end if;
    if exists (select 1 from auth.users u where u.id = new.id and coalesce(u.raw_app_meta_data ->> 'bfk_tipo', '') <> '') then
      raise exception 'BFK_PERFIL: esta cuenta está aislada (%) y no puede recibir un perfil BFK',
        (select u.raw_app_meta_data ->> 'bfk_tipo' from auth.users u where u.id = new.id) using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if v_api and not v_admin and (new.id is distinct from old.id or new.rol is distinct from old.rol
        or new.vendedor_id is distinct from old.vendedor_id or new.financiador_default is distinct from old.financiador_default
        or new.creado_en is distinct from old.creado_en) then
      raise exception 'BFK_PERFIL: solo puedes cambiar tu nombre; rol, vendedor y financiador los cambia un administrador' using errcode = '42501';
    end if;
    if old.rol = 'admin' and new.rol is distinct from 'admin'
       and not exists (select 1 from public.perfiles p where p.rol = 'admin' and p.id <> old.id) then
      raise exception 'BFK_PERFIL: debe quedar al menos un administrador' using errcode = '42501';
    end if;
    return new;
  end if;
  -- DELETE
  if old.rol = 'admin' and not exists (select 1 from public.perfiles p where p.rol = 'admin' and p.id <> old.id) then
    raise exception 'BFK_PERFIL: debe quedar al menos un administrador' using errcode = '42501';
  end if;
  if v_api and not v_admin then
    raise exception 'BFK_PERFIL: solo un administrador puede quitar perfiles' using errcode = '42501';
  end if;
  return old;
end $$;
revoke all on function public.perfiles_proteger() from public, anon, authenticated;
create trigger perfiles_proteger before insert or update or delete on public.perfiles
  for each row execute function public.perfiles_proteger();

-- Cuentas sin perfil (por autorizar). Solo administrador. Devuelve correo y fechas; nada financiero.
create function public.bfk_cuentas_por_autorizar()
returns table (id uuid, correo text, creada_en timestamptz, confirmada boolean, ultimo_ingreso timestamptz, aislada text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.bfk_es_admin() then
    raise exception 'BFK_PERFIL: solo un administrador puede ver las cuentas por autorizar' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, u.created_at, u.email_confirmed_at is not null, u.last_sign_in_at,
           nullif(u.raw_app_meta_data ->> 'bfk_tipo', '')
      from auth.users u
     where not exists (select 1 from public.perfiles p where p.id = u.id)
       and u.deleted_at is null
     order by u.created_at desc;
end $$;

create function public.bfk_autorizar_cuenta(p_id uuid, p_nombre text, p_rol text default 'usuario')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_adm uuid := auth.uid(); v_correo text; v_aislada text; v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
begin
  if not public.bfk_es_admin() then
    raise exception 'BFK_PERFIL: solo un administrador puede autorizar cuentas' using errcode = '42501';
  end if;
  if p_rol not in ('usuario', 'admin') then raise exception 'BFK_PERFIL: rol no válido (%)', p_rol using errcode = '22023'; end if;
  if v_nombre is null then raise exception 'BFK_PERFIL: falta el nombre' using errcode = '22023'; end if;
  select u.email, nullif(u.raw_app_meta_data ->> 'bfk_tipo', '') into v_correo, v_aislada
    from auth.users u where u.id = p_id and u.deleted_at is null for update;
  if not found then raise exception 'BFK_PERFIL: la cuenta no existe' using errcode = '22023'; end if;
  if v_aislada is not null then
    raise exception 'BFK_PERFIL: la cuenta % está aislada (%) y no puede recibir acceso a BFK', v_correo, v_aislada using errcode = '42501';
  end if;
  if exists (select 1 from public.perfiles p where p.id = p_id) then
    return jsonb_build_object('ok', true, 'accion', 'ya_autorizada');
  end if;
  insert into public.perfiles (id, nombre, rol) values (p_id, v_nombre, p_rol);
  insert into public.perfiles_autorizaciones (perfil_id, correo, nombre, rol, autorizado_por, autorizado_por_nombre)
    values (p_id, v_correo, v_nombre, p_rol, v_adm, (select p.nombre from public.perfiles p where p.id = v_adm));
  return jsonb_build_object('ok', true, 'accion', 'autorizada', 'rol', p_rol);
end $$;
revoke all on function public.bfk_cuentas_por_autorizar(), public.bfk_autorizar_cuenta(uuid, text, text) from public, anon;
grant execute on function public.bfk_cuentas_por_autorizar(), public.bfk_autorizar_cuenta(uuid, text, text) to authenticated, service_role;


-- ── 4. Políticas RLS: de «cualquier cuenta autenticada» a «perfil BFK autorizado» (56 políticas) ──
alter policy rw_autenticados on public.ajustes_saldo_financiador using (public.bfk_es_usuario());
alter policy autenticados_editan on public.aportes_socios using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.aportes_socios with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.aportes_socios using (public.bfk_es_usuario());
alter policy rw_autenticados_bm on public.banco_mensual using (public.bfk_es_usuario());
alter policy rw_autenticados_cartolas on public.cartolas_importadas using (public.bfk_es_usuario());
alter policy rw_autenticados on public.categorias_gasto using (public.bfk_es_usuario());
alter policy rw_autenticados on public.contactos_cobranza using (public.bfk_es_usuario());
alter policy ent_leer on public.entidades_catalogo using (public.bfk_es_usuario());
alter policy autenticados_editan on public.eventos_compra using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.eventos_compra with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.eventos_compra using (public.bfk_es_usuario());
alter policy rw_autenticados on public.eventos_entrega using (public.bfk_es_usuario());
alter policy autenticados_editan on public.eventos_factura using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.eventos_factura with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.eventos_factura using (public.bfk_es_usuario());
alter policy autenticados_editan on public.eventos_pago_cliente using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.eventos_pago_cliente with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.eventos_pago_cliente using (public.bfk_es_usuario());
alter policy autenticados_editan on public.eventos_pago_financiamiento using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.eventos_pago_financiamiento with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.eventos_pago_financiamiento using (public.bfk_es_usuario());
alter policy rw_autenticados_postventa on public.eventos_postventa using (public.bfk_es_usuario());
alter policy fin_diferencias_lectura on public.fin_diferencias_historicas using (public.bfk_es_usuario());
alter policy rw_autenticados on public.financiadores using (public.bfk_es_usuario());
alter policy gastos_acceso_autenticados on public.gastos using (public.bfk_es_usuario());
alter policy rw_autenticados on public.gastos_indirectos using (public.bfk_es_usuario());
alter policy historial_agrega on public.historial_cambios with check (public.bfk_es_usuario());
alter policy historial_lee on public.historial_cambios using (public.bfk_es_usuario());
alter policy items_oc_acceso_autenticados on public.items_oc using (public.bfk_es_usuario());
alter policy rw_autenticados on public.iva_mensual using (public.bfk_es_usuario());
alter policy mp_cache_rw_autenticados on public.mp_cache_avisos using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy mp_uso_rw_autenticados on public.mp_uso_diario using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy rw_autenticados_notif on public.notificaciones using (public.bfk_es_usuario());
alter policy bloqueos_actualizar on public.oc_bloqueos using ((public.bfk_es_usuario() AND ((usuario_id = auth.uid()) OR (expira_en <= now())))) with check ((public.bfk_es_usuario() AND ((usuario_id = auth.uid()) AND (expira_en <= (now() + '00:02:00'::interval)))));
alter policy bloqueos_borrar on public.oc_bloqueos using ((public.bfk_es_usuario() AND (usuario_id = auth.uid())));
alter policy bloqueos_insertar on public.oc_bloqueos with check ((public.bfk_es_usuario() AND ((usuario_id = auth.uid()) AND (expira_en <= (now() + '00:02:00'::interval)))));
alter policy bloqueos_leer on public.oc_bloqueos using (public.bfk_es_usuario());
alter policy rw_autenticados_comentarios on public.oc_comentarios using (public.bfk_es_usuario());
alter policy rw_autenticados_links on public.oc_productos_link using (public.bfk_es_usuario());
alter policy rw_autenticados_reclamos on public.oc_reclamos using (public.bfk_es_usuario());
alter policy rw_autenticados_responsables on public.oc_responsables using (public.bfk_es_usuario());
alter policy seg_crean on public.oc_seguimientos with check (public.bfk_es_usuario());
alter policy seg_editan on public.oc_seguimientos using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy seg_leen on public.oc_seguimientos using (public.bfk_es_usuario());
alter policy oc_acceso_autenticados on public.ordenes_compra using (public.bfk_es_usuario());
alter policy autenticados_editan on public.ordenes_compra_v2 using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy autenticados_insertan on public.ordenes_compra_v2 with check (public.bfk_es_usuario());
alter policy autenticados_leen on public.ordenes_compra_v2 using (public.bfk_es_usuario());
alter policy rw_autenticados on public.pagos_vendedor using (public.bfk_es_usuario());
alter policy perfiles_lectura_autenticados on public.perfiles using ((public.bfk_es_usuario() OR (id = auth.uid())));
alter policy saldo_banco_insert_authenticated on public.saldo_banco with check (public.bfk_es_usuario());
alter policy saldo_banco_select_authenticated on public.saldo_banco using (public.bfk_es_usuario());
alter policy saldo_banco_update_authenticated on public.saldo_banco using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
alter policy rw_autenticados on public.vendedores using (public.bfk_es_usuario());
alter policy ventas_acceso_autenticados on public.ventas using (public.bfk_es_usuario());
drop policy perfiles_propio_insert on public.perfiles;   -- nadie crea su propio perfil: lo crea un administrador

-- ── 5. Funciones SECURITY DEFINER que la app usa y no exigían perfil: misma función + guarda al inicio ──
CREATE OR REPLACE FUNCTION public.cartola_manuales(p_tabla text, p_destinos text[], p_fecha date, p_monto numeric) RETURNS TABLE(ids text[], total numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  return query execute pg_catalog.format($q$
    with filas as (
      select e.id, e."creadoEn" grupo, public.cartola_monto(%L, pg_catalog.to_jsonb(e)) monto,
             public.cartola_destino(%L, pg_catalog.to_jsonb(e)) destino
        from public.%I e
       where e.marca_cartola is null %s and e.fecha between $2 - 3 and $2 + 3)
    select pg_catalog.array_agg(f.id order by f.id), sum(f.monto) from filas f group by f.grupo
    having sum(f.monto) = $3 and bool_or(f.destino = any ($1))$q$,
    p_tabla, p_tabla, p_tabla, case when p_tabla = 'pagos_vendedor' then 'and e.anulado_en is null' else '' end)
  using p_destinos, p_fecha, p_monto;
end $_$;
CREATE OR REPLACE FUNCTION public.cartola_vincular(p_tabla text, p_ids text[], p_marca text, p_max integer, p_financiador_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_mov record; v_vinc record; v_hoy date := (pg_catalog.now() at time zone 'America/Santiago')::date;
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  if auth.uid() is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_tabla not in ('eventos_pago_cliente','eventos_pago_financiamiento','gastos_indirectos','pagos_vendedor','aportes_socios') then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  select * into v_mov from public.cartola_leer_marca(p_marca);
  if v_mov.fecha <= date '2026-10-07' or v_mov.fecha > v_hoy then raise exception 'Movimiento fuera del período registrable'; end if;
  if (p_tabla = 'eventos_pago_cliente') <> (v_mov.abono > 0) then raise exception 'El tipo de registro no corresponde al sentido del movimiento'; end if;
  if coalesce(pg_catalog.cardinality(p_ids), 0) not between 1 and coalesce(p_max, 1) then raise exception 'Cantidad de registros a vincular inválida'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bfk_cartola:' || p_marca, 0));
  execute pg_catalog.format($q$select count(*) n, coalesce(sum(public.cartola_monto(%L, pg_catalog.to_jsonb(e))), 0) total,
      bool_and(e.marca_cartola is null) libres, bool_and(e.fecha between $2 - 3 and $2 + 3 and e.fecha > date '2026-10-07') cerca,
      bool_and($3::text is null or (pg_catalog.to_jsonb(e) ->> 'financiador_id') = $3) mismo
      from public.%I e where e.id = any ($1) %s$q$, p_tabla, p_tabla, case when p_tabla = 'pagos_vendedor' then 'and e.anulado_en is null' else '' end)
    into v_vinc using p_ids, v_mov.fecha, p_financiador_id;
  if v_vinc.n <> pg_catalog.cardinality(p_ids) or not v_vinc.libres or not v_vinc.mismo then
    raise exception 'Algún registro a vincular no existe, está anulado, ya tiene marca o es de otro destino';
  end if;
  if not v_vinc.cerca then raise exception 'Los registros a vincular deben ser posteriores al cierre y de ±3 días del movimiento'; end if;
  if v_vinc.total <> v_mov.cargo + v_mov.abono then raise exception 'Los registros a vincular suman % y el movimiento es %', v_vinc.total, v_mov.cargo + v_mov.abono; end if;
  perform pg_catalog.set_config('bfk.cartola_vincular', '1', true);
  execute pg_catalog.format($q$update public.%I e set marca_cartola = $1, marca_parte = s.parte, marca_partes = $3, alerta_cartola = null
      from (select x id, row_number() over (order by x) parte from pg_catalog.unnest($2) x) s where e.id = s.id$q$, p_tabla)
    using p_marca, p_ids, pg_catalog.cardinality(p_ids);
  perform pg_catalog.set_config('bfk.cartola_vincular', '', true);
  return pg_catalog.jsonb_build_object('ok', true, 'vinculados', pg_catalog.to_jsonb(p_ids), 'marca', p_marca);
end $_$;
CREATE OR REPLACE FUNCTION public.cartola_quitar_alerta(p_tabla text, p_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_n int;
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  if auth.uid() is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_tabla not in ('eventos_pago_cliente','eventos_pago_financiamiento','gastos_indirectos','pagos_vendedor','aportes_socios') then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  execute pg_catalog.format('update public.%I e set alerta_cartola = null where e.id = $1 and e.alerta_cartola is not null', p_tabla) using p_id;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'quitadas', v_n);
end $_$;
CREATE OR REPLACE FUNCTION public.fin_calculo_oc(p_oc_id text, p_con_diferencias boolean DEFAULT true, OUT costo_total numeric, OUT estado_compra text, OUT monto_pagado_fin numeric, OUT estado_pago_financiamiento text, OUT monto_facturado numeric, OUT estado_factura_propia text, OUT monto_cobrado numeric, OUT estado_pago_cliente text, OUT tipo_financiamiento text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
#variable_conflict use_column
declare
  v_existe boolean; v_n_compras int; v_n_vigentes int; v_ov text;
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  select true into v_existe from public.ordenes_compra_v2 o where o.id = p_oc_id;
  if v_existe is null then return; end if;
  select coalesce(sum(e.costo_compra), 0), count(*) into costo_total, v_n_compras
    from public.eventos_compra e where e.oc_id = p_oc_id;
  select coalesce(sum(p.monto), 0) into monto_pagado_fin
    from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id;
  select count(*) into v_n_vigentes from public.fin_facturas_vigentes(p_oc_id) v;
  monto_facturado := public.fin_monto_tributario(p_oc_id);
  select coalesce(sum(c.monto), 0) into monto_cobrado
    from public.eventos_pago_cliente c where c.oc_id = p_oc_id;
  if p_con_diferencias then
    costo_total      := costo_total      + public.fin_dif_monto('oc', p_oc_id, 'costo_total');
    monto_pagado_fin := monto_pagado_fin + public.fin_dif_monto('oc', p_oc_id, 'monto_pagado_fin');
    monto_facturado  := monto_facturado  + public.fin_dif_monto('oc', p_oc_id, 'monto_facturado');
    monto_cobrado    := monto_cobrado    + public.fin_dif_monto('oc', p_oc_id, 'monto_cobrado');
  end if;
  tipo_financiamiento := public.fin_tipo_financiamiento(p_oc_id);
  estado_compra := case when v_n_compras > 0 then 'comprado' else 'pendiente' end;
  estado_pago_financiamiento := case
    when tipo_financiamiento <> 'externo' then 'no_aplica'
    when costo_total <= 0 then 'pendiente'
    when monto_pagado_fin >= costo_total then 'pagado'
    when monto_pagado_fin > 0 then 'parcial'
    else 'pendiente' end;
  estado_factura_propia := case when v_n_vigentes > 0 then 'emitida' else 'pendiente' end;
  estado_pago_cliente := case
    when monto_cobrado <= 0 then 'pendiente'
    when monto_facturado > 0 and monto_cobrado >= monto_facturado then 'pagado'
    else 'parcial' end;
  if p_con_diferencias then
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_compra');              if v_ov is not null then estado_compra := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_financiamiento'); if v_ov is not null then estado_pago_financiamiento := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_factura_propia');      if v_ov is not null then estado_factura_propia := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_cliente');        if v_ov is not null then estado_pago_cliente := v_ov; end if;
  end if;
  return;
end $$;
CREATE OR REPLACE FUNCTION public.fin_exigir_sin_bloqueo(p_oc_id text, p_dominio text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_motivo text; v_num text;
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  if p_oc_id is null or public.fin_es_importacion() then return; end if;
  v_motivo := public.fin_motivo_bloqueo(p_oc_id, p_dominio);
  if v_motivo is not null then
    select o.numero_oc into v_num from public.ordenes_compra_v2 o where o.id = p_oc_id;
    raise exception 'La OC % tiene una corrección histórica pendiente de aprobación (%). No se registró ningún cambio.',
      coalesce(v_num, p_oc_id), v_motivo using errcode = 'P4B01';
  end if;
end $$;
CREATE OR REPLACE FUNCTION public.trib_motivo_incompatible(p_ambito text, p_cot uuid, p_oc text, p_tratamiento text, p_procedimiento text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare o public.ordenes_compra_v2%rowtype; c public.cotizaciones%rowtype; v_af text; v_ex text; v_iva numeric; v_docs integer;
begin
  perform public.bfk_exigir_perfil_api();   -- seguridad 23/10/2026: una llamada desde la API exige perfil BFK
  if p_ambito = 'oc' then
    select * into o from public.ordenes_compra_v2 where id = p_oc;
    if not found then return 'OC no encontrada'; end if;
    if o.archivada then return 'La OC está archivada.'; end if;
    select string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where coalesce(tipo_dte, 33) = 33),
           string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where tipo_dte = 34)
      into v_af, v_ex from public.fin_facturas_vigentes(p_oc);
    -- Documentos vigentes incompatibles: primero se corrige el documento (nota de crédito código 1), después la clasificación.
    if p_tratamiento <> 'afecta' and v_af is not null then
      return format('La OC tiene factura afecta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como exenta.', v_af); end if;
    if p_tratamiento = 'afecta' and v_ex is not null then
      return format('La OC tiene factura exenta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como afecta.', v_ex); end if;
    select count(*) into v_docs from public.eventos_factura where oc_id = p_oc;
    if v_docs > 0 and length(btrim(coalesce(p_procedimiento, ''))) < 10 then
      return 'La OC ya tiene documentos SII: describe el procedimiento documental (notas de crédito y facturas que respaldan el cambio).'; end if;
    -- Mercado Público como verificación (nunca como autorización): impuestos > 0 contradicen una exención.
    select nullif(datos ->> 'iva', '')::numeric into v_iva from public.mp_cache_avisos where id = 'oc_mp:' || p_oc and jsonb_typeof(datos) = 'object';
    if p_tratamiento <> 'afecta' and coalesce(v_iva, 0) > 0 then
      return format('Mercado Público informa impuestos de $%s en esta OC: no corresponde una exención.', v_iva); end if;
    return null;
  end if;
  select * into c from public.cotizaciones where id = p_cot;
  if not found then return 'Cotización no encontrada'; end if;
  -- Una OC ya clasificada a partir de esta cotización se corrige en la OC, no aquí.
  if exists (select 1 from public.trib_clasificaciones h join public.trib_clasificaciones hc on hc.id = h.origen_clasificacion_id
              where h.ambito = 'oc' and h.estado = 'aprobada' and hc.cotizacion_id = p_cot) then
    return 'Una OC ya heredó la clasificación de esta cotización: el cambio se hace en la OC.'; end if;
  return null;
end $_$;
CREATE OR REPLACE FUNCTION public.fin_facturas_vigentes(p_oc_id text) RETURNS SETOF public.eventos_factura
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select f.* from public.eventos_factura f
   where f.oc_id = p_oc_id
     and coalesce(f.tipo_dte, 33) in (33, 34)
     and not exists (select 1 from public.eventos_factura a
                      where a.oc_id = f.oc_id and a.id <> f.id
                        and nullif(btrim(f.numero_factura), '') is not null
                        and ((coalesce(a.tipo_dte, 33) in (33, 34)
                              and nullif(btrim(a.factura_anulada_numero), '') is not null
                              and btrim(a.factura_anulada_numero) = btrim(f.numero_factura))
                          or (a.tipo_dte = 61 and a.ref_codigo = 1 and btrim(a.ref_folio) = btrim(f.numero_factura))))
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_fila_bloqueada(p_tabla text, p_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select string_agg(coalesce(d.etiqueta, d.entidad_id) || ': ' || d.causa, ' · ') from public.fin_diferencias_historicas d
   where d.estado = 'pendiente' and (p_tabla || ':' || p_id) = any(d.filas)
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_tipo_financiamiento(p_oc_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select case when o.es_venta_propia then 'venta_propia'
              when f.tipo = 'propio' then 'fondos_propios'
              else 'externo' end
    from public.ordenes_compra_v2 o left join public.financiadores f on f.id = o.financiador_id
   where o.id = p_oc_id
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_dif_estado(p_oc_id text, p_campo text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select d.valor_registrado from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is null
   limit 1
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_dif_monto(p_entidad text, p_id text, p_campo text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select coalesce(sum(d.diferencia), 0) from public.fin_diferencias_historicas d
   where d.entidad = p_entidad and d.entidad_id = p_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_monto_tributario(p_oc_id text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  with vig as (select * from public.fin_facturas_vigentes(p_oc_id))
  select coalesce((select sum(v.monto) from vig v), 0)
       + coalesce((select sum(d.monto) from public.eventos_factura d where d.oc_id = p_oc_id and d.tipo_dte = 56), 0)
       - coalesce((select sum(n.monto) from public.eventos_factura n
                    where n.oc_id = p_oc_id and n.tipo_dte = 61 and n.ref_codigo = 3
                      and btrim(n.ref_folio) in (select btrim(v.numero_factura) from vig v)), 0)
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_motivo_bloqueo(p_oc_id text, p_dominio text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select string_agg(d.causa, ' · ' order by d.campo) from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.estado = 'pendiente' and p_dominio = any(d.bloquea)
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
CREATE OR REPLACE FUNCTION public.fin_periodo_comision(p_oc_id text, OUT anio integer, OUT mes integer) RETURNS record
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select extract(year from m)::int, extract(month from m)::int
    from (select max(f.fecha) m from public.fin_facturas_vigentes(p_oc_id) f) z
   where m is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
-- ── 6. Funciones internas: sin EXECUTE para las cuentas de la API ──
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.oc_trg_proteger_vendedor() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
revoke execute on function public.pv_es_admin() from anon;

-- ── 7. Permisos de tablas (defensa adicional a RLS) ──
-- anon (sin sesión) no necesita ninguna tabla de public: se le quitan todos los permisos.
-- authenticated conserva SELECT/INSERT/UPDATE/DELETE (los filtra RLS) y pierde TRUNCATE, REFERENCES, TRIGGER y MAINTAIN,
-- que la app no usa y que no pasan por RLS.
do $perm$
declare r record; v_extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
begin
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('revoke truncate, references, trigger%s on table public.%I from authenticated', v_extra, r.relname);
  end loop;
  -- Tablas futuras creadas por postgres en public: mismo criterio por defecto.
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
  execute format('alter default privileges for role postgres in schema public revoke truncate, references, trigger%s on tables from authenticated', v_extra);
end $perm$;

-- ── 8. Verificación dentro de la misma transacción (si algo no cuadra, ROLLBACK automático) ──
do $ver$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') ~ 'auth\.role\(\)' or coalesce(with_check, '') ~ 'auth\.role\(\)');
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: quedan % políticas con auth.role()', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and 'authenticated' = any(roles) and (qual = 'true' or with_check = 'true');
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: quedan % políticas «true» para authenticated', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'perfiles' and cmd = 'INSERT') then
    raise exception 'SEGURIDAD_DETENIDA: perfiles todavía admite INSERT por política';
  end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: anon conserva % permisos de tabla', n; end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('cartola_manuales', 'cartola_vincular', 'cartola_quitar_alerta', 'fin_calculo_oc', 'fin_exigir_sin_bloqueo',
                       'trib_motivo_incompatible', 'fin_facturas_vigentes', 'fin_fila_bloqueada', 'fin_tipo_financiamiento',
                       'fin_dif_estado', 'fin_dif_monto', 'fin_monto_tributario', 'fin_motivo_bloqueo', 'fin_periodo_comision')
     and p.prosrc like '%bfk_exigir_perfil_api%';
  if n <> 14 then raise exception 'SEGURIDAD_DETENIDA: solo % de 14 funciones tienen la guarda', n; end if;
  if has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
     or has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
     or has_function_privilege('anon', 'public.pv_es_admin()', 'execute') then
    raise exception 'SEGURIDAD_DETENIDA: quedan funciones internas ejecutables desde la API';
  end if;
end $ver$;

commit;
