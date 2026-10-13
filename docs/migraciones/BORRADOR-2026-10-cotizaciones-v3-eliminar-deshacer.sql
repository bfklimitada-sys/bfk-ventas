-- Deshace la v3: cz_eliminar_cotizacion vuelve exactamente a su definición v2.
create or replace function public.cz_eliminar_cotizacion(p_id uuid, p_confirmacion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare c public.cotizaciones%rowtype; v_res jsonb;
begin
  if not public.cz_es_admin() then raise exception 'CZ423: solo un administrador puede eliminar cotizaciones.' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = p_id for update;
  if not found then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
  if c.estado = 'adjudicada' or nullif(btrim(coalesce(c.oc_codigo,'')), '') is not null then
    raise exception 'CZ423: una cotización adjudicada o vinculada a una OC no se puede eliminar.' using errcode = '42501'; end if;
  if public.cz_clave_nombre(p_confirmacion) = '' or public.cz_clave_nombre(p_confirmacion) not in (public.cz_clave_nombre(c.id_externo), public.cz_clave_nombre(c.nombre)) then
    raise exception 'CZ423: la confirmación no coincide con el código ni con el nombre de la cotización.' using errcode = '22023'; end if;
  v_res := jsonb_build_object(
    'items', (select count(*) from public.cotizacion_items where cotizacion_id = p_id),
    'envios', (select count(*) from public.cotizacion_envios where cotizacion_id = p_id),
    'versiones', (select count(*) from public.cotizacion_versiones where cotizacion_id = p_id),
    'eett', (select coalesce(jsonb_agg(jsonb_build_object('version', version, 'fecha', fecha, 'hash', hash, 'ubicacion_pdf', ubicacion_pdf, 'generado_por', generado_por)), '[]') from public.eett_documentos where cotizacion_id = p_id),
    'version', c.version, 'subtotal_neto', c.subtotal_neto, 'creado_por', c.creado_por, 'fecha_creacion', c.fecha_creacion);
  insert into public.cotizacion_eliminaciones (cotizacion_id, id_externo, nombre, institucion, estado, resumen, eliminado_por_nombre)
  values (c.id, c.id_externo, c.nombre, c.institucion, c.estado, v_res, (select nombre from public.perfiles where id = auth.uid()));
  delete from public.eett_documentos where cotizacion_id = p_id;
  delete from public.cotizacion_versiones where cotizacion_id = p_id;
  delete from public.cotizacion_items where cotizacion_id = p_id;
  delete from public.cotizacion_envios where cotizacion_id = p_id;
  delete from public.cotizaciones where id = p_id;
  return jsonb_build_object('eliminada', p_id) || v_res;
end $$;

revoke all on function public.cz_eliminar_cotizacion(uuid,text) from public, anon;
grant execute on function public.cz_eliminar_cotizacion(uuid,text) to authenticated;
