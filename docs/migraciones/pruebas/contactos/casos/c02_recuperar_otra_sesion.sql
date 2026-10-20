-- 2. Recuperar el contacto después de cerrar sesión / desde otro usuario (sesión nueva)
\ir ../_usuario2.sql
select 'CI|c02a|otra sesión y otro usuario lo recuperan desde Supabase|' || exists(select 1 from public.contactos_institucionales where rut_clave = '991112227' and correo_clave = 'ana.perez@muni-alfa.cl' and estado = 'vigente')::text;
