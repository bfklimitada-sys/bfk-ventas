-- Contacto con nombre y teléfono, sin correo
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_13', 'mp')->'resultados'->0->>'accion' as a1 \gset
select public.conciliar_contactos_oc('ci_t_13', 'mp')->'resultados'->0->>'accion' as a2 \gset
select 'CI|c21a|sin correo: se guarda nombre y teléfono, sin duplicar|' || (:'a1' = 'nuevo' and :'a2' = 'existente' and (select count(*) from public.contactos_institucionales where rut_clave = '991112227' and nombre = 'Diego Mora' and telefono = '22 111 2222' and correo = '') = 1)::text;
