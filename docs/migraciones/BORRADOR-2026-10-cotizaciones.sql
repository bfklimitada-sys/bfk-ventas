-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Módulo Cotizaciones y EETT (octubre 2026). NO APLICADO. Requiere autorización expresa de Kevin.
-- Una sola transacción: psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-cotizaciones.sql
-- Deshacer: BORRADOR-2026-10-cotizaciones-deshacer.sql
--
-- Solo CREA objetos nuevos (prefijo cz_ en funciones). No modifica ninguna tabla, fila, función ni política
-- existente: OCs, eventos, financiamiento/FIFO, IVA, F29, comisiones, banco y entidades quedan intactos.
-- La biblioteca, las cotizaciones y las EETT parten vacías (corte histórico: octubre 2026).
--
-- Tablas (adaptadas de la especificación al esquema real):
--   productos_catalogo ...... biblioteca compartida: SOLO datos técnicos (nada comercial).
--   cotizaciones ............ cabecera: ID Mercado Público, institución, RUT, entrega, plazo, estado, totales.
--   cotizacion_envios ....... envío por proveedor/pedido, con estado de verificación y evidencia.
--   cotizacion_items ........ línea: datos comerciales internos + ficha técnica aprobada (copia congelada).
--   cotizacion_versiones .... copia completa de cada guardado (versiones de la cotización).
--   eett_documentos ......... PDF generados: versión, ruta privada, huella SHA-256.
-- Escrituras: solo por funciones (RPC) que validan el perfil BFK; los clientes solo pueden LEER.
-- Borrado físico: no existe para usuarios; las cotizaciones se descartan por estado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.cotizaciones') is not null then raise exception 'CZ: el módulo ya existe; no se aplicó nada'; end if;
end $$;

-- Perfil BFK de la sesión (cualquier rol) y administrador.
create or replace function public.cz_es_usuario() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles where id = auth.uid())
$$;
create or replace function public.cz_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rol = 'admin' from public.perfiles where id = auth.uid()), false)
$$;

create table public.productos_catalogo (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) > 0),
  marca text, modelo text, color text,
  descripcion_tecnica text,
  caracteristicas jsonb not null default '[]'::jsonb check (jsonb_typeof(caracteristicas) = 'array'),   -- [{etiqueta, valor}] generales
  especificaciones jsonb not null default '[]'::jsonb check (jsonb_typeof(especificaciones) = 'array'), -- [{etiqueta, valor}]
  imagenes jsonb not null default '[]'::jsonb check (jsonb_typeof(imagenes) = 'array'),                 -- rutas del depósito privado "productos"
  fuente text,                       -- dominio de origen de los datos técnicos (p. ej. falabella.com); el enlace comercial va en la línea
  fecha_verificacion timestamptz,    -- fecha de la consulta al proveedor
  estado text not null default 'aprobado' check (estado in ('aprobado', 'archivado')),
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  revisado_por uuid, ultima_revision timestamptz not null default now()
);
create index productos_catalogo_busqueda on public.productos_catalogo using gin (to_tsvector('spanish', coalesce(nombre,'') || ' ' || coalesce(marca,'') || ' ' || coalesce(modelo,'')));

create table public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  id_externo text,                   -- ID Mercado Público (p. ej. 1525570-33-COT26)
  nombre text,                       -- nombre de la licitación / compra ágil
  institucion text, rut text,
  direccion_entrega text, comuna text,
  fecha date not null default current_date, plazo text, observaciones text,
  estado text not null default 'borrador' check (estado in ('borrador','lista','presentada','adjudicada','no_adjudicada','descartada')),
  recargo numeric not null default 0.30 check (recargo > -1 and recargo < 10),
  formula jsonb,                     -- fórmula usada en el cálculo guardado (base, redondeo, prorrateo)
  subtotal_neto numeric not null default 0, impuestos numeric not null default 0, total numeric not null default 0,
  costo_neto numeric not null default 0, iva_credito numeric not null default 0,
  oc_codigo text,                    -- vínculo posterior con la OC adjudicada (texto; no altera el flujo de OCs)
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), fecha_creacion timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);
create index cotizaciones_id_externo on public.cotizaciones (id_externo);

create table public.cotizacion_envios (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id),
  clave text not null,               -- clave estable usada por la interfaz para asignar líneas
  proveedor text, origen_publicacion text, destino text,
  monto numeric not null default 0 check (monto >= 0),
  con_factura boolean not null default true,
  cobertura text, fecha_cotizacion date,
  estado_confirmacion text not null default 'pendiente' check (estado_confirmacion in ('pendiente','confirmado','sin_costo_confirmado','no_despacha')),
  evidencia text,
  unique (cotizacion_id, clave)
);

create table public.cotizacion_items (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id),
  orden integer not null,
  producto_id uuid references public.productos_catalogo(id),
  envio_clave text,                  -- cotizacion_envios.clave
  enlace text, proveedor text, disponibilidad text, fecha_consulta timestamptz, origen_datos text,
  cantidad numeric not null check (cantidad > 0),
  precio_origen numeric not null default 0 check (precio_origen >= 0),
  precio_incluye_iva boolean not null default true, con_factura boolean not null default true,
  iva_compra numeric not null default 0, envio_asignado numeric not null default 0,
  costo_bruto numeric not null default 0, costo_neto numeric not null default 0,
  recargo numeric,                   -- null = recargo de la cotización
  unitario_venta_neto numeric not null default 0,
  especificaciones_aprobadas jsonb not null default '{}'::jsonb,  -- ficha técnica congelada (lo que va a la EETT)
  ficha_aprobada boolean not null default false,
  unique (cotizacion_id, orden)
);

