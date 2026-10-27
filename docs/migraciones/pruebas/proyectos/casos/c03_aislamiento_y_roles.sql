\i _ini.sql
-- Aislamiento: cada usuario ve solo los proyectos donde integra el equipo; el administrador ve todos.
select prueba.como(:'VIS');
select 'PI|c03_ajeno_no_ve_proyectos|' || ((select count(*) from public.pi_proyectos) = 0 and (select count(*) from public.pi_proyectos_resumen) = 0);
select 'PI|c03_ajeno_no_ve_equipo_ni_historial|' || ((select count(*) from public.pi_equipo) = 0 and (select count(*) from public.pi_historial where proyecto_id is not null) = 0);
select prueba.como(:'JEF');
select 'PI|c03_jefe_ve_solo_su_proyecto|' || ((select array_agg(nombre) from public.pi_proyectos) = array['Proyecto A Planta Desaladora']);
select prueba.como(:'NOR');
select 'PI|c03_creador_ve_solo_el_suyo|' || ((select array_agg(nombre) from public.pi_proyectos) = array['Proyecto B Celulosa Montaje']);
select 'PI|c03_no_edita_proyecto_ajeno|' || (prueba.filas($$update public.pi_proyectos set descripcion = 'hackeo' where nombre = 'Proyecto A Planta Desaladora'$$) = 0);
select prueba.como(:'ADM');
select 'PI|c03_admin_ve_todos|' || ((select count(*) from public.pi_proyectos) = 2 and (select count(*) from public.pi_proyectos_resumen) = 2);
select 'PI|c03_mi_rol_admin|' || (public.pi_mi_rol(prueba.pid('Proyecto A Planta Desaladora')) = 'admin');
-- El jefe arma su equipo: ingeniero (editor) y visitante (lector).
select prueba.como(:'JEF');
insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto, funcion) values
  (prueba.pid('Proyecto A Planta Desaladora'), :'ING', 'editor', 'Ingeniero de automatización'),
  (prueba.pid('Proyecto A Planta Desaladora'), :'VIS', 'lector', 'Supervisor cliente');
select 'PI|c03_integrante_inexistente_rechazado|' || (prueba.falla(format('insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto) values (%L, %L, %L)', prueba.pid('Proyecto A Planta Desaladora'), '99999999-9999-9999-9999-999999999999', 'editor')) like '23503:%');
select 'PI|c03_rol_invalido_rechazado|' || (prueba.falla(format('insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto) values (%L, %L, %L)', prueba.pid('Proyecto A Planta Desaladora'), '22222222-2222-2222-2222-222222222222', 'dueño')) like '23514:%');
select 'PI|c03_responsable_no_se_desactiva|' || (prueba.falla(format('update public.pi_equipo set activo = false where usuario_id = %L and proyecto_id = %L', '33333333-3333-3333-3333-333333333333', prueba.pid('Proyecto A Planta Desaladora'))) like '23514:%responsable principal%');
select prueba.como(:'ING');
select 'PI|c03_editor_ve_proyecto|' || ((select count(*) from public.pi_proyectos) = 1 and public.pi_mi_rol(prueba.pid('Proyecto A Planta Desaladora')) = 'editor');
select 'PI|c03_editor_no_edita_cabecera|' || (prueba.filas(format('update public.pi_proyectos set descripcion = %L where id = %L', 'cambio', prueba.pid('Proyecto A Planta Desaladora'))) = 0);
select 'PI|c03_editor_no_agrega_integrantes|' || (prueba.falla(format('insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto) values (%L, %L, %L)', prueba.pid('Proyecto A Planta Desaladora'), '22222222-2222-2222-2222-222222222222', 'jefe')) like '42501:%');
select 'PI|c03_editor_no_cambia_estado|' || (prueba.falla(format('select public.pi_cambiar_estado(%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'en_ejecucion')) like '42501:%');
select 'PI|c03_editor_no_se_promueve|' || (prueba.filas(format('update public.pi_equipo set rol_proyecto = %L where usuario_id = %L', 'jefe', '44444444-4444-4444-4444-444444444444')) = 0);
select prueba.como(:'VIS');
select 'PI|c03_lector_ve_proyecto|' || ((select count(*) from public.pi_proyectos_resumen) = 1 and public.pi_mi_rol(prueba.pid('Proyecto A Planta Desaladora')) = 'lector');
select 'PI|c03_lector_no_crea_actividad|' || (prueba.falla(format('insert into public.pi_actividades (proyecto_id, nombre) values (%L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'Intento lector')) like '42501:%');
select 'PI|c03_lector_no_ve_otros_proyectos|' || ((select count(*) from public.pi_proyectos where nombre = 'Proyecto B Celulosa Montaje') = 0);
-- Cambio de responsable principal: el nuevo queda jefe; el anterior sigue en el equipo.
select prueba.como(:'NOR');
update public.pi_proyectos set responsable_id = :'ING' where nombre = 'Proyecto B Celulosa Montaje';
select 'PI|c03_nuevo_responsable_queda_jefe|' || exists (select 1 from public.pi_equipo where proyecto_id = prueba.pid('Proyecto B Celulosa Montaje') and usuario_id = :'ING' and rol_proyecto = 'jefe');
select 'PI|c03_creador_sigue_en_equipo|' || exists (select 1 from public.pi_equipo where proyecto_id = prueba.pid('Proyecto B Celulosa Montaje') and usuario_id = :'NOR' and activo);
select prueba.como(:'ING');
select 'PI|c03_ingeniero_ahora_ve_dos|' || ((select count(*) from public.pi_proyectos) = 2);
