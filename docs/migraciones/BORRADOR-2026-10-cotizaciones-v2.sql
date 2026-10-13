-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR v2 — Módulo Cotizaciones y EETT (actualización definitiva, octubre 2026). NO APLICADO.
-- Requiere autorización expresa de Kevin. Una sola transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-cotizaciones-v2.sql
-- Deshacer: BORRADOR-2026-10-cotizaciones-v2-deshacer.sql
--
-- Requisito: el módulo v1 (BORRADOR-2026-10-cotizaciones.sql) ya instalado. Solo toca objetos del módulo:
--   · cotizaciones ........... columnas nuevas (vendedor responsable y datos de la Compra Ágil).
--   · cotizacion_items ....... columna enlace_original (referencia del primer enlace de compra).
--   · eett_documentos ........ columnas de metadatos (nombre del documento, vendedor, elaborador).
--   · cotizacion_vendedores .. tabla nueva: vendedores registrados desde Cotizaciones (la tabla "vendedores"
--                              de BFK, usada por comisiones, NO se modifica: solo se lee para evitar duplicados).
--   · cotizacion_eliminaciones tabla nueva: auditoría mínima de eliminaciones (quién y cuándo).
--   · funciones nuevas: cz_guardar_cotizacion_v2, cz_registrar_eett_v2, cz_registrar_vendedor, cz_eliminar_cotizacion.
--   · cz_guardar_cotizacion (v1) pasa a delegar en la v2 (mismas reglas, incluida la protección de adjudicadas).
--   · política de Storage cz_storage_subir: solo permite subir al depósito "cz-productos" (imágenes);
--     los PDF de EETT ya no se suben. Los PDF históricos del depósito "cz-eett" se conservan y siguen legibles.
-- No modifica OCs, eventos, financiamiento/FIFO, IVA, F29, comisiones, pagos, banco, entidades ni la tabla vendedores.
-- No borra datos: las columnas nuevas parten vacías y lo existente queda igual.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.cotizaciones') is null then raise exception 'CZ2: falta el módulo v1; no se aplicó nada'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name = 'vendedor_nombre') then
    raise exception 'CZ2: la actualización v2 ya existe; no se aplicó nada'; end if;
end $$;

alter table public.cotizaciones
  add column vendedor_id text,                       -- id de "vendedores" (BFK) o "cz:<uuid>" (cotizacion_vendedores)
  add column vendedor_nombre text,
  add column descripcion text,                       -- descripción publicada por el comprador
  add column unidad_compra text, add column region text,
  add column presupuesto_estimado numeric check (presupuesto_estimado is null or presupuesto_estimado >= 0), -- del comprador (referencial)
  add column fecha_publicacion timestamp, add column fecha_cierre timestamp,
  add column requerimientos jsonb not null default '[]'::jsonb check (jsonb_typeof(requerimientos) = 'array'), -- productos requeridos por el comprador
  add column documentos_mp jsonb not null default '[]'::jsonb check (jsonb_typeof(documentos_mp) = 'array'),   -- referencias a adjuntos
  add column mp_consultado_en timestamptz;
create index cotizaciones_estado on public.cotizaciones (estado);
create index cotizaciones_actualizado on public.cotizaciones (actualizado_en desc);

alter table public.cotizacion_items add column enlace_original text;
alter table public.eett_documentos add column nombre_documento text, add column vendedor_nombre text, add column generado_por_nombre text;

-- Clave de comparación de nombres (sin tildes, mayúsculas, espacios simples).
create or replace function public.cz_clave_nombre(t text) returns text
language sql immutable set search_path = public, pg_temp as $$
  -- Las tildes se quitan ANTES de upper(): con intercalación "C", upper() no convierte letras acentuadas.
  select regexp_replace(upper(translate(btrim(coalesce(t, '')), 'áéíóúüñàèìòùÁÉÍÓÚÜÑÀÈÌÒÙ', 'aeiouunaeiouAEIOUUNAEIOU')), '\s+', ' ', 'g')
