-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Cargos BancoEstado sin registro BFK, confirmados por el usuario (07/10/2026). Una sola transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-cargos-confirmados.sql
-- Solo se registran salidas que SÍ están en la cartola BancoEstado (monto y fecha exactos) y cuyo concepto confirmó
-- el usuario. Cada caso comprueba su pre-estado por ID; si ya está aplicado se omite; si no cuadra se BLOQUEA.
-- No toca comisiones (usan costo_total de la OC), F29 (las multas van en categoría propia, no "Impuesto SII"),
-- ni casos bloqueados. Registro: fin_correcciones_registro, lote 'cargos-confirmados-20261007'.
--  C1 Francisco 23/04/2026 $500.000: devolución del préstamo de Francisco para compras BFK → pago a financiador (sin OC).
--  C2 Francisco 11/03/2026 $150.000 y 25/03/2026 $165.320: postventa BFK, instalación de aire acondicionado (OC no identificada).
--  C3 Matías Rivera 14/08/2026 $10.964: postventa OC 2704-1220-AG26 (UBB). El costo ya estaba en la post-venta de la OC
--     (pv_1786651009613_8vq9o) pero no como salida de caja: pasa a gasto Postventa y la post-venta queda con costo 0
--     y referencia (el resultado total no cambia; se evita contarlo dos veces).
--  C4 Import New York SACI 23/07/2026 $73.381: compra/gasto BFK (categoría específica pendiente → Otros).
--  C5 Gestión Empresarial 20/05/2026 $10.483: multa por reprocesos de renta (categoría Multas y recargos tributarios).
-- Deshacer: 2026-10-07-cargos-confirmados-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.fin_correcciones_registro') is null then raise exception 'CARGOS: faltan estructuras'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CARGOS: base inconsistente antes de empezar'; end if;
end $$;

create or replace function pg_temp.reg(p_tabla text, p_id text, p_campo text, p_antes text, p_despues text, p_motivo text) returns void language sql as $$
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
  values ('cargos-confirmados-20261007', p_tabla, p_id, p_campo, p_antes, p_despues, p_motivo) $$;
create or replace function pg_temp.hecho(p_caso text) returns boolean language sql as $$
  select exists (select 1 from public.fin_correcciones_registro where lote = 'cargos-confirmados-20261007' and revertida_en is null and motivo like p_caso || ' %') $$;
create or replace function pg_temp.res(p_caso text, p_estado text, p_det text) returns void language plpgsql as $$
begin raise notice 'CARGOS|%|%|%', p_caso, p_estado, p_det; end $$;

create or replace function pg_temp.categoria(p_caso text, p_id text, p_nombre text) returns void language plpgsql as $$
begin
  if not exists (select 1 from public.categorias_gasto where id = p_id) then
    insert into public.categorias_gasto (id, nombre, subcategorias) values (p_id, p_nombre, '[]'::jsonb);
    perform pg_temp.reg('categorias_gasto', p_id, '*fila_nueva*', null, p_nombre, p_caso || ' Categoría nueva ' || p_nombre);
  end if;
end $$;

-- Gasto nuevo con salida BancoEstado comprobada. Bloquea si ya hay un gasto de ese monto en ±7 días.
create or replace function pg_temp.gasto(p_caso text, p_id text, p_cat text, p_sub text, p_monto numeric, p_fecha date, p_detalle text) returns boolean
language plpgsql as $$
begin
  if exists (select 1 from public.gastos_indirectos where id = p_id) then perform pg_temp.res(p_caso, 'YA_APLICADA', p_id); return false; end if;
  if exists (select 1 from public.gastos_indirectos where monto = p_monto and fecha between p_fecha - 7 and p_fecha + 7) then
    perform pg_temp.res(p_caso, 'BLOQUEADA', format('ya existe un gasto de %s cerca del %s', p_monto, p_fecha)); return false;
  end if;
  insert into public.gastos_indirectos (id, categoria_id, subcategoria, monto, mes, anio, fecha, detalle)
  values (p_id, p_cat, coalesce(p_sub, ''), p_monto, extract(month from p_fecha)::int, extract(year from p_fecha)::int, p_fecha, p_detalle);
  perform pg_temp.reg('gastos_indirectos', p_id, '*fila_nueva*', null, p_monto::text, p_caso || ' ' || p_detalle);
  perform pg_temp.res(p_caso, 'APLICADA', p_id || ' $' || p_monto);
  return true;
end $$;

