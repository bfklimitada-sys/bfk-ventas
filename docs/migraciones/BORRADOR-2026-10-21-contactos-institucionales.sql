-- =====================================================================================
-- BFK DATOS — Desarrollo B: CONTACTOS INSTITUCIONALES (BORRADOR, NO APLICADO)
-- Migración ADITIVA y REVERSIBLE (reversión: BORRADOR-2026-10-21-contactos-institucionales-deshacer.sql)
--
-- Crea:
--   · contactos_institucionales            varios contactos por institución (RUT validado), con estado
--                                           vigente / pendiente / obsoleto, origen y confirmación manual.
--   · contactos_institucionales_oc          qué OC respaldó cada contacto (idempotente: PK contacto+OC).
--   · contactos_institucionales_historial   bitácora inalterable de cada alta/cambio (trigger).
--   · RPC conciliar_contactos_oc            al ingresar/sincronizar una OC compara sus correos con los guardados.
--   · RPC guardar_contacto_institucional    alta/corrección manual (queda confirmada).
--   · RPC resolver_contacto_pendiente       reemplaza / adicional / descartar.
--   · RPC marcar_contacto_obsoleto
-- Modifica (reversible):
--   · registrar_entidad_desde_oc: el contacto y correo del catálogo ya NO se sobrescriben con cada OC;
--     solo se completan si están vacíos (nombre y comuna conservan su comportamiento actual).
-- NO modifica: ordenes_compra_v2 (los contactos históricos de cada OC quedan intactos), entidades_catalogo
-- (datos), contactos_cobranza, ni ninguna tabla financiera.
-- =====================================================================================
begin;

set local lock_timeout = '5s';

-- ---------- utilidades ----------
-- RUT validado → clave (cuerpo sin ceros a la izquierda + DV). NULL si no es válido (no se corrige ni se inventa).
create function public.ci_rut_clave(p_rut text) returns text
  language plpgsql immutable
  set search_path to 'public', 'pg_temp'
as $_$
declare l text; b text; d text; s int := 0; f int := 2; r int; i int;
begin
  l := upper(regexp_replace(coalesce(p_rut,''), '[\s.\-‐-―]', '', 'g'));
  if l !~ '^[0-9]+[0-9K]$' then return null; end if;
  b := ltrim(left(l, -1), '0'); d := right(l, 1);
  if b !~ '^[0-9]{7,8}$' or b::bigint < 1000000 then return null; end if;
  for i in reverse length(b) .. 1 loop s := s + substr(b, i, 1)::int * f; f := case when f = 7 then 2 else f + 1 end; end loop;
  r := 11 - s % 11;
  if (case r when 11 then '0' when 10 then 'K' else r::text end) <> d then return null; end if;
  return b || d;
end $_$;

create function public.ci_rut_formato(p_clave text) returns text
  language sql immutable
  set search_path to 'public', 'pg_temp'
as $_$
  select case when length(p_clave) = 9
              then substr(p_clave,1,2)||'.'||substr(p_clave,3,3)||'.'||substr(p_clave,6,3)
              else substr(p_clave,1,1)||'.'||substr(p_clave,2,3)||'.'||substr(p_clave,5,3) end
         || '-' || right(p_clave, 1)
$_$;

-- Nombre comparable: minúsculas, sin tildes ni espacios repetidos (solo para detectar "la misma persona").
create function public.ci_nombre_clave(p_nombre text) returns text
  language sql immutable
  set search_path to 'public', 'pg_temp'
as $_$
  select btrim(regexp_replace(translate(lower(coalesce(p_nombre,'')), 'áéíóúàèìòùäëïöüâêîôûñ', 'aeiouaeiouaeiouaeioun'), '\s+', ' ', 'g'))
$_$;

-- ---------- tablas ----------
create table public.contactos_institucionales (
  id               uuid primary key default gen_random_uuid(),
  rut_clave        text not null check (public.ci_rut_clave(rut_clave) = rut_clave),
  rut              text not null,
  nombre           text not null default '' check (length(nombre) <= 200),
  cargo            text not null default '' check (length(cargo) <= 200),
  departamento     text not null default '' check (length(departamento) <= 200),
  correo           text not null default '' check (length(correo) <= 200 and (correo = '' or correo ~* '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$')),
  correo_clave     text generated always as (lower(btrim(correo))) stored,
  telefono         text not null default '' check (length(telefono) <= 60),
  estado           text not null default 'vigente' check (estado in ('vigente','pendiente','obsoleto')),
  origen           text not null check (origen in ('manual','mp','oc','importado','cobranza')),
  confirmado_manual boolean not null default false,
  confirmado_por   uuid,
  confirmado_en    timestamptz,
  es_principal     boolean not null default false,
  alcance          text not null default 'institucion' check (alcance in ('institucion','oc')),
  oc_exclusiva     text,
  motivo_pendiente text check (motivo_pendiente in ('cambio_correo','contradice_manual','sin_nombre','correo_de_oc_anterior')),
  conflicto_con    uuid references public.contactos_institucionales(id) on delete set null,
  reemplazado_por  uuid references public.contactos_institucionales(id) on delete set null,
  obsoleto_motivo  text check (length(obsoleto_motivo) <= 300),
  oc_origen        text,
  ultima_oc        text,
  ultima_oc_fecha  timestamptz,
  creado_en        timestamptz not null default now(),
  creado_por       uuid,
  actualizado_en   timestamptz not null default now(),
  actualizado_por  uuid,
  constraint ci_con_dato check (correo <> '' or nombre <> '' or telefono <> ''),
  constraint ci_alcance_oc check (alcance = 'institucion' or oc_exclusiva is not null),
  constraint ci_principal_vigente check (not es_principal or estado = 'vigente'),
  constraint ci_pendiente_motivo check ((estado = 'pendiente') = (motivo_pendiente is not null))
);
comment on table public.contactos_institucionales is
  'Contactos de cada institución (por RUT validado). Prioridad: confirmado manual > Mercado Público > OC > importado/cobranza > pendiente. Nunca se borran: se marcan obsoletos.';

