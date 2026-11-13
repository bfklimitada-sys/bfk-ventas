-- 13/11/2026 16:15 (Kevin): regla definitiva de comisiones y refacturaciones, vigente desde noviembre 2026 y sin término.
-- 1) Cálculos, liquidaciones y pagos hasta octubre 2026 intactos: se REGISTRA (no se recalcula) el mes en que cada OC con
--    comisión cuenta hoy, si es octubre 2026 o anterior (comision_cierre_anio/mes). Ese mes ya no cambia aunque la OC se
--    anule y refacture una o varias veces, en cualquier mes o año: no se excluye de su mes ni genera una comisión nueva.
-- 2) OC nunca considerada con liquidación anterior a noviembre y refacturada después: su primer período válido es el mes de
--    su primera factura desde noviembre 2026 (fijo). OC creada después del cierre (comision_tras_cierre, la marca esta base
--    al crearla) con factura de un período cerrado: noviembre 2026, fijo. Las demás OC sin período cerrado: regla anterior.
-- 3) Desde noviembre 2026: sin cambios (la liquidación original se conserva para siempre).
-- Nadie modifica el período cerrado ni la marca desde la app (ni un administrador); una OC nueva nace sin período cerrado
-- y con comision_tras_cierre = true.
-- No se modifican pagos, marcas de liquidación, revisiones ni ningún otro dato. create or replace conserva los permisos
-- de fin_periodo_comision (sin grant/revoke) y su protección bfk_exigir_perfil_api.
-- Deshacer: 2026-11-13-comision-periodo-cerrado-deshacer.sql (requiere volver la app a 460951e).

alter table public.ordenes_compra_v2 add column if not exists comision_cierre_anio int, add column if not exists comision_cierre_mes int,
  add column if not exists comision_tras_cierre boolean;
alter table public.ordenes_compra_v2 drop constraint if exists oc_comision_cierre_ck;
alter table public.ordenes_compra_v2 add constraint oc_comision_cierre_ck check (
  (comision_cierre_anio is null) = (comision_cierre_mes is null)
  and (comision_cierre_mes is null or comision_cierre_mes between 1 and 12)
  and (comision_cierre_anio is null or comision_cierre_anio * 12 + comision_cierre_mes < 2026 * 12 + 11));
comment on column public.ordenes_compra_v2.comision_cierre_anio is 'Año del período cerrado (hasta oct 2026) en que la comisión de la OC ya fue considerada; definitivo (13/11/2026)';
comment on column public.ordenes_compra_v2.comision_tras_cierre is 'OC creada después del cierre de comisiones (13/11/2026): una factura de un período cerrado cuenta en noviembre 2026';
comment on column public.ordenes_compra_v2.comision_cierre_mes is 'Mes del período cerrado (hasta oct 2026) en que la comisión de la OC ya fue considerada; definitivo (13/11/2026)';

-- Registro del período cerrado con la función vigente (la misma regla que la app: coinciden en todas las OC).
update public.ordenes_compra_v2 o set comision_cierre_anio = x.anio, comision_cierre_mes = x.mes
  from (select o2.id, p.anio, p.mes
          from public.ordenes_compra_v2 o2 cross join lateral public.fin_periodo_comision(o2.id) p
         where coalesce(o2.tipo_registro, 'venta') = 'venta' and o2.estado_factura_propia = 'emitida' and o2.vendedor_id is not null
           and not coalesce(o2.capitalizacion_bfk, false) and not coalesce(o2.comision_excluida, false)
           and p.anio is not null and p.anio * 12 + p.mes < 2026 * 12 + 11) x
 where o.id = x.id and o.comision_cierre_anio is null;

create or replace function public.fin_periodo_comision(p_oc_id text, out anio int, out mes int)
language sql stable security definer set search_path = public, pg_temp as $$
  select z.* from (
  with o as (select comision_anio, comision_mes, comision_cierre_anio, comision_cierre_mes, coalesce(comision_tras_cierre, false) tras,
                    coalesce(vendedor_pagado, false) pagada
               from public.ordenes_compra_v2 where id = p_oc_id),
       v as (select max(f.fecha) m, count(*) n from public.fin_facturas_vigentes(p_oc_id) f),
       t as (select min(e.fecha) m, count(*) n from public.eventos_factura e
              where e.oc_id = p_oc_id and coalesce(e.tipo_dte, 33) not in (56, 61) and e.fecha is not null),
       n as (select min(e.fecha) m from public.eventos_factura e
              where e.oc_id = p_oc_id and coalesce(e.tipo_dte, 33) not in (56, 61) and e.fecha >= date '2026-11-01'),
       l as (select case when o.comision_anio is not null then make_date(o.comision_anio, o.comision_mes, 1)
                         when v.m is null then case when o.pagada then date_trunc('month', t.m)::date end
                         when t.n > v.n and date_trunc('month', t.m) < date_trunc('month', v.m) then date_trunc('month', t.m)::date
                         else date_trunc('month', v.m)::date end liq,
                    date_trunc('month', v.m)::date act, o.pagada, o.tras,
                    case when o.comision_cierre_anio is not null then make_date(o.comision_cierre_anio, o.comision_cierre_mes, 1) end cierre
               from o, v, t),
       r as (select case when l.cierre is not null then l.cierre
                         when l.liq >= date '2026-11-01' then l.liq
                         when l.liq is not null and l.tras then date '2026-11-01'
                         when l.liq is not null and l.act >= date '2026-11-01'
                              then case when l.pagada then null else coalesce(date_trunc('month', n.m)::date, l.act) end
                         else l.act end d
               from l, n)
  select extract(year from d)::int anio, extract(month from d)::int mes from r where d is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026; vigencia desde noviembre 2026 (13/11/2026); período cerrado y primer período válido (13/11/2026 16:15)
$$;

-- El período cerrado es definitivo: nadie lo cambia desde la app y una OC nueva nace sin él.
create or replace function public.oc_trg_comision_cierre() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() then return new; end if;
  if tg_op = 'INSERT' then
    new.comision_cierre_anio := null; new.comision_cierre_mes := null; new.comision_tras_cierre := true;
  else
    new.comision_cierre_anio := old.comision_cierre_anio; new.comision_cierre_mes := old.comision_cierre_mes;
    new.comision_tras_cierre := old.comision_tras_cierre;
  end if;
  return new;
end $$;
drop trigger if exists oc_comision_cierre on public.ordenes_compra_v2;
create trigger oc_comision_cierre before insert or update on public.ordenes_compra_v2
  for each row execute function public.oc_trg_comision_cierre();
