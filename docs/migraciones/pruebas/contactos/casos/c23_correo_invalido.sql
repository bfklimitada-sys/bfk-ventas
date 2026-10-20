-- Correo con formato dudoso: no se guarda (queda en la OC tal como vino)
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_15', 'mp')->'resultados'->0->>'accion' as a \gset
select 'CI|c23a|correo inválido: no se guarda como contacto|' || (:'a' = 'correo_invalido' and not exists(select 1 from public.contactos_institucionales where nombre = 'Eva Lagos'))::text;
