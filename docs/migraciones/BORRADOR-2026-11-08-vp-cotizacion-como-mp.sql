-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VENTAS PRIVADAS — cotización privada con la misma experiencia que la cotización de Mercado Público (08/11/2026).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-08-vp-cotizacion-como-mp.sql
-- Recuperación:                 BORRADOR-2026-11-08-vp-cotizacion-como-mp-deshacer.sql
--
-- Qué agrega (solo columnas nuevas y nuevas versiones de 4 funciones y 2 vistas; ninguna tabla ni fila existente se modifica):
--   · vp_cotizacion_items.ficha (jsonb) y .ficha_aprobada: ficha técnica del ítem (nombre, marca, modelo, color, características
--     generales, especificaciones, descripción y rutas de imágenes en el depósito cz-productos), igual a la ficha de Mercado Público.
--     Nunca contiene costos ni precios (vp_reemplazar_lineas lo rechaza).
--   · vp_cotizacion_item_costos (interno: solo responsable y administrador por RLS): proveedor, enlace de compra, enlace original,
--     precio de compra, «incluye IVA», «con factura» y despacho (jsonb: monto, factura, verificación, destino, evidencia, clave para
--     despachos compartidos). costo_unitario sigue siendo el costo unitario neto (compra + despacho prorrateado) que usan los márgenes.
--     costo_unitario deja de ser obligatorio: un ítem puede tener proveedor y enlace antes de conocer su precio de compra
--     (un costo vacío se informa como «línea sin costo», igual que hoy cuando no hay fila de costo).
--   · vp_venta_items.ficha y vp_venta_item_costos (proveedor, enlace, precio de compra, IVA, factura, despacho): la venta conserva
--     la ficha técnica y los datos de compra del ítem aceptado. costo_unitario_estimado deja de ser obligatorio por la misma razón.
--   · vp_reemplazar_lineas, vp_cotizacion_nueva_revision, vp_duplicar_cotizacion y vp_crear_venta_desde_cotizacion copian además
--     la ficha y los datos de compra (guardar, nueva revisión, duplicar y convertir en venta).
--   · vp_margen_revisiones y vp_margen_ventas: MISMA fórmula (Σ round(cantidad × costo unitario)); solo cuentan como «sin costo»
--     también las filas cuyo costo quedó vacío. Para los datos existentes (todos con costo) el resultado es idéntico.
-- Qué NO cambia: fórmulas de precio y totales de venta privada (precio unitario, descuento, IVA), documentos congelados
-- (vp_cotizacion_revisiones.documento/cliente), EETT emitidas, ventas existentes, permisos, historial, Mercado Público.
-- Antes de cambiar nada comprueba que las 4 funciones son exactamente las instaladas el 07/11/2026 (huella del cuerpo);
-- si no lo son, se detiene sin cambios.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ declare f record; esperado jsonb := '{"vp_reemplazar_lineas":"1b2f0a7b2e3b063a45d5e9dfdbf56211","vp_cotizacion_nueva_revision":"0a6f789953c184ffef2fbd0d9356b6cc","vp_duplicar_cotizacion":"c6dde132a6ed8526526cf2a643dadb2f","vp_crear_venta_desde_cotizacion":"3bf7ee0c8ca77dfdbe3abf96dcbbdb79"}';
begin
  if to_regclass('public.vp_cotizacion_items') is null then raise exception 'VPMP: Ventas privadas no está instalado; no se cambió nada'; end if;
  for f in select key as nombre, value #>> '{}' as md5 from jsonb_each(esperado) loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.nombre and md5(p.prosrc) = f.md5) then
      raise exception 'VPMP: la función % no es la versión del 07/11/2026 (¿migración ya aplicada?); no se cambió nada', f.nombre; end if;
  end loop;
end $$;