$$;

create table public.cotizacion_vendedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 3 and 80),
  clave text not null unique,
  activo boolean not null default true,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now()
);
create table public.cotizacion_eliminaciones (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null, id_externo text, nombre text, institucion text, estado text,
  resumen jsonb not null default '{}'::jsonb,       -- conteos y metadatos de EETT (incluye rutas de PDF históricos, que se conservan)
  eliminado_por uuid not null default auth.uid(), eliminado_por_nombre text, eliminado_en timestamptz not null default now()
);
alter table public.cotizacion_vendedores enable row level security;
alter table public.cotizacion_eliminaciones enable row level security;
create policy cz_leer_cotizacion_vendedores on public.cotizacion_vendedores for select to authenticated using (public.cz_es_usuario());
create policy cz_leer_cotizacion_eliminaciones on public.cotizacion_eliminaciones for select to authenticated using (public.cz_es_admin());
revoke all on public.cotizacion_vendedores, public.cotizacion_eliminaciones from anon;
revoke insert, update, delete, truncate on public.cotizacion_vendedores, public.cotizacion_eliminaciones from authenticated;
grant select on public.cotizacion_vendedores, public.cotizacion_eliminaciones to authenticated;

-- Guarda la cotización completa (cabecera + envíos + líneas + copia de versión), con control de concurrencia.
-- Adjudicada: lo ofertado queda protegido (mismas líneas, cantidades y unitarios) y el vínculo con la OC solo lo
-- cambia un administrador. Enlaces de compra y fichas técnicas sí se pueden actualizar.
-- Claves ausentes en p conservan el valor guardado (compatibilidad con clientes anteriores).
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
      select coalesce(jsonb_agg(jsonb_build_array(cantidad, unitario_venta_neto) order by orden), '[]') into v_ofertado from public.cotizacion_items where cotizacion_id = v_id;
      select coalesce(jsonb_agg(jsonb_build_array((x->>'cantidad')::numeric, coalesce((x->>'unitario_venta_neto')::numeric,0)) order by o), '[]') into v_nuevo
        from jsonb_array_elements(p->'items') with ordinality as t(x, o);
      if v_ofertado <> v_nuevo then
        raise exception 'CZ423: la cotización está adjudicada: los productos, cantidades y precios ofertados no se pueden modificar.' using errcode = '42501'; end if;
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
    insert into public.cotizacion_items (cotizacion_id, orden, producto_id, envio_clave, enlace, enlace_original, proveedor, disponibilidad, fecha_consulta, origen_datos, cantidad, precio_origen,
      precio_incluye_iva, con_factura, iva_compra, envio_asignado, costo_bruto, costo_neto, recargo, unitario_venta_neto, especificaciones_aprobadas, ficha_aprobada)
    values (v_id, n, nullif(it->>'producto_id','')::uuid, nullif(it->>'envio_key',''), it->>'enlace', nullif(it->>'enlace_original',''), it->>'proveedor', it->>'disponibilidad', nullif(it->>'fecha_consulta','')::timestamptz,
      it->>'origen_datos', (it->>'cantidad')::numeric, coalesce(nullif(it->>'precio_origen','')::numeric,0), coalesce((it->>'precio_incluye_iva')::boolean, true),
      coalesce((it->>'con_factura')::boolean, true), coalesce((it->>'iva_compra')::numeric,0), coalesce((it->>'envio_asignado')::numeric,0),
      coalesce((it->>'costo_bruto')::numeric,0), coalesce((it->>'costo_neto')::numeric,0), nullif(it->>'recargo','')::numeric,
      coalesce((it->>'unitario_venta_neto')::numeric,0), coalesce(it->'ficha','{}'::jsonb), coalesce((it->>'ficha_aprobada')::boolean, false));
  end loop;
  insert into public.cotizacion_versiones (cotizacion_id, version, contenido) values (v_id, v_ver, p - 'version');
  return jsonb_build_object('id', v_id, 'version', v_ver);
