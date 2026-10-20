-- REGLA 11: una OC nueva contradice un correo confirmado manualmente → advertencia + pendiente
\ir ../_usuario.sql
\ir ../_ids.sql
select public.conciliar_contactos_oc('ci_t_07', 'mp') as r \gset
select 'CI|c10a|advertencia conflicto_manual|' || ((:'r')::jsonb->'resultados'->0->>'accion' = 'conflicto_manual')::text;
select 'CI|c10b|el nuevo correo queda pendiente y el manual intacto|' || (exists(select 1 from public.contactos_institucionales where correo_clave = 'bruno.soto@otro-alfa.cl' and estado = 'pendiente' and motivo_pendiente = 'contradice_manual' and conflicto_con = nullif(:'bruno','')::uuid) and exists(select 1 from public.contactos_institucionales where id = nullif(:'bruno','')::uuid and estado = 'vigente' and correo = 'bruno@muni-alfa.cl'))::text;
