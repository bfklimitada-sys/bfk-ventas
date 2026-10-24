-- ── 7. Permisos de tablas (defensa adicional a RLS) ──
-- anon (sin sesión) no necesita ninguna tabla de public: se le quitan todos los permisos.
-- authenticated conserva SELECT/INSERT/UPDATE/DELETE (los filtra RLS) y pierde TRUNCATE, REFERENCES, TRIGGER y MAINTAIN,
-- que la app no usa y que no pasan por RLS.
do $perm$
declare r record; v_extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
begin
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') loop
    execute format('revoke all on table public.%I from anon', r.relname);
    execute format('revoke truncate, references, trigger%s on table public.%I from authenticated', v_extra, r.relname);
  end loop;
  -- Tablas futuras creadas por postgres en public: mismo criterio por defecto.
  execute 'alter default privileges for role postgres in schema public revoke all on tables from anon';
  execute format('alter default privileges for role postgres in schema public revoke truncate, references, trigger%s on tables from authenticated', v_extra);
end $perm$;

-- ── 8. Verificación dentro de la misma transacción (si algo no cuadra, ROLLBACK automático) ──
do $ver$
declare n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'public' and (coalesce(qual, '') ~ 'auth\.role\(\)' or coalesce(with_check, '') ~ 'auth\.role\(\)');
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: quedan % políticas con auth.role()', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and 'authenticated' = any(roles) and (qual = 'true' or with_check = 'true');
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: quedan % políticas «true» para authenticated', n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'perfiles' and cmd = 'INSERT') then
    raise exception 'SEGURIDAD_DETENIDA: perfiles todavía admite INSERT por política';
  end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon';
  if n <> 0 then raise exception 'SEGURIDAD_DETENIDA: anon conserva % permisos de tabla', n; end if;
  select count(*) into n from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('cartola_manuales', 'cartola_vincular', 'cartola_quitar_alerta', 'fin_calculo_oc', 'fin_exigir_sin_bloqueo',
                       'trib_motivo_incompatible', 'fin_facturas_vigentes', 'fin_fila_bloqueada', 'fin_tipo_financiamiento',
                       'fin_dif_estado', 'fin_dif_monto', 'fin_monto_tributario', 'fin_motivo_bloqueo', 'fin_periodo_comision')
     and p.prosrc like '%bfk_exigir_perfil_api%';
  if n <> 14 then raise exception 'SEGURIDAD_DETENIDA: solo % de 14 funciones tienen la guarda', n; end if;
  if has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')
     or has_function_privilege('anon', 'public.rls_auto_enable()', 'execute')
     or has_function_privilege('anon', 'public.pv_es_admin()', 'execute') then
    raise exception 'SEGURIDAD_DETENIDA: quedan funciones internas ejecutables desde la API';
  end if;
end $ver$;

commit;
