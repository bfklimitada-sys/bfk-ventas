\ir ../_ini.sql
savepoint s;
insert into public.conciliacion_decisiones (marca, decision, tabla, registro_id, monto_registro, mov_fecha, mov_monto, mov_sentido, usuario)
  values ('cart:20261014:250000:0:500000:1', 'vinculado', 'gastos_indirectos', 'cs_g1', 250000, '2026-10-14', 250000, 'sale', :'usr');
\set msg1 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select count(*) >= 0 as lee from public.conciliacion_decisiones \gset
reset role;
set local role anon;
savepoint s2;
select count(*) from public.conciliacion_decisiones;
\set msg2 :LAST_ERROR_MESSAGE
rollback to savepoint s2;
select 'CN|c12_sin_escritura_directa|' || (:'msg1' like '%permission denied%')::text;
select 'CN|c12_usuario_lee_y_anonimo_no|' || (:'lee' = 't' and :'msg2' like '%permission denied%')::text;
rollback;
