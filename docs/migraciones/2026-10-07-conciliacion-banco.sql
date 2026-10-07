-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Conciliación BancoEstado ↔ BFK (2026-10-07): correcciones determinísticas confirmadas por los socios.
-- La cartola NO se corrige (15/07/2024–11/09/2026: abonos $65.202.963, cargos $65.129.671, saldo $73.292).
-- Una sola transacción, dueño de las tablas:   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-conciliacion-banco.sql
--
-- Cada caso: comprueba su pre-estado exacto por ID; si ya está aplicado lo omite (idempotente); si el
-- pre-estado no es el esperado lo BLOQUEA (no lo toca) y sigue con los demás. Cada caso corre en su propio
-- bloque: si al aplicarlo la base queda inconsistente, se deshace solo ese caso y queda bloqueado.
-- Todo cambio queda en fin_correcciones_registro (lote 'conciliacion-banco-20261007') con el valor anterior;
-- las filas quitadas se guardan completas. Deshacer: 2026-10-07-conciliacion-banco-deshacer.sql
--
--  C1 3799-62-AG26 Purén, factura 136: cobro BancoEstado 13/08/2026 $118.750 (faltaba).
--  C2 2713-769-AG26 Aysén: cobro 03/09/2026 $540.789 → $540.798 (abono real). DTE sin cambios.
--  C3 $260.001 del 05/06/2026 es de la Asociación (1404452-48-AG26): se quita esa atribución a Purén 3799-177-AG26.
--  C4 $169.000 del 13/07/2026 es de Trehuaco (4519-129-AG26): se quita esa atribución a INIA 1107277-31-AG26.
--  C5 DGAC $8.704 (1487-79-AG25, factura 42): retención del cliente. El cobro pasa a medio "retencion" (salda la
--     factura, no es caja) y el gasto pasa a "Retención de Cliente · Retención (sin movimiento bancario)": gasto
--     contable sin cargo bancario. Sin doble impacto.
--  C6 Venta externa de Matías $400.001: el cobro pasa a medio "fuera_banco" (BFK nunca recibió ese abono).
--     Se mantienen la OC, la factura vigente (301) y su historia tributaria. No se crea ningún abono.
--  C7 Pago a Matías de diciembre 2025 ($764.880): se documenta que se pagó como $100.000 de adelanto el
--     02/01/2026 (junto al aguinaldo de $100.000) + $664.880 el 19/01/2026. Ya estaba descontado: no se crea
--     ni se descuenta nada más.
--  C8 Aportes iniciales S/C-255…S/C-258 ($629.254): aportes patrimoniales históricos sin movimiento
--     BancoEstado comprobado (29/07/2026 es fecha de migración). No se suman a la caja BancoEstado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('public.fin_correcciones_registro') is null or to_regprocedure('public.fin_verificar_consistencia()') is null then
    raise exception 'CONC-BANCO: faltan las estructuras de integridad financiera';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then
    raise exception 'CONC-BANCO: la base ya tiene inconsistencias antes de empezar; no se aplica nada';
  end if;
end $$;

-- Registro de un cambio (solo dentro de esta transacción).
create or replace function pg_temp.reg(p_tabla text, p_id text, p_campo text, p_antes text, p_despues text, p_motivo text) returns void
language sql as $$
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
  values ('conciliacion-banco-20261007', p_tabla, p_id, p_campo, p_antes, p_despues, p_motivo)
$$;
create or replace function pg_temp.aplicado(p_caso text) returns boolean language sql as $$
  select exists (select 1 from public.fin_correcciones_registro r where r.lote = 'conciliacion-banco-20261007'
                 and r.revertida_en is null and r.motivo like p_caso || ' %')
