-- BORRADOR: retiro definitivo de IC. No ejecutado ni ensayado todavía.
-- Aplicar DESPUÉS de publicar la app sin IC y de respaldar/restaurar una copia.
-- Ejecutar en una sola transacción con psql -v ON_ERROR_STOP=1 -1.
-- No utiliza CASCADE: una dependencia ajena impide la operación completa.
-- El operador debe establecer SET LOCAL bfk.respaldo_ic_verificado = '<id del respaldo>'
-- en la MISMA transacción, solo después de comprobar su restauración.
DO $$ BEGIN
  IF coalesce(current_setting('bfk.respaldo_ic_verificado', true), '') = '' THEN
    RAISE EXCEPTION 'Falta identificar el respaldo restaurado y verificado; no se elimina nada';
  END IF;
END $$;
drop function public.ic_cambiar_interruptor(boolean, text, text);
drop function public.ic_interruptor_estado();
drop table public.ic_interruptor_historial;
drop table public.ic_interruptor;

drop function public.ic_detalle_v2(date, date, text, text, text, text, text, text, boolean, integer, integer);
drop function public.ic_resumen_v2(date, date, text, text, text, text);
drop function public.ic_estado_sincronizacion();
drop function public.ic_proxima_consulta(public.ic_resultados);
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

NOTIFY pgrst, 'reload schema';
