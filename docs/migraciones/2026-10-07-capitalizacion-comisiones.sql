-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Ventas de capitalización de BFK Ltda. y vendedor histórico según Contabilidad General (2026-10-07).
-- Requiere 2026-10-07-vendedor-financiador.sql. Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-capitalizacion-comisiones.sql
--
-- Estructura (ordenes_compra_v2; no cambia ningún monto ni estado financiero)
--   · capitalizacion_bfk: venta de capitalización de BFK Ltda.: sin vendedor personal, no genera comisión.
--     Restricción: una OC de capitalización no tiene vendedor ni es venta propia.
--   · comision_excluida: OC con vendedor asignado después del cierre de su mes de comisión; figura con su vendedor
--     pero no entra en el cálculo de comisión (no crea deuda histórica ni altera un pago ya realizado).
--   · asignar_vendedor_oc acepta '__capitalizacion__' (marca la OC como capitalización de BFK Ltda.).
-- Datos (confirmados por administración, por ID y con pre-estado verificado; idempotente)
--   · 5 OCs → capitalización BFK Ltda.: PUENTE-INALAMBRICO, SOC-RAMIREZ-ALDANA-1..4 (financiador sin cambios).
--   · 23 OCs → vendedor Matías Vegas (Contabilidad General). Las 19 de meses ya cerrados (2024-08…2026-07) quedan
--     con comision_excluida; las 4 de agosto 2026 (mes pendiente) entran en el cálculo vigente.
-- Deshacer: 2026-10-07-capitalizacion-comisiones-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regprocedure('public.asignar_vendedor_oc(text,text)') is null then raise exception 'CAP: falta la migración vendedor-financiador'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'ordenes_compra_v2' and column_name = 'capitalizacion_bfk') then
    raise exception 'CAP: la migración ya está aplicada';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CAP: base inconsistente antes de empezar'; end if;
end $$;

-- Huella de lo que no debe cambiar (dinero y estados)
create temp table _cap_antes on commit drop as
  select o.id, o.financiador_id, o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento, o.monto_facturado,
         o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente, o.es_venta_propia, o.tipo_registro, o.monto_total
    from public.ordenes_compra_v2 o;
create temp table _cap_fin on commit drop as select f.id, f.saldo_deuda from public.financiadores f;

alter table public.ordenes_compra_v2
  add column capitalizacion_bfk boolean not null default false,
  add column comision_excluida boolean not null default false;
alter table public.ordenes_compra_v2
  add constraint ordenes_capitalizacion_sin_vendedor_chk check (not capitalizacion_bfk or (vendedor_id is null and not es_venta_propia));
comment on column public.ordenes_compra_v2.capitalizacion_bfk is 'Venta de capitalización de BFK Ltda.: sin vendedor personal, no genera comisión';
comment on column public.ordenes_compra_v2.comision_excluida is 'Vendedor asignado después del cierre de su mes de comisión: no entra en el cálculo de comisión';

create or replace function public.asignar_vendedor_oc(p_oc_id text, p_vendedor_id text default null) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_oc public.ordenes_compra_v2%rowtype; v_antes text; v_despues text; v_cap boolean;
begin
  if v_uid is null or not exists (select 1 from public.perfiles where id = v_uid) then raise exception 'Se requiere una sesión BFK válida'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then raise exception 'La OC no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  p_vendedor_id := nullif(btrim(coalesce(p_vendedor_id, '')), '');
  v_cap := p_vendedor_id = '__capitalizacion__';
  if v_cap then p_vendedor_id := null; end if;
  if p_vendedor_id is not null and not exists (select 1 from public.vendedores v where v.id = p_vendedor_id) then
    raise exception 'El vendedor % no existe', p_vendedor_id;
  end if;
  if (p_vendedor_id, coalesce(v_cap, false)) is not distinct from (v_oc.vendedor_id, v_oc.capitalizacion_bfk) then
    return jsonb_build_object('ok', true, 'sin_cambios', true);
  end if;
  if v_cap and v_oc.es_venta_propia then
    raise exception 'La OC % es venta propia: cambia primero el financiamiento para marcarla como capitalización de BFK Ltda.', v_oc.numero_oc;
  end if;
  v_antes := case when v_oc.capitalizacion_bfk then 'BFK Ltda. · Capitalización'
                  else coalesce((select nombre from public.vendedores where id = v_oc.vendedor_id), 'Sin definir') end;
  v_despues := case when v_cap then 'BFK Ltda. · Capitalización'
                    else coalesce((select nombre from public.vendedores where id = p_vendedor_id), 'Sin definir') end;
  update public.ordenes_compra_v2 o set vendedor_id = p_vendedor_id, capitalizacion_bfk = coalesce(v_cap, false) where o.id = p_oc_id;   -- valida el disparador
  perform public.fin_historial(p_oc_id, 'Vendedor cambiado', 'vendedor_id', v_antes, v_despues);
  return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', v_despues);
