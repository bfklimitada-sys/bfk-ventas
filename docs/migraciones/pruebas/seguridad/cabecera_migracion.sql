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
  if v_huella is distinct from '__HUELLA_CATALOGO__' then
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

