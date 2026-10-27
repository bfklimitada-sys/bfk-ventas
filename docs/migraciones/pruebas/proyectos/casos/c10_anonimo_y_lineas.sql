\i _ini.sql
reset role; set role anon; select set_config('request.jwt.claims', '{"role":"anon"}', false);
select 'PI|c10_anonimo_no_lee_tablas|' || (prueba.falla('select * from public.pi_proyectos') like '42501:%' and prueba.falla('select * from public.pi_clientes') like '42501:%'
  and prueba.falla('select * from public.pi_proyectos_resumen') like '42501:%' and prueba.falla('select * from public.pi_historial') like '42501:%'
  and prueba.falla('select * from public.bfk_lineas_negocio') like '42501:%' and prueba.falla('select * from public.pi_proyectos_economia') like '42501:%'
  and prueba.falla('select * from public.pi_configuracion') like '42501:%' and prueba.falla('select * from public.pi_cuentas_respaldo') like '42501:%');
select 'PI|c10_anonimo_no_ejecuta_rpc|' || (prueba.falla($$select public.pi_crear_proyecto('{}')$$) like '42501:%' and prueba.falla($$select public.pi_mi_rol(gen_random_uuid())$$) like '42501:%');
select 'PI|c10_anonimo_no_ve_archivos|' || ((select count(*) from storage.objects where bucket_id = 'pi-documentos') = 0);
reset role; set role authenticated;
select prueba.como(:'NOR');
select 'PI|c10_catalogo_lineas_de_negocio|' || ((select array_agg(codigo order by codigo) from public.bfk_lineas_negocio) = array['MP','PI']);
