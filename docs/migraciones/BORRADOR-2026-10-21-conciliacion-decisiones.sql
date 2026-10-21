-- =====================================================================================
-- BFK DATOS — CONCILIACIÓN BANCARIA: DECISIONES (VINCULAR / NO CORRESPONDE) (BORRADOR, NO APLICADO)
-- Aditiva y reversible (BORRADOR-2026-10-21-conciliacion-decisiones-deshacer.sql). No modifica datos existentes.
--
-- Por qué una tabla aparte: vincular un movimiento bancario con un registro BFK que YA existe no debe cambiar ese
-- registro (cobro, gasto, pago, devolución, aporte). Hoy el único vínculo posible escribe marca_cartola en la fila
-- financiera (cambia la huella). Aquí la decisión queda en conciliacion_decisiones y las filas financieras no se tocan.
--
-- Crea:
--   · conciliacion_decisiones                bitácora de decisiones por movimiento bancario (marca cart:…), sobre
--     cobros, devoluciones a financiadores, gastos (incluido el pago al SII), pagos a vendedores, aportes/retiros y
--     compras pagadas con fondos propios (Cuenta BFK):
--       vinculado  = «este movimiento ES este registro» (no crea nada);
--       rechazado  = «este registro NO es este movimiento» (deja de proponerse).
--     Un registro solo puede estar vinculado a UN movimiento; un movimiento, a un solo grupo de registros.
--   · conciliacion_decidir(...)              única vía de escritura (validaciones abajo).
--   · conciliacion_anular(id, motivo)        deshace una decisión equivocada (queda registrada, no se borra).
--   · conciliacion_guardia_registro()        disparador en las 5 tablas: impide REGISTRAR desde la cartola (o marcar)
--     un movimiento que ya está vinculado a un registro existente, y marcar un registro vinculado a otro movimiento.
--     Solo actúa cuando se escribe marca_cartola: los registros manuales no cambian en nada.
-- NO modifica: registros existentes, montos, OC, compras, facturas, cobros, comisiones, financiadores, FIFO, F29,
-- saldos ni las funciones actuales de la cartola.
-- =====================================================================================
begin;
set local lock_timeout = '5s';

create table public.conciliacion_decisiones (
  id               bigserial primary key,
  marca            text not null,                     -- movimiento bancario (cart:AAAAMMDD:cargo:abono:saldo:n)
  decision         text not null check (decision in ('vinculado', 'rechazado')),
  tabla            text not null check (tabla in ('eventos_pago_cliente', 'eventos_pago_financiamiento', 'gastos_indirectos', 'pagos_vendedor', 'aportes_socios', 'eventos_compra')),
  registro_id      text not null,                     -- sin FK: la bitácora sobrevive a una eliminación autorizada
  monto_registro   numeric not null,
  mov_fecha        date not null,
  mov_monto        numeric not null,
  mov_sentido      text not null check (mov_sentido in ('entra', 'sale')),
  mov_operacion    text,
  mov_descripcion  text,
  usuario          uuid not null,
  usuario_nombre   text,
  creado_en        timestamptz not null default now(),
  anulado_en       timestamptz,
  anulado_por      uuid,
  motivo_anulacion text
);
create unique index conc_dec_registro_vinculado on public.conciliacion_decisiones (tabla, registro_id) where decision = 'vinculado' and anulado_en is null;
create unique index conc_dec_vigente on public.conciliacion_decisiones (marca, tabla, registro_id) where anulado_en is null;
create index conc_dec_marca on public.conciliacion_decisiones (marca);
alter table public.conciliacion_decisiones enable row level security;
create policy conc_dec_leer on public.conciliacion_decisiones for select to authenticated
  using (exists (select 1 from public.perfiles p where p.id = auth.uid()));
revoke all on public.conciliacion_decisiones from public, anon, authenticated;
grant select on public.conciliacion_decisiones to authenticated;
grant all on public.conciliacion_decisiones to service_role;
revoke all on sequence public.conciliacion_decisiones_id_seq from public, anon, authenticated;
grant usage, select on sequence public.conciliacion_decisiones_id_seq to service_role;

