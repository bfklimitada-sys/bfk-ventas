\i _ini.sql
select prueba.como(:'JEF');
select 'PI|c02_crear_por_rpc|' || ((public.pi_crear_proyecto(jsonb_build_object('nombre', 'Proyecto A Planta Desaladora', 'tipo', 'ingenieria',
  'cliente_id', (select id from public.pi_clientes where razon_social = 'Minera Prueba SpA'),
  'mandante_id', (select id from public.pi_clientes where razon_social = 'Montajes Mandante Prueba'),
  'responsable_id', :'JEF', 'especialidades', jsonb_build_array('automatizacion', 'electrica', 'automatizacion'),
  'presupuesto_inicial', 12500000, 'moneda', 'CLP', 'ubicacion', 'Faena Los Pelambres', 'region', 'Coquimbo',
  'fecha_inicio_prevista', public.pi_hoy() - 30, 'fecha_termino_prevista', public.pi_hoy() + 60)))->>'codigo' ~ '^PI-[0-9]{4}-001$');
select 'PI|c02_codigo_anio_actual_y_centro_costo|' || (select codigo = 'PI-' || extract(year from public.pi_hoy())::int || '-001' and centro_costo = codigo and linea_negocio = 'PI'
  from public.pi_proyectos where nombre = 'Proyecto A Planta Desaladora');
select 'PI|c02_especialidades_sin_duplicar|' || (select especialidades = array['automatizacion','electrica'] from public.pi_proyectos where nombre = 'Proyecto A Planta Desaladora');
select 'PI|c02_responsable_queda_jefe|' || exists (select 1 from public.pi_equipo where proyecto_id = prueba.pid('Proyecto A Planta Desaladora') and usuario_id = :'JEF' and rol_proyecto = 'jefe' and activo);
select 'PI|c02_autor_registrado_y_nace_como_propuesta|' || (select creado_por = :'JEF' and version = 1 and estado = 'propuesta' and autorizado_en is null from public.pi_proyectos where nombre = 'Proyecto A Planta Desaladora');
select 'PI|c02_economia_en_tabla_separada|' || (select presupuesto_inicial = 12500000 and moneda = 'CLP' from public.pi_proyectos_economia where proyecto_id = prueba.pid('Proyecto A Planta Desaladora'));
select 'PI|c02_economia_no_se_inserta_directo|' || (prueba.falla(format('insert into public.pi_proyectos_economia (proyecto_id, presupuesto_inicial) values (%L, 1)', prueba.pid('Proyecto A Planta Desaladora'))) like '42501:%');
select prueba.como(:'NOR');
select 'PI|c02_usuario_crea_con_otro_responsable|' || ((public.pi_crear_proyecto(jsonb_build_object('nombre', 'Proyecto B Celulosa Montaje', 'tipo', 'montaje',
  'cliente_id', (select id from public.pi_clientes where razon_social = 'Celulosa Prueba S.A.'), 'responsable_id', :'NOR',
  'presupuesto_inicial', 850.5, 'moneda', 'UF')))->>'codigo' ~ '-002$');
select 'PI|c02_inserción_directa_prohibida|' || (prueba.falla($$insert into public.pi_proyectos (codigo, centro_costo, cliente_id, nombre, tipo, responsable_id, creado_por)
  values ('PI-2026-900', 'PI-2026-900', (select id from public.pi_clientes limit 1), 'Directo', 'otro', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222')$$) like '42501:%');
select 'PI|c02_no_responsable_no_registra_presupuesto|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Propuesta ajena con monto', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '33333333-3333-3333-3333-333333333333', 'presupuesto_inicial', 1000))$$) like '42501:PI_PRESUPUESTO%');
select 'PI|c02_no_responsable_crea_propuesta_sin_monto|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Prueba revertida', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222')) ; select 1/0$$) like '22012:%');
select 'PI|c02_responsable_inexistente_rechazado|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Sin responsable valido', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '99999999-9999-9999-9999-999999999999'))$$) like '23503:%responsable%');
select 'PI|c02_tipo_invalido_rechazado|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Tipo malo', 'tipo', 'magia',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222'))$$) like '23514:%');
select 'PI|c02_fechas_invertidas_rechazadas|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Fechas malas', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222',
  'fecha_inicio_prevista', '2026-12-01', 'fecha_termino_prevista', '2026-11-01'))$$) like '23514:%');
select 'PI|c02_presupuesto_negativo_rechazado|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Negativo', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222', 'presupuesto_inicial', -1))$$) like '23514:%');
select 'PI|c02_moneda_invalida_rechazada|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Moneda mala', 'tipo', 'otro',
  'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222', 'moneda', 'BTC'))$$) like '23514:%');
select prueba.como(:'ADM');
select 'PI|c02_fallidos_no_consumen_codigo_sin_huecos|' || ((select array_agg(right(codigo, 3) order by codigo) from public.pi_proyectos) = array['001','002']);
select 'PI|c02_usuario_no_lee_correlativos|' || (prueba.falla('select * from public.pi_correlativos') like '42501:%');
select prueba.como(:'SINPERFIL');
select 'PI|c02_sin_perfil_no_crea|' || (prueba.falla($$select public.pi_crear_proyecto(jsonb_build_object('nombre', 'Intruso', 'tipo', 'otro', 'cliente_id', (select id from public.pi_clientes limit 1), 'responsable_id', '22222222-2222-2222-2222-222222222222'))$$) like '42501:%');
