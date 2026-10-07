-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase SII · Modelo tributario (2026-10-07). Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-modelo-tributario.sql
--
-- Qué hace (solo estructura y reglas; NO modifica ningún dato existente)
--   · eventos_factura pasa a representar cada documento tributario (DTE): columnas nuevas, todas
--     opcionales o con valor por defecto, para tipo DTE, RUT receptor, neto/exento/IVA, referencia SII
--     (documento, tipo, código 1/2/3, motivo) y origen/verificación SII. Las filas existentes quedan
--     igual (tipo_dte vacío = factura; origen 'bfk'; sin verificar).
--   · Reglas (iguales a src/lib/tributario.js):
--       factura vigente = factura (33/34/sin tipo) no anulada por una NC código 1 que la referencia
--                         ni por otra factura de la OC que la reemplazó (reemisión antigua)
--       NC código 2 (corrige texto): sin efecto en monto ni vigencia
--       NC código 3 (corrige montos): resta su monto
--       monto facturado de la OC = facturas vigentes + ND − NC código 3 sobre facturas vigentes
--   · Vista documentos_tributarios (con la RLS de quien consulta) con el estado de cada documento.
-- Garantías verificadas dentro de la transacción (si algo no cuadra, se aborta sin cambios)
--   · fin_calculo_oc de TODAS las OCs da exactamente lo mismo antes y después (hoy no hay NC/ND
--     registradas como documento, así que ningún monto ni estado cambia).
--   · Ningún valor guardado de OCs, financiadores ni eventos cambia. fin_verificar_consistencia() vacía.
-- Deshacer: 2026-10-07-modelo-tributario-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regprocedure('public.fin_calculo_oc(text,boolean)') is null then
    raise exception 'SII-MODELO: la migración de integridad financiera no está aplicada';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'eventos_factura' and column_name = 'tipo_dte') then
    raise exception 'SII-MODELO: el modelo tributario ya está aplicado';
  end if;
end $$;

-- ── 0. Fotos (antes) ──────────────────────────────────────────────────────────────────────
create temp table _sii_calc_antes on commit drop as
  select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c;
create temp table _sii_huellas_antes on commit drop as
  select 'oc' t, md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from public.ordenes_compra_v2 x
  union all select 'fin', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.financiadores x
  union all select 'fac', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_factura x
  union all select 'cob', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_pago_cliente x;

-- ── 1. Estructura ─────────────────────────────────────────────────────────────────────────
alter table public.eventos_factura
  add column tipo_dte smallint,
  add column rut_receptor text,
  add column monto_neto numeric,
  add column monto_exento numeric,
  add column monto_iva numeric,
  add column ref_tipo_dte smallint,
  add column ref_folio text,
  add column ref_codigo smallint,
  add column ref_motivo text,
  add column origen text not null default 'bfk',
  add column verificado_sii boolean not null default false,
  add column verificado_en timestamptz,
  add column evidencia_sii text;

alter table public.eventos_factura
  add constraint eventos_factura_tipo_dte_chk check (tipo_dte is null or tipo_dte in (33, 34, 56, 61)),
  add constraint eventos_factura_ref_tipo_chk check (ref_tipo_dte is null or ref_tipo_dte in (33, 34, 56, 61)),
  add constraint eventos_factura_ref_codigo_chk check (ref_codigo is null or ref_codigo in (1, 2, 3)),
  add constraint eventos_factura_origen_chk check (origen in ('bfk', 'manual', 'sii_rcv', 'sii_xml')),
  -- Una NC o ND debe indicar el documento que corrige y su código SII.
  add constraint eventos_factura_ref_nc_chk check (coalesce(tipo_dte, 33) not in (56, 61) or (nullif(btrim(ref_folio), '') is not null and ref_codigo is not null));

-- Una NC que solo corrige texto (código 2) va por $0: el monto positivo se exige a todo lo demás.
do $$
declare d text;
begin
  select pg_get_constraintdef(c.oid) into d from pg_constraint c
   where c.conrelid = 'public.eventos_factura'::regclass and c.conname = 'chk_factura_positiva';
  if d is distinct from 'CHECK ((COALESCE(monto, (0)::numeric) > (0)::numeric))' then
    raise exception 'SII-MODELO: chk_factura_positiva no es la esperada (%). No se aplicó nada.', d;
  end if;