-- Decide sobre UN movimiento bancario (marca) y uno o varios registros BFK de UNA tabla.
--  vinculado: el movimiento es posterior al cierre (07/10/2026) y no futuro; nadie lo registró desde la cartola ni lo
--    vinculó antes; los registros existen, están vigentes, pasaron por el banco (no retención, no «fuera del banco», no
--    vale vista sin cobrar), no tienen marca de otro movimiento, no están vinculados a otro movimiento, son del mismo
--    sentido, están a ±45 días (fecha contable vs. bancaria) y SUMAN EXACTO el monto del banco.
--  rechazado: deja constancia de que ese registro no corresponde a ese movimiento (no cambia nada más).
create function public.conciliacion_decidir(p_marca text, p_decision text, p_tabla text, p_ids text[],
                                            p_operacion text default null, p_descripcion text default null) returns jsonb
  language plpgsql security definer
  set search_path to ''
as $_$
declare
  v_uid uuid := auth.uid(); v_nombre text; v_mov record; v_hoy date := (pg_catalog.now() at time zone 'America/Santiago')::date;
  v_sentido text; v_monto_mov numeric; v_r record; v_total numeric := 0; v_n int := 0; v_ids bigint[] := '{}'; v_id bigint;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida' using errcode = '42501'; end if;
  select p.nombre into v_nombre from public.perfiles p where p.id = v_uid;
  if not found then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  if p_decision not in ('vinculado', 'rechazado') then raise exception 'Decisión no válida: %', p_decision using errcode = '22023'; end if;
  if p_tabla not in ('eventos_pago_cliente', 'eventos_pago_financiamiento', 'gastos_indirectos', 'pagos_vendedor', 'aportes_socios', 'eventos_compra') then
    raise exception 'Tabla no permitida: %', p_tabla using errcode = '22023'; end if;
  if coalesce(pg_catalog.cardinality(p_ids), 0) not between 1 and 20
     or (select count(distinct x) from pg_catalog.unnest(p_ids) x) <> pg_catalog.cardinality(p_ids) then
    raise exception 'Cantidad de registros no válida' using errcode = '22023'; end if;
  select * into v_mov from public.cartola_leer_marca(p_marca);
  v_sentido := case when v_mov.abono > 0 then 'entra' else 'sale' end;
  v_monto_mov := v_mov.cargo + v_mov.abono;
  if v_mov.fecha <= date '2026-10-07' then raise exception 'CONC: movimiento anterior al cierre de conciliación (07/10/2026): solo consulta' using errcode = '22023'; end if;
  if v_mov.fecha > v_hoy then raise exception 'CONC: la fecha del movimiento es futura' using errcode = '22023'; end if;
  if (p_tabla = 'eventos_pago_cliente') and v_sentido <> 'entra' or p_tabla in ('eventos_pago_financiamiento', 'gastos_indirectos', 'pagos_vendedor', 'eventos_compra') and v_sentido <> 'sale' then
    raise exception 'CONC: el tipo de registro no corresponde al sentido del movimiento' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bfk_cartola:' || p_marca, 0));   -- misma llave que el registro

  -- Registros pedidos (vigentes) con su monto, fecha, marca y si pasaron por el banco.
  for v_r in execute pg_catalog.format($q$
      select e.id::text id, case when %L = 'eventos_compra' then (pg_catalog.to_jsonb(e) ->> 'costo_compra')::numeric else public.cartola_monto(%L, pg_catalog.to_jsonb(e)) end monto,
             e.fecha::date fecha, pg_catalog.to_jsonb(e) ->> 'marca_cartola' marca,
             case %L
               when 'eventos_pago_cliente' then coalesce(pg_catalog.to_jsonb(e) ->> 'medio_pago', 'transferencia') not in ('retencion', 'fuera_banco')
                    and (coalesce(pg_catalog.to_jsonb(e) ->> 'medio_pago', 'transferencia') = 'transferencia' or coalesce((pg_catalog.to_jsonb(e) ->> 'cobrado_en_banco')::boolean, false))
               when 'gastos_indirectos' then pg_catalog.btrim(coalesce(pg_catalog.to_jsonb(e) ->> 'subcategoria', '')) <> 'Retención (sin movimiento bancario)'
               when 'aportes_socios' then pg_catalog.btrim(coalesce(pg_catalog.to_jsonb(e) ->> 'medio', '')) <> 'Sin movimiento BancoEstado comprobado'
               when 'eventos_compra' then exists (select 1 from public.financiadores f where f.tipo = 'propio' and f.id = coalesce(pg_catalog.to_jsonb(e) ->> 'financiador_id',
                    (select o.financiador_id from public.ordenes_compra_v2 o where o.id = pg_catalog.to_jsonb(e) ->> 'oc_id')))
               else true end en_banco,
             case when %L = 'aportes_socios' then case when pg_catalog.to_jsonb(e) ->> 'tipo' = 'retiro' then 'sale' else 'entra' end end sentido_aporte,
             %s anulado
        from public.%I e where e.id::text = any ($1)$q$,
      p_tabla, p_tabla, p_tabla, p_tabla, case when p_tabla = 'pagos_vendedor' then 'e.anulado_en is not null' else 'false' end, p_tabla) using p_ids loop
    v_n := v_n + 1;
    if v_r.anulado then raise exception 'CONC: el registro % está anulado', v_r.id using errcode = '22023'; end if;
    if p_decision = 'vinculado' then
      if not v_r.en_banco then raise exception 'CONC: el registro % no pasó por el banco (retención, fuera del banco, vale vista sin cobrar o compra de un financiador externo): no se vincula', v_r.id using errcode = '22023'; end if;
      if v_r.sentido_aporte is not null and v_r.sentido_aporte <> v_sentido then raise exception 'CONC: el aporte/retiro % no corresponde al sentido del movimiento', v_r.id using errcode = '22023'; end if;
      if v_r.marca is not null and v_r.marca <> p_marca then raise exception 'CONC: el registro % ya corresponde a otro movimiento bancario', v_r.id using errcode = '23505'; end if;
      if pg_catalog.abs(v_r.fecha - v_mov.fecha) > 45 then raise exception 'CONC: el registro % está a más de 45 días del movimiento', v_r.id using errcode = '22023'; end if;
      if exists (select 1 from public.conciliacion_decisiones d where d.tabla = p_tabla and d.registro_id = v_r.id and d.decision = 'vinculado' and d.anulado_en is null) then
        raise exception 'CONC: el registro % ya está vinculado a otro movimiento bancario', v_r.id using errcode = '23505'; end if;
      v_total := v_total + v_r.monto;
    end if;
  end loop;
  if v_n <> pg_catalog.cardinality(p_ids) then raise exception 'CONC: algún registro no existe' using errcode = 'P0002'; end if;

  if p_decision = 'vinculado' then
    if exists (select 1 from public.conciliacion_decisiones d where d.marca = p_marca and d.decision = 'vinculado' and d.anulado_en is null) then
      raise exception 'CONC: este movimiento bancario ya está vinculado' using errcode = '23505'; end if;
    if exists (select 1 from public.eventos_pago_cliente e where e.marca_cartola = p_marca
               union all select 1 from public.eventos_pago_financiamiento e where e.marca_cartola = p_marca
               union all select 1 from public.gastos_indirectos e where e.marca_cartola = p_marca
               union all select 1 from public.pagos_vendedor e where e.marca_cartola = p_marca and e.anulado_en is null
               union all select 1 from public.aportes_socios e where e.marca_cartola = p_marca) then
      raise exception 'CONC: este movimiento bancario ya fue registrado desde la cartola' using errcode = '23505'; end if;
    if v_total <> v_monto_mov then raise exception 'CONC: los registros suman % y el movimiento es %', v_total, v_monto_mov using errcode = '22023'; end if;
  end if;

  if exists (select 1 from public.conciliacion_decisiones d where d.marca = p_marca and d.tabla = p_tabla and d.registro_id = any (p_ids) and d.anulado_en is null) then
    raise exception 'CONC: ese registro ya tiene una decisión vigente para este movimiento: deshazla primero' using errcode = '23505'; end if;
  for v_r in execute pg_catalog.format('select e.id::text id, case when %L = ''eventos_compra'' then (pg_catalog.to_jsonb(e) ->> ''costo_compra'')::numeric else public.cartola_monto(%L, pg_catalog.to_jsonb(e)) end monto from public.%I e where e.id::text = any ($1) order by e.id', p_tabla, p_tabla, p_tabla) using p_ids loop
    insert into public.conciliacion_decisiones (marca, decision, tabla, registro_id, monto_registro, mov_fecha, mov_monto, mov_sentido, mov_operacion, mov_descripcion, usuario, usuario_nombre)
    values (p_marca, p_decision, p_tabla, v_r.id, v_r.monto, v_mov.fecha, v_monto_mov, v_sentido, pg_catalog.left(p_operacion, 40), pg_catalog.left(p_descripcion, 200), v_uid, v_nombre)
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;
  return pg_catalog.jsonb_build_object('ok', true, 'decision', p_decision, 'marca', p_marca, 'ids', pg_catalog.to_jsonb(v_ids));
