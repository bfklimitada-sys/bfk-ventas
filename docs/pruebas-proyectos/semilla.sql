-- Datos de prueba FICTICIOS para las pruebas de interfaz de Proyectos Industriales (SOLO base desechable).
-- Se crean como lo haría cada usuario desde la app (rol authenticated + su sesión), así RLS y disparadores se aplican.
-- Fechas relativas a hoy (hora de Chile) para que los atrasos sean siempre los mismos.
-- Usuarios (base_supabase.sql): 1111 Admin Prueba (admin) · 2222 Usuario Normal (sin proyectos) · 3333 Jefa Proyecto Prueba
--   · 4444 Ingeniero Prueba · 5555 Visitante Prueba.
\set ON_ERROR_STOP on
\set QUIET on
create or replace function pg_temp.como(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false) $$;

-- ── Administrador: clientes y tres proyectos ──
select pg_temp.como('11111111-1111-1111-1111-111111111111'); set role authenticated;
insert into public.pi_clientes (rut, razon_social, rubro, contacto_nombre, contacto_correo) values
  ('96.555.444-0', 'Celulosa del Sur Prueba S.A.', 'celulosa', 'Marta Ríos', 'mrios@celulosa-prueba.invalid'),
  ('76.888.777-2', 'Relaves del Norte Prueba SpA', 'mineria', null, null),
  ('77.666.555-K', 'Minera Andina Prueba SpA', 'mineria', null, null),
  ('78.444.333-7', 'Constructora EPC Prueba Ltda.', 'construccion', 'Jorge Soto', 'jsoto@epc-prueba.invalid');
create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;
insert into ids select 'c_epc', id from public.pi_clientes where razon_social like 'Constructora%';
insert into ids select 'c_cel', id from public.pi_clientes where razon_social like 'Celulosa%';
insert into ids select 'c_min', id from public.pi_clientes where razon_social like 'Minera%';
-- A) Ingeniería de control (responsable Jefa; equipo: Ingeniero editor, Visitante lector), al día.
insert into ids select 'p_a', (public.pi_crear_proyecto(jsonb_build_object('cliente_id', (select v from ids where k = 'c_epc'), 'mandante_id', (select v from ids where k = 'c_min'),
  'nombre', 'Ingeniería de control planta concentradora', 'tipo', 'ingenieria', 'especialidades', jsonb_build_array('automatizacion', 'electrica', 'instrumentacion'),
  'ubicacion', 'Planta concentradora, área molienda', 'region', 'Coquimbo', 'responsable_id', '33333333-3333-3333-3333-333333333333',
  'fecha_inicio_prevista', public.pi_hoy() - 40, 'fecha_termino_prevista', public.pi_hoy() + 60, 'presupuesto_inicial', 48500000, 'moneda', 'CLP',
  'equipo', jsonb_build_array(jsonb_build_object('usuario_id', '44444444-4444-4444-4444-444444444444', 'rol_proyecto', 'editor', 'funcion', 'Ingeniero de automatización'),
                              jsonb_build_object('usuario_id', '55555555-5555-5555-5555-555555555555', 'rol_proyecto', 'lector', 'funcion', 'Inspección técnica')))) ->> 'id')::uuid;
-- B) Montaje eléctrico (responsable Ingeniero), en ejecución con atraso.
insert into ids select 'p_b', (public.pi_crear_proyecto(jsonb_build_object('cliente_id', (select v from ids where k = 'c_cel'), 'nombre', 'Montaje eléctrico subestación caldera',
  'tipo', 'montaje', 'especialidades', jsonb_build_array('electrica'), 'ubicacion', 'Planta celulosa, área caldera', 'comuna', 'Laja', 'region', 'Biobío',
  'responsable_id', '44444444-4444-4444-4444-444444444444', 'fecha_inicio_prevista', public.pi_hoy() - 60, 'fecha_termino_prevista', public.pi_hoy() + 15,
  'presupuesto_inicial', 1250.75, 'moneda', 'UF')) ->> 'id')::uuid;
-- C) Suministro tableros (responsable Ingeniero), finalizado.
insert into ids select 'p_c', (public.pi_crear_proyecto(jsonb_build_object('cliente_id', (select v from ids where k = 'c_cel'), 'nombre', 'Suministro tableros CCM',
  'tipo', 'suministro', 'responsable_id', '44444444-4444-4444-4444-444444444444', 'fecha_inicio_prevista', public.pi_hoy() - 120, 'fecha_termino_prevista', public.pi_hoy() - 20,
  'presupuesto_inicial', 18900000, 'moneda', 'CLP')) ->> 'id')::uuid;
-- Activación autorizada por el administrador.
select public.pi_cambiar_estado(v, 'por_iniciar') from ids where k in ('p_a', 'p_b', 'p_c');

