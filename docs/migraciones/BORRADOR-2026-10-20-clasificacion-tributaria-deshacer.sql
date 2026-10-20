-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER — Clasificación tributaria (fase 2 exentas). Una sola transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-20-clasificacion-tributaria-deshacer.sql
-- Se DETIENE sin tocar nada si ya hay clasificaciones registradas, columnas con datos o documentos de respaldo:
-- en ese caso los respaldos tributarios no se descartan sin autorización expresa.
-- Restaura cz_guardar_cotizacion_v2 exactamente como está hoy en producción (cuerpo verificado el 20/10/2026).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ declare v_n bigint; begin
  if to_regclass('public.trib_clasificaciones') is null then raise exception 'TRIB-DESHACER: la migración no está instalada; no se hizo nada'; end if;
  select count(*) into v_n from public.trib_clasificaciones;
  if v_n > 0 then raise exception 'TRIB-DESHACER: hay % registros de clasificación tributaria; se requiere autorización expresa', v_n; end if;
  select (select count(*) from public.cotizaciones where coalesce(tratamiento_iva, fundamento_iva, respaldo_iva, clasificacion_id::text, tratamiento_aprobado_por::text) is not null or tratamiento_aprobado_en is not null)
       + (select count(*) from public.ordenes_compra_v2 where coalesce(tratamiento_iva, fundamento_iva, respaldo_iva, clasificacion_id::text, tratamiento_aprobado_por::text) is not null or tratamiento_aprobado_en is not null)
    into v_n;
  if v_n > 0 then raise exception 'TRIB-DESHACER: % filas tienen clasificación; se requiere autorización expresa', v_n; end if;
  if to_regclass('storage.objects') is not null then
    select count(*) into v_n from storage.objects where bucket_id = 'trib-respaldos';
    if v_n > 0 then raise exception 'TRIB-DESHACER: hay % documentos de respaldo; se requiere autorización expresa', v_n; end if;
  end if;
end $$;

do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists trib_respaldo_subir on storage.objects;
    drop policy if exists trib_respaldo_leer on storage.objects;
    delete from storage.buckets where id = 'trib-respaldos';
  end if;
end $$;

drop function public.trib_heredar_de_cotizacion(text, text);
drop function public.trib_anular_solicitud(uuid);
drop function public.trib_resolver_clasificacion(uuid, text, text);
drop function public.trib_solicitar_clasificacion(jsonb);
drop function public.trib_motivo_incompatible(text, uuid, text, text, text);
drop trigger trib_proteger_cotizacion on public.cotizaciones;
drop trigger trib_proteger_oc on public.ordenes_compra_v2;
drop function public.trib_proteger_columnas();
drop function public.trib_escritura_api();
drop function public.trib_codigo_oc(text);
alter table public.cotizaciones drop constraint cotizaciones_tratamiento_iva_chk,
  drop column tratamiento_iva, drop column fundamento_iva, drop column respaldo_iva,
  drop column tratamiento_aprobado_por, drop column tratamiento_aprobado_en, drop column clasificacion_id;
alter table public.ordenes_compra_v2 drop constraint ordenes_tratamiento_iva_chk,
  drop column tratamiento_iva, drop column fundamento_iva, drop column respaldo_iva,
  drop column tratamiento_aprobado_por, drop column tratamiento_aprobado_en, drop column clasificacion_id;
drop table public.trib_clasificaciones;

