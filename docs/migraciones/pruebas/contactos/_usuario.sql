\set ON_ERROR_STOP 0
\set QUIET 1
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'usr', 'role', 'authenticated')::text, false) \gset _
\set QUIET 0
