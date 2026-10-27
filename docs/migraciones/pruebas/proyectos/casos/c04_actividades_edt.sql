\i _ini.sql
select prueba.como(:'ING');
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
insert into public.pi_actividades (proyecto_id, nombre, orden, especialidad, responsable_id, peso, fecha_inicio_prevista, fecha_fin_prevista)
values (:PA, 'Ingeniería básica', 1, 'automatizacion', :'ING', 1, public.pi_hoy() - 30, public.pi_hoy() - 1),
       (:PA, 'Ingeniería de detalle', 2, 'automatizacion', :'ING', 1, public.pi_hoy() - 10, public.pi_hoy() + 20),
       (:PA, 'Montaje y pruebas', 3, 'electrica', null, 1, public.pi_hoy() + 21, public.pi_hoy() + 60);
insert into public.pi_actividades (proyecto_id, padre_id, nombre, orden, peso, avance, fecha_inicio_prevista, fecha_fin_prevista)
values (:PA, (select id from public.pi_actividades where nombre = 'Ingeniería de detalle'), 'Lógica de control', 1, 3, 50, public.pi_hoy() - 10, public.pi_hoy() + 10),
       (:PA, (select id from public.pi_actividades where nombre = 'Ingeniería de detalle'), 'Planos eléctricos', 2, 1, 0, public.pi_hoy() - 5, public.pi_hoy() + 20);
insert into public.pi_actividades (proyecto_id, padre_id, nombre, orden)
values (:PA, (select id from public.pi_actividades where nombre = 'Lógica de control'), 'Bloques de función PID', 1);
select 'PI|c04_tres_niveles_permitidos|' || ((select max(nivel) from public.pi_actividades_vista where proyecto_id = :PA) = 3);
select 'PI|c04_cuarto_nivel_rechazado|' || (prueba.falla(format('insert into public.pi_actividades (proyecto_id, padre_id, nombre) values (%L, (select id from public.pi_actividades where nombre = %L), %L)',
  prueba.pid('Proyecto A Planta Desaladora'), 'Bloques de función PID', 'Nivel cuatro')) like '23514:PI_EDT%');
select 'PI|c04_ciclo_rechazado|' || (prueba.falla($$update public.pi_actividades set padre_id = (select id from public.pi_actividades where nombre = 'Bloques de función PID') where nombre = 'Ingeniería de detalle'$$) like '23514:PI_EDT%');
select 'PI|c04_avance_mayor_100_rechazado|' || (prueba.falla($$update public.pi_actividades set avance = 120 where nombre = 'Planos eléctricos'$$) like '23514:%');
select 'PI|c04_responsable_fuera_del_equipo_rechazado|' || (prueba.falla(format('update public.pi_actividades set responsable_id = %L where nombre = %L', '22222222-2222-2222-2222-222222222222', 'Planos eléctricos')) like '23514:%equipo%');
select 'PI|c04_fecha_real_futura_rechazada|' || (prueba.falla($$update public.pi_actividades set fecha_inicio_real = public.pi_hoy() + 3 where nombre = 'Planos eléctricos'$$) like '23514:PI_FECHA%');
update public.pi_actividades set estado = 'completada' where nombre = 'Ingeniería básica';
select 'PI|c04_completada_fija_avance_y_fecha|' || (select avance = 100 and fecha_fin_real = public.pi_hoy() and fecha_inicio_real is not null from public.pi_actividades where nombre = 'Ingeniería básica');
update public.pi_actividades set avance = 100 where nombre = 'Bloques de función PID';
select 'PI|c04_avance_100_completa|' || (select estado = 'completada' from public.pi_actividades where nombre = 'Bloques de función PID');
update public.pi_actividades set avance = 20 where nombre = 'Planos eléctricos';
select 'PI|c04_avance_parcial_en_curso|' || (select estado = 'en_curso' and fecha_inicio_real = public.pi_hoy() from public.pi_actividades where nombre = 'Planos eléctricos');
-- Avance de una actividad padre = ponderado de sus hojas (Lógica de control tiene una sola hoja, PID 100%).
select 'PI|c04_padre_toma_avance_de_hojas|' || (select avance_calculado = 100 from public.pi_actividades_vista where nombre = 'Lógica de control');
-- Ingeniería de detalle: hojas PID (peso 1, 100 %) y Planos (peso 1, 20 %) → 60 %.
select 'PI|c04_estado_calculado_de_padres|' || ((select estado_calculado from public.pi_actividades_vista where nombre = 'Lógica de control') = 'completada'
  and (select estado_calculado from public.pi_actividades_vista where nombre = 'Ingeniería de detalle') = 'en_curso'
  and (select estado_calculado from public.pi_actividades_vista where nombre = 'Planos eléctricos') = 'en_curso');
select 'PI|c04_rollup_ponderado|' || (select avance_calculado = 60 from public.pi_actividades_vista where nombre = 'Ingeniería de detalle');
-- Proyecto ajeno: no se puede colgar una subtarea en otro proyecto.
select prueba.como(:'ADM');
select 'PI|c04_padre_de_otro_proyecto_rechazado|' || (prueba.falla(format('insert into public.pi_actividades (proyecto_id, padre_id, nombre) values (%L, (select id from public.pi_actividades where nombre = %L), %L)',
  prueba.pid('Proyecto B Celulosa Montaje'), 'Ingeniería de detalle', 'Cruce')) like '23514:PI_EDT%');
select 'PI|c04_no_se_mueve_a_otro_proyecto|' || (prueba.falla(format('update public.pi_actividades set proyecto_id = %L where nombre = %L', prueba.pid('Proyecto B Celulosa Montaje'), 'Montaje y pruebas')) like '42501:%');
select prueba.como(:'VIS');
select 'PI|c04_lector_no_edita_avance|' || (prueba.filas($$update public.pi_actividades set avance = 90 where nombre = 'Planos eléctricos'$$) = 0);
select prueba.como(:'NOR');
select 'PI|c04_ajeno_no_ve_actividades|' || ((select count(*) from public.pi_actividades where proyecto_id = prueba.pid('Proyecto A Planta Desaladora')) = 0);