-- ── Columnas nuevas (nulas o con valor por defecto: las filas existentes no cambian). «if not exists»: si una recuperación
--    anterior conservó las columnas con sus datos, se reutilizan tal cual.
alter table public.vp_cotizacion_items
  add column if not exists ficha jsonb check (ficha is null or (jsonb_typeof(ficha) = 'object' and length(ficha::text) <= 100000)),
  add column if not exists ficha_aprobada boolean not null default false;
alter table public.vp_cotizacion_item_costos
  alter column costo_unitario drop not null,
  add column if not exists proveedor text check (proveedor is null or length(proveedor) <= 200),
  add column if not exists enlace text check (enlace is null or length(enlace) <= 2000),
  add column if not exists enlace_original text check (enlace_original is null or length(enlace_original) <= 2000),
  add column if not exists precio_compra numeric(14,2) check (precio_compra is null or (precio_compra >= 0 and precio_compra <= 100000000000)),
  add column if not exists precio_incluye_iva boolean,
  add column if not exists con_factura boolean,
  add column if not exists despacho jsonb check (despacho is null or (jsonb_typeof(despacho) = 'object' and length(despacho::text) <= 20000));
alter table public.vp_venta_items
  add column if not exists ficha jsonb check (ficha is null or (jsonb_typeof(ficha) = 'object' and length(ficha::text) <= 100000));
alter table public.vp_venta_item_costos
  alter column costo_unitario_estimado drop not null,
  add column if not exists proveedor text check (proveedor is null or length(proveedor) <= 200),
  add column if not exists enlace text check (enlace is null or length(enlace) <= 2000),
  add column if not exists precio_compra numeric(14,2) check (precio_compra is null or (precio_compra >= 0 and precio_compra <= 100000000000)),
  add column if not exists precio_incluye_iva boolean,
  add column if not exists con_factura boolean,
  add column if not exists despacho jsonb check (despacho is null or (jsonb_typeof(despacho) = 'object' and length(despacho::text) <= 20000));

