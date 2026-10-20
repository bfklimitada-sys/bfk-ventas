-- Una OC más nueva actualiza un contacto NO confirmado (teléfono) y la bitácora conserva el dato anterior
\ir ../_usuario.sql
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_17', 'mp')->'resultados'->0->>'accion' as a \gset
select id as c from public.contactos_institucionales where rut_clave = '991113339' and correo_clave = 'ana.perez@muni-alfa.cl' \gset
select 'CI|n14a|OC más nueva actualiza el teléfono de un contacto no confirmado|' || (:'a' = 'actualizado' and exists(select 1 from public.contactos_institucionales where id = :'c'::uuid and telefono = '+56 9 7777 7777' and ultima_oc = 'ci_t_17'))::text;
select 'CI|n14b|el dato anterior queda en la bitácora y la OC anterior sigue vinculada|' || (exists(select 1 from public.contactos_institucionales_historial where contacto_id = :'c'::uuid and anterior->>'telefono' = '+56 9 1111 1111' and nuevo->>'telefono' = '+56 9 7777 7777' and oc_id = 'ci_t_17') and exists(select 1 from public.contactos_institucionales_oc where contacto_id = :'c'::uuid and oc_id = 'ci_t_10'))::text;
