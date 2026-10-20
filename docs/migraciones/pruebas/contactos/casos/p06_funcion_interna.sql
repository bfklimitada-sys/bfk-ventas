\ir ../_usuario.sql
select public.ci_conciliar_uno('991112227', null, now(), 'mp', null, 'X', '', 'x@x.cl', '');
select 'CI|p06|usuario no puede llamar la función interna|' || (:'LAST_ERROR_MESSAGE' like 'permission denied%')::text;
