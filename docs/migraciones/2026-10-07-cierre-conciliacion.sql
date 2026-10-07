-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Cierre de conciliación BancoEstado al 07/10/2026 (tramo 14/09–07/10). Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-cierre-conciliacion.sql
-- Cartola (no se corrige): 15/07/2024–07/10/2026 · abonos $72.275.554 · cargos $71.254.970 · saldo $1.020.584.
-- Cada caso comprueba su pre-estado por ID; si ya está aplicado se omite; si no cuadra se BLOQUEA y se sigue.
-- Registro: fin_correcciones_registro, lote 'cierre-conciliacion-20261007'. Deshacer: ...-deshacer.sql
--
--  K1–K6 Cobros BancoEstado que faltaban (transferencia, en banco): Colbún, Máfil, Osorno, Purén, Delegación Aysén, SLEP Chiloé.
--  K7    Pago a Kevin Vergara 29/09 $485.469 = deuda exacta de sus 3 OCs pendientes → pago a financiador (RPC oficial).
--  K8    Pago a Byron Vegas 07/10 $5.000.000 ≤ su deuda → pago a financiador repartido FIFO (misma regla que la app).
--  K9    Matías 21/09 $30.000 → gasto "Apoyo en gestión y actualización de datos" (no comisión, no adelanto, no financiamiento).
--  K10   Matías abril 2026: el pago de $350.000 incluía $16.929 de apoyo en gestión (documentado en el propio registro):
--        se separa en comisión $333.071 + apoyo $16.929, misma fecha (la caja no cambia).
--  K11   Saldo bancario informado: $1.020.584 al 07/10/2026.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.fin_correcciones_registro') is null then raise exception 'CIERRE: faltan estructuras'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CIERRE: base inconsistente antes de empezar'; end if;
end $$;

create or replace function pg_temp.reg(p_tabla text, p_id text, p_campo text, p_antes text, p_despues text, p_motivo text) returns void language sql as $$
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
  values ('cierre-conciliacion-20261007', p_tabla, p_id, p_campo, p_antes, p_despues, p_motivo) $$;
create or replace function pg_temp.hecho(p_caso text) returns boolean language sql as $$
  select exists (select 1 from public.fin_correcciones_registro where lote = 'cierre-conciliacion-20261007' and revertida_en is null and motivo like p_caso || ' %') $$;
create or replace function pg_temp.res(p_caso text, p_estado text, p_det text) returns void language plpgsql as $$
begin raise notice 'CIERRE|%|%|%', p_caso, p_estado, p_det; end $$;
create or replace function pg_temp.consistente() returns boolean language sql as $$ select not exists (select 1 from public.fin_verificar_consistencia()) $$;

-- ── K1–K6 · cobros ─────────────────────────────────────────────────────────────────────────
create or replace function pg_temp.cobro(p_caso text, p_numero text, p_fecha date, p_monto numeric, p_folio text, p_nota text) returns void
language plpgsql as $$
declare o public.ordenes_compra_v2; v_n int; v_id text;
begin
  if pg_temp.hecho(p_caso) then perform pg_temp.res(p_caso, 'YA_APLICADA', p_numero); return; end if;
  select count(*) into v_n from public.ordenes_compra_v2 where numero_oc = p_numero;
  select * into o from public.ordenes_compra_v2 where numero_oc = p_numero;
  if v_n <> 1 or o.archivada or coalesce(o.monto_cobrado, 0) <> 0 or o.monto_facturado <> p_monto
     or exists (select 1 from public.eventos_pago_cliente p where p.oc_id = o.id)
     or not exists (select 1 from public.fin_facturas_vigentes(o.id) f where f.numero_factura = p_folio and f.monto = p_monto) then
    perform pg_temp.res(p_caso, 'BLOQUEADA', format('%s: pre-estado distinto (cobrado %s, facturado %s)', p_numero, o.monto_cobrado, o.monto_facturado)); return;
  end if;
  v_id := 'evp_cierre20261007_' || lower(p_caso);
  begin
    insert into public.eventos_pago_cliente (id, oc_id, fecha, monto, notas, medio_pago, cobrado_en_banco)
    values (v_id, o.id, p_fecha, p_monto, p_nota, 'transferencia', true);
    perform pg_temp.reg('eventos_pago_cliente', v_id, '*fila_nueva*', null, (select (to_jsonb(p) - 'creadoEn')::text from public.eventos_pago_cliente p where p.id = v_id),
      p_caso || ' Abono BancoEstado ' || to_char(p_fecha, 'DD/MM/YYYY') || ' $' || p_monto || ' · ' || p_numero || ' factura ' || p_folio);
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.res(p_caso, 'APLICADA', p_numero || ' $' || p_monto);
  exception when others then perform pg_temp.res(p_caso, 'BLOQUEADA', p_numero || ' al aplicar: ' || sqlerrm);
  end;
