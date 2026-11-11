-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VENTAS PRIVADAS — Financiamiento de compras y vendedor «BFK» (11/11/2026).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql
-- Recuperación:                 BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql (conserva todos los datos)
--
-- ESTÁNDAR DE MERCADO PÚBLICO QUE SE ADAPTA (sin tocar Mercado Público)
--   · Financiadores: el catálogo existente public.financiadores. «Cuenta BFK» (tipo 'propio') = fondos propios: NO es deuda
--     (regla 2 de la Fase 4B). Una persona (tipo 'externo') genera saldo a devolver = aportado − devuelto (como deuda = compras
--     − pagos al financiador). Se LEE el catálogo; no se escribe en financiadores, saldo_deuda, eventos ni OCs.
--   · Vendedor de BFK sin persona: como la «venta de capitalización de BFK Ltda.» de Mercado Público: sin vendedor personal y
--     sin comisión. Ventas privadas no entra en el cálculo de comisiones (lib/calculos.js lee solo OCs): no se crea ninguna.
--   · Vendedores: el catálogo existente public.vendedores (solo lectura).
--
-- QUÉ CAMBIA (todo aditivo; ninguna fila existente se reescribe)
--   1. vp_cotizaciones y vp_ventas: vendedor_tipo ('bfk' | 'vendedor'), vendedor_id (vendedores.id) y vendedor_nombre
--      (nombre congelado al asignar). NULOS en todo lo existente: no se asigna ningún documento automáticamente.
--      · Disparador vp_20_vendedor: el vendedor solo cambia por las funciones de esta migración; al crear la venta desde la
--        cotización se copia el de la cotización (también si se usa la función existente); al duplicar, el del origen.
--      · vp_guardar_cotizacion_v2 / vp_crear_venta_directa_v2: las funciones existentes + el vendedor, en una transacción
--        (la cotización conserva su control de versión: una sola versión por guardado).
--      · vp_asignar_vendedor: cotización o venta. Responsable o administrador. Un vendedor ya asignado en una cotización
--        enviada/aceptada o en una venta solo lo cambia un administrador (como en Mercado Público). Queda en vp_historial.
--      · El responsable (quien gestiona y registra) NO cambia: el vendedor puede ser BFK sin crear una cuenta de acceso.
--   2. vp_fin_aportes: quién financió la compra de una venta (BFK con fondos propios, una persona del catálogo de financiadores
--      u otra persona por nombre), monto, fecha, medio, comprobante, archivo y observación. Varios aportantes por venta.
--      creado_por = quien registra (distinto de quien aporta).
--   3. vp_fin_devoluciones: devoluciones (parciales o totales) de aportes PERSONALES. Nunca más que el saldo del aporte.
--   4. Reglas (en la base, bajo bloqueo de la venta):
--      · lo financiado nunca supera el total pagado de las compras registradas (vp_compras vigentes de origen 'registro',
--        con IVA). Los gastos ya registrados en Gastos y vinculados no se financian aquí (su pago ya está registrado);
--      · lo no informado se muestra como «Financiamiento sin informar» (compras anteriores incluidas): nada se atribuye solo;
--      · BFK con fondos propios no genera deuda ni devoluciones; una devolución no supera el saldo; un aporte con
--        devoluciones vigentes no se anula; anular una compra que dejaría lo financiado por encima del total se rechaza;
--      · reintentos y doble clic: clave de idempotencia por aporte, devolución y compra manual (un reintento devuelve lo ya
--        registrado); operaciones simultáneas: bloqueo de la fila de la venta;
--      · correcciones: anular con motivo (se conserva) y registrar de nuevo. Todo queda en vp_historial (sensible).
--   5. Funciones: vp_registrar_compra_financiada (compra desde la cotización + aportes, UNA transacción, usa sin cambios
--      vp_registrar_compras_cotizacion), vp_registrar_compra_manual_financiada (registro manual + aportes, con clave; usa sin
--      cambios vp_registrar_compra), vp_fin_registrar_aportes, vp_fin_registrar_devolucion, vp_fin_anular.
--   6. Vistas: vp_fin_resumen (por venta) y vp_fin_aportantes (por persona) — solo administrador y responsable.
--
-- QUÉ NO CAMBIA: vp_compras y su costo real (vp_margen_ventas), utilidad, precios de venta, cotizaciones aprobadas, EETT,
--   pagos del cliente (vp_pagos: cobrar NO devuelve nada a quien financió), facturas, funciones y vistas existentes de
--   Ventas privadas, permisos de tablas existentes, Mercado Público (OCs, financiadores, saldos, comisiones, FIFO, IVA/F29).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local client_min_messages = warning;

