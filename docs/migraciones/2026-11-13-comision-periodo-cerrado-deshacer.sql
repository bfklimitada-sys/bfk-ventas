-- Deshace 2026-11-13-comision-periodo-cerrado.sql: fin_periodo_comision vuelve a la versión «vigencia desde noviembre»
-- (2026-11-13-comision-vigencia-noviembre.sql) y se quita la protección del período cerrado. Las columnas
-- comision_cierre_anio/mes, comision_tras_cierre y su restricción SE CONSERVAN (la app anterior las ignora; la nueva las necesita).
-- Volver también la app a 460951e. Sin grant/revoke.
drop trigger if exists oc_comision_cierre on public.ordenes_compra_v2;
drop function if exists public.oc_trg_comision_cierre();
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
       r as (select case when l.liq >= date '2026-11-01' then l.liq
                         when l.liq is not null and l.act >= date '2026-11-01' then case when l.pagada then null else l.act end
                         else l.act end d
               from l)
  select extract(year from d)::int anio, extract(month from d)::int mes from r where d is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026; vigencia desde noviembre 2026 (13/11/2026)
$$;