-- cz_guardar_cotizacion_v2: definición vigente en producción antes de la migración (sin cambios).
create or replace function public.cz_guardar_cotizacion_v2(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ver integer; c public.cotizaciones%rowtype; e jsonb; it jsonb; n integer := 0;
  v_ofertado jsonb; v_nuevo jsonb;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_typeof(p->'envios') is distinct from 'array' then
    raise exception 'Formato inválido' using errcode = '22023'; end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'Máximo 200 productos por cotización' using errcode = '22023'; end if;
  v_id := nullif(p->>'id', '')::uuid;
  if v_id is null then
    insert into public.cotizaciones (id_externo, nombre, institucion, rut, direccion_entrega, comuna, fecha, plazo, observaciones, estado, recargo, formula,
      subtotal_neto, impuestos, total, costo_neto, iva_credito, oc_codigo, version, actualizado_por,
      vendedor_id, vendedor_nombre, descripcion, unidad_compra, region, presupuesto_estimado, fecha_publicacion, fecha_cierre, requerimientos, documentos_mp, mp_consultado_en)
    values (p->>'id_externo', p->>'nombre', p->>'institucion', p->>'rut', p->>'direccion_entrega', p->>'comuna', coalesce(nullif(p->>'fecha','')::date, current_date),
      p->>'plazo', p->>'observaciones', coalesce(p->>'estado','borrador'), coalesce((p->>'recargo')::numeric, 0.30), p->'formula',
      coalesce((p->>'subtotal_neto')::numeric,0), coalesce((p->>'impuestos')::numeric,0), coalesce((p->>'total')::numeric,0),
      coalesce((p->>'costo_neto')::numeric,0), coalesce((p->>'iva_credito')::numeric,0), nullif(p->>'oc_codigo',''), 1, auth.uid(),
      nullif(p->>'vendedor_id',''), nullif(p->>'vendedor_nombre',''), nullif(p->>'descripcion',''), nullif(p->>'unidad_compra',''), nullif(p->>'region',''),
      nullif(p->>'presupuesto_estimado','')::numeric, nullif(p->>'fecha_publicacion','')::timestamp, nullif(p->>'fecha_cierre','')::timestamp,
      coalesce(case when jsonb_typeof(p->'requerimientos') = 'array' then p->'requerimientos' end, '[]'::jsonb),
      coalesce(case when jsonb_typeof(p->'documentos_mp') = 'array' then p->'documentos_mp' end, '[]'::jsonb), nullif(p->>'mp_consultado_en','')::timestamptz)
    returning id, version into v_id, v_ver;
  else
    select * into c from public.cotizaciones where id = v_id for update;
    if not found then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
    if c.version <> coalesce((p->>'version')::integer, -1) then
      raise exception 'CZ409: otra persona guardó cambios en esta cotización (versión %). Recarga antes de guardar.', c.version using errcode = '40001'; end if;
    if c.estado = 'adjudicada' then
      if coalesce(p->>'estado', c.estado) <> 'adjudicada' and not public.cz_es_admin() then
        raise exception 'CZ423: solo un administrador puede cambiar el estado de una cotización adjudicada.' using errcode = '42501'; end if;
      if c.oc_codigo is not null and coalesce(nullif(p->>'oc_codigo',''), '') <> c.oc_codigo and not public.cz_es_admin() then
        raise exception 'CZ423: el vínculo con la OC de una cotización adjudicada solo lo cambia un administrador.' using errcode = '42501'; end if;
      -- Lo ofertado = misma línea (identificador estable), mismo producto (marca y modelo), misma cantidad y mismo
      -- unitario, en el mismo orden. Así no se puede sustituir un producto aunque coincidan cantidades y precios.
      -- Siguen permitidas las correcciones técnicas (nombre, características, imágenes) y el enlace de compra.
      select coalesce(jsonb_agg(jsonb_build_array(lower(id::text), cantidad, unitario_venta_neto,
          public.cz_clave_nombre(especificaciones_aprobadas->>'marca'), public.cz_clave_nombre(especificaciones_aprobadas->>'modelo')) order by orden), '[]')
        into v_ofertado from public.cotizacion_items where cotizacion_id = v_id;
      select coalesce(jsonb_agg(jsonb_build_array(lower(coalesce(x->>'key','')), (x->>'cantidad')::numeric, coalesce((x->>'unitario_venta_neto')::numeric,0),
          public.cz_clave_nombre(x->'ficha'->>'marca'), public.cz_clave_nombre(x->'ficha'->>'modelo')) order by o), '[]')
        into v_nuevo from jsonb_array_elements(p->'items') with ordinality as t(x, o);
      if v_ofertado <> v_nuevo then
        raise exception 'CZ423: la cotización está adjudicada: los productos ofertados (líneas, marca, modelo), sus cantidades y precios no se pueden modificar ni sustituir.' using errcode = '42501'; end if;
    end if;
    update public.cotizaciones set id_externo = p->>'id_externo', nombre = p->>'nombre', institucion = p->>'institucion', rut = p->>'rut',
      direccion_entrega = p->>'direccion_entrega', comuna = p->>'comuna', fecha = coalesce(nullif(p->>'fecha','')::date, fecha), plazo = p->>'plazo',
      observaciones = p->>'observaciones', estado = coalesce(p->>'estado', estado), recargo = coalesce((p->>'recargo')::numeric, recargo), formula = p->'formula',
      subtotal_neto = coalesce((p->>'subtotal_neto')::numeric,0), impuestos = coalesce((p->>'impuestos')::numeric,0), total = coalesce((p->>'total')::numeric,0),
      costo_neto = coalesce((p->>'costo_neto')::numeric,0), iva_credito = coalesce((p->>'iva_credito')::numeric,0), oc_codigo = nullif(p->>'oc_codigo',''),
      vendedor_id = case when p ? 'vendedor_id' then nullif(p->>'vendedor_id','') else vendedor_id end,
      vendedor_nombre = case when p ? 'vendedor_nombre' then nullif(p->>'vendedor_nombre','') else vendedor_nombre end,
      descripcion = case when p ? 'descripcion' then nullif(p->>'descripcion','') else descripcion end,
      unidad_compra = case when p ? 'unidad_compra' then nullif(p->>'unidad_compra','') else unidad_compra end,
      region = case when p ? 'region' then nullif(p->>'region','') else region end,
      presupuesto_estimado = case when p ? 'presupuesto_estimado' then nullif(p->>'presupuesto_estimado','')::numeric else presupuesto_estimado end,
      fecha_publicacion = case when p ? 'fecha_publicacion' then nullif(p->>'fecha_publicacion','')::timestamp else fecha_publicacion end,
      fecha_cierre = case when p ? 'fecha_cierre' then nullif(p->>'fecha_cierre','')::timestamp else fecha_cierre end,
      requerimientos = case when jsonb_typeof(p->'requerimientos') = 'array' then p->'requerimientos' else requerimientos end,
      documentos_mp = case when jsonb_typeof(p->'documentos_mp') = 'array' then p->'documentos_mp' else documentos_mp end,
      mp_consultado_en = case when p ? 'mp_consultado_en' then nullif(p->>'mp_consultado_en','')::timestamptz else mp_consultado_en end,
      version = version + 1, actualizado_por = auth.uid(), actualizado_en = now()
    where id = v_id returning version into v_ver;
    delete from public.cotizacion_items where cotizacion_id = v_id;
    delete from public.cotizacion_envios where cotizacion_id = v_id;
  end if;
  for e in select * from jsonb_array_elements(p->'envios') loop
    insert into public.cotizacion_envios (cotizacion_id, clave, proveedor, origen_publicacion, destino, monto, con_factura, cobertura, fecha_cotizacion, estado_confirmacion, evidencia)
    values (v_id, e->>'key', e->>'proveedor', e->>'origen_publicacion', e->>'destino', coalesce(nullif(e->>'monto','')::numeric,0), coalesce((e->>'con_factura')::boolean, true),
      e->>'cobertura', nullif(e->>'fecha_cotizacion','')::date, coalesce(e->>'estado','pendiente'), e->>'evidencia');
  end loop;
  for it in select * from jsonb_array_elements(p->'items') loop
    n := n + 1;
    -- La línea conserva su identificador entre guardados (la app usa el id leído como clave), lo que permite
    -- reconocer el producto originalmente ofertado en una cotización adjudicada.
    insert into public.cotizacion_items (id, cotizacion_id, orden, producto_id, envio_clave, enlace, enlace_original, proveedor, disponibilidad, fecha_consulta, origen_datos, cantidad, precio_origen,
      precio_incluye_iva, con_factura, iva_compra, envio_asignado, costo_bruto, costo_neto, recargo, unitario_venta_neto, especificaciones_aprobadas, ficha_aprobada)
    values (case when coalesce(it->>'key','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (it->>'key')::uuid else gen_random_uuid() end,
      v_id, n, nullif(it->>'producto_id','')::uuid, nullif(it->>'envio_key',''), it->>'enlace', nullif(it->>'enlace_original',''), it->>'proveedor', it->>'disponibilidad', nullif(it->>'fecha_consulta','')::timestamptz,
      it->>'origen_datos', (it->>'cantidad')::numeric, coalesce(nullif(it->>'precio_origen','')::numeric,0), coalesce((it->>'precio_incluye_iva')::boolean, true),
      coalesce((it->>'con_factura')::boolean, true), coalesce((it->>'iva_compra')::numeric,0), coalesce((it->>'envio_asignado')::numeric,0),
      coalesce((it->>'costo_bruto')::numeric,0), coalesce((it->>'costo_neto')::numeric,0), nullif(it->>'recargo','')::numeric,
      coalesce((it->>'unitario_venta_neto')::numeric,0), coalesce(it->'ficha','{}'::jsonb), coalesce((it->>'ficha_aprobada')::boolean, false));
  end loop;
  insert into public.cotizacion_versiones (cotizacion_id, version, contenido) values (v_id, v_ver, p - 'version');
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;
