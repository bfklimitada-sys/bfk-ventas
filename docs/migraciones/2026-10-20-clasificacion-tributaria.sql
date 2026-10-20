-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Ventas exentas, fase 2: clasificación tributaria respaldada (20/10/2026). NO APLICADO.
-- Requiere autorización expresa de Kevin. Una sola transacción (lo hace seg/instalar.sql con huella):
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-10-20-clasificacion-tributaria.sql
-- Deshacer: BORRADOR-2026-10-20-clasificacion-tributaria-deshacer.sql (solo si no hay clasificaciones).
--
-- ADITIVA. Qué agrega:
--   · cotizaciones y ordenes_compra_v2: 6 columnas NULAS (tratamiento vigente y aprobado). Nula = afecta histórica.
--     Ninguna fila existente se modifica; ninguna columna existente cambia.
--   · trib_clasificaciones: historial de solicitudes y aprobaciones (respaldo, fundamento, quién y cuándo).
--   · Disparadores trib_proteger_*: ninguna escritura que llegue por la API (app, sincronización con Mercado Público,
--     funciones de cotización) puede cambiar esas columnas; solo las funciones trib_* (aprobación de un administrador).
--   · Funciones trib_*: solicitar, resolver (aprobar/rechazar), anular solicitud y heredar desde la cotización adjudicada.
--   · cz_guardar_cotizacion_v2: igual que hoy, más (a) ignora cualquier intento del cliente de fijar la clasificación y
--     (b) guarda en cada versión la clasificación vigente.
--   · Depósito privado de Storage «trib-respaldos» (documentos de respaldo; sin borrar ni reemplazar). OBLIGATORIO:
--     si no se puede crear y verificar (privado, límites, RLS, solo sus dos políticas), toda la migración se revierte.
-- NO toca: fórmulas de cotización, facturas (tipo_dte), F29/IVA mensual, comisiones, costos, financiamiento, FIFO,
-- conciliación, pagos ni datos existentes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.cotizaciones') is null or to_regprocedure('public.cz_guardar_cotizacion_v2(jsonb)') is null then
    raise exception 'TRIB: falta el módulo de cotizaciones v2; no se aplicó nada'; end if;
  if to_regprocedure('public.fin_facturas_vigentes(text)') is null or to_regprocedure('public.fin_historial(text,text,text,text,text)') is null then
    raise exception 'TRIB: falta el modelo tributario (fin_facturas_vigentes / fin_historial); no se aplicó nada'; end if;
  if to_regclass('public.trib_clasificaciones') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and column_name = 'tratamiento_iva') then
    raise exception 'TRIB: la clasificación tributaria ya existe; no se aplicó nada'; end if;
end $$;

