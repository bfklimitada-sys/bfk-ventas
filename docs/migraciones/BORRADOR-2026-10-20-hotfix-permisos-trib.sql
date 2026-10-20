-- HOTFIX fase 2 (20/10/2026): trib_escritura_api() la llaman los disparadores trib_proteger_* (que se ejecutan con el
-- rol del usuario de la API). La migración le quitó EXECUTE a authenticated/anon y por eso toda escritura directa de la
-- app sobre ordenes_compra_v2 falla con «permission denied». Solo informa si la escritura viene de la API (no lee datos).
do $$ begin
  if to_regprocedure('public.trib_escritura_api()') is null then raise exception 'HF: falta la fase 2; no se aplicó nada'; end if;
  if has_function_privilege('authenticated', 'public.trib_escritura_api()', 'execute') then raise exception 'HF: el permiso ya existe; no se aplicó nada'; end if;
end $$;
grant execute on function public.trib_escritura_api() to authenticated, anon;
do $$ begin
  if not has_function_privilege('authenticated', 'public.trib_escritura_api()', 'execute') or not has_function_privilege('anon', 'public.trib_escritura_api()', 'execute') then
    raise exception 'HF-VERIFICACION: el permiso no quedó aplicado; se revierte'; end if;
end $$;
