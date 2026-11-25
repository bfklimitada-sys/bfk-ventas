-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
-- DOCUMENTACIÓN DE LA OFERTA (25/11/2026, pedido de Kevin: «Mejora integral del módulo de Cotizaciones y EETT»).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-25-documentos-oferta.sql
-- Recuperación:                 BORRADOR-2026-11-25-documentos-oferta-deshacer.sql
--
-- Todo es NUEVO y ADITIVO: dos tablas y tres funciones. No modifica ninguna tabla, función, política ni dato existente
-- (cotizaciones, ítems, versiones, EETT emitidas, ventas privadas, OC, finanzas, comisiones, pagos).
--   · public.oferta_condiciones: condiciones comerciales de la oferta que no tienen campo propio (garantía, vigencia,
--       despacho, forma de pago, disponibilidad confirmada, tipo de días…) y la matriz de cumplimiento técnico, por
--       cotización (canal 'mp' = cotizaciones de Mercado Público, 'vp' = cotizaciones privadas). Sin valores por defecto.
--   · public.oferta_documentos: historial INALTERABLE de los documentos emitidos (cotización económica, EETT y oferta
--       consolidada): versión, modelo público congelado (lo que se imprimió, sin costos ni datos internos), generador,
--       huellas SHA-256 del modelo y del PDF, páginas, nombre del archivo, quién y cuándo. Los PDF no se suben: se vuelven a
--       generar idénticos desde el modelo congelado y la huella lo comprueba. Sin UPDATE ni DELETE (ni siquiera por RPC).
--   · oferta_guardar_condiciones(), oferta_emitir_documento(): únicas vías de escritura (security definer, con los
--       mismos permisos del módulo: perfil BFK para Mercado Público; responsable de la cotización para ventas privadas).
--   · Versión: la misma información emitida conserva su número en los tres documentos (COT_x_v1, EETT_x_v1, OFERTA_x_v1);
--       información distinta recibe el número siguiente. Emitir dos veces el mismo documento con la misma información
--       devuelve el registro existente (no duplica).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.oferta_documentos') is not null then raise exception 'La migración documentos-oferta ya está aplicada'; end if;
  if to_regprocedure('public.cz_es_usuario()') is null then raise exception 'Falta public.cz_es_usuario() (módulo Cotizaciones)'; end if;
  if to_regprocedure('public.vp_es_responsable_cot(uuid)') is null then raise exception 'Falta public.vp_es_responsable_cot(uuid) (Ventas privadas)'; end if;
end $$;

-- Permiso por canal (lectura y escritura): misma regla de cada módulo.
create function public.oferta_puede(p_canal text, p_cotizacion uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_canal
    when 'mp' then public.cz_es_usuario() and exists (select 1 from public.cotizaciones c where c.id = p_cotizacion)
    when 'vp' then public.vp_es_responsable_cot(p_cotizacion)
    else false end
$$;

create table public.oferta_condiciones (
  canal text not null check (canal in ('mp', 'vp')),
  cotizacion_id uuid not null,
  condiciones jsonb not null default '{}'::jsonb check (jsonb_typeof(condiciones) = 'object'),
  matriz jsonb not null default '[]'::jsonb check (jsonb_typeof(matriz) = 'array'),
  actualizado_por uuid not null default auth.uid(), actualizado_en timestamptz not null default now(),
  primary key (canal, cotizacion_id)
);
alter table public.oferta_condiciones enable row level security;
create policy oferta_condiciones_leer on public.oferta_condiciones for select to authenticated using (public.oferta_puede(canal, cotizacion_id));

create table public.oferta_documentos (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('mp', 'vp')),
  cotizacion_id uuid not null,
  tipo text not null check (tipo in ('cotizacion', 'eett', 'oferta')),
  version integer not null check (version > 0),
  modelo jsonb not null check (jsonb_typeof(modelo) = 'object'),
  generador text not null,
  huella_contenido text not null check (huella_contenido ~ '^[0-9a-f]{64}$'),  -- modelo sin número de versión
  huella_modelo text not null check (huella_modelo ~ '^[0-9a-f]{64}$'),
  huella_pdf text not null check (huella_pdf ~ '^[0-9a-f]{64}$'),
  paginas integer not null check (paginas > 0),
  nombre_archivo text not null,
  emitido_por uuid not null default auth.uid(), emitido_por_nombre text,
  emitido_en timestamptz not null default now(),
  unique (canal, cotizacion_id, tipo, version)
);
create index oferta_documentos_cotizacion on public.oferta_documentos (canal, cotizacion_id, emitido_en desc);
alter table public.oferta_documentos enable row level security;
create policy oferta_documentos_leer on public.oferta_documentos for select to authenticated using (public.oferta_puede(canal, cotizacion_id));

-- Sin escritura directa: solo las funciones. Los anónimos no ven nada.
revoke all on public.oferta_condiciones, public.oferta_documentos from anon, authenticated;
grant select on public.oferta_condiciones, public.oferta_documentos to authenticated;

