-- Deshace BORRADOR-2026-10-cotizaciones.sql (solo objetos del módulo Cotizaciones y EETT; nada más).
-- ATENCIÓN: elimina las cotizaciones y la biblioteca creadas con el módulo. Hacer respaldo antes.
-- Los archivos de los depósitos "cz-productos" y "cz-eett" se deben vaciar desde Supabase antes de borrar los depósitos.
do $$ begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists cz_storage_leer on storage.objects;
    drop policy if exists cz_storage_subir on storage.objects;
    begin
      delete from storage.buckets b where b.id in ('cz-productos','cz-eett') and not exists (select 1 from storage.objects o where o.bucket_id = b.id);
    exception when others then
      raise notice 'CZ|DEPOSITOS_PENDIENTES|Eliminar cz-productos y cz-eett desde el panel de Supabase (%)', sqlerrm;
    end;
  end if;
end $$;
drop function if exists public.cz_registrar_eett(uuid,integer,text,text,integer);
drop function if exists public.cz_archivar_producto(uuid);
drop function if exists public.cz_guardar_producto(jsonb);
drop function if exists public.cz_guardar_cotizacion(jsonb);
drop table if exists public.eett_documentos, public.cotizacion_versiones, public.cotizacion_items, public.cotizacion_envios, public.cotizaciones, public.productos_catalogo;
drop function if exists public.cz_es_admin();
drop function if exists public.cz_es_usuario();
