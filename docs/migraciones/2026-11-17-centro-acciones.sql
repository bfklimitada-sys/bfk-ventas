-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 17/11/2026 · Centro de Acciones Pendientes (amplía el Seguimiento Especial; NO crea un segundo sistema)
--
-- Una sola tabla de gestión: public.oc_seguimientos. Cada fila es una «acción» con o sin OC.
--   · oc_id pasa a ser opcional (acciones sin OC); una acción sin OC exige título.
--   · Columnas nuevas: titulo, cliente (solo sin OC; con OC el cliente es el de la OC), origen + origen_id (acciones automáticas).
--   · Categorías en un catálogo (public.acciones_categorias): se agregan o desactivan sin tocar los registros existentes.
--     Los ids actuales se conservan (postventa, sobrecosto, proveedor, producto, entrega, cliente, facturacion, otro).
--   · Historial de modificaciones en la base (historial_cambios, campo 'seguimiento:<id>'): creación, cada cambio de título,
--     descripción, categoría, prioridad, responsable, vencimiento, cliente, estado, resolución, reapertura y eliminación,
--     con fecha y usuario. Avances/comentarios los sigue registrando la app en la misma bitácora.
--   · Reabrir: cualquier usuario BFK puede reabrir una acción resuelta (solo el cambio de estado; lo demás de una acción
--     resuelta sigue siendo solo de administradores). La solución anterior queda en el historial.
--   · Asignar responsable genera un aviso «Para ti» al usuario asignado (tabla notificaciones), salvo que se asigne a sí mismo.
--
-- Acciones automáticas (solo con información real registrada; sin suposiciones; sin duplicados):
--   1. Incidente de postventa ABIERTO (eventos_postventa) en una OC no archivada → UNA acción «Postventa, garantías y
--      reclamos» por incidente (índice único). Incidente cerrado → la acción se resuelve sola; reabierto → se reabre;
--      eliminado → se resuelve con esa nota. Resolver la acción NO cierra el incidente ni cambia la OC.
--   2. Entrega fallida registrada desde la app (aviso de entrega fallida con lugar y motivo) → función
--      acc_registrar_entrega_fallida: UNA acción abierta por OC (índice único parcial); un nuevo intento fallido se anota en
--      su historial. Al registrar la entrega de la OC (eventos_entrega) la acción se resuelve sola.
--   No hay generación retroactiva masiva: al instalar solo se crean acciones para los incidentes de postventa que HOY están
--   abiertos en OC no archivadas (en producción, 17/11/2026: 2). No se recorre ninguna otra OC histórica.
--
-- No modifica: OCs, compras, ventas, utilidades, comisiones, IVA/F29, pagos, cobranzas, financiamientos, devoluciones,
-- liquidaciones ni estados históricos. Ninguna función de esta migración escribe en esas tablas.
-- Se ejecuta en UNA transacción (begin/commit de este archivo). Deshacer: 2026-11-17-centro-acciones-deshacer.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$
begin
  if to_regclass('public.oc_seguimientos') is null then raise exception 'ACC: falta public.oc_seguimientos (Seguimiento especial)'; end if;
  if exists (select 1 from pg_trigger where tgname = 'acc_historial' and tgrelid = 'public.oc_seguimientos'::regclass) then
    raise exception 'ACC: la migración ya está aplicada';
  end if;
  -- Las funciones automáticas (SECURITY DEFINER) deben pertenecer al dueño de la tabla para no depender de RLS.
  if current_user <> (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.oc_seguimientos'::regclass) then
    raise exception 'ACC: ejecute la migración con el dueño de oc_seguimientos (%), no con %',
      (select pg_get_userbyid(c.relowner) from pg_class c where c.oid = 'public.oc_seguimientos'::regclass), current_user;
  end if;
end $$;

-- ── 1. Catálogo de categorías ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.acciones_categorias (
  id         text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  etiqueta   text not null check (length(btrim(etiqueta)) between 1 and 60),
  orden      integer not null default 100,
  activa     boolean not null default true,
  creado_en  timestamptz not null default now(),
  creado_por uuid
);
create unique index if not exists acciones_categorias_etiqueta_uk on public.acciones_categorias (lower(btrim(etiqueta)));
comment on table public.acciones_categorias is 'Centro de Acciones (17/11/2026): categorías de acciones. No se borran: una categoría en desuso se desactiva y los registros que la usan no cambian.';
insert into public.acciones_categorias (id, etiqueta, orden) values
  ('proveedor',      'Compras y proveedores',              10),
  ('entrega',        'Entregas y despachos',               20),
  ('postventa',      'Postventa, garantías y reclamos',    30),
  ('instalacion',    'Instalaciones y servicios técnicos', 40),
  ('facturacion',    'Facturación',                        50),
  ('cobranza',       'Cobranza',                           60),
  ('comercial',      'Gestiones comerciales',              70),
  ('administrativa', 'Otras tareas administrativas',       80),
  ('sobrecosto',     'Sobrecosto / Cargo adicional',      110),
  ('producto',       'Producto',                          120),
  ('cliente',        'Cliente',                           130),
  ('otro',           'Otro',                              140)
on conflict (id) do nothing;   -- tras un «deshacer» que conservó la estructura, el catálogo ya existe

create or replace function public.acc_categoria_guardar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and new.id <> old.id then raise exception 'ACC: el código de una categoría no se cambia (solo su nombre, orden o estado)'; end if;
  new.etiqueta := btrim(new.etiqueta);
  if tg_op = 'INSERT' then new.creado_en := now(); new.creado_por := auth.uid(); else new.creado_en := old.creado_en; new.creado_por := old.creado_por; end if;
  return new;
end $$;
drop trigger if exists acc_categoria_guardar on public.acciones_categorias;
create trigger acc_categoria_guardar before insert or update on public.acciones_categorias for each row execute function public.acc_categoria_guardar();
alter table public.acciones_categorias enable row level security;
drop policy if exists acc_cat_leen on public.acciones_categorias;
drop policy if exists acc_cat_admin_crea on public.acciones_categorias;
drop policy if exists acc_cat_admin_edita on public.acciones_categorias;
create policy acc_cat_leen on public.acciones_categorias for select to authenticated using (public.bfk_es_usuario());
create policy acc_cat_admin_crea on public.acciones_categorias for insert to authenticated with check (public.bfk_es_admin());
create policy acc_cat_admin_edita on public.acciones_categorias for update to authenticated using (public.bfk_es_admin()) with check (public.bfk_es_admin());
revoke all on public.acciones_categorias from anon, authenticated;
grant select, insert, update on public.acciones_categorias to authenticated;

-- ── 2. oc_seguimientos: acciones con o sin OC ─────────────────────────────────────────────────────────────
alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_categoria_check;
alter table public.oc_seguimientos alter column oc_id drop not null;
alter table public.oc_seguimientos
  add column if not exists titulo    text,
  add column if not exists cliente   text,
  add column if not exists origen    text,
  add column if not exists origen_id text;
do $$
declare c record;
begin
  -- (cada restricción se agrega solo si falta: la migración se puede volver a aplicar tras un «deshacer» que conservó la estructura)
  for c in select * from (values
    ('oc_seguimientos_categoria_fkey', 'foreign key (categoria) references public.acciones_categorias(id) on update restrict on delete restrict'),
    ('oc_seguimientos_titulo_check',   'check (titulo is null or length(btrim(titulo)) between 1 and 160)'),
    ('oc_seguimientos_cliente_check',  'check (cliente is null or length(btrim(cliente)) between 1 and 160)'),
    ('oc_seguimientos_sin_oc_titulo',  'check (oc_id is not null or titulo is not null)'),
    ('oc_seguimientos_origen_check',   'check ((origen is null and origen_id is null) or (origen in (''postventa'', ''entrega_fallida'') and origen_id is not null))')
  ) as x(nombre, def) loop
    if not exists (select 1 from pg_constraint where conrelid = 'public.oc_seguimientos'::regclass and conname = c.nombre) then
      execute format('alter table public.oc_seguimientos add constraint %I %s', c.nombre, c.def);
    end if;
  end loop;
end $$;
create unique index if not exists oc_seguimientos_origen_postventa_uk on public.oc_seguimientos (origen_id) where origen = 'postventa';
create unique index if not exists oc_seguimientos_fallida_abierta_uk on public.oc_seguimientos (oc_id) where origen = 'entrega_fallida' and estado <> 'resuelto';
create index if not exists oc_seguimientos_bandeja_idx on public.oc_seguimientos (prioridad, fecha_revision) where estado <> 'resuelto';
comment on column public.oc_seguimientos.oc_id is 'OC asociada (opcional desde el 17/11/2026: acciones sin OC).';
comment on column public.oc_seguimientos.fecha_revision is 'Vencimiento de la acción (en la ficha de la OC: fecha de revisión).';
comment on column public.oc_seguimientos.origen is 'null = registrada por un usuario; postventa / entrega_fallida = generada por el sistema desde un registro real.';
comment on table public.oc_seguimientos is 'Centro de Acciones y Seguimiento especial de OC: tareas operativas con o sin OC. sobrecosto_estimado es solo informativo: no es compra, gasto, deuda ni utilidad.';

-- ── 3. Reglas de guardado (reemplaza seg_antes_guardar conservando sus reglas) ──────────────────────────────
create or replace function public.seg_antes_guardar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_nombre text;
  -- Solicitud de la API (usuario) o proceso interno del sistema (funciones automáticas de esta migración, instalación).
  v_api boolean := current_user in ('anon', 'authenticated', 'authenticator', 'service_role');
  v_autor text;
begin
  if v_api and v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if v_uid is not null then select p.nombre into v_nombre from public.perfiles p where p.id = v_uid; end if;
  v_autor := case when v_api then coalesce(v_nombre, '') else 'Automático' end;
  new.titulo := nullif(btrim(coalesce(new.titulo, '')), '');
  new.cliente := nullif(btrim(coalesce(new.cliente, '')), '');
  if new.oc_id is not null then new.cliente := null; end if;   -- con OC, el cliente es el de la OC
  if new.oc_id is null and new.titulo is null then raise exception 'Una acción sin OC necesita un título'; end if;
  -- El nombre del responsable se toma del perfil (no del navegador).
  new.responsable_nombre := case when new.responsable_id is null then null else (select p.nombre from public.perfiles p where p.id = new.responsable_id) end;

  if tg_op = 'INSERT' then
    if v_api and new.origen is not null then raise exception 'Las acciones automáticas solo las genera el sistema'; end if;
    if not exists (select 1 from public.acciones_categorias c where c.id = new.categoria and c.activa) then
      raise exception 'La categoría «%» no está disponible', new.categoria;
    end if;
    new.creado_por := v_uid; new.creado_por_nombre := v_autor; new.creado_en := now();
    new.actualizado_por := null; new.actualizado_en := null;
    if new.estado = 'resuelto' then raise exception 'Un seguimiento se crea abierto (Pendiente o En gestión)'; end if;
    new.solucion := null; new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
    return new;
  end if;

  -- UPDATE
  if new.id <> old.id or new.oc_id is distinct from old.oc_id or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en or new.creado_por_nombre is distinct from old.creado_por_nombre
     or new.origen is distinct from old.origen or new.origen_id is distinct from old.origen_id then
    raise exception 'No se puede cambiar la OC, el origen, el autor ni la fecha de creación de un seguimiento';
  end if;
  if new.categoria <> old.categoria and not exists (select 1 from public.acciones_categorias c where c.id = new.categoria and c.activa) then
    raise exception 'La categoría «%» no está disponible', new.categoria;
  end if;
  if old.estado = 'resuelto' and v_api and not public.seg_es_admin() then
    -- Lo resuelto queda como historial: un usuario solo puede REABRIRLO (sin cambiar nada más en el mismo paso).
    if new.estado = 'resuelto'
       or (new.titulo, new.descripcion, new.categoria, new.prioridad, new.responsable_id, new.fecha_revision, new.sobrecosto_estimado, new.cliente)
          is distinct from (old.titulo, old.descripcion, old.categoria, old.prioridad, old.responsable_id, old.fecha_revision, old.sobrecosto_estimado, old.cliente) then
      raise exception 'Este seguimiento ya está resuelto: queda como historial (para modificarlo, reábralo primero; solo un administrador puede editarlo resuelto)';
    end if;
  end if;
  if new.estado = 'resuelto' and old.estado <> 'resuelto' then
    if length(btrim(coalesce(new.solucion, ''))) = 0 then raise exception 'Para resolver, describe brevemente la solución'; end if;
    new.solucion := btrim(new.solucion);
    new.resuelto_por := v_uid; new.resuelto_por_nombre := v_autor; new.resuelto_en := now();
  elsif new.estado <> 'resuelto' then
    -- abierta (o reabierta): sin solución vigente; la anterior queda en el historial
    new.solucion := null; new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
  else
    new.resuelto_por := old.resuelto_por; new.resuelto_por_nombre := old.resuelto_por_nombre; new.resuelto_en := old.resuelto_en;
  end if;
  new.actualizado_por := v_uid; new.actualizado_en := now();
  return new;
end $$;
revoke all on function public.seg_antes_guardar() from public, anon, authenticated;

-- ── 4. Historial de modificaciones (en la base: no depende del navegador) ─────────────────────────────────
create or replace function public.acc_txt_fecha(d date) returns text language sql immutable as $$ select case when d is null then '—' else to_char(d, 'DD/MM/YYYY') end $$;
create or replace function public.acc_txt_prioridad(p text) returns text language sql immutable as $$ select case p when 'alta' then 'Alta' when 'media' then 'Media' when 'baja' then 'Baja' else coalesce(p, '—') end $$;
create or replace function public.acc_txt_estado(e text) returns text language sql immutable as $$ select case e when 'pendiente' then 'Pendiente' when 'en_gestion' then 'En gestión' when 'resuelto' then 'Resuelta' else coalesce(e, '—') end $$;
create or replace function public.acc_txt_categoria(c text) returns text language sql stable set search_path = public, pg_temp as $$ select coalesce((select etiqueta from public.acciones_categorias where id = c), c) $$;
create or replace function public.acc_txt_pesos(n numeric) returns text language sql immutable as $$ select case when n is null then '—' else '$' || replace(to_char(n, 'FM999G999G999G990'), ',', '.') end $$;
-- Texto de la acción sin la marca interna de subsanación de factura.
create or replace function public.acc_txt_desc(t text) returns text language sql immutable as $$ select left(regexp_replace(coalesce(t, ''), '\n?⟦subsanacion[^⟧]*⟧\s*$', ''), 300) $$;

create or replace function public.acc_historial() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_nombre text; v_oc text; v_num text; v_campo text; v_quien text;
  v_api boolean := current_user in ('anon', 'authenticated', 'authenticator', 'service_role');
  r public.oc_seguimientos%rowtype;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  v_oc := r.oc_id; v_campo := 'seguimiento:' || r.id;
  if v_uid is not null then select p.nombre into v_nombre from public.perfiles p where p.id = v_uid; end if;
  v_quien := case when v_api then v_nombre else 'Automático' || coalesce(' (' || v_nombre || ')', '') end;
  if v_oc is not null then select o.numero_oc into v_num from public.ordenes_compra_v2 o where o.id = v_oc; end if;

  if tg_op = 'INSERT' then
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_nuevo)
    values ('hc_acc_' || replace(gen_random_uuid()::text, '-', ''), v_oc, v_num, v_uid, v_quien,
      case when new.origen is null then 'Acción: creada' else 'Acción: creada automáticamente' end
        || ' (' || public.acc_txt_categoria(new.categoria) || ' · prioridad ' || lower(public.acc_txt_prioridad(new.prioridad)) || ')',
      v_campo, coalesce(new.titulo || ': ', '') || public.acc_txt_desc(new.descripcion));
    if new.responsable_id is not null and new.responsable_id is distinct from v_uid then
      insert into public.notificaciones (id, usuario_id, tipo, oc_id, oc_numero, mensaje)
      values ('ntf_acc_' || replace(gen_random_uuid()::text, '-', ''), new.responsable_id, 'asignacion', v_oc, v_num,
        'Te asignaron la acción «' || left(coalesce(new.titulo, public.acc_txt_categoria(new.categoria)), 80) || '»' || coalesce(' de la OC ' || v_num, ''));
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior)
    values ('hc_acc_' || replace(gen_random_uuid()::text, '-', ''), v_oc, v_num, v_uid, v_quien, 'Acción: eliminada (administrador)', v_campo,
      coalesce(old.titulo || ': ', '') || public.acc_txt_desc(old.descripcion));
    return old;
  end if;

  insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
  select 'hc_acc_' || replace(gen_random_uuid()::text, '-', ''), v_oc, v_num, v_uid, v_quien, x.accion, v_campo, x.antes, x.despues
  from (values
    (1, old.titulo is distinct from new.titulo, 'Acción: título cambiado', old.titulo, new.titulo),
    (2, old.descripcion is distinct from new.descripcion, 'Acción: descripción cambiada', public.acc_txt_desc(old.descripcion), public.acc_txt_desc(new.descripcion)),
    (3, old.categoria is distinct from new.categoria, 'Acción: categoría cambiada', public.acc_txt_categoria(old.categoria), public.acc_txt_categoria(new.categoria)),
    (4, old.prioridad is distinct from new.prioridad, 'Acción: prioridad cambiada', public.acc_txt_prioridad(old.prioridad), public.acc_txt_prioridad(new.prioridad)),
    (5, old.responsable_id is distinct from new.responsable_id, 'Acción: responsable cambiado', coalesce(old.responsable_nombre, 'Sin asignar'), coalesce(new.responsable_nombre, 'Sin asignar')),
    (6, old.fecha_revision is distinct from new.fecha_revision, 'Acción: vencimiento cambiado', public.acc_txt_fecha(old.fecha_revision), public.acc_txt_fecha(new.fecha_revision)),
    (7, old.cliente is distinct from new.cliente, 'Acción: cliente cambiado', old.cliente, new.cliente),
    (8, old.sobrecosto_estimado is distinct from new.sobrecosto_estimado, 'Acción: sobrecosto estimado cambiado (informativo)', public.acc_txt_pesos(old.sobrecosto_estimado), public.acc_txt_pesos(new.sobrecosto_estimado)),
    (9, old.estado <> 'resuelto' and new.estado <> 'resuelto' and old.estado <> new.estado, 'Acción: estado cambiado', public.acc_txt_estado(old.estado), public.acc_txt_estado(new.estado)),
    (10, old.estado <> 'resuelto' and new.estado = 'resuelto', 'Acción: resuelta', public.acc_txt_estado(old.estado), new.solucion),
    (11, old.estado = 'resuelto' and new.estado <> 'resuelto', 'Acción: reabierta', 'Solución anterior: ' || coalesce(old.solucion, '—'), public.acc_txt_estado(new.estado)),
    (12, old.estado = 'resuelto' and new.estado = 'resuelto' and old.solucion is distinct from new.solucion, 'Acción: solución corregida (administrador)', old.solucion, new.solucion)
  ) as x(orden, cambio, accion, antes, despues)
  where x.cambio
  order by x.orden;

  if new.responsable_id is not null and new.responsable_id is distinct from old.responsable_id and new.responsable_id is distinct from v_uid and new.estado <> 'resuelto' then
    insert into public.notificaciones (id, usuario_id, tipo, oc_id, oc_numero, mensaje)
    values ('ntf_acc_' || replace(gen_random_uuid()::text, '-', ''), new.responsable_id, 'asignacion', v_oc, v_num,
      'Te asignaron la acción «' || left(coalesce(new.titulo, public.acc_txt_categoria(new.categoria)), 80) || '»' || coalesce(' de la OC ' || v_num, ''));
  end if;
  return new;
