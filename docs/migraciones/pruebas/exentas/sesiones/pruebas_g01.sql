\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte) values ('g3a', 'ocv2_g3_af', current_date, '1', 1190000, 34);
\set fallo :ERROR
rollback;
select 'G3|dte34_en_oc_afecta_bloqueada|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ 'no tiene una clasificación exenta')::text;
