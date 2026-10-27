-- BASE DESECHABLE (nunca producción): completa la réplica local docs/migraciones/pruebas/schema-local.sql con lo que
-- Supabase entrega y la migración de Proyectos Industriales usa:
--   · auth.uid()/auth.role()/auth.jwt() con la MISMA definición de Supabase (lee request.jwt.claims de PostgREST 12).
--   · Esquema storage mínimo (buckets, objects con RLS, storage.foldername) y los depósitos/políticas de Cotizaciones
--     que ya existen en producción (para comprobar que la migración no los altera).
--   · Roles: authenticator (PostgREST), bfk_owner (dueño de las tablas, SIN superusuario, como "postgres" en Supabase)
--     y storage_admin (dueño de storage.objects; bfk_owner es miembro, como en Supabase).
-- Ejecutar como superusuario DESPUÉS de schema-local.sql.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''), nullif(current_setting('request.jwt.claims', true), ''))::jsonb $$;
grant execute on function auth.uid(), auth.role(), auth.jwt() to authenticated, anon;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'bfk_owner') then create role bfk_owner login nosuperuser nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'storage_admin') then create role storage_admin nologin nosuperuser; end if;
end $$;
grant anon, authenticated to authenticator;
grant authenticated, anon to bfk_owner;
grant storage_admin to bfk_owner;
alter schema public owner to bfk_owner;
do $$ declare r record; begin
  for r in select tablename from pg_tables where schemaname = 'public' loop execute format('alter table public.%I owner to bfk_owner', r.tablename); end loop;
end $$;
grant usage, create on schema public to bfk_owner;
grant usage on schema auth to bfk_owner;
grant select on public.perfiles to authenticated;

drop schema if exists storage cascade;
create schema storage authorization storage_admin;
set role storage_admin;
create table storage.buckets (id text primary key, name text not null unique, owner uuid, public boolean default false,
  created_at timestamptz default now(), updated_at timestamptz default now(), file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null,
  owner uuid, owner_id text, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  metadata jsonb, path_tokens text[] generated always as (string_to_array(name, '/')) stored, version text, user_metadata jsonb, unique (bucket_id, name));
create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
alter table storage.objects enable row level security;
alter table storage.buckets enable row level security;
-- Igual que producción (leído el 20/10/2026): el DELETE directo en storage está bloqueado salvo storage.allow_delete_query.
create function storage.protect_delete() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), 'false') != 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' using errcode = '42501';
  end if;
  return null;
end $$;
create trigger protect_buckets_delete before delete on storage.buckets for each statement execute function storage.protect_delete();
create trigger protect_objects_delete before delete on storage.objects for each statement execute function storage.protect_delete();
grant usage on schema storage to anon, authenticated, bfk_owner;
grant all on storage.objects, storage.buckets to anon, authenticated;
grant execute on function storage.foldername(text) to anon, authenticated;
reset role;

-- Estado existente de Storage en producción (módulo Cotizaciones): debe quedar idéntico tras la migración.
insert into storage.buckets (id, name, public) values ('cz-productos', 'cz-productos', false), ('cz-eett', 'cz-eett', false);
create function public.cz_es_usuario() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select exists (select 1 from public.perfiles where id = auth.uid()) $$;
alter function public.cz_es_usuario() owner to bfk_owner;
create policy cz_storage_leer on storage.objects for select to authenticated using (bucket_id in ('cz-productos','cz-eett') and public.cz_es_usuario());
create policy cz_storage_subir on storage.objects for insert to authenticated with check (bucket_id = 'cz-productos' and public.cz_es_usuario());
insert into storage.objects (bucket_id, name, owner) values ('cz-productos', 'img/0000aaaa.jpg', '11111111-1111-1111-1111-111111111111');

-- Perfiles de prueba adicionales (datos ficticios SOLO en esta base desechable).
insert into public.perfiles values
  ('33333333-3333-3333-3333-333333333333', 'Jefa Proyecto Prueba', 'usuario'),
  ('44444444-4444-4444-4444-444444444444', 'Ingeniero Prueba', 'usuario'),
  ('55555555-5555-5555-5555-555555555555', 'Visitante Prueba', 'usuario')
on conflict do nothing;
