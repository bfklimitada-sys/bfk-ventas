-- Base local DESECHABLE: réplica mínima de pagos_vendedor (columnas reales de producción 08/10/2026) y de las funciones
-- de contexto. Ejecutar: psql -v ON_ERROR_STOP=1 -f pruebas.sql (desde esta carpeta).
\set QUIET on
drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth;
do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
grant usage on schema public, auth to authenticated; grant execute on all functions in schema auth to authenticated;
create function public.fin_es_cliente() returns boolean language sql stable as $$ select current_user in ('authenticated','anon') $$;
create function public.fin_es_importacion() returns boolean language sql stable as $$ select coalesce(current_setting('bfk.importacion', true),'') = 'on' $$;
create table public.perfiles(id uuid primary key, rol text);
create table public.vendedores(id text primary key, nombre text);
create table public.pagos_vendedor(id text not null primary key, vendedor_id text not null references public.vendedores(id), anio integer not null, mes integer not null,
  utilidad_mes numeric default 0 not null, iva_pagado_mes numeric default 0 not null, ventas_propias numeric default 0 not null,
  monto_calculado numeric default 0 not null, monto_pagado numeric default 0 not null, fecha date, estado text default 'pendiente' not null,
  notas text default '', "creadoEn" timestamptz default now(), creado_por uuid, monto_verificado numeric);
alter table public.pagos_vendedor enable row level security;
create policy rw_autenticados on public.pagos_vendedor for all using (auth.role() = 'authenticated');
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into public.vendedores values ('vm','Matías Vegas');
insert into public.perfiles values ('00000000-0000-0000-0000-00000000000a','admin'), ('00000000-0000-0000-0000-00000000000b','usuario');
insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_calculado,monto_pagado,fecha,estado,notas,monto_verificado)
  values ('pv_hist1','vm',2026,7,141975,141975,'2025-09-08','pagado','histórico',141975), ('pv_hist2','vm',2026,6,100000,120000,'2026-07-01','pagado','histórico',null);
create temp table huella as select md5(string_agg(to_jsonb(p)::text, ',' order by id)) h from public.pagos_vendedor p;

create function pg_temp.ok(n text, c boolean) returns void language plpgsql as $$ begin raise notice '%  %', case when c then 'OK   ' else 'FALLA' end, n; end $$;
create function pg_temp.falla(n text, q text, patron text) returns void language plpgsql as $$
begin begin execute q; perform pg_temp.ok(n || ' (no falló)', false); exception when others then perform pg_temp.ok(n || ' → ' || sqlerrm, sqlerrm ~* patron); end; end $$;

\i ../../2026-10-08-pago-vendedor-gestion.sql
\i ../../2026-10-08-pago-vendedor-gestion.sql
select pg_temp.ok('migración idempotente y filas históricas intactas (salvo columnas nuevas vacías)',
  (select md5(string_agg((to_jsonb(p) - array['monto_transferido','monto_extra_gestion','referencia_bancaria','anulado_en','anulado_por','motivo_anulacion'])::text, ',' order by id)) from public.pagos_vendedor p) = (select h from huella)
  and (select count(*) from public.pagos_vendedor where monto_transferido is null and monto_extra_gestion = 0 and anulado_en is null) = 2);

-- Como la app (rol authenticated, usuario normal)
set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000b',false);
insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_calculado,monto_pagado,monto_extra_gestion,monto_transferido,referencia_bancaria,fecha,estado,notas)
  values ('pv_n1','vm',2026,8,527867,527867,22133,550000,'op 1','2026-10-08','pagado','Ventas de Agosto/2026');