end $$;
drop trigger if exists acc_historial on public.oc_seguimientos;
create trigger acc_historial after insert or update or delete on public.oc_seguimientos for each row execute function public.acc_historial();
revoke all on function public.acc_historial() from public, anon, authenticated;

-- ── 5. Acciones automáticas ───────────────────────────────────────────────────────────────────────────────
create or replace function public.acc_txt_tipo_pv(t text) returns text language sql immutable as $$
  select case t when 'falla' then 'Falla del producto' when 'faltante' then 'Faltante' when 'cambio' then 'Cambio / reposición'
                when 'devolucion' then 'Devolución' when 'otro' then 'Otro' else coalesce(t, 'Otro') end $$;

-- 5.1 Postventa: un incidente abierto = una acción (nunca dos). Sigue el estado del incidente; no al revés.
create or replace function public.acc_trg_postventa() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.oc_seguimientos%rowtype; v_arch boolean; v_resp uuid;
begin
  if tg_op = 'DELETE' then
    update public.oc_seguimientos set estado = 'resuelto', solucion = 'El incidente de postventa de origen se eliminó de la OC. Cierre automático.'
     where origen = 'postventa' and origen_id = old.id and estado <> 'resuelto';
    return old;
  end if;
  select * into r from public.oc_seguimientos where origen = 'postventa' and origen_id = new.id;
  if coalesce(new.estado, 'abierto') = 'resuelto' then
    if found and r.estado <> 'resuelto' then
      update public.oc_seguimientos
         set estado = 'resuelto',
             solucion = left('Incidente de postventa cerrado en la OC' || coalesce(': ' || nullif(btrim(new.solucion), ''), '') || '. Cierre automático.', 2000)
       where id = r.id;
    end if;
    return new;
  end if;
  -- incidente abierto
  if found then
    if r.estado = 'resuelto' and tg_op = 'UPDATE' and coalesce(old.estado, 'abierto') = 'resuelto' then
      update public.oc_seguimientos set estado = 'pendiente' where id = r.id;   -- el incidente se reabrió en la OC
    end if;
    return new;
  end if;
  select coalesce(o.archivada, false) into v_arch from public.ordenes_compra_v2 o where o.id = new.oc_id;
  if v_arch is null or v_arch then return new; end if;   -- OC inexistente o archivada: sin acción
  insert into public.oc_seguimientos (id, oc_id, categoria, titulo, descripcion, prioridad, estado, origen, origen_id)
  values ('seg_pv_' || replace(gen_random_uuid()::text, '-', ''), new.oc_id, 'postventa',
          'Gestionar reclamo de postventa · ' || public.acc_txt_tipo_pv(new.tipo),
          'Reclamo del ' || public.acc_txt_fecha(new.fecha) || ': ' || coalesce(nullif(btrim(new.descripcion), ''), 'sin descripción'),
          'media', 'pendiente', 'postventa', new.id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists acc_postventa on public.eventos_postventa;
create trigger acc_postventa after insert or update or delete on public.eventos_postventa for each row execute function public.acc_trg_postventa();
revoke all on function public.acc_trg_postventa() from public, anon, authenticated;

-- 5.2 Entrega fallida: la registra la app al confirmar el envío del aviso de entrega fallida (lugar y motivo reales).
create or replace function public.acc_registrar_entrega_fallida(p_oc_id text, p_lugar text, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_oc public.ordenes_compra_v2%rowtype; v_id text; v_hoy date := (now() at time zone 'America/Santiago')::date; v_dow int; v_vence date;
  v_lugar text := nullif(btrim(coalesce(p_lugar, '')), ''); v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_nombre text;
begin
  if not public.bfk_es_usuario() then raise exception 'ACC: se requiere un perfil BFK' using errcode = '42501'; end if;
  if v_motivo is null then raise exception 'Indica el motivo de la entrega fallida'; end if;
  select * into v_oc from public.ordenes_compra_v2 where id = p_oc_id;
  if not found then raise exception 'ACC: la OC no existe'; end if;
  if coalesce(v_oc.archivada, false) then raise exception 'ACC: la OC está archivada'; end if;
  select id into v_id from public.oc_seguimientos where origen = 'entrega_fallida' and oc_id = p_oc_id and estado <> 'resuelto' for update;
  if found then
    select p.nombre into v_nombre from public.perfiles p where p.id = auth.uid();
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_nuevo)
    values ('hc_acc_' || replace(gen_random_uuid()::text, '-', ''), p_oc_id, v_oc.numero_oc, auth.uid(), v_nombre,
            'Acción: nuevo intento de entrega fallido', 'seguimiento:' || v_id, left(coalesce('Lugar: ' || v_lugar || ' · ', '') || 'Motivo: ' || v_motivo, 500));
    return jsonb_build_object('id', v_id, 'nueva', false);
  end if;
  -- El aviso al cliente informa un nuevo intento durante la semana en curso: vence el viernes de esta semana (o hoy, fin de semana).
  v_dow := extract(isodow from v_hoy)::int;
  v_vence := case when v_dow <= 5 then v_hoy + (5 - v_dow) else v_hoy end;
  insert into public.oc_seguimientos (id, oc_id, categoria, titulo, descripcion, prioridad, estado, fecha_revision, origen, origen_id)
  values ('seg_ef_' || replace(gen_random_uuid()::text, '-', ''), p_oc_id, 'entrega', 'Reprogramar entrega fallida',
          left('Entrega fallida' || coalesce(' en ' || v_lugar, '') || '. Motivo: ' || v_motivo || '. Se informó al cliente un nuevo intento durante la semana.', 2000),
          'alta', 'pendiente', v_vence, 'entrega_fallida', p_oc_id)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then   -- otra sesión la creó al mismo tiempo
    select id into v_id from public.oc_seguimientos where origen = 'entrega_fallida' and oc_id = p_oc_id and estado <> 'resuelto';
    return jsonb_build_object('id', v_id, 'nueva', false);
  end if;
  return jsonb_build_object('id', v_id, 'nueva', true);
end $$;
revoke all on function public.acc_registrar_entrega_fallida(text, text, text) from public, anon;
grant execute on function public.acc_registrar_entrega_fallida(text, text, text) to authenticated;

-- 5.3 Entrega registrada → la acción de entrega fallida de esa OC se resuelve sola (no toca la OC ni la entrega).
create or replace function public.acc_trg_entrega() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.oc_seguimientos
     set estado = 'resuelto',
         solucion = 'Entrega registrada el ' || public.acc_txt_fecha(new.fecha) || coalesce(' (recibe: ' || nullif(btrim(new.persona_recibe), '') || ')', '') || '. Cierre automático.'
   where origen = 'entrega_fallida' and oc_id = new.oc_id and estado <> 'resuelto';
  return new;
end $$;
drop trigger if exists acc_entrega on public.eventos_entrega;
create trigger acc_entrega after insert on public.eventos_entrega for each row execute function public.acc_trg_entrega();
revoke all on function public.acc_trg_entrega() from public, anon, authenticated;

revoke all on function public.acc_categoria_guardar(), public.acc_txt_fecha(date), public.acc_txt_prioridad(text), public.acc_txt_estado(text),
  public.acc_txt_categoria(text), public.acc_txt_pesos(numeric), public.acc_txt_desc(text), public.acc_txt_tipo_pv(text) from public, anon;
grant execute on function public.acc_txt_fecha(date), public.acc_txt_prioridad(text), public.acc_txt_estado(text),
  public.acc_txt_categoria(text), public.acc_txt_pesos(numeric), public.acc_txt_desc(text), public.acc_txt_tipo_pv(text) to authenticated;

-- ── 6. Instalación: solo los incidentes de postventa ABIERTOS hoy en OC no archivadas ─────────────────────
insert into public.oc_seguimientos (id, oc_id, categoria, titulo, descripcion, prioridad, estado, origen, origen_id)
select 'seg_pv_' || replace(gen_random_uuid()::text, '-', ''), pv.oc_id, 'postventa',
       'Gestionar reclamo de postventa · ' || public.acc_txt_tipo_pv(pv.tipo),
       'Reclamo del ' || public.acc_txt_fecha(pv.fecha) || ': ' || coalesce(nullif(btrim(pv.descripcion), ''), 'sin descripción'),
       'media', 'pendiente', 'postventa', pv.id
  from public.eventos_postventa pv join public.ordenes_compra_v2 o on o.id = pv.oc_id
 where coalesce(pv.estado, 'abierto') <> 'resuelto' and not coalesce(o.archivada, false)
 order by pv.fecha, pv.id
on conflict do nothing;

do $$
begin
  raise notice 'ACC_RESUMEN|categorias=%|acciones=%|automaticas_postventa=%|sin_oc=%',
    (select count(*) from public.acciones_categorias), (select count(*) from public.oc_seguimientos),
    (select count(*) from public.oc_seguimientos where origen = 'postventa'), (select count(*) from public.oc_seguimientos where oc_id is null);
end $$;
commit;
