\ir ../_usuario.sql
delete from public.contactos_institucionales where rut_clave = '991112227';
select 'CI|p05|usuario no puede borrar|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
