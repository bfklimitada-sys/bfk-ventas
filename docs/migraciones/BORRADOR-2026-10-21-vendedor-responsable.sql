-- =====================================================================================
-- BFK DATOS — VENDEDOR RESPONSABLE OBLIGATORIO EN COTIZACIONES (BORRADOR, NO APLICADO)
-- Aditiva y reversible (BORRADOR-2026-10-21-vendedor-responsable-deshacer.sql). No modifica datos existentes.
--
-- Crea:
--   · cotizacion_vendedor_historial      bitácora de asignaciones y cambios de vendedor (quién, cuándo, anterior, nuevo).
--   · cz_trg_vendedor_responsable()      disparador en cotizaciones (solo escrituras de la app, como las guardas trib):
--       - el vendedor debe existir en el catálogo (vendedores de BFK o vendedores de Cotizaciones) y estar activo al
--         asignarlo; el nombre se toma del catálogo (no se puede escribir otro);
--       - no se puede PRESENTAR ni ADJUDICAR una cotización sin vendedor (borradores sí);
--       - en una cotización presentada o adjudicada con vendedor, solo un administrador lo cambia;
--       - cada asignación o cambio queda en la bitácora.
--   · cz_transferir_vendedor_a_oc(uuid)  pasa el vendedor de una cotización adjudicada a su OC SOLO si la asignación es
--       inequívoca (una OC con ese código, una sola cotización adjudicada vinculada, vendedor del catálogo de BFK) y la
--       OC no tiene vendedor. Usa asignar_vendedor_oc (mismas validaciones, historial y protección de comisiones pagadas).
-- NO modifica: cz_guardar_cotizacion_v2, cotizaciones/OC existentes, comisiones, pagos, F29, costos ni FIFO.
-- Las cotizaciones históricas presentadas sin vendedor se pueden seguir editando; solo se exige el vendedor al cambiar
-- su estado a presentada/adjudicada o al quitarle el vendedor.
-- =====================================================================================
begin;
set local lock_timeout = '5s';

create table public.cotizacion_vendedor_historial (
  id               bigserial primary key,
  cotizacion_id    uuid not null,                 -- sin FK: la bitácora sobrevive a una eliminación autorizada
  estado           text,
  anterior_id      text,
  anterior_nombre  text,
  nuevo_id         text,
  nuevo_nombre     text,
  usuario          uuid,
  es_admin         boolean not null default false,
  creado_en        timestamptz not null default now()
);
create index cz_vend_hist_cot on public.cotizacion_vendedor_historial (cotizacion_id, creado_en);
alter table public.cotizacion_vendedor_historial enable row level security;
create policy cz_vend_hist_leer on public.cotizacion_vendedor_historial for select to authenticated using (public.cz_es_usuario());
revoke all on public.cotizacion_vendedor_historial from public, anon, authenticated;
grant select on public.cotizacion_vendedor_historial to authenticated;
grant all on public.cotizacion_vendedor_historial to service_role;
revoke all on sequence public.cotizacion_vendedor_historial_id_seq from public, anon, authenticated;
grant usage, select on sequence public.cotizacion_vendedor_historial_id_seq to service_role;

-- Nombre del vendedor en el catálogo (null si no existe). p_activo: exigir que esté activo.
create function public.cz_vendedor_catalogo(p_id text, p_activo boolean default true) returns text
  language sql stable security definer
  set search_path to 'public', 'pg_temp'
as $_$
  select coalesce(
    (select v.nombre from public.vendedores v where v.id::text = p_id and (not p_activo or v.activo is not false)),
    (select z.nombre from public.cotizacion_vendedores z where p_id like 'cz:%' and z.id::text = substr(p_id, 4) and (not p_activo or z.activo)))
$_$;

create function public.cz_trg_vendedor_responsable() returns trigger
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare v_nombre text; v_cambio boolean;
begin
  if not public.trib_escritura_api() then return new; end if;   -- restauraciones e importaciones directas: sin cambios
  new.vendedor_id := nullif(btrim(coalesce(new.vendedor_id, '')), '');
  v_cambio := tg_op = 'INSERT' or new.vendedor_id is distinct from old.vendedor_id;
  if v_cambio then
    if new.vendedor_id is null then
      new.vendedor_nombre := null;
    else
      v_nombre := public.cz_vendedor_catalogo(new.vendedor_id, true);
      if v_nombre is null then
        raise exception 'CZ_VENDEDOR: el vendedor elegido no existe o no está activo en el catálogo de BFK.' using errcode = '22023';
      end if;
      new.vendedor_nombre := v_nombre;                                -- el nombre siempre es el del catálogo
    end if;
  elsif new.vendedor_id is not null and new.vendedor_nombre is distinct from old.vendedor_nombre then
    new.vendedor_nombre := old.vendedor_nombre;                       -- no se renombra a mano un vendedor asignado
  end if;

  if new.estado in ('presentada', 'adjudicada') and new.vendedor_id is null
     and (tg_op = 'INSERT' or new.estado is distinct from old.estado or old.vendedor_id is not null) then
    raise exception 'CZ_VENDEDOR: no se puede % una cotización sin vendedor responsable. Asígnalo en Datos.',
      case new.estado when 'presentada' then 'presentar' else 'adjudicar' end using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and v_cambio and old.vendedor_id is not null and old.estado in ('presentada', 'adjudicada')
     and not public.cz_es_admin() then
    raise exception 'CZ_VENDEDOR: la cotización ya fue %; solo un administrador puede cambiar su vendedor responsable.',
      case old.estado when 'presentada' then 'presentada' else 'adjudicada' end using errcode = '42501';
  end if;

  if v_cambio and (tg_op = 'UPDATE' or new.vendedor_id is not null) then
    insert into public.cotizacion_vendedor_historial (cotizacion_id, estado, anterior_id, anterior_nombre, nuevo_id, nuevo_nombre, usuario, es_admin)
    values (new.id, new.estado, case when tg_op = 'UPDATE' then old.vendedor_id end, case when tg_op = 'UPDATE' then old.vendedor_nombre end,
            new.vendedor_id, new.vendedor_nombre, auth.uid(), coalesce(public.cz_es_admin(), false));
  end if;
  return new;
