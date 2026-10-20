-- REGLA 5/6: confirmado el reemplazo, el correo anterior queda obsoleto y el nuevo vigente, con historial
\ir ../_admin.sql
\ir ../_ids.sql
select public.resolver_contacto_pendiente(nullif(:'ana_gob','')::uuid, 'reemplaza', 'Correo antiguo rebota') ->> 'ok' as ok \gset
select 'CI|c07a|el nuevo queda vigente y confirmado|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_gob','')::uuid and estado = 'vigente' and confirmado_manual and confirmado_por = :'adm' and motivo_pendiente is null)::text;
select 'CI|c07b|el anterior queda obsoleto, reemplazado por el nuevo y con el motivo|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_muni','')::uuid and estado = 'obsoleto' and reemplazado_por = nullif(:'ana_gob','')::uuid and obsoleto_motivo = 'Correo antiguo rebota')::text;
select 'CI|c07c|historial: correo anterior, fecha, origen y OC que respaldó el cambio|' || exists(select 1 from public.contactos_institucionales_historial where contacto_id = nullif(:'ana_muni','')::uuid and accion = 'reemplazado' and anterior->>'estado' = 'vigente' and nuevo->>'estado' = 'obsoleto' and oc_id = 'ci_t_04' and creado_en is not null)::text;
select 'CI|c07d|teléfono y cargo se heredan al nuevo correo|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_gob','')::uuid and cargo = 'Encargada de Adquisiciones' and telefono = '+56 9 1111 1111')::text;
