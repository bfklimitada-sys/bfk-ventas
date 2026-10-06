-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase 4B · Correcciones históricas SEGURAS (2026-10-06) — PREPARADA, NO APLICADA EN PRODUCCIÓN.
--
-- Solo se aplica con aprobación explícita. Requiere la migración 2026-10-06-integridad-financiera.sql.
-- Una sola transacción, ejecutada por el dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -v SEG_N=<n> -v SEG_HUELLA=<md5> -1 -f 2026-10-06-correcciones-historicas-seguras.sql
-- SEG_N y SEG_HUELLA identifican EXACTAMENTE las diferencias revisadas y aprobadas (informe de la Fase 4B;
-- el detalle OC por OC no se publica en este repositorio). Si lo pendiente no es exactamente eso, no se aplica nada.
--
-- Qué hace
--   · Adopta el valor de los eventos en las diferencias clasificadas 'segura' (fin_diferencias_historicas):
--     se marcan 'resuelta' y la base recalcula esas OCs desde sus eventos.
--   · Compras importadas con decimales (diferencia segura de costo): redondea el costo del evento al peso
--     (queda igual al costo guardado en la OC) y alinea el financiador del evento con el de la OC y sus pagos.
--   · No toca diferencias 'decision', ni financiadores, ni fechas, ni vendedores, ni productos.
--   · Deja cada cambio en fin_correcciones_registro (lote 'seguras-4b') y en el historial de cada OC.
-- Garantías verificadas dentro de la transacción (si algo no cuadra, se aborta sin cambios)
--   · Cada campo corregido queda igual al valor de los eventos (costo: redondeado al peso).
--   · Ningún saldo de financiador cambia. Ninguna otra OC cambia. fin_verificar_consistencia() vacía.
-- Deshacer: 2026-10-06-correcciones-historicas-seguras-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
select set_config('bfk.seg_n', :'SEG_N', true), set_config('bfk.seg_huella', :'SEG_HUELLA', true);

-- ── 0. Precondiciones ──────────────────────────────────────────────────────────────────────
do $$
declare v_n int; v_h text;
begin
  if to_regclass('public.fin_diferencias_historicas') is null then
    raise exception 'FASE4B-SEG: la migración de integridad financiera no está aplicada';
  end if;
  if to_regclass('public.fin_correcciones_registro') is not null then
    if exists (select 1 from public.fin_correcciones_registro r where r.lote = 'seguras-4b' and r.revertida_en is null) then
      raise exception 'FASE4B-SEG: las correcciones seguras ya fueron aplicadas';
    end if;
  end if;
  select count(*), md5(coalesce(string_agg(d.entidad || '|' || d.entidad_id || '|' || d.campo || '|' || coalesce(d.valor_registrado, '')
                                           || '|' || coalesce(d.valor_eventos, ''), ',' order by d.entidad, d.entidad_id, d.campo), ''))
    into v_n, v_h
    from public.fin_diferencias_historicas d where d.clasificacion = 'segura' and d.estado = 'pendiente';
  if v_n::text <> current_setting('bfk.seg_n') or v_h <> current_setting('bfk.seg_huella') then
    raise exception 'FASE4B-SEG: las diferencias seguras pendientes (% filas, huella %) no son las aprobadas (% filas, huella %). No se aplicó nada.',
      v_n, v_h, current_setting('bfk.seg_n'), current_setting('bfk.seg_huella');
  end if;
  if exists (select 1 from public.fin_diferencias_historicas d where d.clasificacion = 'segura' and d.estado = 'pendiente' and d.entidad <> 'oc') then
    raise exception 'FASE4B-SEG: hay diferencias seguras de financiadores, no previstas en este script';
  end if;
end $$;

-- Registro de correcciones aplicadas (auditoría y deshacer). Solo lo lee y escribe el dueño de las tablas.
create table if not exists public.fin_correcciones_registro (
  id bigserial primary key,
  lote text not null,
  aplicada_en timestamptz not null default now(),
  tabla text not null,
  fila_id text not null,
  campo text not null,
  antes text,
  despues text,
  motivo text,
  revertida_en timestamptz
);
alter table public.fin_correcciones_registro enable row level security;
revoke all on public.fin_correcciones_registro from public, anon, authenticated;
revoke all on sequence public.fin_correcciones_registro_id_seq from public, anon, authenticated;