-- ── Jefa: inicia A, registra actividades al día, hito y entregables; crea una PROPUESTA (D) ──
reset role; select pg_temp.como('33333333-3333-3333-3333-333333333333'); set role authenticated;
select public.pi_cambiar_estado((select v from ids where k = 'p_a'), 'en_ejecucion');
update public.pi_proyectos set fecha_inicio_real = public.pi_hoy() - 38 where id = (select v from ids where k = 'p_a');
insert into public.pi_actividades (proyecto_id, orden, nombre, especialidad, responsable_id, fecha_inicio_prevista, fecha_fin_prevista, avance, peso) values
  ((select v from ids where k = 'p_a'), 1, 'Ingeniería básica', 'automatizacion', '33333333-3333-3333-3333-333333333333', public.pi_hoy() - 40, public.pi_hoy() - 1, 100, 2),
  ((select v from ids where k = 'p_a'), 2, 'Ingeniería de detalle', 'automatizacion', '44444444-4444-4444-4444-444444444444', public.pi_hoy() - 10, public.pi_hoy() + 40, 30, 3),
  ((select v from ids where k = 'p_a'), 3, 'Pruebas FAT', 'instrumentacion', null, public.pi_hoy() + 41, public.pi_hoy() + 60, 0, 1);
insert into public.pi_actividades (proyecto_id, padre_id, orden, nombre, avance, peso)
  select p.v, a.id, 1, 'Programación PLC y HMI', 40, 1 from ids p join public.pi_actividades a on a.proyecto_id = p.v and a.nombre = 'Ingeniería de detalle' where p.k = 'p_a';
insert into public.pi_hitos (proyecto_id, nombre, tipo, fecha_prevista) values ((select v from ids where k = 'p_a'), 'Estado de pago N.º 1 (30 %)', 'pago', public.pi_hoy() + 30);
insert into public.pi_entregables (proyecto_id, codigo, nombre, tipo, especialidad, fecha_comprometida, revision) values
  ((select v from ids where k = 'p_a'), 'EPC-AUT-001', 'Filosofía de control', 'especificacion', 'automatizacion', public.pi_hoy() + 20, 'A'),
  ((select v from ids where k = 'p_a'), 'EPC-ELE-010', 'Diagrama unilineal tableros', 'plano', 'electrica', public.pi_hoy() + 35, 'A');
insert into ids select 'p_d', (public.pi_crear_proyecto(jsonb_build_object('cliente_id', (select v from ids where k = 'c_min'), 'nombre', 'Mantención mayor molino SAG',
  'tipo', 'mantencion', 'especialidades', jsonb_build_array('mecanica'), 'responsable_id', '33333333-3333-3333-3333-333333333333',
  'fecha_inicio_prevista', public.pi_hoy() + 20, 'fecha_termino_prevista', public.pi_hoy() + 50, 'presupuesto_inicial', 32000, 'moneda', 'USD')) ->> 'id')::uuid;

-- ── Ingeniero: inicia B (con atraso) y finaliza C ──
reset role; select pg_temp.como('44444444-4444-4444-4444-444444444444'); set role authenticated;
select public.pi_cambiar_estado((select v from ids where k = 'p_b'), 'en_ejecucion');
update public.pi_proyectos set fecha_inicio_real = public.pi_hoy() - 58 where id = (select v from ids where k = 'p_b');
insert into public.pi_actividades (proyecto_id, orden, nombre, responsable_id, fecha_inicio_prevista, fecha_fin_prevista, avance, peso) values
  ((select v from ids where k = 'p_b'), 1, 'Tendido de bandejas y cables', '44444444-4444-4444-4444-444444444444', public.pi_hoy() - 60, public.pi_hoy() - 5, 40, 1),
  ((select v from ids where k = 'p_b'), 2, 'Conexionado de tableros', '44444444-4444-4444-4444-444444444444', public.pi_hoy() - 20, public.pi_hoy() + 10, 20, 1),
  ((select v from ids where k = 'p_b'), 3, 'Pruebas y energización', null, public.pi_hoy() + 5, public.pi_hoy() + 15, 10, 1);
insert into public.pi_entregables (proyecto_id, codigo, nombre, tipo, fecha_comprometida) values ((select v from ids where k = 'p_b'), 'CEL-PRT-01', 'Protocolo de pruebas', 'protocolo', public.pi_hoy() - 3);
select public.pi_cambiar_estado((select v from ids where k = 'p_c'), 'en_ejecucion');
update public.pi_proyectos set fecha_inicio_real = public.pi_hoy() - 110 where id = (select v from ids where k = 'p_c');
insert into public.pi_actividades (proyecto_id, orden, nombre, fecha_inicio_prevista, fecha_fin_prevista, avance) values ((select v from ids where k = 'p_c'), 1, 'Fabricación y entrega', public.pi_hoy() - 120, public.pi_hoy() - 20, 100);
select public.pi_cambiar_estado((select v from ids where k = 'p_c'), 'finalizado');
reset role;
select 'SEMILLA|' || count(*) || ' proyectos|' || (select count(*) from public.pi_actividades) || ' actividades' from public.pi_proyectos;
