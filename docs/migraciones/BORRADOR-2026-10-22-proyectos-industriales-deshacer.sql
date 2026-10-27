-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de BORRADOR-2026-10-22-proyectos-industriales.sql
-- Elimina SOLO los objetos del módulo Proyectos Industriales (prefijo pi_, bfk_lineas_negocio, depósito
-- pi-documentos y sus políticas). No toca ninguna tabla, fila, función ni política existente de BFK.
--
-- Protección: si el módulo ya tiene proyectos, clientes o documentos, se DETIENE sin borrar nada. Para descartar
-- igualmente (solo después de exportar o respaldar esos datos) ejecutar en la MISMA sesión, antes del script:
--     set bfk.pi_descartar = 'si';
-- Los archivos del depósito "pi-documentos" no se borran por SQL: si el depósito tiene archivos, se conserva y se
-- avisa (vaciarlo desde el panel de Supabase y volver a ejecutar este script).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
do $$ begin
  if to_regclass('public.pi_proyectos') is not null
     and (exists (select 1 from public.pi_proyectos) or exists (select 1 from public.pi_clientes) or exists (select 1 from public.pi_documentos))
     and coalesce(current_setting('bfk.pi_descartar', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: el módulo Proyectos Industriales tiene datos; respaldarlos y confirmar con set bfk.pi_descartar = ''si''';
  end if;
end $$;

do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists pi_storage_leer on storage.objects;
    drop policy if exists pi_storage_subir on storage.objects;
    drop policy if exists pi_storage_respaldo_leer on storage.objects;
    if exists (select 1 from storage.objects where bucket_id = 'pi-documentos') then
      raise notice 'PI|DEPOSITO_CON_ARCHIVOS|El depósito pi-documentos tiene archivos: vaciarlo desde Supabase y eliminarlo desde el panel';
    else
      -- Supabase bloquea el DELETE directo en storage (disparador protect_delete) salvo con este ajuste local de la
      -- transacción; solo se borra el depósito vacío del módulo.
      perform set_config('storage.allow_delete_query', 'true', true);
      delete from storage.buckets where id = 'pi-documentos';
    end if;
  end if;
end $$;

drop view if exists public.pi_proyectos_resumen;
drop view if exists public.pi_actividades_vista;
-- El historial es inalterable: se quita su protección solo para eliminar la tabla completa.
drop trigger if exists pi_10_inalterable on public.pi_historial;
drop trigger if exists pi_10_inalterable_t on public.pi_historial;
drop table if exists public.pi_historial, public.pi_documentos, public.pi_entregables, public.pi_hitos, public.pi_actividades,
  public.pi_proyectos_economia, public.pi_equipo, public.pi_proyectos, public.pi_clientes, public.pi_correlativos,
  public.pi_configuracion, public.pi_cuentas_respaldo, public.bfk_lineas_negocio;
do $$ declare f record; begin
  for f in select p.oid::regprocedure as firma from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pi\_%' loop
    execute format('drop function %s', f.firma);
  end loop;
end $$;
notify pgrst, 'reload schema';
commit;
