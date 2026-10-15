-- Deshacer BORRADOR-2026-10-15-seguimiento-especial.sql: elimina SOLO lo que esa migración creó.
-- Atención: borra los seguimientos registrados (respaldar antes si ya hay datos). No toca ninguna otra tabla.
begin;
drop table if exists public.oc_seguimientos;
drop function if exists public.seg_antes_guardar();
drop function if exists public.seg_es_admin();
commit;