-- Sin duplicados: un correo por institución (sin distinguir mayúsculas). Contactos sin correo: nombre+teléfono.
create unique index ci_correo_unico   on public.contactos_institucionales (rut_clave, correo_clave) where correo_clave <> '';
create unique index ci_sin_correo_unico on public.contactos_institucionales (rut_clave, public.ci_nombre_clave(nombre), telefono) where correo_clave = '';
create unique index ci_principal_unico on public.contactos_institucionales (rut_clave) where es_principal;
create index ci_rut on public.contactos_institucionales (rut_clave, estado);

create table public.contactos_institucionales_oc (
  contacto_id  uuid not null references public.contactos_institucionales(id) on delete cascade,
  oc_id        text not null,
  correo_en_oc text not null default '',
  origen       text not null,
  creado_en    timestamptz not null default now(),
  primary key (contacto_id, oc_id)
);
create index ci_oc_por_oc on public.contactos_institucionales_oc (oc_id);

create table public.contactos_institucionales_historial (
  id          bigserial primary key,
  contacto_id uuid not null,              -- sin FK: la bitácora sobrevive aunque cambie el contacto
  rut_clave   text not null,
  accion      text not null,
  anterior    jsonb,
  nuevo       jsonb,
  origen      text,
  oc_id       text,
  usuario     uuid,
  creado_en   timestamptz not null default now()
);
create index ci_hist_contacto on public.contactos_institucionales_historial (contacto_id, creado_en);
create index ci_hist_rut on public.contactos_institucionales_historial (rut_clave, creado_en);

-- ---------- bitácora automática ----------
create function public.ci_trg_historial() returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $_$
declare v_acc text := nullif(current_setting('ci.accion', true), '');
begin
  if tg_op = 'UPDATE' then
    -- (correo_clave es generada: en un BEFORE todavía no está calculada, por eso se excluye)
    if to_jsonb(new) - 'actualizado_en' - 'actualizado_por' - 'correo_clave' = to_jsonb(old) - 'actualizado_en' - 'actualizado_por' - 'correo_clave' then
      return new;                                   -- nada cambió: no se ensucia la bitácora
    end if;
    if new.rut_clave is distinct from old.rut_clave then
      raise exception 'CONTACTO_RECHAZADO: un contacto no puede cambiar de institución' using errcode = 'CI001';
    end if;
    new.actualizado_en := now();
  end if;
  insert into public.contactos_institucionales_historial (contacto_id, rut_clave, accion, anterior, nuevo, origen, oc_id, usuario)
  values (new.id, new.rut_clave, coalesce(v_acc, lower(tg_op)),
          case when tg_op = 'UPDATE' then to_jsonb(old) - 'correo_clave' end, to_jsonb(new) - 'correo_clave',
          nullif(current_setting('ci.origen', true), ''), nullif(current_setting('ci.oc_id', true), ''),
          coalesce(nullif(current_setting('ci.usuario', true), '')::uuid, auth.uid()));
  return new;
end $_$;

create trigger ci_historial before insert or update on public.contactos_institucionales
  for each row execute function public.ci_trg_historial();

create function public.ci_trg_no_borrar() returns trigger
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $_$
begin
  if public.fin_es_importacion() then return case when tg_op = 'DELETE' then old else new end; end if;   -- restauración de respaldo
  raise exception 'CONTACTO_RECHAZADO: los contactos y su bitácora no se eliminan (marcar obsoleto)' using errcode = 'CI002';
end $_$;
create trigger ci_no_borrar before delete on public.contactos_institucionales
  for each row execute function public.ci_trg_no_borrar();
create trigger ci_hist_inalterable before update or delete on public.contactos_institucionales_historial
  for each row execute function public.ci_trg_no_borrar();

-- ---------- sesión ----------
create function public.ci_exigir_sesion() returns uuid
  language plpgsql stable security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare v uuid := auth.uid();
begin
  if v is null then raise exception 'CONTACTO_RECHAZADO: se requiere una sesión válida' using errcode = 'CI003'; end if;
  if not exists (select 1 from public.perfiles where id = v) then
    raise exception 'CONTACTO_RECHAZADO: usuario sin perfil' using errcode = 'CI003';
  end if;
  return v;
end $_$;

create function public.ci_contexto(p_accion text, p_origen text, p_oc text, p_usuario uuid) returns void
  language sql
  set search_path to 'public', 'pg_temp'
as $_$
  select set_config('ci.accion', coalesce(p_accion,''), true), set_config('ci.origen', coalesce(p_origen,''), true),
         set_config('ci.oc_id', coalesce(p_oc,''), true), set_config('ci.usuario', coalesce(p_usuario::text,''), true);
$_$;

-- ---------- conciliación de UN correo de una OC (interna) ----------
-- Reglas: nunca toca otra institución; un correo ya conocido solo se vincula (idempotente);
-- los datos confirmados manualmente no se sobrescriben; un correo nuevo de la MISMA persona queda
-- pendiente (candidato a reemplazo, nunca reemplazo automático); otra persona = contacto adicional;
-- sin nombre y con contactos previos = pendiente de verificación.
create function public.ci_conciliar_uno(
  p_clave text, p_oc text, p_fecha timestamptz, p_origen text, p_usuario uuid,
  p_nombre text, p_cargo text, p_correo text, p_telefono text) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $_$
