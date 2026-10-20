-- REGLA 3 (duda): correo sin nombre con contactos existentes → pendiente de verificación; descartar no lo revive
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_08', 'mp')->'resultados'->0->>'accion' as a \gset
\ir ../_ids.sql
select 'CI|c15a|correo sin nombre: pendiente de verificación|' || (:'a' = 'pendiente_verificacion' and exists(select 1 from public.contactos_institucionales where id = nullif(:'compras','')::uuid and estado = 'pendiente' and motivo_pendiente = 'sin_nombre'))::text;
select public.resolver_contacto_pendiente(nullif(:'compras','')::uuid, 'descartar')->>'ok' as ok \gset
select public.conciliar_contactos_oc('ci_t_08', 'mp')->'resultados'->0->>'accion' as a2 \gset
select 'CI|c15b|descartado queda obsoleto y no reaparece al resincronizar|' || (:'a2' = 'correo_obsoleto' and exists(select 1 from public.contactos_institucionales where id = nullif(:'compras','')::uuid and estado = 'obsoleto'))::text;
