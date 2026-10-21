\set ON_ERROR_STOP off
\set QUIET 1
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true), set_config('request.method', 'POST', true) \gset _
set local role authenticated;
\set QUIET 0
-- d(marca, decisión, tabla, ids): llama a la función; deja el error en :msg (vacío si OK).
