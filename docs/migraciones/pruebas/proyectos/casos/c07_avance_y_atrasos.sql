\i _ini.sql
-- Cálculo esperado para el Proyecto A (hojas no anuladas):
--   Ingeniería básica   peso 1, avance 100, plan 100 (terminó ayer)
--   Montaje y pruebas   peso 1, avance 0,   plan 0   (empieza en 21 días)
--   Bloques PID         peso 1, avance 100, sin fechas → fuera del plan
--   Planos eléctricos   peso 1, avance 20,  plan = (5+1)/(25+1) = 23,08 %
--   Avance real = (100 + 0 + 100 + 20) / 4 = 55,00
--   Avance planificado = (100 + 0 + 23,08) / 3 = 41,03
select prueba.como(:'JEF');
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
select 'PI|c07_avance_real_ponderado|' || ((select avance_real from public.pi_proyectos_resumen where id = :PA) = 55.00);
select 'PI|c07_avance_planificado|' || ((select avance_planificado from public.pi_proyectos_resumen where id = :PA) = 41.03);
select 'PI|c07_hito_vencido_contado|' || ((select n_hitos_vencidos from public.pi_proyectos_resumen where id = :PA) = 1);
select 'PI|c07_hito_vencido_marca_atraso|' || ((select atrasado from public.pi_proyectos_resumen where id = :PA) = true);
select 'PI|c07_entregable_vencido_contado|' || ((select n_entregables_vencidos from public.pi_proyectos_resumen where id = :PA) = 1
  and (select n_entregables_pendientes from public.pi_proyectos_resumen where id = :PA) = 2);
select 'PI|c07_proximo_hito|' || ((select proximo_hito_nombre from public.pi_proyectos_resumen where id = :PA) = 'Estado de pago N°1');
select 'PI|c07_dias_restantes|' || ((select dias_restantes from public.pi_proyectos_resumen where id = :PA) = 60);
-- Cumplir el hito y emitir el entregable vencido: deja de estar atrasado (actividades al día).
update public.pi_hitos set fecha_real = public.pi_hoy() where nombre = 'Entrega ingeniería de detalle';
update public.pi_entregables set estado = 'emitido' where codigo = 'AD800-EI-001';
select 'PI|c07_al_dia_sin_atraso|' || ((select atrasado from public.pi_proyectos_resumen where id = :PA) = false);
-- Actividad con fin previsto vencido y no completada: atrasada en la vista y en el resumen.
update public.pi_actividades set fecha_fin_prevista = public.pi_hoy() - 1, fecha_inicio_prevista = public.pi_hoy() - 6 where nombre = 'Planos eléctricos';
select 'PI|c07_actividad_atrasada|' || ((select atrasada from public.pi_actividades_vista where nombre = 'Planos eléctricos') = true
  and (select atrasada from public.pi_actividades_vista where nombre = 'Ingeniería de detalle') = false   -- el padre vence en 20 días
  and (select atrasada from public.pi_actividades_vista where nombre = 'Ingeniería básica') = false);
select 'PI|c07_resumen_cuenta_atrasadas|' || ((select n_actividades_atrasadas from public.pi_proyectos_resumen where id = :PA) = 1 and (select atrasado from public.pi_proyectos_resumen where id = :PA));
-- Anular una actividad la saca del cálculo.
update public.pi_actividades set estado = 'anulada' where nombre = 'Planos eléctricos';
select 'PI|c07_anulada_fuera_del_calculo|' || ((select avance_real from public.pi_proyectos_resumen where id = :PA) = 66.67
  and (select n_actividades_atrasadas from public.pi_proyectos_resumen where id = :PA) = 0);
update public.pi_actividades set estado = 'en_curso', avance = 20, fecha_fin_prevista = public.pi_hoy() + 20, fecha_inicio_prevista = public.pi_hoy() - 5 where nombre = 'Planos eléctricos';
select 'PI|c07_restaurada|' || ((select avance_real from public.pi_proyectos_resumen where id = :PA) = 55.00);
-- Por iniciar con inicio previsto vencido = atrasado.
select prueba.como(:'ADM');
select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Proyecto C Inicio Atrasado', 'tipo', 'servicios', 'cliente_id', (select id from public.pi_clientes where razon_social = 'Celulosa Prueba S.A.'),
  'responsable_id', '33333333-3333-3333-3333-333333333333', 'fecha_inicio_prevista', public.pi_hoy() - 3, 'fecha_termino_prevista', public.pi_hoy() + 90));
select 'PI|c07_propuesta_no_cuenta_como_atrasada|' || ((select atrasado from public.pi_proyectos_resumen where nombre = 'Proyecto C Inicio Atrasado') = false);
select public.pi_cambiar_estado(prueba.pid('Proyecto C Inicio Atrasado'), 'por_iniciar') is not null as c_autorizado \gset
select 'PI|c07_inicio_vencido_atrasado|' || ((select atrasado from public.pi_proyectos_resumen where nombre = 'Proyecto C Inicio Atrasado'));
select 'PI|c07_admin_no_queda_en_equipo|' || (not exists (select 1 from public.pi_equipo where proyecto_id = prueba.pid('Proyecto C Inicio Atrasado') and usuario_id = :'ADM'));
