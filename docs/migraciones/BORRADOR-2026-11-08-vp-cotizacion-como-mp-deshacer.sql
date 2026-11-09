-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RECUPERACIÓN de BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql. NO APLICADO.
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql
--
-- Restituye EXACTAMENTE las 4 funciones del 07/11/2026 (texto copiado de BORRADOR-2026-11-06-ventas-privadas.sql). No borra datos:
--   · Las columnas nuevas (fichas técnicas y datos de compra ya guardados) se CONSERVAN por defecto: las funciones anteriores
--     no las leen ni las escriben, así que la aplicación anterior funciona igual. Con  -v quitar_columnas=si  se eliminan, pero
--     SOLO si están todas vacías; si alguna tiene datos se detiene sin cambiar nada.
--   · costo_unitario / costo_unitario_estimado vuelven a ser obligatorios y las vistas de margen vuelven a su texto anterior
--     solo si no hay costos vacíos; si los hay, se mantienen opcionales y con las vistas que los cuentan como «sin costo»
--     (misma fórmula), para no borrar ni falsear nada.
-- Ningún documento congelado, EETT, venta, pago ni dato de Mercado Público se toca.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
\if :{?quitar_columnas}
\else
  \set quitar_columnas no
\endif
begin;
set local lock_timeout = '5s';
select set_config('vpmp.quitar_columnas', :'quitar_columnas', true);

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'vp_cotizacion_items' and column_name = 'ficha') then
    raise exception 'VPMP: la migración no está aplicada; nada que recuperar'; end if;
  if current_setting('vpmp.quitar_columnas', true) = 'si' and (
       exists (select 1 from public.vp_cotizacion_items where ficha is not null or ficha_aprobada)
    or exists (select 1 from public.vp_venta_items where ficha is not null)
    or exists (select 1 from public.vp_cotizacion_item_costos where costo_unitario is null or proveedor is not null or enlace is not null or enlace_original is not null
               or precio_compra is not null or precio_incluye_iva is not null or con_factura is not null or despacho is not null)
    or exists (select 1 from public.vp_venta_item_costos where costo_unitario_estimado is null or proveedor is not null or enlace is not null
               or precio_compra is not null or precio_incluye_iva is not null or con_factura is not null or despacho is not null)) then
    raise exception 'VPMP: hay fichas o datos de compra guardados con la versión nueva; no se quitaron columnas ni se cambió nada (repita sin quitar_columnas para conservarlos)';
  end if;
end $$;

