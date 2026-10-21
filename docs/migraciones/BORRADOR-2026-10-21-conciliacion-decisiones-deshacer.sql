-- Reversión de BORRADOR-2026-10-21-conciliacion-decisiones.sql. No toca ningún registro financiero.
-- Si ya hay decisiones guardadas se detiene (exportarlas antes); para descartarlas: set bfk.conc_descartar = 'si'.
begin;
set local lock_timeout = '5s';
do $_$
begin
  if to_regclass('public.conciliacion_decisiones') is not null
     and exists (select 1 from public.conciliacion_decisiones)
     and coalesce(current_setting('bfk.conc_descartar', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: conciliacion_decisiones tiene datos; exportarlos y usar set bfk.conc_descartar = ''si''';
  end if;
end $_$;
drop trigger if exists conciliacion_guardia on public.eventos_pago_cliente;
drop trigger if exists conciliacion_guardia on public.eventos_pago_financiamiento;
drop trigger if exists conciliacion_guardia on public.gastos_indirectos;
drop trigger if exists conciliacion_guardia on public.pagos_vendedor;
drop trigger if exists conciliacion_guardia on public.aportes_socios;
drop function if exists public.conciliacion_guardia_registro();
drop function if exists public.conciliacion_anular(bigint, text);
drop function if exists public.conciliacion_decidir(text, text, text, text[], text, text);
drop table if exists public.conciliacion_decisiones;
commit;
