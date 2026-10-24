-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- REVERSIÓN de BORRADOR-2026-10-23-seguridad-perfil-bfk.sql · Deja el catálogo EXACTAMENTE como estaba (se comprueba con
-- la misma huella del ensayo). No toca datos financieros. Los perfiles autorizados con la migración se CONSERVAN (son
-- usuarios reales); el registro de autorizaciones solo se descarta si se indica expresamente:
--   PGOPTIONS="-c bfk.seg_descartar_registro=si"   (si hay autorizaciones registradas y no se indica, se detiene)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '10s';
do $pre$
begin
  if to_regprocedure('public.bfk_es_usuario()') is null then
    raise exception 'REVERSION_DETENIDA: la migración no está aplicada. No se cambió nada.';
  end if;
  if exists (select 1 from public.perfiles_autorizaciones) and coalesce(current_setting('bfk.seg_descartar_registro', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: hay % autorizaciones registradas. Para descartar ese registro: PGOPTIONS="-c bfk.seg_descartar_registro=si". No se cambió nada.',
      (select count(*) from public.perfiles_autorizaciones);
  end if;
end $pre$;

drop trigger perfiles_proteger on public.perfiles;
drop function public.perfiles_proteger();
drop function public.bfk_autorizar_cuenta(uuid, text, text);
drop function public.bfk_cuentas_por_autorizar();
drop table public.perfiles_autorizaciones;


-- ── Políticas RLS a su texto original ──
alter policy rw_autenticados on public.ajustes_saldo_financiador using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.aportes_socios using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.aportes_socios with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.aportes_socios using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_bm on public.banco_mensual using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_cartolas on public.cartolas_importadas using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.categorias_gasto using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.contactos_cobranza using ((auth.role() = 'authenticated'::text));
alter policy ent_leer on public.entidades_catalogo using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.eventos_compra using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.eventos_compra with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.eventos_compra using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.eventos_entrega using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.eventos_factura using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.eventos_factura with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.eventos_factura using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.eventos_pago_cliente using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.eventos_pago_cliente with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.eventos_pago_cliente using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.eventos_pago_financiamiento using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.eventos_pago_financiamiento with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.eventos_pago_financiamiento using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_postventa on public.eventos_postventa using ((auth.role() = 'authenticated'::text));
alter policy fin_diferencias_lectura on public.fin_diferencias_historicas using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.financiadores using ((auth.role() = 'authenticated'::text));
alter policy gastos_acceso_autenticados on public.gastos using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.gastos_indirectos using ((auth.role() = 'authenticated'::text));
alter policy historial_agrega on public.historial_cambios with check ((auth.role() = 'authenticated'::text));
alter policy historial_lee on public.historial_cambios using ((auth.role() = 'authenticated'::text));
alter policy items_oc_acceso_autenticados on public.items_oc using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.iva_mensual using ((auth.role() = 'authenticated'::text));
alter policy mp_cache_rw_autenticados on public.mp_cache_avisos using (true) with check (true);
alter policy mp_uso_rw_autenticados on public.mp_uso_diario using (true) with check (true);
alter policy rw_autenticados_notif on public.notificaciones using ((auth.role() = 'authenticated'::text));
alter policy bloqueos_actualizar on public.oc_bloqueos using (((usuario_id = auth.uid()) OR (expira_en <= now()))) with check (((usuario_id = auth.uid()) AND (expira_en <= (now() + '00:02:00'::interval))));
alter policy bloqueos_borrar on public.oc_bloqueos using ((usuario_id = auth.uid()));
alter policy bloqueos_insertar on public.oc_bloqueos with check (((usuario_id = auth.uid()) AND (expira_en <= (now() + '00:02:00'::interval))));
alter policy bloqueos_leer on public.oc_bloqueos using (true);
alter policy rw_autenticados_comentarios on public.oc_comentarios using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_links on public.oc_productos_link using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_reclamos on public.oc_reclamos using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados_responsables on public.oc_responsables using ((auth.role() = 'authenticated'::text));
alter policy seg_crean on public.oc_seguimientos with check ((auth.role() = 'authenticated'::text));
alter policy seg_editan on public.oc_seguimientos using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy seg_leen on public.oc_seguimientos using ((auth.role() = 'authenticated'::text));
alter policy oc_acceso_autenticados on public.ordenes_compra using ((auth.role() = 'authenticated'::text));
alter policy autenticados_editan on public.ordenes_compra_v2 using ((auth.role() = 'authenticated'::text)) with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_insertan on public.ordenes_compra_v2 with check ((auth.role() = 'authenticated'::text));
alter policy autenticados_leen on public.ordenes_compra_v2 using ((auth.role() = 'authenticated'::text));
alter policy rw_autenticados on public.pagos_vendedor using ((auth.role() = 'authenticated'::text));
alter policy perfiles_lectura_autenticados on public.perfiles using ((auth.role() = 'authenticated'::text));
alter policy saldo_banco_insert_authenticated on public.saldo_banco with check (true);
alter policy saldo_banco_select_authenticated on public.saldo_banco using (true);
alter policy saldo_banco_update_authenticated on public.saldo_banco using (true) with check (true);
alter policy rw_autenticados on public.vendedores using ((auth.role() = 'authenticated'::text));
alter policy ventas_acceso_autenticados on public.ventas using ((auth.role() = 'authenticated'::text));
create policy perfiles_propio_insert on public.perfiles as permissive for insert to public with check (((auth.uid() = id) AND (rol = 'usuario'::text)));

-- ── Funciones a su texto original (copiado literal de producción) ──
CREATE OR REPLACE FUNCTION public.cartola_manuales(p_tabla text, p_destinos text[], p_fecha date, p_monto numeric) RETURNS TABLE(ids text[], total numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
begin
  return query execute pg_catalog.format($q$
    with filas as (
      select e.id, e."creadoEn" grupo, public.cartola_monto(%L, pg_catalog.to_jsonb(e)) monto,
             public.cartola_destino(%L, pg_catalog.to_jsonb(e)) destino
        from public.%I e
       where e.marca_cartola is null %s and e.fecha between $2 - 3 and $2 + 3)
    select pg_catalog.array_agg(f.id order by f.id), sum(f.monto) from filas f group by f.grupo
    having sum(f.monto) = $3 and bool_or(f.destino = any ($1))$q$,
    p_tabla, p_tabla, p_tabla, case when p_tabla = 'pagos_vendedor' then 'and e.anulado_en is null' else '' end)
  using p_destinos, p_fecha, p_monto;
end $_$;
CREATE OR REPLACE FUNCTION public.cartola_vincular(p_tabla text, p_ids text[], p_marca text, p_max integer, p_financiador_id text DEFAULT NULL::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_mov record; v_vinc record; v_hoy date := (pg_catalog.now() at time zone 'America/Santiago')::date;
begin
  if auth.uid() is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_tabla not in ('eventos_pago_cliente','eventos_pago_financiamiento','gastos_indirectos','pagos_vendedor','aportes_socios') then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  select * into v_mov from public.cartola_leer_marca(p_marca);
  if v_mov.fecha <= date '2026-10-07' or v_mov.fecha > v_hoy then raise exception 'Movimiento fuera del período registrable'; end if;
  if (p_tabla = 'eventos_pago_cliente') <> (v_mov.abono > 0) then raise exception 'El tipo de registro no corresponde al sentido del movimiento'; end if;
  if coalesce(pg_catalog.cardinality(p_ids), 0) not between 1 and coalesce(p_max, 1) then raise exception 'Cantidad de registros a vincular inválida'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bfk_cartola:' || p_marca, 0));
  execute pg_catalog.format($q$select count(*) n, coalesce(sum(public.cartola_monto(%L, pg_catalog.to_jsonb(e))), 0) total,
      bool_and(e.marca_cartola is null) libres, bool_and(e.fecha between $2 - 3 and $2 + 3 and e.fecha > date '2026-10-07') cerca,
      bool_and($3::text is null or (pg_catalog.to_jsonb(e) ->> 'financiador_id') = $3) mismo
      from public.%I e where e.id = any ($1) %s$q$, p_tabla, p_tabla, case when p_tabla = 'pagos_vendedor' then 'and e.anulado_en is null' else '' end)
    into v_vinc using p_ids, v_mov.fecha, p_financiador_id;
  if v_vinc.n <> pg_catalog.cardinality(p_ids) or not v_vinc.libres or not v_vinc.mismo then
    raise exception 'Algún registro a vincular no existe, está anulado, ya tiene marca o es de otro destino';
  end if;
  if not v_vinc.cerca then raise exception 'Los registros a vincular deben ser posteriores al cierre y de ±3 días del movimiento'; end if;
  if v_vinc.total <> v_mov.cargo + v_mov.abono then raise exception 'Los registros a vincular suman % y el movimiento es %', v_vinc.total, v_mov.cargo + v_mov.abono; end if;
  perform pg_catalog.set_config('bfk.cartola_vincular', '1', true);
  execute pg_catalog.format($q$update public.%I e set marca_cartola = $1, marca_parte = s.parte, marca_partes = $3, alerta_cartola = null
      from (select x id, row_number() over (order by x) parte from pg_catalog.unnest($2) x) s where e.id = s.id$q$, p_tabla)
    using p_marca, p_ids, pg_catalog.cardinality(p_ids);
  perform pg_catalog.set_config('bfk.cartola_vincular', '', true);
  return pg_catalog.jsonb_build_object('ok', true, 'vinculados', pg_catalog.to_jsonb(p_ids), 'marca', p_marca);
end $_$;
CREATE OR REPLACE FUNCTION public.cartola_quitar_alerta(p_tabla text, p_id text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
declare v_n int;
begin
  if auth.uid() is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_tabla not in ('eventos_pago_cliente','eventos_pago_financiamiento','gastos_indirectos','pagos_vendedor','aportes_socios') then
    raise exception 'Tabla no permitida: %', p_tabla;
  end if;
  execute pg_catalog.format('update public.%I e set alerta_cartola = null where e.id = $1 and e.alerta_cartola is not null', p_tabla) using p_id;
  get diagnostics v_n = row_count;
  return pg_catalog.jsonb_build_object('ok', true, 'quitadas', v_n);
end $_$;
CREATE OR REPLACE FUNCTION public.fin_calculo_oc(p_oc_id text, p_con_diferencias boolean DEFAULT true, OUT costo_total numeric, OUT estado_compra text, OUT monto_pagado_fin numeric, OUT estado_pago_financiamiento text, OUT monto_facturado numeric, OUT estado_factura_propia text, OUT monto_cobrado numeric, OUT estado_pago_cliente text, OUT tipo_financiamiento text) RETURNS record
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
  select count(*) into v_n_vigentes from public.fin_facturas_vigentes(p_oc_id) v;
  monto_facturado := public.fin_monto_tributario(p_oc_id);
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
CREATE OR REPLACE FUNCTION public.fin_exigir_sin_bloqueo(p_oc_id text, p_dominio text) RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
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
CREATE OR REPLACE FUNCTION public.trib_motivo_incompatible(p_ambito text, p_cot uuid, p_oc text, p_tratamiento text, p_procedimiento text) RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $_$
declare o public.ordenes_compra_v2%rowtype; c public.cotizaciones%rowtype; v_af text; v_ex text; v_iva numeric; v_docs integer;
begin
  if p_ambito = 'oc' then
    select * into o from public.ordenes_compra_v2 where id = p_oc;
    if not found then return 'OC no encontrada'; end if;
    if o.archivada then return 'La OC está archivada.'; end if;
    select string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where coalesce(tipo_dte, 33) = 33),
           string_agg(nullif(btrim(numero_factura), ''), ', ') filter (where tipo_dte = 34)
      into v_af, v_ex from public.fin_facturas_vigentes(p_oc);
    -- Documentos vigentes incompatibles: primero se corrige el documento (nota de crédito código 1), después la clasificación.
    if p_tratamiento <> 'afecta' and v_af is not null then
      return format('La OC tiene factura afecta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como exenta.', v_af); end if;
    if p_tratamiento = 'afecta' and v_ex is not null then
      return format('La OC tiene factura exenta vigente (N.º %s). Anúlala con nota de crédito (código 1) antes de clasificarla como afecta.', v_ex); end if;
    select count(*) into v_docs from public.eventos_factura where oc_id = p_oc;
    if v_docs > 0 and length(btrim(coalesce(p_procedimiento, ''))) < 10 then
      return 'La OC ya tiene documentos SII: describe el procedimiento documental (notas de crédito y facturas que respaldan el cambio).'; end if;
    -- Mercado Público como verificación (nunca como autorización): impuestos > 0 contradicen una exención.
    select nullif(datos ->> 'iva', '')::numeric into v_iva from public.mp_cache_avisos where id = 'oc_mp:' || p_oc and jsonb_typeof(datos) = 'object';
    if p_tratamiento <> 'afecta' and coalesce(v_iva, 0) > 0 then
      return format('Mercado Público informa impuestos de $%s en esta OC: no corresponde una exención.', v_iva); end if;
    return null;
  end if;
  select * into c from public.cotizaciones where id = p_cot;
  if not found then return 'Cotización no encontrada'; end if;
  -- Una OC ya clasificada a partir de esta cotización se corrige en la OC, no aquí.
  if exists (select 1 from public.trib_clasificaciones h join public.trib_clasificaciones hc on hc.id = h.origen_clasificacion_id
              where h.ambito = 'oc' and h.estado = 'aprobada' and hc.cotizacion_id = p_cot) then
    return 'Una OC ya heredó la clasificación de esta cotización: el cambio se hace en la OC.'; end if;
  return null;
end $_$;
CREATE OR REPLACE FUNCTION public.fin_facturas_vigentes(p_oc_id text) RETURNS SETOF public.eventos_factura
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select f.* from public.eventos_factura f
   where f.oc_id = p_oc_id
     and coalesce(f.tipo_dte, 33) in (33, 34)
     and not exists (select 1 from public.eventos_factura a
                      where a.oc_id = f.oc_id and a.id <> f.id
                        and nullif(btrim(f.numero_factura), '') is not null
                        and ((coalesce(a.tipo_dte, 33) in (33, 34)
                              and nullif(btrim(a.factura_anulada_numero), '') is not null
                              and btrim(a.factura_anulada_numero) = btrim(f.numero_factura))
                          or (a.tipo_dte = 61 and a.ref_codigo = 1 and btrim(a.ref_folio) = btrim(f.numero_factura))))
$$;
CREATE OR REPLACE FUNCTION public.fin_fila_bloqueada(p_tabla text, p_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select string_agg(coalesce(d.etiqueta, d.entidad_id) || ': ' || d.causa, ' · ') from public.fin_diferencias_historicas d
   where d.estado = 'pendiente' and (p_tabla || ':' || p_id) = any(d.filas)
$$;
CREATE OR REPLACE FUNCTION public.fin_tipo_financiamiento(p_oc_id text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select case when o.es_venta_propia then 'venta_propia'
              when f.tipo = 'propio' then 'fondos_propios'
              else 'externo' end
    from public.ordenes_compra_v2 o left join public.financiadores f on f.id = o.financiador_id
   where o.id = p_oc_id
$$;
CREATE OR REPLACE FUNCTION public.fin_dif_estado(p_oc_id text, p_campo text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select d.valor_registrado from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is null
   limit 1
$$;
CREATE OR REPLACE FUNCTION public.fin_dif_monto(p_entidad text, p_id text, p_campo text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select coalesce(sum(d.diferencia), 0) from public.fin_diferencias_historicas d
   where d.entidad = p_entidad and d.entidad_id = p_id and d.campo = p_campo and d.estado = 'pendiente' and d.diferencia is not null
$$;
CREATE OR REPLACE FUNCTION public.fin_monto_tributario(p_oc_id text) RETURNS numeric
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  with vig as (select * from public.fin_facturas_vigentes(p_oc_id))
  select coalesce((select sum(v.monto) from vig v), 0)
       + coalesce((select sum(d.monto) from public.eventos_factura d where d.oc_id = p_oc_id and d.tipo_dte = 56), 0)
       - coalesce((select sum(n.monto) from public.eventos_factura n
                    where n.oc_id = p_oc_id and n.tipo_dte = 61 and n.ref_codigo = 3
                      and btrim(n.ref_folio) in (select btrim(v.numero_factura) from vig v)), 0)
$$;
CREATE OR REPLACE FUNCTION public.fin_motivo_bloqueo(p_oc_id text, p_dominio text) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select string_agg(d.causa, ' · ' order by d.campo) from public.fin_diferencias_historicas d
   where d.entidad = 'oc' and d.entidad_id = p_oc_id and d.estado = 'pendiente' and p_dominio = any(d.bloquea)
$$;
CREATE OR REPLACE FUNCTION public.fin_periodo_comision(p_oc_id text, OUT anio integer, OUT mes integer) RETURNS record
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select extract(year from m)::int, extract(month from m)::int
    from (select max(f.fecha) m from public.fin_facturas_vigentes(p_oc_id) f) z
   where m is not null
$$;
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  es_primero boolean;
begin
  select count(*) = 0 into es_primero from public.perfiles;
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)),
    case when es_primero then 'admin' else 'usuario' end
  );
  return new;
end;
$$;
-- ── EXECUTE devuelto exactamente a quien lo tenía ──
grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.oc_trg_proteger_vendedor() to public, anon, authenticated;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;
grant execute on function public.pv_es_admin() to anon;

-- ── Permisos de tablas devueltos exactamente como estaban ──
do $do$ begin
  -- MAINTAIN existe desde PostgreSQL 17 (producción); en una base local más antigua se omite solo ese privilegio.
  if current_setting('server_version_num')::int >= 170000 then
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.ajustes_saldo_financiador to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.ajustes_saldo_financiador to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.aportes_socios to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.aportes_socios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.banco_mensual to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.banco_mensual to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.cartolas_importadas to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.cartolas_importadas to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.categorias_gasto to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.categorias_gasto to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.cg_import to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.cg_import to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.contactos_cobranza to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.contactos_cobranza to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizacion_eliminaciones to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizacion_envios to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizacion_items to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizacion_vendedores to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizacion_versiones to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.cotizaciones to authenticated;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.documentos_tributarios to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.eett_documentos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.entidades_catalogo to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.entidades_catalogo to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_compra to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_compra to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_entrega to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_entrega to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_factura to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_factura to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_pago_cliente to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_pago_cliente to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_pago_financiamiento to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_pago_financiamiento to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.eventos_postventa to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.eventos_postventa to authenticated;$g$;
    execute $g$grant maintain on table public.fin_diferencias_historicas to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.financiadores to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.financiadores to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.gastos to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.gastos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.gastos_indirectos to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.gastos_indirectos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.historial_cambios to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.historial_cambios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.items_oc to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.items_oc to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.iva_mensual to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.iva_mensual to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.mp_cache_avisos to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.mp_cache_avisos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.mp_uso_diario to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.mp_uso_diario to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.notificaciones to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.notificaciones to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.oc_bloqueos to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_bloqueos to authenticated;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_bloqueos_vigentes to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.oc_comentarios to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_comentarios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.oc_productos_link to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_productos_link to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.oc_reclamos to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_reclamos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.oc_responsables to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_responsables to authenticated;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.oc_seguimientos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.ordenes_compra to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.ordenes_compra to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.ordenes_compra_v2 to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.ordenes_compra_v2 to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.pagos_vendedor to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.pagos_vendedor to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.perfiles to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.perfiles to authenticated;$g$;
    execute $g$grant references, trigger, maintain on table public.productos_catalogo to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.saldo_banco to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.saldo_banco to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.vendedores to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.vendedores to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger, maintain on table public.ventas to anon;$g$;
    execute $g$grant truncate, references, trigger, maintain on table public.ventas to authenticated;$g$;
  else
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.ajustes_saldo_financiador to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.ajustes_saldo_financiador to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.aportes_socios to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.aportes_socios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.banco_mensual to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.banco_mensual to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.cartolas_importadas to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.cartolas_importadas to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.categorias_gasto to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.categorias_gasto to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.cg_import to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.cg_import to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.contactos_cobranza to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.contactos_cobranza to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizacion_eliminaciones to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizacion_envios to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizacion_items to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizacion_vendedores to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizacion_versiones to authenticated;$g$;
    execute $g$grant references, trigger on table public.cotizaciones to authenticated;$g$;
    execute $g$grant truncate, references, trigger on table public.documentos_tributarios to authenticated;$g$;
    execute $g$grant references, trigger on table public.eett_documentos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.entidades_catalogo to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.entidades_catalogo to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_compra to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_compra to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_entrega to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_entrega to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_factura to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_factura to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_pago_cliente to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_pago_cliente to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_pago_financiamiento to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_pago_financiamiento to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.eventos_postventa to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.eventos_postventa to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.financiadores to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.financiadores to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.gastos to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.gastos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.gastos_indirectos to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.gastos_indirectos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.historial_cambios to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.historial_cambios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.items_oc to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.items_oc to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.iva_mensual to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.iva_mensual to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.mp_cache_avisos to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.mp_cache_avisos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.mp_uso_diario to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.mp_uso_diario to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.notificaciones to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.notificaciones to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.oc_bloqueos to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_bloqueos to authenticated;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_bloqueos_vigentes to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.oc_comentarios to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_comentarios to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.oc_productos_link to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_productos_link to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.oc_reclamos to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_reclamos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.oc_responsables to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_responsables to authenticated;$g$;
    execute $g$grant truncate, references, trigger on table public.oc_seguimientos to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.ordenes_compra to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.ordenes_compra to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.ordenes_compra_v2 to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.ordenes_compra_v2 to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.pagos_vendedor to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.pagos_vendedor to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.perfiles to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.perfiles to authenticated;$g$;
    execute $g$grant references, trigger on table public.productos_catalogo to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.saldo_banco to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.saldo_banco to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.vendedores to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.vendedores to authenticated;$g$;
    execute $g$grant insert, select, update, delete, truncate, references, trigger on table public.ventas to anon;$g$;
    execute $g$grant truncate, references, trigger on table public.ventas to authenticated;$g$;
  end if;
end $do$;


-- ── Privilegios por defecto como estaban ──
do $def$
declare v_extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
begin
  execute 'alter default privileges for role postgres in schema public grant all on tables to anon';
  execute format('alter default privileges for role postgres in schema public grant truncate, references, trigger%s on tables to authenticated', v_extra);
end $def$;

-- ── Funciones de acceso: ya nada las usa ──
drop function public.bfk_exigir_perfil_api();
drop function public.bfk_es_admin();
drop function public.bfk_es_usuario();

-- ── Comprobación: el catálogo vuelve a la huella original ──
do $ver$
declare v_huella text;
begin
  select md5(string_agg(x, E'\n' order by x)) into v_huella from (
    select 'f|' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')|' || p.prosecdef || '|' || md5(p.prosrc)
           || '|' || coalesce(array_to_string(p.proconfig, ','), '') x
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('cartola_manuales', 'cartola_vincular', 'cartola_quitar_alerta', 'fin_calculo_oc', 'fin_exigir_sin_bloqueo',
                         'fin_facturas_vigentes', 'fin_fila_bloqueada', 'fin_tipo_financiamiento', 'handle_new_user',
                         'fin_dif_estado', 'fin_dif_monto', 'fin_monto_tributario', 'fin_motivo_bloqueo', 'fin_periodo_comision',
                         'trib_motivo_incompatible', 'oc_trg_proteger_vendedor', 'rls_auto_enable', 'pv_es_admin')
    union all
    select 'p|' || tablename || '|' || policyname || '|' || cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
      from pg_policies where schemaname = 'public'
    union all
    select 'c|' || column_name || '|' || data_type from information_schema.columns where table_schema = 'public' and table_name = 'perfiles'
    union all
    select 't|' || t.tgname || '|' || pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid in ('auth.users'::regclass, 'public.perfiles'::regclass) and not t.tgisinternal
  ) z;
  if v_huella is distinct from '74a6920a90c24527f799e3955314443c' then
    raise exception 'REVERSION_DETENIDA: el catálogo no quedó como el original (huella %). Se deshace todo.', v_huella;
  end if;
end $ver$;

commit;
