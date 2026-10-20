-- REGLA 5/9: una OC (nueva o antigua) con el correo ya obsoleto no lo revive
\ir ../_usuario.sql
\ir ../_ids.sql
select public.conciliar_contactos_oc('ci_t_05', 'mp')->'resultados'->0->>'accion' as a1 \gset
select public.conciliar_contactos_oc('ci_t_01', 'mp')->'resultados'->0->>'accion' as a2 \gset
select 'CI|c08a|OC con correo obsoleto: aviso y sigue obsoleto|' || (:'a1' = 'correo_obsoleto' and :'a2' = 'correo_obsoleto' and exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_muni','')::uuid and estado = 'obsoleto'))::text;
select 'CI|c08b|el vigente no cambia ni se duplica|' || (exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_gob','')::uuid and estado = 'vigente') and (select count(*) from public.contactos_institucionales where rut_clave = '991112227') = 3)::text;
