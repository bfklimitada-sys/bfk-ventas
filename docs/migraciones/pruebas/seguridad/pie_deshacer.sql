-- ── Privilegios por defecto como estaban ──
do $def$
declare v_extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
begin
  execute 'alter default privileges for role postgres in schema public grant all on tables to anon';
  execute format('alter default privileges for role postgres in schema public grant truncate, references, trigger%s on tables to authenticated', v_extra);
end $def$;

-- ── Funciones de acceso: ya nada las usa ──
drop function public.bfk_exigir_perfil_api();
drop function public.bfk_es_admin();
drop function public.bfk_es_usuario();

-- ── Comprobación: el catálogo vuelve a la huella original ──
do $ver$
declare v_huella text;
begin
  select md5(string_agg(x, E'\n' order by x)) into v_huella from (
    select 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef || '|' || md5(p.prosrc)
           || '|' || coalesce(array_to_string(p.proconfig, ','), '') x
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cartola_manuales', 'cartola_vincular', 'cartola_quitar_alerta', 'fin_calculo_oc', 'fin_exigir_sin_bloqueo',
                         'fin_facturas_vigentes', 'fin_fila_bloqueada', 'fin_tipo_financiamiento', 'handle_new_user',
                         'fin_dif_estado', 'fin_dif_monto', 'fin_monto_tributario', 'fin_motivo_bloqueo', 'fin_periodo_comision',
                         'trib_motivo_incompatible', 'oc_trg_proteger_vendedor', 'rls_auto_enable', 'pv_es_admin')
    union all
    select 'p|' || tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'c|' || column_name || '|' || data_type from information_schema.columns where table_schema = 'public' and table_name = 'perfiles'
    union all
    select 't|' || t.tgname || '|' || pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid in ('auth.users'::regclass, 'public.perfiles'::regclass) and not t.tgisinternal
  ) z;
  if v_huella is distinct from '__HUELLA_CATALOGO__' then
    raise exception 'REVERSION_DETENIDA: el catálogo no quedó como el original (huella %). Se deshace todo.', v_huella;
  end if;
end $ver$;

commit;