-- ── Funciones del 07/11/2026 (texto original) ──────────────────────────────────────────────────────────────
create or replace function public.vp_reemplazar_lineas(p_rev uuid, p_items jsonb, p_con_costos boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare it jsonb; n int := 0; v_item uuid; costos_previos jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VP_DATO: las líneas deben ser una lista' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'VP_DATO: máximo 200 líneas por cotización' using errcode = '22023'; end if;
  -- Si quien guarda no ve costos, se conservan los costos existentes por posición (no se borran ni se exponen).
  select coalesce(jsonb_object_agg(i.orden::text, jsonb_build_object('c', k.costo_unitario, 'n', k.nota)), '{}'::jsonb) into costos_previos
  from public.vp_cotizacion_items i join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = p_rev;
  delete from public.vp_cotizacion_item_costos where item_id in (select id from public.vp_cotizacion_items where revision_id = p_rev);
  delete from public.vp_cotizacion_items where revision_id = p_rev;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if public.vp_num(it, 'cantidad') is null or public.vp_num(it, 'cantidad') <= 0 then raise exception 'VP_DATO: línea %: la cantidad debe ser mayor que cero', n using errcode = '23514'; end if;
    if public.vp_num(it, 'precio_unitario') is null or public.vp_num(it, 'precio_unitario') < 0 then raise exception 'VP_DATO: línea %: precio unitario inválido', n using errcode = '23514'; end if;
    if coalesce(public.vp_num(it, 'descuento_pct'), 0) not between 0 and 100 then raise exception 'VP_DATO: línea %: el descuento debe estar entre 0 y 100%%', n using errcode = '23514'; end if;
    if public.vp_txt(it->>'descripcion') is null then raise exception 'VP_DATO: línea %: falta la descripción', n using errcode = '23514'; end if;
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (p_rev, n, coalesce(nullif(it->>'tipo', ''), 'producto'), nullif(it->>'producto_id', '')::uuid, public.vp_txt(it->>'codigo', 60),
            public.vp_txt(it->>'descripcion', 2000), coalesce(public.vp_txt(it->>'unidad', 20), 'UN'), public.vp_num(it, 'cantidad'),
            public.vp_num(it, 'precio_unitario'), coalesce(public.vp_num(it, 'descuento_pct'), 0))
    returning id into v_item;
    if p_con_costos then
      if public.vp_num(it, 'costo_unitario') is not null then
        if public.vp_num(it, 'costo_unitario') < 0 then raise exception 'VP_DATO: línea %: costo inválido', n using errcode = '23514'; end if;
        insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, public.vp_num(it, 'costo_unitario'), public.vp_txt(it->>'costo_nota', 500));
      end if;
    elsif costos_previos ? n::text then
      insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, (costos_previos->n::text->>'c')::numeric, costos_previos->n::text->>'n');
    end if;
  end loop;
  perform public.vp_recalcular_revision(p_rev);
end $$;

create or replace function public.vp_cotizacion_nueva_revision(p_cotizacion uuid, p_version int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; nr public.vp_cotizacion_revisiones%rowtype; it record; v_item uuid;
begin
  perform public.vp_exigir_usuario();
  select * into c from public.vp_cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable o un administrador crea revisiones' using errcode = '42501'; end if;
  if c.version <> coalesce(p_version, -1) then raise exception 'VP409: la cotización cambió; recarga antes de continuar' using errcode = '40001'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual for update;
  if r.estado = 'borrador' then raise exception 'VP_REVISION: la revisión actual aún es borrador; edítala directamente' using errcode = '23514'; end if;
  insert into public.vp_cotizacion_revisiones (cotizacion_id, numero, contacto_nombre, contacto_correo, contacto_telefono, fecha_emision, vigencia_hasta,
    plazo_entrega, direccion_entrega, condiciones_pago, observaciones, condiciones_comerciales, afecta_iva, tasa_iva)
  values (c.id, r.numero + 1, r.contacto_nombre, r.contacto_correo, r.contacto_telefono, public.vp_hoy(),
    public.vp_hoy() + greatest(r.vigencia_hasta - r.fecha_emision, 0), r.plazo_entrega, r.direccion_entrega, r.condiciones_pago, r.observaciones,
    r.condiciones_comerciales, r.afecta_iva, r.tasa_iva)
  returning * into nr;
  for it in select i.*, k.costo_unitario, k.nota from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if it.costo_unitario is not null then insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, it.costo_unitario, it.nota); end if;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  if r.estado <> 'aceptada' then update public.vp_cotizacion_revisiones set estado = 'reemplazada' where id = r.id; end if;
  update public.vp_cotizaciones set revision_actual = nr.numero, estado = 'borrador' where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'revision', nr.numero, 'revision_id', nr.id, 'version', c.version);
end $$;

