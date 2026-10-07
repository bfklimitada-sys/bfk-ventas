-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase Correos y Notificaciones (2026-10-07). Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-correos-bfk.sql
--
-- Qué hace (solo estructura nueva; NO modifica ninguna tabla ni dato existente)
--   · Tabla correos_bfk: copia mínima de los correos relevantes del buzón de BFK (remitente, asunto,
--     fecha, resumen breve de hasta 400 caracteres, categoría, prioridad, OC asociada y evidencia,
--     estado pendiente/gestionado). No guarda el cuerpo completo ni adjuntos.
--   · RPC correos_bfk_registrar(jsonb): la usa SOLO el rol de sincronización. Idempotente por
--     message_id (un mismo correo procesado otra vez no se duplica ni cambia su estado). Decide la
--     OC asociada con evidencia inequívoca y descarta lo que no es relevante; nunca inventa una OC:
--       1. número de OC escrito en el correo que coincide con exactamente una OC
--       2. folio de factura de BFK que coincide con exactamente una OC y además el remitente o un
--          RUT del correo corresponden al cliente de esa OC
--       3. RUT del cliente con exactamente una OC abierta (no archivada y no cobrada)
--       4. remitente igual al correo del cliente de exactamente una OC abierta
--     Si nada de eso se cumple (o hay más de una OC posible) queda como correo general.
--   · RPC correo_bfk_marcar(id, estado): pendiente ⇄ gestionado, registrando quién y cuándo. Solo
--     cambia el estado de la notificación en BFK; el correo original en Gmail no se toca.
--   · Rol correo_sync_bfk: solo puede conectarse y ejecutar correos_bfk_registrar. Sin acceso de
--     lectura ni escritura a ninguna tabla. Su contraseña se fija en un paso aparte (no está aquí).
-- Seguridad: lectura solo para usuarios con perfil BFK (RLS). Nadie escribe la tabla directamente.
-- Deshacer: 2026-10-07-correos-bfk-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.correos_bfk') is not null then
    raise exception 'CORREOS: la migración ya está aplicada';
  end if;
  if to_regclass('public.ordenes_compra_v2') is null or to_regclass('public.eventos_factura') is null
     or to_regclass('public.perfiles') is null then
    raise exception 'CORREOS: faltan tablas base';
  end if;
end $$;

-- ── 1. Tabla ──────────────────────────────────────────────────────────────────────────────
create table public.correos_bfk (
  id                    bigint generated always as identity primary key,
  message_id            text not null unique check (char_length(message_id) between 1 and 500),
  buzon                 text not null,
  uid_imap              bigint,
  remitente_nombre      text not null default '' check (char_length(remitente_nombre) <= 200),
  remitente_correo      text not null default '' check (char_length(remitente_correo) <= 320),
  asunto                text not null default '' check (char_length(asunto) <= 500),
  fecha                 timestamptz not null,
  resumen               text not null default '' check (char_length(resumen) <= 400),
  categoria             text not null check (categoria in ('reclamo','entrega','facturacion','cobranza','documentos','solicitud','mercado_publico','general')),
  prioridad             smallint not null check (prioridad between 0 and 3),
  oc_id                 text references public.ordenes_compra_v2(id) on delete set null,
  asociacion            text not null default 'ninguna' check (asociacion in ('numero_oc','factura','rut_unico','remitente_unico','ninguna')),
  evidencia             text check (evidencia is null or char_length(evidencia) <= 300),
  rut_detectado         text,
  estado                text not null default 'pendiente' check (estado in ('pendiente','gestionado')),
  gestionado_en         timestamptz,
  gestionado_por        uuid,
  gestionado_por_nombre text,
  sincronizado_en       timestamptz not null default now(),
  check (asociacion <> 'ninguna' or oc_id is null),
  check (estado = 'pendiente' or gestionado_en is not null)
);
comment on table public.correos_bfk is 'Correos relevantes del buzón de BFK (copia mínima, solo lectura del buzón). Escritura solo por RPC.';
create index correos_bfk_pendientes_idx on public.correos_bfk (prioridad desc, fecha desc) where estado = 'pendiente';
create index correos_bfk_oc_idx on public.correos_bfk (oc_id) where oc_id is not null;
create index correos_bfk_fecha_idx on public.correos_bfk (fecha desc);

alter table public.correos_bfk enable row level security;
revoke all on table public.correos_bfk from public, anon, authenticated;
grant select on table public.correos_bfk to authenticated;
create policy correos_bfk_leen_perfiles on public.correos_bfk for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid()));

-- ── 2. Normalización de RUT (solo dígitos y K) ───────────────────────────────────────────
create function public.correos_bfk_rut(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9kK]', '', 'g')), '')
$$;

