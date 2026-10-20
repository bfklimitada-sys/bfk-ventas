-- Corrección del defecto: el catálogo ya no sobrescribe contacto/correo con cada OC (solo completa vacíos)
\ir ../_usuario.sql
select public.registrar_entidad_desde_oc('99.111.222-7', 'Municipalidad de Prueba Alfa', 'Alfa', 'Ana Pérez · +56 9 1111 1111', 'ana.perez@alfa.gob.cl')->>'accion' as a1 \gset
select public.registrar_entidad_desde_oc('99.111.444-0', 'Servicio de Prueba Gamma', 'Gamma', 'Hugo · 2222', 'hugo@gamma.cl')->>'accion' as a2 \gset
select 'CI|c20a|el contacto/correo del catálogo no se sobrescribe|' || exists(select 1 from public.entidades_catalogo where id = 'ci_t_ent_a' and contacto = 'Contacto Manual' and correo = 'manual@muni-alfa.cl')::text;
select 'CI|c20b|si estaban vacíos, se completan|' || (:'a2' = 'actualizada' and exists(select 1 from public.entidades_catalogo where id = 'ci_t_ent_c' and contacto = 'Hugo · 2222' and correo = 'hugo@gamma.cl'))::text;
