-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase 4B · Integridad financiera de OCs (2026-10-06)
--
-- Se aplica en UNA sola transacción y NO modifica ningún valor existente: al final verifica, dentro
-- de la misma transacción, que cada OC y cada financiador conservan exactamente sus valores.
--
-- MODELO
--   Dato FUENTE (lo registran las personas):
--     · eventos_compra.costo_compra ................ cada compra al proveedor
--     · eventos_pago_financiamiento.monto .......... cada pago a un financiador (con o sin OC)
--     · ajustes_saldo_financiador.monto_ajuste ..... ajustes manuales explícitos (con motivo)
--     · eventos_factura (monto, número, anulación) . facturas; una factura anulada por otra no es vigente
--     · eventos_pago_cliente.monto ................. cobros al cliente
--     · OC: financiador_id, es_venta_propia, monto_total (venta), vendedor_id, tipo_registro
--     · financiadores.tipo: 'externo' (genera deuda) | 'propio' (fondos propios / Cuenta BFK: no es deuda)
--     · fin_diferencias_historicas: diferencias históricas congeladas al corte, pendientes de decisión
--   Dato DERIVADO (solo lo escribe la base; el navegador ya no puede fijarlo):
--     · OC.costo_total ................ = Σ compras de la OC
--     · OC.estado_compra .............. = 'comprado' si hay compras
--     · OC.monto_pagado_fin ........... = Σ pagos al financiador asignados a la OC
--     · OC.estado_pago_financiamiento . = 'no_aplica' (venta propia o fondos propios) | pagado | parcial | pendiente
--     · OC.monto_facturado ............ = Σ facturas VIGENTES (no anuladas por otra factura de la OC)
--     · OC.estado_factura_propia ...... = 'emitida' si hay al menos una factura vigente
--     · OC.monto_cobrado .............. = Σ cobros al cliente
--     · OC.estado_pago_cliente ........ = pagado (cobrado ≥ facturado > 0) | parcial | pendiente
--     · financiadores.saldo_deuda ..... = Σ costo de sus OCs con financiamiento externo (sin ventas propias)
--                                         − Σ pagos al financiador + Σ ajustes. Fondos propios: 0. Sin tope en cero.
--   Diferencias históricas: valor derivado = valor de los eventos + diferencia congelada (montos), o el estado
--   registrado (estados). Así el corte no cambia ningún valor. Las operaciones del dominio afectado de una OC
--   con diferencia pendiente quedan bloqueadas hasta que se apruebe su corrección (otra migración, aparte).
--
-- ATOMICIDAD Y CONCURRENCIA
--   Toda escritura de eventos recalcula en la misma transacción, con bloqueo de fila y siempre en el mismo
--   orden (primero OCs por id, luego financiadores por id). El recálculo lee los eventos DESPUÉS de tomar el
--   bloqueo: una compra no puede pisar un pago recién registrado (ni al revés).
--
-- COMPATIBILIDAD
--   La versión anterior de la aplicación sigue funcionando: sus escrituras de totales se ignoran (los fija la
--   base) y sus eventos se recalculan igual. importar_respaldo_excel restaura valores exactos (sin recálculo).
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- ── 0. Precondiciones ──────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regclass('public.fin_diferencias_historicas') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'fin_recalcular_oc') then
    raise exception 'FASE4B: la migración ya fue aplicada';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'financiadores' and column_name = 'tipo') then
    raise exception 'FASE4B: financiadores.tipo ya existe';
  end if;
  if (select count(*) from public.financiadores where id = 'fin_cuenta_bfk') <> 1 then
    raise exception 'FASE4B: no existe el financiador fin_cuenta_bfk (Cuenta BFK)';
  end if;
  if not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'registrar_pago_financiador')
     or not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'importar_respaldo_excel') then
    raise exception 'FASE4B: faltan funciones de fases anteriores';
  end if;
end $$;

-- Foto de los valores financieros ANTES (para la verificación final, en esta misma transacción).
create temp table _f4b_antes_oc on commit drop as
  select o.id, o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento, o.monto_facturado,
         o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente, md5(to_jsonb(o)::text) huella
    from public.ordenes_compra_v2 o;
create temp table _f4b_antes_fin on commit drop as
  select f.id, f.saldo_deuda, md5(to_jsonb(f)::text) huella from public.financiadores f;

-- ── 1. Estructura ──────────────────────────────────────────────────────────────────────────
-- Tipo de financiador (regla 2): 'propio' = fondos propios / Cuenta BFK, no es deuda con un tercero.
alter table public.financiadores add column tipo text not null default 'externo';
alter table public.financiadores add constraint financiadores_tipo_chk check (tipo in ('externo', 'propio'));
update public.financiadores set tipo = 'propio' where id = 'fin_cuenta_bfk';

-- Estado 'no_aplica' para la etapa de financiamiento (reglas 2 y 3). Las demás condiciones no cambian.
alter table public.ordenes_compra_v2 drop constraint chk_estados;
alter table public.ordenes_compra_v2 add constraint chk_estados check (
      coalesce(estado_compra, 'pendiente') = any (array['pendiente', 'comprado'])
  and coalesce(estado_entrega, 'pendiente') = any (array['pendiente', 'confirmada', 'entregado'])
  and coalesce(estado_factura_propia, 'pendiente') = any (array['pendiente', 'emitida'])
  and coalesce(estado_pago_cliente, 'pendiente') = any (array['pendiente', 'parcial', 'pagado'])
  and coalesce(estado_pago_financiamiento, 'pendiente') = any (array['pendiente', 'parcial', 'pagado', 'no_aplica']));

-- Diferencias históricas congeladas al corte (pendientes de decisión). Solo lectura para la aplicación.
create table public.fin_diferencias_historicas (
  id bigserial primary key,
  entidad text not null check (entidad in ('oc', 'financiador')),
  entidad_id text not null,
  etiqueta text,                         -- N° de OC o nombre del financiador (para leer el informe)
  campo text not null,
  valor_registrado text,                 -- valor guardado al corte (se conserva)
  valor_eventos text,                    -- valor que resulta de los eventos
  diferencia numeric,                    -- registrado − eventos (montos); null en estados
  bloquea text[] not null default '{}',  -- dominios bloqueados en la OC: 'financiamiento' | 'facturacion' | 'cobro'
  filas text[] not null default '{}',    -- filas fuente que no se pueden editar ni borrar: 'tabla:id'
  causa text not null,
  clasificacion text not null check (clasificacion in ('segura', 'decision')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'resuelta')),
  corte timestamptz not null default now(),
  resuelta_en timestamptz,
  resuelta_por uuid,
  resolucion text,
  unique (entidad, entidad_id, campo)
);
alter table public.fin_diferencias_historicas enable row level security;
create policy fin_diferencias_lectura on public.fin_diferencias_historicas for select using (auth.role() = 'authenticated');
revoke all on public.fin_diferencias_historicas from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.fin_diferencias_historicas from authenticated;
grant select on public.fin_diferencias_historicas to authenticated;
revoke all on sequence public.fin_diferencias_historicas_id_seq from public, anon, authenticated;

-- Índices para el recálculo (no cambian datos).
create index if not exists idx_eventos_compra_oc on public.eventos_compra (oc_id);
create index if not exists idx_eventos_pagofin_oc on public.eventos_pago_financiamiento (oc_id);
create index if not exists idx_eventos_pagofin_fin on public.eventos_pago_financiamiento (financiador_id);
create index if not exists idx_eventos_factura_oc on public.eventos_factura (oc_id);
create index if not exists idx_eventos_pagocli_oc on public.eventos_pago_cliente (oc_id);
create index if not exists idx_ajustes_fin on public.ajustes_saldo_financiador (financiador_id);
create index if not exists idx_oc_v2_financiador on public.ordenes_compra_v2 (financiador_id);

