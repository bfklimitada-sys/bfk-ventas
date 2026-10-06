-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase 4B · DESHACER integridad financiera (2026-10-06). Una sola transacción.
-- Devuelve la base al estado anterior: quita disparadores, funciones y la tabla de diferencias,
-- restaura registrar_pago_financiador EXACTAMENTE como estaba en producción y el chk_estados original.
-- Los montos derivados quedan con su último valor (calculado desde los eventos) y la versión anterior de la
-- aplicación vuelve a escribirlos. Única escritura de datos: un estado 'no_aplica' (solo pudo crearse después
-- de aplicar la migración) vuelve a 'pendiente', que era el estado de esas OCs con la regla anterior.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('public.fin_diferencias_historicas') is null then raise exception 'FASE4B: la migración no está aplicada'; end if;
end $$;

drop trigger if exists fin_proteger_derivados on public.ordenes_compra_v2;
drop trigger if exists fin_bloqueo_financiamiento on public.ordenes_compra_v2;
drop trigger if exists fin_recalcular_financiamiento on public.ordenes_compra_v2;
drop trigger if exists fin_proteger_saldo on public.financiadores;
drop trigger if exists fin_bloqueo_tipo on public.financiadores;
drop trigger if exists fin_recalcular_tipo on public.financiadores;
drop trigger if exists fin_bloqueo on public.eventos_compra;
drop trigger if exists fin_recalcular on public.eventos_compra;
drop trigger if exists fin_bloqueo on public.eventos_pago_financiamiento;
drop trigger if exists fin_recalcular on public.eventos_pago_financiamiento;
drop trigger if exists fin_bloqueo on public.ajustes_saldo_financiador;
drop trigger if exists fin_recalcular on public.ajustes_saldo_financiador;
drop trigger if exists fin_bloqueo on public.eventos_factura;
drop trigger if exists fin_recalcular on public.eventos_factura;
drop trigger if exists fin_bloqueo on public.eventos_pago_cliente;
drop trigger if exists fin_recalcular on public.eventos_pago_cliente;


drop function if exists public.registrar_compra_oc(text, date, numeric, text, text, date, numeric, text);
drop function if exists public.editar_compra_oc(text, date, numeric, numeric, date, text);
drop function if exists public.eliminar_compra_oc(text);
drop function if exists public.editar_pago_financiador(text, date, numeric);
drop function if exists public.eliminar_pago_financiador(text);
drop function if exists public.cambiar_financiamiento_oc(text, text, text);
drop function if exists public.fin_verificar_consistencia();
drop function if exists public.fin_resumen_oc(text);
drop function if exists public.fin_pesos(numeric);
drop function if exists public.fin_historial(text, text, text, text, text);
drop function if exists public.fin_nuevo_id(text);
drop function if exists public.fin_trg_bloqueo_financiador();
drop function if exists public.fin_trg_financiador_tipo();
drop function if exists public.fin_trg_bloqueo_oc();
drop function if exists public.fin_trg_oc_financiamiento();
drop function if exists public.fin_trg_recalcular_eventos();
drop function if exists public.fin_trg_bloqueo_eventos();
drop function if exists public.fin_trg_proteger_financiador();
drop function if exists public.fin_trg_proteger_oc();
drop function if exists public.fin_exigir_sin_bloqueo(text, text);
drop function if exists public.fin_fila_bloqueada(text, text);
drop function if exists public.fin_motivo_bloqueo(text, text);
drop function if exists public.fin_recalcular(text[], text[]);
drop function if exists public.fin_recalcular_financiador(text);
drop function if exists public.fin_recalcular_oc(text);
drop function if exists public.fin_calculo_financiador(text, boolean, boolean);
drop function if exists public.fin_calculo_oc(text, boolean);
drop function if exists public.fin_facturas_vigentes(text);
drop function if exists public.fin_tipo_financiamiento(text);
drop function if exists public.fin_dif_estado(text, text);
drop function if exists public.fin_dif_monto(text, text, text);
drop function if exists public.fin_es_cliente();
drop function if exists public.fin_es_importacion();

