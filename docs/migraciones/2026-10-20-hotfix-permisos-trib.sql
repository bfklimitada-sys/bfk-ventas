-- CORRECCIÓN fase 2 (20/10/2026, autorizada por Kevin): trib_escritura_api() la llaman los disparadores trib_proteger_*,
-- que se ejecutan con el rol de quien escribe. La migración le quitó EXECUTE al rol authenticated y por eso toda escritura
-- directa de la app sobre ordenes_compra_v2 falla («permission denied for function trib_escritura_api»).
-- Permiso MÍNIMO: solo authenticated. anon no lo necesita: sus escrituras ya las rechaza RLS (las políticas exigen
-- auth.role() = 'authenticated'); sin el permiso, un intento anónimo sigue fallando.
do $$ begin
  if to_regprocedure('public.trib_escritura_api()') is null then raise exception 'HF: falta la fase 2; no se aplicó nada'; end if;
  if has_function_privilege('authenticated', 'public.trib_escritura_api()', 'execute') then raise exception 'HF: authenticated ya tiene el permiso; no se aplicó nada'; end if;
end $$;
grant execute on function public.trib_escritura_api() to authenticated;
do $$ begin
  if not has_function_privilege('authenticated', 'public.trib_escritura_api()', 'execute') then raise exception 'HF-VERIFICACION: el permiso no quedó aplicado; se revierte'; end if;
  if has_function_privilege('anon', 'public.trib_escritura_api()', 'execute') then raise exception 'HF-VERIFICACION: anon quedó con permiso; se revierte'; end if;
end $$;
