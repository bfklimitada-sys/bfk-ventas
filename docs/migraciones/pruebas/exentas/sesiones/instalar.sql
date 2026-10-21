-- Instalación de las guardas en UNA transacción REPEATABLE READ: COMMIT solo si la huella de todo lo existente y la
-- huella financiera quedan idénticas (las guardas solo agregan dos disparadores trib_v_* y dos funciones trib3_*).
\set ON_ERROR_STOP on
begin isolation level repeatable read;
\set pfx pre_
\i g3/huella_total.sql
\i hf/huella_fin.sql
\i g3/guardas.sql
\set pfx post_
\i g3/huella_total.sql
\i hf/huella_fin.sql
select (:'pre_huella' = :'post_huella' and :'pre_fin' = :'post_fin') as igual \gset
\if :igual
  commit;
  select 'RESULT|guardas_instaladas_huellas_identicas|OK';
\else
  rollback;
  select 'FALLA|huella_cambio_ROLLBACK';
\endif