end $_$;

create trigger cz_vendedor_responsable before insert or update on public.cotizaciones
  for each row execute function public.cz_trg_vendedor_responsable();

-- Transferencia controlada del vendedor de una cotización adjudicada a su OC (solo si es inequívoca y la OC no tiene).
create function public.cz_transferir_vendedor_a_oc(p_cotizacion_id uuid) returns jsonb
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare c public.cotizaciones%rowtype; o public.ordenes_compra_v2%rowtype; n int; r jsonb;
begin
  if not public.cz_es_usuario() then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  select * into c from public.cotizaciones where id = p_cotizacion_id;
  if not found then raise exception 'CZ_VENDEDOR: la cotización no existe' using errcode = 'P0002'; end if;
  if c.estado <> 'adjudicada' or nullif(btrim(coalesce(c.oc_codigo, '')), '') is null then
    raise exception 'CZ_VENDEDOR: solo se transfiere desde una cotización adjudicada vinculada a una OC' using errcode = '22023'; end if;
  if c.vendedor_id is null then raise exception 'CZ_VENDEDOR: la cotización no tiene vendedor responsable' using errcode = '22023'; end if;
  if not exists (select 1 from public.vendedores v where v.id::text = c.vendedor_id) then
    raise exception 'CZ_VENDEDOR: el vendedor % está registrado solo en Cotizaciones: asígnalo manualmente en la OC', c.vendedor_nombre using errcode = '22023'; end if;
  select count(*) into n from public.ordenes_compra_v2 x where upper(btrim(x.numero_oc)) = upper(btrim(c.oc_codigo));
  if n <> 1 then raise exception 'CZ_VENDEDOR: el código % corresponde a % OC: la asignación no es inequívoca', c.oc_codigo, n using errcode = '22023'; end if;
  select count(*) into n from public.cotizaciones y where y.estado = 'adjudicada' and upper(btrim(y.oc_codigo)) = upper(btrim(c.oc_codigo));
  if n <> 1 then raise exception 'CZ_VENDEDOR: hay % cotizaciones adjudicadas vinculadas a la OC %: la asignación no es inequívoca', n, c.oc_codigo using errcode = '22023'; end if;
  select * into o from public.ordenes_compra_v2 x where upper(btrim(x.numero_oc)) = upper(btrim(c.oc_codigo)) for no key update;
  if o.vendedor_id is not null or o.capitalizacion_bfk then
    if o.vendedor_id = c.vendedor_id then return jsonb_build_object('ok', true, 'sin_cambios', true, 'oc_id', o.id); end if;
    raise exception 'CZ_VENDEDOR: la OC % ya tiene un vendedor asignado distinto; no se sobrescribe', o.numero_oc using errcode = '23514'; end if;
  r := public.asignar_vendedor_oc(o.id, c.vendedor_id);
  return jsonb_build_object('ok', true, 'oc_id', o.id, 'numero_oc', o.numero_oc) || coalesce(r, '{}'::jsonb);
end $_$;

revoke all on function public.cz_vendedor_catalogo(text, boolean), public.cz_trg_vendedor_responsable(),
  public.cz_transferir_vendedor_a_oc(uuid) from public, anon, authenticated;
grant execute on function public.cz_transferir_vendedor_a_oc(uuid) to authenticated, service_role;
grant execute on function public.cz_vendedor_catalogo(text, boolean), public.cz_trg_vendedor_responsable() to service_role;

do $_$
begin
  if not exists (select 1 from pg_trigger where tgname = 'cz_vendedor_responsable' and tgrelid = 'public.cotizaciones'::regclass) then
    raise exception 'VERIFICACION: falta el disparador'; end if;
  if has_table_privilege('authenticated', 'public.cotizacion_vendedor_historial', 'insert')
     or has_table_privilege('anon', 'public.cotizacion_vendedor_historial', 'select')
     or has_function_privilege('anon', 'public.cz_transferir_vendedor_a_oc(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.cz_transferir_vendedor_a_oc(uuid)', 'execute') then
    raise exception 'VERIFICACION: permisos incorrectos'; end if;
end $_$;
commit;
