-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Vendedor y financiador por OC (2026-10-07). Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-vendedor-financiador.sql
--
-- Qué hace (solo estructura y reglas; NO modifica ningún dato existente)
--   · fin_periodo_comision(oc): mes de comisión de una OC = fecha de su factura vigente más reciente
--     (misma regla que periodoComision en src/lib/calculos.js).
--   · Disparador oc_proteger_vendedor: no permite cambiar el vendedor de una OC cuya comisión del mes ya se
--     pagó a ese vendedor (el pago histórico la incluye). Venta propia exige vendedor. La importación atómica
--     (fin_es_importacion) queda exenta, como en las demás reglas financieras.
--   · RPC asignar_vendedor_oc(oc, vendedor|null): cambio de vendedor con historial. No toca pagos ni comisiones.
--   · RPC asignar_financiador_oc(oc, financiador|null): cambio de financiador. Con financiador usa la operación
--     existente cambiar_financiamiento_oc (recalcula la deuda del anterior y del nuevo; rechaza si hay pagos al
--     financiador). "Sin definir" solo si la OC no tiene compra ni pagos al financiador.
-- Deshacer: 2026-10-07-vendedor-financiador-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.cambiar_financiamiento_oc(text,text,text)') is null or to_regprocedure('public.fin_facturas_vigentes(text)') is null then
    raise exception 'VEND-FIN: faltan las migraciones de integridad financiera / modelo tributario';
  end if;
  if to_regprocedure('public.asignar_vendedor_oc(text,text)') is not null then
    raise exception 'VEND-FIN: la migración ya está aplicada';
  end if;
end $$;

create or replace function public.fin_periodo_comision(p_oc_id text, out anio int, out mes int)
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(year from m)::int, extract(month from m)::int
    from (select max(f.fecha) m from public.fin_facturas_vigentes(p_oc_id) f) z
   where m is not null
$$;

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
     and coalesce(old.tipo_registro, 'venta') = 'venta' and old.estado_factura_propia = 'emitida' then
    select * into p from public.fin_periodo_comision(old.id);
    if p.anio is not null and exists (select 1 from public.pagos_vendedor v
                                       where v.vendedor_id = old.vendedor_id and v.anio = p.anio and v.mes = p.mes) then
      raise exception 'La comisión de %/% ya se pagó a este vendedor e incluye la OC %. No se cambió el vendedor (el pago histórico no se altera).',
        p.mes, p.anio, old.numero_oc using errcode = 'P4V02';
    end if;
  end if;
  return new;
end $$;

create trigger oc_proteger_vendedor before update of vendedor_id, es_venta_propia on public.ordenes_compra_v2
  for each row execute function public.oc_trg_proteger_vendedor();

create or replace function public.asignar_vendedor_oc(p_oc_id text, p_vendedor_id text default null) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_oc public.ordenes_compra_v2%rowtype; v_antes text; v_despues text;
begin
  if v_uid is null or not exists (select 1 from public.perfiles where id = v_uid) then raise exception 'Se requiere una sesión BFK válida'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then raise exception 'La OC no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  p_vendedor_id := nullif(btrim(coalesce(p_vendedor_id, '')), '');
  if p_vendedor_id is not null and not exists (select 1 from public.vendedores v where v.id = p_vendedor_id) then
    raise exception 'El vendedor % no existe', p_vendedor_id;
  end if;
  if p_vendedor_id is not distinct from v_oc.vendedor_id then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  select coalesce((select nombre from public.vendedores where id = v_oc.vendedor_id), 'Sin definir') into v_antes;
  select coalesce((select nombre from public.vendedores where id = p_vendedor_id), 'Sin definir') into v_despues;
  update public.ordenes_compra_v2 o set vendedor_id = p_vendedor_id where o.id = p_oc_id;   -- valida el disparador
  perform public.fin_historial(p_oc_id, 'Vendedor cambiado', 'vendedor_id', v_antes, v_despues);
  return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', v_despues);
end $$;

create or replace function public.asignar_financiador_oc(p_oc_id text, p_financiador_id text default null) returns jsonb
language plpgsql volatile set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_oc public.ordenes_compra_v2%rowtype; v_fin public.financiadores%rowtype; v_antes text; v_tipo text;
begin
  if v_uid is null or not exists (select 1 from public.perfiles where id = v_uid) then raise exception 'Se requiere una sesión BFK válida'; end if;
  select * into v_oc from public.ordenes_compra_v2 o where o.id = p_oc_id for no key update;
  if not found then raise exception 'La OC no existe'; end if;
  if v_oc.archivada then raise exception 'La OC % está archivada', v_oc.numero_oc; end if;
  p_financiador_id := nullif(btrim(coalesce(p_financiador_id, '')), '');
  if p_financiador_id is not distinct from v_oc.financiador_id then return jsonb_build_object('ok', true, 'sin_cambios', true); end if;
  if exists (select 1 from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id) then
    raise exception 'La OC % tiene pagos al financiador registrados (%): corríjalos o elimínelos antes de cambiar el financiador',
      v_oc.numero_oc, public.fin_pesos((select sum(p.monto) from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id));
  end if;
  if p_financiador_id is null then
    if exists (select 1 from public.eventos_compra e where e.oc_id = p_oc_id) then
      raise exception 'La OC % ya tiene la compra registrada: su costo es deuda de un financiador y no puede quedar sin definir', v_oc.numero_oc;
    end if;
    perform public.fin_exigir_sin_bloqueo(p_oc_id, 'financiamiento');
    select coalesce((select nombre from public.financiadores where id = v_oc.financiador_id), 'Sin definir') into v_antes;
    update public.ordenes_compra_v2 o set financiador_id = null where o.id = p_oc_id;   -- recalcula por disparador
    perform public.fin_historial(p_oc_id, 'Financiador cambiado', 'financiador_id', v_antes, 'Sin definir');
    return jsonb_build_object('ok', true, 'antes', v_antes, 'despues', 'Sin definir');
  end if;
  select * into v_fin from public.financiadores f where f.id = p_financiador_id;
  if not found then raise exception 'El financiador % no existe', p_financiador_id; end if;
  v_tipo := case when v_oc.es_venta_propia then 'venta_propia' when v_fin.tipo = 'propio' then 'fondos_propios' else 'externo' end;
  return public.cambiar_financiamiento_oc(p_oc_id, v_tipo, p_financiador_id);
end $$;

revoke all on function public.asignar_vendedor_oc(text, text) from public, anon;
revoke all on function public.asignar_financiador_oc(text, text) from public, anon;
revoke all on function public.fin_periodo_comision(text) from public, anon;
grant execute on function public.asignar_vendedor_oc(text, text) to authenticated;
grant execute on function public.asignar_financiador_oc(text, text) to authenticated;
grant execute on function public.fin_periodo_comision(text) to authenticated;

do $$ begin raise notice 'VEND-FIN-MIGRACION: OK'; end $$;
