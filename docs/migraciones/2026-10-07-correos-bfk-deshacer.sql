-- Deshace 2026-10-07-correos-bfk.sql (una transacción). Borra solo lo creado por esa migración:
-- la copia de correos en BFK (los correos originales siguen intactos en Gmail), sus funciones y el rol.
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-correos-bfk-deshacer.sql
drop function if exists public.correo_bfk_marcar(bigint, text);
drop function if exists public.correos_bfk_registrar(jsonb);
drop table if exists public.correos_bfk;
drop function if exists public.correos_bfk_lista(text);
drop function if exists public.correos_bfk_rut(text);
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'correo_sync_bfk') then
    execute 'revoke all on schema public from correo_sync_bfk';
    execute 'drop owned by correo_sync_bfk';
    execute 'drop role correo_sync_bfk';
  end if;
  raise notice 'CORREOS-DESHACER: OK';
end $$;
