-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER — Inteligencia Comercial de Compra Ágil (04/11/2026). Una sola transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-11-04-inteligencia-comercial-deshacer.sql
-- Elimina SOLO los objetos ic_ creados por BORRADOR-2026-11-04-inteligencia-comercial.sql. No toca cotizaciones, OCs ni
-- ningún dato financiero. Se pierden los resultados sincronizados desde ChileCompra (se pueden volver a consultar) y su
-- historial: si se quieren conservar, exportarlos antes (Inteligencia Comercial → Exportar, o un respaldo diario).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.ic_resultados') is null then raise exception 'IC: el módulo no está instalado; no se hizo nada'; end if;
end $$;
drop function public.ic_registrar_sincronizacion(jsonb);
drop function public.ic_pendientes_sincronizar(integer, boolean);
drop function public.ic_registrar_resultado(jsonb);
drop function public.ic_detalle(date, date, text, text, text, text, text, boolean, integer, integer);
drop function public.ic_resumen(date, date, text, text, text);
drop view public.ic_oportunidades;
drop table public.ic_sincronizaciones;
drop table public.ic_resultados_historial;
drop trigger ic_historial on public.ic_resultados;
drop table public.ic_resultados;
drop function public.ic_trg_historial();
drop function public.ic_rut_bfk();
drop function public.ic_rut_norm(text);
