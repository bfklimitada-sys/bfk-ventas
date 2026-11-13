-- Comisión ligada a la OC y a su liquidación original (13/11/2026), vigente desde octubre 2026. Autorizada por Kevin el
-- 13/11/2026 14:58 con condiciones: nada anterior a octubre 2026 se recalcula; 1398-624 y 564162-290 quedan «Por revisar».
-- 1) ordenes_compra_v2: columnas que admiten NULL, sin valor por defecto (no reescribe la tabla):
--      comision_anio, comision_mes ....... liquidación de la comisión de la OC (mes en que se liquidó o se liquidará)
--      comision_utilidad ................. utilidad de la OC al quedar pagada (la fija solo el disparador)
--      comision_revision, _motivo ........ 'por_revisar' | 'revisada' y su motivo
-- 2) Disparador oc_comision_liquidacion: al marcar la OC pagada ancla su liquidación y guarda su utilidad; al desmarcarla
--    (pago anulado) libera la utilidad liquidada. Solo un administrador cambia la liquidación o la revisión.
-- 3) fin_periodo_comision (lo usan la protección del vendedor y la revisión de eliminación): misma regla que la app.
--    Antes de octubre 2026 da el mismo mes que hoy para toda OC cuya factura vigente sea anterior a octubre 2026.
-- 4) Marcas con evidencia, SOLO en OC pagadas refacturadas en otro mes (no toca montos, pagos, cierres ni otras OC):
--      un solo mes con un pago mensual registrado mientras la OC estuvo en ese mes → se ancla a ese mes;
--      dos o más meses posibles → «Por revisar» (posible pago en dos liquidaciones), anclada donde hoy se calcula;
--      ninguno → «Por revisar», anclada donde hoy se calcula.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

alter table public.ordenes_compra_v2
  add column if not exists comision_anio integer,
  add column if not exists comision_mes integer,
  add column if not exists comision_utilidad numeric,
  add column if not exists comision_revision text,
  add column if not exists comision_revision_motivo text;
-- (idempotente: si se deshizo conservando las columnas, la restricción ya existe)
alter table public.ordenes_compra_v2 drop constraint if exists oc_comision_liquidacion_ck;
alter table public.ordenes_compra_v2 add constraint oc_comision_liquidacion_ck check (
  ((comision_anio is null) = (comision_mes is null))
  and (comision_mes is null or comision_mes between 1 and 12)
  and (comision_anio is null or comision_anio between 2020 and 2100)
  and (comision_revision is null or comision_revision in ('por_revisar', 'revisada')));

