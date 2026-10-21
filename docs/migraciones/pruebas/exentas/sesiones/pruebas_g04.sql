\set ON_ERROR_STOP off
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true);
set local role authenticated;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto) values ('g3d', 'ocv2_g3_ex', current_date, '4', 2704000);
\set fallo :ERROR
rollback;
select 'G3|sin_tipo_en_oc_exenta_bloqueada|' || (:'fallo' = 'true' and :'LAST_ERROR_MESSAGE' ~ 'solo admite factura exenta')::text;