-- ── C1 · devolución préstamo Francisco ──────────────────────────────────────────────────────
do $$
declare v_id text := 'evpf_cargos20261007_c1'; v_saldo numeric;
begin
  if pg_temp.hecho('C1') then perform pg_temp.res('C1', 'YA_APLICADA', ''); return; end if;
  if exists (select 1 from public.eventos_pago_financiamiento where financiador_id = 'fin_francisco' and monto = 500000)
     or (select saldo_deuda from public.financiadores where id = 'fin_francisco') is distinct from -1000000 then
    perform pg_temp.res('C1', 'BLOQUEADA', 'pre-estado distinto'); return;
  end if;
  insert into public.eventos_pago_financiamiento (id, oc_id, financiador_id, fecha, monto, notas)
  values (v_id, null, 'fin_francisco', '2026-04-23', 500000,
          'Devolución a Francisco Balboa del préstamo de $500.000 que hizo para compras de BFK (confirmado por el usuario 07/10/2026). TEF BancoEstado 23/04/2026. El préstamo original no tiene registro en BFK ni abono en BancoEstado.');
  perform pg_temp.reg('eventos_pago_financiamiento', v_id, '*fila_nueva*', null, '500000', 'C1 Devolución préstamo Francisco 23/04/2026 $500.000 (TEF BancoEstado)');
  select saldo_deuda into v_saldo from public.financiadores where id = 'fin_francisco';
  perform pg_temp.res('C1', 'APLICADA', 'Francisco saldo -1000000 → ' || v_saldo);
end $$;

-- ── C2–C5 · gastos con salida BancoEstado ───────────────────────────────────────────────────
do $$
declare p public.eventos_postventa; v_det text;
begin
  perform pg_temp.categoria('C2', 'cat_postventa', 'Postventa');
  perform pg_temp.categoria('C5', 'cat_multas_tributarias', 'Multas y recargos tributarios');
  perform pg_temp.gasto('C2', 'gasto_cargos20261007_c2a', 'cat_postventa', '', 150000, '2026-03-11',
    'Postventa BFK: instalación de aire acondicionado no contemplada originalmente (OC no identificada en BFK) · TEF BancoEstado a Francisco Balboa 11/03/2026');
  perform pg_temp.gasto('C2', 'gasto_cargos20261007_c2b', 'cat_postventa', '', 165320, '2026-03-25',
    'Postventa BFK: instalación de aire acondicionado no contemplada originalmente (OC no identificada en BFK) · TEF BancoEstado a Francisco Balboa 25/03/2026');
  -- C3: solo si la post-venta de la OC sigue exactamente como se encontró.
  select * into p from public.eventos_postventa where id = 'pv_1786651009613_8vq9o';
  if pg_temp.hecho('C3') then perform pg_temp.res('C3', 'YA_APLICADA', '');
  elsif p.id is null or p.costo_extra <> 10964 or p.oc_id <> 'ocv2_27041220ag26'
        or (select numero_oc from public.ordenes_compra_v2 where id = p.oc_id) <> '2704-1220-AG26' then
    perform pg_temp.res('C3', 'BLOQUEADA', 'post-venta distinta a la revisada');
  elsif pg_temp.gasto('C3', 'gasto_cargos20261007_c3', 'cat_postventa', '', 10964, '2026-08-14',
          'Postventa BFK OC 2704-1220-AG26 (Universidad del Bío-Bío): armado de silla y tuercas · TEF BancoEstado a Matías Rivera 14/08/2026 · antes solo como costo de la post-venta pv_1786651009613_8vq9o') then
    v_det := coalesce(nullif(btrim(coalesce(p.detalle_costo, '')), '') || ' · ', '') || 'Costo $10.964 pagado por BancoEstado el 14/08/2026: registrado como gasto Postventa gasto_cargos20261007_c3 (07/10/2026).';
    update public.eventos_postventa set costo_extra = 0, detalle_costo = v_det where id = p.id;
    perform pg_temp.reg('eventos_postventa', p.id, 'costo_extra', '10964', '0', 'C3 costo de post-venta pasa al gasto Postventa (no contar dos veces)');
    perform pg_temp.reg('eventos_postventa', p.id, 'detalle_costo', p.detalle_costo, v_det, 'C3 nota');
  end if;
  perform pg_temp.gasto('C4', 'gasto_cargos20261007_c4', 'cat_otros', '', 73381, '2026-07-23',
    'Import New York SACI · compra/gasto BFK (concepto y categoría específica por confirmar; sin OC) · TEF BancoEstado 23/07/2026');
  perform pg_temp.gasto('C5', 'gasto_cargos20261007_c5', 'cat_multas_tributarias', '', 10483, '2026-05-20',
    'Multa por reprocesos de renta · TEF BancoEstado a Gestión Empresarial AM 20/05/2026');
end $$;

do $$
begin
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CARGOS: la base quedó inconsistente; no se aplica nada'; end if;
  raise notice 'CARGOS: OK (% cambios registrados)', (select count(*) from public.fin_correcciones_registro where lote = 'cargos-confirmados-20261007' and revertida_en is null);
end $$;
