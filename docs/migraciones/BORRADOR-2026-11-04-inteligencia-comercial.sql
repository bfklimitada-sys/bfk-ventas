-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Inteligencia Comercial de Compra Ágil (04/11/2026). NO APLICADO. Requiere autorización expresa de Kevin.
-- Una sola transacción:  psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-11-04-inteligencia-comercial.sql
-- Deshacer:              BORRADOR-2026-11-04-inteligencia-comercial-deshacer.sql
--
-- Solo CREA objetos nuevos con prefijo ic_. No modifica ninguna tabla, fila, función, política ni índice existente:
-- cotizaciones, OCs, eventos, compras, gastos, facturas, IVA, F29, comisiones, banco, financiamiento/FIFO y Proyectos
-- Industriales quedan intactos. Las cotizaciones solo se LEEN (vista con security_invoker: rigen sus propias políticas).
--
--   ic_resultados ............ resultado OFICIAL de ChileCompra por código de Compra Ágil (una fila por proceso).
--   ic_resultados_historial .. historial mínimo de cambios del resultado (disparador).
--   ic_sincronizaciones ...... registro de cada sincronización (quién, cuándo, cuántos, errores).
--   ic_oportunidades (vista) . una fila por oportunidad presentada + resultado comercial analítico + comparación.
--   ic_resumen() ............. indicadores, series mensuales, competidores y distribución por período (agregado en SQL).
--   ic_detalle() ............. detalle paginado con los mismos filtros, búsqueda y orden.
--   ic_registrar_resultado() . única escritura de resultados (solo administradores; la usa el servidor de BFK).
--   ic_pendientes_sincronizar() / ic_registrar_sincronizacion(): apoyo a la sincronización (solo administradores).
-- Lectura: cualquier perfil BFK. Escritura directa: nadie (solo funciones). Anónimos: nada.
-- La lógica es la misma que src/lib/inteligenciaComercial.js (comprobado por docs/pruebas-inteligencia/validar_sql.sh).
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.ic_resultados') is not null then raise exception 'IC: el módulo ya existe; no se aplicó nada'; end if;
  if to_regclass('public.cotizaciones') is null or to_regclass('public.cotizacion_versiones') is null then raise exception 'IC: falta el módulo Cotizaciones; no se aplicó nada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cotizaciones' and column_name = 'vendedor_nombre') then
    raise exception 'IC: falta la versión 2 de Cotizaciones; no se aplicó nada'; end if;
  if to_regprocedure('public.cz_clave_nombre(text)') is null then raise exception 'IC: falta cz_clave_nombre (Cotizaciones v2); no se aplicó nada'; end if;
  if to_regprocedure('public.bfk_es_usuario()') is null or to_regprocedure('public.bfk_es_admin()') is null then
    raise exception 'IC: faltan las funciones de seguridad BFK (bfk_es_usuario/bfk_es_admin); no se aplicó nada'; end if;
end $pre$;

-- ── Funciones auxiliares (puras) ──
create function public.ic_rut_norm(t text) returns text language sql immutable set search_path = '' as $$
  select upper(regexp_replace(coalesce(t, ''), '[^0-9kK]', '', 'g'))
$$;
create function public.ic_rut_bfk() returns text language sql immutable set search_path = '' as $$ select '773223173'::text $$;  -- 77.322.317-3

