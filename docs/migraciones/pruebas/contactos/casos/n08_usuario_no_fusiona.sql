\ir ../_usuario.sql
select (select id from public.contactos_institucionales where correo_clave = 'carla@muni-alfa.cl') as a, (select id from public.contactos_institucionales where correo_clave = 'carla.ruiz@antiguo-alfa.cl') as b \gset
select public.fusionar_contactos(:'a'::uuid, :'b'::uuid);
select 'CI|n08|usuario no fusiona contactos|' || (:'LAST_ERROR_MESSAGE' like '%solo el administrador%')::text;
