-- Conexión directa sin claims (restauración de respaldo): las guardas no la bloquean.
\set ON_ERROR_STOP off
begin;
with i as (insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3j', 'ocv2_g3_af', current_date, '77', 1190000, 34) returning id)
select 'G3|restauracion_directa_no_bloqueada|' || (count(*) = 1)::text from i;
rollback;
