-- Conexión directa sin sesión de la app (restauración de respaldo): el disparador no interviene.
\set ON_ERROR_STOP off
begin;
insert into public.cotizaciones (id, nombre, estado, creado_por) values ('7e000000-0000-4000-8000-0000000000b1', 'VR restaurada', 'presentada', :'adm') returning id \gset
select 'VR|v16_restauracion_directa_no_bloqueada|' || (:'id' is not null)::text;
rollback;