do $$ begin
  if to_regprocedure('public.vp_registrar_compras_cotizacion(jsonb)') is null then
    raise exception 'VPFIN: falta la compra desde la cotización (10/11/2026); no se cambió nada'; end if;
  if to_regprocedure('public.vp_fin_registrar_aportes(jsonb)') is not null then raise exception 'VPFIN: la migración ya está aplicada; no se cambió nada'; end if;
  if to_regclass('public.vendedores') is null or to_regclass('public.financiadores') is null then
    raise exception 'VPFIN: faltan los catálogos de vendedores o financiadores; no se cambió nada'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'financiadores' and column_name = 'tipo') then
    raise exception 'VPFIN: financiadores no tiene tipo (Fase 4B); no se cambió nada'; end if;
  if (select count(*) from public.financiadores where tipo = 'propio') <> 1 then
    raise exception 'VPFIN: se espera exactamente un financiador de fondos propios (Cuenta BFK); no se cambió nada'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Vendedor en cotizaciones y órdenes de venta (columnas nulas; si quedaron de una recuperación, se reutilizan)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
alter table public.vp_cotizaciones add column if not exists vendedor_tipo text, add column if not exists vendedor_id text, add column if not exists vendedor_nombre text;
alter table public.vp_ventas add column if not exists vendedor_tipo text, add column if not exists vendedor_id text, add column if not exists vendedor_nombre text;
do $$ declare t text; begin
  foreach t in array array['vp_cotizaciones','vp_ventas'] loop
    if not exists (select 1 from pg_constraint where conname = t || '_vendedor_chk') then
      execute format($f$alter table public.%I add constraint %I check (
        (vendedor_tipo is null and vendedor_id is null and vendedor_nombre is null)
        or (vendedor_tipo = 'bfk' and vendedor_id is null and vendedor_nombre is not null)
        or (vendedor_tipo = 'vendedor' and vendedor_id is not null and length(vendedor_id) <= 80 and vendedor_nombre is not null and length(vendedor_nombre) <= 200))$f$,
        t, t || '_vendedor_chk');
    end if;
  end loop;
end $$;
create index if not exists vp_ventas_vendedor on public.vp_ventas (vendedor_tipo, vendedor_id);

-- El vendedor solo lo fija una función de esta migración (marca local de la transacción «vp.vendedor_fijar»).
-- Sin la marca: en un UPDATE se conserva; al crear una venta desde una cotización se copia el de la cotización; al duplicar una
-- cotización se copia el del origen; en cualquier otro alta queda sin asignar.
create or replace function public.vp_trg_vendedor() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare fijar boolean := coalesce(current_setting('vp.vendedor_fijar', true), '') = '1';
  val text := nullif(btrim(coalesce(current_setting('vp.vendedor', true), '')), ''); nom text; o record;
begin
  if not fijar then
    if tg_op = 'UPDATE' then
      new.vendedor_tipo := old.vendedor_tipo; new.vendedor_id := old.vendedor_id; new.vendedor_nombre := old.vendedor_nombre;
    elsif coalesce(to_jsonb(new)->>(case tg_table_name when 'vp_ventas' then 'cotizacion_id' else 'origen_id' end), '') <> '' then
      -- venta desde una cotización (cotizacion_id) o cotización duplicada (origen_id): se copia el vendedor de esa cotización
      select c.vendedor_tipo, c.vendedor_id, c.vendedor_nombre into o from public.vp_cotizaciones c
       where c.id = (to_jsonb(new)->>(case tg_table_name when 'vp_ventas' then 'cotizacion_id' else 'origen_id' end))::uuid;
      new.vendedor_tipo := o.vendedor_tipo; new.vendedor_id := o.vendedor_id; new.vendedor_nombre := o.vendedor_nombre;
    else
      new.vendedor_tipo := null; new.vendedor_id := null; new.vendedor_nombre := null;
    end if;
    return new;
  end if;
  if val is null then
    new.vendedor_tipo := null; new.vendedor_id := null; new.vendedor_nombre := null;
  elsif val = 'bfk' then
    new.vendedor_tipo := 'bfk'; new.vendedor_id := null; new.vendedor_nombre := 'BFK';
  elsif tg_op = 'UPDATE' and old.vendedor_tipo = 'vendedor' and old.vendedor_id = val then
    new.vendedor_tipo := old.vendedor_tipo; new.vendedor_id := old.vendedor_id; new.vendedor_nombre := old.vendedor_nombre;   -- sin cambio
  else
    select v.nombre into nom from public.vendedores v where v.id = val and v.activo is not false;
    if nom is null then raise exception 'VP_VENDEDOR: el vendedor elegido no existe o no está activo en el catálogo de BFK' using errcode = '22023'; end if;
    new.vendedor_tipo := 'vendedor'; new.vendedor_id := val; new.vendedor_nombre := nom;
  end if;
  return new;
end $$;
drop trigger if exists vp_20_vendedor on public.vp_cotizaciones;
drop trigger if exists vp_20_vendedor on public.vp_ventas;
create trigger vp_20_vendedor before insert or update on public.vp_cotizaciones for each row execute function public.vp_trg_vendedor();
create trigger vp_20_vendedor before insert or update on public.vp_ventas for each row execute function public.vp_trg_vendedor();

create or replace function public.vp_marcar_vendedor(p_valor text) returns void
language sql volatile set search_path = public, pg_temp as $$
  select set_config('vp.vendedor_fijar', '1', true), set_config('vp.vendedor', coalesce(p_valor, ''), true)
