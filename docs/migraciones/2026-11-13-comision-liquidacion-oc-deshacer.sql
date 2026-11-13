-- Reversión de 2026-11-13-comision-liquidacion-oc.sql: quita el disparador y devuelve fin_periodo_comision a la regla
-- anterior (mes de la factura vigente más reciente). Las columnas y sus valores (liquidaciones ancladas, utilidades
-- liquidadas, revisiones) se CONSERVAN: la versión anterior de la app las ignora y así no se pierde evidencia. Para
-- eliminarlas también, usar el bloque final comentado, solo con autorización.
begin;
set local lock_timeout = '5s';
drop trigger if exists oc_comision_liquidacion on public.ordenes_compra_v2;
drop function if exists public.oc_trg_comision_liquidacion();
CREATE OR REPLACE FUNCTION public.fin_periodo_comision(p_oc_id text, OUT anio integer, OUT mes integer) RETURNS record
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select z.* from (
  select extract(year from m)::int, extract(month from m)::int
    from (select max(f.fecha) m from public.fin_facturas_vigentes(p_oc_id) f) z
   where m is not null
  ) z where public.bfk_exigir_perfil_api()   -- seguridad 23/10/2026
$$;
commit;
-- Eliminación de columnas (pierde las liquidaciones registradas):
-- alter table public.ordenes_compra_v2 drop constraint if exists oc_comision_liquidacion_ck,
--   drop column if exists comision_anio, drop column if exists comision_mes, drop column if exists comision_utilidad,
--   drop column if exists comision_revision, drop column if exists comision_revision_motivo;
