\ir ../_usuario.sql
insert into public.contactos_institucionales (rut_clave, rut, nombre, origen) values ('991112227', '99.111.222-7', 'Intruso', 'manual');
select 'CI|p03|usuario no puede insertar directo (solo por RPC)|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