-- ── 2. Cálculo (solo lectura) ──────────────────────────────────────────────────────────────
-- Importación exacta (importar_respaldo_excel): no recalcula ni protege, restaura los valores tal cual.
create or replace function public.fin_es_importacion() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select coalesce(current_setting('bfk.importacion', true), '') = 'on'
$$;

-- Escritura directa desde la aplicación (PostgREST): roles authenticated / anon.
create or replace function public.fin_es_cliente() returns boolean
language sql stable set search_path = public, pg_temp as $$
  select current_user in ('authenticated', 'anon')
$$;

create or replace function public.fin_dif_monto(p_entidad text, p_id text, p_campo text) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(d.diferencia), 0) from public.fin_diferencias_historicas d
   where d.entidad = p_entidad and d.entidad_id = p_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is not null
$$;

create or replace function public.fin_dif_estado(p_oc_id text, p_campo text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select d.valor_registrado from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is null
   limit 1
$$;

-- Tipo de financiamiento de la OC: venta_propia | fondos_propios | externo.
create or replace function public.fin_tipo_financiamiento(p_oc_id text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case when o.es_venta_propia then 'venta_propia'
              when f.tipo = 'propio' then 'fondos_propios'
              else 'externo' end
    from public.ordenes_compra_v2 o left join public.financiadores f on f.id = o.financiador_id
   where o.id = p_oc_id
$$;

-- Facturas vigentes de una OC: las que ninguna otra factura de la misma OC anula (regla 4).
create or replace function public.fin_facturas_vigentes(p_oc_id text) returns setof public.eventos_factura
language sql stable security definer set search_path = public, pg_temp as $$
  select f.* from public.eventos_factura f
   where f.oc_id = p_oc_id
     and not exists (select 1 from public.eventos_factura a
                      where a.oc_id = f.oc_id and a.id <> f.id
                        and nullif(btrim(a.factura_anulada_numero), '') is not null
                        and btrim(a.factura_anulada_numero) = btrim(f.numero_factura))
$$;

-- Valores derivados de una OC. p_con_diferencias = false: solo eventos (el valor "corregido").
create or replace function public.fin_calculo_oc(
  p_oc_id text, p_con_diferencias boolean default true,
  out costo_total numeric, out estado_compra text, out monto_pagado_fin numeric, out estado_pago_financiamiento text,
  out monto_facturado numeric, out estado_factura_propia text, out monto_cobrado numeric, out estado_pago_cliente text,
  out tipo_financiamiento text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_existe boolean; v_n_compras int; v_n_vigentes int; v_ov text;
begin
  select true into v_existe from public.ordenes_compra_v2 o where o.id = p_oc_id;
  if v_existe is null then return; end if;
  select coalesce(sum(e.costo_compra), 0), count(*) into costo_total, v_n_compras
    from public.eventos_compra e where e.oc_id = p_oc_id;
  select coalesce(sum(p.monto), 0) into monto_pagado_fin
    from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id;
  select coalesce(sum(v.monto), 0), count(*) into monto_facturado, v_n_vigentes
    from public.fin_facturas_vigentes(p_oc_id) v;
  select coalesce(sum(c.monto), 0) into monto_cobrado
    from public.eventos_pago_cliente c where c.oc_id = p_oc_id;
  if p_con_diferencias then
    costo_total      := costo_total      + public.fin_dif_monto('oc', p_oc_id, 'costo_total');
    monto_pagado_fin := monto_pagado_fin + public.fin_dif_monto('oc', p_oc_id, 'monto_pagado_fin');
    monto_facturado  := monto_facturado  + public.fin_dif_monto('oc', p_oc_id, 'monto_facturado');
    monto_cobrado    := monto_cobrado    + public.fin_dif_monto('oc', p_oc_id, 'monto_cobrado');
  end if;
  tipo_financiamiento := public.fin_tipo_financiamiento(p_oc_id);
  estado_compra := case when v_n_compras > 0 then 'comprado' else 'pendiente' end;
  estado_pago_financiamiento := case
    when tipo_financiamiento <> 'externo' then 'no_aplica'
    when costo_total <= 0 then 'pendiente'
    when monto_pagado_fin >= costo_total then 'pagado'
    when monto_pagado_fin > 0 then 'parcial'
    else 'pendiente' end;
  estado_factura_propia := case when v_n_vigentes > 0 then 'emitida' else 'pendiente' end;
  estado_pago_cliente := case
    when monto_cobrado <= 0 then 'pendiente'
    when monto_facturado > 0 and monto_cobrado >= monto_facturado then 'pagado'
    else 'parcial' end;
  if p_con_diferencias then
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_compra');              if v_ov is not null then estado_compra := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_financiamiento'); if v_ov is not null then estado_pago_financiamiento := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_factura_propia');      if v_ov is not null then estado_factura_propia := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_cliente');        if v_ov is not null then estado_pago_cliente := v_ov; end if;
  end if;
  return;
end $$;

-- Saldo derivado de un financiador. p_dif_oc / p_dif_fin: incluir diferencias congeladas de OCs / del financiador.
create or replace function public.fin_calculo_financiador(p_fin_id text, p_dif_oc boolean default true, p_dif_fin boolean default true)
returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_tipo text; v_compras numeric; v_pagos numeric; v_ajustes numeric; v_dif numeric;
begin
  select f.tipo into v_tipo from public.financiadores f where f.id = p_fin_id;
  if v_tipo is null then return null; end if;
  v_dif := case when p_dif_fin then public.fin_dif_monto('financiador', p_fin_id, 'saldo_deuda') else 0 end;
  if v_tipo = 'propio' then return v_dif; end if;   -- regla 2: fondos propios no son deuda
  select coalesce(sum(coalesce((select sum(e.costo_compra) from public.eventos_compra e where e.oc_id = o.id), 0)
                      + case when p_dif_oc then public.fin_dif_monto('oc', o.id, 'costo_total') else 0 end), 0)
    into v_compras
    from public.ordenes_compra_v2 o
   where o.financiador_id = p_fin_id and not o.es_venta_propia;          -- regla 3: venta propia no genera deuda
  select coalesce(sum(p.monto), 0) into v_pagos from public.eventos_pago_financiamiento p where p.financiador_id = p_fin_id;
  select coalesce(sum(a.monto_ajuste), 0) into v_ajustes from public.ajustes_saldo_financiador a where a.financiador_id = p_fin_id;
  return v_compras - v_pagos + v_ajustes + v_dif;
end $$;

-- ── 3. Recálculo (escritura interna, con bloqueo y orden fijo) ─────────────────────────────
create or replace function public.fin_recalcular_oc(p_oc_id text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c record;
begin
  perform 1 from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then return; end if;
  select * into c from public.fin_calculo_oc(p_oc_id, true);   -- se lee DESPUÉS del bloqueo
  update public.ordenes_compra_v2 o
     set costo_total = c.costo_total, estado_compra = c.estado_compra,
         monto_pagado_fin = c.monto_pagado_fin, estado_pago_financiamiento = c.estado_pago_financiamiento,
         monto_facturado = c.monto_facturado, estado_factura_propia = c.estado_factura_propia,
         monto_cobrado = c.monto_cobrado, estado_pago_cliente = c.estado_pago_cliente
   where o.id = p_oc_id
     and (o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento,
          o.monto_facturado, o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente)
         is distinct from
         (c.costo_total, c.estado_compra, c.monto_pagado_fin, c.estado_pago_financiamiento,
          c.monto_facturado, c.estado_factura_propia, c.monto_cobrado, c.estado_pago_cliente);
end $$;

create or replace function public.fin_recalcular_financiador(p_fin_id text) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_saldo numeric;
begin
  perform 1 from public.financiadores f where f.id = p_fin_id for no key update;
  if not found then return; end if;
  v_saldo := public.fin_calculo_financiador(p_fin_id, true, true);
  update public.financiadores f set saldo_deuda = v_saldo where f.id = p_fin_id and f.saldo_deuda is distinct from v_saldo;
end $$;

-- Recalcula un conjunto: bloquea primero las OCs (por id) y luego los financiadores (por id).
create or replace function public.fin_recalcular(p_ocs text[], p_fins text[]) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v text;
begin
  for v in select distinct x from unnest(coalesce(p_ocs, '{}')) x where x is not null order by 1 loop
    perform 1 from public.ordenes_compra_v2 o where o.id = v for no key update;
  end loop;
  for v in select distinct x from unnest(coalesce(p_fins, '{}')) x where x is not null order by 1 loop
    perform 1 from public.financiadores f where f.id = v for no key update;
  end loop;
  for v in select distinct x from unnest(coalesce(p_ocs, '{}')) x where x is not null order by 1 loop
    perform public.fin_recalcular_oc(v);
  end loop;
  for v in select distinct x from unnest(coalesce(p_fins, '{}')) x where x is not null order by 1 loop
    perform public.fin_recalcular_financiador(v);
  end loop;
end $$;

-- ── 4. Bloqueos por diferencias históricas pendientes ──────────────────────────────────────
create or replace function public.fin_motivo_bloqueo(p_oc_id text, p_dominio text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(d.causa, ' · ' order by d.campo) from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.estado = 'pendiente' and p_dominio = any(d.bloquea)
$$;

create or replace function public.fin_fila_bloqueada(p_tabla text, p_id text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(coalesce(d.etiqueta, d.entidad_id) || ': ' || d.causa, ' · ') from public.fin_diferencias_historicas d
   where d.estado = 'pendiente' and (p_tabla || ':' || p_id) = any(d.filas)
$$;

create or replace function public.fin_exigir_sin_bloqueo(p_oc_id text, p_dominio text) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_motivo text; v_num text;
begin
  if p_oc_id is null or public.fin_es_importacion() then return; end if;
  v_motivo := public.fin_motivo_bloqueo(p_oc_id, p_dominio);
  if v_motivo is not null then
    select o.numero_oc into v_num from public.ordenes_compra_v2 o where o.id = p_oc_id;
    raise exception 'La OC % tiene una corrección histórica pendiente de aprobación (%). No se registró ningún cambio.',
      coalesce(v_num, p_oc_id), v_motivo using errcode = 'P4B01';
  end if;
end $$;

-- ── 5. Disparadores ────────────────────────────────────────────────────────────────────────
-- 5a. Protección de columnas derivadas: el navegador no puede fijarlas (se conservan / parten en cero).
create or replace function public.fin_trg_proteger_oc() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() or not public.fin_es_cliente() then return new; end if;
  if tg_op = 'INSERT' then
    new.costo_total := 0; new.estado_compra := 'pendiente';
    new.monto_pagado_fin := 0; new.estado_pago_financiamiento := 'pendiente';
    new.monto_facturado := 0; new.estado_factura_propia := 'pendiente';
    new.monto_cobrado := 0; new.estado_pago_cliente := 'pendiente';
  else
    new.costo_total := old.costo_total; new.estado_compra := old.estado_compra;
    new.monto_pagado_fin := old.monto_pagado_fin; new.estado_pago_financiamiento := old.estado_pago_financiamiento;
    new.monto_facturado := old.monto_facturado; new.estado_factura_propia := old.estado_factura_propia;
    new.monto_cobrado := old.monto_cobrado; new.estado_pago_cliente := old.estado_pago_cliente;
  end if;
  return new;
end $$;

create or replace function public.fin_trg_proteger_financiador() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() or not public.fin_es_cliente() then return new; end if;
  if tg_op = 'INSERT' then new.saldo_deuda := 0; else new.saldo_deuda := old.saldo_deuda; end if;
  return new;
end $$;

-- 5b. Antes de escribir un evento: bloqueos por diferencias pendientes.
create or replace function public.fin_trg_bloqueo_eventos() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  v_dom text := case tg_table_name
    when 'eventos_compra' then 'financiamiento' when 'eventos_pago_financiamiento' then 'financiamiento'
    when 'eventos_factura' then 'facturacion' when 'eventos_pago_cliente' then 'cobro' else null end;
  v_motivo text;
begin
  if public.fin_es_importacion() then return coalesce(new, old); end if;
  if v_dom is not null then
    if tg_op <> 'DELETE' then perform public.fin_exigir_sin_bloqueo(to_jsonb(new) ->> 'oc_id', v_dom); end if;
    if tg_op <> 'INSERT' then perform public.fin_exigir_sin_bloqueo(to_jsonb(old) ->> 'oc_id', v_dom); end if;
  end if;
  if tg_op <> 'INSERT' then
    v_motivo := public.fin_fila_bloqueada(tg_table_name, to_jsonb(old) ->> 'id');
    if v_motivo is not null then
      raise exception 'Este registro está ligado a una corrección histórica pendiente de aprobación (%). No se registró ningún cambio.',
        v_motivo using errcode = 'P4B01';
    end if;
  end if;
  return coalesce(new, old);
end $$;

-- 5c. Después de escribir un evento: recálculo de las OCs y financiadores afectados.
create or replace function public.fin_trg_recalcular_eventos() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_ocs text[] := array_remove(array[v_n ->> 'oc_id', v_o ->> 'oc_id'], null);
  v_fins text[] := '{}';
begin
  if public.fin_es_importacion() then return null; end if;
  if tg_table_name in ('eventos_compra', 'eventos_pago_financiamiento') then
    v_fins := v_fins || array(select o.financiador_id from public.ordenes_compra_v2 o where o.id = any(v_ocs) and o.financiador_id is not null);
  end if;
  if tg_table_name in ('eventos_pago_financiamiento', 'ajustes_saldo_financiador') then
    v_fins := v_fins || array_remove(array[v_n ->> 'financiador_id', v_o ->> 'financiador_id'], null);
  end if;
  if tg_table_name = 'eventos_compra' and v_o is not null then
    v_fins := v_fins || array_remove(array[v_o ->> 'financiador_id'], null);   -- OC borrada en cascada
  end if;
  perform public.fin_recalcular(v_ocs, v_fins);
  return null;
end $$;

-- 5d. Cambio de financiador o de venta propia en la OC (incluye la versión anterior de la aplicación).
create or replace function public.fin_trg_oc_financiamiento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.fin_recalcular(array[new.id], array_remove(array[new.financiador_id], null));
  elsif tg_op = 'DELETE' then
    perform public.fin_recalcular('{}', array_remove(array[old.financiador_id], null));
  elsif (new.financiador_id, new.es_venta_propia) is distinct from (old.financiador_id, old.es_venta_propia) then
    perform public.fin_recalcular(array[new.id], array_remove(array[new.financiador_id, old.financiador_id], null));
  end if;
  return null;
end $$;

create or replace function public.fin_trg_bloqueo_oc() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() then return new; end if;
  if (new.financiador_id, new.es_venta_propia) is distinct from (old.financiador_id, old.es_venta_propia) then
    perform public.fin_exigir_sin_bloqueo(new.id, 'financiamiento');
  end if;
  return new;
end $$;

-- 5e. Cambio del tipo de un financiador (externo ↔ propio): recalcula el financiador y sus OCs.
create or replace function public.fin_trg_financiador_tipo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() then return null; end if;
  if new.tipo is distinct from old.tipo then
    perform public.fin_recalcular(array(select o.id from public.ordenes_compra_v2 o where o.financiador_id = new.id), array[new.id]);
  end if;
  return null;
end $$;

create or replace function public.fin_trg_bloqueo_financiador() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_oc text;
begin
  if public.fin_es_importacion() then return new; end if;
  if new.tipo is distinct from old.tipo then
    for v_oc in select o.id from public.ordenes_compra_v2 o where o.financiador_id = new.id order by o.id loop
      perform public.fin_exigir_sin_bloqueo(v_oc, 'financiamiento');
    end loop;
    if exists (select 1 from public.fin_diferencias_historicas d where d.entidad = 'financiador' and d.entidad_id = new.id and d.estado = 'pendiente') then
      raise exception 'El financiador % tiene una corrección histórica pendiente de aprobación. No se registró ningún cambio.', new.nombre using errcode = 'P4B01';
    end if;
  end if;
  return new;
end $$;

-- ── 6. Operaciones financieras atómicas (RPC, con los permisos y la RLS de quien llama) ─────
create or replace function public.fin_nuevo_id(p_prefijo text) returns text
language sql volatile set search_path = public, pg_temp as $$
  select p_prefijo || '_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || substr(md5(random()::text), 1, 5)
$$;

create or replace function public.fin_historial(p_oc_id text, p_accion text, p_campo text, p_antes text, p_despues text) returns void
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text; v_num text;
begin
  select p.nombre into v_nombre from public.perfiles p where p.id = v_uid;
  if p_oc_id is not null then select o.numero_oc into v_num from public.ordenes_compra_v2 o where o.id = p_oc_id; end if;
  insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
  values (public.fin_nuevo_id('hc'), p_oc_id, v_num, v_uid, v_nombre, p_accion, p_campo, p_antes, p_despues);
end $$;

create or replace function public.fin_pesos(p numeric) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when coalesce(p, 0) < 0 then '-' else '' end || '$'
         || replace(to_char(abs(round(coalesce(p, 0))), 'FM999,999,999,990'), ',', '.')
$$;

create or replace function public.fin_resumen_oc(p_oc_id text) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('oc_id', o.id, 'numero_oc', o.numero_oc, 'costo_total', o.costo_total, 'monto_pagado_fin', o.monto_pagado_fin,
           'estado_pago_financiamiento', o.estado_pago_financiamiento, 'financiador_id', o.financiador_id,
           'saldo_financiador', (select f.saldo_deuda from public.financiadores f where f.id = o.financiador_id))
    from public.ordenes_compra_v2 o where o.id = p_oc_id
$$;

-- Registrar una compra (M1). El financiamiento de la OC (financiador / tipo) lo fija la OC; si aún no tiene
-- compras, la primera compra lo establece. Para cambiarlo después: cambiar_financiamiento_oc.
create or replace function public.registrar_compra_oc(
  p_oc_id text, p_fecha date, p_costo numeric, p_financiador_id text default null,
  p_proveedor text default '', p_fecha_entrega_estimada date default null, p_monto_venta numeric default null, p_notas text default '')
returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_oc public.ordenes_compra_v2%rowtype; v_fin public.financiadores%rowtype; v_tiene_compras boolean;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de compra'; end if;
  if p_costo is null or p_costo < 0 then raise exception 'El costo de compra no puede ser negativo'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then raise exception 'La OC no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada: restáurela antes de registrar movimientos', v_oc.numero_oc; end if;
  perform public.fin_exigir_sin_bloqueo(p_oc_id, 'financiamiento');
  v_tiene_compras := exists (select 1 from public.eventos_compra e where e.oc_id = p_oc_id);
  if p_financiador_id is not null and p_financiador_id is distinct from v_oc.financiador_id then
    if v_tiene_compras then
      raise exception 'La OC % ya tiene compras financiadas por otro financiador. Use "Cambiar financiamiento" para cambiarlo.', v_oc.numero_oc;
    end if;
    select * into v_fin from public.financiadores f where f.id = p_financiador_id;
    if not found then raise exception 'El financiador % no existe', p_financiador_id; end if;
    update public.ordenes_compra_v2 o set financiador_id = p_financiador_id where o.id = p_oc_id;   -- recalcula por disparador
    v_oc.financiador_id := p_financiador_id;
  end if;
  if v_oc.financiador_id is null and not v_oc.es_venta_propia then
    raise exception 'Indique el financiador de la compra';
  end if;
  insert into public.eventos_compra (id, oc_id, fecha, monto_venta, costo_compra, fecha_entrega_estimada, financiador_id, proveedor, notas, creado_por)
  values (public.fin_nuevo_id('evc'), p_oc_id, p_fecha, coalesce(p_monto_venta, v_oc.monto_total, 0), p_costo,
          p_fecha_entrega_estimada, v_oc.financiador_id, coalesce(p_proveedor, ''), coalesce(p_notas, ''), v_uid);
  perform public.fin_historial(p_oc_id, 'Compra registrada', 'costo_total', null, public.fin_pesos(p_costo));
  return jsonb_build_object('ok', true) || public.fin_resumen_oc(p_oc_id);
end $$;

-- Corregir una compra (fecha, costo, monto de venta, entrega estimada, proveedor).
create or replace function public.editar_compra_oc(
  p_evento_id text, p_fecha date, p_costo numeric, p_monto_venta numeric default null,
  p_fecha_entrega_estimada date default null, p_proveedor text default null)
returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_ev public.eventos_compra%rowtype; v_oc public.ordenes_compra_v2%rowtype; v_cambios text[] := '{}';
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_fecha is null then raise exception 'Falta la fecha de compra'; end if;
  if p_costo is null or p_costo < 0 then raise exception 'El costo de compra no puede ser negativo'; end if;
  select e.oc_id into v_ev.oc_id from public.eventos_compra e where e.id = p_evento_id;
  if v_ev.oc_id is null then raise exception 'La compra no existe'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = v_ev.oc_id for no key update;
  select * into v_ev from public.eventos_compra e where e.id = p_evento_id for update;
  if not found then raise exception 'La compra no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  perform public.fin_exigir_sin_bloqueo(v_oc.id, 'financiamiento');
  if (select coalesce(sum(e.costo_compra), 0) from public.eventos_compra e where e.oc_id = v_oc.id and e.id <> p_evento_id) + p_costo
     < coalesce(v_oc.monto_pagado_fin, 0) then
    raise exception 'El costo de la OC % no puede quedar bajo lo ya pagado al financiador (%)', v_oc.numero_oc, public.fin_pesos(v_oc.monto_pagado_fin);
  end if;
  update public.eventos_compra e
     set fecha = p_fecha, costo_compra = p_costo,
         monto_venta = coalesce(p_monto_venta, e.monto_venta),
         fecha_entrega_estimada = case when p_fecha_entrega_estimada is null then e.fecha_entrega_estimada else p_fecha_entrega_estimada end,
         proveedor = coalesce(p_proveedor, e.proveedor)
   where e.id = p_evento_id;
  if not found then raise exception 'No tiene permiso para corregir esta compra'; end if;
  -- Monto de venta: la compra lleva la venta de la OC; si se corrige, la OC se ajusta por la diferencia (regla vigente).
  if p_monto_venta is not null and p_monto_venta is distinct from v_ev.monto_venta then
    update public.ordenes_compra_v2 o set monto_total = greatest(0, o.monto_total + (p_monto_venta - coalesce(v_ev.monto_venta, 0))) where o.id = v_oc.id;
    v_cambios := v_cambios || ('venta ' || public.fin_pesos(v_ev.monto_venta) || ' → ' || public.fin_pesos(p_monto_venta));
  end if;
  if p_costo is distinct from v_ev.costo_compra then v_cambios := v_cambios || ('costo ' || public.fin_pesos(v_ev.costo_compra) || ' → ' || public.fin_pesos(p_costo)); end if;
  if p_fecha is distinct from v_ev.fecha then v_cambios := v_cambios || ('fecha ' || coalesce(to_char(v_ev.fecha, 'DD-MM-YYYY'), '—') || ' → ' || to_char(p_fecha, 'DD-MM-YYYY')); end if;
  if array_length(v_cambios, 1) > 0 then
    perform public.fin_historial(v_oc.id, 'Compra corregida', 'eventos_compra', null, array_to_string(v_cambios, ' · '));
  end if;
  return jsonb_build_object('ok', true, 'cambios', to_jsonb(v_cambios)) || public.fin_resumen_oc(v_oc.id);
end $$;

-- Eliminar una compra (solo administradores, por la RLS vigente). La OC y el saldo se recalculan solos.
create or replace function public.eliminar_compra_oc(p_evento_id text) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_ev public.eventos_compra%rowtype; v_oc public.ordenes_compra_v2%rowtype; v_n int;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  select e.oc_id into v_ev.oc_id from public.eventos_compra e where e.id = p_evento_id;
  if v_ev.oc_id is null then raise exception 'La compra no existe'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = v_ev.oc_id for no key update;
  select * into v_ev from public.eventos_compra e where e.id = p_evento_id;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  perform public.fin_exigir_sin_bloqueo(v_oc.id, 'financiamiento');
  if exists (select 1 from public.eventos_pago_financiamiento p where p.oc_id = v_oc.id)
     and not exists (select 1 from public.eventos_compra e where e.oc_id = v_oc.id and e.id <> p_evento_id) then
    raise exception 'La OC % tiene pagos al financiador registrados: elimínelos antes de eliminar su única compra', v_oc.numero_oc;
  end if;
  delete from public.eventos_compra e where e.id = p_evento_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Solo un administrador puede eliminar una compra'; end if;
  perform public.fin_historial(v_oc.id, 'Eliminó registro de compra', 'eventos_compra',
    coalesce(to_char(v_ev.fecha, 'DD-MM-YYYY'), '—') || ' · ' || public.fin_pesos(v_ev.costo_compra), null);
  return jsonb_build_object('ok', true) || public.fin_resumen_oc(v_oc.id);
end $$;

-- Pago a financiador (reemplaza la versión de la Fase 7, misma firma). Ya no fija el saldo en el navegador
-- ni lo deja en cero si el pago supera la deuda: el saldo es Σ compras − Σ pagos + Σ ajustes (puede quedar a favor de BFK).
create or replace function public.registrar_pago_financiador(
  p_financiador_id text, p_fecha date, p_monto numeric, p_asignaciones jsonb default '[]'::jsonb, p_origen text default 'manual')
returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_fin public.financiadores%rowtype; v_oc public.ordenes_compra_v2%rowtype;
  v_asig jsonb; v_ids text[]; v_id text; v_asignado numeric; v_total numeric := 0; v_sobrante numeric;
  v_debe numeric; v_n_oc int := 0; v_n_completas int := 0;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if p_fecha is null then raise exception 'Falta la fecha del pago'; end if;
  if jsonb_typeof(coalesce(p_asignaciones, '[]'::jsonb)) <> 'array' then raise exception 'Asignaciones inválidas'; end if;
  select array_agg(t.v ->> 'oc_id' order by t.v ->> 'oc_id') into v_ids from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) as t(v);
  if v_ids is not null and (select count(*) from unnest(v_ids)) <> (select count(distinct u) from unnest(v_ids) u) then
    raise exception 'Hay una OC repetida en las asignaciones';
  end if;
  -- Bloqueos en orden fijo: OCs (por id) y luego el financiador.
  foreach v_id in array coalesce(v_ids, '{}') loop
    perform 1 from public.ordenes_compra_v2 o where o.id = v_id for no key update;
  end loop;
  select * into v_fin from public.financiadores f where f.id = p_financiador_id for no key update;
  if not found then raise exception 'El financiador % no existe', p_financiador_id; end if;
  if v_fin.tipo = 'propio' then
    raise exception 'Los fondos propios (%) no son deuda con un financiador: no corresponde registrar pagos', v_fin.nombre;
  end if;
  for v_asig in select * from jsonb_array_elements(coalesce(p_asignaciones, '[]'::jsonb)) loop
    v_asignado := (v_asig ->> 'monto')::numeric;
    if v_asignado is null or v_asignado <= 0 then raise exception 'Asignación con monto inválido'; end if;
    select * into v_oc from public.ordenes_compra_v2 o where o.id = v_asig ->> 'oc_id';
    if not found then raise exception 'La OC % no existe', v_asig ->> 'oc_id'; end if;
    if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
    if v_oc.financiador_id is distinct from p_financiador_id then raise exception 'La OC % no pertenece a este financiador', v_oc.numero_oc; end if;
    perform public.fin_exigir_sin_bloqueo(v_oc.id, 'financiamiento');
    if public.fin_tipo_financiamiento(v_oc.id) <> 'externo' then
      raise exception 'La OC % no tiene financiamiento externo (venta propia o fondos propios): su etapa de financiamiento no aplica', v_oc.numero_oc;
    end if;
    if v_oc.estado_pago_financiamiento = 'pagado' then raise exception 'La OC % ya figura con el financiamiento pagado', v_oc.numero_oc; end if;
    v_debe := greatest(0, coalesce(v_oc.costo_total, 0) - coalesce(v_oc.monto_pagado_fin, 0));
    if v_asignado > v_debe then
      raise exception 'La asignación a la OC % (%) supera lo que se adeuda (%)', v_oc.numero_oc, public.fin_pesos(v_asignado), public.fin_pesos(v_debe);
    end if;
    v_total := v_total + v_asignado; v_n_oc := v_n_oc + 1;
    if v_asignado >= v_debe then v_n_completas := v_n_completas + 1; end if;
    insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto, creado_por)
    values (public.fin_nuevo_id('evpf'), p_financiador_id, v_oc.id, p_fecha, v_asignado, v_uid);
    perform public.fin_historial(v_oc.id,
      case when v_asignado >= v_debe then 'Financiamiento saldado (abono a ' || v_fin.nombre || ')'
           else 'Abono parcial de financiamiento (' || public.fin_pesos(v_asignado) || ')' end,
      'monto_pagado_fin', public.fin_pesos(v_oc.monto_pagado_fin), public.fin_pesos(coalesce(v_oc.monto_pagado_fin, 0) + v_asignado));
  end loop;
  if v_total > p_monto then
    raise exception 'Las asignaciones (%) superan el monto del pago (%)', public.fin_pesos(v_total), public.fin_pesos(p_monto);
  end if;
  v_sobrante := p_monto - v_total;
  if v_sobrante > 0 then
    insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto, creado_por)
    values (public.fin_nuevo_id('evpf'), p_financiador_id, null, p_fecha, v_sobrante, v_uid);
    perform public.fin_historial(null, 'Pago a financiador sin OC asignada', 'financiamiento', null, v_fin.nombre || ' · ' || public.fin_pesos(v_sobrante));
  end if;
  return jsonb_build_object('ok', true, 'ocs', v_n_oc, 'completas', v_n_completas, 'asignado', v_total, 'sobrante', v_sobrante,
                            'origen', p_origen, 'saldo_financiador', (select f.saldo_deuda from public.financiadores f where f.id = p_financiador_id));
end $$;

-- Corregir un pago a financiador (monto y fecha). Un pago asignado no puede superar lo adeudado por la OC.
create or replace function public.editar_pago_financiador(p_evento_id text, p_fecha date, p_monto numeric) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_ev public.eventos_pago_financiamiento%rowtype; v_oc public.ordenes_compra_v2%rowtype; v_otros numeric; v_fin text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_fecha is null then raise exception 'Falta la fecha del pago'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  select e.oc_id, e.financiador_id into v_ev.oc_id, v_fin from public.eventos_pago_financiamiento e where e.id = p_evento_id;
  if v_fin is null then raise exception 'El pago no existe'; end if;
  if v_ev.oc_id is not null then select * into v_oc from public.ordenes_compra_v2 o where o.id = v_ev.oc_id for no key update; end if;
  perform 1 from public.financiadores f where f.id = v_fin for no key update;
  select * into v_ev from public.eventos_pago_financiamiento e where e.id = p_evento_id for update;
  if v_ev.oc_id is not null then
    if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
    perform public.fin_exigir_sin_bloqueo(v_oc.id, 'financiamiento');
    select coalesce(sum(p.monto), 0) into v_otros from public.eventos_pago_financiamiento p where p.oc_id = v_oc.id and p.id <> p_evento_id;
    if v_otros + p_monto > (public.fin_calculo_oc(v_oc.id, true)).costo_total then
      raise exception 'Con ese monto los pagos de la OC % (%) superarían su costo (%)', v_oc.numero_oc,
        public.fin_pesos(v_otros + p_monto), public.fin_pesos((public.fin_calculo_oc(v_oc.id, true)).costo_total);
    end if;
  end if;
  update public.eventos_pago_financiamiento e set fecha = p_fecha, monto = p_monto where e.id = p_evento_id;
  if not found then raise exception 'No tiene permiso para corregir este pago'; end if;
  if p_monto is distinct from v_ev.monto or p_fecha is distinct from v_ev.fecha then
    perform public.fin_historial(v_ev.oc_id, 'Pago a financiador corregido', 'eventos_pago_financiamiento',
      coalesce(to_char(v_ev.fecha, 'DD-MM-YYYY'), '—') || ' · ' || public.fin_pesos(v_ev.monto),
      to_char(p_fecha, 'DD-MM-YYYY') || ' · ' || public.fin_pesos(p_monto));
  end if;
  return jsonb_build_object('ok', true, 'saldo_financiador', (select f.saldo_deuda from public.financiadores f where f.id = v_fin))
         || coalesce(public.fin_resumen_oc(v_ev.oc_id), '{}'::jsonb);
end $$;

-- Eliminar un pago a financiador (solo administradores, por la RLS vigente).
create or replace function public.eliminar_pago_financiador(p_evento_id text) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_ev public.eventos_pago_financiamiento%rowtype; v_oc public.ordenes_compra_v2%rowtype; v_n int; v_fin text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  select e.oc_id, e.financiador_id into v_ev.oc_id, v_fin from public.eventos_pago_financiamiento e where e.id = p_evento_id;
  if v_fin is null then raise exception 'El pago no existe'; end if;
  if v_ev.oc_id is not null then select * into v_oc from public.ordenes_compra_v2 o where o.id = v_ev.oc_id for no key update; end if;
  perform 1 from public.financiadores f where f.id = v_fin for no key update;
  select * into v_ev from public.eventos_pago_financiamiento e where e.id = p_evento_id;
  if v_ev.oc_id is not null then
    if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
    perform public.fin_exigir_sin_bloqueo(v_oc.id, 'financiamiento');
  end if;
  delete from public.eventos_pago_financiamiento e where e.id = p_evento_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Solo un administrador puede eliminar un pago'; end if;
  perform public.fin_historial(v_ev.oc_id, 'Eliminó pago a financiador', 'eventos_pago_financiamiento',
    coalesce(to_char(v_ev.fecha, 'DD-MM-YYYY'), '—') || ' · ' || public.fin_pesos(v_ev.monto), null);
  return jsonb_build_object('ok', true, 'saldo_financiador', (select f.saldo_deuda from public.financiadores f where f.id = v_fin))
         || coalesce(public.fin_resumen_oc(v_ev.oc_id), '{}'::jsonb);
end $$;

-- Cambiar el financiamiento de una OC (M2): financiador externo, fondos propios o venta propia.
-- Si la OC ya tiene pagos al financiador, primero hay que corregirlos (no se reasignan pagos en silencio).
create or replace function public.cambiar_financiamiento_oc(p_oc_id text, p_tipo text, p_financiador_id text default null) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_oc public.ordenes_compra_v2%rowtype; v_fin public.financiadores%rowtype;
  v_antes text; v_despues text; v_fin_nuevo text; v_vp boolean;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_tipo not in ('externo', 'fondos_propios', 'venta_propia') then raise exception 'Tipo de financiamiento inválido: %', p_tipo; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then raise exception 'La OC no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  perform public.fin_exigir_sin_bloqueo(p_oc_id, 'financiamiento');
  select case t.tipo when 'venta_propia' then 'Venta propia'
                     when 'fondos_propios' then 'Fondos propios · ' || coalesce(f.nombre, '—')
                     else 'Financiador externo · ' || coalesce(f.nombre, '—') end
    into v_antes
    from (select public.fin_tipo_financiamiento(p_oc_id) as tipo) t
    left join public.financiadores f on f.id = v_oc.financiador_id;
  if p_tipo = 'venta_propia' then
    if v_oc.vendedor_id is null then raise exception 'La venta propia requiere un vendedor asignado a la OC'; end if;
    v_vp := true; v_fin_nuevo := coalesce(p_financiador_id, v_oc.financiador_id);
  else
    v_vp := false;
    if p_tipo = 'fondos_propios' and p_financiador_id is null then
      select f.id into v_fin_nuevo from public.financiadores f where f.tipo = 'propio' order by f.id limit 1;
    else
      v_fin_nuevo := p_financiador_id;
    end if;
    if v_fin_nuevo is null then raise exception 'Indique el financiador'; end if;
    select * into v_fin from public.financiadores f where f.id = v_fin_nuevo;
    if not found then raise exception 'El financiador % no existe', v_fin_nuevo; end if;
    if p_tipo = 'externo' and v_fin.tipo <> 'externo' then raise exception '% son fondos propios, no un financiador externo', v_fin.nombre; end if;
    if p_tipo = 'fondos_propios' and v_fin.tipo <> 'propio' then raise exception '% es un financiador externo, no fondos propios', v_fin.nombre; end if;
  end if;
  if (v_fin_nuevo, v_vp) is not distinct from (v_oc.financiador_id, v_oc.es_venta_propia) then
    return jsonb_build_object('ok', true, 'sin_cambios', true) || public.fin_resumen_oc(p_oc_id);
  end if;
  if exists (select 1 from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id) then
    raise exception 'La OC % tiene pagos al financiador registrados (%): corríjalos o elimínelos antes de cambiar el financiamiento',
      v_oc.numero_oc, public.fin_pesos((select sum(p.monto) from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id));
  end if;
  update public.ordenes_compra_v2 o set financiador_id = v_fin_nuevo, es_venta_propia = v_vp where o.id = p_oc_id;  -- recalcula por disparador
  update public.eventos_compra e set financiador_id = v_fin_nuevo where e.oc_id = p_oc_id and e.financiador_id is distinct from v_fin_nuevo;
  select case t.tipo when 'venta_propia' then 'Venta propia'
                     when 'fondos_propios' then 'Fondos propios · ' || coalesce(f.nombre, '—')
                     else 'Financiador externo · ' || coalesce(f.nombre, '—') end
    into v_despues
    from (select public.fin_tipo_financiamiento(p_oc_id) as tipo) t
    left join public.financiadores f on f.id = v_fin_nuevo;
  perform public.fin_historial(p_oc_id, 'Financiamiento cambiado', 'financiamiento', v_antes, v_despues);
  return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', v_despues) || public.fin_resumen_oc(p_oc_id);
end $$;

-- Verificación de consistencia (solo lectura): filas donde lo guardado difiere de lo calculado. Debe estar vacía.
create or replace function public.fin_verificar_consistencia()
returns table (entidad text, entidad_id text, campo text, guardado text, calculado text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r record; c record;
begin
  for r in select o.* from public.ordenes_compra_v2 o order by o.id loop
    select * into c from public.fin_calculo_oc(r.id, true);
    if r.costo_total is distinct from c.costo_total then return query select 'oc', r.id, 'costo_total', r.costo_total::text, c.costo_total::text; end if;
    if r.estado_compra is distinct from c.estado_compra then return query select 'oc', r.id, 'estado_compra', r.estado_compra, c.estado_compra; end if;
    if r.monto_pagado_fin is distinct from c.monto_pagado_fin then return query select 'oc', r.id, 'monto_pagado_fin', r.monto_pagado_fin::text, c.monto_pagado_fin::text; end if;
    if r.estado_pago_financiamiento is distinct from c.estado_pago_financiamiento then return query select 'oc', r.id, 'estado_pago_financiamiento', r.estado_pago_financiamiento, c.estado_pago_financiamiento; end if;
    if r.monto_facturado is distinct from c.monto_facturado then return query select 'oc', r.id, 'monto_facturado', r.monto_facturado::text, c.monto_facturado::text; end if;
    if r.estado_factura_propia is distinct from c.estado_factura_propia then return query select 'oc', r.id, 'estado_factura_propia', r.estado_factura_propia, c.estado_factura_propia; end if;
    if r.monto_cobrado is distinct from c.monto_cobrado then return query select 'oc', r.id, 'monto_cobrado', r.monto_cobrado::text, c.monto_cobrado::text; end if;
    if r.estado_pago_cliente is distinct from c.estado_pago_cliente then return query select 'oc', r.id, 'estado_pago_cliente', r.estado_pago_cliente, c.estado_pago_cliente; end if;
  end loop;
  return query select 'financiador', f.id, 'saldo_deuda', f.saldo_deuda::text, public.fin_calculo_financiador(f.id, true, true)::text
                 from public.financiadores f where f.saldo_deuda is distinct from public.fin_calculo_financiador(f.id, true, true);
end $$;

-- ── 7. Corte: diferencias históricas congeladas (no cambia ningún valor) ───────────────────
create temp table _f4b_calc on commit drop as
  select o.id, o.numero_oc, o.financiador_id, o.es_venta_propia, c.*
    from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, false) c;

-- 7a. Montos de OC
insert into public.fin_diferencias_historicas (entidad, entidad_id, etiqueta, campo, valor_registrado, valor_eventos, diferencia, bloquea, causa, clasificacion)
select 'oc', o.id, o.numero_oc, x.campo, x.reg::text, x.ev::text, x.reg - x.ev,
       case when x.campo in ('costo_total', 'monto_pagado_fin') then array['financiamiento']
            when x.campo = 'monto_facturado' then array['facturacion'] else array['cobro'] end,
       x.causa, x.clasif
  from public.ordenes_compra_v2 o join _f4b_calc k on k.id = o.id
  cross join lateral (values
    ('costo_total', o.costo_total, k.costo_total,
       case when abs(o.costo_total - k.costo_total) < 1 then 'Decimales en el costo de la compra importada (' || k.costo_total || ')'
            else 'El costo de la OC (' || public.fin_pesos(o.costo_total) || ') no coincide con su compra (' || public.fin_pesos(k.costo_total) || ')' end,
       case when abs(o.costo_total - k.costo_total) < 1 then 'segura' else 'decision' end),
    ('monto_pagado_fin', o.monto_pagado_fin, k.monto_pagado_fin,
       case when exists (select 1 from public.financiadores f where f.id = o.financiador_id and f.tipo = 'propio')
              then 'Fondos propios (Cuenta BFK): pagos registrados al propio BFK para cerrar la etapa; no actualizaron el monto pagado'
            when k.monto_pagado_fin = 0 and exists (select 1 from public.historial_cambios h where h.oc_id = o.id and h.accion ilike 'Elimin%financ%')
              then 'Se eliminó el pago al financiador y el monto pagado no se revirtió'
            when k.monto_pagado_fin > o.monto_pagado_fin and k.monto_pagado_fin = o.costo_total
              then 'Pagos registrados directamente en la base sin actualizar el monto pagado (los pagos cubren el costo)'
            else 'El monto pagado no coincide con los pagos registrados' end,
       case when exists (select 1 from public.financiadores f where f.id = o.financiador_id and f.tipo = 'propio') then 'decision'
            when k.monto_pagado_fin = 0 and exists (select 1 from public.historial_cambios h where h.oc_id = o.id and h.accion ilike 'Elimin%financ%') then 'segura'
            when k.monto_pagado_fin > o.monto_pagado_fin and k.monto_pagado_fin = o.costo_total then 'segura'
            else 'decision' end),
    ('monto_facturado', o.monto_facturado, k.monto_facturado,
       'Facturas vigentes ' || public.fin_pesos(k.monto_facturado) || ' (N° ' || coalesce((select string_agg(v.numero_factura, ', ' order by v.fecha, v.numero_factura) from public.fin_facturas_vigentes(o.id) v), '—')
         || '): cadena de anulación ambigua o número repetido',
       'decision'),
    ('monto_cobrado', o.monto_cobrado, k.monto_cobrado, 'El monto cobrado no coincide con los cobros registrados', 'decision')
  ) as x(campo, reg, ev, causa, clasif)
 where x.reg is distinct from x.ev;

-- 7b. Estados de OC (con los montos ya congelados): se conserva el estado registrado
insert into public.fin_diferencias_historicas (entidad, entidad_id, etiqueta, campo, valor_registrado, valor_eventos, diferencia, bloquea, causa, clasificacion)
select 'oc', o.id, o.numero_oc, x.campo, x.reg, x.ev, null,
       case when x.campo in ('estado_compra', 'estado_pago_financiamiento') then array['financiamiento']
            when x.campo = 'estado_factura_propia' then array['facturacion'] else array['cobro'] end,
       x.causa, x.clasif
  from public.ordenes_compra_v2 o
  cross join lateral public.fin_calculo_oc(o.id, true) k
  cross join lateral (values
    ('estado_compra', o.estado_compra, k.estado_compra, 'Estado de compra distinto de sus compras registradas', 'decision'),
    ('estado_pago_financiamiento', o.estado_pago_financiamiento,
       (select c.estado_pago_financiamiento from public.fin_calculo_oc(o.id, false) c),
       case when o.es_venta_propia then 'Regla 3: venta propia, la etapa de financiamiento no aplica'
            when public.fin_tipo_financiamiento(o.id) = 'fondos_propios' then 'Regla 2: fondos propios (Cuenta BFK), la etapa de financiamiento no aplica'
            else 'Estado de financiamiento coherente con los pagos registrados, no con el monto pagado guardado' end,
       case when o.es_venta_propia then 'segura'
            when public.fin_tipo_financiamiento(o.id) = 'fondos_propios' then 'decision'
            else coalesce((select d.clasificacion from public.fin_diferencias_historicas d where d.entidad = 'oc' and d.entidad_id = o.id and d.campo = 'monto_pagado_fin'), 'decision') end),
    ('estado_factura_propia', o.estado_factura_propia, k.estado_factura_propia, 'Estado de factura distinto de sus facturas vigentes', 'decision'),
    ('estado_pago_cliente', o.estado_pago_cliente, k.estado_pago_cliente, 'Estado de cobro distinto de sus cobros y facturas vigentes', 'decision')
  ) as x(campo, reg, ev, causa, clasif)
 where x.reg is distinct from k.estado_compra and x.campo = 'estado_compra'
    or x.reg is distinct from k.estado_pago_financiamiento and x.campo = 'estado_pago_financiamiento'
    or x.reg is distinct from k.estado_factura_propia and x.campo = 'estado_factura_propia'
    or x.reg is distinct from k.estado_pago_cliente and x.campo = 'estado_pago_cliente';

-- 7c. Saldos de financiadores (con las diferencias de OC ya congeladas)
insert into public.fin_diferencias_historicas (entidad, entidad_id, etiqueta, campo, valor_registrado, valor_eventos, diferencia, filas, causa, clasificacion)
select 'financiador', f.id, f.nombre, 'saldo_deuda', f.saldo_deuda::text, x.calc::text, f.saldo_deuda - x.calc,
       case when x.aj <> 0 and f.saldo_deuda - x.calc = -x.aj
              then array(select 'ajustes_saldo_financiador:' || a.id from public.ajustes_saldo_financiador a where a.financiador_id = f.id order by a.id)
            when f.saldo_deuda = 0 and x.calc < 0
              then array(select 'eventos_pago_financiamiento:' || p.id from public.eventos_pago_financiamiento p where p.financiador_id = f.id and p.oc_id is null order by p.id)
            else '{}' end,
       case when x.aj <> 0 and f.saldo_deuda - x.calc = -x.aj
              then 'El saldo guardado no incluye los ajustes manuales registrados (' || public.fin_pesos(x.aj) || ', '
                   || (select string_agg(to_char(a.fecha, 'DD-MM-YYYY') || ': ' || a.motivo, '; ') from public.ajustes_saldo_financiador a where a.financiador_id = f.id) || ')'
            when f.saldo_deuda = 0 and x.calc < 0
              then 'Pagos mayores que la deuda (pago sin OC): el saldo se dejó en cero y el exceso (' || public.fin_pesos(-x.calc) || ') no quedó registrado'
            else 'El saldo guardado no coincide con compras − pagos + ajustes' end,
       'decision'
  from public.financiadores f
  cross join lateral (select public.fin_calculo_financiador(f.id, true, false) calc,
                             (select coalesce(sum(a.monto_ajuste), 0) from public.ajustes_saldo_financiador a where a.financiador_id = f.id) aj) x
 where f.saldo_deuda is distinct from x.calc;

-- ── 8. Disparadores (después del corte) ────────────────────────────────────────────────────
create trigger fin_proteger_derivados before insert or update on public.ordenes_compra_v2
  for each row execute function public.fin_trg_proteger_oc();
create trigger fin_bloqueo_financiamiento before update of financiador_id, es_venta_propia on public.ordenes_compra_v2
  for each row execute function public.fin_trg_bloqueo_oc();
create trigger fin_recalcular_financiamiento after insert or delete or update of financiador_id, es_venta_propia on public.ordenes_compra_v2
  for each row execute function public.fin_trg_oc_financiamiento();

create trigger fin_proteger_saldo before insert or update on public.financiadores
  for each row execute function public.fin_trg_proteger_financiador();
create trigger fin_bloqueo_tipo before update of tipo on public.financiadores
  for each row execute function public.fin_trg_bloqueo_financiador();
create trigger fin_recalcular_tipo after update of tipo on public.financiadores
  for each row execute function public.fin_trg_financiador_tipo();

create trigger fin_bloqueo before insert or update or delete on public.eventos_compra for each row execute function public.fin_trg_bloqueo_eventos();
create trigger fin_recalcular after insert or update or delete on public.eventos_compra for each row execute function public.fin_trg_recalcular_eventos();
create trigger fin_bloqueo before insert or update or delete on public.eventos_pago_financiamiento for each row execute function public.fin_trg_bloqueo_eventos();
create trigger fin_recalcular after insert or update or delete on public.eventos_pago_financiamiento for each row execute function public.fin_trg_recalcular_eventos();
create trigger fin_bloqueo before insert or update or delete on public.ajustes_saldo_financiador for each row execute function public.fin_trg_bloqueo_eventos();
create trigger fin_recalcular after insert or update or delete on public.ajustes_saldo_financiador for each row execute function public.fin_trg_recalcular_eventos();
create trigger fin_bloqueo before insert or update or delete on public.eventos_factura for each row execute function public.fin_trg_bloqueo_eventos();
create trigger fin_recalcular after insert or update or delete on public.eventos_factura for each row execute function public.fin_trg_recalcular_eventos();
create trigger fin_bloqueo before insert or update or delete on public.eventos_pago_cliente for each row execute function public.fin_trg_bloqueo_eventos();
create trigger fin_recalcular after insert or update or delete on public.eventos_pago_cliente for each row execute function public.fin_trg_recalcular_eventos();

-- La importación exacta de respaldos restaura valores tal cual (sin recálculo ni protección).
alter function public.importar_respaldo_excel(jsonb, boolean) set bfk.importacion = 'on';

-- ── 9. Permisos ────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Internas: nadie las ejecuta directamente (los disparadores no requieren permiso de ejecución).
  foreach f in array array[
    'fin_es_importacion()', 'fin_es_cliente()', 'fin_dif_monto(text,text,text)', 'fin_dif_estado(text,text)',
    'fin_tipo_financiamiento(text)', 'fin_facturas_vigentes(text)', 'fin_calculo_oc(text,boolean)',
    'fin_calculo_financiador(text,boolean,boolean)', 'fin_recalcular_oc(text)', 'fin_recalcular_financiador(text)',
    'fin_recalcular(text[],text[])', 'fin_motivo_bloqueo(text,text)', 'fin_fila_bloqueada(text,text)',
    'fin_exigir_sin_bloqueo(text,text)', 'fin_trg_proteger_oc()', 'fin_trg_proteger_financiador()',
    'fin_trg_bloqueo_eventos()', 'fin_trg_recalcular_eventos()', 'fin_trg_oc_financiamiento()', 'fin_trg_bloqueo_oc()',
    'fin_trg_financiador_tipo()', 'fin_trg_bloqueo_financiador()', 'fin_nuevo_id(text)', 'fin_historial(text,text,text,text,text)',
    'fin_pesos(numeric)', 'fin_resumen_oc(text)', 'fin_verificar_consistencia()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  -- Operaciones de la aplicación: solo usuarios con sesión.
  foreach f in array array[
    'registrar_compra_oc(text,date,numeric,text,text,date,numeric,text)', 'editar_compra_oc(text,date,numeric,numeric,date,text)',
    'eliminar_compra_oc(text)', 'registrar_pago_financiador(text,date,numeric,jsonb,text)', 'editar_pago_financiador(text,date,numeric)',
    'eliminar_pago_financiador(text)', 'cambiar_financiamiento_oc(text,text,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
-- Funciones que las RPC (con permisos de quien llama) usan internamente.
grant execute on function public.fin_exigir_sin_bloqueo(text, text), public.fin_tipo_financiamiento(text),
  public.fin_calculo_oc(text, boolean), public.fin_nuevo_id(text), public.fin_historial(text, text, text, text, text),
  public.fin_pesos(numeric), public.fin_resumen_oc(text), public.fin_es_importacion(), public.fin_es_cliente(),
  public.fin_motivo_bloqueo(text, text), public.fin_fila_bloqueada(text, text), public.fin_dif_monto(text, text, text),
  public.fin_dif_estado(text, text), public.fin_facturas_vigentes(text) to authenticated;

-- ── 10. Verificación final (misma transacción): ningún valor cambió y todo es coherente ────
do $$
declare v_n int; v_txt text;
begin
  select count(*) into v_n from public.fin_verificar_consistencia();
  if v_n <> 0 then
    select string_agg(entidad || ':' || entidad_id || ':' || campo || ' ' || coalesce(guardado, '∅') || '≠' || coalesce(calculado, '∅'), ', ')
      into v_txt from (select * from public.fin_verificar_consistencia() limit 5) z;
    raise exception 'FASE4B: % valores no coinciden con el cálculo: %', v_n, v_txt;
  end if;
  select count(*) into v_n from _f4b_antes_oc a join public.ordenes_compra_v2 o on o.id = a.id
   where (a.costo_total, a.estado_compra, a.monto_pagado_fin, a.estado_pago_financiamiento, a.monto_facturado,
          a.estado_factura_propia, a.monto_cobrado, a.estado_pago_cliente, a.huella)
         is distinct from
         (o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento, o.monto_facturado,
          o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente, md5(to_jsonb(o)::text));
  if v_n <> 0 or (select count(*) from _f4b_antes_oc) <> (select count(*) from public.ordenes_compra_v2) then
    raise exception 'FASE4B: cambiaron % OCs (no debía cambiar ninguna)', v_n;
  end if;
  select count(*) into v_n from _f4b_antes_fin a join public.financiadores f on f.id = a.id
   where a.saldo_deuda is distinct from f.saldo_deuda or a.huella is distinct from md5((to_jsonb(f) - 'tipo')::text);
  if v_n <> 0 or (select count(*) from _f4b_antes_fin) <> (select count(*) from public.financiadores) then
    raise exception 'FASE4B: cambiaron % financiadores (no debía cambiar ninguno)', v_n;
  end if;
end $$;

notify pgrst, 'reload schema';