select pg_temp.ok('pago nuevo: 550.000 = 527.867 + 22.133', (select monto_transferido = monto_pagado + monto_extra_gestion from public.pagos_vendedor where id='pv_n1'));
select pg_temp.falla('mismo id dos veces', $q$insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_pagado,monto_extra_gestion,monto_transferido,fecha) values ('pv_n1','vm',2026,8,527867,22133,550000,'2026-10-08')$q$, 'duplicate|pkey');
select pg_temp.falla('total que no cuadra', $q$insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_pagado,monto_extra_gestion,monto_transferido,fecha) values ('pv_x1','vm',2026,8,500000,22133,550000,'2026-10-08')$q$, 'total_cuadra');
select pg_temp.falla('componente negativo', $q$insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_pagado,monto_extra_gestion,monto_transferido,fecha) values ('pv_x2','vm',2026,8,600000,-50000,550000,'2026-10-08')$q$, 'no_negativos');
select pg_temp.falla('extra sin total', $q$insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_pagado,monto_extra_gestion,fecha) values ('pv_x3','vm',2026,8,1,5,'2026-10-08')$q$, 'extra_con_total');
select pg_temp.falla('modificar montos', $q$update public.pagos_vendedor set monto_pagado = 1 where id='pv_n1'$q$, 'no se modifica');
select pg_temp.falla('modificar un pago histórico', $q$update public.pagos_vendedor set monto_pagado = 1 where id='pv_hist1'$q$, 'no se modifica');
select pg_temp.falla('eliminar un pago', $q$delete from public.pagos_vendedor where id='pv_n1'$q$, 'no se eliminan');
select pg_temp.falla('anular siendo usuario no administrador', $q$update public.pagos_vendedor set anulado_en = now(), motivo_anulacion='x' where id='pv_n1'$q$, 'administrador');
select pg_temp.falla('anular y cambiar montos a la vez', $q$update public.pagos_vendedor set anulado_en = now(), motivo_anulacion='x', monto_extra_gestion=0, monto_transferido=527867 where id='pv_n1'$q$, 'no se pueden cambiar');
select pg_temp.falla('pago nuevo que nace anulado (se ignora la anulación)', $q$do $d$ begin insert into public.pagos_vendedor(id,vendedor_id,anio,mes,monto_pagado,fecha,anulado_en,motivo_anulacion) values ('pv_n2','vm',2026,9,1000,'2026-10-08',now(),'x'); if (select anulado_en from public.pagos_vendedor where id='pv_n2') is null then raise exception 'nace vigente'; end if; end $d$$q$, 'nace vigente');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000000a',false);
select pg_temp.falla('anular sin motivo (administrador)', $q$update public.pagos_vendedor set anulado_en = now() where id='pv_n1'$q$, 'motivo');
update public.pagos_vendedor set anulado_en = now(), motivo_anulacion = 'Transferencia devuelta' where id='pv_n1';
select pg_temp.ok('administrador anula: fila conservada, usuario y fecha registrados', (select anulado_en is not null and anulado_por = '00000000-0000-0000-0000-00000000000a' and monto_transferido = 550000 from public.pagos_vendedor where id='pv_n1'));
select pg_temp.falla('anular dos veces', $q$update public.pagos_vendedor set anulado_en = now(), motivo_anulacion='otra' where id='pv_n1'$q$, 'ya está anulado');
reset role;

-- Mantención e importación de respaldo no quedan bloqueadas
select set_config('bfk.importacion','on',false);
update public.pagos_vendedor set notas = notas where id = 'pv_hist2';
select pg_temp.ok('importación de respaldo puede escribir', true);
select set_config('bfk.importacion','',false);

-- Deshacer: se niega si hay pagos con el formato nuevo
\set ON_ERROR_STOP off
\i ../../2026-10-08-pago-vendedor-gestion-deshacer.sql
\set ON_ERROR_STOP on
select pg_temp.ok('deshacer se niega con pagos nuevos (columnas intactas)', exists (select 1 from information_schema.columns where table_name='pagos_vendedor' and column_name='monto_extra_gestion'));
delete from public.pagos_vendedor where id in ('pv_n1','pv_n2');
\i ../../2026-10-08-pago-vendedor-gestion-deshacer.sql
select pg_temp.ok('deshacer sin pagos nuevos: vuelve al esquema y filas originales',
  not exists (select 1 from information_schema.columns where table_name='pagos_vendedor' and column_name='monto_extra_gestion')
  and (select md5(string_agg(to_jsonb(p)::text, ',' order by id)) from public.pagos_vendedor p) = (select h from huella));
