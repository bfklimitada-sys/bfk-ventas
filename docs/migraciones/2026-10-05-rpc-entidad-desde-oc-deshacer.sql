-- Deshace la MIGRACIÓN A: retira la función. No toca datos ni políticas.
-- Orden obligatorio: primero deshacer la Migración B (si se aplicó) y volver el frontend a 32b7418.
begin;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'entidades_catalogo' and policyname = 'rw_autenticados_entidades') then
    raise exception 'Primero deshaga la Migración B (la política original no está)';
  end if;
end $$;
drop function if exists public.registrar_entidad_desde_oc(text, text, text, text, text);
commit;
