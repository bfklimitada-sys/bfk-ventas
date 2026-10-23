\set ON_ERROR_STOP off
\set QUIET 1
begin;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, true) as _jwt \gset
set local role authenticated;
\set QUIET 0
