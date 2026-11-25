-- Recuperación de BORRADOR-2026-11-25-documentos-oferta.sql: quita las dos tablas y las tres funciones nuevas.
-- No toca nada existente. Si ya hay documentos emitidos o condiciones guardadas, se detiene (se perderían): para quitar
-- igualmente, ejecutar con  -v forzar=1  (después de respaldar).
\if :{?forzar}
\else
  \set forzar 0
\endif
begin;
set local lock_timeout = '5s';
select (:forzar)::int as forzar \gset
do $$ begin
  if to_regclass('public.oferta_documentos') is null then raise exception 'La migración documentos-oferta no está aplicada'; end if;
end $$;
select ((select count(*) from public.oferta_documentos) + (select count(*) from public.oferta_condiciones)) as filas \gset
\if :forzar
\else
  select (:filas)::int > 0 as con_datos \gset
  \if :con_datos
    \echo 'Hay documentos emitidos o condiciones guardadas: no se deshace sin -v forzar=1'
    rollback;
    \quit 3
  \endif
\endif
drop function public.oferta_emitir_documento(text, uuid, text, integer, jsonb, text, text, text, text, integer, text);
drop function public.oferta_guardar_condiciones(text, uuid, jsonb, jsonb);
drop table public.oferta_documentos;
drop table public.oferta_condiciones;
drop function public.oferta_puede(text, uuid);
notify pgrst, 'reload schema';
commit;
