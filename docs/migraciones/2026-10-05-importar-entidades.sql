-- IMPORTACIÓN ATÓMICA DE ENTIDADES (entidades_catalogo): una función, una transacción.
-- NO se ha ejecutado en producción. Solo crea la función; no toca ninguna fila ni ninguna política.
--
-- Propiedad: cualquier error => se revierte TODA la operación (0 cambios). Solo INSERT y UPDATE; nunca DELETE.
-- Una tabla y un conjunto de columnas fijos: el cliente NO puede indicar tablas ni columnas.
--
-- Seguridad: SECURITY INVOKER (respeta RLS del usuario) + auth.uid() obligatorio + perfiles.rol = 'admin'.
-- Ejecución revocada a public/anon; concedida solo a authenticated.
--
-- Payload (p_payload): { "version": 1, "operaciones": [ { "fila": 2, "rut": "76123456-0",
--     "nombre_entidad": "...", "comuna": null|"...", "contacto": null|"...", "correo": null|"..." } ] }
-- Claves permitidas por operación: fila, rut, nombre_entidad, comuna, contacto, correo (cualquier otra => error).
-- El servidor decide crear o actualizar comparando el RUT NORMALIZADO (dígitos + K, sin ceros a la izquierda)
-- con TODAS las entidades existentes, aunque estén guardadas con otro formato:
--   0 coincidencias => INSERT (id generado en el servidor, rut en formato 76.123.456-0, creado_por = auth.uid())
--   1 coincidencia  => UPDATE solo de los campos con valor explícito (no nulo, no vacío). Nunca cambia rut ni vacía campos.
--   >1 coincidencias (duplicados históricos) => error IE002, 0 cambios. Nunca elige una al azar.
-- Revalida en el servidor: dígito verificador (cuerpo de 7 u 8 dígitos), largo de textos, correo, RUT repetido en el payload.
--
-- p_simular (por defecto true): valida y cuenta sin escribir. El cliente confirma con p_simular = false.
-- Límite: 500 operaciones por llamada (error IE004).
-- Errores (errcode): IE001 validación, IE002 ambiguo, IE003 permisos/sesión, IE004 límite, IE005 tabla ocupada por otra escritura. detail = JSON {fila,rut,campo,causa}.
-- Respuesta: {ok, simulado, total, creadas, actualizadas, sin_cambios}

