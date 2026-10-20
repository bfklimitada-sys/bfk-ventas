-- Sincronizaciones repetidas de la misma OC: sin duplicados ni bitácora extra
\ir ../_usuario.sql
select count(*) as h0 from public.contactos_institucionales_historial where rut_clave = '991112227' \gset
select public.conciliar_contactos_oc('ci_t_01', 'mp', 'Encargada de Adquisiciones')->'resultados'->0->>'accion' as a1 \gset
select public.conciliar_contactos_oc('ci_t_01', 'mp')->'resultados'->0->>'accion' as a2 \gset
select public.conciliar_contactos_oc('ci_t_01', 'oc')->'resultados'->0->>'accion' as a3 \gset
select 'CI|c03a|3 sincronizaciones de la misma OC: existente, 1 contacto, 1 vínculo|' || (:'a1' = 'existente' and :'a2' = 'existente' and :'a3' = 'existente' and (select count(*) from public.contactos_institucionales where rut_clave = '991112227') = 1 and (select count(*) from public.contactos_institucionales_oc where oc_id = 'ci_t_01') = 1)::text;
select 'CI|c03b|la bitácora no crece por resincronizar|' || ((select count(*) from public.contactos_institucionales_historial where rut_clave = '991112227') = :h0)::text;
