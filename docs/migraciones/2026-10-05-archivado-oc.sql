-- ARCHIVADO DE OC (reemplaza la eliminación física por un archivado reversible). NO ejecutado en producción.
-- Ejecutar con psql --single-transaction, como dueño de las tablas (postgres).
-- * Agrega a ordenes_compra_v2 columnas de archivo (por defecto: no archivada). No modifica ningún valor existente:
--   las 286 OCs actuales quedan activas y sus datos idénticos.
-- * archivar_oc / restaurar_oc: solo administrador (auth.uid() + perfiles.rol = 'admin'), una transacción, registran
--   quién y cuándo en historial_cambios. No borran ni modifican eventos, productos, comentarios, reclamos, postventa,
--   historial ni saldos: archivar solo oculta la OC de la operación normal; restaurar la devuelve exactamente igual.
-- * Un trigger impide que un usuario que no es administrador cambie las columnas de archivo por la API.
-- * Los respaldos (pg_dump) y el exportador Excel incluyen las columnas nuevas automáticamente.
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='ordenes_compra_v2' and column_name='archivada') then
    raise exception 'ARCHIVADO_ABORTADO: las columnas de archivo ya existen';
  end if;
end $$;

alter table public.ordenes_compra_v2
  add column archivada boolean not null default false,
  add column archivada_en timestamptz,
  add column archivada_por uuid,
  add column archivada_por_nombre text,
  add column archivo_motivo text;

create index ordenes_compra_v2_archivada_idx on public.ordenes_compra_v2 (archivada) where archivada;

-- Solo un administrador puede cambiar las columnas de archivo (conexiones directas del dueño, sin sesión, quedan permitidas
-- para migraciones y restauraciones de respaldo).
create function public.proteger_archivo_oc() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' and coalesce(new.archivada, false))
     or (tg_op = 'UPDATE' and (new.archivada, new.archivada_en, new.archivada_por, new.archivada_por_nombre, new.archivo_motivo)
                              is distinct from (old.archivada, old.archivada_en, old.archivada_por, old.archivada_por_nombre, old.archivo_motivo)) then
    if auth.uid() is not null and not exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin') then
      raise exception 'Solo un administrador puede archivar o restaurar una OC' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.proteger_archivo_oc() from public, anon, authenticated;
create trigger proteger_archivo_oc before insert or update on public.ordenes_compra_v2
  for each row execute function public.proteger_archivo_oc();

create function public.archivar_oc(p_oc_id text, p_motivo text default null) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text; v_rol text; v_oc public.ordenes_compra_v2%rowtype; v_motivo text := nullif(btrim(coalesce(p_motivo,'')), ''); v_ahora timestamptz := now();
begin
  if v_uid is null then raise exception 'ARCHIVO_RECHAZADO: se requiere una sesión válida' using errcode = 'IE003'; end if;
  select rol, nombre into v_rol, v_nombre from public.perfiles where id = v_uid;
  if v_rol is distinct from 'admin' then raise exception 'ARCHIVO_RECHAZADO: solo un administrador puede archivar una OC' using errcode = 'IE003'; end if;
  if length(coalesce(v_motivo,'')) > 500 then raise exception 'ARCHIVO_RECHAZADO: motivo demasiado largo (máximo 500)' using errcode = 'IE001'; end if;
  select * into v_oc from public.ordenes_compra_v2 where id = p_oc_id for update;
  if not found then raise exception 'ARCHIVO_RECHAZADO: la OC no existe' using errcode = 'IE001'; end if;
  if v_oc.archivada then raise exception 'ARCHIVO_RECHAZADO: la OC ya está archivada' using errcode = 'IE001'; end if;
  update public.ordenes_compra_v2 set archivada = true, archivada_en = v_ahora, archivada_por = v_uid,
         archivada_por_nombre = v_nombre, archivo_motivo = v_motivo where id = p_oc_id;
  insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
  values ('hc_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 5),
          p_oc_id, v_oc.numero_oc, v_uid, v_nombre, 'OC archivada', 'archivada', 'activa', coalesce('archivada · motivo: ' || v_motivo, 'archivada'));
  return jsonb_build_object('ok', true, 'oc_id', p_oc_id, 'archivada_en', v_ahora);
end $$;

create function public.restaurar_oc(p_oc_id text) returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text; v_rol text; v_oc public.ordenes_compra_v2%rowtype;
begin
  if v_uid is null then raise exception 'ARCHIVO_RECHAZADO: se requiere una sesión válida' using errcode = 'IE003'; end if;
  select rol, nombre into v_rol, v_nombre from public.perfiles where id = v_uid;
  if v_rol is distinct from 'admin' then raise exception 'ARCHIVO_RECHAZADO: solo un administrador puede restaurar una OC' using errcode = 'IE003'; end if;
  select * into v_oc from public.ordenes_compra_v2 where id = p_oc_id for update;
  if not found then raise exception 'ARCHIVO_RECHAZADO: la OC no existe' using errcode = 'IE001'; end if;
  if not v_oc.archivada then raise exception 'ARCHIVO_RECHAZADO: la OC no está archivada' using errcode = 'IE001'; end if;
  update public.ordenes_compra_v2 set archivada = false, archivada_en = null, archivada_por = null,
         archivada_por_nombre = null, archivo_motivo = null where id = p_oc_id;
  insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
  values ('hc_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 5),
          p_oc_id, v_oc.numero_oc, v_uid, v_nombre, 'OC restaurada', 'archivada',
          'archivada el ' || to_char(v_oc.archivada_en at time zone 'America/Santiago', 'DD-MM-YYYY HH24:MI') || ' por ' || coalesce(v_oc.archivada_por_nombre, '?')
            || coalesce(' · motivo: ' || v_oc.archivo_motivo, ''), 'activa');
  return jsonb_build_object('ok', true, 'oc_id', p_oc_id);
end $$;

revoke all on function public.archivar_oc(text, text) from public, anon;
revoke all on function public.restaurar_oc(text) from public, anon;
grant execute on function public.archivar_oc(text, text) to authenticated;
grant execute on function public.restaurar_oc(text) to authenticated;
