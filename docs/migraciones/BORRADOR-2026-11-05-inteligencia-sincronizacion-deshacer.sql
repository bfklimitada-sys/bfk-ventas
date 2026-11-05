-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER — Inteligencia Comercial: corrección de la sincronización (05/11/2026). Una sola transacción:
--   psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-11-05-inteligencia-sincronizacion-deshacer.sql
-- Elimina SOLO las funciones creadas por BORRADOR-2026-11-05-inteligencia-sincronizacion.sql y restaura, sin cambios,
-- ic_registrar_resultado e ic_pendientes_sincronizar del 04/11/2026 (copia exacta). No toca tablas ni datos: los
-- resultados de ChileCompra guardados se conservan. Debe ejecutarse ANTES de un eventual deshacer del módulo del 04/11
-- (ese deshacer falla mientras exista ic_proxima_consulta, que depende de ic_resultados: protección intencional).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regprocedure('public.ic_estado_sincronizacion()') is null then raise exception 'IC2: la corrección del 05/11/2026 no está instalada; no se hizo nada'; end if;
end $$;
drop function public.ic_detalle_v2(date, date, text, text, text, text, text, text, boolean, integer, integer);
drop function public.ic_resumen_v2(date, date, text, text, text, text);
drop function public.ic_estado_sincronizacion();

-- Versión original (04/11/2026) de ic_registrar_resultado
create or replace function public.ic_registrar_resultado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cod text := upper(btrim(coalesce(p->>'codigo', ''))); v_ce text := coalesce(p->>'consulta_estado', 'ok');
  ant public.ic_resultados%rowtype; v_existe boolean; v_det boolean := coalesce((p->>'detalle_consultado')::boolean, false);
  v_ep text := coalesce(p->>'estado_proceso', 'sin_informacion'); v_res text := coalesce(p->>'resultado', 'sin_informacion');
  v_conservar boolean; v_prox timestamptz; v_fuente text := coalesce(nullif(p->>'fuente', ''), 'API Compra Ágil v2 (ChileCompra)');
  n numeric;