end $_$;

-- Deshace una decisión (no la borra: queda quién y por qué).
create function public.conciliacion_anular(p_id bigint, p_motivo text default null) returns jsonb
  language plpgsql security definer
  set search_path to ''
as $_$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.perfiles p where p.id = v_uid) then raise exception 'Usuario sin perfil BFK' using errcode = '42501'; end if;
  update public.conciliacion_decisiones set anulado_en = pg_catalog.now(), anulado_por = v_uid, motivo_anulacion = pg_catalog.left(p_motivo, 200)
   where id = p_id and anulado_en is null;
  if not found then raise exception 'CONC: la decisión no existe o ya fue anulada' using errcode = 'P0002'; end if;
  return pg_catalog.jsonb_build_object('ok', true, 'id', p_id);
end $_$;

-- Guardia en las 5 tablas: solo actúa cuando se escribe marca_cartola (registro o vínculo desde la cartola).
create function public.conciliacion_guardia_registro() returns trigger
  language plpgsql security definer
  set search_path to ''
as $_$
begin
  if new.marca_cartola is null or (tg_op = 'UPDATE' and old.marca_cartola is not distinct from new.marca_cartola) then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bfk_cartola:' || new.marca_cartola, 0));
  if exists (select 1 from public.conciliacion_decisiones d where d.marca = new.marca_cartola and d.decision = 'vinculado' and d.anulado_en is null) then
    raise exception using errcode = '23505',
      message = pg_catalog.format('duplicate key: el movimiento bancario %s ya está conciliado con un registro existente de BFK', new.marca_cartola);
  end if;
  if exists (select 1 from public.conciliacion_decisiones d where d.tabla = tg_table_name and d.registro_id = new.id::text
             and d.decision = 'vinculado' and d.anulado_en is null and d.marca <> new.marca_cartola) then
    raise exception using errcode = '23505', message = 'duplicate key: el registro ya está conciliado con otro movimiento bancario';
  end if;
  return new;
