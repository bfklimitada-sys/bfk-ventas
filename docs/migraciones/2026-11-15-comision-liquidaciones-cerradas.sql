-- 15/11/2026 (Kevin): protección definitiva de liquidaciones de comisiones cerradas y ajustes. Rige desde noviembre 2026.
-- Decisiones de Kevin: (1) las liquidaciones pagadas sin monto verificado hasta octubre 2026 se protegen tal como están;
-- (2) desde noviembre 2026 una liquidación queda cerrada al quedar pagada completa (mes terminado, comisión definitiva);
-- (3) un ajuste aprobado se reconoce en el mes original como línea aparte (no toca lo pagado).
--
-- · comision_liquidaciones / comision_liquidacion_ocs: una liquidación cerrada por vendedor y mes, con la comisión
--   reconocida, la utilidad y el descuento F29 usados y sus OC con la utilidad de cada una. Inmutables.
-- · comision_decisiones: decisiones de un administrador (ajustes por revisar aprobados/rechazados; OC «Por revisar»
--   reconocidas o descartadas) con fecha, usuario, motivo y respaldo. Inmutables.
-- · cerrar_liquidacion_comision(jsonb): cierre de un mes pagado completo desde noviembre 2026 (lo llama la app; la base
--   exige mes terminado y pagos que cubran la comisión). decidir_comision(jsonb): solo administradores.
-- · pv_cierre_guardia: un pago no puede llevar la comisión pagada de un mes cerrado por sobre lo reconocido + ajustes
--   aprobados (el excedente va como extra de gestión, como siempre). Los pagos históricos no se tocan.
-- · oc_vendedor_tras_cierre: una OC con factura hasta octubre 2026 sin período cerrado (nunca liquidada) que recibe un
--   vendedor queda «Por revisar» (no entra en ningún mes ni pago) hasta que un administrador decida.
-- Las 17 liquidaciones con evidencia hasta octubre 2026 (13 verificadas y 4 pagadas completas) se registran aparte
-- (comision-liquidaciones-historicas, generado desde la app sobre el respaldo del día) con el cálculo vigente, sin recalcular.
-- No se modifica ningún pago, OC, período cerrado ni marca existente. Deshacer: …-deshacer.sql.

create table if not exists public.comision_liquidaciones (
  id text primary key,
  vendedor_id text not null references public.vendedores(id),
  anio int not null, mes int not null check (mes between 1 and 12),
  origen text not null check (origen in ('historica_verificada', 'historica_pagada', 'verificada', 'pagada')),
  comision_reconocida numeric(16,2) not null check (comision_reconocida >= 0),
  comision_ordinaria numeric(16,2) not null, ventas_propias numeric(16,2) not null default 0,
  utilidad_vendedor numeric(16,2) not null, utilidad_periodo numeric(16,2), descuento_f29 numeric(16,2) not null,
  regla_periodo boolean not null default false, peso numeric(16,2), peso_total numeric(16,2),
  pagado_al_cierre numeric(16,2) not null default 0,
  cerrada_en timestamptz not null default now(), cerrada_por uuid, nota text,
  constraint comision_liquidaciones_unica unique (vendedor_id, anio, mes),
  constraint comision_liquidaciones_origen_periodo check (
    (origen like 'historica_%' and anio * 12 + mes < 2026 * 12 + 11) or (origen not like 'historica_%' and anio * 12 + mes >= 2026 * 12 + 11))
);
create table if not exists public.comision_liquidacion_ocs (
  liquidacion_id text not null references public.comision_liquidaciones(id),
  oc_id text not null, numero_oc text not null,
  utilidad numeric(16,2) not null, venta_propia boolean not null default false, pago_venta_propia numeric(16,2) not null default 0,
  primary key (liquidacion_id, oc_id)
);
create table if not exists public.comision_decisiones (
  id text primary key default ('cd_' || replace(gen_random_uuid()::text, '-', '')),
  tipo text not null check (tipo in ('ajuste_utilidad', 'oc_por_revisar')),
  resultado text not null check (resultado in ('aprobado', 'rechazado', 'reconocer', 'no_corresponde')),
  liquidacion_id text references public.comision_liquidaciones(id),
  oc_id text not null, numero_oc text, vendedor_id text, anio int, mes int,
  utilidad_anterior numeric(16,2), utilidad_nueva numeric(16,2), monto numeric(16,2) not null default 0,
  motivo text not null check (length(btrim(motivo)) > 0), respaldo text not null check (length(btrim(respaldo)) > 0),
  decidido_en timestamptz not null default now(), decidido_por uuid not null,
  constraint comision_decisiones_coherente check (
    (tipo = 'ajuste_utilidad' and resultado in ('aprobado', 'rechazado') and liquidacion_id is not null)
    or (tipo = 'oc_por_revisar' and resultado in ('reconocer', 'no_corresponde') and monto = 0))
);
create index if not exists comision_decisiones_liq on public.comision_decisiones (liquidacion_id, oc_id);

