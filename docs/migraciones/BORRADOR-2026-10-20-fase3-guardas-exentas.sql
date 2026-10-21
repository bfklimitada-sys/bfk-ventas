-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Ventas exentas, fase 3: guardas en la base para facturas y cotizaciones exentas (20/10/2026).
-- NO APLICADO. Recomendado (no imprescindible) para publicar la fase 3: la app ya aplica estas reglas; aquí la base
-- las vuelve obligatorias aunque un cliente desactualizado o manipulado escriba directo por la API.
-- Una sola transacción:  psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-20-fase3-guardas-exentas.sql
-- Deshacer: BORRADOR-2026-10-20-fase3-guardas-exentas-deshacer.sql
--
-- ADITIVA: dos funciones de disparador y dos disparadores (trib_v_*: corren DESPUÉS de trib_proteger_*, que ya fijó
-- la clasificación aprobada). No cambia columnas, datos, funciones ni políticas
-- existentes. Solo actúa sobre escrituras NUEVAS que llegan por la API (trib_escritura_api, de la fase 2); las
-- restauraciones por conexión directa y los registros históricos no se tocan.
--  · eventos_factura: DTE 34 solo en OC con clasificación exenta APROBADA (monto exento = monto, IVA = 0);
--    en una OC exenta aprobada no se registra una factura afecta (DTE 33 o sin tipo).
--  · cotizaciones: una fórmula guardada como exenta exige clasificación exenta aprobada e impuestos $0; una
--    cotización con IVA $0 y monto > 0 exige esa misma clasificación.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regprocedure('public.trib_escritura_api()') is null then raise exception 'TRIB3: falta la fase 2 (clasificación tributaria); no se aplicó nada'; end if;
  if to_regprocedure('public.trib3_factura_exenta()') is not null then raise exception 'TRIB3: las guardas ya existen; no se aplicó nada'; end if;
end $$;

create or replace function public.trib3_factura_exenta() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare o public.ordenes_compra_v2%rowtype; v_exenta boolean;
begin
  if not public.trib_escritura_api() then return new; end if;
  if coalesce(new.tipo_dte, 33) not in (33, 34) then return new; end if;          -- NC y ND siguen sus reglas actuales
  if tg_op = 'UPDATE' and new.tipo_dte is not distinct from old.tipo_dte and new.oc_id = old.oc_id
     and new.monto is not distinct from old.monto and new.monto_exento is not distinct from old.monto_exento
     and new.monto_iva is not distinct from old.monto_iva then return new; end if;  -- correcciones de fecha, notas, etc.
  select * into o from public.ordenes_compra_v2 where id = new.oc_id;
  v_exenta := found and o.tratamiento_iva in ('exenta_fora', 'exenta_otra') and o.clasificacion_id is not null;
  if new.tipo_dte = 34 then
    if not v_exenta then
      raise exception 'TRIB3: la OC no tiene una clasificación exenta aprobada; no se registra una factura exenta (DTE 34).' using errcode = '42501'; end if;
    if coalesce(new.monto_iva, 0) <> 0 then
      raise exception 'TRIB3: una factura exenta (DTE 34) no lleva IVA de venta.' using errcode = '22023'; end if;
    new.monto_exento := new.monto; new.monto_iva := 0;
  elsif v_exenta then
    raise exception 'TRIB3: la OC está clasificada exenta: solo admite factura exenta (DTE 34).' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trib_v_factura_exenta before insert or update on public.eventos_factura
  for each row execute function public.trib3_factura_exenta();

create or replace function public.trib3_cotizacion_exenta() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_exenta boolean := new.tratamiento_iva in ('exenta_fora', 'exenta_otra') and new.clasificacion_id is not null;
begin
  if not public.trib_escritura_api() then return new; end if;
  if tg_op = 'UPDATE' and new.formula is not distinct from old.formula and new.impuestos is not distinct from old.impuestos
     and new.subtotal_neto is not distinct from old.subtotal_neto and new.tratamiento_iva is not distinct from old.tratamiento_iva then return new; end if;
  if coalesce(new.formula ->> 'exenta', 'false') = 'true' then
    if not v_exenta then raise exception 'CZ423: la cotización no tiene una clasificación exenta aprobada; no se guarda con precios exentos.' using errcode = '42501'; end if;
    if coalesce(new.impuestos, 0) <> 0 then raise exception 'CZ423: una cotización exenta no lleva IVA de venta.' using errcode = '22023'; end if;
  elsif coalesce(new.impuestos, 0) = 0 and coalesce(new.subtotal_neto, 0) > 0 and not v_exenta then
    raise exception 'CZ423: una cotización con IVA $0 requiere una clasificación exenta aprobada.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trib_v_cotizacion_exenta before insert or update on public.cotizaciones
  for each row execute function public.trib3_cotizacion_exenta();

revoke all on function public.trib3_factura_exenta(), public.trib3_cotizacion_exenta() from public, anon, authenticated;
