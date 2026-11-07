-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER — Módulo VENTAS PRIVADAS (BORRADOR-2026-11-06-ventas-privadas.sql). NO APLICADO.
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-06-ventas-privadas-deshacer.sql
--
-- PROTECCIÓN: si ya existen datos reales del módulo (cotizaciones, ventas, clientes con datos de venta privada,
-- productos técnicos, EETT o archivos), se DETIENE sin cambiar nada. Para revertir con datos hay que exportarlos antes
-- y repetir con:  psql -v forzar=si …  (solo con autorización expresa).
-- Solo elimina objetos vp_*, el depósito vp-documentos (si está vacío) y la línea 'VP' del catálogo. Los clientes que
-- se crearon en pi_clientes desde este módulo se CONSERVAN (pueden estar en uso por Proyectos Industriales) y los
-- productos agregados a productos_catalogo también.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
\if :{?forzar}
\else
  \set forzar no
\endif
begin;
set local lock_timeout = '5s';
select set_config('vp.forzar', :'forzar', true);

do $$ declare n bigint := 0; begin
  if to_regclass('public.vp_cotizaciones') is null then raise exception 'VP: el módulo no está instalado; nada que deshacer'; end if;
  select (select count(*) from public.vp_cotizaciones) + (select count(*) from public.vp_ventas) + (select count(*) from public.vp_clientes_datos)
       + (select count(*) from public.vp_productos_tecnicos) + (select count(*) from public.vp_eett) + (select count(*) from public.vp_documentos) into n;
  if n > 0 and current_setting('vp.forzar', true) <> 'si' then
    raise exception 'VP: hay % registros del módulo; no se deshizo nada (exporte los datos y use -v forzar=si con autorización)', n; end if;
  if to_regclass('storage.objects') is not null and exists (select 1 from storage.objects where bucket_id = 'vp-documentos') then
    raise exception 'VP: el depósito vp-documentos tiene archivos; no se deshizo nada (respáldelos y elimínelos por la API de Storage)'; end if;
end $$;

do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists vp_storage_leer on storage.objects';
    execute 'drop policy if exists vp_storage_subir on storage.objects';
    execute 'drop policy if exists vp_storage_respaldo_leer on storage.objects';
    perform set_config('storage.allow_delete_query', 'true', true);   -- solo en esta transacción (el depósito está vacío)
    execute 'delete from storage.buckets where id = ''vp-documentos''';
  end if;
end $$;

drop view if exists public.vp_margen_ventas, public.vp_margen_revisiones, public.vp_ventas_vista, public.vp_cotizaciones_vista, public.vp_clientes_vista;

-- El historial es inalterable por disparador: se quitan sus disparadores antes de eliminar la tabla.
drop trigger if exists vp_10_inalterable on public.vp_historial;
drop trigger if exists vp_10_inalterable_t on public.vp_historial;

drop table if exists public.vp_historial, public.vp_extracciones, public.vp_compras, public.vp_pago_imputaciones, public.vp_pagos, public.vp_facturas,
  public.vp_entrega_items, public.vp_entregas, public.vp_oc_cliente, public.vp_venta_item_costos, public.vp_venta_items cascade;
alter table if exists public.vp_ventas drop constraint if exists vp_ventas_eett_fk;
drop table if exists public.vp_eett, public.vp_documentos, public.vp_ventas, public.vp_cotizacion_item_costos, public.vp_cotizacion_items,
  public.vp_cotizacion_revisiones, public.vp_cotizaciones, public.vp_productos_tecnicos, public.vp_clientes_datos, public.vp_configuracion,
  public.vp_correlativos cascade;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as firma from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'vp\_%' loop
    execute format('drop function %s cascade', f.firma);
  end loop;
end $$;

delete from public.bfk_lineas_negocio where codigo = 'VP';

do $$ begin
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'vp\_%')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'vp\_%') then
    raise exception 'VP: quedaron objetos vp_; se revierte todo'; end if;
end $$;

notify pgrst, 'reload schema';
commit;