declare
  v_correo text := lower(btrim(coalesce(p_correo,'')));
  v_nombre text := btrim(coalesce(p_nombre,''));
  v_cargo  text := btrim(coalesce(p_cargo,''));
  v_tel    text := btrim(coalesce(p_telefono,''));
  x public.contactos_institucionales%rowtype;
  y public.contactos_institucionales%rowtype;
  v_nueva_oc boolean; v_mas_nueva boolean; v_id uuid; v_estado text; v_motivo text; v_acc text;
  n_vig int;
begin
  if v_correo <> '' and v_correo !~* '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then
    return jsonb_build_object('accion','correo_invalido','correo',v_correo);
  end if;
  if v_correo = '' and v_nombre = '' and v_tel = '' then return jsonb_build_object('accion','sin_datos'); end if;

  -- 1) ya conocido (mismo correo, o sin correo: mismo nombre y teléfono)
  if v_correo <> '' then
    select * into x from public.contactos_institucionales where rut_clave = p_clave and correo_clave = v_correo;
  else
    -- sin correo: la misma persona (por nombre) o, si no hay nombre, el mismo teléfono
    select * into x from public.contactos_institucionales
     where rut_clave = p_clave
       and ((v_nombre <> '' and public.ci_nombre_clave(nombre) = public.ci_nombre_clave(v_nombre))
            or (v_nombre = '' and v_tel <> '' and telefono = v_tel))
     order by (estado = 'vigente') desc, (telefono = v_tel) desc, confirmado_manual desc, ultima_oc_fecha desc nulls last limit 1;
  end if;
  if found then
    v_nueva_oc := false;
    if p_oc is not null then
      insert into public.contactos_institucionales_oc (contacto_id, oc_id, correo_en_oc, origen)
      values (x.id, p_oc, v_correo, p_origen) on conflict do nothing;
      v_nueva_oc := found;
    end if;
    v_mas_nueva := p_fecha is not null and (x.ultima_oc_fecha is null or p_fecha > x.ultima_oc_fecha);
    if x.estado = 'obsoleto' then
      if v_nueva_oc and v_mas_nueva then
        perform public.ci_contexto('vinculo_oc', p_origen, p_oc, p_usuario);
        update public.contactos_institucionales set ultima_oc = p_oc, ultima_oc_fecha = p_fecha where id = x.id;
      end if;
      return jsonb_build_object('accion','correo_obsoleto','id',x.id,'correo',x.correo,'reemplazado_por',x.reemplazado_por);
    end if;
    perform public.ci_contexto(case when x.confirmado_manual then 'vinculo_oc' else 'actualizado_desde_oc' end, p_origen, p_oc, p_usuario);
    update public.contactos_institucionales set
      -- confirmado manual: solo se completa lo vacío. No confirmado: una OC más reciente actualiza.
      nombre   = case when nombre = '' or (not x.confirmado_manual and v_mas_nueva and v_nombre <> ''
                                            and public.ci_nombre_clave(v_nombre) <> public.ci_nombre_clave(nombre)) then coalesce(nullif(v_nombre,''), nombre) else nombre end,
      cargo    = case when cargo = '' or (not x.confirmado_manual and v_mas_nueva and v_cargo <> '') then coalesce(nullif(v_cargo,''), cargo) else cargo end,
      telefono = case when telefono = '' or (not x.confirmado_manual and v_mas_nueva and v_tel <> '') then coalesce(nullif(v_tel,''), telefono) else telefono end,
      ultima_oc = case when v_nueva_oc and v_mas_nueva then p_oc else ultima_oc end,
      ultima_oc_fecha = case when v_nueva_oc and v_mas_nueva then p_fecha else ultima_oc_fecha end,
      oc_origen = coalesce(oc_origen, p_oc),
      actualizado_por = coalesce(p_usuario, actualizado_por)
    where id = x.id
    returning * into y;
    return jsonb_build_object('accion', case when to_jsonb(y) - 'actualizado_en' - 'actualizado_por' - 'ultima_oc' - 'ultima_oc_fecha' - 'oc_origen'
                                              = to_jsonb(x) - 'actualizado_en' - 'actualizado_por' - 'ultima_oc' - 'ultima_oc_fecha' - 'oc_origen' then 'existente' else 'actualizado' end,
      'id', x.id, 'estado', x.estado,
      'difiere_de_manual', x.confirmado_manual and ((v_tel <> '' and x.telefono <> '' and v_tel <> x.telefono)
                                                     or (v_nombre <> '' and x.nombre <> '' and public.ci_nombre_clave(v_nombre) <> public.ci_nombre_clave(x.nombre))));
  end if;

  -- 2) correo nuevo para esta institución
  v_estado := 'vigente'; v_motivo := null; y := null;
  if v_nombre <> '' and v_correo <> '' then
    select * into y from public.contactos_institucionales
     where rut_clave = p_clave and estado in ('vigente','pendiente') and correo_clave <> ''
       and public.ci_nombre_clave(nombre) = public.ci_nombre_clave(v_nombre)
     order by (estado = 'vigente') desc, confirmado_manual desc, ultima_oc_fecha desc nulls last limit 1;
    if found then
      v_estado := 'pendiente';
      v_motivo := case when y.confirmado_manual then 'contradice_manual'
                       when p_fecha is not null and y.ultima_oc_fecha is not null and p_fecha < y.ultima_oc_fecha then 'correo_de_oc_anterior'
                       else 'cambio_correo' end;
    end if;
  end if;
  -- sin nombre y con contactos vigentes: en duda → pendiente. Excepción: correos de cobranza (los escribió BFK a mano
  -- al reclamar un pago a esa institución), que quedan como contacto adicional sin nombre.
  if v_motivo is null and v_nombre = '' and p_origen <> 'cobranza' then
    select count(*) into n_vig from public.contactos_institucionales where rut_clave = p_clave and estado = 'vigente';
    if n_vig > 0 then v_estado := 'pendiente'; v_motivo := 'sin_nombre'; end if;
  end if;

  v_acc := case v_motivo when 'contradice_manual' then 'conflicto_manual' when 'cambio_correo' then 'cambio_detectado'
                         when 'correo_de_oc_anterior' then 'cambio_detectado' when 'sin_nombre' then 'pendiente_verificacion'
                         else 'nuevo' end;
  perform public.ci_contexto('alta_desde_oc:' || v_acc, p_origen, p_oc, p_usuario);
  insert into public.contactos_institucionales (rut_clave, rut, nombre, cargo, correo, telefono, estado, origen,
         motivo_pendiente, conflicto_con, oc_origen, ultima_oc, ultima_oc_fecha, creado_por, actualizado_por)
  values (p_clave, public.ci_rut_formato(p_clave), v_nombre, v_cargo, v_correo, v_tel, v_estado, p_origen,
          v_motivo, case when v_motivo in ('contradice_manual','cambio_correo','correo_de_oc_anterior') then y.id end,
          p_oc, p_oc, p_fecha, p_usuario, p_usuario)
  returning id into v_id;
  if p_oc is not null then
    insert into public.contactos_institucionales_oc (contacto_id, oc_id, correo_en_oc, origen) values (v_id, p_oc, v_correo, p_origen);
  end if;
  return jsonb_build_object('accion', v_acc, 'id', v_id, 'estado', v_estado, 'conflicto_con', y.id,
                            'correo_anterior', y.correo, 'nombre', v_nombre, 'correo', v_correo);
