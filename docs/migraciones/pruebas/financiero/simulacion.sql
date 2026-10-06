-- Fase 4B · Simulación de solo lectura (informe OC por OC y financiador por financiador).
-- Se ejecuta DENTRO de una transacción que aplica la migración y termina en ROLLBACK (nada queda escrito):
--   begin; \i 2026-10-06-integridad-financiera.sql; \i simulacion.sql; rollback;
-- Variable psql: SAL (carpeta de salida). Genera oc_por_oc.csv, financiadores.csv, facturas.csv,
-- diferencias.csv y hallazgos.csv.
\set ON_ERROR_STOP on

create temp table _sim_oc on commit drop as
select o.id, o.numero_oc, o.cliente, v.nombre vendedor, f.nombre financiador, o.financiador_id,
       k.tipo_financiamiento, o.tipo_registro, o.es_venta_propia, o.archivada,
       o.costo_total costo_actual, k.costo_total costo_recalculado,
       o.monto_pagado_fin pagado_fin_actual, k.monto_pagado_fin pagado_fin_recalculado,
       o.estado_pago_financiamiento estado_fin_actual, k.estado_pago_financiamiento estado_fin_recalculado,
       o.monto_facturado facturado_actual, k.monto_facturado facturado_recalculado,
       o.estado_factura_propia estado_factura_actual, k.estado_factura_propia estado_factura_recalculado,
       o.monto_cobrado cobrado_actual, k.monto_cobrado cobrado_recalculado,
       o.estado_pago_cliente estado_cobro_actual, k.estado_pago_cliente estado_cobro_recalculado,
       o.estado_compra estado_compra_actual, k.estado_compra estado_compra_recalculado,
       (select string_agg(x.numero_factura, ', ' order by x.fecha, x.numero_factura) from public.fin_facturas_vigentes(o.id) x) facturas_vigentes,
       (select string_agg(a.numero_factura, ', ' order by a.fecha, a.numero_factura) from public.eventos_factura a
         where a.oc_id = o.id and not exists (select 1 from public.fin_facturas_vigentes(o.id) x where x.id = a.id)) facturas_anuladas
  from public.ordenes_compra_v2 o
  left join public.vendedores v on v.id = o.vendedor_id
  left join public.financiadores f on f.id = o.financiador_id
  cross join lateral public.fin_calculo_oc(o.id, false) k;

create temp table _sim_dif on commit drop as
select d.entidad_id, string_agg(d.campo || ': ' || d.causa, ' | ' order by d.campo) causas,
       case when bool_or(d.clasificacion = 'decision') then 'decision' else 'segura' end clasificacion,
       (select string_agg(distinct b, ',') from public.fin_diferencias_historicas d2, unnest(d2.bloquea) b
         where d2.entidad = 'oc' and d2.entidad_id = d.entidad_id) bloqueo
  from public.fin_diferencias_historicas d where d.entidad = 'oc' group by d.entidad_id;

\set FOC :SAL/oc_por_oc.csv
\o :FOC
copy (select s.numero_oc, s.id oc_id, s.cliente, s.vendedor, s.financiador, s.tipo_financiamiento, s.tipo_registro, s.es_venta_propia, s.archivada, s.costo_actual, s.costo_recalculado, s.costo_actual - s.costo_recalculado costo_dif, s.pagado_fin_actual, s.pagado_fin_recalculado, s.pagado_fin_actual - s.pagado_fin_recalculado pagado_fin_dif, s.estado_fin_actual, s.estado_fin_recalculado, s.facturado_actual, s.facturado_recalculado, s.facturado_actual - s.facturado_recalculado facturado_dif, s.facturas_vigentes, s.facturas_anuladas, s.estado_factura_actual, s.estado_factura_recalculado, s.cobrado_actual, s.cobrado_recalculado, s.cobrado_actual - s.cobrado_recalculado cobrado_dif, s.estado_cobro_actual, s.estado_cobro_recalculado, s.estado_compra_actual, s.estado_compra_recalculado, case when s.tipo_financiamiento = 'externo' then s.costo_actual - s.pagado_fin_actual end deuda_oc_actual, case when s.tipo_financiamiento = 'externo' then s.costo_recalculado - s.pagado_fin_recalculado end deuda_oc_recalculada, coalesce(d.clasificacion, 'sin_diferencia') clasificacion, d.causas, d.bloqueo from _sim_oc s left join _sim_dif d on d.entidad_id = s.id order by case coalesce(d.clasificacion, 'sin_diferencia') when 'decision' then 0 when 'segura' then 1 else 2 end, s.numero_oc) to stdout with (format csv, header true);
\o