$$;
create or replace function pg_temp.resultado(p_caso text, p_estado text, p_det text) returns void language plpgsql as $$
begin raise notice 'CONC|%|%|%', p_caso, p_estado, p_det; end $$;
-- Consistencia de la base acotada a las OCs del caso (o global si no se indican).
create or replace function pg_temp.consistente() returns boolean language sql as $$ select not exists (select 1 from public.fin_verificar_consistencia()) $$;

-- ── C1 · Purén 3799-62-AG26 · cobro factura 136 ─────────────────────────────────────────────
do $$
declare o public.ordenes_compra_v2; v_n int;
begin
  if pg_temp.aplicado('C1') then perform pg_temp.resultado('C1', 'YA_APLICADA', ''); return; end if;
  select * into o from public.ordenes_compra_v2 where id = 'ocv2_hist_0091';
  select count(*) into v_n from public.eventos_pago_cliente where oc_id = o.id;
  if o.numero_oc is distinct from '3799-62-AG26' or o.monto_facturado <> 118750 or v_n <> 0
     or not exists (select 1 from public.eventos_factura f where f.id = 'evf_hist_0091' and f.oc_id = o.id and f.numero_factura = '136' and f.monto = 118750)
     or exists (select 1 from public.eventos_pago_cliente p where p.monto = 118750 and p.fecha = '2026-08-13') then
    perform pg_temp.resultado('C1', 'BLOQUEADA', format('pre-estado distinto (cobros %s, facturado %s)', v_n, o.monto_facturado)); return;
  end if;
  begin
    insert into public.eventos_pago_cliente (id, oc_id, fecha, monto, notas, medio_pago, cobrado_en_banco)
    values ('evp_conc20261007_c1', o.id, '2026-08-13', 118750, 'Abono BancoEstado 13/08/2026, factura 136 (conciliación bancaria 2026-10).', 'transferencia', true);
    perform pg_temp.reg('eventos_pago_cliente', 'evp_conc20261007_c1', '*fila_nueva*', null,
      (select (to_jsonb(p) - 'creadoEn')::text from public.eventos_pago_cliente p where p.id = 'evp_conc20261007_c1'),
      'C1 Cobro BancoEstado 13/08/2026 $118.750 de la factura 136 (3799-62-AG26), faltaba en BFK');
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.resultado('C1', 'APLICADA', 'cobro $118.750 13/08/2026');
  exception when others then
    perform pg_temp.resultado('C1', 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;

-- ── C2 · Aysén 2713-769-AG26 · cobro $540.789 → $540.798 ─────────────────────────────────────
do $$
declare p public.eventos_pago_cliente;
begin
  if pg_temp.aplicado('C2') then perform pg_temp.resultado('C2', 'YA_APLICADA', ''); return; end if;
  select * into p from public.eventos_pago_cliente where id = 'evp_1788404118901_ac7v0';
  if p.oc_id is distinct from 'ocv2_cg_0011' or p.monto is distinct from 540789 or p.fecha is distinct from '2026-09-03'
     or (select count(*) from public.eventos_pago_cliente where oc_id = 'ocv2_cg_0011') <> 1 then
    perform pg_temp.resultado('C2', 'BLOQUEADA', format('pre-estado distinto (monto %s)', p.monto)); return;
  end if;
  begin
    update public.eventos_pago_cliente set monto = 540798,
      notas = trim(both ' ' from coalesce(notas, '') || ' Monto ajustado al abono BancoEstado real $540.798 (antes $540.789; conciliación 2026-10).')
     where id = p.id;
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'monto', '540789', '540798', 'C2 Abono BancoEstado 02/09/2026 fue $540.798 (2713-769-AG26)');
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'notas', coalesce(p.notas, ''), (select notas from public.eventos_pago_cliente where id = p.id), 'C2 nota');
    if not pg_temp.consistente() then raise exception 'inconsistencia: %', (select string_agg(x::text, '; ') from public.fin_verificar_consistencia() x); end if;
    perform pg_temp.resultado('C2', 'APLICADA', 'cobro $540.789 → $540.798');
  exception when others then
    perform pg_temp.resultado('C2', 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;

-- ── C3 / C4 · quitar la atribución de un abono que pertenece a otra OC ─────────────────────────
create or replace function pg_temp.quitar_cobro(p_caso text, p_evento text, p_oc text, p_monto numeric, p_fecha date, p_dueno text, p_motivo text) returns void
language plpgsql as $$
declare p public.eventos_pago_cliente;
begin
  if pg_temp.aplicado(p_caso) then perform pg_temp.resultado(p_caso, 'YA_APLICADA', ''); return; end if;
  select * into p from public.eventos_pago_cliente where id = p_evento;
  if p.oc_id is distinct from p_oc or p.monto is distinct from p_monto or p.fecha is distinct from p_fecha
     or not exists (select 1 from public.eventos_pago_cliente d where d.id = p_dueno and d.monto = p_monto) then
    perform pg_temp.resultado(p_caso, 'BLOQUEADA', format('pre-estado distinto (evento %s monto %s fecha %s)', coalesce(p.id, 'no existe'), p.monto, p.fecha)); return;
  end if;
  begin
    perform pg_temp.reg('eventos_pago_cliente', p.id, '*fila*', to_jsonb(p)::text, null, p_caso || ' ' || p_motivo);
    delete from public.eventos_pago_cliente where id = p.id;
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.resultado(p_caso, 'APLICADA', format('quitado cobro %s de %s', p_monto, p_oc));
  exception when others then
    perform pg_temp.resultado(p_caso, 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;
select pg_temp.quitar_cobro('C3', 'evp_ban_v2_hist_0015', 'ocv2_hist_0015', 260001, '2026-06-05', 'evpc_cg_0078',
  'El único abono BancoEstado de $260.001 (05/06/2026) es de la Asociación (1404452-48-AG26); se quita solo esa atribución a Purén 3799-177-AG26. Sin otro medio de pago registrado, la factura 281 queda por cobrar.');
select pg_temp.quitar_cobro('C4', 'evpc_cg_0031', 'ocv2_110727731ag26', 169000, '2026-06-25', 'evp_ban_v2_hist_0074',
  'El único abono BancoEstado de $169.000 (13/07/2026) es de Trehuaco (4519-129-AG26); se quita solo esa atribución a INIA 1107277-31-AG26. Sin otro medio de pago registrado, la factura 223 queda por cobrar.');

-- ── C5 · DGAC $8.704: retención (sin caja, sin doble impacto) ─────────────────────────────────
do $$
declare p public.eventos_pago_cliente; g public.gastos_indirectos; c public.categorias_gasto;
  v_sub constant text := 'Retención (sin movimiento bancario)';
begin
  if pg_temp.aplicado('C5') then perform pg_temp.resultado('C5', 'YA_APLICADA', ''); return; end if;
  select * into p from public.eventos_pago_cliente where id = 'evp_ppzat4qach';
  select * into g from public.gastos_indirectos where id = 'gasto_p3qnxdvmyz';
  select * into c from public.categorias_gasto where id = 'cat_8b08s3lt3u';
  if p.oc_id is distinct from 'ocv2_hist_0160' or p.monto is distinct from 8704 or coalesce(p.medio_pago, 'transferencia') <> 'transferencia'
     or g.monto is distinct from 8704 or g.categoria_id is distinct from 'cat_otros' or coalesce(g.subcategoria, '') <> ''
     or c.nombre is distinct from 'Retención de Cliente' then
    perform pg_temp.resultado('C5', 'BLOQUEADA', 'pre-estado distinto'); return;
  end if;
  begin
    update public.eventos_pago_cliente set medio_pago = 'retencion', cobrado_en_banco = false, institucion = null,
      notas = trim(both ' ' from coalesce(notas, '') || ' Retención de la DGAC sobre la factura 42: salda la factura, no entró a BancoEstado.')
     where id = p.id;
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'medio_pago', coalesce(p.medio_pago, ''), 'retencion', 'C5 DGAC $8.704 es retención: no ingresó al banco');
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'cobrado_en_banco', coalesce(p.cobrado_en_banco::text, ''), 'false', 'C5 cobrado_en_banco');
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'notas', coalesce(p.notas, ''), (select notas from public.eventos_pago_cliente where id = p.id), 'C5 nota');
    if not exists (select 1 from jsonb_array_elements(coalesce(c.subcategorias, '[]')) s where s ->> 'nombre' = v_sub) then
      update public.categorias_gasto set subcategorias = coalesce(subcategorias, '[]') || jsonb_build_array(jsonb_build_object('nombre', v_sub, 'monto_sugerido', 0)) where id = c.id;
      perform pg_temp.reg('categorias_gasto', c.id, 'subcategorias', coalesce(c.subcategorias, '[]')::text, (select subcategorias::text from public.categorias_gasto where id = c.id), 'C5 subcategoría para retenciones sin movimiento bancario');
    end if;
    update public.gastos_indirectos set categoria_id = c.id, subcategoria = v_sub where id = g.id;
    perform pg_temp.reg('gastos_indirectos', g.id, 'categoria_id', g.categoria_id, c.id, 'C5 gasto de retención: contable, sin cargo bancario');
    perform pg_temp.reg('gastos_indirectos', g.id, 'subcategoria', coalesce(g.subcategoria, ''), v_sub, 'C5 subcategoría');
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.resultado('C5', 'APLICADA', 'cobro → retencion; gasto → Retención de Cliente (sin movimiento bancario)');
  exception when others then
    perform pg_temp.resultado('C5', 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;

-- ── C6 · venta externa de Matías: el cobro no pasó por BancoEstado ──────────────────────────────
do $$
declare p public.eventos_pago_cliente; o public.ordenes_compra_v2;
begin
  if pg_temp.aplicado('C6') then perform pg_temp.resultado('C6', 'YA_APLICADA', ''); return; end if;
  select * into p from public.eventos_pago_cliente where id = 'evp_1785986933240_ikyp0';
  select * into o from public.ordenes_compra_v2 where id = 'ocv2_cg_0001';
  if p.oc_id is distinct from o.id or o.tipo_registro is distinct from 'externa' or p.monto is distinct from 400001
     or p.fecha is distinct from '2026-08-06' or coalesce(p.medio_pago, 'transferencia') <> 'transferencia' or not p.cobrado_en_banco then
    perform pg_temp.resultado('C6', 'BLOQUEADA', 'pre-estado distinto'); return;
  end if;
  begin
    update public.eventos_pago_cliente set medio_pago = 'fuera_banco', cobrado_en_banco = false, institucion = null,
      notas = trim(both ' ' from coalesce(notas, '') || ' Venta externa de Matías: el cliente le pagó a él y los $400.001 son suyos; BFK nunca recibió este abono (no hay abono BancoEstado).')
     where id = p.id;
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'medio_pago', coalesce(p.medio_pago, ''), 'fuera_banco', 'C6 Venta externa: BFK nunca recibió los $400.001');
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'cobrado_en_banco', coalesce(p.cobrado_en_banco::text, ''), 'false', 'C6 cobrado_en_banco');
    perform pg_temp.reg('eventos_pago_cliente', p.id, 'notas', coalesce(p.notas, ''), (select notas from public.eventos_pago_cliente where id = p.id), 'C6 nota');
    if not pg_temp.consistente() then raise exception 'inconsistencia'; end if;
    perform pg_temp.resultado('C6', 'APLICADA', 'cobro $400.001 → fuera_banco');
  exception when others then
    perform pg_temp.resultado('C6', 'BLOQUEADA', 'al aplicar: ' || sqlerrm);
  end;
