-- Carga de correos de cobranza (escritos por BFK al reclamar pagos): contacto adicional vigente, sin inventar nombre
\set ON_ERROR_STOP 0
reset role;
select public.ci_conciliar_datos('991112227', null, null, 'cobranza', null, '', null, 'Pagos@muni-alfa.cl')->0->>'accion' as a \gset
select 'CI|c25a|correo de cobranza: adicional vigente sin nombre, origen cobranza|' || (:'a' = 'nuevo' and exists(select 1 from public.contactos_institucionales where correo_clave = 'pagos@muni-alfa.cl' and estado = 'vigente' and nombre = '' and origen = 'cobranza'))::text;
