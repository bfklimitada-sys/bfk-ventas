\ir ../_usuario.sql
update public.contactos_institucionales set correo = 'malo@x.cl' where rut_clave = '991112227';
select 'CI|p04|usuario no puede editar directo|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