-- ── 1. Fotos (antes) ──────────────────────────────────────────────────────────────────────
create temp table _seg_filas on commit drop as
  select d.* from public.fin_diferencias_historicas d where d.clasificacion = 'segura' and d.estado = 'pendiente';
create temp table _seg_ocs_antes on commit drop as
  select o.id, o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento, o.monto_facturado,
         o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente
    from public.ordenes_compra_v2 o where o.id in (select entidad_id from _seg_filas);
create temp table _seg_otras_antes on commit drop as
  select o.id, md5(to_jsonb(o)::text) huella from public.ordenes_compra_v2 o where o.id not in (select entidad_id from _seg_filas);
create temp table _seg_fin_antes on commit drop as select f.id, f.saldo_deuda, md5(to_jsonb(f)::text) huella from public.financiadores f;
-- Compras de las OCs con diferencia segura de costo (decimales): costo redondeado y financiador de la OC.
create temp table _seg_compras on commit drop as
  select e.id, e.oc_id, e.costo_compra as costo_antes, round(e.costo_compra) as costo_despues,
         e.financiador_id as fin_antes, o.financiador_id as fin_despues
    from public.eventos_compra e join public.ordenes_compra_v2 o on o.id = e.oc_id
   where e.oc_id in (select f.entidad_id from _seg_filas f where f.campo = 'costo_total')
     and (e.costo_compra <> round(e.costo_compra) or e.financiador_id is distinct from o.financiador_id);

do $$
declare v int;
begin
  -- El redondeo debe dar exactamente el costo guardado en la OC (si no, no es un caso de decimales).
  select count(*) into v from _seg_filas f
   where f.campo = 'costo_total'
     and (select coalesce(sum(round(e.costo_compra)), 0) from public.eventos_compra e where e.oc_id = f.entidad_id) <> f.valor_registrado::numeric;
  if v > 0 then raise exception 'FASE4B-SEG: % diferencia(s) de costo no se explican por decimales', v; end if;
  -- El financiador del evento se alinea solo si todos los pagos de la OC van al financiador de la OC.
  select count(*) into v from _seg_compras c
   where exists (select 1 from public.eventos_pago_financiamiento p where p.oc_id = c.oc_id and p.financiador_id is distinct from c.fin_despues);
  if v > 0 then raise exception 'FASE4B-SEG: % compra(s) con pagos a otro financiador; requiere decisión', v; end if;
end $$;

-- ── 2. Correcciones ───────────────────────────────────────────────────────────────────────
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'seguras-4b', 'fin_diferencias_historicas', f.id::text, 'estado', 'pendiente', 'resuelta',
       f.etiqueta || ' · ' || f.campo || ': ' || f.causa
  from _seg_filas f;
update public.fin_diferencias_historicas d
   set estado = 'resuelta', resuelta_en = now(), resuelta_por = null,
       resolucion = 'Corrección segura aprobada (Fase 4B): se adopta el valor de los eventos'
 where d.id in (select f.id from _seg_filas f);

insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'seguras-4b', 'eventos_compra', c.id, x.campo, x.antes, x.despues, 'Compra importada con decimales (OC ' || c.oc_id || ')'
  from _seg_compras c
  cross join lateral (values ('costo_compra', c.costo_antes::text, c.costo_despues::text),
                             ('financiador_id', c.fin_antes, c.fin_despues)) x(campo, antes, despues)
 where x.antes is distinct from x.despues;
update public.eventos_compra e set costo_compra = c.costo_despues, financiador_id = c.fin_despues
  from _seg_compras c where e.id = c.id;

select public.fin_recalcular(
  array(select a.id from _seg_ocs_antes a),
  array(select distinct z.x from (select o.financiador_id as x from public.ordenes_compra_v2 o where o.id in (select a.id from _seg_ocs_antes a)
                                  union select c.fin_antes from _seg_compras c) z where z.x is not null));

