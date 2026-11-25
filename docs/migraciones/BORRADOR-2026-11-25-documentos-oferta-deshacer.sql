-- Recuperación de BORRADOR-2026-11-25-documentos-oferta.sql: quita las dos tablas y las tres funciones nuevas.
-- No toca nada existente. Si ya hay documentos emitidos o condiciones guardadas, se detiene (se perderían): para quitar
-- igualmente, ejecutar con  -v forzar=1  (después de respaldar).
\if :{?forzar}
\else
  \set forzar 0
\endif
begin;
set local lock_timeout = '5s';
select set_config('bfk.deshacer_forzar', :'forzar', true) \g /dev/null
do $$ begin
  if to_regclass('public.oferta_documentos') is null then raise exception 'La migración documentos-oferta no está aplicada'; end if;
  if coalesce(current_setting('bfk.deshacer_forzar', true), '0') <> '1'
     and (exists (select 1 from public.oferta_documentos) or exists (select 1 from public.oferta_condiciones)) then
    raise exception 'Hay documentos emitidos o condiciones guardadas: no se deshace sin -v forzar=1 (respaldar antes)';
  end if;
end $$;
drop function public.oferta_emitir_documento(text, uuid, text, integer, jsonb, text, text, text, text, integer, text);
drop function public.oferta_guardar_condiciones(text, uuid, jsonb, jsonb);
drop table public.oferta_documentos;
drop table public.oferta_condiciones;
drop function public.oferta_puede(text, uuid);
notify pgrst, 'reload schema';
commit;
