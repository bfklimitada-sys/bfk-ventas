-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VENTAS PRIVADAS — compra anulada con reembolso del proveedor (24/11/2026, pedido de Kevin).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-24-vp-compra-reembolso.sql
-- Recuperación:                 BORRADOR-2026-11-24-vp-compra-reembolso-deshacer.sql
--
-- Caso: una compra de una venta privada no llegó; se cancela con el proveedor (que devuelve el dinero) y se compra en otro
-- lado. Antes había que anular la compra, buscar y corregir el gasto en Finanzas y adivinar el abono en la cartola.
--
-- Qué cambia (todo ADITIVO: columnas nulas en lo existente; ningún registro histórico se modifica al aplicar):
--   · public.gastos_indirectos: anulado_en, anulado_por, anulacion_motivo, anulacion_ref. Un gasto anulado NO se borra: sale
--       del resultado (gastos del mes, utilidad, informes), pero su cargo en el banco sigue existiendo para la conciliación.
--   · public.vp_compras: reembolso_estado ('pendiente' | 'recibido'), reembolso_monto, reembolso_fecha, reembolso_marca (marca
--       del abono de la cartola), reembolso_registrado_por/_en. Solo una compra ANULADA puede tener reembolso.
--   · public.vp_anular_compra(p_id, p_motivo, p_reembolso, p_monto): anula la compra (con las mismas reglas y permisos de
--       vp_anular) y, si el proveedor devolverá el dinero: deja el reembolso «pendiente» y, si la compra venía de Gastos
--       (gasto vinculado), anula ese gasto con el motivo y la referencia a la compra. Sin reembolso el gasto NO se toca
--       (el dinero se perdió: sigue siendo un gasto real).
--   · public.vp_registrar_reembolso(p_compra, p_fecha, p_monto, p_marca): marca el reembolso «recibido» (desde la cartola,
--       con la marca del abono, o a mano sin marca). A un reembolso recibido sin marca se le puede asignar después la marca
--       del abono. Una marca de la cartola se usa una sola vez en toda la base (cobros, gastos, aportes, pagos, decisiones).
--   · public.vp_deshacer_reembolso(p_compra, p_motivo): vuelve el reembolso a «pendiente» (error al confirmarlo).
-- Qué NO cambia: vp_anular (sigue igual para los demás registros y para quien la use directo), vp_registrar_compra,
--   vp_registrar_compras_cotizacion, vistas de margen (una compra anulada ya no era costo), conciliacion_decidir, F29/IVA
--   (el crédito de IVA se declara con los documentos del SII: la nota de crédito del proveedor la emite el proveedor),
--   permisos de tablas, historial (el disparador existente de vp_compras registra los cambios).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.vp_compras') is null or to_regclass('public.gastos_indirectos') is null then
    raise exception 'VPRE: falta Ventas privadas o Gastos; no se cambió nada'; end if;
  if to_regprocedure('public.vp_anular_compra(uuid,text,boolean,numeric)') is not null then
    raise exception 'VPRE: la migración ya está aplicada; no se cambió nada'; end if;
  if to_regprocedure('public.vp_anular(text,uuid,text)') is null then
    raise exception 'VPRE: falta vp_anular; no se cambió nada'; end if;
end $$;

-- ── Gastos: anulación sin borrar ──────────────────────────────────────────────────────────────────────────────────
alter table public.gastos_indirectos
  add column if not exists anulado_en timestamptz,
  add column if not exists anulado_por uuid,
  add column if not exists anulacion_motivo text,
  add column if not exists anulacion_ref text;
alter table public.gastos_indirectos
  add constraint gastos_anulacion_coherente check (
    (anulado_en is null and anulacion_motivo is null and anulacion_ref is null)
    or (anulado_en is not null and length(btrim(coalesce(anulacion_motivo, ''))) between 3 and 600 and (anulacion_ref is null or length(anulacion_ref) <= 120)));

-- ── Compras de ventas privadas: reembolso ─────────────────────────────────────────────────────────────────────────
alter table public.vp_compras
  add column reembolso_estado text check (reembolso_estado is null or reembolso_estado in ('pendiente','recibido')),
  add column reembolso_monto numeric(16,0) check (reembolso_monto is null or reembolso_monto > 0),
  add column reembolso_fecha date,
  add column reembolso_marca text check (reembolso_marca is null or length(reembolso_marca) <= 120),
  add column reembolso_registrado_por uuid,
  add column reembolso_registrado_en timestamptz;