-- Correos de un campo que puede traer varios separados por coma, punto y coma o espacio.
create function public.correos_bfk_lista(p text) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(array_agg(x) filter (where x <> ''), '{}')
    from unnest(regexp_split_to_array(lower(coalesce(p, '')), '[,;[:space:]]+')) x
$$;

-- ── 3. Registro idempotente (solo el rol de sincronización) ──────────────────────────────
create function public.correos_bfk_registrar(p_correos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c jsonb;
  v_mid text; v_rem text; v_cat text; v_pri int; v_fecha timestamptz;
  v_ocs_cand text[]; v_ruts text[]; v_folios text[];
  v_ids text[]; v_oc text; v_asoc text; v_evid text; v_rut text; v_rel boolean; v_n int;
  v_recibidos int := 0; v_nuevos int := 0; v_existentes int := 0; v_descartados int := 0; v_asociados int := 0;
begin
  if p_correos is null or jsonb_typeof(p_correos) <> 'array' then
    raise exception 'CORREOS: se esperaba un arreglo';
  end if;
  if jsonb_array_length(p_correos) > 2000 then
    raise exception 'CORREOS: máximo 2000 correos por llamada';
  end if;

  for c in select value from jsonb_array_elements(p_correos) loop
    v_recibidos := v_recibidos + 1;
    v_mid := nullif(btrim(c->>'message_id'), '');
    if v_mid is null or char_length(v_mid) > 500 then
      raise exception 'CORREOS: message_id inválido en el elemento %', v_recibidos;
    end if;
    if exists (select 1 from correos_bfk where message_id = v_mid) then
      v_existentes := v_existentes + 1;
      continue;
    end if;

    v_fecha := (c->>'fecha')::timestamptz;
    if v_fecha is null then raise exception 'CORREOS: fecha requerida (%)', v_mid; end if;
    v_rem := lower(btrim(coalesce(c->>'remitente_correo', '')));
    v_cat := coalesce(nullif(c->>'categoria', ''), 'general');
    v_pri := coalesce((c->>'prioridad')::int, 0);

    select coalesce(array_agg(distinct upper(btrim(x))) filter (where btrim(x) <> ''), '{}') into v_ocs_cand
      from jsonb_array_elements_text(coalesce(c->'candidatos'->'ocs', '[]')) x;
    select coalesce(array_agg(distinct correos_bfk_rut(x)) filter (where correos_bfk_rut(x) is not null), '{}') into v_ruts
      from jsonb_array_elements_text(coalesce(c->'candidatos'->'ruts', '[]')) x;
    select coalesce(array_agg(distinct ltrim(btrim(x), '0')) filter (where ltrim(btrim(x), '0') <> ''), '{}') into v_folios
      from jsonb_array_elements_text(coalesce(c->'candidatos'->'folios', '[]')) x;

    v_oc := null; v_asoc := 'ninguna'; v_evid := null;

    -- 1. Número de OC (cualquier OC, también archivada: el número es inequívoco)
    if cardinality(v_ocs_cand) > 0 then
      select array_agg(distinct o.id) into v_ids from ordenes_compra_v2 o
       where upper(btrim(o.numero_oc)) = any (v_ocs_cand);
      if cardinality(v_ids) = 1 then
        v_oc := v_ids[1]; v_asoc := 'numero_oc';
        select 'N° de OC ' || numero_oc || ' citado en el correo' into v_evid from ordenes_compra_v2 where id = v_oc;
      end if;
    end if;

    -- 2. Folio de factura de BFK + remitente o RUT del cliente de esa OC
    if v_oc is null and cardinality(v_folios) > 0 then
      select array_agg(distinct f.oc_id) into v_ids
        from eventos_factura f join ordenes_compra_v2 o on o.id = f.oc_id
       where ltrim(btrim(f.numero_factura), '0') = any (v_folios)
         and coalesce(f.tipo_dte, 33) in (33, 34)
         and ((v_rem <> '' and v_rem = any (correos_bfk_lista(o.correo_cliente)))
              or correos_bfk_rut(o.rut_cliente) = any (v_ruts));
      if cardinality(v_ids) = 1 then
        v_oc := v_ids[1]; v_asoc := 'factura';
        select 'Factura folio ' || string_agg(distinct ltrim(btrim(f.numero_factura), '0'), ', ') || ' de esta OC, enviada por su cliente'
          into v_evid from eventos_factura f where f.oc_id = v_oc and ltrim(btrim(f.numero_factura), '0') = any (v_folios);
      end if;
    end if;

    -- 3. RUT del cliente con una sola OC abierta
    if v_oc is null and cardinality(v_ruts) > 0 then
      select array_agg(distinct o.id) into v_ids from ordenes_compra_v2 o
       where correos_bfk_rut(o.rut_cliente) = any (v_ruts)
         and not coalesce(o.archivada, false) and coalesce(o.estado_pago_cliente, '') <> 'pagado';
      if cardinality(v_ids) = 1 then
        v_oc := v_ids[1]; v_asoc := 'rut_unico';
        select 'RUT ' || rut_cliente || ': única OC abierta de este cliente' into v_evid from ordenes_compra_v2 where id = v_oc;
      end if;
    end if;

    -- 4. Remitente = correo del cliente de una sola OC abierta
    if v_oc is null and v_rem <> '' then
      select array_agg(distinct o.id) into v_ids from ordenes_compra_v2 o
       where v_rem = any (correos_bfk_lista(o.correo_cliente))
         and not coalesce(o.archivada, false) and coalesce(o.estado_pago_cliente, '') <> 'pagado';
      if cardinality(v_ids) = 1 then
        v_oc := v_ids[1]; v_asoc := 'remitente_unico';
        v_evid := 'Remitente registrado como correo del cliente de su única OC abierta';
      end if;
    end if;

    -- RUT de un cliente conocido (para mostrar aunque no haya OC única)
    select o.rut_cliente into v_rut from ordenes_compra_v2 o
     where correos_bfk_rut(o.rut_cliente) = any (v_ruts) limit 1;

    -- Relevancia: OC asociada, correo que implica acción, o cliente conocido
    v_rel := v_oc is not null or v_cat <> 'general' or v_rut is not null
      or (v_rem <> '' and (
            exists (select 1 from ordenes_compra_v2 o where v_rem = any (correos_bfk_lista(o.correo_cliente)))
         or exists (select 1 from contactos_cobranza k where v_rem = any (correos_bfk_lista(k.correo)))));
    if not v_rel then
      v_descartados := v_descartados + 1;
      continue;
    end if;

    insert into correos_bfk (message_id, buzon, uid_imap, remitente_nombre, remitente_correo, asunto, fecha, resumen,
                             categoria, prioridad, oc_id, asociacion, evidencia, rut_detectado)
    values (v_mid, coalesce(nullif(c->>'buzon', ''), 'desconocido'), (c->>'uid')::bigint,
            left(coalesce(c->>'remitente_nombre', ''), 200), left(v_rem, 320), left(coalesce(c->>'asunto', ''), 500), v_fecha,
            left(coalesce(c->>'resumen', ''), 400), v_cat, greatest(0, least(3, v_pri)), v_oc, v_asoc, left(v_evid, 300), v_rut)
    on conflict (message_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 then
      v_nuevos := v_nuevos + 1;
      if v_oc is not null then v_asociados := v_asociados + 1; end if;
    else
      v_existentes := v_existentes + 1;
    end if;
  end loop;

  return jsonb_build_object('recibidos', v_recibidos, 'nuevos', v_nuevos, 'existentes', v_existentes,
                            'descartados', v_descartados, 'asociados', v_asociados);
end $$;

-- ── 4. Marcar pendiente / gestionado (usuarios BFK) ──────────────────────────────────────
create function public.correo_bfk_marcar(p_id bigint, p_estado text) returns public.correos_bfk
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text; r public.correos_bfk;
begin
  if v_uid is null then raise exception 'Sesión requerida' using errcode = '42501'; end if;
  select coalesce(nombre, '') into v_nombre from perfiles where id = v_uid;
  if not found then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if p_estado is null or p_estado not in ('pendiente', 'gestionado') then raise exception 'Estado inválido'; end if;
  update correos_bfk set
      estado = p_estado,
      gestionado_en = case when p_estado = 'gestionado' then now() end,
      gestionado_por = case when p_estado = 'gestionado' then v_uid end,
      gestionado_por_nombre = case when p_estado = 'gestionado' then v_nombre end
   where id = p_id
  returning * into r;
  if not found then raise exception 'Correo no encontrado'; end if;
  return r;
end $$;

-- ── 5. Permisos de funciones ─────────────────────────────────────────────────────────────
revoke all on function public.correos_bfk_registrar(jsonb) from public, anon, authenticated;
revoke all on function public.correo_bfk_marcar(bigint, text) from public, anon;
grant execute on function public.correo_bfk_marcar(bigint, text) to authenticated;
revoke all on function public.correos_bfk_rut(text) from anon;
revoke all on function public.correos_bfk_lista(text) from anon;

-- ── 6. Rol de sincronización (contraseña en paso aparte) ─────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'correo_sync_bfk') then
    create role correo_sync_bfk login noinherit nocreatedb nocreaterole connection limit 3;
  end if;
end $$;
alter role correo_sync_bfk set statement_timeout = '60s';
grant usage on schema public to correo_sync_bfk;
grant execute on function public.correos_bfk_registrar(jsonb) to correo_sync_bfk;

do $$ begin raise notice 'CORREOS-MIGRACION: OK'; end $$;
