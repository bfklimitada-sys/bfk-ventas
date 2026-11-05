-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Inteligencia Comercial: corrección de la sincronización y criterio de fecha (05/11/2026). NO APLICADO.
-- Requiere autorización expresa de Kevin para ejecutarse en producción.
-- Una sola transacción:  psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-11-05-inteligencia-sincronizacion.sql
-- Deshacer:              BORRADOR-2026-11-05-inteligencia-sincronizacion-deshacer.sql (restaura las funciones originales)
--
-- SOLO FUNCIONES. No crea ni modifica tablas, vistas, columnas, políticas, índices ni datos: ninguna fila existente se
-- actualiza o elimina (tampoco en ic_resultados). Cotizaciones, OCs y todo lo financiero quedan intactos.
--   Reemplaza (mismo nombre, parámetros y resultado):
--     ic_registrar_resultado(jsonb) ... esperas de reintento más cortas para fallas temporales (B):
--         · detalle no pedido por falta de tiempo en la llamada → disponible de inmediato (sin contar intento)
--         · detalle con 429, demora o error → 1, 2, 4 … min (máx. 1 h)   [antes 30 min × 2ⁿ, máx. 24 h]
--         · listado con error → 2, 4, 8 … min (máx. 4 h) · listado con 429 → 1, 2, 4 … min (máx. 1 h) [antes ≥ 1 h]
--         · sin cambios: pendientes cada 6 h, finales no se repiten, «no encontrada» como antes.
--     ic_pendientes_sincronizar(integer, boolean) ... primero los «por verificar» (proveedor seleccionado sin ganador
--         confirmado), luego los nunca consultados (los presentados hace más tiempo primero), luego el resto. Los
--         resultados ya guardados con la espera antigua quedan disponibles según la espera nueva (sin modificarlos).
--   Crea:
--     ic_proxima_consulta(ic_resultados) ... cuándo corresponde volver a consultar un código (regla única).
--     ic_estado_sincronizacion() ........... conteos de la cola para informar el avance real (solo administradores).
--     ic_resumen_v2(..., p_criterio) / ic_detalle_v2(..., p_criterio, ...) ... iguales a ic_resumen / ic_detalle más el
--         criterio de fecha: 'presentacion' (igual que hoy) o 'adjudicacion' (fecha informada por ChileCompra; solo
--         oportunidades con resultado y fecha). Indicadores de cobertura y avisos separados. ic_resumen / ic_detalle
--         originales NO se modifican (la versión anterior de la app sigue funcionando durante la publicación).
-- Lógica igual a src/lib/inteligenciaComercial.js (comprobado por docs/pruebas-inteligencia/validar_sql_sincronizacion.sh).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.ic_resultados') is null or to_regprocedure('public.ic_registrar_resultado(jsonb)') is null
     or to_regprocedure('public.ic_pendientes_sincronizar(integer,boolean)') is null or to_regclass('public.ic_oportunidades') is null then
    raise exception 'IC2: falta el módulo Inteligencia Comercial (04/11/2026); no se aplicó nada'; end if;
  if to_regprocedure('public.ic_estado_sincronizacion()') is not null or to_regprocedure('public.ic_resumen_v2(date,date,text,text,text,text)') is not null then
    raise exception 'IC2: la corrección del 05/11/2026 ya está instalada; no se aplicó nada'; end if;
end $pre$;

-- ── Regla única de reintento: cuándo vuelve a consultarse un código ya guardado (null = no se repite salvo «forzar»).
-- Usa la espera NUEVA aunque la fila se haya guardado con la antigua (sin modificar la fila): la más próxima de ambas.
create function public.ic_proxima_consulta(r public.ic_resultados) returns timestamptz
language sql stable set search_path = '' as $$
  select case
    when r.proximo_intento is null then null
    else least(r.proximo_intento, r.consultado_en + case
      when r.consulta_estado = 'error' then least(interval '4 hours', interval '2 minutes' * power(2, least(greatest(r.intentos - 1, 0), 7)))
      when r.consulta_estado = 'limite' then least(interval '1 hour', interval '1 minute' * power(2, least(greatest(r.intentos - 1, 0), 6)))
      when r.consulta_estado = 'ok' and r.resultado = 'sin_informacion' and r.estado_proceso in ('proveedor_seleccionado','oc_emitida') then
        case when coalesce(r.consulta_error, '') ilike '%sin tiempo%' then interval '0'
             else least(interval '1 hour', interval '1 minute' * power(2, least(greatest(r.intentos - 1, 0), 6))) end
      else r.proximo_intento - r.consultado_en end)
  end
