-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR 23/10/2026 — Eliminación segura y auditada de una OC (activa o archivada). NO APLICADO.
--
-- Qué agrega (no cambia ninguna tabla ni dato existente al instalarse):
--   · Tabla oc_eliminaciones: auditoría inmutable (quién, cuándo, motivo, resumen y COPIA COMPLETA de la OC y de
--     todos sus registros, incluido su historial). Solo la leen administradores; solo la escriben estas funciones.
--   · oc_eliminacion_revisar(oc, original): lista lo asociado, los bloqueos y las advertencias. Solo lectura.
--   · oc_eliminar_definitivamente(oc, confirmacion, motivo, original): elimina en UNA transacción, con las mismas
--     reglas, y verifica antes de terminar que no cambió nada ajeno (otras OC, saldos de financiadores, otras filas).
--   · oc_eliminacion_restaurar(id, confirmacion): vuelve a insertar exactamente lo eliminado (desde la copia).
--
-- Reglas (en la base; la app solo las muestra):
--   · Solo administradores. Confirmación escribiendo el N° de la OC. Motivo obligatorio.
--   · Sin movimientos financieros (cobros, facturas, compras, devoluciones): se puede eliminar.
--   · Con movimientos financieros: SOLO como duplicado de otra OC indicada ("original") que tenga cada movimiento
--     equivalente (cobro: monto y fecha; factura: folio y monto; compra: costo y financiador; devolución: monto y
--     financiador), uno a uno. Si falta un equivalente, se bloquea.
--   · Siempre se bloquea si: algún registro está conciliado con una cartola (marca) o tiene una decisión de
--     conciliación vigente; una devolución es parte de un pago repartido entre varias OC; las devoluciones de la OC
--     no igualan el costo financiado (cambiaría el saldo del financiador); la comisión del período ya se pagó sin
--     monto verificado (cambiaría el cálculo histórico); hay una corrección histórica pendiente; tiene seguimiento
--     especial; o una cotización adjudicada apunta a su código.
--   · Al final se comprueba que las demás OC, los saldos de los financiadores y las filas de otras OC quedaron
--     idénticos; si no, se revierte todo.
-- Deshacer la instalación: BORRADOR-2026-10-23-eliminar-oc-deshacer.sql (se detiene si hay eliminaciones registradas).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════