end $_$;

-- Separa "Nombre · Fono" (formato que guarda la app desde Mercado Público) y la lista de correos.
create function public.ci_conciliar_datos(
  p_clave text, p_oc text, p_fecha timestamptz, p_origen text, p_usuario uuid,
  p_contacto text, p_cargo text, p_correos text) returns jsonb
  language plpgsql
  set search_path to 'public', 'pg_temp'
as $_$
declare
  v_partes text[] := regexp_split_to_array(btrim(coalesce(p_contacto,'')), '\s*·\s*');
  v_nombre text := btrim(coalesce(v_partes[1],''));
  v_tel text := btrim(coalesce(array_to_string(v_partes[2:], ' '),''));
  v_lista text[]; v_c text; i int := 0; v_res jsonb := '[]'::jsonb;
begin
  if v_nombre ~ '^[+0-9 ()\-]{6,}$' and v_tel = '' then v_tel := v_nombre; v_nombre := ''; end if;   -- solo venía el teléfono
  select coalesce(array_agg(distinct c), '{}') into v_lista from (
    select lower(btrim(c)) c from regexp_split_to_table(coalesce(p_correos,''), '[,;\s]+') c where btrim(c) <> '') s;
  -- el nombre y teléfono del contacto de la OC se asignan al primer correo; los demás quedan sin nombre
  if array_length(v_lista,1) is null then
    if v_nombre <> '' or v_tel <> '' then
      v_res := v_res || public.ci_conciliar_uno(p_clave, p_oc, p_fecha, p_origen, p_usuario, v_nombre, p_cargo, '', v_tel);
    end if;
  else
    -- orden estable: el correo que aparece primero en la OC
    for v_c in select lower(btrim(c)) from regexp_split_to_table(coalesce(p_correos,''), '[,;\s]+') with ordinality t(c, o)
               where btrim(c) <> '' group by lower(btrim(c)) order by min(o) loop
      i := i + 1;
      v_res := v_res || public.ci_conciliar_uno(p_clave, p_oc, p_fecha, p_origen, p_usuario,
                        case when i = 1 then v_nombre else '' end, case when i = 1 then p_cargo else '' end,
                        v_c, case when i = 1 then v_tel else '' end);
    end loop;
  end if;
  return v_res;
end $_$;

-- ---------- RPC: conciliar los contactos de una OC (al ingresarla o sincronizarla) ----------
-- Lee el RUT, contacto y correo DESDE LA OC guardada (no inventa relaciones ni acepta otro RUT).
-- p_origen: 'mp' cuando los datos vienen de Mercado Público; 'oc' cuando se escribieron en la OC.
create function public.conciliar_contactos_oc(p_oc_id text, p_origen text default 'mp', p_cargo text default null) returns jsonb
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare
  v_uid uuid := public.ci_exigir_sesion();
  o record; v_clave text; v_fecha timestamptz; v_res jsonb;
begin
  if p_origen not in ('mp','oc') then raise exception 'CONTACTO_RECHAZADO: origen no válido' using errcode = 'CI004'; end if;
  select id, rut_cliente, contacto, correo_cliente, fecha_hora_emision_mp, fecha_emision_mp, "creadoEn"
    into o from public.ordenes_compra_v2 where id = p_oc_id;
  if not found then return jsonb_build_object('ok', false, 'accion', 'oc_no_existe'); end if;
  v_clave := public.ci_rut_clave(o.rut_cliente);
  if btrim(coalesce(o.rut_cliente,'')) = '' then return jsonb_build_object('ok', true, 'accion', 'sin_rut'); end if;
  if v_clave is null then return jsonb_build_object('ok', true, 'accion', 'rut_invalido'); end if;
  if length(coalesce(p_cargo,'')) > 200 then p_cargo := left(p_cargo, 200); end if;
  perform pg_advisory_xact_lock(hashtext('contactos_inst:' || v_clave));
  v_fecha := coalesce(o.fecha_hora_emision_mp::timestamptz, o.fecha_emision_mp::timestamptz, o."creadoEn");
  v_res := public.ci_conciliar_datos(v_clave, o.id, v_fecha, p_origen, v_uid, o.contacto, p_cargo, o.correo_cliente);
  return jsonb_build_object('ok', true, 'accion', 'conciliada', 'rut_clave', v_clave, 'resultados', v_res);
