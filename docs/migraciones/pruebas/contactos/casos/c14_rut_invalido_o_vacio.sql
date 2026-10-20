-- RUT inválido o sin RUT: no se inventa la institución
\ir ../_usuario.sql
select public.conciliar_contactos_oc('ci_t_11', 'mp')->>'accion' as a1 \gset
select public.conciliar_contactos_oc('ci_t_12', 'mp')->>'accion' as a2 \gset
select 'CI|c14a|RUT con DV incorrecto: no se crea nada|' || (:'a1' = 'rut_invalido' and not exists(select 1 from public.contactos_institucionales where correo_clave = 'x@muni-alfa.cl'))::text;
select 'CI|c14b|OC sin RUT: no se crea nada|' || (:'a2' = 'sin_rut' and not exists(select 1 from public.contactos_institucionales where correo_clave = 'y@muni-alfa.cl'))::text;