-- ── Líneas de la revisión borrador: ficha técnica + datos internos de compra ───────────────────────────────────
-- p_items: [{tipo, producto_id?, codigo?, descripcion, unidad, cantidad, precio_unitario, descuento_pct?, ficha?, ficha_aprobada?,
--            costo_unitario?, costo_nota?, proveedor?, enlace?, enlace_original?, precio_compra?, precio_incluye_iva?, con_factura?, despacho?}]
-- Los datos internos solo se guardan si quien guarda puede verlos; si no, se conservan los existentes por posición (sin exponerlos).
create or replace function public.vp_reemplazar_lineas(p_rev uuid, p_items jsonb, p_con_costos boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare it jsonb; n int := 0; v_item uuid; costos_previos jsonb; v_ficha jsonb; v_desp jsonb; v_costo numeric; v_compra numeric;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VP_DATO: las líneas deben ser una lista' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'VP_DATO: máximo 200 líneas por cotización' using errcode = '22023'; end if;
  select coalesce(jsonb_object_agg(i.orden::text, to_jsonb(k) - 'item_id'), '{}'::jsonb) into costos_previos
  from public.vp_cotizacion_items i join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = p_rev;
  delete from public.vp_cotizacion_item_costos where item_id in (select id from public.vp_cotizacion_items where revision_id = p_rev);
  delete from public.vp_cotizacion_items where revision_id = p_rev;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if public.vp_num(it, 'cantidad') is null or public.vp_num(it, 'cantidad') <= 0 then raise exception 'VP_DATO: línea %: la cantidad debe ser mayor que cero', n using errcode = '23514'; end if;
    if public.vp_num(it, 'precio_unitario') is null or public.vp_num(it, 'precio_unitario') < 0 then raise exception 'VP_DATO: línea %: precio unitario inválido', n using errcode = '23514'; end if;
    if coalesce(public.vp_num(it, 'descuento_pct'), 0) not between 0 and 100 then raise exception 'VP_DATO: línea %: el descuento debe estar entre 0 y 100%%', n using errcode = '23514'; end if;
    if public.vp_txt(it->>'descripcion') is null then raise exception 'VP_DATO: línea %: falta la descripción', n using errcode = '23514'; end if;
    v_ficha := case when jsonb_typeof(it->'ficha') = 'object' then it->'ficha' end;
    if v_ficha is not null and public.vp_tiene_datos_comerciales(v_ficha) then
      raise exception 'VP_DATO: línea %: la ficha técnica no puede contener costos ni precios', n using errcode = '23514'; end if;
    if v_ficha is not null and length(v_ficha::text) > 100000 then
      raise exception 'VP_DATO: línea %: la ficha técnica es demasiado grande (las imágenes se guardan en el depósito, no en la ficha)', n using errcode = '22023'; end if;
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct, ficha, ficha_aprobada)
    values (p_rev, n, coalesce(nullif(it->>'tipo', ''), 'producto'), nullif(it->>'producto_id', '')::uuid, public.vp_txt(it->>'codigo', 60),
            public.vp_txt(it->>'descripcion', 2000), coalesce(public.vp_txt(it->>'unidad', 20), 'UN'), public.vp_num(it, 'cantidad'),
            public.vp_num(it, 'precio_unitario'), coalesce(public.vp_num(it, 'descuento_pct'), 0), v_ficha,
            coalesce(case when jsonb_typeof(it->'ficha_aprobada') = 'boolean' then (it->>'ficha_aprobada')::boolean end, false))
    returning id into v_item;
    if p_con_costos then
      v_costo := public.vp_num(it, 'costo_unitario'); v_compra := public.vp_num(it, 'precio_compra');
      v_desp := case when jsonb_typeof(it->'despacho') = 'object' then it->'despacho' end;
      if v_costo < 0 then raise exception 'VP_DATO: línea %: costo inválido', n using errcode = '23514'; end if;
      if v_compra < 0 then raise exception 'VP_DATO: línea %: precio de compra inválido', n using errcode = '23514'; end if;
      if v_desp is not null and coalesce(public.vp_num(v_desp, 'monto'), 0) < 0 then raise exception 'VP_DATO: línea %: el despacho no puede ser negativo', n using errcode = '23514'; end if;
      if v_costo is not null or v_compra is not null or v_desp is not null or public.vp_txt(it->>'costo_nota') is not null
         or public.vp_txt(it->>'proveedor') is not null or public.vp_txt(it->>'enlace') is not null then
        insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota, proveedor, enlace, enlace_original, precio_compra, precio_incluye_iva, con_factura, despacho)
        values (v_item, v_costo, public.vp_txt(it->>'costo_nota', 500), public.vp_txt(it->>'proveedor', 200), public.vp_txt(it->>'enlace', 2000),
                public.vp_txt(it->>'enlace_original', 2000), v_compra,
                case when jsonb_typeof(it->'precio_incluye_iva') = 'boolean' then (it->>'precio_incluye_iva')::boolean end,
                case when jsonb_typeof(it->'con_factura') = 'boolean' then (it->>'con_factura')::boolean end, v_desp);
      end if;
    elsif costos_previos ? n::text then
      insert into public.vp_cotizacion_item_costos
      select (jsonb_populate_record(null::public.vp_cotizacion_item_costos, (costos_previos->n::text) || jsonb_build_object('item_id', v_item))).*;
    end if;
  end loop;
  perform public.vp_recalcular_revision(p_rev);
end $$;

