-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- OC 4020-842-AG25 (I. Municipalidad de Cañete, factura 39): elimina SOLO la duplicidad de $98.406. Una transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-matias-canete.sql
-- Operación real (cartola + planilla histórica + comisión julio 2025):
--   cobro $245.489 · Vega Cofre $124.000 (TEF 24/07/2025) · Matías $98.406 = 81% del margen $121.489, pagado dentro de
--   la comisión de julio 2025 (TEF 08/09/2025, $141.975 = 43.569 + 98.406) · BFK $23.083 = 19% del margen (regla histórica
--   de "venta propia directa"; no es el IVA).
-- Duplicidad: los $98.406 estaban en el costo de compra ($222.406 = 124.000 + 98.406) y en el pago a financiador
--   Matías ($222.406, sin transferencia), además de en la comisión pagada.
-- Corrección: compra evc_hist_0161 222.406 → 124.000 y pago a financiador evpf_cg_0203 222.406 → 124.000.
--   No cambia: venta, factura 39, cobro, IVA, comisión de julio 2025 (verificada $141.975), saldo de Matías (0).
--   Resultado BFK: margen OC 121.489 − 98.406 (comisión) = 23.083. Caja: deja de restar $98.406 inexistentes.
-- Registro: lote 'matias-canete-20261007'. Deshacer: 2026-10-07-matias-canete-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
declare c public.eventos_compra; p public.eventos_pago_financiamiento; o public.ordenes_compra_v2; v public.pagos_vendedor; nc text; np text;
begin
  if to_regclass('public.fin_correcciones_registro') is null then raise exception 'CANETE: faltan estructuras'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CANETE: base inconsistente antes de empezar'; end if;
  if exists (select 1 from public.fin_correcciones_registro where lote = 'matias-canete-20261007' and revertida_en is null) then
    raise notice 'CANETE|M1|YA_APLICADA|'; return;
  end if;
  select * into o from public.ordenes_compra_v2 where id = 'ocv2_hist_0161';
  select * into c from public.eventos_compra where id = 'evc_hist_0161';
  select * into p from public.eventos_pago_financiamiento where id = 'evpf_cg_0203';
  select * into v from public.pagos_vendedor where id = 'pv_rrhlvlvko0';
  if o.numero_oc is distinct from '4020-842-AG25' or o.monto_total <> 245489 or o.monto_cobrado <> 245489 or o.costo_total <> 222406 or o.archivada
     or (select count(*) from public.eventos_compra where oc_id = o.id) <> 1 or c.oc_id <> o.id or c.costo_compra <> 222406 or c.financiador_id <> 'fin_matias'
     or (select count(*) from public.eventos_pago_financiamiento where oc_id = o.id) <> 1 or p.oc_id <> o.id or p.monto <> 222406 or p.financiador_id <> 'fin_matias'
     or v.monto_pagado <> 141975 or v.monto_verificado <> 141975 or v.notas not like '%$98.406 venta propia directa%'
     or (select saldo_deuda from public.financiadores where id = 'fin_matias') <> 0 then
    raise notice 'CANETE|M1|BLOQUEADA|pre-estado distinto'; return;
  end if;
  nc := coalesce(nullif(btrim(coalesce(c.notas, '')), '') || ' · ', '') || 'Costo real: $124.000 pagados a Vega Cofre (TEF BancoEstado 24/07/2025). Antes $222.406 incluía $98.406 de Matías ya pagados en su comisión de julio 2025 (corrección 07/10/2026).';
  np := coalesce(nullif(btrim(coalesce(p.notas, '')), '') || ' · ', '') || 'Pagado directamente al proveedor Vega Cofre (TEF BancoEstado 24/07/2025, $124.000). Los $98.406 de Matías van en su comisión de julio 2025 (corrección 07/10/2026).';
  update public.eventos_compra set costo_compra = 124000, notas = nc where id = c.id;
  update public.eventos_pago_financiamiento set monto = 124000, notas = np where id = p.id;
  insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo) values
    ('matias-canete-20261007', 'eventos_compra', c.id, 'costo_compra', '222406', '124000', 'M1 OC 4020-842-AG25: quitar $98.406 duplicados del costo'),
    ('matias-canete-20261007', 'eventos_compra', c.id, 'notas', c.notas, nc, 'M1 nota'),
    ('matias-canete-20261007', 'eventos_pago_financiamiento', p.id, 'monto', '222406', '124000', 'M1 OC 4020-842-AG25: pago real = TEF Vega Cofre $124.000'),
    ('matias-canete-20261007', 'eventos_pago_financiamiento', p.id, 'notas', p.notas, np, 'M1 nota');
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'CANETE: la base quedó inconsistente; no se aplica nada'; end if;
  raise notice 'CANETE|M1|APLICADA|costo % · pagado fin % · saldo Matías %', (select costo_total from public.ordenes_compra_v2 where id = o.id),
    (select monto_pagado_fin from public.ordenes_compra_v2 where id = o.id), (select saldo_deuda from public.financiadores where id = 'fin_matias');
end $$;
