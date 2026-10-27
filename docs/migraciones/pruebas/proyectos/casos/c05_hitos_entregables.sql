\i _ini.sql
select prueba.como(:'ING');
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
insert into public.pi_hitos (proyecto_id, nombre, tipo, fecha_prevista) values
  (:PA, 'Kick-off con mandante', 'contractual', public.pi_hoy() - 25),
  (:PA, 'Entrega ingeniería de detalle', 'entrega', public.pi_hoy() - 2),
  (:PA, 'Estado de pago N°1', 'pago', public.pi_hoy() + 15);
update public.pi_hitos set fecha_real = public.pi_hoy() - 24 where nombre = 'Kick-off con mandante';
select 'PI|c05_hito_con_fecha_real_cumplido|' || (select estado = 'cumplido' from public.pi_hitos where nombre = 'Kick-off con mandante');
select 'PI|c05_hito_fecha_real_futura_rechazada|' || (prueba.falla($$update public.pi_hitos set fecha_real = public.pi_hoy() + 1 where nombre = 'Estado de pago N°1'$$) like '23514:PI_FECHA%');
insert into public.pi_entregables (proyecto_id, codigo, nombre, tipo, especialidad, responsable_id, fecha_comprometida, hito_id) values
  (:PA, 'AD800-EI-001', 'Arquitectura de control', 'especificacion', 'automatizacion', :'ING', public.pi_hoy() - 3, (select id from public.pi_hitos where nombre = 'Entrega ingeniería de detalle')),
  (:PA, 'AD800-PL-010', 'Diagrama unilineal', 'plano', 'electrica', null, public.pi_hoy() + 10, null),
  (:PA, null, 'Memoria de cálculo de bombas', 'memoria_calculo', 'mecanica', null, public.pi_hoy() + 30, null);
select 'PI|c05_codigo_duplicado_mismo_proyecto_rechazado|' || (prueba.falla(format('insert into public.pi_entregables (proyecto_id, codigo, nombre) values (%L, %L, %L)', prueba.pid('Proyecto A Planta Desaladora'), 'ad800-ei-001', 'Copia')) like '23505:%');
update public.pi_entregables set estado = 'emitido', revision = '0' where codigo = 'AD800-PL-010';
select 'PI|c05_emitido_fija_fecha_entrega|' || (select fecha_entrega = public.pi_hoy() from public.pi_entregables where codigo = 'AD800-PL-010');
select 'PI|c05_revision_invalida_rechazada|' || (prueba.falla($$update public.pi_entregables set revision = 'rev a' where codigo = 'AD800-EI-001'$$) like '23514:%');
select prueba.como(:'ADM');
select 'PI|c05_mismo_codigo_en_otro_proyecto_permitido|' || (prueba.falla(format('insert into public.pi_entregables (proyecto_id, codigo, nombre) values (%L, %L, %L)', prueba.pid('Proyecto B Celulosa Montaje'), 'AD800-EI-001', 'Otro proyecto')) = 'SIN_ERROR');
select 'PI|c05_hito_de_otro_proyecto_rechazado|' || (prueba.falla(format('insert into public.pi_entregables (proyecto_id, nombre, hito_id) values (%L, %L, (select id from public.pi_hitos where nombre = %L))', prueba.pid('Proyecto B Celulosa Montaje'), 'Cruce', 'Estado de pago N°1')) like '23514:%otro proyecto%');
select 'PI|c05_actividad_de_otro_proyecto_rechazada|' || (prueba.falla(format('insert into public.pi_hitos (proyecto_id, nombre, fecha_prevista, actividad_id) values (%L, %L, current_date, (select id from public.pi_actividades where nombre = %L))', prueba.pid('Proyecto B Celulosa Montaje'), 'Cruce', 'Montaje y pruebas')) like '23514:%otro proyecto%');
