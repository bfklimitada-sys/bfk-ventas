-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VENTAS PRIVADAS — «Registrar compra» desde la cotización aprobada, como en Mercado Público (10/11/2026).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-10-vp-compras-como-mp.sql
-- Recuperación:                 BORRADOR-2026-11-10-vp-compras-como-mp-deshacer.sql
--
-- Qué cambia:
--   · public.vp_compras: columnas OPCIONALES (nulas en todo lo existente) para saber qué se compró de cada línea:
--       concepto ('producto' | 'despacho'), cantidad, precio_unitario (con IVA, lo que se paga), enlace,
--       pedido (<id>-<n>: un pedido = un proveedor), envio_clave (despacho cotizado ya registrado) y clave (única: un reintento
--       no duplica filas).
--   · public.vp_registrar_compras_cotizacion(p jsonb): registra en UNA transacción todos los pedidos confirmados de una compra
--       desde la cotización aprobada. Valida responsable, venta vigente, que la línea sea de la venta, cantidades pendientes
--       (nunca se compra más de lo vendido) y que cada despacho cotizado se cuente una sola vez. Neto e IVA se calculan en la
--       base desde el total pagado: factura → neto = total / 1,19 (IVA recuperable si la venta afecta IVA); boleta/otro → neto =
--       total. El costo real sigue saliendo de vp_margen_ventas (misma fórmula: neto si el IVA es recuperable, si no el total).
-- Qué NO cambia: vp_registrar_compra (registro manual y vínculo de un gasto existente), vp_anular, vistas de margen, la
--   cotización aprobada, los ítems y precios de la venta, permisos de tablas, historial (el disparador existente registra las
--   filas nuevas), Mercado Público.
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.vp_compras') is null then raise exception 'VPCM: Ventas privadas no está instalado; no se cambió nada'; end if;
  if to_regprocedure('public.vp_registrar_compras_cotizacion(jsonb)') is not null then raise exception 'VPCM: la migración ya está aplicada; no se cambió nada'; end if;
end $$;

alter table public.vp_compras
  add column concepto text check (concepto is null or concepto in ('producto','despacho')),
  add column cantidad numeric(14,2) check (cantidad is null or cantidad > 0),
  add column precio_unitario numeric(14,2) check (precio_unitario is null or precio_unitario >= 0),
  add column enlace text check (enlace is null or length(enlace) <= 2000),
  add column pedido text check (pedido is null or length(pedido) <= 60),
  add column envio_clave text check (envio_clave is null or length(envio_clave) <= 80),
  add column clave text check (clave is null or length(clave) <= 160);
create unique index vp_compras_clave_unica on public.vp_compras (clave) where clave is not null;
create unique index vp_compras_despacho_unico on public.vp_compras (venta_id, envio_clave) where estado = 'vigente' and envio_clave is not null;

