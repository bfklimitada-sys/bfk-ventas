-- Reversión de 2026-11-13-f29-desglose.sql. Se DETIENE si algún período ya se registró con el desglose (no se pierde
-- ningún dato ingresado). Con períodos registrados, la recuperación es volver a la versión anterior de la app (que lee
-- las columnas anteriores) dejando las columnas en su lugar, o restaurar el respaldo previo.
begin;
set local lock_timeout = '5s';
do $$ begin
  if exists (select 1 from public.iva_mensual where desglose_f29 is not null or remanente_anterior is not null or ppm is not null or otras_retenciones is not null) then
    raise exception 'F29-DESHACER: hay períodos registrados con el desglose; no se eliminan columnas con datos';
  end if;
end $$;
alter table public.iva_mensual drop constraint if exists iva_mensual_f29_desglose_ck;
alter table public.iva_mensual drop column if exists remanente_anterior, drop column if exists ppm,
  drop column if exists otras_retenciones, drop column if exists desglose_f29;
commit;