-- ── 1. Historial de clasificaciones (fuente de verdad, nunca se borra) ─────────────────────────
create table public.trib_clasificaciones (
  id uuid primary key default gen_random_uuid(),
  ambito text not null check (ambito in ('cotizacion', 'oc')),
  cotizacion_id uuid,                       -- sin clave foránea: el respaldo se conserva aunque se elimine la cotización
  oc_id text,                               -- sin clave foránea: idem para la OC
  codigo text,                              -- copia del código (id Mercado Público de la cotización / número de OC)
  tratamiento text not null check (tratamiento in ('afecta', 'exenta_fora', 'exenta_otra')),
  tratamiento_anterior text,                -- vigente al solicitar (nulo = afecta histórica)
  fundamento_legal text,                    -- p. ej. «Art. 101 Ley 18.948 (FO.R.A.)»
  respaldo_descripcion text,                -- qué acredita el respaldo (certificado, resolución, mención en la OC)
  respaldo_documento text,                  -- ruta en Storage «trib-respaldos», enlace o folio del documento
  respaldo_sha256 text check (respaldo_sha256 is null or respaldo_sha256 ~ '^[0-9a-f]{64}$'),
  motivo text,                              -- por qué se pide
  procedimiento_documental text,            -- obligatorio si la OC ya tiene documentos SII (p. ej. «NC 72 anula factura 3301»)
  origen text not null default 'manual' check (origen in ('manual', 'cotizacion')),
  origen_clasificacion_id uuid references public.trib_clasificaciones(id),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada', 'anulada', 'reemplazada')),
  solicitado_por uuid not null default auth.uid(), solicitado_por_nombre text, solicitado_en timestamptz not null default now(),
  resuelto_por uuid, resuelto_por_nombre text, resuelto_en timestamptz, observacion_resolucion text,
  constraint trib_objetivo_unico check ((ambito = 'cotizacion' and cotizacion_id is not null and oc_id is null)
                                     or (ambito = 'oc' and oc_id is not null and cotizacion_id is null)),
  constraint trib_exenta_respaldada check (tratamiento = 'afecta' or (
      length(btrim(coalesce(fundamento_legal, ''))) >= 10 and length(btrim(coalesce(respaldo_descripcion, ''))) >= 10
      and length(btrim(coalesce(respaldo_documento, ''))) >= 3)),
  constraint trib_resolucion_completa check (estado = 'pendiente' or estado = 'anulada' or (resuelto_por is not null and resuelto_en is not null)),
  constraint trib_rechazo_fundado check (estado <> 'rechazada' or length(btrim(coalesce(observacion_resolucion, ''))) >= 5)
);
create unique index trib_una_pendiente_cot on public.trib_clasificaciones (cotizacion_id) where estado = 'pendiente' and ambito = 'cotizacion';
create unique index trib_una_pendiente_oc on public.trib_clasificaciones (oc_id) where estado = 'pendiente' and ambito = 'oc';
create unique index trib_una_aprobada_cot on public.trib_clasificaciones (cotizacion_id) where estado = 'aprobada' and ambito = 'cotizacion';
create unique index trib_una_aprobada_oc on public.trib_clasificaciones (oc_id) where estado = 'aprobada' and ambito = 'oc';
create index trib_por_oc on public.trib_clasificaciones (oc_id);
create index trib_por_cotizacion on public.trib_clasificaciones (cotizacion_id);

alter table public.trib_clasificaciones enable row level security;
create policy trib_leer_clasificaciones on public.trib_clasificaciones for select to authenticated using (public.cz_es_usuario());
revoke all on public.trib_clasificaciones from anon, authenticated, public;
grant select on public.trib_clasificaciones to authenticated;

-- ── 2. Columnas vigentes (copia de la clasificación aprobada; nulas = afecta histórica) ──────────
alter table public.cotizaciones
  add column tratamiento_iva text,
  add column fundamento_iva text,
  add column respaldo_iva text,
  add column tratamiento_aprobado_por uuid,
  add column tratamiento_aprobado_en timestamptz,
  add column clasificacion_id uuid;
alter table public.ordenes_compra_v2
  add column tratamiento_iva text,
  add column fundamento_iva text,
  add column respaldo_iva text,
  add column tratamiento_aprobado_por uuid,
  add column tratamiento_aprobado_en timestamptz,
  add column clasificacion_id uuid;
-- Valores permitidos y respaldo obligatorio para exenciones. Todas las filas actuales tienen las columnas nulas.
alter table public.cotizaciones add constraint cotizaciones_tratamiento_iva_chk check (
  tratamiento_iva is null or (tratamiento_iva in ('afecta', 'exenta_fora', 'exenta_otra') and clasificacion_id is not null
    and tratamiento_aprobado_por is not null and tratamiento_aprobado_en is not null
    and (tratamiento_iva = 'afecta' or (nullif(btrim(fundamento_iva), '') is not null and nullif(btrim(respaldo_iva), '') is not null))));
