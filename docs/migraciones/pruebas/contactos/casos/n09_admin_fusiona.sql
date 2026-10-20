\ir ../_admin.sql
select (select id from public.contactos_institucionales where correo_clave = 'carla@muni-alfa.cl') as a, (select id from public.contactos_institucionales where correo_clave = 'carla.ruiz@antiguo-alfa.cl') as b \gset
select public.fusionar_contactos(:'a'::uuid, :'b'::uuid, 'misma persona') as r \gset
select 'CI|n09a|fusión: el absorbido queda obsoleto, no se borra|' || exists(select 1 from public.contactos_institucionales where id = :'b'::uuid and estado = 'obsoleto' and reemplazado_por = :'a'::uuid)::text;
select 'CI|n09b|las OC del absorbido quedan también en el conservado|' || (exists(select 1 from public.contactos_institucionales_oc where contacto_id = :'a'::uuid and oc_id = 'ci_t_16') and exists(select 1 from public.contactos_institucionales_oc where contacto_id = :'b'::uuid and oc_id = 'ci_t_16'))::text;