end $_$;

-- ---------- RPC: alta o corrección manual (queda confirmada manualmente) ----------
-- p_datos: nombre, cargo, departamento, correo, telefono, es_principal, alcance ('institucion'|'oc'),
--          oc_exclusiva, reactivar (bool). p_oc_id: OC desde cuya ficha se hizo (queda vinculada).
create function public.guardar_contacto_institucional(p_id uuid, p_rut text, p_datos jsonb, p_oc_id text default null) returns jsonb
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare
  v_uid uuid := public.ci_exigir_sesion();
  v_clave text; x public.contactos_institucionales%rowtype; v_id uuid; v_viejo uuid;
  v_correo text; v_alc text; v_ocx text; v_princ boolean; v_dup uuid;
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_datos,'{}'::jsonb)) loop
    if k not in ('nombre','cargo','departamento','correo','telefono','es_principal','alcance','oc_exclusiva','reactivar') then
      raise exception 'CONTACTO_RECHAZADO: campo no permitido %', k using errcode = 'CI004';
    end if;
  end loop;
  if p_id is not null then
    select * into x from public.contactos_institucionales where id = p_id for update;
    if not found then raise exception 'CONTACTO_RECHAZADO: el contacto no existe' using errcode = 'CI005'; end if;
    v_clave := x.rut_clave;
    if btrim(coalesce(p_rut,'')) <> '' and public.ci_rut_clave(p_rut) is distinct from v_clave then
      raise exception 'CONTACTO_RECHAZADO: un contacto no puede cambiar de institución' using errcode = 'CI001';
    end if;
    if x.estado = 'obsoleto' and not coalesce((p_datos->>'reactivar')::boolean, false) then
      raise exception 'CONTACTO_RECHAZADO: el contacto está obsoleto; reactívalo para corregirlo' using errcode = 'CI006';
    end if;
  else
    v_clave := public.ci_rut_clave(p_rut);
    if v_clave is null then raise exception 'CONTACTO_RECHAZADO: el RUT de la institución no es válido' using errcode = 'CI007'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('contactos_inst:' || v_clave));

  if coalesce(p_datos->>'correo','') <> '' and btrim(p_datos->>'correo') !~* '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then
    raise exception 'CONTACTO_RECHAZADO: el correo «%» no es válido (un correo por contacto)', btrim(p_datos->>'correo') using errcode = 'CI010';
  end if;
  if greatest(length(coalesce(p_datos->>'nombre','')), length(coalesce(p_datos->>'cargo','')), length(coalesce(p_datos->>'departamento','')),
              length(coalesce(p_datos->>'correo',''))) > 200 or length(coalesce(p_datos->>'telefono','')) > 60 then
    raise exception 'CONTACTO_RECHAZADO: texto demasiado largo' using errcode = 'CI010';
  end if;
  if p_id is null and btrim(coalesce(p_datos->>'correo','')) = '' and btrim(coalesce(p_datos->>'nombre','')) = '' and btrim(coalesce(p_datos->>'telefono','')) = '' then
    raise exception 'CONTACTO_RECHAZADO: indica al menos un nombre, correo o teléfono' using errcode = 'CI010';
  end if;

  v_correo := lower(btrim(coalesce(p_datos->>'correo', x.correo, '')));
  v_alc := coalesce(p_datos->>'alcance', x.alcance, 'institucion');
  v_ocx := case when v_alc = 'oc' then coalesce(nullif(p_datos->>'oc_exclusiva',''), x.oc_exclusiva, p_oc_id) end;
  v_princ := coalesce((p_datos->>'es_principal')::boolean, x.es_principal, false) and v_alc = 'institucion';
  if v_ocx is not null and not exists (select 1 from public.ordenes_compra_v2 o where o.id = v_ocx and public.ci_rut_clave(o.rut_cliente) = v_clave) then
    raise exception 'CONTACTO_RECHAZADO: la OC exclusiva no pertenece a esta institución' using errcode = 'CI008';
  end if;
  if p_oc_id is not null and not exists (select 1 from public.ordenes_compra_v2 o where o.id = p_oc_id and public.ci_rut_clave(o.rut_cliente) = v_clave) then
    raise exception 'CONTACTO_RECHAZADO: la OC no pertenece a esta institución' using errcode = 'CI008';
  end if;
  if v_correo <> '' then
    select id into v_dup from public.contactos_institucionales where rut_clave = v_clave and correo_clave = v_correo and id is distinct from p_id;
    if found then
      raise exception 'CONTACTO_DUPLICADO: ese correo ya está registrado para esta institución' using errcode = 'CI009', detail = v_dup::text;
    end if;
  end if;
  if v_princ then      -- un solo principal por institución: el anterior pasa a secundario
    perform public.ci_contexto('cambio_principal', 'manual', p_oc_id, v_uid);
    update public.contactos_institucionales set es_principal = false, actualizado_por = v_uid
     where rut_clave = v_clave and es_principal and id is distinct from p_id;
  end if;

  if p_id is null then
    perform public.ci_contexto('alta_manual', 'manual', p_oc_id, v_uid);
    insert into public.contactos_institucionales (rut_clave, rut, nombre, cargo, departamento, correo, telefono, estado, origen,
           confirmado_manual, confirmado_por, confirmado_en, es_principal, alcance, oc_exclusiva, oc_origen, creado_por, actualizado_por)
    values (v_clave, public.ci_rut_formato(v_clave), btrim(coalesce(p_datos->>'nombre','')), btrim(coalesce(p_datos->>'cargo','')),
            btrim(coalesce(p_datos->>'departamento','')), v_correo, btrim(coalesce(p_datos->>'telefono','')), 'vigente', 'manual',
            true, v_uid, now(), v_princ, v_alc, v_ocx, p_oc_id, v_uid, v_uid)
    returning id into v_id;
  else
    v_id := p_id;
    perform public.ci_contexto(case when x.estado = 'obsoleto' then 'reactivado_manual' else 'correccion_manual' end, 'manual', p_oc_id, v_uid);
    update public.contactos_institucionales set
      nombre = btrim(coalesce(p_datos->>'nombre', nombre)), cargo = btrim(coalesce(p_datos->>'cargo', cargo)),
      departamento = btrim(coalesce(p_datos->>'departamento', departamento)), correo = v_correo,
      telefono = btrim(coalesce(p_datos->>'telefono', telefono)),
      estado = 'vigente', motivo_pendiente = null, conflicto_con = null, obsoleto_motivo = null, reemplazado_por = null,
      confirmado_manual = true, confirmado_por = v_uid, confirmado_en = now(),
      es_principal = v_princ, alcance = v_alc, oc_exclusiva = v_ocx, actualizado_por = v_uid
    where id = p_id;
    -- correo corregido: el correo anterior queda como OBSOLETO (así una OC futura con el correo malo no lo revive)
    if x.correo_clave <> '' and x.correo_clave <> v_correo then
      perform public.ci_contexto('correo_anterior_obsoleto', 'manual', p_oc_id, v_uid);
      insert into public.contactos_institucionales (rut_clave, rut, nombre, cargo, departamento, correo, telefono, estado, origen,
             alcance, oc_exclusiva, reemplazado_por, obsoleto_motivo, oc_origen, ultima_oc, ultima_oc_fecha, creado_por, actualizado_por)
      values (x.rut_clave, x.rut, x.nombre, x.cargo, x.departamento, x.correo, x.telefono, 'obsoleto', x.origen,
              x.alcance, x.oc_exclusiva, p_id, 'correo corregido manualmente', x.oc_origen, x.ultima_oc, x.ultima_oc_fecha, x.creado_por, v_uid)
      returning id into v_viejo;
      -- las OC que respaldaban el correo anterior quedan vinculadas a ese registro (la OC en sí no se toca)
      update public.contactos_institucionales_oc set contacto_id = v_viejo where contacto_id = p_id and correo_en_oc = x.correo_clave;
    end if;
  end if;
  if p_oc_id is not null then
    insert into public.contactos_institucionales_oc (contacto_id, oc_id, correo_en_oc, origen)
    values (v_id, p_oc_id, v_correo, 'manual') on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'correo_anterior_obsoleto', v_viejo);