-- ── Nueva revisión: copia líneas, fichas y datos internos de compra (la revisión anterior queda intacta) ───────
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
  for it in select i.* from public.vp_cotizacion_items i where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct, ficha, ficha_aprobada)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct, it.ficha, it.ficha_aprobada)
    returning id into v_item;
    insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota, proveedor, enlace, enlace_original, precio_compra, precio_incluye_iva, con_factura, despacho)
    select v_item, k.costo_unitario, k.nota, k.proveedor, k.enlace, k.enlace_original, k.precio_compra, k.precio_incluye_iva, k.con_factura, k.despacho
    from public.vp_cotizacion_item_costos k where k.item_id = it.id;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  if r.estado <> 'aceptada' then update public.vp_cotizacion_revisiones set estado = 'reemplazada' where id = r.id; end if;
  update public.vp_cotizaciones set revision_actual = nr.numero, estado = 'borrador' where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'revision', nr.numero, 'revision_id', nr.id, 'version', c.version);
end $$;

-- ── Duplicar: cotización NUEVA con las líneas y fichas de la revisión actual; los datos internos solo si quien duplica los ve ──
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
  for it in select i.* from public.vp_cotizacion_items i where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct, ficha, ficha_aprobada)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct, it.ficha, it.ficha_aprobada)
    returning id into v_item;
    if ve then
      insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota, proveedor, enlace, enlace_original, precio_compra, precio_incluye_iva, con_factura, despacho)
      select v_item, k.costo_unitario, k.nota, k.proveedor, k.enlace, k.enlace_original, k.precio_compra, k.precio_incluye_iva, k.con_factura, k.despacho
      from public.vp_cotizacion_item_costos k where k.item_id = it.id;
    end if;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  return jsonb_build_object('id', nc.id, 'folio', nc.folio, 'revision_id', nr.id);
end $$;

-- ── Venta desde cotización aceptada: además de lo anterior, transfiere la ficha técnica y los datos de compra ───
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
  for it in select i.* from public.vp_cotizacion_items i where i.revision_id = r.id order by i.orden loop
    insert into public.vp_venta_items (venta_id, orden, item_cotizacion_id, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct, ficha)
    values (v.id, it.orden, it.id, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct, it.ficha) returning id into v_item;
    insert into public.vp_venta_item_costos (item_id, costo_unitario_estimado, proveedor, enlace, precio_compra, precio_incluye_iva, con_factura, despacho)
    select v_item, k.costo_unitario, k.proveedor, coalesce(k.enlace, k.enlace_original), k.precio_compra, k.precio_incluye_iva, k.con_factura, k.despacho
    from public.vp_cotizacion_item_costos k where k.item_id = it.id;
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

-- ── Márgenes: misma fórmula; un costo vacío cuenta como línea sin costo ───────────────────────────────────────
create or replace view public.vp_margen_revisiones with (security_invoker = true) as
select r.id as revision_id, r.cotizacion_id, r.neto,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario)), 0) from public.vp_cotizacion_items i
       join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = r.id and k.costo_unitario is not null) end as costo,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select count(*) from public.vp_cotizacion_items i
       where i.revision_id = r.id and not exists (select 1 from public.vp_cotizacion_item_costos k where k.item_id = i.id and k.costo_unitario is not null)) end as lineas_sin_costo
from public.vp_cotizacion_revisiones r;

create or replace view public.vp_margen_ventas with (security_invoker = true) as
select v.id as venta_id, v.neto, v.estado, v.fecha,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario_estimado)), 0) from public.vp_venta_items i
       join public.vp_venta_item_costos k on k.item_id = i.id where i.venta_id = v.id and k.costo_unitario_estimado is not null) end as costo_estimado,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_venta_items i
       where i.venta_id = v.id and not exists (select 1 from public.vp_venta_item_costos k where k.item_id = i.id and k.costo_unitario_estimado is not null)) end as lineas_sin_costo,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(case when k.iva_recuperable then k.neto else k.total end), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente') end as costo_real,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(k.total), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente' and k.origen = 'gasto_existente') end as costo_real_desde_gastos,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_compras k where k.venta_id = v.id and k.estado = 'vigente') end as n_compras
from public.vp_ventas v;

-- Permisos: los mismos de antes (create or replace conserva los de funciones y vistas; se reafirman por claridad).
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