create table if not exists public.oc_eliminaciones (
  id text primary key,
  oc_id text not null,
  numero_oc text not null,
  cliente text,
  estaba_archivada boolean not null default false,
  original_id text,
  original_numero text,
  motivo text not null,
  eliminado_por uuid,
  eliminado_por_nombre text,
  eliminado_en timestamptz not null default now(),
  resumen jsonb not null,
  copia jsonb not null,
  restaurado_en timestamptz,
  restaurado_por uuid,
  restaurado_por_nombre text
);
alter table public.oc_eliminaciones enable row level security;
drop policy if exists oc_eliminaciones_admin_lee on public.oc_eliminaciones;
create policy oc_eliminaciones_admin_lee on public.oc_eliminaciones for select
  using (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin'));
revoke all on public.oc_eliminaciones from public, anon, authenticated;
grant select on public.oc_eliminaciones to authenticated;

-- Inmutable: no se borra; solo se anota la restauración (una vez).
create or replace function public.oc_eliminaciones_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'OCE: la auditoría de eliminaciones no se borra' using errcode = '42501'; end if;
  if (new.id, new.oc_id, new.numero_oc, new.cliente, new.estaba_archivada, new.original_id, new.original_numero, new.motivo,
      new.eliminado_por, new.eliminado_por_nombre, new.eliminado_en, new.resumen, new.copia)
     is distinct from
     (old.id, old.oc_id, old.numero_oc, old.cliente, old.estaba_archivada, old.original_id, old.original_numero, old.motivo,
      old.eliminado_por, old.eliminado_por_nombre, old.eliminado_en, old.resumen, old.copia)
     or old.restaurado_en is not null then
    raise exception 'OCE: la auditoría de eliminaciones no se modifica' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists oc_eliminaciones_inmutable on public.oc_eliminaciones;
create trigger oc_eliminaciones_inmutable before update or delete on public.oc_eliminaciones
  for each row execute function public.oc_eliminaciones_inmutable();

-- Tablas que guardan filas de una OC (columna oc_id). Las opcionales se omiten si no existen. (items_oc NO: apunta a la tabla antigua ordenes_compra).
create or replace function public.oce_tablas() returns text[]
language sql immutable as $$
  select array['eventos_pago_financiamiento','eventos_pago_cliente','eventos_factura','eventos_compra','eventos_entrega',
               'eventos_postventa','oc_productos_link','oc_comentarios','oc_reclamos','oc_responsables','oc_bloqueos',
               'notificaciones','trib_clasificaciones','contactos_institucionales_oc',
               'contactos_institucionales_historial','oc_seguimientos','correos_bfk','historial_cambios']
$$;

create or replace function public.oce_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
$$;

create or replace function public.oce_pesos(n numeric) returns text
language sql immutable as $$ select '$' || replace(to_char(coalesce(n, 0), 'FM999G999G999G990'), ',', '.') $$;

-- Revisión (solo lectura): registros asociados, movimientos financieros con su equivalente, bloqueos y advertencias.
create or replace function public.oc_eliminacion_revisar(p_oc_id text, p_original_id text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  o public.ordenes_compra_v2%rowtype; orig public.ordenes_compra_v2%rowtype; t text; n bigint;
  v_reg jsonb := '{}'; v_mov jsonb := '[]'; v_bloq jsonb := '[]'; v_adv jsonb := '[]'; v_hay_fin boolean;
  v_usados text[] := '{}'; v_eq text; r record; v_comp numeric; v_dev numeric; v_periodo record; v_ids text[];
begin
  if not public.oce_es_admin() then raise exception 'OCE: solo un administrador puede eliminar una OC.' using errcode = '42501'; end if;
  select * into o from public.ordenes_compra_v2 where id = p_oc_id;
  if not found then raise exception 'OCE: la OC no existe.' using errcode = 'P0002'; end if;
  foreach t in array public.oce_tablas() loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where oc_id = $1', t) into n using p_oc_id;
      if n > 0 then v_reg := v_reg || jsonb_build_object(t, n); end if;
    end if;
  end loop;
  v_hay_fin := exists (select 1 from public.eventos_pago_cliente where oc_id = p_oc_id) or exists (select 1 from public.eventos_factura where oc_id = p_oc_id)
            or exists (select 1 from public.eventos_compra where oc_id = p_oc_id) or exists (select 1 from public.eventos_pago_financiamiento where oc_id = p_oc_id);
  if p_original_id is not null then
    select * into orig from public.ordenes_compra_v2 where id = p_original_id;
    if not found or p_original_id = p_oc_id then
      v_bloq := v_bloq || jsonb_build_object('codigo', 'original', 'texto', 'La OC original indicada no existe o es la misma OC.');
      p_original_id := null;
    end if;
  end if;

  -- Movimientos financieros y su equivalente en la original (uno a uno).
  for r in select 'cobro' tipo, e.id, e.fecha, e.monto, null::text extra, e.marca_cartola marca from public.eventos_pago_cliente e where e.oc_id = p_oc_id
           union all select 'factura', e.id, e.fecha, e.monto, e.numero_factura, null from public.eventos_factura e where e.oc_id = p_oc_id
           union all select 'compra', e.id, e.fecha, e.costo_compra, coalesce(e.financiador_id, o.financiador_id), null from public.eventos_compra e where e.oc_id = p_oc_id
           union all select 'devolucion', e.id, e.fecha, e.monto, coalesce(e.financiador_id, o.financiador_id), e.marca_cartola from public.eventos_pago_financiamiento e where e.oc_id = p_oc_id
           order by 1, 3, 2 loop
    v_eq := null;
    if p_original_id is not null then
      if r.tipo = 'cobro' then
        select e.id into v_eq from public.eventos_pago_cliente e where e.oc_id = p_original_id and e.monto = r.monto and e.fecha = r.fecha and not e.id = any(v_usados) order by e.id limit 1;
      elsif r.tipo = 'factura' then
        select e.id into v_eq from public.eventos_factura e where e.oc_id = p_original_id and e.monto = r.monto and coalesce(e.numero_factura, '') = coalesce(r.extra, '') and not e.id = any(v_usados) order by e.id limit 1;
      elsif r.tipo = 'compra' then
        select e.id into v_eq from public.eventos_compra e where e.oc_id = p_original_id and e.costo_compra = r.monto and coalesce(e.financiador_id, orig.financiador_id) is not distinct from r.extra and not e.id = any(v_usados) order by e.id limit 1;
      else
        select e.id into v_eq from public.eventos_pago_financiamiento e where e.oc_id = p_original_id and e.monto = r.monto and coalesce(e.financiador_id, orig.financiador_id) is not distinct from r.extra and not e.id = any(v_usados) order by e.id limit 1;
      end if;
      if v_eq is not null then v_usados := v_usados || v_eq; end if;
    end if;
    v_mov := v_mov || jsonb_build_object('tipo', r.tipo, 'id', r.id, 'fecha', r.fecha, 'monto', r.monto, 'detalle', r.extra, 'marca', r.marca, 'equivalente', v_eq);
    if r.marca is not null then
      v_bloq := v_bloq || jsonb_build_object('codigo', 'cartola', 'texto', format('El %s del %s por %s está conciliado con una cartola del banco: es un pago bancario real.', r.tipo, to_char(r.fecha, 'DD/MM/YYYY'), public.oce_pesos(r.monto)));
    end if;
    if v_hay_fin and p_original_id is not null and v_eq is null then
      v_bloq := v_bloq || jsonb_build_object('codigo', 'sin_equivalente', 'texto', format('El %s del %s por %s%s no tiene un equivalente en la OC original: podría ser un movimiento real.',
        r.tipo, to_char(r.fecha, 'DD/MM/YYYY'), public.oce_pesos(r.monto), case when r.tipo = 'factura' then ' (folio ' || coalesce(r.extra, '-') || ')' else '' end));
    end if;
  end loop;
  if v_hay_fin and p_original_id is null then
    v_bloq := v_bloq || jsonb_build_object('codigo', 'financiera', 'texto', 'Tiene movimientos financieros: solo se puede eliminar como duplicado de otra OC que tenga los mismos movimientos (indique la OC original).');
  end if;

  -- Decisiones de conciliación vigentes sobre sus registros.
  if to_regclass('public.conciliacion_decisiones') is not null then
    select array_agg(id) into v_ids from (select id from public.eventos_pago_cliente where oc_id = p_oc_id union all select id from public.eventos_pago_financiamiento where oc_id = p_oc_id) z;
    execute 'select count(*) from public.conciliacion_decisiones where anulado_en is null and registro_id = any($1)' into n using coalesce(v_ids, '{}');
    if n > 0 then v_bloq := v_bloq || jsonb_build_object('codigo', 'conciliacion', 'texto', format('%s registro(s) tienen una decisión de conciliación bancaria vigente.', n)); end if;
  end if;

  -- Devolución que es parte de un pago repartido entre varias OC (misma transacción, mismo financiador y fecha).
  for r in select e.id, e.fecha, e.monto from public.eventos_pago_financiamiento e
            where e.oc_id = p_oc_id and e.creado_por is not null
              and exists (select 1 from public.eventos_pago_financiamiento x where x.oc_id is distinct from p_oc_id and x."creadoEn" = e."creadoEn"
                          and x.financiador_id is not distinct from e.financiador_id and x.fecha = e.fecha) loop
    v_bloq := v_bloq || jsonb_build_object('codigo', 'pago_repartido', 'texto', format('La devolución del %s por %s es parte de un pago repartido entre varias OC (FIFO): eliminarla descuadraría ese pago.', to_char(r.fecha, 'DD/MM/YYYY'), public.oce_pesos(r.monto)));
  end loop;

  -- Financiamiento: las devoluciones deben igualar el costo financiado (si no, cambia el saldo del financiador).
  if o.financiador_id is not null and public.fin_tipo_financiamiento(o.id) = 'externo' then
    select coalesce(sum(costo_compra), 0) into v_comp from public.eventos_compra where oc_id = p_oc_id;
    select coalesce(sum(monto), 0) into v_dev from public.eventos_pago_financiamiento where oc_id = p_oc_id;
    if v_comp <> v_dev then
      v_bloq := v_bloq || jsonb_build_object('codigo', 'saldo_financiador', 'texto', format('Las devoluciones al financiador (%s) no igualan el costo financiado (%s): eliminarla cambiaría su saldo y el FIFO.', public.oce_pesos(v_dev), public.oce_pesos(v_comp)));
    elsif v_comp > 0 then
      v_adv := v_adv || jsonb_build_object('codigo', 'financiador', 'texto', format('El financiador deja de registrar una compra y una devolución de %s: su saldo no cambia.', public.oce_pesos(v_comp)));
    end if;
  end if;
  if exists (select 1 from public.eventos_pago_financiamiento where oc_id = p_oc_id and financiador_id is distinct from o.financiador_id) then
    v_bloq := v_bloq || jsonb_build_object('codigo', 'otro_financiador', 'texto', 'Tiene devoluciones a un financiador distinto del de la OC.');
  end if;

  -- Comisión: si el período ya se pagó y no tiene monto verificado, eliminarla cambiaría el cálculo histórico.
  if coalesce(o.tipo_registro, 'venta') = 'venta' and o.estado_factura_propia = 'emitida' and o.vendedor_id is not null
     and not coalesce(o.comision_excluida, false) and not coalesce(o.capitalizacion_bfk, false) then
    select * into v_periodo from public.fin_periodo_comision(o.id);
    if v_periodo.anio is not null and exists (select 1 from public.pagos_vendedor v where v.vendedor_id = o.vendedor_id and v.anio = v_periodo.anio and v.mes = v_periodo.mes and v.anulado_en is null) then
      if exists (select 1 from public.pagos_vendedor v where v.vendedor_id = o.vendedor_id and v.anio = v_periodo.anio and v.mes = v_periodo.mes and v.anulado_en is null and v.monto_verificado is not null) then
        v_adv := v_adv || jsonb_build_object('codigo', 'comision', 'texto', format('La comisión de %s/%s ya se pagó con monto verificado: no cambia.', v_periodo.mes, v_periodo.anio));
      else
        v_bloq := v_bloq || jsonb_build_object('codigo', 'comision', 'texto', format('La comisión de %s/%s ya se pagó e incluye esta OC sin monto verificado: eliminarla cambiaría el cálculo histórico.', v_periodo.mes, v_periodo.anio));
      end if;
    end if;
  end if;
  if coalesce(o.vendedor_pagado, false) and not exists (select 1 from jsonb_array_elements(v_adv) a where a ->> 'codigo' = 'comision') then
    v_bloq := v_bloq || jsonb_build_object('codigo', 'comision', 'texto', 'La OC figura con la comisión pagada.');
  end if;

  if public.fin_motivo_bloqueo(o.id, 'financiamiento') is not null or public.fin_motivo_bloqueo(o.id, 'cobro') is not null or public.fin_motivo_bloqueo(o.id, 'facturacion') is not null then
    v_bloq := v_bloq || jsonb_build_object('codigo', 'correccion', 'texto', 'Tiene una corrección histórica pendiente de aprobación.');
  end if;
  if exists (select 1 from public.fin_diferencias_historicas d where d.entidad = 'oc' and d.entidad_id = o.id and d.estado <> 'pendiente') then
    v_adv := v_adv || jsonb_build_object('codigo', 'correcciones', 'texto', 'Tiene correcciones históricas ya resueltas: quedan en su registro (no se borran).');
  end if;
  if to_regclass('public.oc_seguimientos') is not null and exists (select 1 from public.oc_seguimientos where oc_id = o.id) then
    v_bloq := v_bloq || jsonb_build_object('codigo', 'seguimiento', 'texto', 'Tiene un seguimiento especial: ciérrelo o muévalo antes.');
  end if;
  if to_regclass('public.cotizaciones') is not null then
    execute 'select count(*) from public.cotizaciones c where upper(btrim(c.oc_codigo)) = upper(btrim($1))' into n using o.numero_oc;
    if n > 0 then v_bloq := v_bloq || jsonb_build_object('codigo', 'cotizacion', 'texto', 'Una cotización está vinculada a este código de OC.'); end if;
  end if;
  if not coalesce(o.archivada, false) then
    v_adv := v_adv || jsonb_build_object('codigo', 'activa', 'texto', 'La OC está activa: deja de contar en ventas, caja, cuentas por cobrar y comisiones.');
  end if;
  if (v_reg ->> 'historial_cambios') is not null then
    v_adv := v_adv || jsonb_build_object('codigo', 'historial', 'texto', 'Su historial de cambios se guarda completo en la auditoría de la eliminación.');
  end if;
  if (v_reg ->> 'correos_bfk') is not null then
    v_adv := v_adv || jsonb_build_object('codigo', 'correos', 'texto', 'Sus correos se conservan, pero quedan sin OC asociada.');
  end if;
  return jsonb_build_object('oc', jsonb_build_object('id', o.id, 'numero_oc', o.numero_oc, 'cliente', o.cliente, 'archivada', coalesce(o.archivada, false),
      'monto_total', o.monto_total, 'financiador_id', o.financiador_id, 'vendedor_id', o.vendedor_id),
    'original', case when p_original_id is null then null else jsonb_build_object('id', orig.id, 'numero_oc', orig.numero_oc, 'cliente', orig.cliente) end,
    'registros', v_reg, 'movimientos', v_mov, 'financiera', v_hay_fin, 'bloqueos', v_bloq, 'advertencias', v_adv,
    'eliminable', jsonb_array_length(v_bloq) = 0);
end $$;

-- Firma de lo que NO debe cambiar: demás OC (montos y estados derivados), financiadores y conteo de filas ajenas.
create or replace function public.oce_firma_ajena(p_oc_id text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare t text; n bigint; v text := '';
begin
  select md5(coalesce(string_agg(concat_ws('|', id, monto_total, costo_total, monto_pagado_fin, monto_facturado, monto_cobrado, estado_compra,
           estado_pago_financiamiento, estado_factura_propia, estado_pago_cliente, vendedor_pagado, archivada), ';' order by id), '')) into v
    from public.ordenes_compra_v2 where id <> p_oc_id;
  v := v || '/' || (select md5(coalesce(string_agg(id || '|' || coalesce(saldo_deuda::text, ''), ';' order by id), '')) from public.financiadores);
  foreach t in array public.oce_tablas() loop
    if to_regclass('public.' || t) is not null then
      -- Los correos de la OC se conservan (quedan sin OC): se compara el total, no los asociados a otras OC.
      if t = 'correos_bfk' then execute 'select count(*) from public.correos_bfk' into n;
      else execute format('select count(*) from public.%I where oc_id is distinct from $1', t) into n using p_oc_id; end if;
      v := v || '/' || t || ':' || n;
    end if;
  end loop;
  v := v || '/pv:' || (select md5(coalesce(string_agg(to_jsonb(p)::text, ';' order by p.id), '')) from public.pagos_vendedor p)
         || '/iva:' || (select md5(coalesce(string_agg(to_jsonb(i)::text, ';' order by i.id), '')) from public.iva_mensual i)
         || '/gastos:' || (select md5(coalesce(string_agg(to_jsonb(g)::text, ';' order by g.id), '')) from public.gastos_indirectos g)
         || '/sueltas:' || (select md5(coalesce(string_agg(to_jsonb(e)::text, ';' order by e.id), '')) from public.eventos_pago_financiamiento e where e.oc_id is null);
  return v;
end $$;

create or replace function public.oc_eliminar_definitivamente(p_oc_id text, p_confirmacion text, p_motivo text, p_original_id text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o public.ordenes_compra_v2%rowtype; v_rev jsonb; v_copia jsonb := '{}'; t text; v_filas jsonb; v_id text; v_nombre text;
  v_firma text; v_resumen jsonb; v_orig_num text; n bigint;
begin
  if not public.oce_es_admin() then raise exception 'OCE: solo un administrador puede eliminar una OC.' using errcode = '42501'; end if;
  -- Misma llave que el resto de las operaciones de la OC: dos sesiones no eliminan/editan a la vez.
  select * into o from public.ordenes_compra_v2 where id = p_oc_id for update;
  if not found then raise exception 'OCE: la OC no existe (¿ya fue eliminada?). No se eliminó nada.' using errcode = 'P0002'; end if;
  if p_original_id is not null then perform 1 from public.ordenes_compra_v2 where id = p_original_id for share; end if;
  if upper(btrim(coalesce(p_confirmacion, ''))) <> upper(btrim(o.numero_oc)) then
    raise exception 'OCE: la confirmación no coincide con el N° de la OC. No se eliminó nada.' using errcode = '22023';
  end if;
  if length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'OCE: indique el motivo de la eliminación. No se eliminó nada.' using errcode = '22023'; end if;
  v_rev := public.oc_eliminacion_revisar(p_oc_id, p_original_id);
  if not (v_rev ->> 'eliminable')::boolean then
    raise exception 'OCE: no se puede eliminar: %. No se eliminó nada.',
      (select string_agg(b ->> 'texto', ' ') from jsonb_array_elements(v_rev -> 'bloqueos') b) using errcode = '42501';
  end if;

  -- Copia completa (para auditoría y para restaurar).
  v_copia := jsonb_build_object('ordenes_compra_v2', to_jsonb(o));
  foreach t in array public.oce_tablas() loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.oc_id = $1', t) into v_filas using p_oc_id;
      if jsonb_array_length(v_filas) > 0 then v_copia := v_copia || jsonb_build_object(t, v_filas); end if;
    end if;
  end loop;
  v_firma := public.oce_firma_ajena(p_oc_id);
  select nombre into v_nombre from public.perfiles where id = auth.uid();
  select numero_oc into v_orig_num from public.ordenes_compra_v2 where id = p_original_id;
  v_resumen := jsonb_build_object('registros', v_rev -> 'registros', 'movimientos', v_rev -> 'movimientos', 'advertencias', v_rev -> 'advertencias',
    'monto_total', o.monto_total, 'costo_total', o.costo_total, 'monto_cobrado', o.monto_cobrado, 'monto_pagado_fin', o.monto_pagado_fin,
    'financiador_id', o.financiador_id, 'vendedor_id', o.vendedor_id);
  v_id := public.fin_nuevo_id('oce');
  insert into public.oc_eliminaciones (id, oc_id, numero_oc, cliente, estaba_archivada, original_id, original_numero, motivo, eliminado_por, eliminado_por_nombre, resumen, copia)
  values (v_id, o.id, o.numero_oc, o.cliente, coalesce(o.archivada, false), p_original_id, v_orig_num, btrim(p_motivo), auth.uid(), v_nombre, v_resumen, v_copia);

  -- Se eliminan SOLO las filas de esta OC (los correos se conservan sin OC). Los disparadores existentes recalculan
  -- la OC y su financiador y siguen bloqueando lo que tenga una corrección histórica pendiente.
  foreach t in array public.oce_tablas() loop
    if to_regclass('public.' || t) is not null then
      if t = 'correos_bfk' then execute 'update public.correos_bfk set oc_id = null where oc_id = $1' using p_oc_id;
      else execute format('delete from public.%I where oc_id = $1', t) using p_oc_id; end if;
    end if;
  end loop;
  delete from public.ordenes_compra_v2 where id = p_oc_id;

  -- Nada huérfano y nada ajeno cambiado; si no, se revierte TODO (incluida la auditoría).
  foreach t in array public.oce_tablas() loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I where oc_id = $1', t) into n using p_oc_id;
      if n > 0 then raise exception 'OCE: quedaron % fila(s) de la OC en %. No se eliminó nada.', n, t; end if;
    end if;
  end loop;
  if public.oce_firma_ajena(p_oc_id) <> v_firma then
    raise exception 'OCE: la eliminación habría cambiado datos de otras OC, financiadores o pagos. No se eliminó nada.' using errcode = '42501';
  end if;
  return jsonb_build_object('eliminacion', v_id, 'oc', o.numero_oc, 'registros', v_rev -> 'registros');
end $$;

-- Restaurar: vuelve a insertar exactamente lo eliminado (mismos id y valores) y recalcula la OC y su financiador.
create or replace function public.oc_eliminacion_restaurar(p_id text, p_confirmacion text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.oc_eliminaciones%rowtype; t text; v_nombre text; v_firma text; v_fins text[];
begin
  if not public.oce_es_admin() then raise exception 'OCE: solo un administrador puede restaurar una OC.' using errcode = '42501'; end if;
  select * into e from public.oc_eliminaciones where id = p_id for update;
  if not found then raise exception 'OCE: eliminación no encontrada.' using errcode = 'P0002'; end if;
  if e.restaurado_en is not null then raise exception 'OCE: esta OC ya fue restaurada.' using errcode = '22023'; end if;
  if upper(btrim(coalesce(p_confirmacion, ''))) <> upper(btrim(e.numero_oc)) then raise exception 'OCE: la confirmación no coincide con el N° de la OC.' using errcode = '22023'; end if;
  if exists (select 1 from public.ordenes_compra_v2 where id = e.oc_id) then raise exception 'OCE: ya existe una OC con ese identificador.' using errcode = '23505'; end if;
  v_firma := public.oce_firma_ajena(e.oc_id);
  -- Modo importación SOLO en esta transacción: los disparadores no reescriben los montos derivados copiados.
  perform set_config('bfk.importacion', 'on', true);
  insert into public.ordenes_compra_v2 overriding system value select * from jsonb_populate_record(null::public.ordenes_compra_v2, e.copia -> 'ordenes_compra_v2');
  foreach t in array public.oce_tablas() loop
    if t <> 'correos_bfk' and e.copia ? t then
      execute format('insert into public.%I overriding system value select * from jsonb_populate_recordset(null::public.%I, $1)', t, t) using e.copia -> t;
    end if;
  end loop;
  if e.copia ? 'correos_bfk' then
    update public.correos_bfk c set oc_id = e.oc_id where c.id::text in (select x ->> 'id' from jsonb_array_elements(e.copia -> 'correos_bfk') x) and c.oc_id is null;
  end if;
  perform set_config('bfk.importacion', 'off', true);
  select array_agg(distinct f) into v_fins from (select e.copia -> 'ordenes_compra_v2' ->> 'financiador_id' f
     union select x ->> 'financiador_id' from jsonb_array_elements(coalesce(e.copia -> 'eventos_pago_financiamiento', '[]')) x) z where f is not null;
  perform public.fin_recalcular(array[e.oc_id], coalesce(v_fins, '{}'));
  if public.oce_firma_ajena(e.oc_id) <> v_firma then raise exception 'OCE: la restauración habría cambiado datos de otras OC o financiadores. No se restauró nada.'; end if;
  select nombre into v_nombre from public.perfiles where id = auth.uid();
  update public.oc_eliminaciones set restaurado_en = now(), restaurado_por = auth.uid(), restaurado_por_nombre = v_nombre where id = p_id;
  return jsonb_build_object('restaurada', e.numero_oc);
end $$;

revoke all on function public.oc_eliminacion_revisar(text, text) from public, anon;
revoke all on function public.oc_eliminar_definitivamente(text, text, text, text) from public, anon;
revoke all on function public.oc_eliminacion_restaurar(text, text) from public, anon;
revoke all on function public.oce_firma_ajena(text) from public, anon, authenticated;
revoke all on function public.oce_es_admin() from public, anon;
grant execute on function public.oc_eliminacion_revisar(text, text) to authenticated;
grant execute on function public.oc_eliminar_definitivamente(text, text, text, text) to authenticated;
grant execute on function public.oc_eliminacion_restaurar(text, text) to authenticated;
grant execute on function public.oce_es_admin() to authenticated;
notify pgrst, 'reload schema';