end $$;

-- Una OC con la comisión excluida o de capitalización no está en ninguna comisión pagada: su vendedor se puede corregir.
create or replace function public.oc_trg_proteger_vendedor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p record;
begin
  if public.fin_es_importacion() then return new; end if;
  if new.vendedor_id is not distinct from old.vendedor_id and new.es_venta_propia is not distinct from old.es_venta_propia then return new; end if;
  if coalesce(new.es_venta_propia, false) and new.vendedor_id is null then
    raise exception 'La OC % es venta propia: necesita un vendedor', new.numero_oc using errcode = 'P4V01';
  end if;
  if new.vendedor_id is distinct from old.vendedor_id and old.vendedor_id is not null
     and coalesce(old.tipo_registro, 'venta') = 'venta' and old.estado_factura_propia = 'emitida'
     and not old.comision_excluida and not old.capitalizacion_bfk then   -- esas OCs no entran en la comisión del mes
    select * into p from public.fin_periodo_comision(old.id);
    if p.anio is not null and exists (select 1 from public.pagos_vendedor v
                                       where v.vendedor_id = old.vendedor_id and v.anio = p.anio and v.mes = p.mes) then
      raise exception 'La comisión de %/% ya se pagó a este vendedor e incluye la OC %. No se cambió el vendedor (el pago histórico no se altera).',
        p.mes, p.anio, old.numero_oc using errcode = 'P4V02';
    end if;
  end if;
  return new;
end $$;


-- ── Datos ─────────────────────────────────────────────────────────────────────────────────
do $$
declare r record; o public.ordenes_compra_v2; v_cg record; p record; v_n int;
  v_cap int := 0; v_vend int := 0; v_excl int := 0; v_omit int := 0;
