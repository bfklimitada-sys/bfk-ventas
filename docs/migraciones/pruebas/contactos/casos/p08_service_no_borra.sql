\set ON_ERROR_STOP 0
reset role;   -- ni siquiera el dueño de la base (sin RLS)
delete from public.contactos_institucionales where rut_clave = '991112227';
select 'CI|p08|ni el dueño de la base borra contactos (se marcan obsoletos)|' || (:'LAST_ERROR_MESSAGE' like '%no se eliminan%')::text;