end $$;

-- La función v1 queda como alias de la v2 (mismas reglas para cualquier cliente).
create or replace function public.cz_guardar_cotizacion(p jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public.cz_guardar_cotizacion_v2(p) $$;

-- Registra SOLO metadatos de una EETT descargada (el PDF no se guarda en el servidor).
-- p: { cotizacion_id, version, hash, paginas, nombre_documento }. Usuario, nombre del elaborador, vendedor y fecha
-- se toman del servidor (cuenta autenticada y cotización), no del navegador.
create or replace function public.cz_registrar_eett_v2(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; c public.cotizaciones%rowtype; v_ver integer := (p->>'version')::integer;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = nullif(p->>'cotizacion_id','')::uuid;
  if not found then raise exception 'Cotización no encontrada' using errcode = 'P0002'; end if;
  if v_ver is null or v_ver < 1 or v_ver > c.version then raise exception 'Versión de cotización inválida' using errcode = '22023'; end if;
  update public.eett_documentos set estado = 'reemplazado' where cotizacion_id = c.id and estado = 'generado';
  insert into public.eett_documentos (cotizacion_id, version, ubicacion_pdf, hash, paginas, nombre_documento, vendedor_nombre, generado_por_nombre)
  values (c.id, v_ver, null, nullif(p->>'hash',''), nullif(p->>'paginas','')::integer, left(nullif(p->>'nombre_documento',''), 200), c.vendedor_nombre,
    (select nombre from public.perfiles where id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

-- Registra un vendedor desde Cotizaciones, sin duplicar ni el catálogo existente de BFK ni los ya registrados.
create or replace function public.cz_registrar_vendedor(p_nombre text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_nombre text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g'); v_clave text; v_id uuid;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if length(v_nombre) < 3 or length(v_nombre) > 80 then raise exception 'El nombre del vendedor debe tener entre 3 y 80 caracteres' using errcode = '22023'; end if;
  v_clave := public.cz_clave_nombre(v_nombre);
  if exists (select 1 from public.vendedores where public.cz_clave_nombre(nombre) = v_clave)
     or exists (select 1 from public.cotizacion_vendedores where clave = v_clave) then
    raise exception 'Ese vendedor ya está registrado: elígelo de la lista.' using errcode = '23505'; end if;
  insert into public.cotizacion_vendedores (nombre, clave) values (v_nombre, v_clave) returning id into v_id;
  return jsonb_build_object('id', v_id, 'nombre', v_nombre);
end $$;

-- Elimina una cotización y SOLO sus registros asociados (líneas, envíos, versiones y registros de EETT).
-- Solo administradores; exige escribir el código o el nombre; bloqueada si está adjudicada o tiene OC vinculada.
-- No toca la biblioteca, las imágenes, los PDF almacenados ni ningún otro módulo. Deja auditoría.
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

do $$ declare f text; begin
  foreach f in array array['cz_clave_nombre(text)','cz_guardar_cotizacion_v2(jsonb)','cz_guardar_cotizacion(jsonb)','cz_registrar_eett_v2(jsonb)','cz_registrar_vendedor(text)','cz_eliminar_cotizacion(uuid,text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- Storage: ya no se suben PDF (solo imágenes al depósito "cz-productos"). Lectura sin cambios.
do $$ begin
  if to_regclass('storage.objects') is null then raise notice 'CZ2|SIN_STORAGE|'; return; end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'cz_storage_subir') then
    raise exception 'CZ2: no existe la política cz_storage_subir del módulo v1; no se aplicó nada'; end if;
  drop policy cz_storage_subir on storage.objects;
  execute $p$create policy cz_storage_subir on storage.objects for insert to authenticated with check (bucket_id = 'cz-productos' and public.cz_es_usuario())$p$;
end $$;
