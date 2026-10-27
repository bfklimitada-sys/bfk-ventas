\i _ini.sql
-- Datos económicos: por defecto solo administrador y responsable principal; otros integrantes con autorización específica.
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
\set PB '(select prueba.pid(''Proyecto B Celulosa Montaje''))'
select prueba.como(:'JEF');
select 'PI|c11_responsable_ve_presupuesto|' || ((select presupuesto_inicial from public.pi_proyectos_resumen where id = :PA) = 13000000 and (select ve_economia from public.pi_proyectos_resumen where id = :PA));
select prueba.como(:'ING');
select 'PI|c11_editor_no_ve_presupuesto|' || ((select presupuesto_inicial is null and moneda is null and not ve_economia from public.pi_proyectos_resumen where id = :PA)
  and (select count(*) from public.pi_proyectos_economia where proyecto_id = :PA) = 0);
select 'PI|c11_editor_no_ve_historial_economico|' || ((select count(*) from public.pi_historial where proyecto_id = :PA and tabla = 'pi_proyectos_economia') = 0
  and (select count(*) from public.pi_historial where proyecto_id = :PA and tabla = 'pi_proyectos') > 0);
select prueba.como(:'VIS');
select 'PI|c11_lector_no_ve_presupuesto|' || ((select presupuesto_inicial is null from public.pi_proyectos_resumen where id = :PA));
select 'PI|c11_lector_no_se_autoriza_solo|' || (prueba.filas(format('update public.pi_equipo set ve_economia = true where proyecto_id = %L and usuario_id = %L', prueba.pid('Proyecto A Planta Desaladora'), '55555555-5555-5555-5555-555555555555')) = 0);
select prueba.como(:'JEF');
select 'PI|c11_responsable_ve_historial_economico|' || ((select count(*) from public.pi_historial where proyecto_id = :PA and tabla = 'pi_proyectos_economia') >= 2);
update public.pi_equipo set ve_economia = true where proyecto_id = :PA and usuario_id = :'VIS';
select prueba.como(:'VIS');
select 'PI|c11_lector_autorizado_ve_presupuesto|' || ((select presupuesto_inicial from public.pi_proyectos_resumen where id = :PA) = 13000000);
select 'PI|c11_autorizado_solo_ve_no_edita|' || (prueba.filas(format('update public.pi_proyectos_economia set presupuesto_inicial = 1 where proyecto_id = %L', prueba.pid('Proyecto A Planta Desaladora'))) = 0);
select prueba.como(:'JEF');
update public.pi_equipo set ve_economia = false where proyecto_id = :PA and usuario_id = :'VIS';
select prueba.como(:'VIS');
select 'PI|c11_autorizacion_retirada|' || ((select presupuesto_inicial is null from public.pi_proyectos_resumen where id = :PA));
-- Proyecto B: NOR es jefe pero NO responsable (el responsable es ING): no ve ni se autoriza.
select prueba.como(:'NOR');
select 'PI|c11_jefe_no_responsable_no_ve|' || ((select presupuesto_inicial is null from public.pi_proyectos_resumen where id = :PB));
select 'PI|c11_jefe_no_responsable_no_otorga|' || (prueba.falla(format('update public.pi_equipo set ve_economia = true where proyecto_id = %L and usuario_id = %L', prueba.pid('Proyecto B Celulosa Montaje'), '22222222-2222-2222-2222-222222222222')) like '42501:PI_ECONOMIA%');
select prueba.como(:'ING');
update public.pi_equipo set ve_economia = true where proyecto_id = :PB and usuario_id = :'NOR';
select prueba.como(:'NOR');
select 'PI|c11_responsable_otorga_a_otro_jefe|' || ((select presupuesto_inicial from public.pi_proyectos_resumen where id = :PB) = 900);
select prueba.como(:'ADM');
select 'PI|c11_admin_ve_todos_los_presupuestos|' || ((select count(*) from public.pi_proyectos_resumen where presupuesto_inicial is not null) >= 2);
