-- Elimina SOLO los datos de prueba (marcadores 'ci_t_%' y RUT 99.111.xxx). Usa el modo importación para los contactos.
begin;
select set_config('bfk.importacion', 'on', true);
delete from public.contactos_institucionales_historial where rut_clave like '99111%';
delete from public.contactos_institucionales_oc where contacto_id in (select id from public.contactos_institucionales where rut_clave like '99111%');
update public.contactos_institucionales set conflicto_con = null, reemplazado_por = null where rut_clave like '99111%';
delete from public.contactos_institucionales where rut_clave like '99111%';
delete from public.entidades_catalogo where id like 'ci\_t\_%' or rut like '99.111.%';
delete from public.ordenes_compra_v2 where id like 'ci\_t\_%';
commit;
