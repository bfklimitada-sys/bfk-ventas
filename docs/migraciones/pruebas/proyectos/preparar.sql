-- Ayudantes de prueba (SOLO base desechable). Esquema "prueba" separado; se elimina en limpiar.sql.
create schema if not exists prueba;
grant usage on schema prueba to authenticated, anon;
-- Cambia el usuario de la sesión (como lo haría PostgREST con el token firmado).
create or replace function prueba.como(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;
-- Ejecuta una sentencia y devuelve 'SIN_ERROR' o 'codigo:mensaje' (la sentencia se revierte si falla).
create or replace function prueba.falla(q text) returns text language plpgsql as $$
begin execute q; return 'SIN_ERROR'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
-- Cantidad de filas que afecta una sentencia (0 = RLS la filtró).
create or replace function prueba.filas(q text) returns int language plpgsql as $$
declare n int; begin execute q; get diagnostics n = row_count; return n; end $$;
create or replace function prueba.pid(nombre text) returns uuid language sql stable as $$ select id from public.pi_proyectos where pi_proyectos.nombre = $1 $$;
-- Total real de archivos de un depósito (sin RLS), para comparar con lo que ve un usuario.
create or replace function prueba.total_deposito(b text) returns bigint language sql stable security definer set search_path = storage, pg_temp as $$ select count(*) from storage.objects where bucket_id = b $$;
grant execute on all functions in schema prueba to authenticated, anon;
-- Cuenta de respaldo de documentos (usuario de Auth SIN perfil BFK), registrada por SQL como lo haría el administrador.
insert into public.pi_cuentas_respaldo (usuario_id, descripcion) values ('77777777-7777-7777-7777-777777777777', 'Respaldo diario de documentos (prueba)') on conflict do nothing;