end $$;

-- ── C7 · Matías: adelanto $100.000 del 02/01/2026 (solo documentación) ──────────────────────────
do $$
declare v public.pagos_vendedor; g public.gastos_indirectos;
  v_nota constant text := ' Pagado en dos transferencias: $100.000 el 02/01/2026 como adelanto de comisiones (junto al aguinaldo de $100.000, transferencia total $200.000) y $664.880 el 19/01/2026. $100.000 + $664.880 = $764.880: el adelanto ya quedó descontado aquí; no se descuenta de nuevo.';
begin
  if pg_temp.aplicado('C7') then perform pg_temp.resultado('C7', 'YA_APLICADA', ''); return; end if;
  select * into v from public.pagos_vendedor where id = 'pv_7ciiug03fi';
  select * into g from public.gastos_indirectos where id = 'gasto_2025_12_agumati';
  if v.vendedor_id is distinct from 'vend_matias' or v.anio <> 2025 or v.mes <> 12 or v.monto_pagado <> 764880
     or v.monto_verificado is distinct from 764880 or g.monto is distinct from 100000 then
    perform pg_temp.resultado('C7', 'BLOQUEADA', 'pre-estado distinto'); return;
  end if;
  update public.pagos_vendedor set notas = coalesce(notas, '') || v_nota where id = v.id;
  perform pg_temp.reg('pagos_vendedor', v.id, 'notas', coalesce(v.notas, ''), coalesce(v.notas, '') || v_nota, 'C7 Adelanto de $100.000 del 02/01/2026 documentado; ya descontado, sin pagos nuevos');
  perform pg_temp.resultado('C7', 'APLICADA', 'documentado (sin cambio de montos)');
