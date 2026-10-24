-- Huella del catálogo de seguridad que la migración modifica (funciones objetivo + TODAS las políticas de public).
-- Solo lectura. Si producción cambió respecto del ensayo, la huella cambia y la migración se detiene.
select md5(string_agg(x, E'\n' order by x)) from (
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
