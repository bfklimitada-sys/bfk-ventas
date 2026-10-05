-- Retira la función de importación atómica. No toca tablas ni datos.
drop function if exists public.importar_respaldo_excel(jsonb, boolean);
