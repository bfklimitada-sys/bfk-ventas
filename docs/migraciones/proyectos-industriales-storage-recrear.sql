-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RECUPERACIÓN: recrea el depósito privado "pi-documentos" y sus 3 políticas en un proyecto Supabase restaurado.
-- Los respaldos diarios de la base incluyen public y auth, pero NO el esquema storage: tras restaurar la base, el
-- módulo Proyectos Industriales queda con sus tablas pero sin depósito ni políticas. Este script los vuelve a crear
-- (idéntico a la migración) y es idempotente: lo que ya existe no se toca. Después se restauran los archivos con
-- bfk-respaldos/scripts/restaurar-documentos.mjs. No modifica datos ni otros depósitos.
-- Ejecutar SOLO en el proyecto restaurado, con autorización expresa.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
do $$ begin
  if to_regclass('public.pi_documentos') is null then raise exception 'PI: el módulo no está en esta base (falta public.pi_documentos)'; end if;
  if to_regclass('storage.buckets') is null then raise exception 'PI: esta base no tiene Supabase Storage'; end if;
  insert into storage.buckets (id, name, public) values ('pi-documentos', 'pi-documentos', false) on conflict (id) do nothing;
  if (select public from storage.buckets where id = 'pi-documentos') then raise exception 'PI: el depósito pi-documentos existe y es PÚBLICO; revisar antes de seguir'; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pi_storage_leer') then
    execute $p$create policy pi_storage_leer on storage.objects for select to authenticated
      using (bucket_id = 'pi-documentos' and public.pi_puede_ver(public.pi_uuid_seguro((storage.foldername(name))[1])))$p$; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pi_storage_subir') then
    execute $p$create policy pi_storage_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'pi-documentos' and public.pi_documentos_habilitados() and public.pi_puede_editar(public.pi_uuid_seguro((storage.foldername(name))[1])))$p$; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'pi_storage_respaldo_leer') then
    execute $p$create policy pi_storage_respaldo_leer on storage.objects for select to authenticated
      using (bucket_id = 'pi-documentos' and public.pi_es_lector_respaldo())$p$; end if;
  raise notice 'PI|DEPOSITO_LISTO|políticas=%', (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'pi\_storage%');
end $$;
commit;