-- Inmutables: nada se modifica ni elimina desde la app (solo una importación de respaldo).
create or replace function public.comision_trg_inmutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if public.fin_es_importacion() then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception 'Una liquidación cerrada y las decisiones sobre comisiones no se modifican ni se eliminan (%).', tg_table_name using errcode = 'CL001';
end $$;
drop trigger if exists comision_inmutable on public.comision_liquidaciones;
create trigger comision_inmutable before update or delete on public.comision_liquidaciones for each row execute function public.comision_trg_inmutable();
drop trigger if exists comision_inmutable on public.comision_liquidacion_ocs;
create trigger comision_inmutable before update or delete on public.comision_liquidacion_ocs for each row execute function public.comision_trg_inmutable();
drop trigger if exists comision_inmutable on public.comision_decisiones;
create trigger comision_inmutable before update or delete on public.comision_decisiones for each row execute function public.comision_trg_inmutable();

-- Lectura para usuarios BFK; escritura solo por las funciones de abajo (y la migración).
alter table public.comision_liquidaciones enable row level security;
alter table public.comision_liquidacion_ocs enable row level security;
alter table public.comision_decisiones enable row level security;
drop policy if exists leer_bfk on public.comision_liquidaciones;
create policy leer_bfk on public.comision_liquidaciones for select to authenticated using (public.bfk_es_usuario());
drop policy if exists leer_bfk on public.comision_liquidacion_ocs;
create policy leer_bfk on public.comision_liquidacion_ocs for select to authenticated using (public.bfk_es_usuario());
drop policy if exists leer_bfk on public.comision_decisiones;
create policy leer_bfk on public.comision_decisiones for select to authenticated using (public.bfk_es_usuario());
revoke all on public.comision_liquidaciones, public.comision_liquidacion_ocs, public.comision_decisiones from anon, authenticated;
grant select on public.comision_liquidaciones, public.comision_liquidacion_ocs, public.comision_decisiones to authenticated;

-- Pagos válidos (comisión) de un vendedor y mes.
create or replace function public.comision_pagado_mes(p_vendedor text, p_anio int, p_mes int) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select coalesce(sum(monto_pagado), 0) from public.pagos_vendedor where vendedor_id = p_vendedor and anio = p_anio and mes = p_mes and anulado_en is null
$$;
-- Comisión reconocida + ajustes aprobados de una liquidación cerrada (null si el mes no está cerrado).
create or replace function public.comision_reconocida_mes(p_vendedor text, p_anio int, p_mes int) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select l.comision_reconocida + coalesce((select sum(d.monto) from public.comision_decisiones d where d.liquidacion_id = l.id and d.tipo = 'ajuste_utilidad' and d.resultado = 'aprobado'), 0)
    from public.comision_liquidaciones l where l.vendedor_id = p_vendedor and l.anio = p_anio and l.mes = p_mes
$$;

