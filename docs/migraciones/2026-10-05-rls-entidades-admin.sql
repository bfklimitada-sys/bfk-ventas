-- MIGRACIÓN B: escritura directa de entidades_catalogo solo para administradores. NO ejecutada en producción.
-- Requisito: Migración A aplicada y frontend que usa registrar_entidad_desde_oc desplegado.
-- No toca datos. Reemplaza la política única rw_autenticados_entidades (ALL para cualquier usuario con sesión) por:
--   ent_leer           SELECT  cualquier usuario con sesión (igual que hoy)
--   ent_admin_inserta  INSERT  solo perfiles.rol = 'admin'
--   ent_admin_edita    UPDATE  solo perfiles.rol = 'admin'
--   ent_admin_borra    DELETE  solo perfiles.rol = 'admin'
-- El administrador se identifica por auth.uid() (token firmado por Supabase) + perfiles.rol; un usuario no puede
-- asignarse ese rol (políticas de perfiles de la Fase 2). Ejecutar con psql --single-transaction.
do $$ begin
  if to_regprocedure('public.registrar_entidad_desde_oc(text,text,text,text,text)') is null then
    raise exception 'MIGRACION_B_ABORTADA: falta la RPC registrar_entidad_desde_oc (Migración A)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'entidades_catalogo') <> 1
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'entidades_catalogo'
                    and policyname = 'rw_autenticados_entidades' and cmd = 'ALL' and qual = '(auth.role() = ''authenticated''::text)') then
    raise exception 'MIGRACION_B_ABORTADA: las políticas actuales no son las esperadas';
  end if;
end $$;

drop policy rw_autenticados_entidades on public.entidades_catalogo;
create policy ent_leer on public.entidades_catalogo for select to public
  using (auth.role() = 'authenticated');
create policy ent_admin_inserta on public.entidades_catalogo for insert to public
  with check (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin'));
create policy ent_admin_edita on public.entidades_catalogo for update to public
  using (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin'))
  with check (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin'));
create policy ent_admin_borra on public.entidades_catalogo for delete to public
  using (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin'));