alter table public.ordenes_compra_v2 add constraint ordenes_tratamiento_iva_chk check (
  tratamiento_iva is null or (tratamiento_iva in ('afecta', 'exenta_fora', 'exenta_otra') and clasificacion_id is not null
    and tratamiento_aprobado_por is not null and tratamiento_aprobado_en is not null
    and (tratamiento_iva = 'afecta' or (nullif(btrim(fundamento_iva), '') is not null and nullif(btrim(respaldo_iva), '') is not null))));

-- ── 3. Protección: solo las funciones trib_* cambian la clasificación ───────────────────────────
-- Cualquier escritura que llegue por la API (sesión con claims de PostgREST, o rol authenticated/anon), incluida la
-- sincronización con Mercado Público y cz_guardar_cotizacion_v2, conserva los valores guardados (en un INSERT, nulos).
-- Las funciones trib_* marcan la transacción con bfk.trib_rpc = '1'. Las restauraciones de respaldo por conexión
-- directa (sin claims) quedan intactas.
create or replace function public.trib_escritura_api() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), nullif(current_setting('request.jwt.claim.sub', true), ''),
                  nullif(current_setting('request.method', true), '')) is not null
      or current_user in ('authenticated', 'anon')
      or public.fin_es_importacion()
$$;
create or replace function public.trib_proteger_columnas() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('bfk.trib_rpc', true), '') = '1' or not public.trib_escritura_api() then return new; end if;
  if tg_op = 'INSERT' then
    new.tratamiento_iva := null; new.fundamento_iva := null; new.respaldo_iva := null;
    new.tratamiento_aprobado_por := null; new.tratamiento_aprobado_en := null; new.clasificacion_id := null;
  else
    new.tratamiento_iva := old.tratamiento_iva; new.fundamento_iva := old.fundamento_iva; new.respaldo_iva := old.respaldo_iva;
    new.tratamiento_aprobado_por := old.tratamiento_aprobado_por; new.tratamiento_aprobado_en := old.tratamiento_aprobado_en;
    new.clasificacion_id := old.clasificacion_id;
  end if;
  return new;
end $$;
create trigger trib_proteger_cotizacion before insert or update on public.cotizaciones
  for each row execute function public.trib_proteger_columnas();
create trigger trib_proteger_oc before insert or update on public.ordenes_compra_v2
  for each row execute function public.trib_proteger_columnas();

-- ── 4. Reglas de compatibilidad ─────────────────────────────────────────────────────────────
-- Código de OC normalizado igual que el índice único idx_numero_oc_unico.
create or replace function public.trib_codigo_oc(t text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select upper(regexp_replace(regexp_replace(coalesce(t, ''), '^[Nn][ºo°]\s*', ''), '[^A-Za-z0-9]', '', 'g'))
$$;
-- Devuelve el motivo de bloqueo (texto) o null si el cambio de tratamiento es compatible.
create or replace function public.trib_motivo_incompatible(p_ambito text, p_cot uuid, p_oc text, p_tratamiento text, p_procedimiento text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare o public.ordenes_compra_v2%rowtype; c public.cotizaciones%rowtype; v_af text; v_ex text; v_iva numeric; v_docs integer;
begin
  if p_ambito = 'oc' then
    select * into o from public.ordenes_compra_v2 where id = p_oc;
    if not found then return 'OC no encontrada'; end if;
    if o.archivada then return 'La OC está archivada.'; end if;
    select string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where coalesce(tipo_dte, 33) = 33),
           string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where tipo_dte = 34)
      into v_af, v_ex from public.fin_facturas_vigentes(p_oc);
    -- Documentos vigentes incompatibles: primero se corrige el documento (nota de crédito código 1), después la clasificación.
    if p_tratamiento <> 'afecta' and v_af is not null then
      return format('La OC tiene factura afecta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como exenta.', v_af); end if;
    if p_tratamiento = 'afecta' and v_ex is not null then
      return format('La OC tiene factura exenta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como afecta.', v_ex); end if;
    select count(*) into v_docs from public.eventos_factura where oc_id = p_oc;
    if v_docs > 0 and length(btrim(coalesce(p_procedimiento, ''))) < 10 then
      return 'La OC ya tiene documentos SII: describe el procedimiento documental (notas de crédito y facturas que respaldan el cambio).'; end if;
    -- Mercado Público como verificación (nunca como autorización): impuestos > 0 contradicen una exención.
    select nullif(datos ->> 'iva', '')::numeric into v_iva from public.mp_cache_avisos where id = 'oc_mp:' || p_oc and jsonb_typeof(datos) = 'object';
    if p_tratamiento <> 'afecta' and coalesce(v_iva, 0) > 0 then
      return format('Mercado Público informa impuestos de $%s en esta OC: no corresponde una exención.', v_iva); end if;
    return null;
  end if;
  select * into c from public.cotizaciones where id = p_cot;
  if not found then return 'Cotización no encontrada'; end if;
  -- Una OC ya clasificada a partir de esta cotización se corrige en la OC, no aquí.
  if exists (select 1 from public.trib_clasificaciones h join public.trib_clasificaciones hc on hc.id = h.origen_clasificacion_id
              where h.ambito = 'oc' and h.estado = 'aprobada' and hc.cotizacion_id = p_cot) then
    return 'Una OC ya heredó la clasificación de esta cotización: el cambio se hace en la OC.'; end if;
  return null;