-- Período en que cuenta la comisión de una OC (misma regla que liquidacionComision en src/lib/calculos.js), VIGENTE DESDE
-- OCTUBRE 2026: liquidación = anclada; si no, OC refacturada (factura anulada o reemplazada y la vigente en un mes
-- posterior) → mes de su primera factura; si no → mes de su factura vigente. Si la liquidación es desde octubre 2026 cuenta
-- ahí; si es anterior y la factura vigente es desde octubre 2026: pagada → en ningún mes (ya se pagó), no pagada → mes de la
-- factura vigente; todo lo anterior a octubre 2026, sin cambios (mes de la factura vigente).
-- Conserva la guarda de seguridad del 23/10/2026 (bfk_exigir_perfil_api) y sus permisos (create or replace no los cambia).
create or replace function public.fin_periodo_comision(p_oc_id text, out anio int, out mes int)
language sql stable security definer set search_path = public, pg_temp as $$
  select z.* from (
  with o as (select comision_anio, comision_mes, coalesce(vendedor_pagado, false) pagada from public.ordenes_compra_v2 where id = p_oc_id),
       v as (select max(f.fecha) m, count(*) n from public.fin_facturas_vigentes(p_oc_id) f),
       t as (select min(e.fecha) m, count(*) n from public.eventos_factura e
              where e.oc_id = p_oc_id and coalesce(e.tipo_dte, 33) not in (56, 61) and e.fecha is not null),
       l as (select case when o.comision_anio is not null then make_date(o.comision_anio, o.comision_mes, 1)
                         when v.m is null then case when o.pagada then date_trunc('month', t.m)::date end
                         when t.n > v.n and date_trunc('month', t.m) < date_trunc('month', v.m) then date_trunc('month', t.m)::date
                         else date_trunc('month', v.m)::date end liq,
                    date_trunc('month', v.m)::date act, o.pagada
               from o, v, t),
       r as (select case when l.liq >= date '2026-10-01' then l.liq
                         when l.liq is not null and l.act >= date '2026-10-01' then case when l.pagada then null else l.act end
                         else l.act end d
               from l)
  select extract(year from d)::int anio, extract(month from d)::int mes from r where d is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;

create or replace function public.oc_trg_comision_liquidacion() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare p record;
begin
  if public.fin_es_importacion() then return new; end if;
  -- Desde la app (sesión anon/authenticated): solo un administrador cambia la liquidación o la revisión; la utilidad
  -- liquidada nunca se escribe directo.
  if public.fin_es_cliente() then
    if (new.comision_anio, new.comision_mes, new.comision_revision, new.comision_revision_motivo)
       is distinct from (old.comision_anio, old.comision_mes, old.comision_revision, old.comision_revision_motivo)
       and not public.bfk_es_admin() then
      raise exception 'Solo un administrador puede cambiar la liquidación o la revisión de la comisión de la OC %', old.numero_oc using errcode = 'P4V03';
    end if;
    new.comision_utilidad := old.comision_utilidad;
  end if;
  if coalesce(new.vendedor_pagado, false) and not coalesce(old.vendedor_pagado, false) then
    if new.comision_anio is null then
      select * into p from public.fin_periodo_comision(new.id);
      new.comision_anio := p.anio; new.comision_mes := p.mes;
    end if;
    new.comision_utilidad := coalesce(new.monto_total, 0) - coalesce(new.costo_total, 0);
  elsif not coalesce(new.vendedor_pagado, false) and coalesce(old.vendedor_pagado, false) then
    new.comision_utilidad := null;
  end if;
  return new;
end $$;
drop trigger if exists oc_comision_liquidacion on public.ordenes_compra_v2;
create trigger oc_comision_liquidacion before update on public.ordenes_compra_v2
  for each row execute function public.oc_trg_comision_liquidacion();

-- Marcas con evidencia (solo OC pagadas y refacturadas en otro mes).
create temp table f_liq on commit drop as
with base as (
  select o.id, o.numero_oc, o.vendedor_id from public.ordenes_compra_v2 o
   where coalesce(o.vendedor_pagado, false) and o.vendedor_id is not null and coalesce(o.tipo_registro, 'venta') = 'venta'
     and o.estado_factura_propia = 'emitida' and not coalesce(o.capitalizacion_bfk, false) and not coalesce(o.comision_excluida, false)
     and not coalesce(o.archivada, false)),
fact as (
  select b.id, e.fecha, date_trunc('month', e.fecha)::date m from base b join public.eventos_factura e on e.oc_id = b.id
   where coalesce(e.tipo_dte, 33) not in (56, 61) and e.fecha is not null),
vig as (select b.id, max(f.fecha) m, count(*) n from base b cross join lateral public.fin_facturas_vigentes(b.id) f group by b.id),
refact as (
  select b.*, date_trunc('month', v.m)::date actual from base b join vig v on v.id = b.id
   where (select count(*) from fact f where f.id = b.id) > v.n
     and (select date_trunc('month', min(f.fecha)) from fact f where f.id = b.id) < date_trunc('month', v.m)),
ventanas as (   -- por OC y mes: desde su primera factura en ese mes hasta la primera factura de un mes posterior
  select r.id, f.m, min(f.fecha) desde,
         (select min(f2.fecha) from fact f2 where f2.id = r.id and f2.m > f.m) hasta
    from refact r join fact f on f.id = r.id group by r.id, f.m),
cand as (
  select w.id, w.m from ventanas w join refact r on r.id = w.id
   where exists (select 1 from public.pagos_vendedor pv
                  where pv.vendedor_id = r.vendedor_id and pv.anulado_en is null
                    and make_date(pv.anio, pv.mes, 1) = w.m
                    and (case when pv.monto_verificado is not null then pv.fecha else (pv."creadoEn" at time zone 'America/Santiago')::date end)
                        between w.desde and coalesce(w.hasta, 'infinity'::date)))
select r.id, r.numero_oc, r.actual,
       (select array_agg(c.m order by c.m) from cand c where c.id = r.id) meses
  from refact r;

update public.ordenes_compra_v2 o set
  comision_anio = extract(year from x.d)::int, comision_mes = extract(month from x.d)::int,
  comision_revision = x.rev, comision_revision_motivo = x.motivo
from (
  select f.id,
         case when coalesce(cardinality(f.meses), 0) = 1 then f.meses[1]
              when f.actual = any (coalesce(f.meses, '{}')) or f.meses is null then f.actual
              else f.meses[cardinality(f.meses)] end d,
         case when coalesce(cardinality(f.meses), 0) = 1 then null else 'por_revisar' end rev,
         case when coalesce(cardinality(f.meses), 0) = 1 then null
              when f.meses is null then 'Marcada pagada sin un pago mensual comprobable mientras estuvo en el mes de cada factura'
              else 'Posible pago en dos liquidaciones: ' || (select string_agg(to_char(m, 'MM/YYYY'), ' y ' order by m) from unnest(f.meses) m) end motivo
    from f_liq f) x
where o.id = x.id;

do $$ declare r record; begin
  for r in select o.numero_oc, o.comision_anio, o.comision_mes, o.comision_revision, o.comision_revision_motivo
             from public.ordenes_compra_v2 o join f_liq f on f.id = o.id order by o.numero_oc loop
    raise notice 'LIQUIDACION|%|%/%|%|%', r.numero_oc, r.comision_mes, r.comision_anio, coalesce(r.comision_revision, 'comprobada'), coalesce(r.comision_revision_motivo, '');
  end loop;
end $$;
commit;
