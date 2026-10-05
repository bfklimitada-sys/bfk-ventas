-- IMPORTACIÓN ATÓMICA DE RESPALDO EXCEL (una sola función, una sola transacción).
-- NO se ha ejecutado en producción. No modifica ninguna fila al crearse: solo crea la función.
--
-- Propiedad: cualquier error => se revierte TODA la operación (0 cambios persistentes).
-- Una función PL/pgSQL corre dentro de la transacción de la llamada RPC: si lanza una excepción, PostgreSQL
-- revierte todo lo escrito por ella. No hay commits intermedios ni compensación desde JavaScript.
--
-- Alcance: exclusivamente las 14 tablas autorizadas (lista constante dentro de la función). Solo INSERT y UPDATE.
-- No hay DELETE. El cliente NO envía SQL ni nombres de tabla libres: toda tabla/columna se valida contra el
-- catálogo de PostgreSQL en tiempo de ejecución (columnas existentes, tipos reales, columnas generadas, PK, FK).
--
-- Seguridad: SECURITY INVOKER (respeta RLS del usuario que llama) + verificación interna de sesión y rol 'admin'.
-- Ejecución revocada a public/anon; concedida solo a authenticated (patrón de registrar_pago_financiador).
--
-- Payload (p_payload):
-- { "version": 1,
--   "tablas": {
--     "<tabla autorizada>": {
--        "insertar":   [ { "id": "...", "col": valor, ... } ],
--        "actualizar": [ { "id": "...", "cambios": {col: nuevo}, "esperado": {col: valor_que_el_cliente_vio} } ]
--     } } }
-- Columnas generadas: se ignoran siempre (se recalculan solas) y se informan en la respuesta.
-- Valores json/jsonb y arrays pueden venir como objeto/array o como texto JSON (así los guarda el Excel):
-- se convierten según el tipo REAL de la columna. Texto que parece JSON en una columna text sigue siendo texto.
--
-- p_simular (por defecto true): ejecuta TODAS las validaciones verificables sin escribir nada
-- (forma, tablas, catálogo, tipos, NOT NULL, FK entre las 14 tablas, duplicados, conflictos con `esperado`)
-- y no toma bloqueos de fila. Las restricciones UNIQUE/CHECK y las FK hacia tablas fuera de las 14 solo
-- pueden comprobarse al escribir: en modo real, si fallan, se revierte todo.
--
-- Errores: excepción con errcode IM001 (validación), IM002 (conflicto concurrente), IM003 (permisos),
-- IM004 (otra importación en curso), IM005 (dependencia circular). detail = JSON {tabla,id,campo,causa}.
-- Respuesta: {ok, simulado, orden, tablas:{<t>:{insertadas,actualizadas}}, total_insertadas, total_actualizadas, columnas_generadas_ignoradas}

