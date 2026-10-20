-- 3. Reutilizar en otra OC de la misma institución (RUT con otro formato y correo en mayúsculas)
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_02', 'mp')->'resultados'->0->>'accion' as a \gset
select 'CI|c04a|RUT 99111222-7 y correo en MAYÚSCULAS reconocen el mismo contacto|' || (:'a' in ('existente','actualizado') and (select count(*) from public.contactos_institucionales where rut_clave = '991112227') = 1)::text;
select 'CI|c04b|el contacto queda asociado a las 2 OC y la última OC es la más reciente|' || ((select count(*) from public.contactos_institucionales_oc o join public.contactos_institucionales c on c.id = o.contacto_id where c.correo_clave = 'ana.perez@muni-alfa.cl' and c.rut_clave = '991112227') = 2 and exists(select 1 from public.contactos_institucionales where correo_clave = 'ana.perez@muni-alfa.cl' and ultima_oc = 'ci_t_02'))::text;
select 'CI|c04c|el nombre no se degrada por mayúsculas (sigue Ana Pérez)|' || exists(select 1 from public.contactos_institucionales where correo_clave = 'ana.perez@muni-alfa.cl' and nombre = 'Ana Pérez')::text;
