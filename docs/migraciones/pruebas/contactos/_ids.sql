-- ids de contactos por correo (RUT A = 99.111.222-7 → clave 991112227)
select coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.perez@muni-alfa.cl'), '') as ana_muni,
       coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.perez@alfa.gob.cl'), '') as ana_gob,
       coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.p@alfa.gob.cl'), '') as ana_p,
       coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'bruno@muni-alfa.cl'), '') as bruno,
       coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'carla@muni-alfa.cl'), '') as carla,
       coalesce((select id::text from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'compras@muni-alfa.cl'), '') as compras
\gset
