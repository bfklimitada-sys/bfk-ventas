-- Base LOCAL desechable para probar la migración del Centro de Acciones (17/11/2026).
-- Replica, tal como están en producción (lectura del 17/11/2026), los objetos que toca o lee la migración:
-- perfiles, ordenes_compra_v2 (columnas usadas), historial_cambios, eventos_postventa, eventos_entrega, notificaciones,
-- oc_seguimientos con su función seg_antes_guardar y sus políticas, bfk_es_usuario / bfk_es_admin / seg_es_admin.
-- auth.uid() / auth.role() leen request.jwt.claims igual que en Supabase.
drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit password 'prueba'; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') $$;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Como en producción: historial_cambios.usuario_id y notificaciones.usuario_id apuntan a auth.users.
create table auth.users(id uuid primary key, email text, is_sso_user boolean not null default false);
insert into auth.users(id, email) values ('11111111-1111-1111-1111-111111111111','a@x'),('22222222-2222-2222-2222-222222222222','b@x'),('33333333-3333-3333-3333-333333333333','c@x');
create table public.perfiles(id uuid primary key references auth.users(id), nombre text not null, rol text not null default 'usuario', creado_en timestamptz default now(), financiador_default text, vendedor_id text);
create table public.ordenes_compra_v2(id text primary key, numero_oc text not null, cliente text, entidad text, estado_entrega text, estado_postventa text,
  archivada boolean not null default false, monto_total numeric, costo_total numeric, "creadoEn" timestamptz default now());
create table public.historial_cambios(id text primary key, oc_id text, oc_numero text, usuario_id uuid references auth.users(id), usuario_nombre text, accion text not null, campo text,
  valor_anterior text, valor_nuevo text, "creadoEn" timestamptz default now());
create index idx_historial_oc on public.historial_cambios(oc_id);
create table public.eventos_postventa(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, tipo text, descripcion text,
  estado text default 'abierto', solucion text, fecha_resolucion date, creado_por uuid, "creadoEn" timestamptz default now(), costo_extra numeric default 0, detalle_costo text);
create table public.eventos_entrega(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, persona_recibe text default '',
  notas text default '', "creadoEn" timestamptz default now(), creado_por uuid);
create table public.notificaciones(id text primary key, usuario_id uuid references auth.users(id), tipo text, oc_id text, oc_numero text, mensaje text, leida boolean default false, "creadoEn" timestamptz default now());

create function public.bfk_es_usuario() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid()) $$;
create function public.bfk_es_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin') $$;
revoke all on function public.bfk_es_usuario(), public.bfk_es_admin() from public;
grant execute on function public.bfk_es_usuario(), public.bfk_es_admin() to anon, authenticated, service_role;

alter table public.perfiles enable row level security;
create policy perfiles_lectura_autenticados on public.perfiles for select using (public.bfk_es_usuario() or id = auth.uid());
alter table public.ordenes_compra_v2 enable row level security;
create policy rw on public.ordenes_compra_v2 for all using (public.bfk_es_usuario());
alter table public.historial_cambios enable row level security;
create policy historial_agrega on public.historial_cambios for insert with check (public.bfk_es_usuario());
create policy historial_lee on public.historial_cambios for select using (public.bfk_es_usuario());
create policy historial_solo_admin_borra on public.historial_cambios for delete using (exists (select 1 from public.perfiles where perfiles.id = auth.uid() and perfiles.rol = 'admin'));
alter table public.eventos_postventa enable row level security;
create policy rw_autenticados_postventa on public.eventos_postventa for all using (public.bfk_es_usuario());
alter table public.eventos_entrega enable row level security;
create policy rw_autenticados on public.eventos_entrega for all using (public.bfk_es_usuario());
alter table public.notificaciones enable row level security;
create policy rw_autenticados_notif on public.notificaciones for all using (public.bfk_es_usuario());

