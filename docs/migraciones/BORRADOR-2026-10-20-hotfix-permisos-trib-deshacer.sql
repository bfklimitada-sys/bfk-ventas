-- DESHACER del hotfix: vuelve al estado actual de producción (vuelve a romper las escrituras directas de OC).
revoke execute on function public.trib_escritura_api() from authenticated, anon;