begin
  if not public.bfk_es_admin() then raise exception 'IC403: solo un administrador de BFK puede sincronizar resultados' using errcode = '42501'; end if;
  if v_cod !~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$' then raise exception 'IC400: código de Compra Ágil inválido' using errcode = '22023'; end if;
  if not exists (select 1 from public.cotizaciones c where upper(btrim(c.id_externo)) = v_cod and c.estado in ('presentada','adjudicada','no_adjudicada')) then
    raise exception 'IC404: el código % no corresponde a una cotización BFK presentada', v_cod using errcode = '22023'; end if;
  if v_ce not in ('ok','error','limite','no_encontrada') or v_ep not in ('publicada','cerrada','proveedor_seleccionado','oc_emitida','desierta','cancelada','no_encontrada','sin_informacion')
     or v_res not in ('pendiente','ganada','perdida','desierta','cancelada','sin_informacion','sin_oferta_bfk') then raise exception 'IC400: valores fuera de rango' using errcode = '22023'; end if;
  foreach n in array array[(p->>'monto_neto')::numeric, (p->>'monto_impuesto')::numeric, (p->>'monto_despacho')::numeric, (p->>'monto_total')::numeric,
                           (p->>'bfk_monto_neto')::numeric, (p->>'bfk_monto_total')::numeric, (p->>'total_ofertas')::numeric] loop
    if n is not null and n < 0 then raise exception 'IC400: montos negativos' using errcode = '22023'; end if;
  end loop;
  select * into ant from public.ic_resultados where codigo = v_cod for update;
  v_existe := found;

  if v_ce <> 'ok' then   -- intento fallido: se conserva lo verificado
    v_prox := now() + least(interval '24 hours', interval '15 minutes' * power(2, least(coalesce(ant.intentos, 0), 7)));
    if v_ce = 'limite' then v_prox := greatest(v_prox, now() + interval '1 hour'); end if;
    if v_existe then
      update public.ic_resultados set consultado_en = now(), consulta_estado = v_ce, consulta_error = left(p->>'consulta_error', 300),
        intentos = intentos + 1, proximo_intento = case when ant.proximo_intento is null and ant.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then null else v_prox end,
        estado_proceso = case when v_ce = 'no_encontrada' and ant.verificado_en is null then 'no_encontrada' else estado_proceso end
      where codigo = v_cod;
    else
      insert into public.ic_resultados (codigo, estado_proceso, resultado, fuente, consulta_estado, consulta_error, intentos, proximo_intento)
      values (v_cod, case when v_ce = 'no_encontrada' then 'no_encontrada' else 'sin_informacion' end, 'sin_informacion', v_fuente, v_ce, left(p->>'consulta_error', 300), 1, v_prox);
    end if;
    return jsonb_build_object('codigo', v_cod, 'resultado', coalesce(ant.resultado, 'sin_informacion'), 'cambio', false, 'consulta_estado', v_ce);
  end if;

  -- Consulta exitosa. Sin detalle y con el proceso en el mismo estado: se conserva lo ya verificado con detalle.
  v_conservar := v_existe and not v_det and ant.detalle_consultado and ant.estado_proceso = v_ep;
  v_prox := case
    when v_conservar and ant.resultado in ('ganada','perdida','sin_oferta_bfk') then null
    when v_res in ('ganada','perdida','sin_oferta_bfk','desierta','cancelada') then null
    when v_res = 'pendiente' then now() + interval '6 hours'
    else now() + least(interval '24 hours', interval '30 minutes' * power(2, least(coalesce(ant.intentos, 0), 6))) end;   -- seleccionado sin detalle: reintentar
  insert into public.ic_resultados as r (codigo, estado_proceso, resultado, total_ofertas, bfk_oferto, bfk_monto_neto, bfk_monto_total, adjudicatario_rut, adjudicatario_nombre,
      monto_neto, monto_impuesto, monto_despacho, monto_total, moneda, impuesto_nombre, impuesto_pct, base_tributaria, id_orden_compra, fecha_resultado, fecha_resultado_fuente,
      motivo, fuente, detalle_consultado, consultado_en, verificado_en, consulta_estado, consulta_error, intentos, proximo_intento, registrado_por)
  values (v_cod, v_ep, v_res, (p->>'total_ofertas')::integer, (p->>'bfk_oferto')::boolean, (p->>'bfk_monto_neto')::numeric, (p->>'bfk_monto_total')::numeric,
      nullif(btrim(p->>'adjudicatario_rut'), ''), nullif(btrim(p->>'adjudicatario_nombre'), ''), (p->>'monto_neto')::numeric, (p->>'monto_impuesto')::numeric,
      (p->>'monto_despacho')::numeric, (p->>'monto_total')::numeric, nullif(upper(btrim(p->>'moneda')), ''), nullif(p->>'impuesto_nombre', ''), (p->>'impuesto_pct')::numeric,
      coalesce(nullif(p->>'base_tributaria', ''), 'desconocida'), (p->>'id_orden_compra')::bigint, nullif(p->>'fecha_resultado', '')::timestamptz, nullif(p->>'fecha_resultado_fuente', ''),
      left(nullif(p->>'motivo', ''), 500), v_fuente, v_det, now(), now(), 'ok', left(nullif(p->>'consulta_error', ''), 300),
      case when v_res = 'sin_informacion' then 1 else 0 end, v_prox, auth.uid())
  on conflict (codigo) do update set
    estado_proceso = excluded.estado_proceso, total_ofertas = coalesce(excluded.total_ofertas, r.total_ofertas),
    resultado = case when v_conservar then r.resultado else excluded.resultado end,
    bfk_oferto = case when v_conservar then r.bfk_oferto else excluded.bfk_oferto end,
    bfk_monto_neto = case when v_conservar then r.bfk_monto_neto else excluded.bfk_monto_neto end,
    bfk_monto_total = case when v_conservar then r.bfk_monto_total else excluded.bfk_monto_total end,
    adjudicatario_rut = case when v_conservar then r.adjudicatario_rut else excluded.adjudicatario_rut end,
    adjudicatario_nombre = case when v_conservar then r.adjudicatario_nombre else excluded.adjudicatario_nombre end,
    monto_neto = case when v_conservar then r.monto_neto else excluded.monto_neto end, monto_impuesto = case when v_conservar then r.monto_impuesto else excluded.monto_impuesto end,
    monto_despacho = case when v_conservar then r.monto_despacho else excluded.monto_despacho end, monto_total = case when v_conservar then r.monto_total else excluded.monto_total end,
    moneda = coalesce(excluded.moneda, r.moneda), impuesto_nombre = case when v_conservar then r.impuesto_nombre else excluded.impuesto_nombre end,
    impuesto_pct = case when v_conservar then r.impuesto_pct else excluded.impuesto_pct end, base_tributaria = case when v_conservar then r.base_tributaria else excluded.base_tributaria end,
    id_orden_compra = coalesce(excluded.id_orden_compra, r.id_orden_compra), fecha_resultado = coalesce(excluded.fecha_resultado, r.fecha_resultado),
    fecha_resultado_fuente = coalesce(excluded.fecha_resultado_fuente, r.fecha_resultado_fuente), motivo = coalesce(excluded.motivo, r.motivo),
    fuente = case when v_conservar then r.fuente else excluded.fuente end, detalle_consultado = r.detalle_consultado and v_conservar or excluded.detalle_consultado,
    consultado_en = now(), verificado_en = now(), consulta_estado = 'ok', consulta_error = excluded.consulta_error,
    intentos = case when v_conservar or v_res <> 'sin_informacion' then 0 else r.intentos + 1 end, proximo_intento = v_prox, registrado_por = auth.uid();
  return jsonb_build_object('codigo', v_cod, 'resultado', (select resultado from public.ic_resultados where codigo = v_cod),
    'cambio', not v_existe or ant.resultado is distinct from (select resultado from public.ic_resultados where codigo = v_cod), 'consulta_estado', 'ok');
end $$;

-- Versión original (04/11/2026) de ic_pendientes_sincronizar
create or replace function public.ic_pendientes_sincronizar(p_limite integer default 40, p_forzar boolean default false)
returns table (codigo text, resultado text, detalle_consultado boolean, intentos integer, consultado_en timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.bfk_es_admin() then raise exception 'IC403: solo un administrador de BFK puede sincronizar resultados' using errcode = '42501'; end if;
  return query
    select k.cod, r.resultado, r.detalle_consultado, r.intentos, r.consultado_en
    from (select distinct upper(btrim(c.id_externo)) as cod from public.cotizaciones c
          where c.estado in ('presentada','adjudicada','no_adjudicada') and upper(btrim(c.id_externo)) ~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$') k
    left join public.ic_resultados r on r.codigo = k.cod
    where p_forzar or r.codigo is null or (r.proximo_intento is not null and r.proximo_intento <= now())
    order by r.consultado_en asc nulls first, k.cod
    limit greatest(1, least(coalesce(p_limite, 40), 100));
end $$;

drop function public.ic_proxima_consulta(public.ic_resultados);
