-- BASE LOCAL DESECHABLE para probar importar_respaldo_excel. NO es el esquema real de producción:
-- es una réplica construida a partir de lo conocido (columnas de ordenes_compra_v2, financiadores,
-- eventos_pago_financiamiento, historial_cambios, perfiles, políticas RLS de la Fase 2) y de cómo usa
-- el código las demás tablas. Incluye columnas de prueba (jsonb, text[], generada) y restricciones
-- (FK, UNIQUE, CHECK, NOT NULL) para forzar fallos.
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade; create schema auth;
do $$ begin
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
grant usage on schema public, auth to authenticated, anon;
grant execute on function auth.uid(), auth.role() to authenticated, anon;

create table public.perfiles(id uuid primary key, nombre text, rol text);
create table public.historial_cambios(id text primary key, oc_id text, oc_numero text, usuario_id uuid, usuario_nombre text, accion text not null, campo text, valor_anterior text, valor_nuevo text, "creadoEn" timestamptz default now());
create table public.financiadores(id text primary key, nombre text not null, saldo_deuda numeric not null default 0, activo boolean not null default true, "creadoEn" timestamptz default now());
create table public.vendedores(id text primary key, nombre text not null, comision_pct numeric default 0 check (comision_pct between 0 and 100), activo boolean default true,
  meta jsonb, etiquetas text[], notas text, nombre_mayus text generated always as (upper(nombre)) stored, "creadoEn" timestamptz default now());
create table public.categorias_gasto(id text primary key, nombre text not null);
create table public.ordenes_compra_v2(id text primary key, numero_oc text not null, cliente text, rut_cliente text, comuna text,
  vendedor_id text references public.vendedores(id), notas text,
  estado_compra text default 'pendiente', estado_entrega text default 'pendiente', estado_factura_propia text default 'pendiente',
  estado_pago_cliente text default 'pendiente', estado_pago_financiamiento text default 'pendiente',
  monto_total numeric default 0 check (monto_total >= 0), costo_total numeric default 0, monto_facturado numeric default 0, monto_cobrado numeric default 0,
  financiador_id text references public.financiadores(id), "creadoEn" timestamptz default now(), creado_por uuid, correo_cliente text,
  ultimo_reclamo_fecha timestamptz, ultimo_reclamo_por uuid, contacto text, entidad text, vendedor_pagado boolean default false,
  ultimo_editor uuid, ultima_edicion timestamptz, estado_postventa text, sync_pendiente boolean default false, tipo_despacho text,
  direccion_entrega text, dias_pago integer default 30, tipo_registro text, monto_pagado_fin numeric default 0, fecha_emision_mp date,
  no_en_mp boolean default false, fecha_hora_emision_mp timestamptz, es_venta_propia boolean default false);
create table public.eventos_compra(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, monto numeric, financiador_id text references public.financiadores(id), monto_venta numeric, costo_compra numeric, "creadoEn" timestamptz default now());
create table public.eventos_entrega(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, notas text, "creadoEn" timestamptz default now());
create table public.eventos_factura(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, numero_factura text, monto numeric, "creadoEn" timestamptz default now());
create table public.eventos_pago_cliente(id text primary key, oc_id text not null references public.ordenes_compra_v2(id), fecha date, monto numeric, "creadoEn" timestamptz default now());
create table public.eventos_pago_financiamiento(id text primary key, financiador_id text not null references public.financiadores(id), oc_id text references public.ordenes_compra_v2(id), fecha date, monto numeric not null, notas text default '', "creadoEn" timestamptz default now(), creado_por uuid);
create table public.gastos_indirectos(id text primary key, categoria_id text references public.categorias_gasto(id), monto numeric not null, mes int, anio int, fecha date, descripcion text);
create table public.iva_mensual(id text primary key, anio int not null, mes int not null, iva_ventas numeric, iva_compras numeric, iva_pagado numeric, unique(anio, mes));
create table public.pagos_vendedor(id text primary key, vendedor_id text references public.vendedores(id), anio int, mes int, monto_pagado numeric, fecha date, estado text, monto_verificado numeric);
create table public.ajustes_saldo_financiador(id text primary key, financiador_id text references public.financiadores(id), monto numeric, motivo text);
create table public.contactos_cobranza(id text primary key, rut text, nombre_cliente text, correo text);

-- RLS como en la Fase 2: autenticados leen/insertan/editan; solo admin borra
do $$ declare t text; begin
  foreach t in array array['perfiles','historial_cambios','financiadores','vendedores','categorias_gasto','ordenes_compra_v2','eventos_compra','eventos_entrega','eventos_factura','eventos_pago_cliente','eventos_pago_financiamiento','gastos_indirectos','iva_mensual','pagos_vendedor','ajustes_saldo_financiador','contactos_cobranza'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy autenticados_leen on public.%I for select to public using (auth.role() = ''authenticated'')', t);
    execute format('create policy autenticados_insertan on public.%I for insert to public with check (auth.role() = ''authenticated'')', t);
    if t <> 'historial_cambios' then
      execute format('create policy autenticados_editan on public.%I for update to public using (auth.role() = ''authenticated'') with check (auth.role() = ''authenticated'')', t);
    end if;
    execute format('create policy solo_admin_borra on public.%I for delete to public using (exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = ''admin''))', t);
  end loop;
end $$;
grant select, insert, update, delete on all tables in schema public to authenticated;
-- anon: sin acceso a tablas ni a la función (se revoca en la migración)

insert into perfiles values ('11111111-1111-1111-1111-111111111111','Admin Prueba','admin'),('22222222-2222-2222-2222-222222222222','Usuario Normal','usuario');
insert into financiadores select 'f'||g, 'Financiador '||g, 1000*g, true, now() from generate_series(1,3) g;
insert into vendedores(id,nombre,comision_pct,meta,etiquetas,notas) select 'v'||g, 'Vendedor '||g, 10, jsonb_build_object('a',g,'b','texto'), array['x','y'], 'nota '||g from generate_series(1,5) g;
insert into categorias_gasto select 'cat'||g, 'Categoria '||g from generate_series(1,4) g;
insert into ordenes_compra_v2(id, numero_oc, cliente, vendedor_id, financiador_id, notas, monto_total, costo_total)
  select 'oc'||lpad(g::text,5,'0'), '1000-'||g||'-OC26', 'Cliente '||g, 'v'||(1+g%5), 'f'||(1+g%3), 'nota original '||g, 1000000+g, 700000+g from generate_series(1,3000) g;
insert into eventos_compra(id, oc_id, fecha, monto, financiador_id) select 'ec'||lpad(g::text,5,'0'), 'oc'||lpad(g::text,5,'0'), '2026-09-01', 700000+g, 'f'||(1+g%3) from generate_series(1,300) g;
insert into iva_mensual values ('iva1',2026,7,1000,400,600),('iva2',2026,8,2000,500,1500);
insert into gastos_indirectos select 'g'||lpad(g::text,4,'0'), 'cat'||(1+g%4), 50000+g, 9, 2026, '2026-09-05', 'gasto '||g from generate_series(1,200) g;