-- p: { venta_id, fecha, filas: [{ clave, pedido, concepto: 'producto'|'despacho', venta_item_id?, envio_clave?, cantidad?,
--      precio_unitario? (con IVA), monto? (despacho, con IVA), proveedor, enlace?, descripcion, documento_tipo: 'factura'|'boleta'|'otro' }] }
create function public.vp_registrar_compras_cotizacion(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; f jsonb; n int := 0; ya int := 0; total numeric; neto numeric; q numeric; pu numeric; it record; ids jsonb := '[]'::jsonb;
  k public.vp_compras%rowtype; doc text; conc text;
begin
  perform public.vp_exigir_usuario();
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  perform 1 from public.vp_ventas where id = v.id for update;   -- serializa compras de la misma venta (pendientes exactos)
  if not public.vp_es_responsable_venta(v.id) then raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra compras' using errcode = '42501'; end if;
  if jsonb_typeof(p->'filas') <> 'array' or jsonb_array_length(p->'filas') = 0 then raise exception 'VP_DATO: la compra no tiene filas' using errcode = '22023'; end if;
  if jsonb_array_length(p->'filas') > 200 then raise exception 'VP_DATO: demasiadas filas en una compra' using errcode = '22023'; end if;
  if public.vp_fecha(p, 'fecha') is null or public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha de la compra (no futura)' using errcode = '23514'; end if;
  -- Reintento: si TODAS las claves ya existen en esta venta, la compra ya quedó registrada (no se repite).
  select count(*) into ya from jsonb_array_elements(p->'filas') x join public.vp_compras c on c.clave = x->>'clave' and c.venta_id = v.id;
  if ya = jsonb_array_length(p->'filas') then
    return jsonb_build_object('ya_existia', true, 'ids', (select jsonb_agg(c.id) from jsonb_array_elements(p->'filas') x join public.vp_compras c on c.clave = x->>'clave'));
  elsif ya > 0 then raise exception 'VP_DUPLICADO: parte de esta compra ya estaba registrada; recarga la orden antes de reintentar' using errcode = '23505'; end if;
  for f in select * from jsonb_array_elements(p->'filas') loop
    n := n + 1; conc := f->>'concepto';
    if public.vp_txt(f->>'clave', 160) is null or public.vp_txt(f->>'pedido', 60) is null then raise exception 'VP_DATO: fila %: falta la clave o el pedido', n using errcode = '22023'; end if;
    doc := coalesce(nullif(f->>'documento_tipo', ''), 'factura');
    if doc not in ('factura','boleta','otro') then raise exception 'VP_DATO: fila %: documento inválido', n using errcode = '22023'; end if;
    if conc = 'producto' then
      select i.* into it from public.vp_venta_items i where i.id = nullif(f->>'venta_item_id', '')::uuid and i.venta_id = v.id;
      if not found then raise exception 'VP_DATO: fila %: la línea no pertenece a esta venta', n using errcode = '23503'; end if;
      q := public.vp_num(f, 'cantidad'); pu := public.vp_num(f, 'precio_unitario');
      if q is null or q <= 0 or q <> round(q, 2) then raise exception 'VP_DATO: «%»: cantidad inválida', left(it.descripcion, 60) using errcode = '23514'; end if;
      if pu is null or pu < 0 then raise exception 'VP_DATO: «%»: falta el precio de compra', left(it.descripcion, 60) using errcode = '23514'; end if;
      if coalesce((select sum(c.cantidad) from public.vp_compras c where c.venta_item_id = it.id and c.estado = 'vigente' and c.concepto = 'producto'), 0)
         + coalesce((select sum(public.vp_num(x, 'cantidad')) from jsonb_array_elements(p->'filas') x where x->>'concepto' = 'producto' and x->>'venta_item_id' = it.id::text), 0) > it.cantidad then
        raise exception 'VP_CANTIDAD: «%»: se intenta comprar más de lo vendido (% unidades); no se duplican compras', left(it.descripcion, 60), it.cantidad using errcode = '23514'; end if;
      total := round(q * pu);
    elsif conc = 'despacho' then
      q := null; pu := null; total := round(public.vp_num(f, 'monto'));
      if total is null or total < 0 then raise exception 'VP_DATO: fila %: monto de despacho inválido', n using errcode = '23514'; end if;
      if nullif(f->>'envio_clave', '') is not null and exists (select 1 from public.vp_compras c where c.venta_id = v.id and c.envio_clave = f->>'envio_clave' and c.estado = 'vigente') then
        raise exception 'VP_DUPLICADO: ese despacho cotizado ya está registrado en otra compra (se cuenta una sola vez)' using errcode = '23505'; end if;
    else raise exception 'VP_DATO: fila %: concepto inválido', n using errcode = '22023'; end if;
    neto := case when doc = 'factura' then round(total / 1.19) else total end;
    insert into public.vp_compras (venta_id, venta_item_id, origen, proveedor, fecha, documento_tipo, neto, iva, total, iva_recuperable, descripcion,
      concepto, cantidad, precio_unitario, enlace, pedido, envio_clave, clave)
    values (v.id, case when conc = 'producto' then it.id end, 'registro', public.vp_txt(f->>'proveedor', 200), public.vp_fecha(p, 'fecha'), doc, neto, total - neto, total,
      doc = 'factura' and v.afecta_iva, public.vp_txt(f->>'descripcion', 1000), conc, q, pu, public.vp_txt(f->>'enlace', 2000), public.vp_txt(f->>'pedido', 60),
      public.vp_txt(f->>'envio_clave', 80), public.vp_txt(f->>'clave', 160))
    returning * into k;
    ids := ids || to_jsonb(k.id);
  end loop;
  return jsonb_build_object('ya_existia', false, 'ids', ids);
end $$;

revoke all on function public.vp_registrar_compras_cotizacion(jsonb) from public, anon, authenticated;
grant execute on function public.vp_registrar_compras_cotizacion(jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
