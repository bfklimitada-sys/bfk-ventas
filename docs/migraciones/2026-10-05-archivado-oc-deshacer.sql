-- Deshace 2026-10-05-archivado-oc.sql. Ejecutar con psql --single-transaction, como dueño de las tablas (postgres).
-- Se NIEGA si hay OCs archivadas (restaurarlas primero), para no volver a mostrar como activa una OC archivada sin una
-- decisión explícita. No borra ninguna OC ni dato relacionado; el historial (incluidas las entradas de archivo/restauración)
-- se conserva. Tras ejecutarlo, ordenes_compra_v2 queda con exactamente las columnas y datos previos a la migración.
do $$
declare v_n int;
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='ordenes_compra_v2' and column_name='archivada') then
    execute 'select count(*) from public.ordenes_compra_v2 where archivada' into v_n;
    if v_n > 0 then
      raise exception 'DESHACER_ARCHIVADO_ABORTADO: hay % OC(s) archivada(s): restáurelas antes de deshacer la migración', v_n;
    end if;
  end if;
end $$;
drop function if exists public.archivar_oc(text, text);
drop function if exists public.restaurar_oc(text);
drop trigger if exists proteger_archivo_oc on public.ordenes_compra_v2;
drop function if exists public.proteger_archivo_oc();
drop index if exists public.ordenes_compra_v2_archivada_idx;
alter table public.ordenes_compra_v2
  drop column if exists archivada, drop column if exists archivada_en, drop column if exists archivada_por,
  drop column if exists archivada_por_nombre, drop column if exists archivo_motivo;
