-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Pagos a vendedores: una transferencia, dos componentes (08/10/2026).
-- Una sola transacción: psql -v ON_ERROR_STOP=1 -1 -f 2026-10-08-pago-vendedor-gestion.sql
-- Deshacer: 2026-10-08-pago-vendedor-gestion-deshacer.sql
--
-- Solo AGREGA columnas, restricciones y un disparador; no cambia ninguna fila existente:
--   monto_pagado ........... (existente) parte de la transferencia aplicada a la COMISIÓN del período. Sin cambios de significado.
--   monto_extra_gestion .... parte que excede la comisión pendiente: extra por gestión del mismo período (no es comisión).
--   monto_transferido ...... total de la transferencia = monto_pagado + monto_extra_gestion. NULL en los pagos históricos
--                            (para ellos el total transferido es monto_pagado, como hasta hoy).
--   referencia_bancaria .... comprobante u operación bancaria (opcional).
--   anulado_en/_por/motivo . anulación controlada: el pago se conserva completo y deja de contar en comisión y caja.
-- Disparador (solo para llamadas desde la app; la importación de respaldos y los lotes de mantención quedan fuera):
--   · no se eliminan pagos; · un pago no cambia sus montos ni datos; · solo un administrador puede anularlo, una vez y con motivo.
-- No toca: OCs, compras, facturas, cobros, financiamiento, gastos, IVA, ni las fórmulas de comisión.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pagos_vendedor' and column_name = 'monto_extra_gestion') then
    raise notice 'PVG|YA_APLICADA|'; return;
  end if;
  if exists (select 1 from public.pagos_vendedor where monto_pagado < 0) then
    raise exception 'PVG: hay pagos con monto negativo; no se aplicó nada';
  end if;

  alter table public.pagos_vendedor
    add column monto_transferido numeric,
    add column monto_extra_gestion numeric not null default 0,
    add column referencia_bancaria text,
    add column anulado_en timestamptz,
    add column anulado_por uuid,
    add column motivo_anulacion text;

  alter table public.pagos_vendedor
    add constraint pagos_vendedor_montos_no_negativos
      check (monto_pagado >= 0 and monto_extra_gestion >= 0 and (monto_transferido is null or monto_transferido > 0)),
    add constraint pagos_vendedor_total_cuadra
      check (monto_transferido is null or monto_transferido = monto_pagado + monto_extra_gestion),
    add constraint pagos_vendedor_extra_con_total
      check (monto_extra_gestion = 0 or monto_transferido is not null),
    add constraint pagos_vendedor_anulacion_con_motivo
      check (anulado_en is null or length(btrim(coalesce(motivo_anulacion, ''))) > 0);
  raise notice 'PVG|COLUMNAS|';
end $$;

-- Rol del usuario de la sesión (lee perfiles con permisos del dueño; solo devuelve si es administrador).
create or replace function public.pv_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rol = 'admin' from public.perfiles where id = auth.uid()), false)
$$;
revoke all on function public.pv_es_admin() from public;
grant execute on function public.pv_es_admin() to authenticated;

-- SIN security definer: fin_es_cliente() debe ver el rol real de la llamada (authenticated).
create or replace function public.pv_trg_proteger_pago() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() or not public.fin_es_cliente() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    -- Un pago nace vigente: la anulación solo se registra después.
    new.anulado_en := null; new.anulado_por := null; new.motivo_anulacion := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Los pagos a vendedores no se eliminan: se anulan con motivo (queda el registro completo).' using errcode = 'PVG01';
  end if;
  -- UPDATE: lo único permitido es anular un pago vigente, una sola vez.
  if old.anulado_en is not null then
    raise exception 'Este pago ya está anulado. No se registró ningún cambio.' using errcode = 'PVG02';
  end if;
  if new.anulado_en is null then
    raise exception 'Un pago a vendedor no se modifica: si está mal, anúlelo y registre uno nuevo.' using errcode = 'PVG03';
  end if;
  if (to_jsonb(new) - array['anulado_en', 'anulado_por', 'motivo_anulacion']) is distinct from
     (to_jsonb(old) - array['anulado_en', 'anulado_por', 'motivo_anulacion']) then
    raise exception 'Al anular no se pueden cambiar los montos ni los datos del pago.' using errcode = 'PVG03';
  end if;
  if not public.pv_es_admin() then
    raise exception 'Solo un administrador puede anular pagos a vendedores.' using errcode = 'PVG04';
  end if;
  new.anulado_en := now();
  new.anulado_por := auth.uid();
  return new;
end $$;

drop trigger if exists pv_proteger_pago on public.pagos_vendedor;
create trigger pv_proteger_pago before insert or update or delete on public.pagos_vendedor
  for each row execute function public.pv_trg_proteger_pago();

do $$ begin raise notice 'PVG|APLICADA|'; end $$;
