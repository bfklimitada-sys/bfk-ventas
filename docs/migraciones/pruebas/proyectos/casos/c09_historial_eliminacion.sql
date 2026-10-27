\i _ini.sql
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
select prueba.como(:'JEF');
select 'PI|c09_historial_registra_creacion|' || exists (select 1 from public.pi_historial where tabla = 'pi_proyectos' and registro_id = :PA and accion = 'crear' and usuario_nombre = 'Jefa Proyecto Prueba');
select 'PI|c09_historial_registra_campos_cambiados|' || exists (select 1 from public.pi_historial where tabla = 'pi_proyectos' and registro_id = :PA and accion = 'modificar'
  and cambios ? 'estado' and cambios->'estado'->>'antes' = 'por_iniciar' and cambios->'estado'->>'despues' = 'en_ejecucion');
select 'PI|c09_historial_de_actividades_con_autor|' || ((select count(*) from public.pi_historial where tabla = 'pi_actividades' and proyecto_id = :PA and usuario_id = :'ING') >= 5);
select count(*) as n0 from public.pi_historial where registro_id = :PA \gset
select public.pi_cambiar_estado(:PA, 'en_ejecucion') is not null as cambio_mismo_estado \gset
select 'PI|c09_sin_cambio_real_no_registra|' || ((select count(*) from public.pi_historial where registro_id = :PA) = :n0);
select 'PI|c09_usuario_no_escribe_historial|' || (prueba.falla(format('insert into public.pi_historial (tabla, registro_id, accion, cambios) values (%L, %L, %L, %L)', 'x', gen_random_uuid(), 'crear', '{}')) like '42501:%');
select 'PI|c09_usuario_no_borra_historial|' || (prueba.falla('delete from public.pi_historial') like '42501:%');
select prueba.como(:'ING');
select 'PI|c09_editor_no_elimina_actividad|' || (prueba.filas($$delete from public.pi_actividades where nombre = 'Montaje y pruebas'$$) = 0);
select prueba.como(:'ADM');
select 'PI|c09_admin_no_elimina_con_subtareas|' || (prueba.falla($$delete from public.pi_actividades where nombre = 'Ingeniería de detalle'$$) like '23503:%');
insert into public.pi_actividades (proyecto_id, nombre) values (:PA, 'Actividad de prueba a eliminar');
select prueba.filas($$delete from public.pi_actividades where nombre = 'Actividad de prueba a eliminar'$$) as eliminadas \gset
select 'PI|c09_admin_elimina_hoja_y_queda_rastro|' || (:eliminadas = 1
  and exists (select 1 from public.pi_historial where tabla = 'pi_actividades' and accion = 'eliminar' and cambios->>'nombre' = 'Actividad de prueba a eliminar'));
select 'PI|c09_proyectos_no_se_eliminan|' || (prueba.falla(format('delete from public.pi_proyectos where id = %L', prueba.pid('Proyecto C Inicio Atrasado'))) like '42501:%');
select 'PI|c09_documentos_no_se_eliminan|' || (prueba.falla('delete from public.pi_documentos') like '42501:%');