-- Registro e historial de cada valor que cambió en las OCs.
create temp table _seg_cambios on commit drop as
  select a.id, x.campo, x.antes, x.despues
    from _seg_ocs_antes a join public.ordenes_compra_v2 o on o.id = a.id
    cross join lateral (values   -- montos: comparación numérica (no por texto)
      ('costo_total', a.costo_total::text, o.costo_total::text, a.costo_total is distinct from o.costo_total),
      ('estado_compra', a.estado_compra, o.estado_compra, a.estado_compra is distinct from o.estado_compra),
      ('monto_pagado_fin', a.monto_pagado_fin::text, o.monto_pagado_fin::text, a.monto_pagado_fin is distinct from o.monto_pagado_fin),
      ('estado_pago_financiamiento', a.estado_pago_financiamiento, o.estado_pago_financiamiento, a.estado_pago_financiamiento is distinct from o.estado_pago_financiamiento),
      ('monto_facturado', a.monto_facturado::text, o.monto_facturado::text, a.monto_facturado is distinct from o.monto_facturado),
      ('estado_factura_propia', a.estado_factura_propia, o.estado_factura_propia, a.estado_factura_propia is distinct from o.estado_factura_propia),
      ('monto_cobrado', a.monto_cobrado::text, o.monto_cobrado::text, a.monto_cobrado is distinct from o.monto_cobrado),
      ('estado_pago_cliente', a.estado_pago_cliente, o.estado_pago_cliente, a.estado_pago_cliente is distinct from o.estado_pago_cliente)
    ) x(campo, antes, despues, cambio)
   where x.cambio;
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'seguras-4b', 'ordenes_compra_v2', c.id, c.campo, c.antes, c.despues, 'Recalculado desde los eventos'
  from _seg_cambios c;
insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
select 'hc_seg4b_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || row_number() over (order by c.id, c.campo),
       c.id, o.numero_oc, null, 'Corrección Fase 4B', 'Corrección histórica aprobada (Fase 4B)', c.campo,
       case when c.campo like 'monto%' or c.campo = 'costo_total' then public.fin_pesos(c.antes::numeric) else c.antes end,
       case when c.campo like 'monto%' or c.campo = 'costo_total' then public.fin_pesos(c.despues::numeric) else c.despues end
  from _seg_cambios c join public.ordenes_compra_v2 o on o.id = c.id;

-- ── 3. Verificación (misma transacción) ───────────────────────────────────────────────────
do $$
declare v int;
begin
  select count(*) into v
    from _seg_filas d join public.ordenes_compra_v2 o on o.id = d.entidad_id
   where case d.campo
           when 'costo_total' then o.costo_total <> round(d.valor_eventos::numeric)
           when 'monto_pagado_fin' then o.monto_pagado_fin <> d.valor_eventos::numeric
           when 'monto_facturado' then o.monto_facturado <> d.valor_eventos::numeric
           when 'monto_cobrado' then o.monto_cobrado <> d.valor_eventos::numeric
           when 'estado_compra' then o.estado_compra is distinct from d.valor_eventos
           when 'estado_pago_financiamiento' then o.estado_pago_financiamiento is distinct from d.valor_eventos
           when 'estado_factura_propia' then o.estado_factura_propia is distinct from d.valor_eventos
           when 'estado_pago_cliente' then o.estado_pago_cliente is distinct from d.valor_eventos
           else true end;
  if v > 0 then raise exception 'FASE4B-SEG: % campo(s) no quedaron en el valor de los eventos', v; end if;
  select count(*) into v from _seg_fin_antes a join public.financiadores f on f.id = a.id where md5(to_jsonb(f)::text) <> a.huella;
  if v > 0 then raise exception 'FASE4B-SEG: cambiaría el saldo u otro dato de % financiador(es)', v; end if;
  select count(*) into v from _seg_otras_antes a join public.ordenes_compra_v2 o on o.id = a.id where md5(to_jsonb(o)::text) <> a.huella;
  if v > 0 then raise exception 'FASE4B-SEG: cambiarían % OC(s) fuera de las corregidas', v; end if;
  select count(*) into v from public.fin_verificar_consistencia();
  if v > 0 then raise exception 'FASE4B-SEG: % valor(es) guardados difieren de los calculados', v; end if;
  if exists (select 1 from public.fin_diferencias_historicas d where d.clasificacion = 'segura' and d.estado = 'pendiente') then
    raise exception 'FASE4B-SEG: quedaron diferencias seguras pendientes';
  end if;
  raise notice 'FASE4B-SEG: % diferencias resueltas en % OCs; % valores de OC cambiados; % compra(s) redondeada(s); saldos sin cambios',
    (select count(*) from _seg_filas), (select count(*) from _seg_ocs_antes), (select count(*) from _seg_cambios), (select count(*) from _seg_compras);
end $$;
