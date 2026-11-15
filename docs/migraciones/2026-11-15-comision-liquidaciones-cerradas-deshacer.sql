-- Deshace 2026-11-15-comision-liquidaciones-cerradas.sql (y las 17 liquidaciones históricas que registra).
-- Se niega si ya hay liquidaciones cerradas por la app (desde noviembre 2026) o decisiones de un administrador: esos
-- registros no se pierden en silencio. Volver también la app a la versión anterior.
do $$ begin
  if exists (select 1 from public.comision_liquidaciones where origen not like 'historica_%') or exists (select 1 from public.comision_decisiones) then
    raise exception 'CL-DESHACER: hay liquidaciones cerradas desde la app o decisiones de administrador; no se deshizo nada';
  end if;
end $$;
drop trigger if exists oc_vendedor_tras_cierre on public.ordenes_compra_v2;
drop trigger if exists pv_cierre_guardia on public.pagos_vendedor;
drop function if exists public.oc_trg_vendedor_tras_cierre();
drop function if exists public.pv_trg_cierre_guardia();
drop function if exists public.decidir_comision(jsonb);
drop function if exists public.cerrar_liquidacion_comision(jsonb);
drop function if exists public.comision_reconocida_mes(text, int, int);
drop function if exists public.comision_pagado_mes(text, int, int);
drop table if exists public.comision_decisiones;
drop table if exists public.comision_liquidacion_ocs;
drop table if exists public.comision_liquidaciones;
drop function if exists public.comision_trg_inmutable();
