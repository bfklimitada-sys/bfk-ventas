-- Deshace 2026-10-08-pago-vendedor-gestion.sql (una sola transacción: psql -v ON_ERROR_STOP=1 -1 -f ...).
-- Se niega si ya existen pagos registrados con el nuevo formato (total + extra) o anulados: quitar las columnas
-- borraría esa información. En ese caso, volver solo el código es seguro (las columnas nuevas no molestan al código anterior,
-- pero el código anterior no restaría de la caja el extra por gestión: revisar antes de decidir).
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pagos_vendedor' and column_name = 'monto_extra_gestion') then
    raise notice 'PVG-DESHACER|NADA_QUE_DESHACER|'; return;
  end if;
  if exists (select 1 from public.pagos_vendedor where monto_transferido is not null or monto_extra_gestion <> 0 or anulado_en is not null or referencia_bancaria is not null) then
    raise exception 'PVG-DESHACER: hay pagos registrados con el nuevo formato o anulados; no se deshizo nada';
  end if;
  drop trigger if exists pv_proteger_pago on public.pagos_vendedor;
  drop function if exists public.pv_trg_proteger_pago();
  drop function if exists public.pv_es_admin();
  alter table public.pagos_vendedor
    drop constraint if exists pagos_vendedor_montos_no_negativos,
    drop constraint if exists pagos_vendedor_total_cuadra,
    drop constraint if exists pagos_vendedor_extra_con_total,
    drop constraint if exists pagos_vendedor_anulacion_con_motivo,
    drop column if exists monto_transferido,
    drop column if exists monto_extra_gestion,
    drop column if exists referencia_bancaria,
    drop column if exists anulado_en,
    drop column if exists anulado_por,
    drop column if exists motivo_anulacion;
  raise notice 'PVG-DESHACER|OK|';
end $$;
