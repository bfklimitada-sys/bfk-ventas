-- Deshace BORRADOR-2026-11-06-ic-interruptor.sql. Al quitar el interruptor, api/inteligencia.mjs vuelve a tratar
-- Inteligencia Comercial como DESACTIVADA (función ausente = desactivada). No toca ningún otro dato ic_.
do $pre$ begin
  if to_regclass('public.ic_interruptor') is null then raise exception 'ICI: el interruptor no está instalado; no se hizo nada'; end if;
end $pre$;
drop function public.ic_cambiar_interruptor(boolean, text, text);
drop function public.ic_interruptor_estado();
drop table public.ic_interruptor_historial;
drop table public.ic_interruptor;