end $_$;

create trigger conciliacion_guardia before insert or update of marca_cartola on public.eventos_pago_cliente for each row execute function public.conciliacion_guardia_registro();
create trigger conciliacion_guardia before insert or update of marca_cartola on public.eventos_pago_financiamiento for each row execute function public.conciliacion_guardia_registro();
create trigger conciliacion_guardia before insert or update of marca_cartola on public.gastos_indirectos for each row execute function public.conciliacion_guardia_registro();
create trigger conciliacion_guardia before insert or update of marca_cartola on public.pagos_vendedor for each row execute function public.conciliacion_guardia_registro();
create trigger conciliacion_guardia before insert or update of marca_cartola on public.aportes_socios for each row execute function public.conciliacion_guardia_registro();

revoke all on function public.conciliacion_decidir(text, text, text, text[], text, text), public.conciliacion_anular(bigint, text),
  public.conciliacion_guardia_registro() from public, anon, authenticated;
grant execute on function public.conciliacion_decidir(text, text, text, text[], text, text), public.conciliacion_anular(bigint, text) to authenticated, service_role;
grant execute on function public.conciliacion_guardia_registro() to service_role;

do $_$
begin
  if (select count(*) from pg_trigger where tgname = 'conciliacion_guardia') <> 5 then raise exception 'VERIFICACION: faltan disparadores'; end if;
  if has_table_privilege('authenticated', 'public.conciliacion_decisiones', 'insert')
     or has_table_privilege('authenticated', 'public.conciliacion_decisiones', 'update')
     or has_table_privilege('anon', 'public.conciliacion_decisiones', 'select')
     or has_function_privilege('anon', 'public.conciliacion_decidir(text, text, text, text[], text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.conciliacion_decidir(text, text, text, text[], text, text)', 'execute') then
    raise exception 'VERIFICACION: permisos incorrectos'; end if;
end $_$;
commit;
