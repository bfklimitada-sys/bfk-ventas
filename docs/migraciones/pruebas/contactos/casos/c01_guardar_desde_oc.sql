-- 1. Guardar contacto desde una OC (Mercado Público)
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_01', 'mp', 'Encargada de Adquisiciones') as r \gset
select 'CI|c01a|OC nueva crea contacto vigente|' || ((:'r')::jsonb->'resultados'->0->>'accion' = 'nuevo')::text;
select 'CI|c01b|guarda nombre, cargo, teléfono, correo (minúsculas) y RUT formateado|' || exists(select 1 from public.contactos_institucionales where rut_clave = '991112227' and correo = 'ana.perez@muni-alfa.cl' and nombre = 'Ana Pérez' and telefono = '+56 9 1111 1111' and cargo = 'Encargada de Adquisiciones' and estado = 'vigente' and origen = 'mp' and rut = '99.111.222-7' and ultima_oc = 'ci_t_01')::text;
select 'CI|c01c|queda vinculado a la OC|' || (select count(*) = 1 from public.contactos_institucionales_oc where oc_id = 'ci_t_01')::text;
select 'CI|c01d|bitácora con OC, origen y usuario|' || exists(select 1 from public.contactos_institucionales_historial where rut_clave = '991112227' and oc_id = 'ci_t_01' and origen = 'mp' and usuario = :'usr' and accion = 'alta_desde_oc:nuevo')::text;
