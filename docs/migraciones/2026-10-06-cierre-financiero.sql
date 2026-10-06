-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Cierre financiero (2026-10-06). Una sola transacción, ejecutada por el dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-06-cierre-financiero.sql
-- Si el estado no es exactamente el auditado, se aborta sin cambios. Todo queda en
-- fin_correcciones_registro (lote 'cierre-financiero', fila completa antes del cambio).
--
-- 1. Doble registro del pago a Juan Vergara (comisión de junio 2025, $17.050): el pago a vendedor
--    (pagos_vendedor) se conserva; se elimina SOLO el gasto "Pago Vendedor" que lo duplicaba.
-- 2. 1057480-1082-AG26 y 1057480-1082-AG26-B (misma factura N° 150): quedan bloqueadas en
--    financiamiento, facturación y cobro hasta contar con evidencia. No se elige una OC ni se
--    elimina ningún pago: se agregan diferencias de decisión con diferencia 0 (no cambian ningún valor).
-- Deshacer: 2026-10-06-cierre-financiero-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (select 1 from public.fin_correcciones_registro where lote = 'cierre-financiero' and revertida_en is null) then
    raise exception 'CIERRE-FIN: ya aplicado';
  end if;
  if (select count(*) from public.gastos_indirectos where categoria_id = 'cat_vendedor' and monto = 17050
        and fecha = '2025-07-02' and detalle = 'Pago Vendedor Juan Vergara - junio 2025') <> 1
     or (select count(*) from public.gastos_indirectos where categoria_id = 'cat_vendedor') <> 1 then
    raise exception 'CIERRE-FIN: el gasto duplicado de Juan no es el auditado';
  end if;
  if (select count(*) from public.pagos_vendedor where vendedor_id = 'vend_juan' and anio = 2025 and mes = 6 and monto_pagado = 17050) <> 1 then
    raise exception 'CIERRE-FIN: falta el pago a vendedor de Juan (no se elimina el gasto)';
  end if;
  if (select count(*) from public.ordenes_compra_v2 where id in ('ocv2_hist_0058', 'ocv2_cg_0100')
        and numero_oc in ('1057480-1082-AG26', '1057480-1082-AG26-B')) <> 2
     or (select count(*) from public.eventos_factura where oc_id in ('ocv2_hist_0058', 'ocv2_cg_0100') and btrim(numero_factura) = '150') <> 2 then
    raise exception 'CIERRE-FIN: las OCs 1057480 no son las auditadas';
  end if;
  if exists (select 1 from public.fin_diferencias_historicas where entidad = 'oc' and entidad_id in ('ocv2_hist_0058', 'ocv2_cg_0100')
               and campo in ('monto_cobrado', 'monto_pagado_fin')) then
    raise exception 'CIERRE-FIN: ya existen bloqueos de cobro/pago para esas OCs';
  end if;
end $$;

create temp table _cf_oc on commit drop as select o.id, md5(to_jsonb(o)::text) h from public.ordenes_compra_v2 o;
create temp table _cf_fin on commit drop as select f.id, f.saldo_deuda from public.financiadores f;
create temp table _cf_pv on commit drop as select md5(coalesce(string_agg(x::text, ',' order by x.id), '')) h from public.pagos_vendedor x;

-- 1. Gasto duplicado de Juan
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'cierre-financiero', 'gastos_indirectos', g.id, '*fila*', to_jsonb(g)::text, null,
       'Doble registro: el pago de comisión de Juan (junio 2025, $17.050) ya está en pagos_vendedor; se elimina solo el gasto duplicado'
  from public.gastos_indirectos g where g.categoria_id = 'cat_vendedor' and g.monto = 17050 and g.detalle = 'Pago Vendedor Juan Vergara - junio 2025';
delete from public.gastos_indirectos g where g.categoria_id = 'cat_vendedor' and g.monto = 17050 and g.detalle = 'Pago Vendedor Juan Vergara - junio 2025';

-- 2. Bloqueo de 1057480-1082-AG26 y su posible duplicado (diferencia 0: no cambia ningún valor)
create temp table _cf_bloq on commit drop as
select o.id, o.numero_oc, x.campo, x.valor::text v, x.bloquea
  from public.ordenes_compra_v2 o
  cross join lateral (values
    ('monto_cobrado', o.monto_cobrado, array['facturacion', 'cobro']),
    ('monto_pagado_fin', o.monto_pagado_fin, array['financiamiento'])) x(campo, valor, bloquea)
 where o.id in ('ocv2_hist_0058', 'ocv2_cg_0100');
insert into public.fin_diferencias_historicas (entidad, entidad_id, etiqueta, campo, valor_registrado, valor_eventos, diferencia, bloquea, causa, clasificacion)
select 'oc', b.id, b.numero_oc, b.campo, b.v, b.v, 0, b.bloquea,
       'Posible OC duplicada: 1057480-1082-AG26 y 1057480-1082-AG26-B tienen la misma factura N° 150 ($130.000, 20-04-2026), ambas cobradas y con pago a Byron. Bloqueada hasta contar con evidencia; no se eligió OC ni se eliminó ningún pago',
       'decision'
  from _cf_bloq b;
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'cierre-financiero', 'fin_diferencias_historicas', d.id::text, 'bloqueo', null, d.entidad_id || ':' || d.campo, 'Bloqueo por posible duplicado (factura N° 150)'
  from public.fin_diferencias_historicas d where d.entidad_id in ('ocv2_hist_0058', 'ocv2_cg_0100') and d.campo in ('monto_cobrado', 'monto_pagado_fin');

-- 3. Verificación (misma transacción)
do $$
declare v int;
begin
  if (select count(*) from public.fin_verificar_consistencia()) > 0 then raise exception 'CIERRE-FIN: inconsistencia'; end if;
  select count(*) into v from _cf_oc a join public.ordenes_compra_v2 o on o.id = a.id where md5(to_jsonb(o)::text) <> a.h;
  if v > 0 then raise exception 'CIERRE-FIN: cambiarían % OC(s)', v; end if;
  if exists (select 1 from _cf_fin a join public.financiadores f on f.id = a.id where f.saldo_deuda is distinct from a.saldo_deuda) then
    raise exception 'CIERRE-FIN: cambiaría un saldo de financiador';
  end if;
  if (select md5(coalesce(string_agg(x::text, ',' order by x.id), '')) from public.pagos_vendedor x) <> (select h from _cf_pv) then
    raise exception 'CIERRE-FIN: cambiarían los pagos a vendedores';
  end if;
  if (select count(*) from public.gastos_indirectos where categoria_id = 'cat_vendedor') <> 0 then raise exception 'CIERRE-FIN: gasto no eliminado'; end if;
  if (select count(*) from public.fin_diferencias_historicas where estado = 'pendiente' and entidad_id in ('ocv2_hist_0058', 'ocv2_cg_0100')) <> 5 then
    raise exception 'CIERRE-FIN: bloqueos inesperados';
  end if;
  raise notice 'CIERRE-FIN: gasto duplicado eliminado (registro guardado); 4 bloqueos agregados; valores y saldos sin cambios';
end $$;