-- registrar_pago_financiador: versión de producción anterior a la Fase 4B (idéntica, carácter por carácter).
create or replace function public.registrar_pago_financiador(p_financiador_id text, p_fecha date, p_monto numeric, p_asignaciones jsonb DEFAULT '[]'::jsonb, p_origen text DEFAULT 'manual'::text) RETURNS jsonb
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $_$
declare
  v_uid uuid := auth.uid();
  v_fin public.financiadores%rowtype;
  v_oc public.ordenes_compra_v2%rowtype;
  v_asig jsonb; v_usuario text;
  v_asignado numeric; v_total_asignado numeric := 0; v_sobrante numeric;
  v_debe numeric; v_pagado_antes numeric; v_nuevo_pagado numeric;
  v_completa boolean; v_n_oc int := 0; v_n_completas int := 0; v_ids text[] := '{}';
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor que cero'; end if;
  if p_fecha is null then raise exception 'Falta la fecha del pago'; end if;
  select * into v_fin from public.financiadores where id = p_financiador_id for update;
  if not found then raise exception 'El financiador % no existe', p_financiador_id; end if;
  select nombre into v_usuario from public.perfiles where id = v_uid;

  for v_asig in select * from jsonb_array_elements(coalesce(p_asignaciones,'[]'::jsonb)) loop
    v_asignado := (v_asig->>'monto')::numeric;
    if v_asignado is null or v_asignado <= 0 then raise exception 'Asignación con monto inválido'; end if;
    if v_asig->>'oc_id' = any(v_ids) then raise exception 'La OC % está repetida en las asignaciones', v_asig->>'oc_id'; end if;
    select * into v_oc from public.ordenes_compra_v2 where id = v_asig->>'oc_id' for update;
    if not found then raise exception 'La OC % no existe', v_asig->>'oc_id'; end if;
    if v_oc.financiador_id is distinct from p_financiador_id then
      raise exception 'La OC % no pertenece a este financiador', v_oc.numero_oc; end if;
    if coalesce(v_oc.estado_pago_financiamiento,'pendiente') = 'pagado' then
      raise exception 'La OC % ya figura con el financiamiento pagado', v_oc.numero_oc; end if;
    v_pagado_antes := coalesce(v_oc.monto_pagado_fin,0);
    v_debe := greatest(0, coalesce(v_oc.costo_total,0) - v_pagado_antes);
    if v_asignado > v_debe then
      raise exception 'La asignación a la OC % (%) supera lo que se adeuda (%)', v_oc.numero_oc, v_asignado, v_debe; end if;
    v_nuevo_pagado := v_pagado_antes + v_asignado;
    v_completa := v_asignado >= v_debe;
    v_total_asignado := v_total_asignado + v_asignado;
    v_ids := v_ids || v_oc.id; v_n_oc := v_n_oc + 1;
    if v_completa then v_n_completas := v_n_completas + 1; end if;

    insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto, creado_por)
    values ('evpf_'||(extract(epoch from clock_timestamp())*1000)::bigint||'_'||substr(md5(random()::text),1,5),
            p_financiador_id, v_oc.id, p_fecha, v_asignado, v_uid);
    update public.ordenes_compra_v2
       set monto_pagado_fin = v_nuevo_pagado,
           estado_pago_financiamiento = case when v_completa then 'pagado' else 'parcial' end
     where id = v_oc.id;
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
    values ('hc_'||(extract(epoch from clock_timestamp())*1000)::bigint||'_'||substr(md5(random()::text),1,5),
            v_oc.id, v_oc.numero_oc, v_uid, v_usuario,
            case when v_completa then 'Financiamiento saldado (abono a '||v_fin.nombre||')'
                 else 'Abono parcial de financiamiento ($'||v_asignado::bigint||')' end,
            'monto_pagado_fin', v_pagado_antes::text, v_nuevo_pagado::text);
  end loop;

  if v_total_asignado > p_monto then
    raise exception 'Las asignaciones (%) superan el monto del pago (%)', v_total_asignado, p_monto; end if;
  v_sobrante := p_monto - v_total_asignado;
  if v_sobrante > 0 then
    insert into public.eventos_pago_financiamiento (id, financiador_id, oc_id, fecha, monto, creado_por)
    values ('evpf_'||(extract(epoch from clock_timestamp())*1000)::bigint||'_'||substr(md5(random()::text),1,5),
            p_financiador_id, null, p_fecha, v_sobrante, v_uid);
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_nuevo)
    values ('hc_'||(extract(epoch from clock_timestamp())*1000)::bigint||'_'||substr(md5(random()::text),1,5),
            null, null, v_uid, v_usuario, 'Pago a financiador sin OC asignada', 'financiamiento',
            v_fin.nombre||' · $'||v_sobrante::bigint);
  end if;

  update public.financiadores
     set saldo_deuda = greatest(0, coalesce(saldo_deuda,0) - p_monto)
   where id = p_financiador_id;

  return jsonb_build_object('ok',true,'ocs',v_n_oc,'completas',v_n_completas,
                            'asignado',v_total_asignado,'sobrante',v_sobrante,'origen',p_origen);
end; $_$;

revoke all on function public.registrar_pago_financiador(text, date, numeric, jsonb, text) from public, anon;
grant execute on function public.registrar_pago_financiador(text, date, numeric, jsonb, text) to authenticated;

update public.ordenes_compra_v2 set estado_pago_financiamiento = 'pendiente' where estado_pago_financiamiento = 'no_aplica';
alter table public.ordenes_compra_v2 drop constraint chk_estados;
alter table public.ordenes_compra_v2 add constraint chk_estados check (
      coalesce(estado_compra, 'pendiente') = any (array['pendiente', 'comprado'])
  and coalesce(estado_entrega, 'pendiente') = any (array['pendiente', 'confirmada', 'entregado'])
  and coalesce(estado_factura_propia, 'pendiente') = any (array['pendiente', 'emitida'])
  and coalesce(estado_pago_cliente, 'pendiente') = any (array['pendiente', 'parcial', 'pagado'])
  and coalesce(estado_pago_financiamiento, 'pendiente') = any (array['pendiente', 'parcial', 'pagado']));

drop table if exists public.fin_diferencias_historicas;
alter table public.financiadores drop constraint if exists financiadores_tipo_chk;
alter table public.financiadores drop column if exists tipo;

drop index if exists public.idx_eventos_compra_oc;
drop index if exists public.idx_eventos_pagofin_oc;
drop index if exists public.idx_eventos_pagofin_fin;
drop index if exists public.idx_eventos_factura_oc;
drop index if exists public.idx_eventos_pagocli_oc;
drop index if exists public.idx_ajustes_fin;
drop index if exists public.idx_oc_v2_financiador;

notify pgrst, 'reload schema';
