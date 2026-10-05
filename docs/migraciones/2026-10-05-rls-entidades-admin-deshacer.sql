-- Deshace la MIGRACIÓN B: vuelve EXACTAMENTE a la política anterior. No toca datos.
begin;
drop policy if exists ent_leer on public.entidades_catalogo;
drop policy if exists ent_admin_inserta on public.entidades_catalogo;
drop policy if exists ent_admin_edita on public.entidades_catalogo;
drop policy if exists ent_admin_borra on public.entidades_catalogo;
drop policy if exists rw_autenticados_entidades on public.entidades_catalogo;
create policy rw_autenticados_entidades on public.entidades_catalogo for all to public using (auth.role() = 'authenticated'::text);
commit;