end $$;
select pg_temp.cobro('K1', '4172-149-AG26', '2026-09-14', 124800, '155', 'Abono BancoEstado 14/09/2026 (cierre de conciliación 07/10/2026).');
select pg_temp.cobro('K2', '3623-451-AG26', '2026-09-14', 234000, '316', 'Abono BancoEstado 14/09/2026 (cierre de conciliación 07/10/2026).');
select pg_temp.cobro('K3', '2297-903-AG26', '2026-09-14', 416000, '265', 'Abono BancoEstado 14/09/2026 (cierre de conciliación 07/10/2026).');
select pg_temp.cobro('K4', '3799-177-AG26', '2026-09-24', 260001, '281', 'Abono BancoEstado 24/09/2026 (Purén; distinto del abono de igual monto de La Calera del mismo día). Cierre de conciliación 07/10/2026.');
select pg_temp.cobro('K5', '551423-21-AG26', '2026-09-29', 174201, '325', 'Abono BancoEstado 29/09/2026 (la factura 325 figura con fecha 03/10/2026, posterior al abono). Cierre de conciliación 07/10/2026.');
select pg_temp.cobro('K6', '1393093-568-AG26', '2026-10-06', 416000, '278', 'Abono BancoEstado 06/10/2026 (cierre de conciliación 07/10/2026).');

