-- MIGRACIÓN A: RPC registrar_entidad_desde_oc (alimentar el catálogo desde una OC). NO ejecutada en producción.
-- Solo AGREGA una función: no cambia datos, políticas RLS ni otras funciones. La app actual sigue funcionando igual.
-- Ejecutar con psql --single-transaction, como dueño de la tabla (postgres).
--
-- Reglas (mismas que src/lib/entidadesOC.js, ahora en el servidor y en una transacción):
--  * Requiere sesión (auth.uid()) con perfil existente; cualquier rol.
--  * RUT vacío -> 'sin_rut'. RUT inválido (largo o dígito verificador) -> 'rut_invalido': no crea ni actualiza nada
--    y NO intenta corregir el dígito verificador.
--  * Busca por RUT normalizado (dígitos + K, sin ceros a la izquierda): 0 coincidencias -> crea (RUT 76.123.456-0,
--    creado_por = usuario de la sesión); 1 -> actualiza SOLO los campos que traen un valor distinto (nunca vacía un dato,
--    nunca cambia el RUT); >1 -> 'ambigua' (no toca nada). Nunca borra filas.
--  * Textos: se recortan espacios; máximo 200 caracteres; sin caracteres de control (si no -> 'datos_invalidos').
--  * Un bloqueo por RUT (pg_advisory_xact_lock) evita duplicados con llamadas simultáneas; UNIQUE(rut) y el trigger
--    normalizar_rut_entidad siguen vigentes.
--  * SECURITY DEFINER con search_path fijo: puede escribir aunque RLS (Migración B) bloquee la escritura directa,
--    pero solo hace lo que este código permite. Ejecución solo para authenticated.
-- Respuesta: {"ok":true,"accion":"creada|actualizada|sin_cambios|ambigua|rut_invalido|sin_rut|datos_invalidos","id":...}

do $$ begin
  if to_regprocedure('public.registrar_entidad_desde_oc(text,text,text,text,text)') is not null then
    raise exception 'MIGRACION_A_ABORTADA: la función ya existe';
  end if;
end $$;

create function public.registrar_entidad_desde_oc(
  p_rut text,
  p_nombre_entidad text default null,
  p_comuna text default null,
  p_contacto text default null,
  p_correo text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

revoke all on function public.registrar_entidad_desde_oc(text, text, text, text, text) from public, anon;
grant execute on function public.registrar_entidad_desde_oc(text, text, text, text, text) to authenticated;