create function public.oferta_guardar_condiciones(p_canal text, p_cotizacion uuid, p_condiciones jsonb, p_matriz jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if not public.oferta_puede(p_canal, p_cotizacion) then raise exception 'OFERTA_PERMISO: sin permiso sobre esta cotización' using errcode = '42501'; end if;
  if jsonb_typeof(coalesce(p_condiciones, '{}')) <> 'object' or jsonb_typeof(coalesce(p_matriz, '[]')) <> 'array' then
    raise exception 'OFERTA_FORMATO: condiciones o matriz con formato incorrecto' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(p_matriz, '[]')) e where coalesce(e->>'estado', 'por_verificar') not in ('cumple', 'no_cumple', 'por_verificar')) then
    raise exception 'OFERTA_FORMATO: estado de cumplimiento no válido' using errcode = '22023'; end if;
  insert into public.oferta_condiciones as c (canal, cotizacion_id, condiciones, matriz)
  values (p_canal, p_cotizacion, coalesce(p_condiciones, '{}'), coalesce(p_matriz, '[]'))
  on conflict (canal, cotizacion_id) do update set condiciones = excluded.condiciones, matriz = excluded.matriz, actualizado_por = auth.uid(), actualizado_en = now()
  returning c.actualizado_en into r;
  return jsonb_build_object('actualizado_en', r.actualizado_en);
end $$;

-- Emite un documento. p_version debe ser la que corresponde a esa información (la misma de una emisión anterior con la
-- misma huella de contenido, o la siguiente): si otra persona emitió entre medio, se rechaza (OFERTA_VERSION) y la app
-- regenera la vista previa. Repetir la misma emisión devuelve el registro existente.
create function public.oferta_emitir_documento(p_canal text, p_cotizacion uuid, p_tipo text, p_version integer, p_modelo jsonb, p_generador text,
  p_huella_contenido text, p_huella_modelo text, p_huella_pdf text, p_paginas integer, p_nombre text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_esperada integer; v_existente public.oferta_documentos; v_nombre text;
begin
  if not public.oferta_puede(p_canal, p_cotizacion) then raise exception 'OFERTA_PERMISO: sin permiso sobre esta cotización' using errcode = '42501'; end if;
  if p_tipo not in ('cotizacion', 'eett', 'oferta') then raise exception 'OFERTA_FORMATO: tipo de documento no válido' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtext('oferta:' || p_canal || ':' || p_cotizacion::text));
  select version into v_esperada from public.oferta_documentos where canal = p_canal and cotizacion_id = p_cotizacion and huella_contenido = p_huella_contenido order by version desc limit 1;
  if v_esperada is null then select coalesce(max(version), 0) + 1 into v_esperada from public.oferta_documentos where canal = p_canal and cotizacion_id = p_cotizacion; end if;
  if p_version is distinct from v_esperada then
    raise exception 'OFERTA_VERSION: corresponde la versión %, no la %. Vuelve a generar la vista previa.', v_esperada, p_version using errcode = '40001'; end if;
  if coalesce((p_modelo->>'version')::integer, -1) <> p_version then raise exception 'OFERTA_FORMATO: el modelo no corresponde a la versión' using errcode = '22023'; end if;
  select * into v_existente from public.oferta_documentos where canal = p_canal and cotizacion_id = p_cotizacion and tipo = p_tipo and version = p_version;
  if found then
    if v_existente.huella_modelo <> p_huella_modelo then raise exception 'OFERTA_VERSION: ya existe otro documento con esa versión' using errcode = '40001'; end if;
    return jsonb_build_object('id', v_existente.id, 'version', v_existente.version, 'existente', true, 'emitido_en', v_existente.emitido_en);
  end if;
  select nullif(btrim(p.nombre), '') into v_nombre from public.perfiles p where p.id = auth.uid();
  insert into public.oferta_documentos (canal, cotizacion_id, tipo, version, modelo, generador, huella_contenido, huella_modelo, huella_pdf, paginas, nombre_archivo, emitido_por_nombre)
  values (p_canal, p_cotizacion, p_tipo, p_version, p_modelo, p_generador, p_huella_contenido, p_huella_modelo, p_huella_pdf, p_paginas, p_nombre, v_nombre)
  returning * into v_existente;
  return jsonb_build_object('id', v_existente.id, 'version', v_existente.version, 'existente', false, 'emitido_en', v_existente.emitido_en);
end $$;

revoke all on function public.oferta_puede(text, uuid), public.oferta_guardar_condiciones(text, uuid, jsonb, jsonb),
  public.oferta_emitir_documento(text, uuid, text, integer, jsonb, text, text, text, text, integer, text) from public, anon;
grant execute on function public.oferta_puede(text, uuid), public.oferta_guardar_condiciones(text, uuid, jsonb, jsonb),
  public.oferta_emitir_documento(text, uuid, text, integer, jsonb, text, text, text, text, integer, text) to authenticated;

notify pgrst, 'reload schema';
commit;
