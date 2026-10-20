-- =====================================================================================
-- REVERSIÓN de BORRADOR-2026-10-21-contactos-institucionales.sql
-- Restaura registrar_entidad_desde_oc exactamente como estaba en producción (esquema del 20/10/2026)
-- y elimina las tablas/funciones nuevas. No toca OC, catálogo ni contactos_cobranza.
-- Si las tablas nuevas ya tienen datos, se ABORTA salvo que se exporten antes y se ejecute con:
--   set bfk.ci_descartar = 'si';   (en la misma sesión, antes de este script)
-- =====================================================================================
begin;
set local lock_timeout = '5s';
do $_$
begin
  if to_regclass('public.contactos_institucionales') is not null
     and exists (select 1 from public.contactos_institucionales)
     and coalesce(current_setting('bfk.ci_descartar', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: contactos_institucionales tiene datos; exportarlos y confirmar con set bfk.ci_descartar = ''si''';
  end if;
end $_$;

CREATE OR REPLACE FUNCTION public.registrar_entidad_desde_oc(p_rut text, p_nombre_entidad text DEFAULT NULL::text, p_comuna text DEFAULT NULL::text, p_contacto text DEFAULT NULL::text, p_correo text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_uid uuid := auth.uid();
  l text; b text; d text; s int := 0; f int := 2; r int; i int;
  v_clave text; v_rut text; n int;
  v_ex public.entidades_catalogo%rowtype;
  v_nombre text := nullif(btrim(coalesce(p_nombre_entidad,'')), '');
  v_comuna text := nullif(btrim(coalesce(p_comuna,'')), '');
  v_contacto text := nullif(btrim(coalesce(p_contacto,'')), '');
  v_correo text := nullif(btrim(coalesce(p_correo,'')), '');
  c_nombre text; c_comuna text; c_contacto text; c_correo text;
  v_id text;
begin
  if v_uid is null then
    raise exception 'ENTIDAD_RECHAZADA: se requiere una sesión válida' using errcode = 'IE003';
  end if;
  if not exists (select 1 from public.perfiles where id = v_uid) then
    raise exception 'ENTIDAD_RECHAZADA: usuario sin perfil' using errcode = 'IE003';
  end if;

  -- RUT: limpiar y validar (no se corrige ni se completa nada)
  l := upper(regexp_replace(coalesce(p_rut,''), '[\s.\-‐-―]', '', 'g'));
  if l = '' then return jsonb_build_object('ok', true, 'accion', 'sin_rut'); end if;
  if l !~ '^[0-9]+[0-9K]$' then return jsonb_build_object('ok', true, 'accion', 'rut_invalido'); end if;
  b := ltrim(left(l, -1), '0'); d := right(l, 1);
  if b !~ '^[0-9]{7,8}$' or b::bigint < 1000000 then return jsonb_build_object('ok', true, 'accion', 'rut_invalido'); end if;
  for i in reverse length(b) .. 1 loop s := s + substr(b, i, 1)::int * f; f := case when f = 7 then 2 else f + 1 end; end loop;
  r := 11 - s % 11;
  if (case r when 11 then '0' when 10 then 'K' else r::text end) <> d then
    return jsonb_build_object('ok', true, 'accion', 'rut_invalido');
  end if;
  v_clave := b || d;
  v_rut := case when length(b) = 8 then substr(b,1,2)||'.'||substr(b,3,3)||'.'||substr(b,6,3) else substr(b,1,1)||'.'||substr(b,2,3)||'.'||substr(b,5,3) end || '-' || d;

  -- Textos
  if greatest(length(coalesce(v_nombre,'')), length(coalesce(v_comuna,'')), length(coalesce(v_contacto,'')), length(coalesce(v_correo,''))) > 200
     or concat(v_nombre, v_comuna, v_contacto, v_correo) ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
    return jsonb_build_object('ok', true, 'accion', 'datos_invalidos');
  end if;

  perform pg_advisory_xact_lock(hashtext('entidad_desde_oc:' || v_clave));

  select count(*) into n from public.entidades_catalogo e
   where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;

  if n > 1 then
    return jsonb_build_object('ok', true, 'accion', 'ambigua', 'coincidencias', n);
  end if;

  if n = 1 then
    select * into v_ex from public.entidades_catalogo e
     where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;
    c_nombre   := case when v_nombre   is not null and v_nombre   is distinct from btrim(coalesce(v_ex.nombre_entidad,'')) then v_nombre end;
    c_comuna   := case when v_comuna   is not null and v_comuna   is distinct from btrim(coalesce(v_ex.comuna,''))         then v_comuna end;
    c_contacto := case when v_contacto is not null and v_contacto is distinct from btrim(coalesce(v_ex.contacto,''))       then v_contacto end;
    c_correo   := case when v_correo   is not null and v_correo   is distinct from btrim(coalesce(v_ex.correo,''))         then v_correo end;
    if c_nombre is null and c_comuna is null and c_contacto is null and c_correo is null then
      return jsonb_build_object('ok', true, 'accion', 'sin_cambios', 'id', v_ex.id);
    end if;
    update public.entidades_catalogo set               -- el RUT NUNCA se modifica aquí
      nombre_entidad = coalesce(c_nombre, nombre_entidad),
      comuna = coalesce(c_comuna, comuna),
      contacto = coalesce(c_contacto, contacto),
      correo = coalesce(c_correo, correo)
    where id = v_ex.id;
    return jsonb_build_object('ok', true, 'accion', 'actualizada', 'id', v_ex.id,
      'campos', to_jsonb(array_remove(array[case when c_nombre is not null then 'nombre_entidad' end, case when c_comuna is not null then 'comuna' end,
                                             case when c_contacto is not null then 'contacto' end, case when c_correo is not null then 'correo' end], null)));
  end if;

  v_id := 'ent_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || v_clave), 1, 5);
  insert into public.entidades_catalogo (id, rut, nombre_entidad, comuna, contacto, correo, creado_por)
  values (v_id, v_rut, coalesce(v_nombre, ''), coalesce(v_comuna, ''), coalesce(v_contacto, ''), coalesce(v_correo, ''), v_uid);
  return jsonb_build_object('ok', true, 'accion', 'creada', 'id', v_id);
end;
$_$;

drop function if exists public.conciliar_contactos_oc(text,text,text);
drop function if exists public.resolver_propuesta_contacto(uuid,boolean);
drop function if exists public.fusionar_contactos(uuid,uuid,text);
drop function if exists public.registrar_correo_cobranza(text,text);
drop function if exists public.guardar_contacto_institucional(uuid,text,jsonb,text);
drop function if exists public.resolver_contacto_pendiente(uuid,text,text);
drop function if exists public.marcar_contacto_obsoleto(uuid,text,uuid);
drop function if exists public.ci_conciliar_datos(text,text,timestamptz,text,uuid,text,text,text);
drop function if exists public.ci_conciliar_uno(text,text,timestamptz,text,uuid,text,text,text,text);
drop function if exists public.ci_contexto(text,text,text,uuid);
drop function if exists public.ci_exigir_sesion();
drop function if exists public.ci_exigir_admin();
drop function if exists public.ci_es_admin(uuid);
drop table if exists public.contactos_institucionales_historial;
drop table if exists public.contactos_institucionales_oc;
drop table if exists public.contactos_institucionales;
drop function if exists public.ci_trg_historial();
drop function if exists public.ci_trg_no_borrar();
drop function if exists public.ci_nombre_clave(text);
drop function if exists public.ci_rut_formato(text);
drop function if exists public.ci_rut_clave(text);

do $_$
begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'ci\_%')
     or exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'contactos_institucionales%') then
    raise exception 'VERIFICACION: la reversión dejó objetos';
  end if;
  if pg_get_functiondef('public.registrar_entidad_desde_oc(text,text,text,text,text)'::regprocedure) like '%solo se COMPLETAN%' then
    raise exception 'VERIFICACION: registrar_entidad_desde_oc no se restauró';
  end if;
end $_$;
commit;