$$;

-- ── Escritura del resultado (misma firma). Cambia SOLO el cálculo de proximo_intento e intentos (ver encabezado).
create or replace function public.ic_registrar_resultado(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_cod text := upper(btrim(coalesce(p->>'codigo', ''))); v_ce text := coalesce(p->>'consulta_estado', 'ok');
  ant public.ic_resultados%rowtype; v_existe boolean; v_det boolean := coalesce((p->>'detalle_consultado')::boolean, false);
  v_ep text := coalesce(p->>'estado_proceso', 'sin_informacion'); v_res text := coalesce(p->>'resultado', 'sin_informacion');
  v_conservar boolean; v_prox timestamptz; v_fuente text := coalesce(nullif(p->>'fuente', ''), 'API Compra Ágil v2 (ChileCompra)');
  v_motivo text := coalesce(nullif(p->>'reintento_detalle', ''), case when coalesce(p->>'consulta_error', '') ilike '%sin tiempo%' then 'sin_tiempo' end, 'error');
  v_n integer; n numeric;
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
  v_existe := found; v_n := coalesce(ant.intentos, 0);

  if v_ce <> 'ok' then   -- intento fallido: se conserva lo verificado
    v_prox := now() + case v_ce
      when 'error' then least(interval '4 hours', interval '2 minutes' * power(2, least(v_n, 7)))
      when 'limite' then least(interval '1 hour', interval '1 minute' * power(2, least(v_n, 6)))
      else least(interval '24 hours', interval '15 minutes' * power(2, least(v_n, 7))) end;   -- no_encontrada: como antes
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
    when v_motivo = 'sin_tiempo' then now()                                                       -- detalle no pedido: de inmediato
    else now() + least(interval '1 hour', interval '1 minute' * power(2, least(v_n, 6))) end;     -- detalle fallido: 1, 2, 4 … min
  insert into public.ic_resultados as r (codigo, estado_proceso, resultado, total_ofertas, bfk_oferto, bfk_monto_neto, bfk_monto_total, adjudicatario_rut, adjudicatario_nombre,
      monto_neto, monto_impuesto, monto_despacho, monto_total, moneda, impuesto_nombre, impuesto_pct, base_tributaria, id_orden_compra, fecha_resultado, fecha_resultado_fuente,
      motivo, fuente, detalle_consultado, consultado_en, verificado_en, consulta_estado, consulta_error, intentos, proximo_intento, registrado_por)
  values (v_cod, v_ep, v_res, (p->>'total_ofertas')::integer, (p->>'bfk_oferto')::boolean, (p->>'bfk_monto_neto')::numeric, (p->>'bfk_monto_total')::numeric,
      nullif(btrim(p->>'adjudicatario_rut'), ''), nullif(btrim(p->>'adjudicatario_nombre'), ''), (p->>'monto_neto')::numeric, (p->>'monto_impuesto')::numeric,
      (p->>'monto_despacho')::numeric, (p->>'monto_total')::numeric, nullif(upper(btrim(p->>'moneda')), ''), nullif(p->>'impuesto_nombre', ''), (p->>'impuesto_pct')::numeric,
      coalesce(nullif(p->>'base_tributaria', ''), 'desconocida'), (p->>'id_orden_compra')::bigint, nullif(p->>'fecha_resultado', '')::timestamptz, nullif(p->>'fecha_resultado_fuente', ''),
      left(nullif(p->>'motivo', ''), 500), v_fuente, v_det, now(), now(), 'ok', left(nullif(p->>'consulta_error', ''), 300),
      case when v_res = 'sin_informacion' and v_motivo <> 'sin_tiempo' then 1 else 0 end, v_prox, auth.uid())
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
    intentos = case when v_conservar or v_res <> 'sin_informacion' then 0 when v_motivo = 'sin_tiempo' then r.intentos else r.intentos + 1 end,
    proximo_intento = v_prox, registrado_por = auth.uid();
  return jsonb_build_object('codigo', v_cod, 'resultado', (select resultado from public.ic_resultados where codigo = v_cod),
    'cambio', not v_existe or ant.resultado is distinct from (select resultado from public.ic_resultados where codigo = v_cod), 'consulta_estado', 'ok');
end $$;

-- ── Códigos por sincronizar (misma firma y columnas). Prioridad: 1) por verificar; 2) nunca consultados, los
-- presentados hace más tiempo primero; 3) el resto por última consulta. p_forzar: todos (actualización completa).
create or replace function public.ic_pendientes_sincronizar(p_limite integer default 40, p_forzar boolean default false)
returns table (codigo text, resultado text, detalle_consultado boolean, intentos integer, consultado_en timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not public.bfk_es_admin() then raise exception 'IC403: solo un administrador de BFK puede sincronizar resultados' using errcode = '42501'; end if;
  return query
    select k.cod, r.resultado, r.detalle_consultado, r.intentos, r.consultado_en
    from (select upper(btrim(c.id_externo)) as cod, min(c.fecha) as fecha from public.cotizaciones c
          where c.estado in ('presentada','adjudicada','no_adjudicada') and upper(btrim(c.id_externo)) ~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$'
          group by upper(btrim(c.id_externo))) k
    left join public.ic_resultados r on r.codigo = k.cod
    where p_forzar or r.codigo is null or public.ic_proxima_consulta(r) <= now()
    order by case when r.resultado = 'sin_informacion' and r.estado_proceso in ('proveedor_seleccionado','oc_emitida') then 0 when r.codigo is null then 1 else 2 end,
             case when r.codigo is null then k.fecha end asc nulls last, r.consultado_en asc nulls first, k.cod
    limit greatest(1, least(coalesce(p_limite, 40), 100));
end $$;

-- ── Estado de la cola (avance real): una fila por código de Compra Ágil presentado. Solo administradores.
create function public.ic_estado_sincronizacion() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.bfk_es_admin() then raise exception 'IC403: solo un administrador de BFK puede sincronizar resultados' using errcode = '42501'; end if;
  with k as (select distinct upper(btrim(c.id_externo)) as cod from public.cotizaciones c
             where c.estado in ('presentada','adjudicada','no_adjudicada') and upper(btrim(c.id_externo)) ~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$'),
  j as (select k.cod, r.codigo as rc, r.resultado, r.estado_proceso, r.consulta_estado, public.ic_proxima_consulta(r) as prox
        from k left join public.ic_resultados r on r.codigo = k.cod)
  select jsonb_build_object(
    'total', count(*),
    'sin_consultar', count(*) filter (where rc is null),
    'por_verificar', count(*) filter (where resultado = 'sin_informacion' and estado_proceso in ('proveedor_seleccionado','oc_emitida')),
    'en_proceso', count(*) filter (where resultado = 'pendiente'),
    'finales', count(*) filter (where resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk')),
    'ganadas', count(*) filter (where resultado = 'ganada'),
    'con_error', count(*) filter (where rc is not null and consulta_estado <> 'ok' and resultado not in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk')),
    'elegibles_ahora', count(*) filter (where rc is null or prox <= now()),
    'proximo_reintento', min(prox) filter (where prox > now()))
  into v from j;
  return v;
end $$;

-- ── Resumen con criterio de fecha. Igual a ic_resumen (sin cambios en sus reglas) más: criterio, cobertura y avisos
-- separados. 'adjudicacion': fecha informada por ChileCompra (fecha calendario guardada, UTC) y solo resultados finales.
create function public.ic_resumen_v2(p_desde date default null, p_hasta date default null, p_institucion text default '', p_vendedor text default '', p_resultado text default '',
  p_criterio text default 'presentacion')
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb; v_adj boolean := coalesce(p_criterio, '') = 'adjudicacion';
begin
  if not public.bfk_es_usuario() then raise exception 'IC403: esta cuenta no tiene un perfil BFK autorizado' using errcode = '42501'; end if;
  with b as (
    select o.*, x.fecha_adjudicacion, case when v_adj then x.fecha_adjudicacion else o.fecha_presentacion end as fecha_criterio
    from public.ic_oportunidades o
    cross join lateral (select case when o.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then (o.fecha_resultado at time zone 'UTC')::date end as fecha_adjudicacion) x
    where (coalesce(btrim(p_institucion), '') = '' or strpos(public.cz_clave_nombre(o.institucion), public.cz_clave_nombre(p_institucion)) > 0)
      and (coalesce(p_vendedor, '') = '' or (p_vendedor = '__sin__' and o.vendedor_nombre is null)
           or public.cz_clave_nombre(o.vendedor_nombre) = public.cz_clave_nombre(p_vendedor))
      and (coalesce(p_resultado, '') = '' or o.resultado = p_resultado)
  ), f as (
    select * from b where (not v_adj or fecha_adjudicacion is not null) and (p_desde is null or fecha_criterio >= p_desde) and (p_hasta is null or fecha_criterio <= p_hasta)
  ), pres as (select * from f where resultado <> 'sin_oferta_bfk'),
  comp as (select * from f where comparable),
  ind as (
    select jsonb_build_object(
      'presentadas', (select count(*) from pres),
      'monto_ofertado_neto', (select coalesce(sum(oferta_neto), 0) from pres), 'monto_ofertado_impuesto', (select coalesce(sum(oferta_impuesto), 0) from pres),
      'monto_ofertado_total', (select coalesce(sum(oferta_total), 0) from pres),
      'ganadas', (select count(*) from f where resultado = 'ganada'),
      'monto_ganado_neto', (select coalesce(sum(oferta_neto), 0) from f where resultado = 'ganada'), 'monto_ganado_total', (select coalesce(sum(oferta_total), 0) from f where resultado = 'ganada'),
      'perdidas', (select count(*) from f where resultado = 'perdida'), 'pendientes', (select count(*) from f where resultado = 'pendiente'),
      'pendientes_por_verificar', (select count(*) from f where resultado = 'pendiente' and verificacion = 'por_verificar'),
      'desiertas', (select count(*) from f where resultado = 'desierta'), 'canceladas', (select count(*) from f where resultado = 'cancelada'),
      'sin_oferta_bfk', (select count(*) from f where resultado = 'sin_oferta_bfk'),
      'tasa_exito', (select case when count(*) filter (where resultado in ('ganada','perdida')) > 0
                       then round(count(*) filter (where resultado = 'ganada')::numeric * 100 / count(*) filter (where resultado in ('ganada','perdida')), 1) end from f),
      'comparables', (select count(*) from comp), 'comparables_ofertado_total', (select coalesce(sum(oferta_total), 0) from comp),
      'comparables_adjudicado_total', (select coalesce(sum(adjudicado_total), 0) from comp),
      'diferencia_total', (select sum(diferencia) from comp),
      'diferencia_pct_ponderada', (select case when count(*) > 0 and sum(adjudicado_total) > 0 then round(sum(diferencia) / sum(adjudicado_total) * 100, 1) end from comp),
      'diferencia_pct_mediana', (select round((percentile_cont(0.5) within group (order by diferencia_pct))::numeric, 1) from comp),
      'perdidas_sin_adjudicatario', (select count(*) from f where resultado = 'perdida' and adjudicatario_rut is null),
      'avisos', (select count(*) from f where aviso is not null),
      'sin_consultar', (select count(*) from f where resultado = 'pendiente' and verificacion = 'sin_consultar'),
      'en_proceso', (select count(*) from f where resultado = 'pendiente' and verificacion = 'en_proceso'),
      'ganadas_sin_regularizar', (select count(*) from f where estado_cotizacion = 'presentada' and resultado = 'ganada' and coalesce(resultado_externo, '') = 'ganada'),
      'otros_avisos', (select count(*) from f where aviso is not null and not (estado_cotizacion = 'presentada' and coalesce(resultado_externo, '') = 'ganada')),
      'criterio', case when v_adj then 'adjudicacion' else 'presentacion' end,
      'sin_fecha_adjudicacion', case when v_adj then (select count(*) from b where resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') and fecha_adjudicacion is null) else 0 end) as j
  ), meses as (
    select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'presentadas', m.presentadas, 'ganadas', m.ganadas, 'perdidas', m.perdidas, 'pendientes', m.pendientes,
      'otras', m.otras, 'ofertado_neto', m.ofertado_neto, 'ganado_neto', m.ganado_neto, 'comp_ofertado_total', m.cot, 'comp_adjudicado_total', m.cat, 'comparables', m.nc) order by m.mes), '[]'::jsonb) as j
    from (select to_char(fecha_criterio, 'YYYY-MM') as mes,
            count(*) filter (where resultado <> 'sin_oferta_bfk') as presentadas, count(*) filter (where resultado = 'ganada') as ganadas,
            count(*) filter (where resultado = 'perdida') as perdidas, count(*) filter (where resultado = 'pendiente') as pendientes,
            count(*) filter (where resultado in ('desierta','cancelada')) as otras,
            coalesce(sum(oferta_neto) filter (where resultado <> 'sin_oferta_bfk'), 0) as ofertado_neto, coalesce(sum(oferta_neto) filter (where resultado = 'ganada'), 0) as ganado_neto,
            coalesce(sum(oferta_total) filter (where comparable), 0) as cot, coalesce(sum(adjudicado_total) filter (where comparable), 0) as cat, count(*) filter (where comparable) as nc
          from f where fecha_criterio is not null group by 1) m
  ), comps as (
    select coalesce(jsonb_agg(jsonb_build_object('rut', c.rut, 'nombre', c.nombre, 'n', c.n, 'monto_total', c.monto) order by c.n desc, c.monto desc, c.k), '[]'::jsonb) as j
    from (select public.ic_rut_norm(adjudicatario_rut) as k, (array_agg(adjudicatario_rut order by fecha_presentacion desc nulls last, clave))[1] as rut,
            coalesce((array_agg(adjudicatario_nombre order by fecha_presentacion desc nulls last, clave) filter (where adjudicatario_nombre is not null))[1], 'Información no disponible') as nombre,
            count(*) as n, coalesce(sum(adjudicado_total), 0) as monto
          from f where resultado = 'perdida' and adjudicatario_rut is not null group by public.ic_rut_norm(adjudicatario_rut)
          order by count(*) desc, coalesce(sum(adjudicado_total), 0) desc, public.ic_rut_norm(adjudicatario_rut) limit 10) c
  ), dist as (
    select coalesce(jsonb_agg(jsonb_build_object('resultado', d.resultado, 'n', d.n) order by d.o), '[]'::jsonb) as j
    from (select r.resultado, r.o, (select count(*) from f where f.resultado = r.resultado) as n
          from (values ('ganada', 1), ('perdida', 2), ('pendiente', 3), ('desierta', 4), ('cancelada', 5), ('sin_oferta_bfk', 6)) r(resultado, o)) d where d.n > 0
  )
  select jsonb_build_object('periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta), 'criterio', case when v_adj then 'adjudicacion' else 'presentacion' end,
    'indicadores', ind.j, 'por_mes', meses.j, 'competidores', comps.j,
    'distribucion', dist.j, 'ultima_consulta', (select max(consultado_en) from f),
    'ultima_sincronizacion', (select max(terminado_en) from public.ic_sincronizaciones), 'fuente', 'API Compra Ágil v2 (ChileCompra)')
  into v from ind, meses, comps, dist;
  return v;
end $$;

-- Detalle paginado con los MISMOS filtros y criterio que ic_resumen_v2 (incluye fecha_adjudicacion en cada fila).
create function public.ic_detalle_v2(p_desde date default null, p_hasta date default null, p_institucion text default '', p_vendedor text default '', p_resultado text default '',
  p_criterio text default 'presentacion', p_q text default '', p_orden text default 'fecha_presentacion', p_desc boolean default true, p_limite integer default 15, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_col text; v jsonb; v_q text := public.cz_clave_nombre(p_q); v_adj boolean := coalesce(p_criterio, '') = 'adjudicacion';
begin
  if not public.bfk_es_usuario() then raise exception 'IC403: esta cuenta no tiene un perfil BFK autorizado' using errcode = '42501'; end if;
  v_col := case when p_orden in ('fecha_presentacion','fecha_adjudicacion','codigo','institucion','vendedor_nombre','oferta_total','resultado','adjudicatario_nombre','adjudicado_total','diferencia','diferencia_pct')
                then p_orden else 'fecha_presentacion' end;
  execute format($q$
    with f as (
      select o.*, x.fecha_adjudicacion from public.ic_oportunidades o
      cross join lateral (select case when o.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then (o.fecha_resultado at time zone 'UTC')::date end as fecha_adjudicacion) x
      where (not $9 or x.fecha_adjudicacion is not null)
        and ($1 is null or (case when $9 then x.fecha_adjudicacion else o.fecha_presentacion end) >= $1) and ($2 is null or (case when $9 then x.fecha_adjudicacion else o.fecha_presentacion end) <= $2)
        and (coalesce(btrim($3), '') = '' or strpos(public.cz_clave_nombre(o.institucion), public.cz_clave_nombre($3)) > 0)
        and (coalesce($4, '') = '' or ($4 = '__sin__' and o.vendedor_nombre is null) or public.cz_clave_nombre(o.vendedor_nombre) = public.cz_clave_nombre($4))
        and (coalesce($5, '') = '' or o.resultado = $5)
        and ($6 = '' or strpos(public.cz_clave_nombre(o.codigo), $6) > 0 or strpos(public.cz_clave_nombre(o.institucion), $6) > 0
             or strpos(public.cz_clave_nombre(o.descripcion), $6) > 0 or strpos(public.cz_clave_nombre(o.adjudicatario_nombre), $6) > 0
             or strpos(public.cz_clave_nombre(o.adjudicatario_rut), $6) > 0 or strpos(public.cz_clave_nombre(o.vendedor_nombre), $6) > 0))
    select jsonb_build_object('total', (select count(*) from f),
      'filas', coalesce((select jsonb_agg(to_jsonb(x) - 'n' order by x.n) from (
        select f.*, row_number() over (order by f.%1$I %2$s nulls last, f.clave) as n from f order by f.%1$I %2$s nulls last, f.clave limit $7 offset $8) x), '[]'::jsonb))
  $q$, v_col, case when p_desc then 'desc' else 'asc' end)
  into v using p_desde, p_hasta, p_institucion, p_vendedor, p_resultado, v_q, greatest(1, least(coalesce(p_limite, 15), 1000)), greatest(0, coalesce(p_offset, 0)), v_adj;
  return v;
end $$;

-- ── Permisos (mismo patrón que la migración del 04/11): nada para anónimos ──
revoke all on function public.ic_proxima_consulta(public.ic_resultados), public.ic_estado_sincronizacion(),
  public.ic_resumen_v2(date, date, text, text, text, text), public.ic_detalle_v2(date, date, text, text, text, text, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.ic_estado_sincronizacion(), public.ic_resumen_v2(date, date, text, text, text, text),
  public.ic_detalle_v2(date, date, text, text, text, text, text, text, boolean, integer, integer) to authenticated;
comment on function public.ic_estado_sincronizacion() is 'Inteligencia Comercial (05/11/2026): conteos de la cola de sincronización con ChileCompra (solo administradores).';
comment on function public.ic_resumen_v2(date, date, text, text, text, text) is 'Inteligencia Comercial (05/11/2026): ic_resumen con criterio de fecha (presentacion | adjudicacion) e indicadores de cobertura.';
