-- REGLA 8/10: corrección manual del correo desde la ficha: el anterior queda obsoleto; la OC histórica no cambia
\ir ../_usuario.sql
\ir ../_ids.sql
select md5(contacto || '|' || correo_cliente) as oc_antes from public.ordenes_compra_v2 where id = 'ci_t_04' \gset
select public.guardar_contacto_institucional(nullif(:'ana_gob','')::uuid, '99111222-7', '{"correo":"Ana.P@alfa.gob.cl"}'::jsonb, 'ci_t_04') as r \gset
\ir ../_ids.sql
select 'CI|c11a|el contacto compartido toma el correo corregido|' || exists(select 1 from public.contactos_institucionales where id = nullif(:'ana_p','')::uuid and estado = 'vigente' and confirmado_manual)::text;
select 'CI|c11b|el correo anterior queda como obsoleto (no se borra)|' || exists(select 1 from public.contactos_institucionales where correo_clave = 'ana.perez@alfa.gob.cl' and estado = 'obsoleto' and reemplazado_por = nullif(:'ana_p','')::uuid)::text;
select 'CI|c11c|la OC que respaldaba el correo anterior queda vinculada al registro obsoleto|' || exists(select 1 from public.contactos_institucionales_oc o join public.contactos_institucionales c on c.id = o.contacto_id where o.oc_id = 'ci_t_04' and c.correo_clave = 'ana.perez@alfa.gob.cl' and o.correo_en_oc = 'ana.perez@alfa.gob.cl')::text;
select 'CI|c11d|el contacto histórico de la OC NO se modificó|' || ((select md5(contacto || '|' || correo_cliente) from public.ordenes_compra_v2 where id = 'ci_t_04') = :'oc_antes')::text;
select 'CI|c11e|historial con correo anterior y nuevo|' || exists(select 1 from public.contactos_institucionales_historial where contacto_id = nullif(:'ana_p','')::uuid and accion = 'correccion_manual' and anterior->>'correo' = 'ana.perez@alfa.gob.cl' and nuevo->>'correo' = 'ana.p@alfa.gob.cl' and oc_id = 'ci_t_04')::text;
select public.conciliar_contactos_oc('ci_t_04', 'mp')->'resultados'->0->>'accion' as a \gset
select 'CI|c11f|resincronizar la OC antigua no revive el correo corregido|' || (:'a' = 'correo_obsoleto')::text;