alter table public.vp_compras
  add constraint vp_compras_reembolso_coherente check (
    (reembolso_estado is null and reembolso_monto is null and reembolso_fecha is null and reembolso_marca is null)
    or (reembolso_estado = 'pendiente' and estado = 'anulada' and reembolso_monto is not null and reembolso_monto <= total
        and reembolso_fecha is null and reembolso_marca is null)
    or (reembolso_estado = 'recibido' and estado = 'anulada' and reembolso_monto is not null and reembolso_monto <= total
        and reembolso_fecha is not null));
create unique index vp_compras_reembolso_marca_unica on public.vp_compras (reembolso_marca) where reembolso_marca is not null;
create index vp_compras_reembolso on public.vp_compras (reembolso_estado) where reembolso_estado is not null;

-- ¿La marca de un movimiento de la cartola ya está usada por otro registro? (cualquier tabla con marca_cartola, las
-- decisiones vigentes de conciliación y otros reembolsos)
create function public.vp_marca_cartola_usada(p_marca text, p_excepto uuid default null) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t text; hay boolean := false;
begin
  if p_marca is null then return false; end if;
  for t in select c.table_name from information_schema.columns c
           where c.table_schema = 'public' and c.column_name = 'marca_cartola' and c.table_name not like 'vp\_%' loop
    execute format('select exists (select 1 from public.%I where marca_cartola = $1)', t) into hay using p_marca;
    if hay then return true; end if;
  end loop;
  if to_regclass('public.conciliacion_decisiones') is not null then
    execute 'select exists (select 1 from public.conciliacion_decisiones where marca = $1 and decision = ''vinculado'' and anulado_en is null)'
      into hay using p_marca;
    if hay then return true; end if;
  end if;
  return exists (select 1 from public.vp_compras where reembolso_marca = p_marca and id is distinct from p_excepto);
end $$;