create table public.cotizacion_versiones (
  cotizacion_id uuid not null references public.cotizaciones(id),
  version integer not null,
  contenido jsonb not null,
  guardado_por uuid not null default auth.uid(), guardado_en timestamptz not null default now(),
  primary key (cotizacion_id, version)
);

create table public.eett_documentos (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.cotizaciones(id),
  version integer not null,          -- versión de la cotización usada
  ubicacion_pdf text,                -- ruta en el depósito privado "eett"
  paginas integer, hash text check (hash is null or hash ~ '^[0-9a-f]{64}$'),
  estado text not null default 'generado' check (estado in ('generado','reemplazado')),
  fecha timestamptz not null default now(), generado_por uuid not null default auth.uid()
);

-- RLS: lectura para perfiles BFK; ninguna escritura directa (solo RPC). Nada visible para anónimos.
do $$ declare t text; begin
  foreach t in array array['productos_catalogo','cotizaciones','cotizacion_envios','cotizacion_items','cotizacion_versiones','eett_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.cz_es_usuario())', 'cz_leer_' || t, t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Guarda la cotización completa en una transacción (cabecera + envíos + líneas + copia de versión).
-- Control de concurrencia: p->>'version' debe coincidir con la versión guardada (si no, CZ409).
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

-- Agrega o actualiza un producto de la biblioteca (solo datos técnicos; cualquier clave comercial se descarta).
create or replace function public.cz_guardar_producto(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if v_id is null then
    insert into public.productos_catalogo (nombre, marca, modelo, color, descripcion_tecnica, caracteristicas, especificaciones, imagenes, fuente, fecha_verificacion, revisado_por)
    values (p->>'nombre', p->>'marca', p->>'modelo', p->>'color', p->>'descripcion', coalesce(p->'generales','[]'), coalesce(p->'especificaciones','[]'),
      coalesce(p->'imagenes','[]'), p->>'fuente', nullif(p->>'fecha_verificacion','')::timestamptz, auth.uid())
    returning id into v_id;
  else
    update public.productos_catalogo set nombre = p->>'nombre', marca = p->>'marca', modelo = p->>'modelo', color = p->>'color', descripcion_tecnica = p->>'descripcion',
      caracteristicas = coalesce(p->'generales','[]'), especificaciones = coalesce(p->'especificaciones','[]'), imagenes = coalesce(p->'imagenes','[]'),
      fuente = coalesce(p->>'fuente', fuente), fecha_verificacion = coalesce(nullif(p->>'fecha_verificacion','')::timestamptz, fecha_verificacion),
      revisado_por = auth.uid(), ultima_revision = now()
    where id = v_id and estado = 'aprobado';
    if not found then raise exception 'Producto no encontrado o archivado' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;

-- Archivar un producto de la biblioteca (solo administrador; no se borra).
create or replace function public.cz_archivar_producto(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.cz_es_admin() then raise exception 'Solo un administrador puede archivar productos' using errcode = '42501'; end if;
  update public.productos_catalogo set estado = 'archivado', revisado_por = auth.uid(), ultima_revision = now() where id = p_id;
end $$;

-- Registra un PDF EETT generado (las versiones anteriores quedan como "reemplazado").
create or replace function public.cz_registrar_eett(p_cotizacion uuid, p_version integer, p_ruta text, p_hash text, p_paginas integer) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  update public.eett_documentos set estado = 'reemplazado' where cotizacion_id = p_cotizacion and estado = 'generado';
  insert into public.eett_documentos (cotizacion_id, version, ubicacion_pdf, hash, paginas) values (p_cotizacion, p_version, p_ruta, p_hash, p_paginas) returning id into v_id;
  return v_id;
end $$;

do $$ declare f text; begin
  foreach f in array array['cz_es_usuario()','cz_es_admin()','cz_guardar_cotizacion(jsonb)','cz_guardar_producto(jsonb)','cz_archivar_producto(uuid)','cz_registrar_eett(uuid,integer,text,text,integer)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;

-- Depósitos privados (Supabase Storage): imágenes de la biblioteca y PDF EETT. Sin acceso público ni anónimo:
-- se leen con la sesión BFK y se comparten con enlaces firmados de duración limitada.
do $$ begin
  if to_regclass('storage.buckets') is null then raise notice 'CZ|SIN_STORAGE|'; return; end if;
  insert into storage.buckets (id, name, public) values ('productos', 'productos', false), ('eett', 'eett', false) on conflict (id) do nothing;
  execute $p$create policy cz_storage_leer on storage.objects for select to authenticated using (bucket_id in ('productos','eett') and public.cz_es_usuario())$p$;
  execute $p$create policy cz_storage_subir on storage.objects for insert to authenticated with check (bucket_id in ('productos','eett') and public.cz_es_usuario())$p$;
end $$;