-- ── K7 / K8 · pagos a financiadores (RPC oficial, reparto FIFO como la app) ────────────────────
select id as adm from public.perfiles where rol = 'admin' order by id limit 1 \gset
select set_config('cierre.adm', :'adm', true) \g /dev/null
create or replace function pg_temp.pago_fin(p_caso text, p_fin text, p_fecha date, p_monto numeric, p_exacto boolean) returns void
language plpgsql as $$
declare v_deuda numeric; v_saldo numeric; v_asig jsonb := '[]'::jsonb; v_resto numeric := p_monto; r record; v_res jsonb; v_antes text[];
begin
  if pg_temp.hecho(p_caso) then perform pg_temp.res(p_caso, 'YA_APLICADA', p_fin); return; end if;
  if exists (select 1 from public.eventos_pago_financiamiento where financiador_id = p_fin and fecha = p_fecha and monto = p_monto) then
    perform pg_temp.res(p_caso, 'BLOQUEADA', 'ya existe un pago de ese monto y fecha'); return;
  end if;
  select saldo_deuda into v_saldo from public.financiadores where id = p_fin;
  create temp table if not exists _pend (orden int, id text, numero text, debe numeric) on commit drop;
  truncate _pend;
  insert into _pend
  select row_number() over (order by coalesce((select min(e.fecha) from public.eventos_compra e where e.oc_id = o.id), o."creadoEn"::date), o."creadoEn", o.id),
         o.id, o.numero_oc, greatest(0, o.costo_total - o.monto_pagado_fin)
    from public.ordenes_compra_v2 o
   where o.financiador_id = p_fin and not o.archivada and not o.es_venta_propia and o.estado_pago_financiamiento <> 'pagado'
     and public.fin_tipo_financiamiento(o.id) = 'externo' and public.fin_motivo_bloqueo(o.id, 'financiamiento') is null
     and o.costo_total - o.monto_pagado_fin > 0;
  select coalesce(sum(debe), 0) into v_deuda from _pend;
  if (p_exacto and v_deuda <> p_monto) or p_monto > v_deuda or p_monto > v_saldo then
    perform pg_temp.res(p_caso, 'BLOQUEADA', format('%s: pago %s vs deuda OCs %s, saldo %s', p_fin, p_monto, v_deuda, v_saldo)); return;
  end if;
  for r in select * from _pend order by orden loop
    exit when v_resto <= 0;
    v_asig := v_asig || jsonb_build_array(jsonb_build_object('oc_id', r.id, 'monto', least(v_resto, r.debe)));
    v_resto := v_resto - least(v_resto, r.debe);
  end loop;
  select array_agg(id) into v_antes from public.eventos_pago_financiamiento where financiador_id = p_fin;
  begin
    -- Con la sesión de un administrador (la RPC exige auth.uid()); las reglas y recálculos son los de la app.
    perform set_config('request.jwt.claim.sub', current_setting('cierre.adm'), true);
    perform set_config('request.jwt.claims', json_build_object('sub', current_setting('cierre.adm'), 'role', 'authenticated')::text, true);
    v_res := public.registrar_pago_financiador(p_fin, p_fecha, p_monto, v_asig, 'cartola');
    perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
    for r in select p.* from public.eventos_pago_financiamiento p where p.financiador_id = p_fin and not (p.id = any(coalesce(v_antes, '{}'))) loop
      perform pg_temp.reg('eventos_pago_financiamiento', r.id, '*fila_nueva*', null, (to_jsonb(r) - 'creadoEn')::text,
        p_caso || ' Pago BancoEstado ' || to_char(p_fecha, 'DD/MM/YYYY') || ' $' || p_monto || ' a ' || p_fin || ' (OC ' || coalesce(r.oc_id, 'sin OC') || ' $' || r.monto || ')');
    end loop;
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.res(p_caso, 'APLICADA', format('%s $%s → %s OCs (%s completas), sobrante %s, saldo %s → %s', p_fin, p_monto, v_res->>'ocs', v_res->>'completas', v_res->>'sobrante', v_saldo, v_res->>'saldo_financiador'));
  exception when others then
    perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
    perform pg_temp.res(p_caso, 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;
select pg_temp.pago_fin('K7', 'fin_kevin', '2026-09-29', 485469, true);
select pg_temp.pago_fin('K8', 'fin_byron', '2026-10-07', 5000000, false);

-- ── K9 / K10 · Matías: apoyo en gestión y actualización de datos ─────────────────────────────
do $$
declare v public.pagos_vendedor;
begin
  if not exists (select 1 from public.categorias_gasto where id = 'cat_apoyo_gestion') then
    insert into public.categorias_gasto (id, nombre, subcategorias) values ('cat_apoyo_gestion', 'Apoyo en gestión y actualización de datos', '[]'::jsonb);
    perform pg_temp.reg('categorias_gasto', 'cat_apoyo_gestion', '*fila_nueva*', null, 'Apoyo en gestión y actualización de datos',
      'K9 Categoría para pagos extra a vendedores que no son comisión, adelanto ni financiamiento');
  end if;
  if pg_temp.hecho('K9') then perform pg_temp.res('K9', 'YA_APLICADA', '');
  elsif exists (select 1 from public.gastos_indirectos where fecha = '2026-09-21' and monto = 30000) then
    perform pg_temp.res('K9', 'BLOQUEADA', 'ya existe un gasto de $30.000 el 21/09');
  else
    insert into public.gastos_indirectos (id, categoria_id, subcategoria, monto, mes, anio, fecha, detalle)
    values ('gasto_cierre20261007_k9', 'cat_apoyo_gestion', '', 30000, 9, 2026, '2026-09-21', 'Matías Vegas · Apoyo en gestión y actualización de datos (transferencia BancoEstado 21/09/2026)');
    perform pg_temp.reg('gastos_indirectos', 'gasto_cierre20261007_k9', '*fila_nueva*', null, '30000',
      'K9 Matías 21/09/2026 $30.000: apoyo en gestión y actualización de datos (no comisión, no adelanto, no financiamiento)');
    perform pg_temp.res('K9', 'APLICADA', 'gasto $30.000 apoyo en gestión');
  end if;

  if pg_temp.hecho('K10') then perform pg_temp.res('K10', 'YA_APLICADA', ''); return; end if;
  select * into v from public.pagos_vendedor where id = 'pv_banagm5w8a';
  if v.vendedor_id is distinct from 'vend_matias' or v.anio <> 2026 or v.mes <> 4 or v.monto_pagado <> 350000 or v.monto_verificado is distinct from 350000
     or v.notas not like '%extra de $16.929 por apoyo en gestión%' then
    perform pg_temp.res('K10', 'BLOQUEADA', 'pre-estado distinto'); return;
  end if;
  update public.pagos_vendedor set monto_pagado = 333071, monto_verificado = 333071,
         notas = notas || ' Separado (07/10/2026): comisión $333.071 aquí + $16.929 de apoyo en gestión y actualización de datos como gasto aparte (misma transferencia).'
   where id = v.id;
  perform pg_temp.reg('pagos_vendedor', v.id, 'monto_pagado', '350000', '333071', 'K10 Abril 2026: separar $16.929 de apoyo en gestión del pago de comisión');
  perform pg_temp.reg('pagos_vendedor', v.id, 'monto_verificado', '350000', '333071', 'K10 comisión verificada de abril = $333.071');
  perform pg_temp.reg('pagos_vendedor', v.id, 'notas', v.notas, (select notas from public.pagos_vendedor where id = v.id), 'K10 nota');
  insert into public.gastos_indirectos (id, categoria_id, subcategoria, monto, mes, anio, fecha, detalle)
  values ('gasto_cierre20261007_k10', 'cat_apoyo_gestion', '', 16929, 4, 2026, v.fecha,
          'Matías Vegas · Apoyo en gestión y actualización de datos (parte de la transferencia de $350.000 del 31/05/2026, op. 7040421)');
  perform pg_temp.reg('gastos_indirectos', 'gasto_cierre20261007_k10', '*fila_nueva*', null, '16929', 'K10 apoyo en gestión abril 2026');
  perform pg_temp.res('K10', 'APLICADA', 'abril: comisión $333.071 + apoyo $16.929');
end $$;

-- ── K11 · saldo bancario informado ─────────────────────────────────────────────────────────
do $$
declare s public.saldo_banco;
begin
  if pg_temp.hecho('K11') then perform pg_temp.res('K11', 'YA_APLICADA', ''); return; end if;
  select * into s from public.saldo_banco where id = 'actual';
  update public.saldo_banco set saldo = 1020584, fecha_corte = '2026-10-07', nota = 'Cartola BancoEstado al 07/10/2026 (cierre de conciliación)', actualizado_en = now() where id = 'actual';
  perform pg_temp.reg('saldo_banco', 'actual', '*fila*', to_jsonb(s)::text, null, 'K11 Saldo BancoEstado al 07/10/2026: $1.020.584');
  perform pg_temp.res('K11', 'APLICADA', format('saldo %s (%s) → 1020584 (2026-10-07)', s.saldo, s.fecha_corte));
end $$;

do $$
begin
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CIERRE: la base quedó inconsistente; no se aplica nada'; end if;
  raise notice 'CIERRE: OK (% cambios registrados)', (select count(*) from public.fin_correcciones_registro where lote = 'cierre-conciliacion-20261007' and revertida_en is null);
end $$;
