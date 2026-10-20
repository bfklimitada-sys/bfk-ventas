-- DESHACER — Guardas de la fase 3 (solo elimina los dos disparadores y sus funciones; no hay datos que perder).
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-20-fase3-guardas-exentas-deshacer.sql
do $$ begin
  if to_regprocedure('public.trib3_factura_exenta()') is null then raise exception 'TRIB3-DESHACER: las guardas no están instaladas; no se hizo nada'; end if;
end $$;
drop trigger trib_v_factura_exenta on public.eventos_factura;
drop trigger trib_v_cotizacion_exenta on public.cotizaciones;
drop function public.trib3_factura_exenta();
drop function public.trib3_cotizacion_exenta();