\set FFIN :SAL/financiadores.csv
\o :FFIN
copy (select f.id, f.nombre, f.tipo, f.saldo_deuda saldo_actual, (select coalesce(sum(o.costo_total), 0) from public.ordenes_compra_v2 o where o.financiador_id = f.id and not o.es_venta_propia) compras_costo_oc, (select coalesce(sum(e.costo_compra), 0) from public.eventos_compra e join public.ordenes_compra_v2 o on o.id = e.oc_id where o.financiador_id = f.id and not o.es_venta_propia) compras_eventos, (select count(*) from public.ordenes_compra_v2 o where o.financiador_id = f.id and not o.es_venta_propia and exists (select 1 from public.eventos_compra e where e.oc_id = o.id)) n_ocs, (select coalesce(sum(p.monto), 0) from public.eventos_pago_financiamiento p where p.financiador_id = f.id and p.oc_id is not null) pagos_con_oc, (select coalesce(sum(p.monto), 0) from public.eventos_pago_financiamiento p where p.financiador_id = f.id and p.oc_id is null) pagos_sin_oc, (select coalesce(sum(a.monto_ajuste), 0) from public.ajustes_saldo_financiador a where a.financiador_id = f.id) ajustes, public.fin_calculo_financiador(f.id, true, false) recalculado, public.fin_calculo_financiador(f.id, false, false) recalculado_solo_eventos, f.saldo_deuda - public.fin_calculo_financiador(f.id, true, false) diferencia, coalesce(d.clasificacion, 'sin_diferencia') clasificacion, d.causa, array_to_string(d.filas, ' ') filas_relacionadas from public.financiadores f left join public.fin_diferencias_historicas d on d.entidad = 'financiador' and d.entidad_id = f.id order by f.id) to stdout with (format csv, header true);
\o

\set FFAC :SAL/facturas.csv
\o :FFAC
copy (select o.numero_oc, fa.numero_factura, fa.fecha, fa.monto, fa.nota_credito, fa.factura_anulada_numero, exists (select 1 from public.fin_facturas_vigentes(o.id) x where x.id = fa.id) vigente, (select string_agg(a.numero_factura || ' (' || a.fecha || ')', ', ') from public.eventos_factura a where a.oc_id = fa.oc_id and a.id <> fa.id and nullif(btrim(a.factura_anulada_numero), '') is not null and btrim(a.factura_anulada_numero) = btrim(fa.numero_factura)) anulada_por, concat_ws(' · ', case when (select count(*) from public.eventos_factura b where btrim(b.numero_factura) = btrim(fa.numero_factura) and b.oc_id <> fa.oc_id) > 0 then 'número repetido en otra OC: ' || (select string_agg(distinct o2.numero_oc, ', ') from public.eventos_factura b join public.ordenes_compra_v2 o2 on o2.id = b.oc_id where btrim(b.numero_factura) = btrim(fa.numero_factura) and b.oc_id <> fa.oc_id) end, case when (select count(*) from public.eventos_factura b where btrim(b.numero_factura) = btrim(fa.numero_factura) and b.oc_id = fa.oc_id and b.id <> fa.id) > 0 then 'número repetido en la misma OC' end, case when nullif(btrim(fa.factura_anulada_numero), '') is not null and not exists (select 1 from public.eventos_factura b where b.oc_id = fa.oc_id and btrim(b.numero_factura) = btrim(fa.factura_anulada_numero) and b.id <> fa.id) then 'dice anular la N° ' || fa.factura_anulada_numero || ', que no existe en la OC' end, case when nullif(btrim(fa.factura_anulada_numero), '') is not null and (select count(*) from public.eventos_factura b where b.oc_id = fa.oc_id and b.id <> fa.id and btrim(b.factura_anulada_numero) = btrim(fa.factura_anulada_numero)) > 0 then 'otra factura anula la misma N° ' || fa.factura_anulada_numero end) observacion from public.eventos_factura fa join public.ordenes_compra_v2 o on o.id = fa.oc_id where fa.oc_id in (select b.oc_id from public.eventos_factura b group by b.oc_id having count(*) > 1) or btrim(fa.numero_factura) in (select btrim(b.numero_factura) from public.eventos_factura b group by btrim(b.numero_factura) having count(*) > 1) order by o.numero_oc, fa.fecha, fa.numero_factura) to stdout with (format csv, header true);
\o

\set FDIF :SAL/diferencias.csv
\o :FDIF
copy (select d.entidad, d.etiqueta, d.entidad_id, d.campo, d.valor_registrado, d.valor_eventos, d.diferencia, d.clasificacion, d.causa, array_to_string(d.bloquea, ',') bloquea, array_to_string(d.filas, ' ') filas from public.fin_diferencias_historicas d order by d.entidad desc, d.clasificacion, d.etiqueta, d.campo) to stdout with (format csv, header true);
\o