-- ── Anular una compra (con o sin reembolso) ──────────────────────────────────────────────────────────────────────
create function public.vp_anular_compra(p_id uuid, p_motivo text, p_reembolso boolean default false, p_monto numeric default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k public.vp_compras; r jsonb; monto numeric; gasto_anulado text := null;
begin
  select * into k from public.vp_compras where id = p_id for update;
  if not found then raise exception 'VP: registro no encontrado' using errcode = 'P0002'; end if;
  -- Mismas reglas que cualquier anulación: usuario BFK, motivo, compra vigente, responsable de la venta o administrador.
  r := public.vp_anular('compra', p_id, p_motivo);
  if coalesce(p_reembolso, false) then
    monto := round(coalesce(p_monto, k.total));
    if monto <= 0 or monto > k.total then
      raise exception 'VP_DATO: el reembolso debe ser mayor que $0 y no puede superar lo pagado (%)', k.total using errcode = '23514'; end if;
    update public.vp_compras set reembolso_estado = 'pendiente', reembolso_monto = monto where id = p_id;
    if k.origen = 'gasto_existente' then
      update public.gastos_indirectos
         set anulado_en = now(), anulado_por = auth.uid(),
             anulacion_motivo = left('Compra de venta privada anulada con reembolso: ' || btrim(p_motivo), 600),
             anulacion_ref = 'vp_compras:' || p_id::text
       where id = k.gasto_id and anulado_en is null;
      if found then gasto_anulado := k.gasto_id; end if;
    end if;
  elsif p_monto is not null then
    raise exception 'VP_DATO: el monto del reembolso solo se indica si el proveedor devolverá el dinero' using errcode = '23514';
  end if;
  return r || jsonb_build_object('reembolso', case when coalesce(p_reembolso, false) then 'pendiente' end,
                                 'reembolso_monto', case when coalesce(p_reembolso, false) then monto end,
                                 'gasto_anulado', gasto_anulado,
                                 'documento_tipo', k.documento_tipo, 'origen', k.origen);
end $$;

-- ── Reembolso recibido ───────────────────────────────────────────────────────────────────────────────────────────
create function public.vp_registrar_reembolso(p_compra uuid, p_fecha date, p_monto numeric, p_marca text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k public.vp_compras; marca text := nullif(btrim(coalesce(p_marca, '')), '');
begin
  perform public.vp_exigir_usuario();
  select * into k from public.vp_compras where id = p_compra for update;
  if not found then raise exception 'VP: compra no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_venta(k.venta_id) then
    raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra el reembolso' using errcode = '42501'; end if;
  if k.reembolso_estado is null then
    raise exception 'VP_ESTADO: esta compra no tiene un reembolso esperado' using errcode = '23514'; end if;
  if marca is not null and public.vp_marca_cartola_usada(marca, k.id) then
    raise exception 'VP_DUPLICADO: ese movimiento de la cartola ya está registrado en otro registro' using errcode = '23505'; end if;
  -- Recibido a mano (sin marca) y después aparece el abono en la cartola: solo se le asigna la marca.
  if k.reembolso_estado = 'recibido' then
    if k.reembolso_marca is not null then
      raise exception 'VP_ESTADO: el reembolso ya está registrado' using errcode = '23514'; end if;
    if marca is null or round(coalesce(p_monto, 0)) <> k.reembolso_monto then
      raise exception 'VP_DATO: para vincular el abono indica su marca y el mismo monto del reembolso' using errcode = '23514'; end if;
    update public.vp_compras set reembolso_marca = marca where id = p_compra;
    return jsonb_build_object('id', p_compra, 'reembolso', 'recibido', 'marca', marca, 'solo_marca', true);
  end if;
  if p_fecha is null or p_fecha > current_date + 1 then
    raise exception 'VP_DATO: indica la fecha del reembolso (no futura)' using errcode = '23514'; end if;
  if p_monto is null or round(p_monto) <= 0 or round(p_monto) > k.total then
    raise exception 'VP_DATO: el reembolso debe ser mayor que $0 y no puede superar lo pagado (%)', k.total using errcode = '23514'; end if;
  update public.vp_compras
     set reembolso_estado = 'recibido', reembolso_monto = round(p_monto), reembolso_fecha = p_fecha, reembolso_marca = marca,
         reembolso_registrado_por = auth.uid(), reembolso_registrado_en = now()
   where id = p_compra;
  return jsonb_build_object('id', p_compra, 'reembolso', 'recibido', 'monto', round(p_monto), 'fecha', p_fecha, 'marca', marca);
end $$;

create function public.vp_deshacer_reembolso(p_compra uuid, p_motivo text)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k public.vp_compras;
begin
  perform public.vp_exigir_usuario();
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'VP_DATO: indica el motivo' using errcode = '23514'; end if;
  select * into k from public.vp_compras where id = p_compra for update;
  if not found then raise exception 'VP: compra no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_venta(k.venta_id) then
    raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador lo deshace' using errcode = '42501'; end if;
  if k.reembolso_estado is distinct from 'recibido' then
    raise exception 'VP_ESTADO: el reembolso no está registrado como recibido' using errcode = '23514'; end if;
  update public.vp_compras set reembolso_estado = 'pendiente', reembolso_fecha = null, reembolso_marca = null,
         reembolso_registrado_por = null, reembolso_registrado_en = null,
         anulacion_motivo = left(coalesce(anulacion_motivo, '') || ' · reembolso deshecho: ' || btrim(p_motivo), 1000)
   where id = p_compra;
  return jsonb_build_object('id', p_compra, 'reembolso', 'pendiente');
end $$;

revoke all on function public.vp_marca_cartola_usada(text, uuid) from public, anon;
revoke all on function public.vp_anular_compra(uuid, text, boolean, numeric) from public, anon;
revoke all on function public.vp_registrar_reembolso(uuid, date, numeric, text) from public, anon;
revoke all on function public.vp_deshacer_reembolso(uuid, text) from public, anon;
grant execute on function public.vp_anular_compra(uuid, text, boolean, numeric) to authenticated;
grant execute on function public.vp_registrar_reembolso(uuid, date, numeric, text) to authenticated;
grant execute on function public.vp_deshacer_reembolso(uuid, text) to authenticated;

-- Un gasto anulado no se vuelve a vincular a otra venta (la búsqueda de la app ya los oculta; la base también lo exige).
create or replace function public.vp_gasto_no_anulado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.origen = 'gasto_existente' and new.estado = 'vigente'
     and exists (select 1 from public.gastos_indirectos g where g.id = new.gasto_id and g.anulado_en is not null) then
    raise exception 'VP_DATO: ese gasto está anulado en Gastos; no se puede vincular' using errcode = '23514'; end if;
  return new;
end $$;
create trigger vp_compras_gasto_no_anulado before insert on public.vp_compras for each row execute function public.vp_gasto_no_anulado();

notify pgrst, 'reload schema';
commit;
