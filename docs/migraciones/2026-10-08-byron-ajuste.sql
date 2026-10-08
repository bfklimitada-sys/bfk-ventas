-- APLICADO en producción 08/10/2026 (lote byron-ajuste-20261008, registro 1422, respaldo previo bfk-20261008T1824Z). Rollback: 2026-10-08-byron-ajuste-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Lote 'byron-ajuste-20261008' · Autorizado por el usuario 08/10/2026 (deuda Byron = $7.226.396).
-- Excluye del cálculo el ajuste manual de Byron −1.209.697 (18/06/2026, "resumen oficial del Excel", sin respaldo
-- documental). La fila se guarda COMPLETA en fin_correcciones_registro (mismo criterio que kevin-ajuste-20261007) y se
-- retira de ajustes_saldo_financiador; el saldo lo recalcula la base (sin cambiar funciones ni esquema).
-- No toca: compras, pagos, OCs, financiadores de las OCs, ajustes de otros financiadores (Francisco), cobros, gastos,
-- comisiones, IVA/F29, aportes, banco ni historial.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
declare a public.ajustes_saldo_financiador; v_c numeric; v_p numeric; v_s numeric;
begin
  if exists (select 1 from public.fin_correcciones_registro where lote = 'byron-ajuste-20261008' and revertida_en is null) then
    raise notice 'BYRON|TODO|YA_APLICADA|'; return;
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'BYRON: base inconsistente antes de empezar'; end if;
  if (select string_agg(id || '=' || saldo_deuda, ' ' order by id) from public.financiadores)
     <> 'fin_byron=6016699 fin_cuenta_bfk=0 fin_francisco=0 fin_kevin=0 fin_matias=0' then
    raise exception 'BYRON: saldos de financiadores distintos a los revisados';
  end if;
  if (select count(*) from public.ajustes_saldo_financiador where financiador_id = 'fin_byron') <> 1 then
    raise exception 'BYRON: Byron no tiene exactamente un ajuste';
  end if;
  select * into a from public.ajustes_saldo_financiador where financiador_id = 'fin_byron';
  if a.monto_ajuste <> -1209697 or a.fecha <> date '2026-06-18' then
    raise exception 'BYRON: ajuste distinto al revisado (% / %)', a.monto_ajuste, a.fecha;
  end if;
  select coalesce(sum(e.costo_compra), 0) into v_c from public.eventos_compra e join public.ordenes_compra_v2 o on o.id = e.oc_id
   where o.financiador_id = 'fin_byron' and not o.es_venta_propia;
  select coalesce(sum(monto), 0) into v_p from public.eventos_pago_financiamiento where financiador_id = 'fin_byron';
  if v_c <> 35017737 or v_p <> 27791341 then raise exception 'BYRON: compras/pagos distintos a los revisados (% / %)', v_c, v_p; end if;

  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
  values ('byron-ajuste-20261008', 'ajustes_saldo_financiador', a.id, '*fila*', to_jsonb(a)::text, null,
          'Ajuste manual Byron -1.209.697 (18/06/2026) sin respaldo documental: excluido del cálculo de deuda por decisión del usuario (08/10/2026). Deuda = compras 35.017.737 - pagos 27.791.341 = 7.226.396. Fila conservada completa en este registro.');
  delete from public.ajustes_saldo_financiador where id = a.id;

  select saldo_deuda into v_s from public.financiadores where id = 'fin_byron';
  if v_s <> 7226396 then raise exception 'BYRON: el saldo quedó en % (esperado 7226396)', v_s; end if;
  if (select string_agg(id || '=' || saldo_deuda, ' ' order by id) from public.financiadores)
     <> 'fin_byron=7226396 fin_cuenta_bfk=0 fin_francisco=0 fin_kevin=0 fin_matias=0' then
    raise exception 'BYRON: cambió otro financiador';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'BYRON: la base quedaría inconsistente'; end if;
  raise notice 'BYRON|TODO|APLICADA|%|', a.id;
end $$;