create or replace function public.importar_entidades_catalogo(
  p_payload jsonb,
  p_simular boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_limite constant int := 500;
  c_claves constant text[] := array['fila','rut','nombre_entidad','comuna','contacto','correo'];
  v_uid uuid := auth.uid();
  v_rol text;
  v_ops jsonb; v_op jsonb; v_i int; v_n int;
  v_k text;
  v_fila text; v_rutorig text; v_limpio text; v_cuerpo text; v_dv text; v_clave text;
  v_suma int; v_f int; v_r int; v_dvcalc text; j int;
  v_nombre text; v_comuna text; v_contacto text; v_correo text;
  v_vistos text[] := '{}';
  v_coinc int; v_ex public.entidades_catalogo%rowtype;
  v_nuevo public.entidades_catalogo%rowtype;
  v_creadas int := 0; v_actualizadas int := 0; v_sin int := 0;
  v_ctx_fila text := null; v_ctx_rut text := null;
begin
  if v_uid is null then
    raise exception 'IMPORTACION_CANCELADA: se requiere una sesión válida' using errcode = 'IE003', hint = 'No se aplicó ningún cambio';
  end if;
  select rol into v_rol from public.perfiles where id = v_uid;
  if v_rol is distinct from 'admin' then
    raise exception 'IMPORTACION_CANCELADA: solo el administrador puede importar entidades' using errcode = 'IE003', hint = 'No se aplicó ningún cambio';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload->'operaciones') <> 'array' then
    raise exception 'IMPORTACION_CANCELADA: payload inválido (se esperaba {"operaciones":[...]})' using errcode = 'IE001',
      detail = jsonb_build_object('causa','payload_invalido')::text, hint = 'No se aplicó ningún cambio';
  end if;
  v_ops := p_payload->'operaciones';
  v_n := jsonb_array_length(v_ops);
  if v_n = 0 then
    raise exception 'IMPORTACION_CANCELADA: no hay operaciones' using errcode = 'IE001',
      detail = jsonb_build_object('causa','sin_operaciones')::text, hint = 'No se aplicó ningún cambio';
  end if;
  if v_n > c_limite then
    raise exception 'IMPORTACION_CANCELADA: máximo % operaciones por importación (recibidas %)', c_limite, v_n using errcode = 'IE004',
      detail = jsonb_build_object('causa','limite_excedido','limite',c_limite,'recibidas',v_n)::text, hint = 'No se aplicó ningún cambio';
  end if;

  -- Una importación a la vez; en modo real además se impide que otro flujo cree/modifique entidades mientras dura
  -- (transacción corta, <= 500 filas), para que comparar-y-escribir sea consistente.
  perform pg_advisory_xact_lock(hashtext('importar_entidades_catalogo'));
  if not p_simular then
    begin
      lock table public.entidades_catalogo in share row exclusive mode;
    exception when lock_not_available or query_canceled then
      raise exception 'IMPORTACION_CANCELADA: otra operación está modificando entidades en este momento; reintente en unos segundos'
        using errcode = 'IE005', detail = jsonb_build_object('causa','tabla_ocupada')::text, hint = 'No se aplicó ningún cambio';
    end;
  end if;

  begin
    for v_i in 0 .. v_n - 1 loop
      v_op := v_ops -> v_i;
      v_ctx_fila := coalesce(v_op->>'fila', (v_i + 2)::text); v_ctx_rut := v_op->>'rut';
      if jsonb_typeof(v_op) <> 'object' then
        raise exception 'IMPORTACION_CANCELADA: fila %: operación inválida', v_ctx_fila using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'causa','operacion_invalida')::text, hint = 'No se aplicó ningún cambio';
      end if;
      for v_k in select jsonb_object_keys(v_op) loop
        if not (v_k = any (c_claves)) then
          raise exception 'IMPORTACION_CANCELADA: fila %: campo no permitido «%»', v_ctx_fila, v_k using errcode = 'IE001',
            detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_ctx_rut,'campo',v_k,'causa','campo_no_permitido')::text, hint = 'No se aplicó ningún cambio';
        end if;
      end loop;
      -- los valores deben ser texto o nulo
      foreach v_k in array c_claves loop
        if v_op ? v_k and jsonb_typeof(v_op->v_k) not in ('string','null') and v_k <> 'fila' then
          raise exception 'IMPORTACION_CANCELADA: fila %: «%» debe ser texto', v_ctx_fila, v_k using errcode = 'IE001',
            detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_ctx_rut,'campo',v_k,'causa','tipo_invalido')::text, hint = 'No se aplicó ningún cambio';
        end if;
      end loop;

      -- RUT: limpiar, validar largo y dígito verificador
      v_rutorig := coalesce(v_op->>'rut','');
      v_limpio := upper(regexp_replace(v_rutorig, '[\s.\-‐-―]', '', 'g'));
      if v_limpio !~ '^[0-9]{7,8}[0-9K]$' then
        raise exception 'IMPORTACION_CANCELADA: fila %: RUT «%» no válido', v_ctx_fila, v_rutorig using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','rut','causa','rut_invalido')::text, hint = 'No se aplicó ningún cambio';
      end if;
      v_cuerpo := left(v_limpio, length(v_limpio) - 1); v_dv := right(v_limpio, 1);
      if v_cuerpo::int < 1000000 then
        raise exception 'IMPORTACION_CANCELADA: fila %: RUT «%» fuera de rango', v_ctx_fila, v_rutorig using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','rut','causa','rut_fuera_de_rango')::text, hint = 'No se aplicó ningún cambio';
      end if;
      v_suma := 0; v_f := 2;
      for j in reverse length(v_cuerpo) .. 1 loop
        v_suma := v_suma + substr(v_cuerpo, j, 1)::int * v_f;
        v_f := case when v_f = 7 then 2 else v_f + 1 end;
      end loop;
      v_r := 11 - (v_suma % 11);
      v_dvcalc := case when v_r = 11 then '0' when v_r = 10 then 'K' else v_r::text end;
      if v_dvcalc <> v_dv then
        raise exception 'IMPORTACION_CANCELADA: fila %: RUT «%» con dígito verificador incorrecto', v_ctx_fila, v_rutorig using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','rut','causa','dv_incorrecto')::text, hint = 'No se aplicó ningún cambio';
      end if;
      v_clave := regexp_replace(v_cuerpo || v_dv, '^0+(?=.)', '');
      if v_clave = any (v_vistos) then
        raise exception 'IMPORTACION_CANCELADA: fila %: RUT «%» repetido en el archivo', v_ctx_fila, v_rutorig using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','rut','causa','rut_repetido_en_payload')::text, hint = 'No se aplicó ningún cambio';
      end if;
      v_vistos := v_vistos || v_clave;

      -- Textos
      v_nombre := nullif(btrim(coalesce(v_op->>'nombre_entidad','')), '');
      v_comuna := nullif(btrim(coalesce(v_op->>'comuna','')), '');
      v_contacto := nullif(btrim(coalesce(v_op->>'contacto','')), '');
      v_correo := nullif(btrim(coalesce(v_op->>'correo','')), '');
      if v_nombre is null then
        raise exception 'IMPORTACION_CANCELADA: fila %: falta el nombre de la entidad', v_ctx_fila using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','nombre_entidad','causa','nombre_vacio')::text, hint = 'No se aplicó ningún cambio';
      end if;
      foreach v_k in array array['nombre_entidad','comuna','contacto','correo'] loop
        if length(coalesce(case v_k when 'nombre_entidad' then v_nombre when 'comuna' then v_comuna when 'contacto' then v_contacto else v_correo end,'')) > 200 then
          raise exception 'IMPORTACION_CANCELADA: fila %: «%» demasiado largo (máximo 200)', v_ctx_fila, v_k using errcode = 'IE001',
            detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo',v_k,'causa','texto_largo')::text, hint = 'No se aplicó ningún cambio';
        end if;
      end loop;
      if v_correo is not null and v_correo !~ '^[^\s@;,]+@[^\s@;,]+\.[^\s@;,]+$' then
        raise exception 'IMPORTACION_CANCELADA: fila %: correo «%» no válido', v_ctx_fila, v_correo using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','correo','causa','correo_invalido')::text, hint = 'No se aplicó ningún cambio';
      end if;
      if concat(v_nombre, v_comuna, v_contacto, v_correo) ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
        raise exception 'IMPORTACION_CANCELADA: fila %: contiene caracteres de control', v_ctx_fila using errcode = 'IE001',
          detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','texto','causa','caracteres_control')::text, hint = 'No se aplicó ningún cambio';
      end if;

      -- Coincidencias con el catálogo por RUT normalizado (cualquier formato guardado)
      select count(*) into v_coinc from public.entidades_catalogo e
        where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;
      if v_coinc > 1 then
        raise exception 'IMPORTACION_CANCELADA: fila %: el RUT «%» coincide con % entidades existentes (duplicado histórico); resuélvalo antes', v_ctx_fila, v_rutorig, v_coinc
          using errcode = 'IE002', detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_rutorig,'campo','rut','causa','ambiguo','coincidencias',v_coinc)::text,
                hint = 'No se aplicó ningún cambio';
      end if;

      if v_coinc = 0 then
        v_creadas := v_creadas + 1;
        if not p_simular then
          insert into public.entidades_catalogo (id, rut, nombre_entidad, comuna, contacto, correo, creado_por)
          values ('ent_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || v_i::text), 1, 5),
                  case when length(v_cuerpo) = 8 then substr(v_cuerpo,1,2) || '.' || substr(v_cuerpo,3,3) || '.' || substr(v_cuerpo,6,3)
                       else substr(v_cuerpo,1,1) || '.' || substr(v_cuerpo,2,3) || '.' || substr(v_cuerpo,5,3) end || '-' || v_dv,
                  v_nombre, coalesce(v_comuna,''), coalesce(v_contacto,''), coalesce(v_correo,''), v_uid);
        end if;
      else
        select * into v_ex from public.entidades_catalogo e
          where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;
        if v_nombre is not distinct from btrim(v_ex.nombre_entidad)
           and (v_comuna is null or v_comuna = btrim(coalesce(v_ex.comuna,'')))
           and (v_contacto is null or v_contacto = btrim(coalesce(v_ex.contacto,'')))
           and (v_correo is null or v_correo = btrim(coalesce(v_ex.correo,''))) then
          v_sin := v_sin + 1;
        else
          v_actualizadas := v_actualizadas + 1;
          if not p_simular then
            update public.entidades_catalogo set
              nombre_entidad = v_nombre,
              comuna = coalesce(v_comuna, comuna),
              contacto = coalesce(v_contacto, contacto),
              correo = coalesce(v_correo, correo)
            where id = v_ex.id;
          end if;
        end if;
      end if;
    end loop;
  exception when others then
    if sqlstate like 'IE%' then raise; end if;
    raise exception 'IMPORTACION_CANCELADA: fila %: %', coalesce(v_ctx_fila,'?'), sqlerrm using errcode = 'IE001',
      detail = jsonb_build_object('fila',v_ctx_fila,'rut',v_ctx_rut,'causa','error_base','sqlstate',sqlstate)::text,
      hint = 'No se aplicó ningún cambio';
  end;

  return jsonb_build_object('ok', true, 'simulado', p_simular, 'total', v_n,
                            'creadas', v_creadas, 'actualizadas', v_actualizadas, 'sin_cambios', v_sin);
end;
$$;

revoke all on function public.importar_entidades_catalogo(jsonb, boolean) from public, anon;
grant execute on function public.importar_entidades_catalogo(jsonb, boolean) to authenticated;