create or replace function public.vp_duplicar_cotizacion(p_cotizacion uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; nc public.vp_cotizaciones%rowtype; nr public.vp_cotizacion_revisiones%rowtype;
  it record; v_item uuid; ve boolean;
begin
  perform public.vp_exigir_usuario();
  select * into c from public.vp_cotizaciones where id = p_cotizacion;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  ve := public.vp_es_responsable_cot(c.id);
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual;
  insert into public.vp_cotizaciones (folio, cliente_id, responsable_id, origen_id) values (public.vp_siguiente_folio('CP'), c.cliente_id, auth.uid(), c.id) returning * into nc;
  insert into public.vp_cotizacion_revisiones (cotizacion_id, numero, contacto_nombre, contacto_correo, contacto_telefono, fecha_emision, vigencia_hasta,
    plazo_entrega, direccion_entrega, condiciones_pago, observaciones, condiciones_comerciales, afecta_iva, tasa_iva)
  values (nc.id, 0, r.contacto_nombre, r.contacto_correo, r.contacto_telefono, public.vp_hoy(), public.vp_hoy() + greatest(r.vigencia_hasta - r.fecha_emision, 0),
    r.plazo_entrega, r.direccion_entrega, r.condiciones_pago, r.observaciones, r.condiciones_comerciales, r.afecta_iva, r.tasa_iva) returning * into nr;
  for it in select i.*, k.costo_unitario, k.nota from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if ve and it.costo_unitario is not null then insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, it.costo_unitario, it.nota); end if;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  return jsonb_build_object('id', nc.id, 'folio', nc.folio, 'revision_id', nr.id);
end $$;

create or replace function public.vp_crear_venta_desde_cotizacion(p_cotizacion uuid, p_clave uuid, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; v public.vp_ventas%rowtype; it record; v_item uuid;
  cd public.vp_clientes_datos%rowtype; v_eett uuid;
begin
  perform public.vp_exigir_usuario();
  if p_clave is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  select * into v from public.vp_ventas where clave_idempotencia = p_clave;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  select * into c from public.vp_cotizaciones where id = p_cotizacion for update;   -- serializa conversiones de la misma cotización
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  select * into v from public.vp_ventas where cotizacion_id = c.id and estado = 'vigente';
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador crea la venta' using errcode = '42501'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and estado = 'aceptada' order by numero desc limit 1;
  if not found then raise exception 'VP_ESTADO: la cotización no tiene una revisión aceptada' using errcode = '23514'; end if;
  select * into cd from public.vp_clientes_datos where cliente_id = c.cliente_id;
  select id into v_eett from public.vp_eett where cotizacion_revision_id = r.id and estado = 'emitida' order by revision desc limit 1;
  insert into public.vp_ventas (folio, origen, cotizacion_id, revision_id, eett_id, cliente_id, cliente, responsable_id, fecha, contacto_nombre, contacto_correo,
    contacto_telefono, plazo_entrega, fecha_entrega_comprometida, direccion_entrega, condiciones_pago, plazo_pago_dias, observaciones, condiciones_comerciales,
    afecta_iva, tasa_iva, clave_idempotencia)
  values (public.vp_siguiente_folio('OV'), 'cotizacion', c.id, r.id, v_eett, c.cliente_id, coalesce(r.cliente, public.vp_foto_cliente(c.cliente_id)), c.responsable_id,
    coalesce(public.vp_fecha(p_datos, 'fecha'), public.vp_hoy()), r.contacto_nombre, r.contacto_correo, r.contacto_telefono, r.plazo_entrega,
    public.vp_fecha(p_datos, 'fecha_entrega_comprometida'), r.direccion_entrega, r.condiciones_pago,
    coalesce(public.vp_num(p_datos, 'plazo_pago_dias')::int, cd.plazo_pago_dias, 30), coalesce(public.vp_txt(p_datos->>'observaciones', 4000), r.observaciones),
    r.condiciones_comerciales, r.afecta_iva, r.tasa_iva, p_clave)
  returning * into v;
  for it in select i.*, k.costo_unitario from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_venta_items (venta_id, orden, item_cotizacion_id, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (v.id, it.orden, it.id, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if it.costo_unitario is not null then insert into public.vp_venta_item_costos (item_id, costo_unitario_estimado) values (v_item, it.costo_unitario); end if;
  end loop;
  perform public.vp_recalcular_venta(v.id);
  select * into v from public.vp_ventas where id = v.id;
  if v.total <> r.total then raise exception 'VP_TOTAL: el total de la venta (%) no coincide con la cotización aceptada (%)', v.total, r.total using errcode = '23514'; end if;
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', false);
exception when unique_violation then
  -- Carrera entre dos sesiones: la otra ganó; se devuelve su venta (sin duplicar).
  select * into v from public.vp_ventas where (cotizacion_id = p_cotizacion and estado = 'vigente') or clave_idempotencia = p_clave limit 1;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  raise;
end $$;

-- ── Vistas y obligatoriedad del costo: solo si no hay costos vacíos ───────────────────────────────────────
do $$ begin
  if exists (select 1 from public.vp_cotizacion_item_costos where costo_unitario is null) or exists (select 1 from public.vp_venta_item_costos where costo_unitario_estimado is null) then
    raise notice 'VPMP: hay ítems con proveedor o enlace pero sin costo; costo_unitario sigue opcional y las vistas de margen los cuentan como «sin costo» (misma fórmula).';
    return;
  end if;
  alter table public.vp_cotizacion_item_costos alter column costo_unitario set not null;
  alter table public.vp_venta_item_costos alter column costo_unitario_estimado set not null;
  execute $v$
create or replace view public.vp_margen_revisiones with (security_invoker = true) as
select r.id as revision_id, r.cotizacion_id, r.neto,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario)), 0) from public.vp_cotizacion_items i
       join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = r.id) end as costo,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select count(*) from public.vp_cotizacion_items i
       where i.revision_id = r.id and not exists (select 1 from public.vp_cotizacion_item_costos k where k.item_id = i.id)) end as lineas_sin_costo
