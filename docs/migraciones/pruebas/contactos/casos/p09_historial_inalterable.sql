\set ON_ERROR_STOP 0
reset role;   -- ni siquiera el dueño de la base (sin RLS)
update public.contactos_institucionales_historial set accion = 'x' where rut_clave = '991112227';
select 'CI|p09|la bitácora no se puede alterar|' || (:'LAST_ERROR_MESSAGE' like '%no se eliminan%')::text;
