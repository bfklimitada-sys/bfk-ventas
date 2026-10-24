-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de BORRADOR-2026-10-23-seguridad-perfil-bfk.sql · Deja el catálogo EXACTAMENTE como estaba (se comprueba con
-- la misma huella del ensayo). No toca datos financieros. Los perfiles autorizados con la migración se CONSERVAN (son
-- usuarios reales); el registro de autorizaciones solo se descarta si se indica expresamente:
--   PGOPTIONS="-c bfk.seg_descartar_registro=si"   (si hay autorizaciones registradas y no se indica, se detiene)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';
do $pre$
begin
  if to_regprocedure('public.bfk_es_usuario()') is null then
    raise exception 'REVERSION_DETENIDA: la migración no está aplicada. No se cambió nada.';
  end if;
  if exists (select 1 from public.perfiles_autorizaciones) and coalesce(current_setting('bfk.seg_descartar_registro', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: hay % autorizaciones registradas. Para descartar ese registro: PGOPTIONS="-c bfk.seg_descartar_registro=si". No se cambió nada.',
      (select count(*) from public.perfiles_autorizaciones);
  end if;
end $pre$;

drop trigger perfiles_proteger on public.perfiles;
drop function public.perfiles_proteger();
drop function public.bfk_autorizar_cuenta(uuid, text, text);
drop function public.bfk_cuentas_por_autorizar();
drop table public.perfiles_autorizaciones;

