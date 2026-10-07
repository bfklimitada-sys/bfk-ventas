-- Deshace 2026-10-07-capitalizacion-comisiones.sql: devuelve las 28 OCs a su estado anterior (sin vendedor),
-- quita las columnas nuevas y restaura asignar_vendedor_oc anterior. Solo si nadie cambió esas OCs después.
do $$
declare r record; v_n int := 0;
begin
  for r in select * from public.fin_correcciones_registro where lote = 'capitalizacion-comisiones-20261007' and revertida_en is null and campo = 'vendedor_id' loop
    if not exists (select 1 from public.ordenes_compra_v2 o where o.id = r.fila_id and o.vendedor_id = r.despues) then
      raise exception 'CAP-DESHACER: el vendedor de % cambió después; no se deshizo nada', r.fila_id;
    end if;
  end loop;
  for r in select * from public.fin_correcciones_registro where lote = 'capitalizacion-comisiones-20261007' and revertida_en is null and campo = 'capitalizacion_bfk' loop
    if not exists (select 1 from public.ordenes_compra_v2 o where o.id = r.fila_id and o.capitalizacion_bfk and o.vendedor_id is null) then
      raise exception 'CAP-DESHACER: % cambió después; no se deshizo nada', r.fila_id;
    end if;
  end loop;
  perform set_config('bfk.importacion', 'on', true);   -- vuelve al estado exacto anterior sin pasar por las reglas nuevas
  update public.ordenes_compra_v2 o set vendedor_id = null
    from public.fin_correcciones_registro x where x.lote = 'capitalizacion-comisiones-20261007' and x.revertida_en is null and x.campo = 'vendedor_id' and o.id = x.fila_id;
  insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
  select public.fin_nuevo_id('hc'), o.id, o.numero_oc, null, 'Migración vendedor/financiador', 'Capitalización / vendedor histórico: deshecho', 'vendedor_id',
         case when o.capitalizacion_bfk then 'BFK Ltda. · Capitalización' else 'Matías Vegas' end, 'Sin definir'
    from public.ordenes_compra_v2 o
   where o.id in (select fila_id from public.fin_correcciones_registro where lote = 'capitalizacion-comisiones-20261007' and revertida_en is null);
  perform set_config('bfk.importacion', '', true);
  update public.fin_correcciones_registro set revertida_en = now() where lote = 'capitalizacion-comisiones-20261007' and revertida_en is null;
  get diagnostics v_n = row_count;
  raise notice 'CAP-DESHACER: % registros revertidos', v_n;
end $$;
-- Disparador anterior (antes de las columnas nuevas)
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

alter table public.ordenes_compra_v2 drop constraint if exists ordenes_capitalizacion_sin_vendedor_chk;
alter table public.ordenes_compra_v2 drop column if exists capitalizacion_bfk, drop column if exists comision_excluida;
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
do $$ begin if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CAP-DESHACER: base inconsistente'; end if; raise notice 'CAP-DESHACER: OK'; end $$;
