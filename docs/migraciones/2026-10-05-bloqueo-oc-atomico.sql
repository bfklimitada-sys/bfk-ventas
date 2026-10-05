-- Bloqueo cooperativo de edición de OC — RPC atómica + RLS estricta.
-- Reversible con 2026-10-05-bloqueo-oc-atomico-deshacer.sql. No modifica datos de oc_bloqueos ni ordenes_compra_v2.
-- Reglas: tiempo solo de PostgreSQL (now()); propietario solo desde auth.uid(); TTL 45 s (renovación del cliente cada 15 s).
begin;

create or replace function public.gestionar_bloqueo_oc(p_oc_id text, p_accion text, p_ttl_segundos int default 45)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_ttl_min constant int := 15;
  c_ttl_max constant int := 120;
  v_uid    uuid := auth.uid();
  v_ttl    int  := least(greatest(coalesce(p_ttl_segundos, 45), c_ttl_min), c_ttl_max);
  v_nombre text;
  v_fila   public.oc_bloqueos;
  v_otro   public.oc_bloqueos;
  v_n      int;
  v_try    int;
begin
  if v_uid is null then
    raise exception 'BLOQUEO: se requiere una sesión válida' using errcode = '28000';
  end if;
  if p_accion is null or p_accion not in ('adquirir', 'renovar', 'liberar') then
    raise exception 'BLOQUEO: acción no válida' using errcode = '22023';
  end if;
  if p_oc_id is null or length(p_oc_id) = 0 or length(p_oc_id) > 100 then
    raise exception 'BLOQUEO: oc_id no válido' using errcode = '22023';
  end if;

  -- Liberar: solo la fila propia. Si no es propia no hace nada.
  if p_accion = 'liberar' then
    delete from public.oc_bloqueos where oc_id = p_oc_id and usuario_id = v_uid;
    get diagnostics v_n = row_count;
    return jsonb_build_object('ok', true, 'accion', 'liberar', 'liberado', v_n > 0, 'ahora', now());
  end if;

  -- Renovar: solo si sigo siendo el propietario de la fila (aunque haya vencido, mientras nadie más la haya tomado).
  if p_accion = 'renovar' then
    update public.oc_bloqueos
       set expira_en = now() + make_interval(secs => v_ttl)
     where oc_id = p_oc_id and usuario_id = v_uid
    returning * into v_fila;
    if found then
      return jsonb_build_object('ok', true, 'accion', 'renovar', 'propio', true, 'expira_en', v_fila.expira_en,
                                'segundos_restantes', ceil(extract(epoch from v_fila.expira_en - now()))::int, 'ahora', now());
    end if;
    select * into v_otro from public.oc_bloqueos where oc_id = p_oc_id;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'perdido', 'usuario_nombre', v_otro.usuario_nombre, 'expira_en', v_otro.expira_en,
                                'segundos_restantes', greatest(0, ceil(extract(epoch from v_otro.expira_en - now()))::int), 'ahora', now());
    end if;
    return jsonb_build_object('ok', false, 'motivo', 'sin_bloqueo', 'ahora', now());
  end if;

  -- Adquirir: una sola sentencia atómica. Toma la fila solo si no existe, es propia o está vencida (reloj del servidor).
  select nombre into v_nombre from public.perfiles where id = v_uid;
  for v_try in 1..2 loop
    insert into public.oc_bloqueos as b (oc_id, usuario_id, usuario_nombre, expira_en)
    values (p_oc_id, v_uid, coalesce(v_nombre, 'Usuario'), now() + make_interval(secs => v_ttl))
    on conflict (oc_id) do update
      set usuario_id = excluded.usuario_id, usuario_nombre = excluded.usuario_nombre, expira_en = excluded.expira_en
      where b.usuario_id = v_uid or b.expira_en <= now()
    returning b.* into v_fila;
    if found then
      return jsonb_build_object('ok', true, 'accion', 'adquirir', 'propio', true, 'expira_en', v_fila.expira_en,
                                'segundos_restantes', ceil(extract(epoch from v_fila.expira_en - now()))::int, 'ahora', now());
    end if;
    select * into v_otro from public.oc_bloqueos where oc_id = p_oc_id;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'ocupada', 'usuario_nombre', v_otro.usuario_nombre, 'expira_en', v_otro.expira_en,
                                'segundos_restantes', greatest(0, ceil(extract(epoch from v_otro.expira_en - now()))::int), 'ahora', now());
    end if;
    -- la fila fue liberada entre el intento y la lectura: se reintenta una vez
  end loop;
  return jsonb_build_object('ok', false, 'motivo', 'reintentar', 'ahora', now());
end
$$;

revoke all on function public.gestionar_bloqueo_oc(text, text, int) from public, anon;
grant execute on function public.gestionar_bloqueo_oc(text, text, int) to authenticated;

create or replace view public.oc_bloqueos_vigentes with (security_invoker = true) as
  select oc_id, usuario_id, usuario_nombre, expira_en,
         greatest(0, ceil(extract(epoch from expira_en - now()))::int) as segundos_restantes,
         now() as ahora
    from public.oc_bloqueos
   where expira_en > now();
revoke all on public.oc_bloqueos_vigentes from public, anon;
grant select on public.oc_bloqueos_vigentes to authenticated;

-- RLS: se reemplaza la política permisiva (ALL para cualquier autenticado) por políticas específicas.
alter table public.oc_bloqueos enable row level security;
drop policy if exists rw_autenticados_bloqueos on public.oc_bloqueos;
drop policy if exists bloqueos_leer on public.oc_bloqueos;
drop policy if exists bloqueos_insertar on public.oc_bloqueos;
drop policy if exists bloqueos_actualizar on public.oc_bloqueos;
drop policy if exists bloqueos_borrar on public.oc_bloqueos;

create policy bloqueos_leer on public.oc_bloqueos for select to authenticated using (true);
-- Insertar/actualizar: solo a nombre propio y sin poder fijar un vencimiento lejano (evita bloqueos casi permanentes por REST directo).
create policy bloqueos_insertar on public.oc_bloqueos for insert to authenticated
  with check (usuario_id = auth.uid() and expira_en <= now() + interval '2 minutes');
create policy bloqueos_actualizar on public.oc_bloqueos for update to authenticated
  using (usuario_id = auth.uid() or expira_en <= now())
  with check (usuario_id = auth.uid() and expira_en <= now() + interval '2 minutes');
-- Borrar: solo el propietario. Las filas vencidas ajenas no se borran por REST (la limpieza queda para una tarea controlada).
create policy bloqueos_borrar on public.oc_bloqueos for delete to authenticated using (usuario_id = auth.uid());

commit;
