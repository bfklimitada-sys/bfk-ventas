-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase SII · DESHACER el modelo tributario (2026-10-07). Una sola transacción, dueño de las tablas.
-- Restaura exactamente las funciones de la Fase 4B (fin_facturas_vigentes y fin_calculo_oc), elimina la vista
-- documentos_tributarios, fin_monto_tributario y las columnas nuevas de eventos_factura.
-- Se NIEGA si existen documentos que solo el modelo nuevo representa (NC/ND como documento, datos SII
-- o correcciones de folio aplicadas): primero hay que deshacer esos lotes, para no perder historia.
-- Verifica que ninguna OC cambie su cálculo al volver (salvo las que tenían NC/ND, que no puede haber).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'eventos_factura' and column_name = 'tipo_dte') then
    raise exception 'SII-MODELO-DESHACER: el modelo tributario no está aplicado';
  end if;
  if exists (select 1 from public.eventos_factura where tipo_dte in (56, 61) or ref_folio is not null or ref_codigo is not null
              or origen <> 'bfk' or verificado_sii or rut_receptor is not null or monto_neto is not null or monto_iva is not null or monto_exento is not null) then
    raise exception 'SII-MODELO-DESHACER: hay documentos con datos del modelo tributario; deshaga primero los lotes SII (no se pierde historia)';
  end if;
end $$;

create temp table _des_calc_antes on commit drop as
  select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c;

drop view if exists public.documentos_tributarios;

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


drop function if exists public.fin_monto_tributario(text);
drop index if exists public.idx_eventos_factura_oc_tipo;
alter table public.eventos_factura drop constraint chk_factura_positiva;
alter table public.eventos_factura add constraint chk_factura_positiva check (monto > (0)::numeric);
alter table public.eventos_factura
  drop constraint if exists eventos_factura_ref_nc_chk,
  drop constraint if exists eventos_factura_origen_chk,
  drop constraint if exists eventos_factura_ref_codigo_chk,
  drop constraint if exists eventos_factura_ref_tipo_chk,
  drop constraint if exists eventos_factura_tipo_dte_chk,
  drop column tipo_dte, drop column rut_receptor, drop column monto_neto, drop column monto_exento, drop column monto_iva,
  drop column ref_tipo_dte, drop column ref_folio, drop column ref_codigo, drop column ref_motivo,
  drop column origen, drop column verificado_sii, drop column verificado_en, drop column evidencia_sii;

do $$
begin
  if exists (select * from _des_calc_antes except select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c)
     or exists (select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c except select * from _des_calc_antes) then
    raise exception 'SII-MODELO-DESHACER: el cálculo de alguna OC cambiaría. No se deshizo nada.';
  end if;
  raise notice 'SII-MODELO-DESHACER: restaurado';
end $$;