-- Cierre de un mes pagado completo (desde noviembre 2026). Idempotente: si ya estaba cerrado devuelve el existente.
create or replace function public.cerrar_liquidacion_comision(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_vend text := p->>'vendedor_id'; v_anio int := (p->>'anio')::int; v_mes int := (p->>'mes')::int;
  v_id text; v_rec numeric := (p->>'comision_reconocida')::numeric; v_pagado numeric; r jsonb;
  -- bfk.hoy_prueba: solo para ensayos en una copia (una sesión de la base); desde la app/API no se puede fijar.
  v_hoy date := coalesce(nullif(current_setting('bfk.hoy_prueba', true), '')::date, (now() at time zone 'America/Santiago')::date);
begin
  if v_uid is null or not public.bfk_es_usuario() then raise exception 'Se requiere una sesión BFK válida' using errcode = 'CL010'; end if;
  if v_anio * 12 + v_mes < 2026 * 12 + 11 then raise exception 'Solo se cierran automáticamente meses desde noviembre 2026' using errcode = 'CL011'; end if;
  if v_anio * 12 + v_mes >= extract(year from v_hoy)::int * 12 + extract(month from v_hoy)::int then raise exception 'El mes aún no termina: no se cierra' using errcode = 'CL012'; end if;
  if (p->>'origen') not in ('verificada', 'pagada') then raise exception 'Origen de cierre no válido' using errcode = 'CL013'; end if;
  if not exists (select 1 from public.vendedores where id = v_vend) then raise exception 'El vendedor no existe' using errcode = 'CL014'; end if;
  v_id := 'cl_' || v_vend || '_' || v_anio || '_' || lpad(v_mes::text, 2, '0');
  if exists (select 1 from public.comision_liquidaciones where id = v_id) then return jsonb_build_object('ok', true, 'id', v_id, 'ya_cerrada', true); end if;
  v_pagado := public.comision_pagado_mes(v_vend, v_anio, v_mes);
  if v_pagado <= 0 or v_pagado + 0.5 < v_rec then raise exception 'La comisión del mes no está pagada completa (pagado %, comisión %): no se cierra', v_pagado, v_rec using errcode = 'CL015'; end if;
  insert into public.comision_liquidaciones (id, vendedor_id, anio, mes, origen, comision_reconocida, comision_ordinaria, ventas_propias, utilidad_vendedor,
    utilidad_periodo, descuento_f29, regla_periodo, peso, peso_total, pagado_al_cierre, cerrada_por, nota)
  values (v_id, v_vend, v_anio, v_mes, p->>'origen', v_rec, (p->>'comision_ordinaria')::numeric, coalesce((p->>'ventas_propias')::numeric, 0),
    (p->>'utilidad_vendedor')::numeric, (p->>'utilidad_periodo')::numeric, (p->>'descuento_f29')::numeric, coalesce((p->>'regla_periodo')::boolean, false),
    (p->>'peso')::numeric, (p->>'peso_total')::numeric, v_pagado, v_uid, 'Cerrada al quedar pagada completa');
  for r in select * from jsonb_array_elements(coalesce(p->'ocs', '[]'::jsonb)) loop
    if not exists (select 1 from public.ordenes_compra_v2 o where o.id = r->>'oc_id' and o.vendedor_id = v_vend) then
      raise exception 'La OC % no es de este vendedor: no se cierra', r->>'numero_oc' using errcode = 'CL016'; end if;
    insert into public.comision_liquidacion_ocs (liquidacion_id, oc_id, numero_oc, utilidad, venta_propia, pago_venta_propia)
    values (v_id, r->>'oc_id', r->>'numero_oc', (r->>'utilidad')::numeric, coalesce((r->>'venta_propia')::boolean, false), coalesce((r->>'pago_venta_propia')::numeric, 0));
  end loop;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Decisión de un administrador (con motivo y respaldo; queda quién y cuándo).
create or replace function public.decidir_comision(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_tipo text := p->>'tipo'; v_res text := p->>'resultado'; v_oc public.ordenes_compra_v2%rowtype; v_liq public.comision_liquidaciones%rowtype; v_id text;
  v_quien text; v_txt text;
begin
  if v_uid is null or not public.pv_es_admin() then raise exception 'Solo un administrador puede decidir ajustes y OC por revisar' using errcode = 'CL020'; end if;
  if length(btrim(coalesce(p->>'motivo', ''))) = 0 or length(btrim(coalesce(p->>'respaldo', ''))) = 0 then raise exception 'Indica el motivo y el respaldo de la decisión' using errcode = 'CL021'; end if;
  select * into v_oc from public.ordenes_compra_v2 where id = p->>'oc_id';
  if v_tipo = 'ajuste_utilidad' then
    select * into v_liq from public.comision_liquidaciones where id = p->>'liquidacion_id';
    if not found then raise exception 'La liquidación no existe o no está cerrada' using errcode = 'CL022'; end if;
    if exists (select 1 from public.comision_decisiones d where d.liquidacion_id = v_liq.id and d.oc_id = p->>'oc_id' and d.utilidad_nueva = (p->>'utilidad_nueva')::numeric) then
      raise exception 'Este ajuste ya fue decidido' using errcode = 'CL023'; end if;
    insert into public.comision_decisiones (tipo, resultado, liquidacion_id, oc_id, numero_oc, vendedor_id, anio, mes, utilidad_anterior, utilidad_nueva, monto, motivo, respaldo, decidido_por)
    values ('ajuste_utilidad', v_res, v_liq.id, p->>'oc_id', coalesce(v_oc.numero_oc, p->>'numero_oc'), v_liq.vendedor_id, v_liq.anio, v_liq.mes,
      (p->>'utilidad_anterior')::numeric, (p->>'utilidad_nueva')::numeric, case when v_res = 'aprobado' then round((p->>'monto')::numeric, 2) else 0 end,
      btrim(p->>'motivo'), btrim(p->>'respaldo'), v_uid) returning id into v_id;
  elsif v_tipo = 'oc_por_revisar' then
    if not found or v_oc.comision_revision is distinct from 'por_revisar' then raise exception 'La OC no está «Por revisar»' using errcode = 'CL024'; end if;
    insert into public.comision_decisiones (tipo, resultado, oc_id, numero_oc, vendedor_id, motivo, respaldo, decidido_por)
    values ('oc_por_revisar', v_res, v_oc.id, v_oc.numero_oc, v_oc.vendedor_id, btrim(p->>'motivo'), btrim(p->>'respaldo'), v_uid) returning id into v_id;
    select coalesce((select nombre from public.perfiles where id = v_uid), 'administrador') into v_quien;
    v_txt := format('Decidida el %s por %s: %s. Motivo: %s. Respaldo: %s', to_char(now() at time zone 'America/Santiago', 'DD/MM/YYYY'), v_quien,
      case when v_res = 'reconocer' then 'corresponde reconocer la obligación' else 'no corresponde comisión' end, btrim(p->>'motivo'), btrim(p->>'respaldo'));
    update public.ordenes_compra_v2 set comision_revision = 'revisada', comision_revision_motivo = v_txt,
      comision_excluida = case when v_res = 'no_corresponde' then true else comision_excluida end where id = v_oc.id;
  else raise exception 'Tipo de decisión no válido' using errcode = 'CL025';
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

revoke all on function public.cerrar_liquidacion_comision(jsonb) from public, anon;
revoke all on function public.decidir_comision(jsonb) from public, anon;
revoke all on function public.comision_pagado_mes(text, int, int) from public, anon;
revoke all on function public.comision_reconocida_mes(text, int, int) from public, anon;
grant execute on function public.cerrar_liquidacion_comision(jsonb) to authenticated;
grant execute on function public.decidir_comision(jsonb) to authenticated;
grant execute on function public.comision_pagado_mes(text, int, int) to authenticated;
grant execute on function public.comision_reconocida_mes(text, int, int) to authenticated;

-- Un pago nuevo no puede llevar la comisión pagada de un mes cerrado por sobre lo reconocido + ajustes aprobados.
create or replace function public.pv_trg_cierre_guardia() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_lim numeric; v_pag numeric;
begin
  if public.fin_es_importacion() or coalesce(new.monto_pagado, 0) <= 0 then return new; end if;
  v_lim := public.comision_reconocida_mes(new.vendedor_id, new.anio, new.mes);
  if v_lim is null then return new; end if;
  v_pag := public.comision_pagado_mes(new.vendedor_id, new.anio, new.mes);
  if v_pag + new.monto_pagado > v_lim + 0.5 then
    raise exception 'La liquidación de %/% está cerrada: la comisión reconocida es % y ya se pagaron %. El excedente debe registrarse como extra de gestión.',
      lpad(new.mes::text, 2, '0'), new.anio, public.fin_pesos(v_lim), public.fin_pesos(v_pag) using errcode = 'CL030';
  end if;
  return new;
end $$;
drop trigger if exists pv_cierre_guardia on public.pagos_vendedor;
create trigger pv_cierre_guardia before insert on public.pagos_vendedor for each row execute function public.pv_trg_cierre_guardia();

-- OC con factura hasta octubre 2026, nunca liquidada (sin período cerrado), que recibe un vendedor: «Por revisar».
create or replace function public.oc_trg_vendedor_tras_cierre() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare p record;
begin
  if public.fin_es_importacion() then return new; end if;
  if new.vendedor_id is null or new.vendedor_id is not distinct from old.vendedor_id then return new; end if;
  if old.comision_cierre_anio is not null or coalesce(new.comision_tras_cierre, false) or coalesce(new.comision_excluida, false)
     or coalesce(new.capitalizacion_bfk, false) or coalesce(new.tipo_registro, 'venta') <> 'venta' or new.estado_factura_propia is distinct from 'emitida' then return new; end if;
  select * into p from public.fin_periodo_comision(new.id);
  if p.anio is null or p.anio * 12 + p.mes >= 2026 * 12 + 11 then return new; end if;
  new.comision_revision := 'por_revisar';
  new.comision_revision_motivo := format('Vendedor asignado el %s a una OC con factura de %s/%s, período cerrado y nunca liquidada: no entra en ninguna comisión ni pago hasta que un administrador decida si corresponde reconocer la obligación',
    to_char(now() at time zone 'America/Santiago', 'DD/MM/YYYY'), lpad(p.mes::text, 2, '0'), p.anio);
  return new;
end $$;
drop trigger if exists oc_vendedor_tras_cierre on public.ordenes_compra_v2;
create trigger oc_vendedor_tras_cierre before update of vendedor_id on public.ordenes_compra_v2 for each row execute function public.oc_trg_vendedor_tras_cierre();