begin
  -- 5 ventas de capitalización
  for r in select unnest(array['PUENTE-INALAMBRICO','SOC-RAMIREZ-ALDANA-1','SOC-RAMIREZ-ALDANA-2','SOC-RAMIREZ-ALDANA-3','SOC-RAMIREZ-ALDANA-4']) as numero loop
    select count(*) into v_n from public.ordenes_compra_v2 where numero_oc = r.numero;
    select * into o from public.ordenes_compra_v2 where numero_oc = r.numero;
    if v_n <> 1 or o.vendedor_id is not null or o.es_venta_propia or o.archivada or coalesce(o.tipo_registro, 'venta') <> 'venta' then
      raise exception 'CAP: pre-estado distinto en % (n=%, vendedor %, venta propia %)', r.numero, v_n, o.vendedor_id, o.es_venta_propia;
    end if;
    update public.ordenes_compra_v2 set capitalizacion_bfk = true where id = o.id;
    insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
    values ('capitalizacion-comisiones-20261007', 'ordenes_compra_v2', o.id, 'capitalizacion_bfk', 'false', 'true',
            'Venta de capitalización de BFK Ltda. (confirmado por administración): sin vendedor personal, no genera comisión');
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
    values (public.fin_nuevo_id('hc'), o.id, o.numero_oc, null, 'Migración vendedor/financiador', 'Marcada como venta de capitalización de BFK Ltda.', 'vendedor_id', 'Sin definir', 'BFK Ltda. · Capitalización');
    v_cap := v_cap + 1;
  end loop;

  -- 23 OCs: vendedor Matías Vegas según Contabilidad General (excluida = mes de comisión ya cerrado)
  for r in select * from (values
      ('1057417-11191-AG24', 2024, 8, true),
      ('921831-302-AG24', 2024, 11, true), ('4152-1324-AG24', 2024, 11, true), ('1057415-637-AG24', 2024, 11, true), ('3803-188-AG24', 2024, 11, true),
      ('1650-630-AG24', 2024, 11, true), ('483-654-AG24', 2024, 11, true), ('4237-108-AG24', 2024, 11, true),
      ('1969-1734-AG24', 2024, 12, true), ('4020-1440-AG24', 2024, 12, true), ('4083-662-AG24', 2024, 12, true), ('1057431-3748-AG24', 2024, 12, true), ('4474-1318-AG24', 2024, 12, true),
      ('1057429-2-AG25', 2025, 1, true), ('1161266-31-AG25', 2025, 1, true),
      ('3085-153-AG25', 2025, 3, true), ('3017-60-AG25', 2025, 3, true),
      ('3786-91-AG26', 2026, 7, true), ('3017-567-AG26', 2026, 7, true),
      ('2905-498-AG26', 2026, 8, false), ('233-40-AG26', 2026, 8, false), ('4168-1088-AG26', 2026, 8, false), ('2279-468-AG26', 2026, 8, false)
    ) x(numero, anio, mes, excluir) loop
    select count(*) into v_n from public.ordenes_compra_v2 where numero_oc = r.numero;
    select * into o from public.ordenes_compra_v2 where numero_oc = r.numero;
    select * into p from public.fin_periodo_comision(o.id);
    select count(*) as n, min(c.vendedor) as v, min(c.fin) as f into v_cg from public.cg_import c where upper(btrim(c.oc)) = upper(btrim(r.numero));
    if v_n <> 1 or o.vendedor_id is not null or o.capitalizacion_bfk or o.archivada or v_cg.n <> 1 or lower(v_cg.v) <> 'matias'
       or p.anio is distinct from r.anio or p.mes is distinct from r.mes then
      raise exception 'CAP: pre-estado distinto en % (n=%, vendedor %, cg %/%, periodo %-%)', r.numero, v_n, o.vendedor_id, v_cg.n, v_cg.v, p.anio, p.mes;
    end if;
    update public.ordenes_compra_v2 set vendedor_id = 'vend_matias', comision_excluida = r.excluir where id = o.id;
    insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
    values ('capitalizacion-comisiones-20261007', 'ordenes_compra_v2', o.id, 'vendedor_id', null, 'vend_matias',
            'Vendedor según Contabilidad General (vendedor ' || v_cg.v || ', financiador ' || v_cg.f || '); mes de comisión ' || r.mes || '/' || r.anio
            || case when r.excluir then ' cerrado: sin comisión (no crea deuda ni altera pagos)' else ' pendiente: entra en el cálculo vigente' end);
    if r.excluir then
      insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
      values ('capitalizacion-comisiones-20261007', 'ordenes_compra_v2', o.id, 'comision_excluida', 'false', 'true', 'Mes de comisión ' || r.mes || '/' || r.anio || ' cerrado');
      v_excl := v_excl + 1;
    end if;
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
    values (public.fin_nuevo_id('hc'), o.id, o.numero_oc, null, 'Migración vendedor/financiador',
            'Vendedor completado desde Contabilidad General' || case when r.excluir then ' (sin comisión: mes ' || r.mes || '/' || r.anio || ' ya cerrado)' else '' end,
            'vendedor_id', 'Sin definir', 'Matías Vegas');
    v_vend := v_vend + 1;
  end loop;

  -- Garantías: ningún monto, estado financiero, financiador ni saldo cambió; base consistente.
  select count(*) into v_n from _cap_antes a join public.ordenes_compra_v2 o on o.id = a.id
   where (a.financiador_id, a.costo_total, a.estado_compra, a.monto_pagado_fin, a.estado_pago_financiamiento, a.monto_facturado,
          a.estado_factura_propia, a.monto_cobrado, a.estado_pago_cliente, a.es_venta_propia, a.tipo_registro, a.monto_total)
         is distinct from
         (o.financiador_id, o.costo_total, o.estado_compra, o.monto_pagado_fin, o.estado_pago_financiamiento, o.monto_facturado,
          o.estado_factura_propia, o.monto_cobrado, o.estado_pago_cliente, o.es_venta_propia, o.tipo_registro, o.monto_total);
  if v_n <> 0 then raise exception 'CAP: % OCs cambiaron montos o estados; no se aplica nada', v_n; end if;
  if exists (select 1 from _cap_fin a join public.financiadores f on f.id = a.id where f.saldo_deuda is distinct from a.saldo_deuda) then
    raise exception 'CAP: cambió un saldo de financiador; no se aplica nada';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CAP: base inconsistente; no se aplica nada'; end if;
  raise notice 'CAP: OK (% capitalización, % con vendedor Matías, % con comisión excluida)', v_cap, v_vend, v_excl;
end $$;
