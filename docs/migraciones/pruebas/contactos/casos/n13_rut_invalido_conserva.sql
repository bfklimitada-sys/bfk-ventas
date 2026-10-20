-- OC con RUT inválido: su contacto se conserva en la OC y no se asigna a ninguna institución
\ir ../_usuario.sql
select public.registrar_correo_cobranza('ci_t_11', 'x@muni-alfa.cl')->>'accion' as a \gset
select 'CI|n13|RUT inválido: nada en ninguna institución y la OC conserva su contacto|' || (:'a' = 'rut_invalido' and not exists(select 1 from public.contactos_institucionales where correo_clave = 'x@muni-alfa.cl') and exists(select 1 from public.ordenes_compra_v2 where id = 'ci_t_11' and correo_cliente = 'x@muni-alfa.cl' and contacto = 'Ana Pérez'))::text;
