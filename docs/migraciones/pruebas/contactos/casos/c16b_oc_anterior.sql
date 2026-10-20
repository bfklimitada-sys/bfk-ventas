-- Una OC más ANTIGUA con otro correo de la misma persona: candidato marcado como de OC anterior
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_16', 'mp')->'resultados'->0->>'accion' as a \gset
select public.conciliar_contactos_oc('ci_t_14', 'mp')->'resultados'->0->>'accion' as b \gset
select 'CI|c22a|OC antigua: pendiente «correo de OC anterior», el vigente se mantiene|' || (:'a' = 'cambio_detectado' and exists(select 1 from public.contactos_institucionales where correo_clave = 'carla.ruiz@antiguo-alfa.cl' and motivo_pendiente = 'correo_de_oc_anterior') and exists(select 1 from public.contactos_institucionales where correo_clave = 'carla@muni-alfa.cl' and estado = 'vigente'))::text;
select 'CI|c22b|contra un contacto confirmado manualmente siempre avisa conflicto|' || (:'b' = 'conflicto_manual')::text;
