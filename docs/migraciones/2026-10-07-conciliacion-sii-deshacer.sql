-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase SII · DESHACER la conciliación histórica (lote 'sii-conciliacion-20261007'). Una sola transacción.
-- Restaura exactamente cada campo registrado en fin_correcciones_registro, elimina solo los documentos que
-- el lote creó (si nadie los modificó después), marca el lote como revertido y deja constancia en el
-- historial. Verifica que ningún cálculo de OC ni financiador cambie.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from public.fin_correcciones_registro r where r.lote = 'sii-conciliacion-20261007' and r.revertida_en is null) then
    raise exception 'SII-CONC-DESHACER: el lote no está aplicado';
  end if;
  -- Cada campo debe seguir con el valor que dejó el lote (si alguien lo cambió después, no se pisa).
  if exists (select 1 from public.fin_correcciones_registro r join public.eventos_factura f on f.id = r.fila_id
              where r.lote = 'sii-conciliacion-20261007' and r.revertida_en is null and r.campo <> '*fila_nueva*'
                and (to_jsonb(f) ->> r.campo) is distinct from r.despues) then
    raise exception 'SII-CONC-DESHACER: un documento cambió después del lote; revisar antes de deshacer';
  end if;
end $$;

create temp table _des on commit drop as
  select r.* from public.fin_correcciones_registro r where r.lote = 'sii-conciliacion-20261007' and r.revertida_en is null;
create temp table _des_calc_antes on commit drop as
  select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c;
create temp table _des_ocs on commit drop as
  select distinct f.oc_id, o.numero_oc from _des r join public.eventos_factura f on f.id = r.fila_id join public.ordenes_compra_v2 o on o.id = f.oc_id;

select set_config('bfk.importacion', 'on', true);
update public.eventos_factura f set
  numero_factura = coalesce((select r.antes from _des r where r.fila_id = f.id and r.campo = 'numero_factura'), f.numero_factura),
  origen         = coalesce((select r.antes from _des r where r.fila_id = f.id and r.campo = 'origen'), f.origen),
  verificado_sii = coalesce((select r.antes::boolean from _des r where r.fila_id = f.id and r.campo = 'verificado_sii'), f.verificado_sii),
  verificado_en  = case when exists (select 1 from _des r where r.fila_id = f.id and r.campo = 'verificado_sii') then null else f.verificado_en end,
  evidencia_sii  = case when exists (select 1 from _des r where r.fila_id = f.id and r.campo = 'evidencia_sii')
                        then (select r.antes from _des r where r.fila_id = f.id and r.campo = 'evidencia_sii') else f.evidencia_sii end,
  rut_receptor   = case when exists (select 1 from _des r where r.fila_id = f.id and r.campo = 'rut_receptor')
                        then (select r.antes from _des r where r.fila_id = f.id and r.campo = 'rut_receptor') else f.rut_receptor end
 where f.id in (select fila_id from _des where campo <> '*fila_nueva*');
delete from public.eventos_factura f where f.id in (select fila_id from _des where campo = '*fila_nueva*');
select set_config('bfk.importacion', 'off', true);
select public.fin_recalcular(array(select oc_id from _des_ocs), '{}');

update public.fin_correcciones_registro r set revertida_en = now()
 where r.lote = 'sii-conciliacion-20261007' and r.revertida_en is null;
insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
select public.fin_nuevo_id('hc'), d.oc_id, d.numero_oc, null, 'Conciliación SII', 'Conciliación SII revertida', 'documento_tributario', null, null from _des_ocs d;

do $$
begin
  if exists (select * from _des_calc_antes except select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c)
     or exists (select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c except select * from _des_calc_antes) then
    raise exception 'SII-CONC-DESHACER: cambiaría el cálculo de alguna OC. No se deshizo nada.';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'SII-CONC-DESHACER: consistencia no vacía'; end if;
  raise notice 'SII-CONC-DESHACER: lote revertido';
end $$;