end $$;
alter table public.eventos_factura drop constraint chk_factura_positiva;
alter table public.eventos_factura add constraint chk_factura_positiva check (coalesce(monto, 0) > 0 or (tipo_dte = 61 and monto >= 0));

create index if not exists idx_eventos_factura_oc_tipo on public.eventos_factura (oc_id, tipo_dte);

-- ── 2. Reglas ─────────────────────────────────────────────────────────────────────────────
-- Facturas vigentes de una OC (solo facturas): no anuladas por NC código 1 ni por reemisión antigua.
create or replace function public.fin_facturas_vigentes(p_oc_id text) returns setof public.eventos_factura
language sql stable security definer set search_path = public, pg_temp as $$
  select f.* from public.eventos_factura f
   where f.oc_id = p_oc_id
     and coalesce(f.tipo_dte, 33) in (33, 34)
     and not exists (select 1 from public.eventos_factura a
                      where a.oc_id = f.oc_id and a.id <> f.id
                        and nullif(btrim(f.numero_factura), '') is not null
                        and ((coalesce(a.tipo_dte, 33) in (33, 34)
                              and nullif(btrim(a.factura_anulada_numero), '') is not null
                              and btrim(a.factura_anulada_numero) = btrim(f.numero_factura))
                          or (a.tipo_dte = 61 and a.ref_codigo = 1 and btrim(a.ref_folio) = btrim(f.numero_factura))))
$$;

-- Monto tributario vigente: facturas vigentes + notas de débito − NC código 3 sobre facturas vigentes.
create or replace function public.fin_monto_tributario(p_oc_id text) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  with vig as (select * from public.fin_facturas_vigentes(p_oc_id))
  select coalesce((select sum(v.monto) from vig v), 0)
       + coalesce((select sum(d.monto) from public.eventos_factura d where d.oc_id = p_oc_id and d.tipo_dte = 56), 0)
       - coalesce((select sum(n.monto) from public.eventos_factura n
                    where n.oc_id = p_oc_id and n.tipo_dte = 61 and n.ref_codigo = 3
                      and btrim(n.ref_folio) in (select btrim(v.numero_factura) from vig v)), 0)
$$;

-- fin_calculo_oc: igual que en la Fase 4B salvo monto_facturado (monto tributario vigente).
create or replace function public.fin_calculo_oc(
  p_oc_id text, p_con_diferencias boolean default true,
  out costo_total numeric, out estado_compra text, out monto_pagado_fin numeric, out estado_pago_financiamiento text,
  out monto_facturado numeric, out estado_factura_propia text, out monto_cobrado numeric, out estado_pago_cliente text,
  out tipo_financiamiento text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare
  v_existe boolean; v_n_compras int; v_n_vigentes int; v_ov text;
begin
  select true into v_existe from public.ordenes_compra_v2 o where o.id = p_oc_id;
  if v_existe is null then return; end if;
  select coalesce(sum(e.costo_compra), 0), count(*) into costo_total, v_n_compras
    from public.eventos_compra e where e.oc_id = p_oc_id;
  select coalesce(sum(p.monto), 0) into monto_pagado_fin
    from public.eventos_pago_financiamiento p where p.oc_id = p_oc_id;
  select count(*) into v_n_vigentes from public.fin_facturas_vigentes(p_oc_id) v;
  monto_facturado := public.fin_monto_tributario(p_oc_id);
  select coalesce(sum(c.monto), 0) into monto_cobrado
    from public.eventos_pago_cliente c where c.oc_id = p_oc_id;
  if p_con_diferencias then
    costo_total      := costo_total      + public.fin_dif_monto('oc', p_oc_id, 'costo_total');
    monto_pagado_fin := monto_pagado_fin + public.fin_dif_monto('oc', p_oc_id, 'monto_pagado_fin');
    monto_facturado  := monto_facturado  + public.fin_dif_monto('oc', p_oc_id, 'monto_facturado');
    monto_cobrado    := monto_cobrado    + public.fin_dif_monto('oc', p_oc_id, 'monto_cobrado');
  end if;
  tipo_financiamiento := public.fin_tipo_financiamiento(p_oc_id);
  estado_compra := case when v_n_compras > 0 then 'comprado' else 'pendiente' end;
  estado_pago_financiamiento := case
    when tipo_financiamiento <> 'externo' then 'no_aplica'
    when costo_total <= 0 then 'pendiente'
    when monto_pagado_fin >= costo_total then 'pagado'
    when monto_pagado_fin > 0 then 'parcial'
    else 'pendiente' end;
  estado_factura_propia := case when v_n_vigentes > 0 then 'emitida' else 'pendiente' end;
  estado_pago_cliente := case
    when monto_cobrado <= 0 then 'pendiente'
    when monto_facturado > 0 and monto_cobrado >= monto_facturado then 'pagado'
    else 'parcial' end;
  if p_con_diferencias then
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_compra');              if v_ov is not null then estado_compra := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_financiamiento'); if v_ov is not null then estado_pago_financiamiento := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_factura_propia');      if v_ov is not null then estado_factura_propia := v_ov; end if;
    v_ov := public.fin_dif_estado(p_oc_id, 'estado_pago_cliente');        if v_ov is not null then estado_pago_cliente := v_ov; end if;
  end if;
  return;