\set FHAL :SAL/hallazgos.csv
\o :FHAL
copy (select * from (select 'compra_financiador_distinto_de_la_oc' tipo, o.numero_oc, 'Compra con ' || coalesce(e.financiador_id, '—') || '; OC con ' || coalesce(o.financiador_id, '—') || '; pagos: ' || coalesce((select string_agg(distinct p.financiador_id, ', ') from public.eventos_pago_financiamiento p where p.oc_id = o.id), 'ninguno') detalle from public.eventos_compra e join public.ordenes_compra_v2 o on o.id = e.oc_id where e.financiador_id is distinct from o.financiador_id union all select 'compra_sin_fecha', o.numero_oc, 'Compra registrada sin fecha (costo ' || public.fin_pesos(e.costo_compra) || ')' from public.eventos_compra e join public.ordenes_compra_v2 o on o.id = e.oc_id where e.fecha is null union all select 'posible_oc_duplicada', o.numero_oc, 'Comparte la factura N° ' || fa.numero_factura || ' con ' || o2.numero_oc || ' (venta ' || public.fin_pesos(o.monto_total) || ' y ' || public.fin_pesos(o2.monto_total) || ')' from public.eventos_factura fa join public.ordenes_compra_v2 o on o.id = fa.oc_id join public.eventos_factura fb on btrim(fb.numero_factura) = btrim(fa.numero_factura) and fb.oc_id <> fa.oc_id join public.ordenes_compra_v2 o2 on o2.id = fb.oc_id where o.numero_oc < o2.numero_oc and (position(o.numero_oc in o2.numero_oc) = 1 or position(o2.numero_oc in o.numero_oc) = 1) union all select 'factura_repetida_entre_ocs', o.numero_oc, 'Factura N° ' || fa.numero_factura || ' (' || fa.fecha || ', ' || public.fin_pesos(fa.monto) || ') también en ' || o2.numero_oc || ' (' || fb.fecha || ', ' || public.fin_pesos(fb.monto) || ')' from public.eventos_factura fa join public.ordenes_compra_v2 o on o.id = fa.oc_id join public.eventos_factura fb on btrim(fb.numero_factura) = btrim(fa.numero_factura) and fb.oc_id <> fa.oc_id join public.ordenes_compra_v2 o2 on o2.id = fb.oc_id where o.numero_oc < o2.numero_oc and not (position(o.numero_oc in o2.numero_oc) = 1 or position(o2.numero_oc in o.numero_oc) = 1) union all select 'pagos_a_fondos_propios', o.numero_oc, public.fin_pesos(sum(p.monto)) || ' pagados a ' || f.nombre || ' (' || count(*) || ' pago(s), creados ' || min(p."creadoEn")::date || ')' from public.eventos_pago_financiamiento p join public.financiadores f on f.id = p.financiador_id and f.tipo = 'propio' join public.ordenes_compra_v2 o on o.id = p.oc_id group by o.numero_oc, f.nombre union all select 'venta_propia', o.numero_oc, 'Venta propia: tipo ' || o.tipo_registro || ', vendedor ' || coalesce(o.vendedor_id, 'sin vendedor') || ', financiador ' || coalesce(o.financiador_id, '—') || ', estado ' || o.estado_pago_financiamiento || ' (regla 3: no aplica)' from public.ordenes_compra_v2 o where o.es_venta_propia union all select 'ocs_sin_vendedor', null, count(*)::text || ' OCs de venta sin vendedor (no se modifican en 4B)' from public.ordenes_compra_v2 o where o.vendedor_id is null and o.tipo_registro = 'venta') h order by 1, 2) to stdout with (format csv, header true);
\o

select 'RESUMEN|ocs=' || (select count(*) from public.ordenes_compra_v2)
    || '|ocs_con_diferencia=' || (select count(distinct entidad_id) from public.fin_diferencias_historicas where entidad = 'oc')
    || '|ocs_seguras=' || (select count(*) from _sim_dif where clasificacion = 'segura')
    || '|ocs_decision=' || (select count(*) from _sim_dif where clasificacion = 'decision')
    || '|filas_diferencia=' || (select count(*) from public.fin_diferencias_historicas)
    || '|financiadores_con_diferencia=' || (select count(*) from public.fin_diferencias_historicas where entidad = 'financiador')
    || '|monto_pagado_fin_descuadres=' || (select count(*) from public.fin_diferencias_historicas where campo = 'monto_pagado_fin')
    || '|inconsistencias_tras_corte=' || (select count(*) from public.fin_verificar_consistencia()) as resumen;
