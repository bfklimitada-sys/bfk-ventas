-- Deshace BORRADOR-2026-10-cotizaciones-v2.sql y deja el módulo exactamente como en v1.
-- ATENCIÓN: borra lo guardado SOLO en la v2 (vendedor responsable, datos de Compra Ágil, enlace original,
-- metadatos de EETT, vendedores registrados desde Cotizaciones y la auditoría de eliminaciones).
-- Las cotizaciones, líneas, envíos, versiones y la biblioteca siguen intactas. Hacer respaldo antes.
do $$ begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists cz_storage_subir on storage.objects;
    execute $p$create policy cz_storage_subir on storage.objects for insert to authenticated with check (bucket_id in ('cz-productos','cz-eett') and public.cz_es_usuario())$p$;
  end if;
end $$;
drop function if exists public.cz_eliminar_cotizacion(uuid, text);
drop function if exists public.cz_registrar_vendedor(text);
drop function if exists public.cz_registrar_eett_v2(jsonb);

-- cz_guardar_cotizacion vuelve a su versión v1 (idéntica a BORRADOR-2026-10-cotizaciones.sql).
create or replace function public.cz_guardar_cotizacion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ver integer; v_actual integer; e jsonb; it jsonb; n integer := 0;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_typeof(p->'envios') is distinct from 'array' then
    raise exception 'Formato inválido' using errcode = '22023'; end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'Máximo 200 productos por cotización' using errcode = '22023'; end if;
  v_id := nullif(p->>'id', '')::uuid;
  if v_id is null then
    insert into public.cotizaciones (id_externo, nombre, institucion, rut, direccion_entrega, comuna, fecha, plazo, observaciones, estado, recargo, formula,
      subtotal_neto, impuestos, total, costo_neto, iva_credito, oc_codigo, version, actualizado_por)
    values (p->>'id_externo', p->>'nombre', p->>'institucion', p->>'rut', p->>'direccion_entrega', p->>'comuna', coalesce(nullif(p->>'fecha','')::date, current_date),
      p->>'plazo', p->>'observaciones', coalesce(p->>'estado','borrador'), coalesce((p->>'recargo')::numeric, 0.30), p->'formula',
      coalesce((p->>'subtotal_neto')::numeric,0), coalesce((p->>'impuestos')::numeric,0), coalesce((p->>'total')::numeric,0),
      coalesce((p->>'costo_neto')::numeric,0), coalesce((p->>'iva_credito')::numeric,0), nullif(p->>'oc_codigo',''), 1, auth.uid())
    returning id, version into v_id, v_ver;
  else
    select version into v_actual from public.cotizaciones where id = v_id for update;
    if not found then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
    if v_actual <> coalesce((p->>'version')::integer, -1) then
      raise exception 'CZ409: otra persona guardó cambios en esta cotización (versión %). Recarga antes de guardar.', v_actual using errcode = '40001'; end if;
    update public.cotizaciones set id_externo = p->>'id_externo', nombre = p->>'nombre', institucion = p->>'institucion', rut = p->>'rut',
      direccion_entrega = p->>'direccion_entrega', comuna = p->>'comuna', fecha = coalesce(nullif(p->>'fecha','')::date, fecha), plazo = p->>'plazo',
      observaciones = p->>'observaciones', estado = coalesce(p->>'estado', estado), recargo = coalesce((p->>'recargo')::numeric, recargo), formula = p->'formula',
      subtotal_neto = coalesce((p->>'subtotal_neto')::numeric,0), impuestos = coalesce((p->>'impuestos')::numeric,0), total = coalesce((p->>'total')::numeric,0),
      costo_neto = coalesce((p->>'costo_neto')::numeric,0), iva_credito = coalesce((p->>'iva_credito')::numeric,0), oc_codigo = nullif(p->>'oc_codigo',''),
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
    insert into public.cotizacion_items (cotizacion_id, orden, producto_id, envio_clave, enlace, proveedor, disponibilidad, fecha_consulta, origen_datos, cantidad, precio_origen,
      precio_incluye_iva, con_factura, iva_compra, envio_asignado, costo_bruto, costo_neto, recargo, unitario_venta_neto, especificaciones_aprobadas, ficha_aprobada)
    values (v_id, n, nullif(it->>'producto_id','')::uuid, nullif(it->>'envio_key',''), it->>'enlace', it->>'proveedor', it->>'disponibilidad', nullif(it->>'fecha_consulta','')::timestamptz,
      it->>'origen_datos', (it->>'cantidad')::numeric, coalesce(nullif(it->>'precio_origen','')::numeric,0), coalesce((it->>'precio_incluye_iva')::boolean, true),
      coalesce((it->>'con_factura')::boolean, true), coalesce((it->>'iva_compra')::numeric,0), coalesce((it->>'envio_asignado')::numeric,0),
      coalesce((it->>'costo_bruto')::numeric,0), coalesce((it->>'costo_neto')::numeric,0), nullif(it->>'recargo','')::numeric,
      coalesce((it->>'unitario_venta_neto')::numeric,0), coalesce(it->'ficha','{}'::jsonb), coalesce((it->>'ficha_aprobada')::boolean, false));
  end loop;
  insert into public.cotizacion_versiones (cotizacion_id, version, contenido) values (v_id, v_ver, p - 'version');
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;
revoke all on function public.cz_guardar_cotizacion(jsonb) from public, anon;
grant execute on function public.cz_guardar_cotizacion(jsonb) to authenticated;
drop function if exists public.cz_guardar_cotizacion_v2(jsonb);

drop table if exists public.cotizacion_eliminaciones, public.cotizacion_vendedores;
drop function if exists public.cz_clave_nombre(text);
drop index if exists public.cotizaciones_estado, public.cotizaciones_actualizado;
alter table public.eett_documentos drop column if exists nombre_documento, drop column if exists vendedor_nombre, drop column if exists generado_por_nombre;
alter table public.cotizacion_items drop column if exists enlace_original;
alter table public.cotizaciones drop column if exists vendedor_id, drop column if exists vendedor_nombre, drop column if exists descripcion,
  drop column if exists unidad_compra, drop column if exists region, drop column if exists presupuesto_estimado,
  drop column if exists fecha_publicacion, drop column if exists fecha_cierre, drop column if exists requerimientos,
  drop column if exists documentos_mp, drop column if exists mp_consultado_en;