end $$;

-- ── C8 · aportes iniciales de socios sin movimiento BancoEstado comprobado ──────────────────────
do $$
declare a record; v_n int; v_medio constant text := 'Sin movimiento BancoEstado comprobado';
  v_nota constant text := ' Aporte inicial confirmado por los socios. 29/07/2026 es la fecha de migración, no una fecha bancaria comprobada; no se suma a la caja BancoEstado.';
begin
  if pg_temp.aplicado('C8') then perform pg_temp.resultado('C8', 'YA_APLICADA', ''); return; end if;
  select count(*) into v_n from public.aportes_socios
   where (id, socio, monto) in (('ap_cg_0237','Kevin Vergara',209418),('ap_cg_0238','Byron Vegas',209418),('ap_cg_0239','Francisco Balboa',209418),('ap_cg_0240','Kevin Vergara',1000))
     and tipo = 'aporte' and fecha = '2026-07-29' and medio = 'Transferencia';
  if v_n <> 4 then perform pg_temp.resultado('C8', 'BLOQUEADA', format('pre-estado distinto (%s de 4)', v_n)); return; end if;
  for a in select * from public.aportes_socios where id in ('ap_cg_0237','ap_cg_0238','ap_cg_0239','ap_cg_0240') order by id loop
    update public.aportes_socios set medio = v_medio, notas = coalesce(notas, '') || v_nota where id = a.id;
    perform pg_temp.reg('aportes_socios', a.id, 'medio', a.medio, v_medio, 'C8 Aporte inicial: patrimonial, sin movimiento BancoEstado comprobado');
    perform pg_temp.reg('aportes_socios', a.id, 'notas', coalesce(a.notas, ''), coalesce(a.notas, '') || v_nota, 'C8 nota');
  end loop;
  perform pg_temp.resultado('C8', 'APLICADA', '4 aportes ($629.254) fuera de la caja BancoEstado');
end $$;

-- ── Garantía final ──────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.fin_verificar_consistencia()) then
    raise exception 'CONC-BANCO: la base quedó inconsistente; no se aplica nada';
  end if;
  raise notice 'CONC-BANCO: OK (% cambios registrados)', (select count(*) from public.fin_correcciones_registro where lote = 'conciliacion-banco-20261007' and revertida_en is null);
end $$;
