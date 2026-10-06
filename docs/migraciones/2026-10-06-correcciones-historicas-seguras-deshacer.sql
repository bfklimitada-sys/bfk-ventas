-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase 4B · DESHACER las correcciones históricas seguras (lote 'seguras-4b'). Una sola transacción.
-- Restaura los eventos de compra redondeados, vuelve a dejar pendientes las diferencias resueltas por el lote
-- y recalcula: cada OC vuelve exactamente a los valores que tenía antes de la corrección (se verifica con
-- fin_correcciones_registro). Los saldos de los financiadores no cambian. Las entradas del historial se
-- conservan y se agrega una entrada "Corrección histórica revertida (Fase 4B)" por cada valor restaurado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if to_regclass('public.fin_correcciones_registro') is null then
    raise exception 'FASE4B-SEG-DESHACER: el lote seguras-4b no está aplicado';
  end if;
  if not exists (select 1 from public.fin_correcciones_registro r where r.lote = 'seguras-4b' and r.revertida_en is null) then
    raise exception 'FASE4B-SEG-DESHACER: el lote seguras-4b no está aplicado';
  end if;
end $$;

create temp table _des on commit drop as
  select r.* from public.fin_correcciones_registro r where r.lote = 'seguras-4b' and r.revertida_en is null;
create temp table _des_ocs on commit drop as
  select distinct d.entidad_id as id from public.fin_diferencias_historicas d
   where d.id::text in (select fila_id from _des where tabla = 'fin_diferencias_historicas');
create temp table _des_fin_antes on commit drop as select f.id, md5(to_jsonb(f)::text) huella from public.financiadores f;
create temp table _des_otras_antes on commit drop as
  select o.id, md5(to_jsonb(o)::text) huella from public.ordenes_compra_v2 o where o.id not in (select id from _des_ocs);

-- 1. Eventos de compra: valores anteriores. Restauración exacta (como importar_respaldo_excel): sin bloqueo ni
--    recálculo intermedio, para no escribir valores transitorios; el recálculo se hace una sola vez en el paso 3.
select set_config('bfk.importacion', 'on', true);
update public.eventos_compra e
   set costo_compra = (select r.antes::numeric from _des r where r.tabla = 'eventos_compra' and r.fila_id = e.id and r.campo = 'costo_compra')
 where e.id in (select fila_id from _des where tabla = 'eventos_compra' and campo = 'costo_compra');
update public.eventos_compra e
   set financiador_id = (select r.antes from _des r where r.tabla = 'eventos_compra' and r.fila_id = e.id and r.campo = 'financiador_id')
 where e.id in (select fila_id from _des where tabla = 'eventos_compra' and campo = 'financiador_id');
select set_config('bfk.importacion', 'off', true);

-- 2. Diferencias: pendientes otra vez (vuelven a congelar los valores registrados).
update public.fin_diferencias_historicas d
   set estado = 'pendiente', resuelta_en = null, resuelta_por = null, resolucion = null
 where d.id::text in (select fila_id from _des where tabla = 'fin_diferencias_historicas');

-- 3. Recalcular las OCs del lote y sus financiadores.
select public.fin_recalcular(
  array(select id from _des_ocs),
  array(select distinct z.x from (select o.financiador_id as x from public.ordenes_compra_v2 o where o.id in (select id from _des_ocs)
                                  union select r.antes from _des r where r.tabla = 'eventos_compra' and r.campo = 'financiador_id'
                                  union select r.despues from _des r where r.tabla = 'eventos_compra' and r.campo = 'financiador_id') z
         where z.x is not null));

insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
select 'hc_seg4b_rev_' || (extract(epoch from clock_timestamp()) * 1000)::bigint || '_' || row_number() over (order by r.fila_id, r.campo),
       r.fila_id, o.numero_oc, null, 'Corrección Fase 4B', 'Corrección histórica revertida (Fase 4B)', r.campo,
       case when r.campo like 'monto%' or r.campo = 'costo_total' then public.fin_pesos(r.despues::numeric) else r.despues end,
       case when r.campo like 'monto%' or r.campo = 'costo_total' then public.fin_pesos(r.antes::numeric) else r.antes end
  from _des r join public.ordenes_compra_v2 o on o.id = r.fila_id
 where r.tabla = 'ordenes_compra_v2';

update public.fin_correcciones_registro r set revertida_en = now() where r.id in (select id from _des);

-- 4. Verificación (misma transacción).
do $$
declare v int;
begin
  select count(*) into v from _des r join public.ordenes_compra_v2 o on o.id = r.fila_id
   where r.tabla = 'ordenes_compra_v2'
     and case r.campo
           when 'costo_total' then o.costo_total is distinct from r.antes::numeric
           when 'monto_pagado_fin' then o.monto_pagado_fin is distinct from r.antes::numeric
           when 'monto_facturado' then o.monto_facturado is distinct from r.antes::numeric
           when 'monto_cobrado' then o.monto_cobrado is distinct from r.antes::numeric
           when 'estado_compra' then o.estado_compra is distinct from r.antes
           when 'estado_pago_financiamiento' then o.estado_pago_financiamiento is distinct from r.antes
           when 'estado_factura_propia' then o.estado_factura_propia is distinct from r.antes
           when 'estado_pago_cliente' then o.estado_pago_cliente is distinct from r.antes
           else true end;
  if v > 0 then raise exception 'FASE4B-SEG-DESHACER: % valor(es) no volvieron a su valor anterior', v; end if;
  select count(*) into v from _des r join public.eventos_compra e on e.id = r.fila_id
   where r.tabla = 'eventos_compra'
     and ((r.campo = 'costo_compra' and e.costo_compra is distinct from r.antes::numeric)
       or (r.campo = 'financiador_id' and e.financiador_id is distinct from r.antes));
  if v > 0 then raise exception 'FASE4B-SEG-DESHACER: % evento(s) de compra no se restauraron', v; end if;
  select count(*) into v from _des_fin_antes a join public.financiadores f on f.id = a.id where md5(to_jsonb(f)::text) <> a.huella;
  if v > 0 then raise exception 'FASE4B-SEG-DESHACER: cambiaría % financiador(es)', v; end if;
  select count(*) into v from _des_otras_antes a join public.ordenes_compra_v2 o on o.id = a.id where md5(to_jsonb(o)::text) <> a.huella;
  if v > 0 then raise exception 'FASE4B-SEG-DESHACER: cambiarían % OC(s) fuera del lote', v; end if;
  select count(*) into v from public.fin_verificar_consistencia();
  if v > 0 then raise exception 'FASE4B-SEG-DESHACER: % valor(es) guardados difieren de los calculados', v; end if;
  raise notice 'FASE4B-SEG-DESHACER: lote revertido (% registros)', (select count(*) from _des);
end $$;