-- ── 1. Resultado oficial por proceso ──
create table public.ic_resultados (
  codigo text primary key check (codigo ~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$'),
  estado_proceso text not null default 'sin_informacion'
    check (estado_proceso in ('publicada','cerrada','proveedor_seleccionado','oc_emitida','desierta','cancelada','no_encontrada','sin_informacion')),
  resultado text not null default 'sin_informacion'
    check (resultado in ('pendiente','ganada','perdida','desierta','cancelada','sin_informacion','sin_oferta_bfk')),
  total_ofertas integer check (total_ofertas is null or total_ofertas >= 0),
  bfk_oferto boolean,                                    -- null = no se pudo consultar el detalle
  bfk_monto_neto numeric check (bfk_monto_neto is null or bfk_monto_neto >= 0),
  bfk_monto_total numeric check (bfk_monto_total is null or bfk_monto_total >= 0),
  adjudicatario_rut text, adjudicatario_nombre text,
  monto_neto numeric check (monto_neto is null or monto_neto >= 0),
  monto_impuesto numeric check (monto_impuesto is null or monto_impuesto >= 0),
  monto_despacho numeric check (monto_despacho is null or monto_despacho >= 0),
  monto_total numeric check (monto_total is null or monto_total >= 0),
  moneda text, impuesto_nombre text, impuesto_pct numeric,
  base_tributaria text not null default 'desconocida' check (base_tributaria in ('afecta','exenta','desconocida')),
  id_orden_compra bigint,                                -- identificador interno de ChileCompra (no es el código de la OC)
  fecha_resultado timestamptz, fecha_resultado_fuente text,
  motivo text,
  fuente text not null,
  detalle_consultado boolean not null default false,
  consultado_en timestamptz not null default now(),       -- último intento
  verificado_en timestamptz,                             -- última consulta exitosa
  consulta_estado text not null default 'ok' check (consulta_estado in ('ok','error','limite','no_encontrada')),
  consulta_error text,
  intentos integer not null default 0 check (intentos >= 0),
  proximo_intento timestamptz,                           -- null = resultado final (no se vuelve a consultar salvo «forzar»)
  registrado_por uuid default auth.uid(),
  creado_en timestamptz not null default now(),
  check (fecha_resultado_fuente is null or fecha_resultado_fuente in ('fecha_ultimo_cambio','fecha_cancelacion'))
);
create index ic_resultados_resultado on public.ic_resultados (resultado);
create index ic_resultados_proximo on public.ic_resultados (proximo_intento) where proximo_intento is not null;
create index ic_resultados_adjudicatario on public.ic_resultados (public.ic_rut_norm(adjudicatario_rut)) where adjudicatario_rut is not null;

-- ── 2. Historial mínimo de cambios ──
create table public.ic_resultados_historial (
  id bigint generated always as identity primary key,
  codigo text not null references public.ic_resultados(codigo) on delete restrict,
  anterior jsonb, nuevo jsonb not null,
  cambiado_en timestamptz not null default now(), cambiado_por uuid default auth.uid(), fuente text
);
create index ic_historial_codigo on public.ic_resultados_historial (codigo, cambiado_en desc);

create function public.ic_trg_historial() returns trigger language plpgsql security definer set search_path = '' as $$
declare a jsonb; n jsonb;
begin
  n := jsonb_build_object('estado_proceso', new.estado_proceso, 'resultado', new.resultado, 'bfk_oferto', new.bfk_oferto,
    'adjudicatario_rut', new.adjudicatario_rut, 'adjudicatario_nombre', new.adjudicatario_nombre, 'monto_total', new.monto_total, 'base_tributaria', new.base_tributaria);
  if tg_op = 'UPDATE' then
    a := jsonb_build_object('estado_proceso', old.estado_proceso, 'resultado', old.resultado, 'bfk_oferto', old.bfk_oferto,
      'adjudicatario_rut', old.adjudicatario_rut, 'adjudicatario_nombre', old.adjudicatario_nombre, 'monto_total', old.monto_total, 'base_tributaria', old.base_tributaria);
    if a = n then return new; end if;
  end if;
  insert into public.ic_resultados_historial (codigo, anterior, nuevo, fuente) values (new.codigo, a, n, new.fuente);
  return new;
end $$;
create trigger ic_historial after insert or update on public.ic_resultados for each row execute function public.ic_trg_historial();

-- ── 3. Registro de sincronizaciones ──
create table public.ic_sincronizaciones (
  id bigint generated always as identity primary key,
  iniciado_en timestamptz not null, terminado_en timestamptz not null default now(),
  usuario uuid default auth.uid(), origen text not null check (origen in ('manual','automatica')),
  solicitados integer not null default 0, consultados integer not null default 0, actualizados integer not null default 0, errores integer not null default 0,
  limite_alcanzado boolean not null default false, detalle text, fuente text not null,
  check (terminado_en >= iniciado_en)
);
create index ic_sinc_terminado on public.ic_sincronizaciones (terminado_en desc);

-- ── RLS: lectura para perfiles BFK; sin escritura directa; nada para anónimos ──
do $$ declare t text; begin
  foreach t in array array['ic_resultados','ic_resultados_historial','ic_sincronizaciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.bfk_es_usuario())', 'ic_leer_' || t, t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ── 4. Oportunidades (una por código; vista con los permisos de quien consulta) ──
create view public.ic_oportunidades with (security_invoker = true) as
with base as (
  select c.id, c.id_externo, c.nombre, c.institucion, c.rut, c.fecha, c.estado, c.subtotal_neto, c.impuestos, c.total, c.oc_codigo,
    c.vendedor_id, c.vendedor_nombre, c.actualizado_en,
    coalesce(nullif(upper(btrim(c.id_externo)), ''), 'cz:' || c.id::text) as clave,
    nullif(upper(btrim(c.id_externo)), '') as cod,
    (select min(v.guardado_en) from public.cotizacion_versiones v
      where v.cotizacion_id = c.id and v.contenido->>'estado' in ('presentada','adjudicada','no_adjudicada')) as presentada_en
  from public.cotizaciones c
  where c.estado in ('presentada','adjudicada','no_adjudicada')
), unica as (
  select distinct on (b.clave) b.*, count(*) over (partition by b.clave) as n_cot
  from base b
  order by b.clave, case b.estado when 'adjudicada' then 1 when 'no_adjudicada' then 2 else 3 end, b.actualizado_en desc nulls last, b.id::text
)
select u.clave, u.cod as codigo, u.id as cotizacion_id, u.n_cot::integer as n_cotizaciones,
  coalesce((u.presentada_en at time zone 'America/Santiago')::date, u.fecha) as fecha_presentacion,
  (u.presentada_en is not null) as fecha_presentacion_registrada,
  u.institucion, u.rut as rut_institucion, u.nombre as descripcion, u.vendedor_id, u.vendedor_nombre, u.estado as estado_cotizacion, u.oc_codigo,
  coalesce(u.subtotal_neto, 0) as oferta_neto, coalesce(u.impuestos, 0) as oferta_impuesto, coalesce(u.total, 0) as oferta_total, x.oferta_base,
  r.estado_proceso, r.resultado as resultado_externo, r.total_ofertas, r.bfk_oferto, r.adjudicatario_rut, r.adjudicatario_nombre,
  r.monto_neto as adjudicado_neto, r.monto_impuesto as adjudicado_impuesto, r.monto_despacho as adjudicado_despacho, r.monto_total as adjudicado_total,
  r.moneda, r.base_tributaria as adjudicado_base, r.fecha_resultado, r.fuente, r.detalle_consultado, r.consultado_en, r.verificado_en,
  r.consulta_estado, r.consulta_error, r.motivo,
  y.resultado, y.fuente_resultado, y.verificacion, y.aviso, z.comparable,
  case when z.comparable then null else z.motivo_no_comparable end as motivo_no_comparable,
  case when z.comparable then coalesce(u.total, 0) - r.monto_total end as diferencia,
  case when z.comparable then round((coalesce(u.total, 0) - r.monto_total) / r.monto_total * 100, 1) end as diferencia_pct,
  case when u.cod ~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$' then 'https://buscador.mercadopublico.cl/ficha?code=' || u.cod end as enlace_mp
from unica u
left join public.ic_resultados r on r.codigo = u.cod
cross join lateral (select case when coalesce(u.impuestos, 0) > 0 then 'afecta' when coalesce(u.subtotal_neto, 0) > 0 then 'exenta' else 'desconocida' end as oferta_base) x
cross join lateral (select
    case when u.estado = 'adjudicada' then 'ganada' when u.estado = 'no_adjudicada' then 'perdida'
         when r.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then r.resultado else 'pendiente' end as resultado,
    case when u.estado = 'adjudicada' then 'Cotización BFK (adjudicada)' when u.estado = 'no_adjudicada' then 'Cotización BFK (no adjudicada)'
         when r.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then r.fuente else 'Sin resultado verificado' end as fuente_resultado,
    case when u.cod is null then 'sin_codigo' when u.cod !~ '^[0-9]{1,10}-[0-9]{1,6}-COT[0-9]{2}$' then 'no_compra_agil' when r.codigo is null then 'sin_consultar'
         when r.resultado in ('ganada','perdida','desierta','cancelada','sin_oferta_bfk') then 'verificado'
         when r.estado_proceso in ('proveedor_seleccionado','oc_emitida') then 'por_verificar'
         when r.estado_proceso in ('publicada','cerrada') then 'en_proceso' else 'por_verificar' end as verificacion,
    case when u.estado = 'adjudicada' and r.resultado in ('perdida','desierta','cancelada','sin_oferta_bfk') then
           'ChileCompra informa: ' || case r.resultado when 'perdida' then 'perdida' when 'desierta' then 'desierta' when 'cancelada' then 'cancelada' else 'bfk no figura entre las ofertas' end || '. La cotización figura adjudicada.'
         when u.estado = 'no_adjudicada' and r.resultado = 'ganada' then 'ChileCompra informa a BFK como proveedor seleccionado. La cotización figura no adjudicada.'
         when u.estado = 'presentada' and r.resultado = 'ganada' then 'ChileCompra informa a BFK como proveedor seleccionado: la cotización sigue «presentada» (regularizar en Cotizaciones).'
    end as aviso) y
cross join lateral (select
    (y.resultado = 'perdida' and coalesce(r.monto_total, 0) > 0 and coalesce(u.total, 0) > 0 and upper(coalesce(r.moneda, '')) in ('', 'CLP')
      and x.oferta_base <> 'desconocida' and x.oferta_base = coalesce(r.base_tributaria, 'desconocida')
      and r.adjudicatario_rut is not null and public.ic_rut_norm(r.adjudicatario_rut) <> public.ic_rut_bfk()) as comparable,
    case when y.resultado <> 'perdida' then null
         when r.adjudicatario_rut is null or r.monto_total is null then 'Información no disponible'
         when upper(coalesce(r.moneda, '')) not in ('', 'CLP') then 'Moneda distinta'
         when x.oferta_base = 'desconocida' or coalesce(r.base_tributaria, 'desconocida') = 'desconocida' then 'Base tributaria desconocida'
         when x.oferta_base <> r.base_tributaria then 'Base tributaria distinta (afecta/exenta)'
         when not (r.monto_total > 0) or not (coalesce(u.total, 0) > 0) then 'Monto en cero' end as motivo_no_comparable) z;
revoke all on public.ic_oportunidades from anon, public;
grant select on public.ic_oportunidades to authenticated;

-- ── 5. Resumen agregado del período (en PostgreSQL) ──
-- p_vendedor: '' = todos · '__sin__' = sin vendedor · nombre exacto (sin distinguir mayúsculas ni tildes).
create function public.ic_resumen(p_desde date default null, p_hasta date default null, p_institucion text default '', p_vendedor text default '', p_resultado text default '')
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v jsonb;
begin
  if not public.bfk_es_usuario() then raise exception 'IC403: esta cuenta no tiene un perfil BFK autorizado' using errcode = '42501'; end if;
  with f as (
    select * from public.ic_oportunidades o
    where (p_desde is null or o.fecha_presentacion >= p_desde) and (p_hasta is null or o.fecha_presentacion <= p_hasta)
      and (coalesce(btrim(p_institucion), '') = '' or strpos(public.cz_clave_nombre(o.institucion), public.cz_clave_nombre(p_institucion)) > 0)
      and (coalesce(p_vendedor, '') = '' or (p_vendedor = '__sin__' and o.vendedor_nombre is null)
           or public.cz_clave_nombre(o.vendedor_nombre) = public.cz_clave_nombre(p_vendedor))
      and (coalesce(p_resultado, '') = '' or o.resultado = p_resultado)
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
      'avisos', (select count(*) from f where aviso is not null)) as j
  ), meses as (
    select coalesce(jsonb_agg(jsonb_build_object('mes', m.mes, 'presentadas', m.presentadas, 'ganadas', m.ganadas, 'perdidas', m.perdidas, 'pendientes', m.pendientes,
      'otras', m.otras, 'ofertado_neto', m.ofertado_neto, 'ganado_neto', m.ganado_neto, 'comp_ofertado_total', m.cot, 'comp_adjudicado_total', m.cat, 'comparables', m.nc) order by m.mes), '[]'::jsonb) as j
    from (select to_char(fecha_presentacion, 'YYYY-MM') as mes,
            count(*) filter (where resultado <> 'sin_oferta_bfk') as presentadas, count(*) filter (where resultado = 'ganada') as ganadas,
            count(*) filter (where resultado = 'perdida') as perdidas, count(*) filter (where resultado = 'pendiente') as pendientes,
            count(*) filter (where resultado in ('desierta','cancelada')) as otras,
            coalesce(sum(oferta_neto) filter (where resultado <> 'sin_oferta_bfk'), 0) as ofertado_neto, coalesce(sum(oferta_neto) filter (where resultado = 'ganada'), 0) as ganado_neto,
            coalesce(sum(oferta_total) filter (where comparable), 0) as cot, coalesce(sum(adjudicado_total) filter (where comparable), 0) as cat, count(*) filter (where comparable) as nc
          from f where fecha_presentacion is not null group by 1) m
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
  select jsonb_build_object('periodo', jsonb_build_object('desde', p_desde, 'hasta', p_hasta), 'indicadores', ind.j, 'por_mes', meses.j, 'competidores', comps.j,
    'distribucion', dist.j, 'ultima_consulta', (select max(consultado_en) from f),
    'ultima_sincronizacion', (select max(terminado_en) from public.ic_sincronizaciones), 'fuente', 'API Compra Ágil v2 (ChileCompra)')
  into v from ind, meses, comps, dist;
  return v;
end $$;

-- Detalle paginado con los MISMOS filtros que ic_resumen, más búsqueda (código, institución, descripción, empresa
-- adjudicada, RUT o vendedor) y orden por columna permitida (vacíos al final; desempate por clave).
create function public.ic_detalle(p_desde date default null, p_hasta date default null, p_institucion text default '', p_vendedor text default '', p_resultado text default '',
  p_q text default '', p_orden text default 'fecha_presentacion', p_desc boolean default true, p_limite integer default 15, p_offset integer default 0)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare v_col text; v jsonb; v_q text := public.cz_clave_nombre(p_q);
begin
  if not public.bfk_es_usuario() then raise exception 'IC403: esta cuenta no tiene un perfil BFK autorizado' using errcode = '42501'; end if;
  v_col := case when p_orden in ('fecha_presentacion','codigo','institucion','vendedor_nombre','oferta_total','resultado','adjudicatario_nombre','adjudicado_total','diferencia','diferencia_pct')
                then p_orden else 'fecha_presentacion' end;
  execute format($q$
    with f as (
      select * from public.ic_oportunidades o
      where ($1 is null or o.fecha_presentacion >= $1) and ($2 is null or o.fecha_presentacion <= $2)
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
  into v using p_desde, p_hasta, p_institucion, p_vendedor, p_resultado, v_q, greatest(1, least(coalesce(p_limite, 15), 1000)), greatest(0, coalesce(p_offset, 0));
  return v;
end $$;

-- ── 6. Escritura del resultado (solo administradores; la usa /api/inteligencia) ──
-- Nunca toca cotizaciones ni OCs. Solo acepta códigos de cotizaciones BFK presentadas. Una consulta fallida no borra lo
-- ya verificado: solo registra el intento y programa el siguiente (espera creciente). Sin detalle, se conservan el
-- adjudicatario, los montos y el resultado ya verificados si el proceso sigue en el mismo estado.
create function public.ic_registrar_resultado(p jsonb) returns jsonb
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

-- Códigos BFK por sincronizar: presentados, de Compra Ágil, sin consultar o con el próximo intento vencido.
-- p_forzar: también los ya verificados (actualización manual completa), los más antiguos primero.
create function public.ic_pendientes_sincronizar(p_limite integer default 40, p_forzar boolean default false)
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

create function public.ic_registrar_sincronizacion(p jsonb) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  if not public.bfk_es_admin() then raise exception 'IC403: solo un administrador de BFK puede sincronizar resultados' using errcode = '42501'; end if;
  insert into public.ic_sincronizaciones (iniciado_en, usuario, origen, solicitados, consultados, actualizados, errores, limite_alcanzado, detalle, fuente)
  values (least(coalesce(nullif(p->>'iniciado_en', '')::timestamptz, now()), now()), auth.uid(), coalesce(nullif(p->>'origen', ''), 'manual'),
    greatest(coalesce((p->>'solicitados')::integer, 0), 0), greatest(coalesce((p->>'consultados')::integer, 0), 0), greatest(coalesce((p->>'actualizados')::integer, 0), 0),
    greatest(coalesce((p->>'errores')::integer, 0), 0), coalesce((p->>'limite_alcanzado')::boolean, false), left(p->>'detalle', 500), 'API Compra Ágil v2 (ChileCompra)')
  returning id into v_id;
  return v_id;
end $$;

-- ── Permisos de las funciones ──
revoke all on function public.ic_rut_norm(text), public.ic_rut_bfk(), public.ic_trg_historial(), public.ic_resumen(date, date, text, text, text),
  public.ic_detalle(date, date, text, text, text, text, text, boolean, integer, integer),
  public.ic_registrar_resultado(jsonb), public.ic_pendientes_sincronizar(integer, boolean), public.ic_registrar_sincronizacion(jsonb) from public, anon;
grant execute on function public.ic_rut_norm(text), public.ic_rut_bfk(), public.ic_resumen(date, date, text, text, text),
  public.ic_detalle(date, date, text, text, text, text, text, boolean, integer, integer),
  public.ic_registrar_resultado(jsonb), public.ic_pendientes_sincronizar(integer, boolean), public.ic_registrar_sincronizacion(jsonb) to authenticated;

comment on table public.ic_resultados is 'Inteligencia Comercial (04/11/2026): resultado oficial de ChileCompra por Compra Ágil. Solo análisis: no reemplaza el estado de la cotización ni crea OCs.';
comment on view public.ic_oportunidades is 'Inteligencia Comercial: una fila por oportunidad presentada (código de Compra Ágil). Resultado comercial analítico; misma lógica que src/lib/inteligenciaComercial.js.';
