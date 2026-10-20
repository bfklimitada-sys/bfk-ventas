-- 9. Edición manual sin sobrescritura posterior
\ir ../_admin.sql
\ir ../_ids.sql
select public.guardar_contacto_institucional(nullif(:'bruno','')::uuid, null, '{"telefono":"+56 2 2222 2222","cargo":"Jefe de Adquisiciones","departamento":"Adquisiciones"}'::jsonb, 'ci_t_03')->>'ok' as ok \gset
select public.conciliar_contactos_oc('ci_t_06', 'mp') as r \gset
select 'CI|c09a|corrección manual queda confirmada|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'bruno','')::uuid and confirmado_manual and departamento = 'Adquisiciones')::text;
select 'CI|c09b|una OC más nueva con otro teléfono NO sobrescribe el dato manual|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'bruno','')::uuid and telefono = '+56 2 2222 2222' and cargo = 'Jefe de Adquisiciones')::text;
select 'CI|c09c|y avisa que la OC difiere del dato manual|' || ((:'r')::jsonb->'resultados'->0->>'difiere_de_manual' = 'true')::text;
