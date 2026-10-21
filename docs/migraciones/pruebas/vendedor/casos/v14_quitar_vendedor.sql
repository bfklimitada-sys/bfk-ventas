\ir ../_ini_admin.sql
select id, version from public.cotizaciones where nombre = 'VR cz vendedor' \gset
select public.cz_guardar_cotizacion_v2(pg_temp.pl(:'id'::uuid, :version, 'adjudicada', null, '{"n":"cz vendedor","oc":"VR-3-AG26"}'));
select 'VR|v14_ni_el_admin_deja_una_adjudicada_sin_vendedor|' || (:'LAST_ERROR_MESSAGE' like 'CZ_VENDEDOR: no se puede adjudicar%')::text;
