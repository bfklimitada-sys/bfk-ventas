-- 4. Varios contactos institucionales: otra persona = contacto adicional
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_03', 'mp')->'resultados'->0->>'accion' as a \gset
select 'CI|c05a|otra persona de la misma institución = contacto adicional vigente|' || (:'a' = 'nuevo' and (select count(*) from public.contactos_institucionales where rut_clave = '991112227' and estado = 'vigente') = 2)::text;