end $_$;

-- ---------- RPC: resolver un contacto pendiente ----------
-- 'reemplaza': el pendiente pasa a vigente (confirmado) y el contacto con el que choca queda obsoleto.
-- 'adicional': el pendiente pasa a vigente (confirmado) y el otro se mantiene.
-- 'descartar': el pendiente queda obsoleto (no se borra; una OC futura con ese correo no lo revive).
create function public.resolver_contacto_pendiente(p_id uuid, p_decision text, p_motivo text default null) returns jsonb
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare
  v_uid uuid := public.ci_exigir_sesion();
  x public.contactos_institucionales%rowtype; v_otro public.contactos_institucionales%rowtype;
begin
  select * into x from public.contactos_institucionales where id = p_id for update;
  if not found then raise exception 'CONTACTO_RECHAZADO: el contacto no existe' using errcode = 'CI005'; end if;
  if x.estado <> 'pendiente' then raise exception 'CONTACTO_RECHAZADO: el contacto no está pendiente' using errcode = 'CI006'; end if;
  perform pg_advisory_xact_lock(hashtext('contactos_inst:' || x.rut_clave));
  if p_decision = 'reemplaza' then
    if x.conflicto_con is null then raise exception 'CONTACTO_RECHAZADO: no hay un contacto anterior que reemplazar' using errcode = 'CI006'; end if;
    select * into v_otro from public.contactos_institucionales where id = x.conflicto_con for update;
    perform public.ci_contexto('reemplazado', 'manual', x.ultima_oc, v_uid);
    update public.contactos_institucionales set estado = 'obsoleto', es_principal = false, reemplazado_por = x.id,
           motivo_pendiente = null, conflicto_con = null,
           obsoleto_motivo = coalesce(nullif(btrim(p_motivo),''), 'reemplazado por un correo más reciente'), actualizado_por = v_uid
     where id = v_otro.id and estado <> 'obsoleto';
    perform public.ci_contexto('reemplazo_confirmado', 'manual', x.ultima_oc, v_uid);
    update public.contactos_institucionales set estado = 'vigente', motivo_pendiente = null, conflicto_con = null,
           confirmado_manual = true, confirmado_por = v_uid, confirmado_en = now(),
           es_principal = coalesce(v_otro.es_principal, false) and v_otro.estado = 'vigente',
           cargo = case when cargo = '' then coalesce(v_otro.cargo,'') else cargo end,
           departamento = case when departamento = '' then coalesce(v_otro.departamento,'') else departamento end,
           telefono = case when telefono = '' then coalesce(v_otro.telefono,'') else telefono end,
           actualizado_por = v_uid
     where id = x.id;
  elsif p_decision = 'adicional' then
    perform public.ci_contexto('adicional_confirmado', 'manual', x.ultima_oc, v_uid);
    update public.contactos_institucionales set estado = 'vigente', motivo_pendiente = null, conflicto_con = null,
           confirmado_manual = true, confirmado_por = v_uid, confirmado_en = now(), actualizado_por = v_uid
     where id = x.id;
  elsif p_decision = 'descartar' then
    perform public.ci_contexto('descartado', 'manual', x.ultima_oc, v_uid);
    update public.contactos_institucionales set estado = 'obsoleto', motivo_pendiente = null,
           obsoleto_motivo = coalesce(nullif(btrim(p_motivo),''), 'descartado al revisar'), actualizado_por = v_uid
     where id = x.id;
  else
    raise exception 'CONTACTO_RECHAZADO: decisión no válida' using errcode = 'CI004';
  end if;
  return jsonb_build_object('ok', true, 'id', x.id, 'decision', p_decision);
