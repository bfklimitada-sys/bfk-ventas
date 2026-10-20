-- Correo de cobranza (reclamo de pago): se vincula a la OC, no sobrescribe al confirmado, no cambia la OC
\ir ../_usuario.sql
select md5(contacto || '|' || correo_cliente) as oc0 from public.ordenes_compra_v2 where id = 'ci_t_03' \gset
select public.registrar_correo_cobranza('ci_t_03', 'Bruno@Muni-Alfa.cl, finanzas@muni-alfa.cl') as r \gset
select 'CI|n12a|correo existente confirmado: solo se vincula a la OC (no cambia)|' || ((:'r')::jsonb->'resultados'->0->>'accion' = 'existente' and exists(select 1 from public.contactos_institucionales c join public.contactos_institucionales_oc v on v.contacto_id = c.id where c.rut_clave = '991112227' and c.correo_clave = 'bruno@muni-alfa.cl' and c.telefono = '+56 2 2222 2222' and v.oc_id = 'ci_t_03'))::text;
select 'CI|n12b|correo nuevo de cobranza: adicional vinculado a la OC con origen cobranza|' || exists(select 1 from public.contactos_institucionales c join public.contactos_institucionales_oc v on v.contacto_id = c.id where c.correo_clave = 'finanzas@muni-alfa.cl' and c.origen = 'cobranza' and c.estado = 'vigente' and v.oc_id = 'ci_t_03' and v.origen = 'cobranza')::text;
select 'CI|n12c|la OC no se modificó|' || ((select md5(contacto || '|' || correo_cliente) from public.ordenes_compra_v2 where id = 'ci_t_03') = :'oc0')::text;
select public.registrar_correo_cobranza('ci_t_03', 'finanzas@muni-alfa.cl')->'resultados'->0->>'accion' as a2 \gset
select 'CI|n12d|repetir el reclamo no duplica|' || (:'a2' = 'existente' and (select count(*) from public.contactos_institucionales where correo_clave = 'finanzas@muni-alfa.cl') = 1)::text;
