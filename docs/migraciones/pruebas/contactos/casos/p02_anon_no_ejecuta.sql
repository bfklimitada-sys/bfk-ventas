\set ON_ERROR_STOP 0
set role anon;
select public.conciliar_contactos_oc('ci_t_01', 'mp');
select 'CI|p02|anon no puede ejecutar la conciliación|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
