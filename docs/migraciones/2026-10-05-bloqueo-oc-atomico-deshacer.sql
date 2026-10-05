-- Deshace 2026-10-05-bloqueo-oc-atomico.sql: restaura la política anterior y retira la RPC y la vista.
-- Conserva la tabla oc_bloqueos y todas sus filas. El frontend anterior vuelve a ser compatible.
begin;
drop function if exists public.gestionar_bloqueo_oc(text, int);
drop function if exists public.gestionar_bloqueo_oc(text, text, int);
drop view if exists public.oc_bloqueos_vigentes;
drop policy if exists bloqueos_leer on public.oc_bloqueos;
drop policy if exists bloqueos_insertar on public.oc_bloqueos;
drop policy if exists bloqueos_actualizar on public.oc_bloqueos;
drop policy if exists bloqueos_borrar on public.oc_bloqueos;
drop policy if exists rw_autenticados_bloqueos on public.oc_bloqueos;
alter table public.oc_bloqueos enable row level security;
create policy rw_autenticados_bloqueos on public.oc_bloqueos for all to public using (auth.role() = 'authenticated'::text);
commit;