end $$;

-- ── 5. Funciones (las únicas que escriben la clasificación) ─────────────────────────────────
-- Solicitar (cualquier perfil BFK). p: { ambito, cotizacion_id | oc_id, tratamiento, fundamento_legal, respaldo_descripcion,
-- respaldo_documento, respaldo_sha256, motivo, procedimiento_documental }. Queda PENDIENTE hasta que un administrador resuelva.
create or replace function public.trib_solicitar_clasificacion(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_amb text := p->>'ambito'; v_cot uuid; v_oc text := nullif(btrim(coalesce(p->>'oc_id', '')), ''); v_trat text := p->>'tratamiento';
  v_actual text; v_codigo text; v_motivo text; v_id uuid;
begin
  if not public.cz_es_usuario() then raise exception 'TRIB: usuario sin perfil BFK' using errcode = '42501'; end if;
  if v_amb not in ('cotizacion', 'oc') then raise exception 'TRIB: ámbito inválido' using errcode = '22023'; end if;
  if v_trat is null or v_trat not in ('afecta', 'exenta_fora', 'exenta_otra') then raise exception 'TRIB: tratamiento inválido' using errcode = '22023'; end if;
  if v_amb = 'cotizacion' then
    v_cot := nullif(p->>'cotizacion_id', '')::uuid; v_oc := null;
    select tratamiento_iva, id_externo into v_actual, v_codigo from public.cotizaciones where id = v_cot;
    if not found then raise exception 'TRIB: cotización no encontrada' using errcode = 'P0002'; end if;
  else
    select tratamiento_iva, numero_oc into v_actual, v_codigo from public.ordenes_compra_v2 where id = v_oc;
    if not found then raise exception 'TRIB: OC no encontrada' using errcode = 'P0002'; end if;
  end if;
  if coalesce(v_actual, 'afecta') = v_trat then raise exception 'TRIB: ese ya es el tratamiento vigente' using errcode = '22023'; end if;
  v_motivo := public.trib_motivo_incompatible(v_amb, v_cot, v_oc, v_trat, p->>'procedimiento_documental');
  if v_motivo is not null then raise exception 'TRIB423: %', v_motivo using errcode = '42501'; end if;
  insert into public.trib_clasificaciones (ambito, cotizacion_id, oc_id, codigo, tratamiento, tratamiento_anterior, fundamento_legal,
      respaldo_descripcion, respaldo_documento, respaldo_sha256, motivo, procedimiento_documental, solicitado_por_nombre)
  values (v_amb, v_cot, v_oc, v_codigo, v_trat, v_actual, nullif(btrim(p->>'fundamento_legal'), ''), nullif(btrim(p->>'respaldo_descripcion'), ''),
      nullif(btrim(p->>'respaldo_documento'), ''), nullif(lower(btrim(p->>'respaldo_sha256')), ''), nullif(btrim(p->>'motivo'), ''),
      nullif(btrim(p->>'procedimiento_documental'), ''), (select nombre from public.perfiles where id = auth.uid()))
  returning id into v_id;
  if v_amb = 'oc' then perform public.fin_historial(v_oc, 'Clasificación tributaria solicitada', 'tratamiento_iva', coalesce(v_actual, 'afecta (histórica)'), v_trat); end if;
  return jsonb_build_object('id', v_id, 'estado', 'pendiente');
end $$;

-- Resolver (solo administrador): 'aprobar' copia la clasificación a la cotización/OC; 'rechazar' exige observación.
-- Vuelve a validar la compatibilidad con la fila bloqueada (FOR UPDATE), por si cambió algo desde la solicitud.
create or replace function public.trib_resolver_clasificacion(p_id uuid, p_decision text, p_observacion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare h public.trib_clasificaciones%rowtype; v_uid uuid := auth.uid(); v_nombre text; v_motivo text; v_actual text; v_resp text;
begin
  if not public.cz_es_admin() then raise exception 'TRIB423: solo un administrador aprueba o rechaza clasificaciones tributarias.' using errcode = '42501'; end if;
  if p_decision not in ('aprobar', 'rechazar') then raise exception 'TRIB: decisión inválida' using errcode = '22023'; end if;
  select * into h from public.trib_clasificaciones where id = p_id for update;
  if not found then raise exception 'TRIB: solicitud no encontrada' using errcode = 'P0002'; end if;
  if h.estado <> 'pendiente' then raise exception 'TRIB: la solicitud ya está %', h.estado using errcode = '22023'; end if;
  select nombre into v_nombre from public.perfiles where id = v_uid;
  if p_decision = 'rechazar' then
    update public.trib_clasificaciones set estado = 'rechazada', resuelto_por = v_uid, resuelto_por_nombre = v_nombre, resuelto_en = now(),
      observacion_resolucion = nullif(btrim(p_observacion), '') where id = p_id;
    if h.ambito = 'oc' then perform public.fin_historial(h.oc_id, 'Clasificación tributaria rechazada', 'tratamiento_iva', null, h.tratamiento); end if;
    return jsonb_build_object('id', p_id, 'estado', 'rechazada');
  end if;
  -- Bloquear la cotización/OC y comprobar que nada cambió desde la solicitud.
  if h.ambito = 'cotizacion' then select tratamiento_iva into v_actual from public.cotizaciones where id = h.cotizacion_id for update;
  else select tratamiento_iva into v_actual from public.ordenes_compra_v2 where id = h.oc_id for update; end if;
  if not found then raise exception 'TRIB: la % ya no existe', h.ambito using errcode = 'P0002'; end if;
  if v_actual is distinct from h.tratamiento_anterior then
    raise exception 'TRIB409: el tratamiento vigente cambió desde la solicitud; se debe solicitar de nuevo.' using errcode = '40001'; end if;
  v_motivo := public.trib_motivo_incompatible(h.ambito, h.cotizacion_id, h.oc_id, h.tratamiento, h.procedimiento_documental);
  if v_motivo is not null then raise exception 'TRIB423: %', v_motivo using errcode = '42501'; end if;
  update public.trib_clasificaciones set estado = 'reemplazada'
   where estado = 'aprobada' and ambito = h.ambito and coalesce(cotizacion_id::text, oc_id) = coalesce(h.cotizacion_id::text, h.oc_id);
  update public.trib_clasificaciones set estado = 'aprobada', resuelto_por = v_uid, resuelto_por_nombre = v_nombre, resuelto_en = now(),
    observacion_resolucion = nullif(btrim(p_observacion), '') where id = p_id;
  v_resp := nullif(concat_ws(' · ', h.respaldo_descripcion, h.respaldo_documento), '');
  perform set_config('bfk.trib_rpc', '1', true);
  if h.ambito = 'cotizacion' then
    update public.cotizaciones set tratamiento_iva = h.tratamiento, fundamento_iva = h.fundamento_legal, respaldo_iva = v_resp,
      tratamiento_aprobado_por = v_uid, tratamiento_aprobado_en = now(), clasificacion_id = h.id where id = h.cotizacion_id;
  else
    update public.ordenes_compra_v2 set tratamiento_iva = h.tratamiento, fundamento_iva = h.fundamento_legal, respaldo_iva = v_resp,
      tratamiento_aprobado_por = v_uid, tratamiento_aprobado_en = now(), clasificacion_id = h.id where id = h.oc_id;
    perform public.fin_historial(h.oc_id, 'Clasificación tributaria aprobada', 'tratamiento_iva', coalesce(h.tratamiento_anterior, 'afecta (histórica)'), h.tratamiento);
  end if;
  perform set_config('bfk.trib_rpc', '', true);
  return jsonb_build_object('id', p_id, 'estado', 'aprobada', 'tratamiento', h.tratamiento);
end $$;

-- Anular una solicitud pendiente (quien la hizo o un administrador). No cambia la clasificación vigente.
create or replace function public.trib_anular_solicitud(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare h public.trib_clasificaciones%rowtype;
begin
  if not public.cz_es_usuario() then raise exception 'TRIB: usuario sin perfil BFK' using errcode = '42501'; end if;
  select * into h from public.trib_clasificaciones where id = p_id for update;
  if not found then raise exception 'TRIB: solicitud no encontrada' using errcode = 'P0002'; end if;
  if h.estado <> 'pendiente' then raise exception 'TRIB: solo se anula una solicitud pendiente' using errcode = '22023'; end if;
  if h.solicitado_por <> auth.uid() and not public.cz_es_admin() then raise exception 'TRIB423: solo quien la pidió o un administrador la anula' using errcode = '42501'; end if;
  update public.trib_clasificaciones set estado = 'anulada', resuelto_por = auth.uid(), resuelto_en = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'estado', 'anulada');
end $$;

-- Vínculo cotización adjudicada → OC: NUNCA automático. Crea una solicitud PENDIENTE en la OC con el mismo tratamiento,
-- fundamento y respaldo de la clasificación APROBADA de la cotización. Requisitos: cotización adjudicada, su oc_codigo
-- coincide (normalizado) con el número de la OC, una sola cotización vinculada, y las mismas reglas de compatibilidad.
create or replace function public.trib_heredar_de_cotizacion(p_oc_id text, p_procedimiento text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.ordenes_compra_v2%rowtype; v_n integer; v_cot uuid; hc public.trib_clasificaciones%rowtype; v_res jsonb; v_id uuid;
begin
  if not public.cz_es_usuario() then raise exception 'TRIB: usuario sin perfil BFK' using errcode = '42501'; end if;
  select * into o from public.ordenes_compra_v2 where id = p_oc_id;
  if not found then raise exception 'TRIB: OC no encontrada' using errcode = 'P0002'; end if;
  select count(*), min(id::text)::uuid into v_n, v_cot from public.cotizaciones
   where estado = 'adjudicada' and public.trib_codigo_oc(oc_codigo) <> '' and public.trib_codigo_oc(oc_codigo) = public.trib_codigo_oc(o.numero_oc);
  if v_n = 0 then raise exception 'TRIB423: ninguna cotización adjudicada está vinculada a la OC %', o.numero_oc using errcode = '42501'; end if;
  if v_n > 1 then raise exception 'TRIB423: hay % cotizaciones adjudicadas vinculadas a la OC %; corrige el vínculo primero', v_n, o.numero_oc using errcode = '42501'; end if;
  select h.* into hc from public.trib_clasificaciones h join public.cotizaciones c on c.clasificacion_id = h.id
   where c.id = v_cot and h.estado = 'aprobada';
  if not found then raise exception 'TRIB423: la cotización vinculada no tiene una clasificación tributaria aprobada' using errcode = '42501'; end if;
  v_res := public.trib_solicitar_clasificacion(jsonb_build_object('ambito', 'oc', 'oc_id', p_oc_id, 'tratamiento', hc.tratamiento,
    'fundamento_legal', hc.fundamento_legal, 'respaldo_descripcion', hc.respaldo_descripcion, 'respaldo_documento', hc.respaldo_documento,
    'respaldo_sha256', hc.respaldo_sha256, 'motivo', 'Heredada de la cotización adjudicada ' || coalesce(hc.codigo, v_cot::text),
    'procedimiento_documental', p_procedimiento));
  v_id := (v_res->>'id')::uuid;
  update public.trib_clasificaciones set origen = 'cotizacion', origen_clasificacion_id = hc.id where id = v_id;
  return v_res || jsonb_build_object('origen_clasificacion_id', hc.id);
end $$;

-- ── 6. cz_guardar_cotizacion_v2: sin cambios de reglas, más protección y trazabilidad de la clasificación ───
-- Idéntica a la versión en producción salvo los dos bloques marcados «TRIB».
create or replace function public.cz_guardar_cotizacion_v2(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ver integer; c public.cotizaciones%rowtype; e jsonb; it jsonb; n integer := 0;
  v_ofertado jsonb; v_nuevo jsonb; v_trib jsonb;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_typeof(p->'envios') is distinct from 'array' then
    raise exception 'Formato inválido' using errcode = '22023'; end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'Máximo 200 productos por cotización' using errcode = '22023'; end if;
  v_id := nullif(p->>'id', '')::uuid;
  -- TRIB (1/2): la clasificación tributaria NUNCA se guarda por esta función, aunque el cliente envíe esas claves
  -- (la app envía la cotización completa que leyó). Se ignoran: el INSERT y el UPDATE no incluyen esas columnas y,
  -- además, el disparador trib_proteger_cotizacion conserva lo aprobado. Solo trib_resolver_clasificacion las escribe.
  p := p - 'tratamiento_iva' - 'fundamento_iva' - 'respaldo_iva' - 'tratamiento_aprobado_por' - 'tratamiento_aprobado_en' - 'clasificacion_id';
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
  -- TRIB (2/2): cada versión registra la clasificación vigente (nula = afecta histórica) junto al contenido guardado.
  select jsonb_build_object('tratamiento_iva', tratamiento_iva, 'clasificacion_id', clasificacion_id) into v_trib from public.cotizaciones where id = v_id;
  insert into public.cotizacion_versiones (cotizacion_id, version, contenido)
  values (v_id, v_ver, (p - 'version') || jsonb_build_object('_clasificacion_tributaria', v_trib));
  return jsonb_build_object('id', v_id, 'version', v_ver, 'tratamiento_iva', v_trib->'tratamiento_iva');
end $$;

-- ── 7. Permisos ─────────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['trib_solicitar_clasificacion(jsonb)', 'trib_resolver_clasificacion(uuid,text,text)', 'trib_anular_solicitud(uuid)',
                           'trib_heredar_de_cotizacion(text,text)', 'trib_motivo_incompatible(text,uuid,text,text,text)', 'cz_guardar_cotizacion_v2(jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  -- Funciones internas: sin ejecución por la API.
  foreach f in array array['trib_escritura_api()', 'trib_proteger_columnas()', 'trib_codigo_oc(text)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;

-- ── 8. Storage: documentos de respaldo (privado; se sube y se lee; no se reemplaza ni se borra) ─────
-- OBLIGATORIO (autorización condicionada del 20/10/2026): si el depósito o sus políticas no se pueden crear Y verificar,
-- se lanza una excepción y TODA la migración se revierte (una sola transacción). No hay instalación parcial.
do $$ begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null or to_regprocedure('storage.foldername(text)') is null then
    raise exception 'TRIB: Storage no disponible (storage.objects, storage.buckets o storage.foldername); no se aplicó nada'; end if;
  if exists (select 1 from storage.buckets where id = 'trib-respaldos' or name = 'trib-respaldos') then
    raise exception 'TRIB: ya existe el depósito trib-respaldos; no se aplicó nada'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'trib\_%') then
    raise exception 'TRIB: ya existen políticas trib_* en Storage; no se aplicó nada'; end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('trib-respaldos', 'trib-respaldos', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg']);
  execute $p$create policy trib_respaldo_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'trib-respaldos' and public.cz_es_usuario() and (storage.foldername(name))[1] in ('cotizacion', 'oc'))$p$;
  execute $p$create policy trib_respaldo_leer on storage.objects for select to authenticated
    using (bucket_id = 'trib-respaldos' and public.cz_es_usuario())$p$;
end $$;

-- ── 9. Verificación de Storage (cualquier diferencia revierte TODA la migración) ─────────────────
do $$ declare b record; v_txt text; begin
  select * into b from storage.buckets where id = 'trib-respaldos';
  if not found or b.name is distinct from 'trib-respaldos' or b.public is distinct from false or b.file_size_limit is distinct from 10485760
     or b.allowed_mime_types is distinct from array['application/pdf', 'image/png', 'image/jpeg'] then
    raise exception 'TRIB-VERIFICACION: el depósito trib-respaldos no quedó privado y con sus límites; se revierte toda la migración'; end if;
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'TRIB-VERIFICACION: storage.objects no tiene RLS activa; se revierte toda la migración'; end if;
  -- Exactamente dos políticas trib_*: subir (INSERT) y leer (SELECT), solo para authenticated, limitadas al depósito.
  if (select count(*) from pg_policies where schemaname = 'storage' and policyname like 'trib\_%') <> 2
     or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'trib_respaldo_subir'
                    and cmd = 'INSERT' and permissive = 'PERMISSIVE' and roles = '{authenticated}'::name[] and qual is null
                    and with_check like '%bucket_id = ''trib-respaldos''::text%' and with_check like '%cz_es_usuario()%' and with_check like '%foldername%')
     or not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'trib_respaldo_leer'
                    and cmd = 'SELECT' and permissive = 'PERMISSIVE' and roles = '{authenticated}'::name[] and with_check is null
                    and qual like '%bucket_id = ''trib-respaldos''::text%' and qual like '%cz_es_usuario()%') then
    raise exception 'TRIB-VERIFICACION: las políticas trib_respaldo_subir / trib_respaldo_leer no quedaron como se definieron; se revierte toda la migración'; end if;
  -- Ninguna otra política de storage.objects puede alcanzar el depósito: todas deben fijar depósitos explícitos
  -- (bucket_id = ... sin negaciones) y ninguna puede nombrarlo. Así no hay lectura, reemplazo ni borrado por otra vía.
  select string_agg(policyname, ', ') into v_txt from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and policyname not like 'trib\_%'
     and (coalesce(qual, '') || coalesce(with_check, '') !~ 'bucket_id = '
          or coalesce(qual, '') || coalesce(with_check, '') ~* '(trib-respaldos|<>|!=|\mnot\M)');
  if v_txt is not null then
    raise exception 'TRIB-VERIFICACION: la política % de storage.objects podría alcanzar el depósito trib-respaldos; se revierte toda la migración', v_txt; end if;
  if exists (select 1 from storage.objects where bucket_id = 'trib-respaldos') then
    raise exception 'TRIB-VERIFICACION: el depósito trib-respaldos no está vacío; se revierte toda la migración'; end if;
end $$;