end $_$;

create function public.marcar_contacto_obsoleto(p_id uuid, p_motivo text default null, p_reemplazo uuid default null) returns jsonb
  language plpgsql security definer
  set search_path to 'public', 'pg_temp'
as $_$
declare v_uid uuid := public.ci_exigir_sesion(); x public.contactos_institucionales%rowtype;
begin
  select * into x from public.contactos_institucionales where id = p_id for update;
  if not found then raise exception 'CONTACTO_RECHAZADO: el contacto no existe' using errcode = 'CI005'; end if;
  if p_reemplazo is not null and not exists (select 1 from public.contactos_institucionales r
       where r.id = p_reemplazo and r.rut_clave = x.rut_clave and r.estado = 'vigente' and r.id <> x.id) then
    raise exception 'CONTACTO_RECHAZADO: el reemplazo debe ser un contacto vigente de la misma institución' using errcode = 'CI008';
  end if;
  perform public.ci_contexto('marcado_obsoleto', 'manual', null, v_uid);
  update public.contactos_institucionales set estado = 'obsoleto', es_principal = false, motivo_pendiente = null, conflicto_con = null,
         reemplazado_por = p_reemplazo, obsoleto_motivo = coalesce(nullif(btrim(p_motivo),''), 'marcado obsoleto manualmente'),
         actualizado_por = v_uid
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $_$;

-- ---------- catálogo: ya no se sobrescribe el contacto/correo con cada OC ----------
create or replace function public.registrar_entidad_desde_oc(p_rut text, p_nombre_entidad text DEFAULT NULL::text, p_comuna text DEFAULT NULL::text, p_contacto text DEFAULT NULL::text, p_correo text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare
  v_uid uuid := auth.uid();
  l text; b text; d text; s int := 0; f int := 2; r int; i int;
  v_clave text; v_rut text; n int;
  v_ex public.entidades_catalogo%rowtype;
  v_nombre text := nullif(btrim(coalesce(p_nombre_entidad,'')), '');
  v_comuna text := nullif(btrim(coalesce(p_comuna,'')), '');
  v_contacto text := nullif(btrim(coalesce(p_contacto,'')), '');
  v_correo text := nullif(btrim(coalesce(p_correo,'')), '');
  c_nombre text; c_comuna text; c_contacto text; c_correo text;
  v_id text;
begin
  if v_uid is null then
    raise exception 'ENTIDAD_RECHAZADA: se requiere una sesión válida' using errcode = 'IE003';
  end if;
  if not exists (select 1 from public.perfiles where id = v_uid) then
    raise exception 'ENTIDAD_RECHAZADA: usuario sin perfil' using errcode = 'IE003';
  end if;

  -- RUT: limpiar y validar (no se corrige ni se completa nada)
  l := upper(regexp_replace(coalesce(p_rut,''), '[\s.\-‐-―]', '', 'g'));
  if l = '' then return jsonb_build_object('ok', true, 'accion', 'sin_rut'); end if;
  if l !~ '^[0-9]+[0-9K]$' then return jsonb_build_object('ok', true, 'accion', 'rut_invalido'); end if;
  b := ltrim(left(l, -1), '0'); d := right(l, 1);
  if b !~ '^[0-9]{7,8}$' or b::bigint < 1000000 then return jsonb_build_object('ok', true, 'accion', 'rut_invalido'); end if;
  for i in reverse length(b) .. 1 loop s := s + substr(b, i, 1)::int * f; f := case when f = 7 then 2 else f + 1 end; end loop;
  r := 11 - s % 11;
  if (case r when 11 then '0' when 10 then 'K' else r::text end) <> d then
    return jsonb_build_object('ok', true, 'accion', 'rut_invalido');
  end if;
  v_clave := b || d;
  v_rut := case when length(b) = 8 then substr(b,1,2)||'.'||substr(b,3,3)||'.'||substr(b,6,3) else substr(b,1,1)||'.'||substr(b,2,3)||'.'||substr(b,5,3) end || '-' || d;

  -- Textos
  if greatest(length(coalesce(v_nombre,'')), length(coalesce(v_comuna,'')), length(coalesce(v_contacto,'')), length(coalesce(v_correo,''))) > 200
     or concat(v_nombre, v_comuna, v_contacto, v_correo) ~ '[\x00-\x08\x0B\x0C\x0E-\x1F]' then
    return jsonb_build_object('ok', true, 'accion', 'datos_invalidos');
  end if;

  perform pg_advisory_xact_lock(hashtext('entidad_desde_oc:' || v_clave));

  select count(*) into n from public.entidades_catalogo e
   where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;

  if n > 1 then
    return jsonb_build_object('ok', true, 'accion', 'ambigua', 'coincidencias', n);
  end if;

  if n = 1 then
    select * into v_ex from public.entidades_catalogo e
     where regexp_replace(regexp_replace(upper(e.rut), '[^0-9K]', '', 'g'), '^0+(?=.)', '') = v_clave;
    c_nombre   := case when v_nombre   is not null and v_nombre   is distinct from btrim(coalesce(v_ex.nombre_entidad,'')) then v_nombre end;
    c_comuna   := case when v_comuna   is not null and v_comuna   is distinct from btrim(coalesce(v_ex.comuna,''))         then v_comuna end;
    -- Contactos institucionales (21/10/2026): contacto y correo del catálogo solo se COMPLETAN si están vacíos.
    -- Los correos nuevos de cada OC se concilian en contactos_institucionales (con historial y pendientes).
    c_contacto := case when v_contacto is not null and btrim(coalesce(v_ex.contacto,'')) = '' then v_contacto end;
    c_correo   := case when v_correo   is not null and btrim(coalesce(v_ex.correo,''))   = '' then v_correo end;
    if c_nombre is null and c_comuna is null and c_contacto is null and c_correo is null then
      return jsonb_build_object('ok', true, 'accion', 'sin_cambios', 'id', v_ex.id);
    end if;
    update public.entidades_catalogo set               -- el RUT NUNCA se modifica aquí
      nombre_entidad = coalesce(c_nombre, nombre_entidad),
      comuna = coalesce(c_comuna, comuna),
      contacto = coalesce(c_contacto, contacto),
      correo = coalesce(c_correo, correo)
    where id = v_ex.id;
    return jsonb_build_object('ok', true, 'accion', 'actualizada', 'id', v_ex.id,
      'campos', to_jsonb(array_remove(array[case when c_nombre is not null then 'nombre_entidad' end, case when c_comuna is not null then 'comuna' end,
                                             case when c_contacto is not null then 'contacto' end, case when c_correo is not null then 'correo' end], null)));
  end if;

  v_id := 'ent_' || (extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_' || substr(md5(random()::text || v_clave), 1, 5);
  insert into public.entidades_catalogo (id, rut, nombre_entidad, comuna, contacto, correo, creado_por)
  values (v_id, v_rut, coalesce(v_nombre, ''), coalesce(v_comuna, ''), coalesce(v_contacto, ''), coalesce(v_correo, ''), v_uid);
  return jsonb_build_object('ok', true, 'accion', 'creada', 'id', v_id);
end;
$_$;

-- ---------- seguridad: lectura para usuarios con perfil; escritura SOLO por las RPC ----------
alter table public.contactos_institucionales enable row level security;
alter table public.contactos_institucionales_oc enable row level security;
alter table public.contactos_institucionales_historial enable row level security;
create policy ci_leer on public.contactos_institucionales for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid()));
create policy ci_oc_leer on public.contactos_institucionales_oc for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid()));
create policy ci_hist_leer on public.contactos_institucionales_historial for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid()));