from public.vp_cotizacion_revisiones r
  $v$;
  execute $v$
create or replace view public.vp_margen_ventas with (security_invoker = true) as
select v.id as venta_id, v.neto, v.estado, v.fecha,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario_estimado)), 0) from public.vp_venta_items i
       join public.vp_venta_item_costos k on k.item_id = i.id where i.venta_id = v.id) end as costo_estimado,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_venta_items i
       where i.venta_id = v.id and not exists (select 1 from public.vp_venta_item_costos k where k.item_id = i.id)) end as lineas_sin_costo,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(case when k.iva_recuperable then k.neto else k.total end), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente') end as costo_real,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(k.total), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente' and k.origen = 'gasto_existente') end as costo_real_desde_gastos,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_compras k where k.venta_id = v.id and k.estado = 'vigente') end as n_compras
from public.vp_ventas v
  $v$;
end $$;

-- ── Columnas nuevas: solo con -v quitar_columnas=si (y ya se comprobó que están vacías) ───────────────────
do $$ begin
  if current_setting('vpmp.quitar_columnas', true) <> 'si' then
    raise notice 'VPMP: columnas nuevas conservadas (las funciones restituidas no las usan).'; return;
  end if;
  alter table public.vp_cotizacion_items drop column ficha, drop column ficha_aprobada;
  alter table public.vp_cotizacion_item_costos drop column proveedor, drop column enlace, drop column enlace_original, drop column precio_compra,
    drop column precio_incluye_iva, drop column con_factura, drop column despacho;
  alter table public.vp_venta_items drop column ficha;
  alter table public.vp_venta_item_costos drop column proveedor, drop column enlace, drop column precio_compra, drop column precio_incluye_iva,
    drop column con_factura, drop column despacho;
end $$;

revoke all on function public.vp_reemplazar_lineas(uuid, jsonb, boolean) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['public.vp_cotizacion_nueva_revision(uuid, integer)', 'public.vp_duplicar_cotizacion(uuid)', 'public.vp_crear_venta_desde_cotizacion(uuid, uuid, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on public.vp_margen_revisiones, public.vp_margen_ventas from public, anon, authenticated;
grant select on public.vp_margen_revisiones, public.vp_margen_ventas to authenticated;
notify pgrst, 'reload schema';
commit;
