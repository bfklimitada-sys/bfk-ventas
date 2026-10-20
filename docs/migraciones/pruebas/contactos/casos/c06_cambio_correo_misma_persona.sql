-- REGLA 3/4: la misma persona trae un correo distinto en una OC más nueva → candidato pendiente, sin reemplazo automático
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_04', 'mp') as r \gset
\ir ../_ids.sql
select 'CI|c06a|correo distinto de la misma persona: cambio detectado y pendiente|' || ((:'r')::jsonb->'resultados'->0->>'accion' = 'cambio_detectado' and exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_gob','')::uuid and estado = 'pendiente' and motivo_pendiente = 'cambio_correo' and conflicto_con = nullif(:'ana_muni','')::uuid))::text;
select 'CI|c06b|el correo anterior sigue vigente hasta confirmar|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_muni','')::uuid and estado = 'vigente')::text;
select public.conciliar_contactos_oc('ci_t_04', 'mp')->'resultados'->0->>'accion' as a2 \gset
select 'CI|c06c|resincronizar no duplica el pendiente|' || (:'a2' = 'existente' and (select count(*) from public.contactos_institucionales where rut_clave = '991112227') = 3)::text;