create or replace function public.importar_respaldo_excel(
  p_payload jsonb,
  p_simular boolean default true
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  c_tablas constant text[] := array['ordenes_compra_v2','eventos_compra','eventos_entrega','eventos_factura',
    'eventos_pago_cliente','eventos_pago_financiamiento','financiadores','vendedores','categorias_gasto',
    'gastos_indirectos','iva_mensual','pagos_vendedor','ajustes_saldo_financiador','contactos_cobranza'];
  v_uid uuid := auth.uid();
  v_rol text;
  v_usuario text;
  v_t text := null; v_id text := null; v_campo text := null;       -- contexto para mensajes de error
  v_k text; v_v jsonb;
  v_tablas jsonb; v_ent jsonb;
  v_cat jsonb := '{}'::jsonb;                                       -- catálogo por tabla: columnas, FK
  v_cols jsonb; v_info jsonb; v_fks jsonb; v_fk jsonb;
  v_dep jsonb := '{}'::jsonb; v_pend text[]; v_orden text[] := '{}'; v_listos text[];
  v_orden_payload text[] := '{}';
  r record;
  v_fase int; v_modo text; v_op jsonb; v_i int; v_j int; v_n int;
  v_obj jsonb; v_adj jsonb; v_fila_adj jsonb; v_cam_adj jsonb; v_esp_adj jsonb;
  v_actual jsonb; v_tipado jsonb; v_esperado_norm jsonb;
  v_vistos jsonb := '{}'::jsonb; v_ins_ids jsonb := '{}'::jsonb; v_ignoradas jsonb := '{}'::jsonb;
  v_resumen jsonb := '{}'::jsonb; v_ins int; v_upd int; v_tot_ins int := 0; v_tot_upd int := 0;
  v_cols_sql text; v_set_sql text; v_filas int; v_padre_existe boolean; v_tipo_json text;
begin
  ---------------------------------------------------------------- sesión y rol
  if v_uid is null then
    raise exception 'IMPORTACION_CANCELADA: se requiere una sesión válida' using errcode = 'IM003', hint = 'No se aplicó ningún cambio';
  end if;
  select rol, nombre into v_rol, v_usuario from public.perfiles where id = v_uid;
  if v_rol is distinct from 'admin' then
    raise exception 'IMPORTACION_CANCELADA: solo el administrador puede importar' using errcode = 'IM003', hint = 'No se aplicó ningún cambio';
  end if;

  ---------------------------------------------------------------- una importación a la vez (solo en modo real)
  if not p_simular then
    if not pg_try_advisory_xact_lock(hashtextextended('bfk.importar_respaldo_excel', 0)) then
      raise exception 'IMPORTACION_CANCELADA: hay otra importación en curso' using errcode = 'IM004', hint = 'No se aplicó ningún cambio. Reintente en unos segundos';
    end if;
  end if;

  begin   -- bloque con contexto: cualquier error no controlado se re-lanza indicando tabla/id/campo
    ---------------------------------------------------------------- forma del payload
    if jsonb_typeof(p_payload) is distinct from 'object' or (p_payload->>'version') is distinct from '1'
       or jsonb_typeof(p_payload->'tablas') is distinct from 'object' then
      raise exception 'IMPORTACION_CANCELADA: payload inválido (se espera {"version":1,"tablas":{...}})' using errcode = 'IM001', detail = '{"causa":"payload"}';
    end if;
    for v_k in select jsonb_object_keys(p_payload) loop
      if v_k not in ('version','tablas') then
        raise exception 'IMPORTACION_CANCELADA: clave no permitida en el payload: %', v_k using errcode = 'IM001', detail = jsonb_build_object('causa','clave_no_permitida','campo',v_k)::text;
      end if;
    end loop;
    v_tablas := p_payload->'tablas';
    for v_t in select jsonb_object_keys(v_tablas) loop
      if not (v_t = any(c_tablas)) then
        raise exception 'IMPORTACION_CANCELADA: tabla no autorizada: %', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','tabla_no_autorizada')::text;
      end if;
      v_ent := v_tablas->v_t;
      if jsonb_typeof(v_ent) is distinct from 'object' then
        raise exception 'IMPORTACION_CANCELADA: entrada inválida para %', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','entrada_invalida')::text;
      end if;
      for v_k in select jsonb_object_keys(v_ent) loop
        if v_k not in ('insertar','actualizar') or jsonb_typeof(v_ent->v_k) is distinct from 'array' then
          raise exception 'IMPORTACION_CANCELADA: % solo admite listas "insertar" y "actualizar"', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'campo',v_k,'causa','estructura')::text;
        end if;
      end loop;
    end loop;

    ---------------------------------------------------------------- catálogo real de cada tabla del payload
    for v_t in select jsonb_object_keys(v_tablas) loop
      select jsonb_object_agg(a.attname, jsonb_build_object(
               'tipo', format_type(a.atttypid, a.atttypmod),
               'clase', case when t.oid in (114, 3802) or (t.typtype = 'd' and t.typbasetype in (114, 3802)) then 'json'
                             when t.typcategory = 'A' then 'array' else 'escalar' end,
               'escribible', (a.attgenerated = '' and a.attidentity <> 'a'),
               'obligatoria', (a.attnotnull and not a.atthasdef and a.attgenerated = '' and a.attidentity = '')))
        into v_cols
        from pg_attribute a join pg_type t on t.oid = a.atttypid
       where a.attrelid = format('public.%I', v_t)::regclass and a.attnum > 0 and not a.attisdropped;
      if v_cols is null then
        raise exception 'IMPORTACION_CANCELADA: la tabla % no existe', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','tabla_inexistente')::text;
      end if;
      -- PK: debe ser exactamente la columna id
      if (select array_agg(a.attname::text order by a.attname) from pg_index i
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
           where i.indrelid = format('public.%I', v_t)::regclass and i.indisprimary) is distinct from array['id'] then
        raise exception 'IMPORTACION_CANCELADA: la clave primaria de % no es (id)', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','pk')::text;
      end if;
      -- FK de columna única (para validación amigable de referencias)
      select coalesce(jsonb_agg(jsonb_build_object('col', a.attname, 'tabla', pc.relname, 'col_padre', pa.attname,
                                                   'en_lista', pc.relname = any(c_tablas))), '[]'::jsonb)
        into v_fks
        from pg_constraint c
        join pg_class pc on pc.oid = c.confrelid and pc.relnamespace = 'public'::regnamespace
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
        join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
       where c.contype = 'f' and c.conrelid = format('public.%I', v_t)::regclass and cardinality(c.conkey) = 1;
      v_cat := v_cat || jsonb_build_object(v_t, jsonb_build_object('cols', v_cols, 'fks', v_fks));
    end loop;

    ---------------------------------------------------------------- orden por dependencias reales (FK entre las 14 tablas)
    for r in
      select hc.relname::text as hijo, pc.relname::text as padre
        from pg_constraint c
        join pg_class hc on hc.oid = c.conrelid and hc.relnamespace = 'public'::regnamespace
        join pg_class pc on pc.oid = c.confrelid and pc.relnamespace = 'public'::regnamespace
       where c.contype = 'f' and c.conrelid <> c.confrelid
         and hc.relname = any(c_tablas) and pc.relname = any(c_tablas)
    loop
      v_dep := v_dep || jsonb_build_object(r.hijo, coalesce(v_dep->r.hijo, '[]'::jsonb) || to_jsonb(r.padre));
    end loop;
    v_pend := c_tablas;
    while coalesce(array_length(v_pend, 1), 0) > 0 loop
      v_listos := '{}';
      foreach v_t in array v_pend loop
        if not exists (select 1 from jsonb_array_elements_text(coalesce(v_dep->v_t, '[]'::jsonb)) p(padre)
                        where p.padre = any(v_pend) and p.padre <> v_t) then
          v_listos := v_listos || v_t;
        end if;
      end loop;
      if coalesce(array_length(v_listos, 1), 0) = 0 then
        raise exception 'IMPORTACION_CANCELADA: dependencia circular entre tablas: %', array_to_string(v_pend, ', ') using errcode = 'IM005', detail = jsonb_build_object('causa','dependencia_circular','tablas',v_pend)::text;
      end if;
      v_orden := v_orden || v_listos;
      v_pend := array(select x from unnest(v_pend) x where not (x = any(v_listos)));
    end loop;
    foreach v_t in array v_orden loop
      if v_tablas ? v_t then v_orden_payload := v_orden_payload || v_t; end if;
    end loop;

    ---------------------------------------------------------------- fase 1: validar todo / fase 2: escribir (solo modo real)
    for v_fase in 1..(case when p_simular then 1 else 2 end) loop
      v_resumen := '{}'::jsonb; v_tot_ins := 0; v_tot_upd := 0;
      foreach v_t in array v_orden_payload loop
        v_ent := v_tablas->v_t; v_cols := v_cat->v_t->'cols'; v_fks := v_cat->v_t->'fks';
        v_ins := 0; v_upd := 0;
        foreach v_modo in array array['insertar','actualizar'] loop
          for v_i in 0 .. jsonb_array_length(coalesce(v_ent->v_modo, '[]'::jsonb)) - 1 loop
            v_op := (v_ent->v_modo)->v_i; v_id := null; v_campo := null;
            if jsonb_typeof(v_op) is distinct from 'object' then
              raise exception 'IMPORTACION_CANCELADA: operación inválida en % (%)', v_t, v_modo using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','operacion_invalida')::text;
            end if;
            v_id := v_op->>'id';
            if v_id is null or btrim(v_id) = '' or jsonb_typeof(v_op->'id') not in ('string','number') then
              raise exception 'IMPORTACION_CANCELADA: operación sin id en %', v_t using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'causa','sin_id')::text;
            end if;

            -- normalizar objetos (fila / cambios / esperado) según el tipo REAL de cada columna
            v_fila_adj := null; v_cam_adj := null; v_esp_adj := null;
            for v_j in 1..3 loop
              v_obj := case when v_modo = 'insertar' then (case v_j when 1 then v_op else null end)
                            else (case v_j when 2 then v_op->'cambios' when 3 then v_op->'esperado' else null end) end;
              continue when v_obj is null;
              if jsonb_typeof(v_obj) is distinct from 'object' or v_obj = '{}'::jsonb then
                raise exception 'IMPORTACION_CANCELADA: % / id %: datos vacíos o inválidos', v_t, v_id using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','datos_invalidos')::text;
              end if;
              v_adj := '{}'::jsonb;
              for v_k, v_v in select key, value from jsonb_each(v_obj) loop
                v_campo := v_k; v_info := v_cols->v_k;
                if v_info is null then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: la columna "%" no existe', v_t, v_id, v_k using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','columna_inexistente')::text;
                end if;
                if not (v_info->>'escribible')::boolean then
                  -- Un Excel exportado trae TODAS las columnas, también las generadas (se recalculan solas al
                  -- cambiar las demás): se ignoran siempre (insert, cambios y esperado) y se informan en la respuesta.
                  v_ignoradas := v_ignoradas || jsonb_build_object(v_t || '.' || v_k, true);
                  continue;
                end if;
                if v_info->>'clase' in ('json','array') and jsonb_typeof(v_v) = 'string' then
                  begin v_v := (v_v #>> '{}')::jsonb;
                  exception when others then
                    raise exception 'IMPORTACION_CANCELADA: % / id %: "%" no contiene JSON válido para su tipo %', v_t, v_id, v_k, v_info->>'tipo' using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','json_invalido')::text;
                  end;
                end if;
                if v_info->>'clase' = 'array' and jsonb_typeof(v_v) not in ('array','null') then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: "%" debe ser un array (tipo %)', v_t, v_id, v_k, v_info->>'tipo' using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','tipo_incompatible')::text;
                end if;
                if v_info->>'clase' = 'escalar' and jsonb_typeof(v_v) in ('object','array') then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: "%" no admite objetos ni arrays (tipo %)', v_t, v_id, v_k, v_info->>'tipo' using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','tipo_incompatible')::text;
                end if;
                v_adj := v_adj || jsonb_build_object(v_k, v_v);
              end loop;
              v_campo := null;
              if v_modo = 'insertar' then v_fila_adj := v_adj;
              elsif v_j = 2 then v_cam_adj := v_adj; else v_esp_adj := v_adj; end if;
            end loop;

            if v_modo = 'actualizar' and v_cam_adj = '{}'::jsonb then continue; end if;   -- solo traía columnas generadas

            if v_fase = 1 then
              ---------------------------------------------------- validaciones (sin escribir)
              if v_vistos ? (v_t || '|' || v_id) then
                raise exception 'IMPORTACION_CANCELADA: % / id %: aparece más de una vez en el payload', v_t, v_id using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','duplicado_en_payload')::text;
              end if;
              v_vistos := v_vistos || jsonb_build_object(v_t || '|' || v_id, true);

              if v_modo = 'insertar' then
                if not (v_fila_adj ? 'id') then v_fila_adj := v_fila_adj || jsonb_build_object('id', v_op->'id'); end if;
                -- conversión real de tipos (falla si algún valor no cabe en su columna)
                begin
                  execute format('select to_jsonb(r) from jsonb_populate_record(null::public.%I, $1) r', v_t) into v_tipado using v_fila_adj;
                exception when others then
                  v_campo := null;
                  for v_k, v_v in select key, value from jsonb_each(v_fila_adj) loop      -- localizar la columna culpable
                    begin execute format('select 1 from jsonb_populate_record(null::public.%I, $1)', v_t) using jsonb_build_object(v_k, v_v);
                    exception when others then v_campo := v_k; exit; end;
                  end loop;
                  raise exception 'IMPORTACION_CANCELADA: % / id %: valor incompatible con el tipo de la columna%', v_t, v_id, coalesce(' "' || v_campo || '"', '') using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_campo,'causa','valor_incompatible')::text;
                end;
                -- columnas NOT NULL sin valor por defecto
                for v_k, v_info in select key, value from jsonb_each(v_cols) loop
                  if (v_info->>'obligatoria')::boolean and (not (v_fila_adj ? v_k) or jsonb_typeof(v_fila_adj->v_k) = 'null') then
                    raise exception 'IMPORTACION_CANCELADA: % / id %: falta la columna obligatoria "%"', v_t, v_id, v_k using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','columna_obligatoria')::text;
                  end if;
                end loop;
                -- el id no debe haber aparecido desde la comparación
                execute format('select exists(select 1 from public.%I t where t.id::text = $1)', v_t) into v_padre_existe using v_id;
                if v_padre_existe then
                  raise exception 'IMPORTACION_CANCELADA: conflicto: % / id % ya existe (apareció después de la comparación)', v_t, v_id using errcode = 'IM002', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','id_ya_existe')::text;
                end if;
                v_ins_ids := v_ins_ids || jsonb_build_object(v_t || '|' || v_id, true);
                v_tipado := to_jsonb(v_tipado);
                v_ins := v_ins + 1;
              else
                if v_cam_adj is null or v_esp_adj is null then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: faltan "cambios" o "esperado"', v_t, v_id using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','sin_esperado')::text;
                end if;
                if v_cam_adj ? 'id' then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: no se permite cambiar el id', v_t, v_id using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo','id','causa','id_inmutable')::text;
                end if;
                for v_k in select jsonb_object_keys(v_cam_adj) loop
                  if not (v_esp_adj ? v_k) then
                    raise exception 'IMPORTACION_CANCELADA: % / id %: falta el valor esperado de "%"', v_t, v_id, v_k using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','sin_esperado')::text;
                  end if;
                  if jsonb_typeof(v_cam_adj->v_k) = 'null' and (v_cols->v_k->>'obligatoria')::boolean then
                    raise exception 'IMPORTACION_CANCELADA: % / id %: "%" es obligatoria y no admite null', v_t, v_id, v_k using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','columna_obligatoria')::text;
                  end if;
                end loop;
                begin
                  execute format('select to_jsonb(r) from jsonb_populate_record(null::public.%I, $1) r', v_t) into v_tipado using v_cam_adj;
                  execute format('select to_jsonb(r) from jsonb_populate_record(null::public.%I, $1) r', v_t) into v_esperado_norm using v_esp_adj;
                exception when others then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: valor incompatible con el tipo de la columna', v_t, v_id using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','valor_incompatible')::text;
                end;
                -- fila actual (bloqueada hasta el final de la transacción en modo real) y control optimista
                execute format('select to_jsonb(t) from public.%I t where t.id::text = $1 %s', v_t, case when p_simular then '' else 'for update' end) into v_actual using v_id;
                if v_actual is null then
                  raise exception 'IMPORTACION_CANCELADA: conflicto: % / id % ya no existe o no es modificable', v_t, v_id using errcode = 'IM002', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','fila_inexistente')::text;
                end if;
                for v_k in select jsonb_object_keys(v_cam_adj) loop
                  if (v_actual->v_k) is distinct from (v_esperado_norm->v_k) then
                    raise exception 'IMPORTACION_CANCELADA: conflicto: % / id %: la columna "%" cambió después de la comparación', v_t, v_id, v_k using errcode = 'IM002', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_k,'causa','conflicto_concurrente')::text;
                  end if;
                end loop;
                v_upd := v_upd + 1;
              end if;

              -- referencias (FK de columna única hacia tablas de la lista): el padre debe existir o venir en el payload
              for v_fk in select value from jsonb_array_elements(v_fks) loop
                continue when not (v_fk->>'en_lista')::boolean;
                continue when v_modo = 'actualizar' and not (v_cam_adj ? (v_fk->>'col'));
                v_k := v_tipado->>(v_fk->>'col');
                continue when v_k is null;
                if not (v_ins_ids ? ((v_fk->>'tabla') || '|' || v_k)) then
                  execute format('select exists(select 1 from public.%I p where p.%I::text = $1)', v_fk->>'tabla', v_fk->>'col_padre') into v_padre_existe using v_k;
                  if not v_padre_existe then
                    raise exception 'IMPORTACION_CANCELADA: % / id %: "%" = % no existe en %', v_t, v_id, v_fk->>'col', v_k, v_fk->>'tabla' using errcode = 'IM001', detail = jsonb_build_object('tabla',v_t,'id',v_id,'campo',v_fk->>'col','causa','referencia_inexistente')::text;
                  end if;
                end if;
              end loop;
            else
              ---------------------------------------------------- fase 2: escritura (ya validado y bloqueado)
              if v_modo = 'insertar' then
                if not (v_fila_adj ? 'id') then v_fila_adj := v_fila_adj || jsonb_build_object('id', v_op->'id'); end if;
                select string_agg(format('%I', key), ', ') into v_cols_sql from jsonb_object_keys(v_fila_adj) key;
                execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', v_t, v_cols_sql, v_cols_sql, v_t) using v_fila_adj;
                v_ins := v_ins + 1;
              else
                select string_agg(format('%I = r.%I', key, key), ', ') into v_set_sql from jsonb_object_keys(v_cam_adj) key;
                execute format('update public.%I as t set %s from jsonb_populate_record(null::public.%I, $1) as r where t.id::text = $2', v_t, v_set_sql, v_t) using v_cam_adj, v_id;
                get diagnostics v_filas = row_count;
                if v_filas <> 1 then
                  raise exception 'IMPORTACION_CANCELADA: % / id %: la actualización afectó % filas', v_t, v_id, v_filas using errcode = 'IM002', detail = jsonb_build_object('tabla',v_t,'id',v_id,'causa','filas_afectadas')::text;
                end if;
                v_upd := v_upd + 1;
              end if;
            end if;
          end loop;
        end loop;
        v_resumen := v_resumen || jsonb_build_object(v_t, jsonb_build_object('insertadas', v_ins, 'actualizadas', v_upd));
        v_tot_ins := v_tot_ins + v_ins; v_tot_upd := v_tot_upd + v_upd;
      end loop;
    end loop;

    ---------------------------------------------------------------- traza (solo modo real y si hubo cambios)
    if not p_simular and (v_tot_ins + v_tot_upd) > 0 then
      v_t := 'historial_cambios'; v_id := null;
      insert into public.historial_cambios (id, usuario_id, usuario_nombre, accion, campo, valor_nuevo)
      values ('hc_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 5),
              v_uid, v_usuario, 'Importación de respaldo Excel', 'importacion',
              v_tot_ins || ' filas nuevas, ' || v_tot_upd || ' actualizadas');
    end if;
  exception
    when others then
      if sqlstate like 'IM%' then raise; end if;
      -- error de la base (FK, UNIQUE, CHECK, RLS, tiempo límite…): se informa dónde ocurrió; todo se revierte
      raise exception 'IMPORTACION_CANCELADA: % (tabla %, id %)', sqlerrm, coalesce(v_t, '?'), coalesce(v_id, '?')
        using errcode = 'IM001', detail = jsonb_build_object('tabla', v_t, 'id', v_id, 'campo', v_campo, 'causa', 'error_base', 'sqlstate', sqlstate)::text,
              hint = 'No se aplicó ningún cambio';
  end;

  return jsonb_build_object('ok', true, 'simulado', p_simular, 'orden', to_jsonb(v_orden_payload), 'tablas', v_resumen,
                            'total_insertadas', v_tot_ins, 'total_actualizadas', v_tot_upd,
                            'columnas_generadas_ignoradas', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb) from jsonb_object_keys(v_ignoradas) k));
end;
$$;

revoke all on function public.importar_respaldo_excel(jsonb, boolean) from public, anon;
grant execute on function public.importar_respaldo_excel(jsonb, boolean) to authenticated;
