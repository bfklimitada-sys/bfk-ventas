-- Aislamiento entre líneas de negocio (comprobación estática sobre la base instalada):
--  1. Ninguna función, vista o disparador del módulo menciona tablas de Mercado Público ni de finanzas.
--  2. Ninguna tabla nueva tiene clave foránea hacia tablas existentes, ni una existente hacia las nuevas.
--  3. Las tablas existentes no ganaron permisos, políticas ni disparadores (lo cubre además la huella).
with mp as (
  select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
    and c.relname not like 'pi\_%' and c.relname not in ('bfk_lineas_negocio', 'perfiles')
),
fuentes as (
  select p.proname as obj, pg_get_functiondef(p.oid) as def from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pi\_%'
  union all select c.relname, pg_get_viewdef(c.oid) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v' and c.relname like 'pi\_%'
)
select 'PI|c12_modulo_no_referencia_tablas_mp|' || not exists (select 1 from fuentes f join mp on f.def ~* ('\m(public\.)?' || mp.relname || '\M'));
select 'PI|c12_sin_claves_foraneas_cruzadas|' || not exists (
  select 1 from pg_constraint k where k.contype = 'f' and k.connamespace = 'public'::regnamespace
    and ((k.conrelid::regclass::text ~ '^(public\.)?(pi_|bfk_lineas)') <> (k.confrelid::regclass::text ~ '^(public\.)?(pi_|bfk_lineas)')));
select 'PI|c12_linea_de_negocio_fija_PI|' || (select bool_and(linea_negocio = 'PI' and centro_costo = codigo) from public.pi_proyectos);
