-- Deshace 2026-10-05-importar-entidades.sql: retira la función. No toca ninguna fila ni política.
begin;
drop function if exists public.importar_entidades_catalogo(jsonb, boolean);
commit;