end $$;

-- Vista de documentos con su estado (consulta y exportación; respeta la RLS de quien consulta).
create or replace view public.documentos_tributarios with (security_invoker = true) as
select d.id, d.oc_id, o.numero_oc, coalesce(d.tipo_dte, 33) as tipo_dte, d.numero_factura as folio, d.fecha,
       coalesce(d.rut_receptor, o.rut_cliente) as rut_receptor, d.monto as monto_total, d.monto_neto, d.monto_exento, d.monto_iva,
       d.ref_tipo_dte, coalesce(d.ref_folio, nullif(btrim(d.factura_anulada_numero), '')) as ref_folio,
       coalesce(d.ref_codigo, case when nullif(btrim(d.factura_anulada_numero), '') is not null then 1 end) as ref_codigo,
       d.ref_motivo, d.nota_credito as nc_legado, d.origen, d.verificado_sii, d.verificado_en, d.evidencia_sii,
       case
         when d.tipo_dte = 61 then case d.ref_codigo when 1 then 'nc_anula' when 2 then 'nc_texto' when 3 then 'nc_monto' else 'nc_sin_codigo' end
         when d.tipo_dte = 56 then 'nd'
         when exists (select 1 from public.fin_facturas_vigentes(d.oc_id) v where v.id = d.id) then 'vigente'
         else 'anulada'
       end as estado
  from public.eventos_factura d left join public.ordenes_compra_v2 o on o.id = d.oc_id;
grant select on public.documentos_tributarios to authenticated;
revoke all on public.documentos_tributarios from anon;
revoke execute on function public.fin_monto_tributario(text) from public, anon;

-- ── 3. Verificación (dentro de la transacción) ─────────────────────────────────────────────
do $$
declare v_n int;
begin
  select count(*) into v_n from (
    select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c
    except select * from _sii_calc_antes) x;
  if v_n > 0 then raise exception 'SII-MODELO: % OCs cambiarían su cálculo. No se aplicó nada.', v_n; end if;
  select count(*) into v_n from (select * from _sii_calc_antes except
    select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c) x;
  if v_n > 0 then raise exception 'SII-MODELO: % OCs cambiarían su cálculo (2). No se aplicó nada.', v_n; end if;
  if exists (select 1 from _sii_huellas_antes a join (
      select 'oc' t, md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from public.ordenes_compra_v2 x
      union all select 'fin', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.financiadores x
      union all select 'cob', md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_pago_cliente x) b
      on a.t = b.t where a.h <> b.h) then
    raise exception 'SII-MODELO: cambió un valor guardado. No se aplicó nada.';
  end if;
  -- eventos_factura ganó columnas: se compara sin ellas.
  if (select h from _sii_huellas_antes where t = 'fac') <>
     (select md5(coalesce(string_agg((to_jsonb(x) - array['tipo_dte','rut_receptor','monto_neto','monto_exento','monto_iva','ref_tipo_dte','ref_folio',
             'ref_codigo','ref_motivo','origen','verificado_sii','verificado_en','evidencia_sii'])::text, ',' order by x.id), '')) from public.eventos_factura x) then
    raise exception 'SII-MODELO: cambió una factura existente. No se aplicó nada.';
  end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then
    raise exception 'SII-MODELO: consistencia financiera no vacía. No se aplicó nada.';
  end if;
  raise notice 'SII-MODELO: aplicado y verificado (sin cambios de valores)';
end $$;
