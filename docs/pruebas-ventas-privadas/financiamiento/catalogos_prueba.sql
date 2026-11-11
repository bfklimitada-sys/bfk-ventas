-- Catálogos de PRUEBA con los mismos identificadores y tipos que producción (vendedores y financiadores), sin montos reales.
-- Solo para la base desechable local (la réplica local no tiene financiadores.tipo).
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'financiadores' and column_name = 'tipo') then
    alter table public.financiadores add column tipo text not null default 'externo' check (tipo in ('externo','propio'));
  end if;
end $$;
insert into public.vendedores (id, nombre, activo) values ('vend_byron','Byron Vegas',true),('vend_francisco','Francisco Balboa',true),
  ('vend_juan','Juan Vergara',true),('vend_kevin','Kevin Vergara',true),('vend_matias','Matías Vegas',true),('vend_inactivo','Vendedor Retirado',false)
on conflict (id) do nothing;
insert into public.financiadores (id, nombre, saldo_deuda, tipo) values ('fin_byron','Byron Vegas',0,'externo'),('fin_cuenta_bfk','Cuenta BFK',0,'propio'),
  ('fin_francisco','Francisco Balboa',0,'externo'),('fin_kevin','Kevin Vergara',0,'externo'),('fin_matias','Matías Vegas',0,'externo')
on conflict (id) do update set tipo = excluded.tipo;
grant select on public.vendedores, public.financiadores to authenticated;
