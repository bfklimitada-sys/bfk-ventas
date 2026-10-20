\set ON_ERROR_STOP 0
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000c1","role":"authenticated"}', false) \gset _
select public.conciliar_contactos_oc('ci_t_01', 'mp');
select 'CI|p07a|usuario sin perfil no concilia|' || (:'LAST_ERROR_MESSAGE' like '%usuario sin perfil%')::text;
select 'CI|p07b|usuario sin perfil no lee (RLS)|' || ((select count(*) from public.contactos_institucionales) = 0)::text;