$$;
create or replace function public.vp_quitar_marca_vendedor() returns void
language sql volatile set search_path = public, pg_temp as $$
  select set_config('vp.vendedor_fijar', '', true), set_config('vp.vendedor', '', true)
$$;

-- Guardar cotización (función existente, sin cambios) + vendedor. p: lo mismo de vp_guardar_cotizacion y, opcional,
-- vendedor: 'bfk' | <vendedores.id> | '' (sin asignar). Sin la clave «vendedor», idéntico a vp_guardar_cotizacion.
create or replace function public.vp_guardar_cotizacion_v2(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r jsonb; c public.vp_cotizaciones%rowtype;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) = 'object' and p ? 'vendedor' then perform public.vp_marcar_vendedor(p->>'vendedor'); end if;
  r := public.vp_guardar_cotizacion(p);
  perform public.vp_quitar_marca_vendedor();
  select * into c from public.vp_cotizaciones where id = (r->>'id')::uuid;
  return r || jsonb_build_object('vendedor_tipo', c.vendedor_tipo, 'vendedor_id', c.vendedor_id, 'vendedor_nombre', c.vendedor_nombre);
end $$;

-- Venta directa (función existente, sin cambios) + vendedor (mismo formato).
create or replace function public.vp_crear_venta_directa_v2(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) = 'object' and p ? 'vendedor' then perform public.vp_marcar_vendedor(p->>'vendedor'); end if;
  r := public.vp_crear_venta_directa(p);
  perform public.vp_quitar_marca_vendedor();
  return r;
end $$;

create or replace function public.vp_vendedor_igual(p_tipo text, p_id text, p_valor text) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(case when nullif(btrim(coalesce(p_valor, '')), '') is null then p_tipo is null
              when btrim(p_valor) = 'bfk' then p_tipo = 'bfk'
              else p_tipo = 'vendedor' and p_id = btrim(p_valor) end, false)
$$;

