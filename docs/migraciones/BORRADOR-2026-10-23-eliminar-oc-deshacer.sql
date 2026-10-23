-- Deshacer BORRADOR-2026-10-23-eliminar-oc.sql. Se DETIENE si hay eliminaciones registradas (la auditoría y las
-- copias para restaurar no se pierden sin una decisión explícita: PGOPTIONS="-c bfk.oce_descartar=si").
do $$ begin
  if to_regclass('public.oc_eliminaciones') is not null and exists (select 1 from public.oc_eliminaciones)
     and coalesce(current_setting('bfk.oce_descartar', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: hay eliminaciones de OC registradas (auditoría y copias). No se deshizo nada.';
  end if;
end $$;
drop function if exists public.oc_eliminacion_restaurar(text, text);
drop function if exists public.oc_eliminar_definitivamente(text, text, text, text);
drop function if exists public.oc_eliminacion_revisar(text, text);
drop function if exists public.oce_firma_ajena(text);
drop function if exists public.oce_pesos(numeric);
drop function if exists public.oce_es_admin();
drop function if exists public.oce_tablas();
drop table if exists public.oc_eliminaciones;
drop function if exists public.oc_eliminaciones_inmutable();
notify pgrst, 'reload schema';