-- oc_seguimientos: DDL de docs/migraciones/2026-10-15-seguimiento-especial.sql + políticas de la seguridad del 23/10/2026.
create table public.oc_seguimientos (
  id text primary key,
  oc_id text not null references public.ordenes_compra_v2(id) on delete restrict,
  categoria text not null check (categoria in ('postventa','sobrecosto','proveedor','producto','entrega','cliente','facturacion','otro')),
  descripcion text not null check (length(btrim(descripcion)) > 0),
  prioridad text not null default 'media' check (prioridad in ('baja','media','alta')),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_gestion','resuelto')),
  responsable_id uuid references public.perfiles(id) on delete set null,
  responsable_nombre text, fecha_revision date,
  sobrecosto_estimado numeric(14,0) check (sobrecosto_estimado is null or sobrecosto_estimado >= 0),
  solucion text, resuelto_por uuid, resuelto_por_nombre text, resuelto_en timestamptz,
  creado_por uuid, creado_por_nombre text, creado_en timestamptz not null default now(), actualizado_por uuid, actualizado_en timestamptz,
  constraint oc_seguimientos_resuelto_con_solucion check (estado <> 'resuelto' or (length(btrim(coalesce(solucion,''))) > 0 and resuelto_en is not null))
);
create index oc_seguimientos_oc_idx on public.oc_seguimientos (oc_id);
comment on table public.oc_seguimientos is 'Seguimiento especial de OC (situaciones que requieren atención). sobrecosto_estimado es solo informativo: no es compra, gasto, deuda ni utilidad.';
create index oc_seguimientos_abiertos_idx on public.oc_seguimientos (oc_id) where estado <> 'resuelto';
create function public.seg_es_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin') $$;
revoke all on function public.seg_es_admin() from public; grant execute on function public.seg_es_admin() to authenticated;
create or replace function public.seg_antes_guardar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  select p.nombre into v_nombre from public.perfiles p where p.id = v_uid;
  if tg_op = 'INSERT' then
    new.creado_por := v_uid; new.creado_por_nombre := coalesce(v_nombre, ''); new.creado_en := now();
    new.actualizado_por := null; new.actualizado_en := null;
    if new.estado = 'resuelto' then raise exception 'Un seguimiento se crea abierto (Pendiente o En gestión)'; end if;
    new.solucion := null; new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
    return new;
  end if;
  -- UPDATE
  if new.id <> old.id or new.oc_id <> old.oc_id or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en or new.creado_por_nombre is distinct from old.creado_por_nombre then
    raise exception 'No se puede cambiar la OC, el autor ni la fecha de creación de un seguimiento';
  end if;
  if old.estado = 'resuelto' and not public.seg_es_admin() then
    raise exception 'Este seguimiento ya está resuelto: queda como historial (solo un administrador puede modificarlo)';
  end if;
  if new.estado = 'resuelto' and old.estado <> 'resuelto' then
    if length(btrim(coalesce(new.solucion, ''))) = 0 then raise exception 'Para resolver, describe brevemente la solución'; end if;
    new.resuelto_por := v_uid; new.resuelto_por_nombre := coalesce(v_nombre, ''); new.resuelto_en := now();
  elsif new.estado <> 'resuelto' then
    new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
  else
    new.resuelto_por := old.resuelto_por; new.resuelto_por_nombre := old.resuelto_por_nombre; new.resuelto_en := old.resuelto_en;
  end if;
  new.actualizado_por := v_uid; new.actualizado_en := now();
  return new;
end $$;
create trigger seg_antes_guardar before insert or update on public.oc_seguimientos for each row execute function public.seg_antes_guardar();
alter table public.oc_seguimientos enable row level security;
create policy seg_leen on public.oc_seguimientos for select to authenticated using (public.bfk_es_usuario());
create policy seg_crean on public.oc_seguimientos for insert to authenticated with check (public.bfk_es_usuario());
create policy seg_editan on public.oc_seguimientos for update to authenticated using (public.bfk_es_usuario()) with check (public.bfk_es_usuario());
create policy seg_solo_admin_borra on public.oc_seguimientos for delete to authenticated using (public.seg_es_admin());
grant select, insert, update, delete on public.oc_seguimientos to authenticated;
revoke all on public.oc_seguimientos from anon;
revoke all on function public.seg_es_admin() from anon;
revoke all on function public.seg_antes_guardar() from public, anon, authenticated;

-- Datos de prueba (ficticios)
insert into public.perfiles(id, nombre, rol) values
  ('11111111-1111-1111-1111-111111111111','Admin Prueba','admin'),
  ('22222222-2222-2222-2222-222222222222','Ana Prueba','usuario'),
  ('33333333-3333-3333-3333-333333333333','Beto Prueba','usuario');
insert into public.ordenes_compra_v2(id, numero_oc, cliente, estado_entrega, estado_postventa, archivada) values
  ('oc1','1000-1-AG26','MUNICIPALIDAD UNO','confirmada','con_incidencia',false),
  ('oc2','1000-2-AG26','HOSPITAL DOS','pendiente',null,false),
  ('oc3','1000-3-AG26','LICEO TRES','confirmada','con_incidencia',true),
  ('oc4','1000-4-AG26','SERVICIO CUATRO','confirmada','resuelta',false);
-- Incidentes existentes ANTES de instalar: uno abierto en OC vigente (oc1), uno abierto en OC archivada (oc3), uno resuelto (oc4).
insert into public.eventos_postventa(id, oc_id, fecha, tipo, descripcion, estado) values
  ('pv1','oc1','2026-11-04','otro','La silla llegó mala, se compró otra','abierto'),
  ('pv3','oc3','2026-09-07','cambio','Modelo distinto al ofertado','abierto'),
  ('pv4','oc4','2026-08-03','otro','Reclamo ya cerrado','resuelto');
insert into public.historial_cambios(id, oc_id, oc_numero, accion) values ('hc0','oc1','1000-1-AG26','OC creada');