-- Asignar o cambiar el vendedor. p_tabla: 'cotizacion' | 'venta'. p_vendedor: 'bfk' | <vendedores.id> | '' (sin asignar).
create or replace function public.vp_asignar_vendedor(p_tabla text, p_id uuid, p_vendedor text, p_version int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; v public.vp_ventas%rowtype; v_tipo text; vid text; ver int; nom text;
begin
  perform public.vp_exigir_usuario();
  if p_tabla = 'cotizacion' then
    select * into c from public.vp_cotizaciones where id = p_id for update;
    if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
    if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador asigna el vendedor' using errcode = '42501'; end if;
    if c.version <> coalesce(p_version, -1) then raise exception 'VP409: la cotización cambió; recarga antes de continuar' using errcode = '40001'; end if;
    if c.vendedor_tipo is not null and c.estado <> 'borrador' and not public.vp_es_admin() then
      raise exception 'VP_PERMISO: la cotización ya fue enviada con vendedor; solo un administrador lo cambia' using errcode = '42501'; end if;
    if public.vp_vendedor_igual(c.vendedor_tipo, c.vendedor_id, p_vendedor) then
      return jsonb_build_object('id', c.id, 'version', c.version, 'vendedor_tipo', c.vendedor_tipo, 'vendedor_id', c.vendedor_id, 'vendedor_nombre', c.vendedor_nombre, 'sin_cambios', true); end if;
    perform public.vp_marcar_vendedor(p_vendedor);
    update public.vp_cotizaciones set vendedor_tipo = vendedor_tipo where id = c.id returning vendedor_tipo, vendedor_id, vendedor_nombre, version into v_tipo, vid, nom, ver;
  elsif p_tabla = 'venta' then
    v := public.vp_venta_vigente(p_id);
    if not public.vp_es_responsable_venta(v.id) then raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador asigna el vendedor' using errcode = '42501'; end if;
    if v.version <> coalesce(p_version, -1) then raise exception 'VP409: otra persona modificó esta venta; recarga antes de guardar' using errcode = '40001'; end if;
    if v.vendedor_tipo is not null and not public.vp_es_admin() then
      raise exception 'VP_PERMISO: la venta ya tiene vendedor; solo un administrador lo cambia' using errcode = '42501'; end if;
    if public.vp_vendedor_igual(v.vendedor_tipo, v.vendedor_id, p_vendedor) then
      return jsonb_build_object('id', v.id, 'version', v.version, 'vendedor_tipo', v.vendedor_tipo, 'vendedor_id', v.vendedor_id, 'vendedor_nombre', v.vendedor_nombre, 'sin_cambios', true); end if;
    perform public.vp_marcar_vendedor(p_vendedor);
    update public.vp_ventas set vendedor_tipo = vendedor_tipo where id = v.id returning vendedor_tipo, vendedor_id, vendedor_nombre, version into v_tipo, vid, nom, ver;
  else raise exception 'VP_DATO: tipo de documento desconocido' using errcode = '22023'; end if;
  perform public.vp_quitar_marca_vendedor();
  return jsonb_build_object('id', p_id, 'version', ver, 'vendedor_tipo', v_tipo, 'vendedor_id', vid, 'vendedor_nombre', nom);
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 2-3. Aportes de financiamiento y devoluciones
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
create table if not exists public.vp_fin_aportes (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  compra_grupo text check (compra_grupo is null or length(compra_grupo) <= 80),   -- compra con la que se registró (informativo)
  aportante_tipo text not null check (aportante_tipo in ('bfk','persona')),
  financiador_id text check (financiador_id is null or length(financiador_id) <= 80),   -- catálogo financiadores (BFK: Cuenta BFK)
  aportante_nombre text not null check (length(btrim(aportante_nombre)) between 2 and 150),
  monto numeric(16,0) not null check (monto > 0),
  fecha date not null,
  medio text not null check (medio in ('transferencia','deposito','efectivo','cheque','vale_vista','tarjeta','otro')),
  comprobante text check (comprobante is null or length(comprobante) <= 120),
  documento_id uuid references public.vp_documentos(id),
  observacion text check (observacion is null or length(observacion) <= 1000),
  estado text not null default 'vigente' check (estado in ('vigente','anulado')),
  anulado_en timestamptz, anulado_por uuid, anulacion_motivo text,
  clave_idempotencia uuid not null unique,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  check (aportante_tipo = 'persona' or (financiador_id is not null and aportante_nombre = 'BFK (fondos propios)')),
  check (estado <> 'anulado' or (anulado_en is not null and length(btrim(coalesce(anulacion_motivo, ''))) >= 3))
);
create index if not exists vp_fin_aportes_venta on public.vp_fin_aportes (venta_id);

create table if not exists public.vp_fin_devoluciones (
  id uuid primary key default gen_random_uuid(),
  aporte_id uuid not null references public.vp_fin_aportes(id),
  venta_id uuid not null references public.vp_ventas(id),
  monto numeric(16,0) not null check (monto > 0),
  fecha date not null,
  medio text not null check (medio in ('transferencia','deposito','efectivo','cheque','vale_vista','tarjeta','otro')),
  comprobante text check (comprobante is null or length(comprobante) <= 120),
  documento_id uuid references public.vp_documentos(id),
  observacion text check (observacion is null or length(observacion) <= 1000),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  clave_idempotencia uuid not null unique,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  check (estado <> 'anulada' or (anulada_en is not null and length(btrim(coalesce(anulacion_motivo, ''))) >= 3))
);
create index if not exists vp_fin_devoluciones_aporte on public.vp_fin_devoluciones (aporte_id);
create index if not exists vp_fin_devoluciones_venta on public.vp_fin_devoluciones (venta_id);

-- Historial (sensible: solo administrador y responsable lo ven, como compras y costos).
create or replace function public.vp_fin_auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; dif jsonb := '{}'::jsonb; k text; r jsonb;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if n->k is distinct from o->k then dif := dif || jsonb_build_object(k, jsonb_build_object('antes', o->k, 'despues', n->k)); end if;
    end loop;
    if dif = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then dif := n; else dif := o; end if;
  r := coalesce(n, o);
  insert into public.vp_historial (tabla, registro_id, venta_id, accion, cambios, sensible, usuario_id, usuario_nombre)
  values (tg_table_name, r->>'id', (r->>'venta_id')::uuid, case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'modificar' else 'eliminar' end,
          dif, true, auth.uid(), public.vp_nombre(auth.uid()));
  return null;
end $$;
-- Solo se anulan (con motivo); los montos, fechas, aportante y aporte de origen no se modifican.
create or replace function public.vp_fin_proteger() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (to_jsonb(new) - array['estado','anulado_en','anulado_por','anulada_en','anulada_por','anulacion_motivo'])
     is distinct from (to_jsonb(old) - array['estado','anulado_en','anulado_por','anulada_en','anulada_por','anulacion_motivo']) then
    raise exception 'VP_FINANCIAMIENTO: un aporte o una devolución registrados no se modifican; anúlalos con motivo y registra el correcto' using errcode = '42501'; end if;
  if old.estado <> 'vigente' then raise exception 'VP_FINANCIAMIENTO: el registro ya está anulado' using errcode = '42501'; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['vp_fin_aportes','vp_fin_devoluciones'] loop
    execute format('drop trigger if exists vp_05_sin_borrado on public.%I', t);
    execute format('create trigger vp_05_sin_borrado before delete on public.%I for each row execute function public.vp_sin_borrado()', t);
    execute format('drop trigger if exists vp_10_proteger on public.%I', t);
    execute format('create trigger vp_10_proteger before update on public.%I for each row execute function public.vp_fin_proteger()', t);
    execute format('drop trigger if exists vp_99_auditar on public.%I', t);
    execute format('create trigger vp_99_auditar after insert or update or delete on public.%I for each row execute function public.vp_fin_auditar()', t);
  end loop;
end $$;

create or replace function public.vp_fin_pesos(n numeric) returns text
language sql immutable set search_path = public, pg_temp as $$ select '$' || replace(to_char(round(coalesce(n, 0)), 'FM999,999,999,990'), ',', '.') $$;

-- Total pagado de las compras de la venta que se financian aquí (registradas en Ventas privadas, vigentes, con IVA).
create or replace function public.vp_fin_total_compras(p_venta uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(total), 0) from public.vp_compras where venta_id = p_venta and estado = 'vigente' and origen = 'registro'
$$;
create or replace function public.vp_fin_validar(p_venta uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare tc numeric := public.vp_fin_total_compras(p_venta); ta numeric;
begin
  select coalesce(sum(monto), 0) into ta from public.vp_fin_aportes where venta_id = p_venta and estado = 'vigente';
  if ta > tc then
    raise exception 'VP_FINANCIAMIENTO: lo financiado (%) superaría el total pagado de las compras (%) en %; revisa los montos',
      public.vp_fin_pesos(ta), public.vp_fin_pesos(tc), public.vp_fin_pesos(ta - tc) using errcode = '23514'; end if;
end $$;

-- Venta bloqueada (vigente o anulada: lo aportado y lo devuelto siguen existiendo aunque la venta se anule).
create or replace function public.vp_fin_bloquear_venta(p_venta uuid) returns public.vp_ventas
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype;
begin
  select * into v from public.vp_ventas where id = p_venta for update;
  if not found then raise exception 'VP_VENTA: venta no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_venta(v.id) then
    raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra el financiamiento' using errcode = '42501'; end if;
  return v;
end $$;

-- Un aporte (la venta ya está bloqueada y el permiso comprobado). a: {clave, aportante_tipo: 'bfk'|'persona', financiador_id?,
-- aportante_nombre? (otra persona), monto, fecha, medio, comprobante?, documento_id?, observacion?}
create or replace function public.vp_fin_aporte_interno(p_venta uuid, a jsonb, p_grupo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k uuid; ap public.vp_fin_aportes%rowtype; f public.financiadores%rowtype; v_tipo text := a->>'aportante_tipo'; nom text; fid text;
  m numeric := round(public.vp_num(a, 'monto')); fe date := public.vp_fecha(a, 'fecha'); med text := coalesce(nullif(a->>'medio', ''), 'transferencia');
begin
  if jsonb_typeof(a) is distinct from 'object' then raise exception 'VP_DATO: aporte inválido' using errcode = '22023'; end if;
  begin k := nullif(a->>'clave', '')::uuid; exception when others then k := null; end;
  if k is null then raise exception 'VP_DATO: falta la clave del aporte' using errcode = '22023'; end if;
  select * into ap from public.vp_fin_aportes where clave_idempotencia = k;
  if found then
    if ap.venta_id <> p_venta then raise exception 'VP_DUPLICADO: la clave del aporte pertenece a otra venta' using errcode = '23505'; end if;
    return jsonb_build_object('id', ap.id, 'ya_existia', true);
  end if;
  if m is null or m <= 0 then raise exception 'VP_DATO: el monto aportado debe ser mayor que cero' using errcode = '23514'; end if;
  if fe is null or fe > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha del aporte (no futura)' using errcode = '23514'; end if;
  if med not in ('transferencia','deposito','efectivo','cheque','vale_vista','tarjeta','otro') then raise exception 'VP_DATO: medio de pago inválido' using errcode = '22023'; end if;
  if v_tipo = 'bfk' then
    select * into f from public.financiadores where tipo = 'propio' order by id limit 1;
    fid := f.id; nom := 'BFK (fondos propios)';
  elsif v_tipo = 'persona' then
    fid := nullif(btrim(coalesce(a->>'financiador_id', '')), '');
    if fid is not null then
      select * into f from public.financiadores where id = fid;
      if not found then raise exception 'VP_DATO: la persona elegida no está en el catálogo de financiadores' using errcode = '23503'; end if;
      if f.tipo = 'propio' then raise exception 'VP_DATO: «%» son fondos propios de BFK: elige «BFK con fondos propios»', f.nombre using errcode = '23514'; end if;
      nom := f.nombre;
    else
      nom := public.vp_txt(a->>'aportante_nombre', 150);
      if nom is null or length(nom) < 3 then raise exception 'VP_DATO: indica el nombre de la persona que aporta' using errcode = '23514'; end if;
      if lower(nom) in ('bfk', 'bfk ltda', 'bfk ltda.', 'cuenta bfk', 'bfk (fondos propios)') then
        raise exception 'VP_DATO: si el dinero es de la empresa, elige «BFK con fondos propios»' using errcode = '23514'; end if;
      select * into f from public.financiadores where lower(btrim(nombre)) = lower(nom) and tipo <> 'propio' limit 1;
      if found then fid := f.id; nom := f.nombre; end if;   -- misma persona del catálogo: se vincula a ella (sin duplicarla)
    end if;
  else raise exception 'VP_DATO: indica quién financia (BFK con fondos propios o una persona)' using errcode = '23514'; end if;
  insert into public.vp_fin_aportes (venta_id, compra_grupo, aportante_tipo, financiador_id, aportante_nombre, monto, fecha, medio, comprobante,
    documento_id, observacion, clave_idempotencia)
  values (p_venta, public.vp_txt(p_grupo, 80), v_tipo, fid, nom, m, fe, med, public.vp_txt(a->>'comprobante', 120),
    public.vp_validar_documento(nullif(a->>'documento_id', '')::uuid, p_venta, array['compra','comprobante_pago']), public.vp_txt(a->>'observacion', 1000), k)
  returning * into ap;
  return jsonb_build_object('id', ap.id, 'ya_existia', false);
end $$;

-- Aportes de una venta (uno o varios). p: {venta_id, aportes: [...], compra_grupo?}
create or replace function public.vp_fin_registrar_aportes(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; a jsonb; res jsonb := '[]'::jsonb; nuevos int := 0; x jsonb;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  v := public.vp_fin_bloquear_venta(nullif(p->>'venta_id', '')::uuid);
  if jsonb_typeof(p->'aportes') is distinct from 'array' or jsonb_array_length(p->'aportes') = 0 then raise exception 'VP_DATO: indica al menos un aporte' using errcode = '22023'; end if;
  if jsonb_array_length(p->'aportes') > 20 then raise exception 'VP_DATO: máximo 20 aportes por registro' using errcode = '22023'; end if;
  for a in select * from jsonb_array_elements(p->'aportes') loop
    x := public.vp_fin_aporte_interno(v.id, a, p->>'compra_grupo');
    if not (x->>'ya_existia')::boolean then nuevos := nuevos + 1; end if;
    res := res || x;
  end loop;
  perform public.vp_fin_validar(v.id);
  return jsonb_build_object('aportes', res, 'ya_existia', nuevos = 0);
end $$;

-- «Registrar compra» desde la cotización aprobada + financiamiento, en UNA transacción. La compra la registra, sin cambios,
-- vp_registrar_compras_cotizacion (mismas validaciones, mismo costo real). p: {compra: <su p>, aportes: [...]}.
create or replace function public.vp_registrar_compra_financiada(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r jsonb; v public.vp_ventas%rowtype; a jsonb; res jsonb := '[]'::jsonb;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'compra') is distinct from 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  r := public.vp_registrar_compras_cotizacion(p->'compra');                 -- bloquea la venta y valida el responsable
  if jsonb_typeof(p->'aportes') = 'array' and jsonb_array_length(p->'aportes') > 0 then
    v := public.vp_fin_bloquear_venta(nullif(p->'compra'->>'venta_id', '')::uuid);
    if jsonb_array_length(p->'aportes') > 20 then raise exception 'VP_DATO: máximo 20 aportes por compra' using errcode = '22023'; end if;
    for a in select * from jsonb_array_elements(p->'aportes') loop
      res := res || public.vp_fin_aporte_interno(v.id, a, split_part(coalesce(p->'compra'->'filas'->0->>'pedido', ''), '-', 1));
    end loop;
    perform public.vp_fin_validar(v.id);
  end if;
  return r || jsonb_build_object('aportes', res);
end $$;

-- Registro manual de la compra (función existente vp_registrar_compra, sin cambios) + financiamiento, en UNA transacción y con
-- clave: un reintento no duplica la compra. p: {clave, compra: <su p>, aportes: [...]}. Un gasto ya registrado en Gastos no se
-- financia aquí (su pago ya está registrado).
create or replace function public.vp_registrar_compra_manual_financiada(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k uuid; cl text; v public.vp_ventas%rowtype; r jsonb; id_compra uuid; a jsonb; res jsonb := '[]'::jsonb; ya boolean := false;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'compra') is distinct from 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  begin k := nullif(p->>'clave', '')::uuid; exception when others then k := null; end;
  if k is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  cl := 'man-' || k::text;
  v := public.vp_fin_bloquear_venta(nullif(p->'compra'->>'venta_id', '')::uuid);   -- serializa reintentos simultáneos
  select id into id_compra from public.vp_compras where clave = cl;
  if found then ya := true;
  else
    if coalesce(p->'compra'->>'origen', 'registro') = 'gasto_existente' and jsonb_array_length(coalesce(p->'aportes', '[]'::jsonb)) > 0 then
      raise exception 'VP_FINANCIAMIENTO: un gasto ya registrado en Gastos no se financia aquí (su pago ya está registrado)' using errcode = '23514'; end if;
    r := public.vp_registrar_compra(p->'compra');
    id_compra := (r->>'id')::uuid;
    update public.vp_compras set clave = cl where id = id_compra;
  end if;
  if jsonb_typeof(p->'aportes') = 'array' then
    if jsonb_array_length(p->'aportes') > 20 then raise exception 'VP_DATO: máximo 20 aportes por compra' using errcode = '22023'; end if;
    for a in select * from jsonb_array_elements(p->'aportes') loop
      res := res || public.vp_fin_aporte_interno(v.id, a, cl);
    end loop;
    perform public.vp_fin_validar(v.id);
  end if;
  return jsonb_build_object('id', id_compra, 'ya_existia', ya, 'aportes', res);
end $$;

-- Devolución de un aporte PERSONAL (parcial o total). p: {clave, aporte_id, monto, fecha, medio, comprobante?, documento_id?, observacion?}
create or replace function public.vp_fin_registrar_devolucion(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k uuid; ap public.vp_fin_aportes%rowtype; dv public.vp_fin_devoluciones%rowtype; v public.vp_ventas%rowtype; ya numeric;
  m numeric := round(public.vp_num(p, 'monto')); fe date := public.vp_fecha(p, 'fecha'); med text := coalesce(nullif(p->>'medio', ''), 'transferencia'); vid uuid;
begin
  perform public.vp_exigir_usuario();
  begin k := nullif(p->>'clave', '')::uuid; exception when others then k := null; end;
  if k is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  select venta_id into vid from public.vp_fin_aportes where id = nullif(p->>'aporte_id', '')::uuid;
  if vid is null then raise exception 'VP_FINANCIAMIENTO: aporte no encontrado' using errcode = 'P0002'; end if;
  v := public.vp_fin_bloquear_venta(vid);
  select * into dv from public.vp_fin_devoluciones where clave_idempotencia = k;
  if found then return jsonb_build_object('id', dv.id, 'ya_existia', true); end if;
  select * into ap from public.vp_fin_aportes where id = (p->>'aporte_id')::uuid for update;
  if ap.estado <> 'vigente' then raise exception 'VP_FINANCIAMIENTO: el aporte está anulado' using errcode = '23514'; end if;
  if ap.aportante_tipo <> 'persona' then
    raise exception 'VP_DEVOLUCION: BFK con fondos propios no genera deuda con una persona: no hay nada que devolver' using errcode = '23514'; end if;
  if m is null or m <= 0 then raise exception 'VP_DATO: el monto devuelto debe ser mayor que cero' using errcode = '23514'; end if;
  if fe is null or fe > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha de la devolución (no futura)' using errcode = '23514'; end if;
  if fe < ap.fecha then raise exception 'VP_FECHA: la devolución no puede ser anterior al aporte (%)', to_char(ap.fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;
  if med not in ('transferencia','deposito','efectivo','cheque','vale_vista','tarjeta','otro') then raise exception 'VP_DATO: medio de pago inválido' using errcode = '22023'; end if;
  select coalesce(sum(monto), 0) into ya from public.vp_fin_devoluciones where aporte_id = ap.id and estado = 'vigente';
  if ya + m > ap.monto then
    raise exception 'VP_DEVOLUCION: se devolvería más que el saldo pendiente; a % le quedan % por devolver de este aporte',
      ap.aportante_nombre, public.vp_fin_pesos(ap.monto - ya) using errcode = '23514'; end if;
  insert into public.vp_fin_devoluciones (aporte_id, venta_id, monto, fecha, medio, comprobante, documento_id, observacion, clave_idempotencia)
  values (ap.id, ap.venta_id, m, fe, med, public.vp_txt(p->>'comprobante', 120),
    public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, ap.venta_id, array['compra','comprobante_pago']), public.vp_txt(p->>'observacion', 1000), k)
  returning * into dv;
  return jsonb_build_object('id', dv.id, 'ya_existia', false, 'pendiente', ap.monto - ya - m);
end $$;

-- Anulación con motivo (el registro se conserva y deja de contar). p_tabla: 'aporte' | 'devolucion'.
create or replace function public.vp_fin_anular(p_tabla text, p_id uuid, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare vid uuid; est text;
begin
  perform public.vp_exigir_usuario();
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'VP_DATO: indica el motivo de la anulación' using errcode = '23514'; end if;
  if p_tabla = 'aporte' then select venta_id into vid from public.vp_fin_aportes where id = p_id;
  elsif p_tabla = 'devolucion' then select venta_id into vid from public.vp_fin_devoluciones where id = p_id;
  else raise exception 'VP_DATO: tipo de registro desconocido' using errcode = '22023'; end if;
  if vid is null then raise exception 'VP: registro no encontrado' using errcode = 'P0002'; end if;
  perform public.vp_fin_bloquear_venta(vid);
  if p_tabla = 'aporte' then
    select estado into est from public.vp_fin_aportes where id = p_id for update;
    if est <> 'vigente' then raise exception 'VP_ESTADO: el aporte ya está anulado' using errcode = '23514'; end if;
    if exists (select 1 from public.vp_fin_devoluciones where aporte_id = p_id and estado = 'vigente') then
      raise exception 'VP_FINANCIAMIENTO: el aporte tiene devoluciones vigentes; anúlalas primero (se conservan en el historial)' using errcode = '23514'; end if;
    update public.vp_fin_aportes set estado = 'anulado', anulado_en = now(), anulado_por = auth.uid(), anulacion_motivo = btrim(p_motivo) where id = p_id;
    return jsonb_build_object('id', p_id, 'estado', 'anulado');
  end if;
  select estado into est from public.vp_fin_devoluciones where id = p_id for update;
  if est <> 'vigente' then raise exception 'VP_ESTADO: la devolución ya está anulada' using errcode = '23514'; end if;
  update public.vp_fin_devoluciones set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), anulacion_motivo = btrim(p_motivo) where id = p_id;
  return jsonb_build_object('id', p_id, 'estado', 'anulada');
end $$;

-- Anular una compra no puede dejar lo financiado por encima de lo pagado (se anula o corrige antes el aporte).
create or replace function public.vp_fin_trg_compra() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.estado = 'vigente' and new.estado <> 'vigente' and old.origen = 'registro' then
    if (select coalesce(sum(monto), 0) from public.vp_fin_aportes where venta_id = old.venta_id and estado = 'vigente') > public.vp_fin_total_compras(old.venta_id) then
      raise exception 'VP_FINANCIAMIENTO: esta compra está financiada; anula primero los aportes que la financian (y sus devoluciones) para que lo financiado no supere lo pagado' using errcode = '23514'; end if;
  end if;
  return null;
end $$;
drop trigger if exists vp_30_financiamiento on public.vp_compras;
create trigger vp_30_financiamiento after update of estado on public.vp_compras for each row execute function public.vp_fin_trg_compra();

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Vistas (security_invoker; solo administrador y responsable de la venta)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
create or replace view public.vp_fin_resumen with (security_invoker = true) as
select v.id as venta_id, v.folio, v.estado, v.fecha, v.responsable_id,
  coalesce(c.compras, 0) as total_compras, coalesce(c.gastos, 0) as gastos_vinculados, coalesce(c.n, 0) as n_compras,
  coalesce(a.bfk, 0) as financiado_bfk, coalesce(a.personas, 0) as financiado_personas, coalesce(a.total, 0) as financiado,
  greatest(coalesce(c.compras, 0) - coalesce(a.total, 0), 0) as sin_informar,
  coalesce(d.devuelto, 0) as devuelto, coalesce(a.personas, 0) - coalesce(d.devuelto, 0) as pendiente_devolucion,
  coalesce(a.n, 0) as n_aportes
from public.vp_ventas v
left join lateral (select sum(k.total) filter (where k.origen = 'registro') as compras, sum(k.total) filter (where k.origen = 'gasto_existente') as gastos,
                          count(*) filter (where k.origen = 'registro') as n
                   from public.vp_compras k where k.venta_id = v.id and k.estado = 'vigente') c on true
left join lateral (select sum(x.monto) as total, sum(x.monto) filter (where x.aportante_tipo = 'bfk') as bfk, sum(x.monto) filter (where x.aportante_tipo = 'persona') as personas,
                          count(*) as n from public.vp_fin_aportes x where x.venta_id = v.id and x.estado = 'vigente') a on true
left join lateral (select sum(y.monto) as devuelto from public.vp_fin_devoluciones y where y.venta_id = v.id and y.estado = 'vigente') d on true
where public.vp_es_responsable_venta(v.id);

-- Por aportante (todas las ventas visibles). clave: financiador del catálogo o nombre (otra persona).
create or replace view public.vp_fin_aportantes with (security_invoker = true) as
select x.aportante_tipo, coalesce(x.financiador_id, 'nombre:' || lower(btrim(x.aportante_nombre))) as clave,
  x.financiador_id, min(x.aportante_nombre) as nombre,
  sum(x.monto) as aportado, coalesce(sum(dv.devuelto), 0) as devuelto,
  case when x.aportante_tipo = 'persona' then sum(x.monto) - coalesce(sum(dv.devuelto), 0) else 0 end as pendiente_devolucion,
  count(distinct x.venta_id) as n_ventas, count(*) as n_aportes, max(x.fecha) as ultimo_aporte
from public.vp_fin_aportes x
left join lateral (select sum(y.monto) as devuelto from public.vp_fin_devoluciones y where y.aporte_id = x.id and y.estado = 'vigente') dv on true
where x.estado = 'vigente' and public.vp_es_responsable_venta(x.venta_id)
group by x.aportante_tipo, coalesce(x.financiador_id, 'nombre:' || lower(btrim(x.aportante_nombre))), x.financiador_id;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. RLS y privilegios (escritura solo por funciones; lectura: administrador y responsable de la venta)
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ declare t text; begin
  foreach t in array array['vp_fin_aportes','vp_fin_devoluciones'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists vp_leer on public.%I', t);
    execute format('create policy vp_leer on public.%I for select to authenticated using (public.vp_es_responsable_venta(venta_id))', t);
  end loop;
  foreach t in array array['vp_fin_resumen','vp_fin_aportantes'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('vp_trg_vendedor','vp_marcar_vendedor','vp_quitar_marca_vendedor','vp_guardar_cotizacion_v2','vp_crear_venta_directa_v2',
        'vp_asignar_vendedor','vp_vendedor_igual','vp_fin_auditar','vp_fin_proteger','vp_fin_total_compras','vp_fin_validar','vp_fin_pesos','vp_fin_bloquear_venta',
        'vp_fin_aporte_interno','vp_fin_registrar_aportes','vp_registrar_compra_financiada','vp_registrar_compra_manual_financiada',
        'vp_fin_registrar_devolucion','vp_fin_anular','vp_fin_trg_compra') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    if f.proname in ('vp_guardar_cotizacion_v2','vp_crear_venta_directa_v2','vp_asignar_vendedor','vp_fin_registrar_aportes','vp_registrar_compra_financiada',
        'vp_registrar_compra_manual_financiada','vp_fin_registrar_devolucion','vp_fin_anular') then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