revoke all on public.contactos_institucionales, public.contactos_institucionales_oc, public.contactos_institucionales_historial from public, anon, authenticated;
grant select on public.contactos_institucionales, public.contactos_institucionales_oc, public.contactos_institucionales_historial to authenticated;
grant all on public.contactos_institucionales, public.contactos_institucionales_oc, public.contactos_institucionales_historial to service_role;
grant usage, select on sequence public.contactos_institucionales_historial_id_seq to service_role;

revoke all on function public.ci_rut_clave(text), public.ci_rut_formato(text), public.ci_nombre_clave(text),
  public.ci_trg_historial(), public.ci_trg_no_borrar(), public.ci_exigir_sesion(), public.ci_contexto(text,text,text,uuid),
  public.ci_conciliar_uno(text,text,timestamptz,text,uuid,text,text,text,text),
  public.ci_conciliar_datos(text,text,timestamptz,text,uuid,text,text,text),
  public.conciliar_contactos_oc(text,text,text), public.guardar_contacto_institucional(uuid,text,jsonb,text),
  public.resolver_contacto_pendiente(uuid,text,text), public.marcar_contacto_obsoleto(uuid,text,uuid) from public, anon, authenticated;
revoke all on sequence public.contactos_institucionales_historial_id_seq from public, anon, authenticated;
-- funciones puras usadas por índices/checks: ejecutables por quien lee o escribe la tabla
grant execute on function public.ci_rut_clave(text), public.ci_rut_formato(text), public.ci_nombre_clave(text) to authenticated, service_role;
grant execute on function public.conciliar_contactos_oc(text,text,text), public.guardar_contacto_institucional(uuid,text,jsonb,text),
  public.resolver_contacto_pendiente(uuid,text,text), public.marcar_contacto_obsoleto(uuid,text,uuid) to authenticated, service_role;
grant execute on function public.ci_trg_historial(), public.ci_trg_no_borrar(), public.ci_exigir_sesion(), public.ci_contexto(text,text,text,uuid),
  public.ci_conciliar_uno(text,text,timestamptz,text,uuid,text,text,text,text),
  public.ci_conciliar_datos(text,text,timestamptz,text,uuid,text,text,text) to service_role;

-- ---------- verificación dentro de la misma transacción (si algo falta, no se instala nada) ----------
do $_$
begin
  if (select count(*) from pg_tables where schemaname = 'public' and tablename like 'contactos_institucionales%') <> 3 then
    raise exception 'VERIFICACION: faltan tablas de contactos institucionales'; end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename like 'contactos_institucionales%') <> 3 then
    raise exception 'VERIFICACION: faltan políticas RLS'; end if;
  if has_table_privilege('anon', 'public.contactos_institucionales', 'select')
     or has_table_privilege('authenticated', 'public.contactos_institucionales', 'insert')
     or has_table_privilege('authenticated', 'public.contactos_institucionales', 'update')
     or has_table_privilege('authenticated', 'public.contactos_institucionales_historial', 'delete') then
    raise exception 'VERIFICACION: permisos de tabla más amplios de lo previsto'; end if;
  if not has_function_privilege('authenticated', 'public.conciliar_contactos_oc(text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.conciliar_contactos_oc(text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ci_conciliar_uno(text,text,timestamptz,text,uuid,text,text,text,text)', 'execute') then
    raise exception 'VERIFICACION: permisos de funciones incorrectos'; end if;
end $_$;

commit;
