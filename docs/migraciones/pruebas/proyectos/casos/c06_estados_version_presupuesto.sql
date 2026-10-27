\i _ini.sql
select prueba.como(:'JEF');
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
select 'PI|c06_jefe_no_autoriza_su_propuesta|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'por_iniciar')) like '23514:PI_ESTADO%');
select 'PI|c06_propuesta_no_salta_a_ejecucion|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'en_ejecucion')) like '23514:PI_ESTADO%');
select 'PI|c06_autorizacion_no_se_falsifica|' || (prueba.falla(format('update public.pi_proyectos set autorizado_por = %L, autorizado_en = now() where id = %L', '33333333-3333-3333-3333-333333333333', prueba.pid('Proyecto A Planta Desaladora'))) like '42501:PI_PROYECTO%');
select 'PI|c06_jefe_edita_economia_de_su_propuesta|' || (prueba.filas(format('update public.pi_proyectos_economia set presupuesto_inicial = 13000000 where proyecto_id = %L', prueba.pid('Proyecto A Planta Desaladora'))) = 1);
select prueba.como(:'ADM');
select (public.pi_cambiar_estado(:PA, 'por_iniciar'))->>'estado' as a_estado \gset
select 'PI|c06_admin_autoriza_activacion|' || (:'a_estado' = 'por_iniciar'
  and (select autorizado_por = :'ADM' and autorizado_en is not null from public.pi_proyectos where id = :PA));
select public.pi_cambiar_estado(prueba.pid('Proyecto B Celulosa Montaje'), 'por_iniciar') is not null as b_autorizado \gset
select prueba.como(:'JEF');
select 'PI|c06_salto_a_finalizado_rechazado|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'finalizado')) like '23514:PI_ESTADO%');
select 'PI|c06_estado_inexistente_rechazado|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'volando')) like '23514:%');
select 'PI|c06_version_desactualizada_PI409|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L, null, 0)', prueba.pid('Proyecto A Planta Desaladora'), 'en_ejecucion')) like '40001:PI409%');
select 'PI|c06_en_ejecucion_fija_inicio_real|' || ((public.pi_cambiar_estado(:PA, 'en_ejecucion', null, (select version from public.pi_proyectos where id = :PA)))->>'fecha_inicio_real' = public.pi_hoy()::text);
select 'PI|c06_suspender_sin_motivo_rechazado|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'suspendido')) like '23514:%');
-- Línea base: después de iniciado, el jefe ya no cambia el presupuesto inicial.
select 'PI|c06_responsable_no_cambia_presupuesto_iniciado|' || (prueba.filas(format('update public.pi_proyectos_economia set presupuesto_inicial = 1 where proyecto_id = %L', prueba.pid('Proyecto A Planta Desaladora'))) = 0
  and (select presupuesto_inicial from public.pi_proyectos_economia where proyecto_id = :PA) = 13000000);
select 'PI|c06_codigo_inmutable|' || (prueba.falla(format('update public.pi_proyectos set codigo = %L where id = %L', 'PI-2026-777', prueba.pid('Proyecto A Planta Desaladora'))) like '42501:%');
select 'PI|c06_linea_negocio_solo_PI|' || (prueba.falla(format('update public.pi_proyectos set linea_negocio = %L where id = %L', 'MP', prueba.pid('Proyecto A Planta Desaladora'))) not like 'SIN_ERROR');
-- Concurrencia optimista (lo que hace la app): guardar con la versión leída; si otro guardó antes, 0 filas.
select version as v0 from public.pi_proyectos where id = :PA \gset
update public.pi_proyectos set descripcion = 'Primera edición' where id = :PA and version = :v0;
select 'PI|c06_segunda_edicion_con_version_vieja_no_pisa|' || (prueba.filas(format('update public.pi_proyectos set descripcion = %L where id = %L and version = %s', 'Edición atrasada', prueba.pid('Proyecto A Planta Desaladora'), :v0)) = 0
  and (select descripcion from public.pi_proyectos where id = :PA) = 'Primera edición');
-- Proyecto B: ciclo completo hasta cerrado (solo admin cierra) y solo lectura cuando está cerrado.
select prueba.como(:'ING');
\set PB '(select prueba.pid(''Proyecto B Celulosa Montaje''))'
insert into public.pi_actividades (proyecto_id, nombre) values (:PB, 'Montaje estructura');
select public.pi_cambiar_estado(:PB, 'en_ejecucion');
select 'PI|c06_finalizar_fija_termino_real|' || ((public.pi_cambiar_estado(:PB, 'finalizado'))->>'fecha_termino_real' = public.pi_hoy()::text);
select 'PI|c06_jefe_no_cierra|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto B Celulosa Montaje'), 'cerrado')) like '23514:PI_ESTADO%');
select prueba.como(:'ADM');
select 'PI|c06_admin_cierra|' || ((public.pi_cambiar_estado(:PB, 'cerrado'))->>'estado' = 'cerrado');
select 'PI|c06_admin_corrige_presupuesto_iniciado|' || (prueba.filas(format('update public.pi_proyectos_economia set presupuesto_inicial = 900 where proyecto_id = %L', prueba.pid('Proyecto B Celulosa Montaje'))) = 1);
select prueba.como(:'ING');
select 'PI|c06_cerrado_solo_lectura_para_jefe|' || (prueba.falla(format('insert into public.pi_actividades (proyecto_id, nombre) values (%L, %L)', prueba.pid('Proyecto B Celulosa Montaje'), 'Post cierre')) like '42501:%'
  and prueba.filas(format('update public.pi_proyectos set descripcion = %L where id = %L', 'x', prueba.pid('Proyecto B Celulosa Montaje'))) = 0
  and prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto B Celulosa Montaje'), 'en_ejecucion')) like '42501:%');
select 'PI|c06_cerrado_sigue_visible|' || ((select estado from public.pi_proyectos_resumen where id = :PB) = 'cerrado');
select prueba.como(:'ADM');
select 'PI|c06_admin_reabre|' || ((public.pi_cambiar_estado(:PB, 'finalizado'))->>'estado' = 'finalizado');
select 'PI|c06_anular_exige_motivo|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'anulado', '  ')) like '23514:%'
  and (select estado from public.pi_proyectos where id = :PA) = 'en_ejecucion');
