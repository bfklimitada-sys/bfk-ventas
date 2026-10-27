-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Módulo PROYECTOS INDUSTRIALES, primera etapa (22/10/2026). NO APLICADO EN PRODUCCIÓN.
-- Requiere autorización expresa de Kevin. Ensayado solo en base desechable (docs/migraciones/pruebas/proyectos/).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-10-22-proyectos-industriales.sql
-- Deshacer:                     BORRADOR-2026-10-22-proyectos-industriales-deshacer.sql
--
-- QUÉ HACE: solo CREA objetos nuevos con prefijo pi_ (y el catálogo bfk_lineas_negocio). No modifica ninguna
-- tabla, fila, función, política, permiso ni disparador existente: OCs, eventos, cobros, gastos, comisiones,
-- financiamiento/FIFO, IVA/F29, conciliación bancaria, cotizaciones, contactos y perfiles quedan intactos.
-- Las tablas nuevas NO tienen claves foráneas hacia tablas existentes (tampoco hacia perfiles): así no agregan
-- restricciones ocultas que bloqueen operaciones actuales (p. ej. eliminar un usuario). La existencia del perfil
-- se valida con disparadores.
--
-- SEPARACIÓN DE LÍNEAS DE NEGOCIO
--   · bfk_lineas_negocio: catálogo MP (Mercado Público) y PI (Proyectos Industriales).
--   · Todo registro del módulo lleva linea_negocio = 'PI' (CHECK) y su proyecto; cada proyecto tiene su propio
--     centro de costo (= su código). Ninguna función del módulo lee ni escribe tablas de Mercado Público.
--
-- TABLAS
--   pi_correlativos ...... último correlativo por año (código PI-AAAA-NNN sin duplicados bajo concurrencia).
--   pi_clientes .......... clientes y mandantes industriales (catálogo propio; no usa entidades_catalogo de MP).
--   pi_proyectos ......... cabecera del proyecto (código, cliente/mandante, alcance, tipo, especialidades,
--                          ubicación, responsable, fechas previstas/reales, estado, autorización).
--   pi_proyectos_economia  datos ECONÓMICOS del proyecto (presupuesto inicial NETO y moneda), en tabla aparte para
--                          que RLS los oculte a quien no está autorizado (revisión del 23/10/2026).
--   pi_configuracion ..... interruptores del módulo (documentos_habilitados: false hasta activar su respaldo).
--   pi_cuentas_respaldo .. cuentas de solo lectura del depósito pi-documentos para el respaldo diario de archivos.
--   pi_equipo ............ equipo de trabajo y rol dentro del proyecto (jefe · editor · lector).
--   pi_actividades ....... EDT: actividades y subtareas (hasta 3 niveles), fechas, avance y peso.
--   pi_hitos ............. hitos contractuales, de pago, de entrega e internos.
--   pi_entregables ....... entregables (planos, memorias, especificaciones, listados, informes…).
--   pi_documentos ........ documentos del proyecto (archivo en depósito privado "pi-documentos", versiones).
--   pi_historial ......... auditoría inalterable de todo cambio (quién, cuándo, qué cambió).
--   Vistas (respetan RLS del usuario): pi_proyectos_resumen, pi_actividades_vista.
--
-- PERMISOS (RLS en la base, no solo en la interfaz)
--   · Administrador BFK (perfiles.rol = 'admin'): ve y edita todos los proyectos; ÚNICO que autoriza la activación
--     de una propuesta, cierra, reabre un proyecto cerrado/anulado, cambia el presupuesto inicial después de iniciado,
--     habilita la carga de documentos y elimina actividades/hitos/entregables.
--   · Usuario BFK: puede crear PROPUESTAS de proyecto; ve SOLO los proyectos donde integra el equipo.
--   · Datos económicos: por defecto solo el administrador y el responsable principal; otro integrante solo con
--     autorización específica (pi_equipo.ve_economia), que otorga el administrador o el responsable principal.
--       jefe   → edita la cabecera, el equipo, los estados y todo el contenido del proyecto.
--       editor → edita actividades, hitos, entregables y sube documentos.
--       lector → solo lectura.
--   · Proyectos cerrados o anulados: solo lectura (salvo administrador).
--   · Anónimos: sin acceso a nada.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.perfiles') is null then raise exception 'PI: no existe public.perfiles; no se aplicó nada'; end if;
  if to_regclass('public.pi_proyectos') is not null or to_regclass('public.bfk_lineas_negocio') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'pi\_%') then
    raise exception 'PI: el módulo (o un objeto pi_) ya existe; no se aplicó nada'; end if;
end $$;

-- ── Catálogo de líneas de negocio ─────────────────────────────────────────────────────────────────────────
create table public.bfk_lineas_negocio (
  codigo text primary key check (codigo ~ '^[A-Z]{2,4}$'),
  nombre text not null,
  descripcion text,
  activo boolean not null default true
);
insert into public.bfk_lineas_negocio (codigo, nombre, descripcion) values
  ('MP', 'Mercado Público', 'Ventas y órdenes de compra de Mercado Público (módulos existentes; sus datos no se modifican).'),
  ('PI', 'Proyectos Industriales', 'Proyectos de ingeniería y servicios industriales (módulo pi_).');

-- ── Sesión y permisos ─────────────────────────────────────────────────────────────────────────────────────
create function public.pi_hoy() returns date
language sql stable set search_path = public, pg_temp as $$ select (now() at time zone 'America/Santiago')::date $$;

create function public.pi_es_usuario() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.perfiles where id = auth.uid())
$$;
create function public.pi_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rol = 'admin' from public.perfiles where id = auth.uid()), false)
$$;
create function public.pi_existe_perfil(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p is not null and exists (select 1 from public.perfiles where id = p)
$$;
-- Texto → uuid sin error (rutas de archivos escritas por el cliente).
create function public.pi_uuid_seguro(t text) returns uuid
language sql immutable set search_path = public, pg_temp as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end
$$;
-- RUT chileno: devuelve '76.123.456-7' si es válido; null si viene vacío; error si es inválido.
create function public.pi_rut_normalizado(p text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare l text := upper(regexp_replace(coalesce(p, ''), '[^0-9kK]', '', 'g')); c text; dv text; s int := 0; f int := 2; r int; i int;
begin
  if l = '' then return null; end if;
  c := left(l, -1); dv := right(l, 1);
  if c !~ '^[0-9]{7,8}$' or c::bigint < 1000000 then raise exception 'PI_RUT: RUT con largo no válido' using errcode = '22023'; end if;
  for i in reverse length(c)..1 loop s := s + substr(c, i, 1)::int * f; f := case when f = 7 then 2 else f + 1 end; end loop;
  r := 11 - (s % 11);
  if dv <> (case r when 11 then '0' when 10 then 'K' else r::text end) then raise exception 'PI_RUT: dígito verificador incorrecto' using errcode = '22023'; end if;
  return regexp_replace(c, '(\d)(?=(\d{3})+$)', '\1.', 'g') || '-' || dv;
end $$;

-- ── Correlativo del código de proyecto ───────────────────────────────────────────────────────────────────
create table public.pi_correlativos (anio integer primary key check (anio between 2000 and 2999), ultimo integer not null check (ultimo > 0));

create function public.pi_siguiente_codigo() returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a int := extract(year from public.pi_hoy())::int; n int;
begin
  -- INSERT … ON CONFLICT bloquea la fila del año: dos creaciones simultáneas obtienen números distintos y
  -- consecutivos; si la transacción se revierte, el número también (no quedan huecos ni repetidos).
  insert into public.pi_correlativos (anio, ultimo) values (a, 1)
  on conflict (anio) do update set ultimo = public.pi_correlativos.ultimo + 1
  returning ultimo into n;
  return 'PI-' || a || '-' || case when n < 1000 then lpad(n::text, 3, '0') else n::text end;
end $$;

-- ── Clientes y mandantes ─────────────────────────────────────────────────────────────────────────────────
create table public.pi_clientes (
  id uuid primary key default gen_random_uuid(),
  rut text,
  rut_clave text generated always as (nullif(regexp_replace(coalesce(rut, ''), '[^0-9K]', '', 'g'), '')) stored,
  razon_social text not null check (length(btrim(razon_social)) between 2 and 200),
  nombre_fantasia text check (nombre_fantasia is null or length(nombre_fantasia) <= 200),
  rubro text not null default 'otro' check (rubro in ('mineria','celulosa','energia','manufactura','construccion','agroindustria','pesca','sanitaria','otro')),
  giro text check (giro is null or length(giro) <= 300),
  direccion text check (direccion is null or length(direccion) <= 300),
  comuna text check (comuna is null or length(comuna) <= 100),
  region text check (region is null or length(region) <= 100),
  contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  contacto_cargo text check (contacto_cargo is null or length(contacto_cargo) <= 150),
  contacto_correo text check (contacto_correo is null or contacto_correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contacto_telefono text check (contacto_telefono is null or length(contacto_telefono) <= 40),
  notas text check (notas is null or length(notas) <= 2000),
  activo boolean not null default true,
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);
create unique index pi_clientes_rut_unico on public.pi_clientes (rut_clave) where rut_clave is not null;
create index pi_clientes_nombre on public.pi_clientes (lower(razon_social));

-- ── Proyectos ────────────────────────────────────────────────────────────────────────────────────────────
create table public.pi_proyectos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^PI-[0-9]{4}-[0-9]{3,}$'),
  linea_negocio text not null default 'PI' references public.bfk_lineas_negocio(codigo) check (linea_negocio = 'PI'),
  centro_costo text not null unique,
  cliente_id uuid not null references public.pi_clientes(id),
  mandante_id uuid references public.pi_clientes(id),
  nombre text not null check (length(btrim(nombre)) between 3 and 200),
  descripcion text check (descripcion is null or length(descripcion) <= 4000),
  alcance_tecnico text check (alcance_tecnico is null or length(alcance_tecnico) <= 20000),
  tipo text not null check (tipo in ('ingenieria','montaje','fabricacion','suministro','mantencion','puesta_en_marcha','servicios','mixto','otro')),
  especialidades text[] not null default '{}'
    check (especialidades <@ array['mecanica','electrica','instrumentacion','automatizacion','civil','estructural','piping','procesos','otra']::text[]),
  ubicacion text check (ubicacion is null or length(ubicacion) <= 300),
  comuna text check (comuna is null or length(comuna) <= 100),
  region text check (region is null or length(region) <= 100),
  responsable_id uuid not null,
  estado text not null default 'propuesta' check (estado in ('propuesta','por_iniciar','en_ejecucion','suspendido','finalizado','cerrado','anulado')),
  motivo_estado text check (motivo_estado is null or length(motivo_estado) <= 1000),
  fecha_inicio_prevista date, fecha_termino_prevista date,
  fecha_inicio_real date, fecha_termino_real date,
  autorizado_por uuid, autorizado_en timestamptz,   -- activación autorizada por un administrador (propuesta → por iniciar)
  oportunidad_id uuid,           -- reservado: oportunidad comercial de origen (etapa comercial futura)
  version integer not null default 1,
  creado_por uuid not null, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check (centro_costo = codigo),
  check (estado in ('propuesta','anulado') or autorizado_en is not null),
  check (mandante_id is null or mandante_id <> cliente_id),
  check (fecha_termino_prevista is null or fecha_inicio_prevista is null or fecha_termino_prevista >= fecha_inicio_prevista),
  check (fecha_termino_real is null or fecha_inicio_real is null or fecha_termino_real >= fecha_inicio_real),
  check (fecha_termino_real is null or fecha_inicio_real is not null),
  check (estado not in ('en_ejecucion','finalizado','cerrado') or fecha_inicio_real is not null),
  check (estado not in ('finalizado','cerrado') or fecha_termino_real is not null),
  check (estado not in ('anulado','suspendido') or length(btrim(coalesce(motivo_estado, ''))) > 0)
);
create index pi_proyectos_estado on public.pi_proyectos (estado);
create index pi_proyectos_cliente on public.pi_proyectos (cliente_id);
create index pi_proyectos_responsable on public.pi_proyectos (responsable_id);

create table public.pi_equipo (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.pi_proyectos(id),
  usuario_id uuid not null,
  rol_proyecto text not null check (rol_proyecto in ('jefe','editor','lector')),
  funcion text check (funcion is null or length(funcion) <= 150),
  ve_economia boolean not null default false,       -- autorización específica para ver los datos económicos
  activo boolean not null default true,
  version integer not null default 1,
  creado_por uuid, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  unique (proyecto_id, usuario_id)
);
create index pi_equipo_usuario on public.pi_equipo (usuario_id) where activo;

-- Datos económicos (separados para que RLS los oculte por fila; las etapas económicas futuras seguirán esta regla).
create table public.pi_proyectos_economia (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null unique references public.pi_proyectos(id),
  presupuesto_inicial numeric(18,2) check (presupuesto_inicial is null or presupuesto_inicial >= 0),   -- NETO (sin IVA); null = sin registrar
  moneda text not null default 'CLP' check (moneda in ('CLP','UF','USD','EUR')),
  version integer not null default 1,
  creado_por uuid, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);

-- Interruptores del módulo. documentos_habilitados = false hasta que el respaldo diario de archivos esté activo.
create table public.pi_configuracion (
  id uuid primary key default gen_random_uuid(),
  clave text not null unique check (clave in ('documentos_habilitados')),
  valor jsonb not null,
  motivo text check (motivo is null or length(motivo) <= 1000),
  version integer not null default 1,
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);
insert into public.pi_configuracion (clave, valor, motivo) values ('documentos_habilitados', 'false', 'Instalación: se habilita cuando el respaldo de archivos esté activo');

-- Cuentas de Supabase Auth usadas SOLO por el respaldo diario para leer el depósito pi-documentos (sin perfil BFK:
-- no ven nada más). Las agrega un administrador por SQL; los usuarios no tienen ningún permiso sobre esta tabla.
create table public.pi_cuentas_respaldo (
  usuario_id uuid primary key,
  descripcion text not null check (length(btrim(descripcion)) between 3 and 200),
  creado_en timestamptz not null default now()
);

-- ── Contenido del proyecto ───────────────────────────────────────────────────────────────────────────────
create table public.pi_actividades (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.pi_proyectos(id),
  padre_id uuid references public.pi_actividades(id),
  orden integer not null default 0,
  nombre text not null check (length(btrim(nombre)) between 2 and 200),
  descripcion text check (descripcion is null or length(descripcion) <= 4000),
  especialidad text check (especialidad is null or especialidad in ('mecanica','electrica','instrumentacion','automatizacion','civil','estructural','piping','procesos','gestion','otra')),
  responsable_id uuid,
  fecha_inicio_prevista date, fecha_fin_prevista date,
  fecha_inicio_real date, fecha_fin_real date,
  avance numeric(5,2) not null default 0 check (avance between 0 and 100),
  peso numeric(10,2) not null default 1 check (peso > 0 and peso <= 100000),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_curso','completada','bloqueada','anulada')),
  version integer not null default 1,
  creado_por uuid, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check (padre_id is null or padre_id <> id),
  check (fecha_fin_prevista is null or fecha_inicio_prevista is null or fecha_fin_prevista >= fecha_inicio_prevista),
  check (fecha_fin_real is null or fecha_inicio_real is null or fecha_fin_real >= fecha_inicio_real),
  check (estado <> 'completada' or (avance = 100 and fecha_fin_real is not null))
);
create index pi_actividades_proyecto on public.pi_actividades (proyecto_id, padre_id, orden);

create table public.pi_hitos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.pi_proyectos(id),
  nombre text not null check (length(btrim(nombre)) between 2 and 200),
  descripcion text check (descripcion is null or length(descripcion) <= 2000),
  tipo text not null default 'interno' check (tipo in ('contractual','pago','entrega','interno')),
  fecha_prevista date not null,
  fecha_real date,
  actividad_id uuid references public.pi_actividades(id),
  estado text not null default 'pendiente' check (estado in ('pendiente','cumplido','anulado')),
  version integer not null default 1,
  creado_por uuid, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check (estado <> 'cumplido' or fecha_real is not null)
);
create index pi_hitos_proyecto on public.pi_hitos (proyecto_id, fecha_prevista);

create table public.pi_entregables (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.pi_proyectos(id),
  codigo text check (codigo is null or length(btrim(codigo)) between 1 and 80),   -- N.º de documento (cliente o BFK)
  nombre text not null check (length(btrim(nombre)) between 2 and 200),
  descripcion text check (descripcion is null or length(descripcion) <= 2000),
  tipo text not null default 'otro' check (tipo in ('plano','memoria_calculo','especificacion','listado_materiales','informe','procedimiento','dossier','protocolo','otro')),
  especialidad text check (especialidad is null or especialidad in ('mecanica','electrica','instrumentacion','automatizacion','civil','estructural','piping','procesos','gestion','otra')),
  responsable_id uuid,
  fecha_comprometida date,
  fecha_entrega date,
  revision text not null default 'A' check (revision ~ '^[A-Z0-9]{1,4}$'),
  estado text not null default 'pendiente' check (estado in ('pendiente','en_elaboracion','en_revision','aprobado','emitido','rechazado','anulado')),
  hito_id uuid references public.pi_hitos(id),
  version integer not null default 1,
  creado_por uuid, creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check (estado not in ('emitido','aprobado') or fecha_entrega is not null)
);
create unique index pi_entregables_codigo on public.pi_entregables (proyecto_id, upper(codigo)) where codigo is not null;
create index pi_entregables_proyecto on public.pi_entregables (proyecto_id, fecha_comprometida);

create table public.pi_documentos (
  id uuid primary key default gen_random_uuid(),
  proyecto_id uuid not null references public.pi_proyectos(id),
  entregable_id uuid references public.pi_entregables(id),
  titulo text not null check (length(btrim(titulo)) between 2 and 200),
  categoria text not null default 'otro' check (categoria in ('contractual','tecnico','plano','memoria','especificacion','informe','calidad','seguridad','fotografia','otro')),
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 200),
  ruta text not null unique check (length(ruta) <= 400),
  tipo_mime text check (tipo_mime is null or length(tipo_mime) <= 120),
  tamano bigint not null check (tamano > 0 and tamano <= 52428800),     -- máx. 50 MB
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  numero_version integer not null default 1 check (numero_version > 0),   -- versión del documento (1, 2, 3…)
  documento_base_id uuid references public.pi_documentos(id),           -- primera versión (null = es la primera)
  estado text not null default 'vigente' check (estado in ('vigente','reemplazado','anulado')),
  motivo_anulacion text check (motivo_anulacion is null or length(motivo_anulacion) <= 1000),
  subido_por uuid not null default auth.uid(), subido_en timestamptz not null default now(),
  version integer not null default 1,                                    -- control de edición simultánea
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check (estado <> 'anulado' or length(btrim(coalesce(motivo_anulacion, ''))) > 0)
);
create index pi_documentos_proyecto on public.pi_documentos (proyecto_id, estado);
create index pi_documentos_base on public.pi_documentos (documento_base_id);

-- ── Historial inalterable ────────────────────────────────────────────────────────────────────────────────
create table public.pi_historial (
  id bigint generated always as identity primary key,
  proyecto_id uuid,                 -- null para registros sin proyecto (clientes)
  tabla text not null,
  registro_id uuid not null,
  accion text not null check (accion in ('crear','modificar','eliminar')),
  cambios jsonb not null,
  usuario_id uuid, usuario_nombre text,
  fecha timestamptz not null default now()
);
create index pi_historial_proyecto on public.pi_historial (proyecto_id, fecha desc);
create index pi_historial_registro on public.pi_historial (registro_id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Rol del usuario en un proyecto: 'admin' · 'jefe' · 'editor' · 'lector' · null (sin acceso).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create function public.pi_rol_en(p uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not public.pi_es_usuario() then null
    when public.pi_es_admin() then 'admin'
    else (select e.rol_proyecto from public.pi_equipo e where e.proyecto_id = p and e.usuario_id = auth.uid() and e.activo)
  end
$$;
create function public.pi_puede_ver(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$ select public.pi_rol_en(p) is not null $$;
-- Editar contenido: admin siempre; jefe/editor solo si el proyecto no está cerrado ni anulado.
create function public.pi_puede_editar(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.pi_rol_en(p)
    when 'admin' then true
    when 'jefe' then not exists (select 1 from public.pi_proyectos where id = p and estado in ('cerrado','anulado'))
    when 'editor' then not exists (select 1 from public.pi_proyectos where id = p and estado in ('cerrado','anulado'))
    else false end
$$;
create function public.pi_es_jefe(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case public.pi_rol_en(p)
    when 'admin' then true
    when 'jefe' then not exists (select 1 from public.pi_proyectos where id = p and estado in ('cerrado','anulado'))
    else false end
$$;
-- Para la interfaz (el permiso real lo aplica RLS).
create function public.pi_mi_rol(p_proyecto uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select public.pi_rol_en(p_proyecto) $$;
-- Ver datos económicos: administrador, responsable principal o integrante activo con autorización específica.
create function public.pi_ve_economia(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.pi_es_usuario() and (public.pi_es_admin()
    or exists (select 1 from public.pi_proyectos where id = p and responsable_id = auth.uid())
    or exists (select 1 from public.pi_equipo where proyecto_id = p and usuario_id = auth.uid() and activo and ve_economia))
$$;
-- Editar datos económicos: administrador siempre; responsable principal solo mientras es propuesta o por iniciar.
create function public.pi_edita_economia(p uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.pi_es_usuario() and (public.pi_es_admin()
    or exists (select 1 from public.pi_proyectos where id = p and responsable_id = auth.uid() and estado in ('propuesta','por_iniciar')))
$$;
create function public.pi_documentos_habilitados() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor = 'true'::jsonb from public.pi_configuracion where clave = 'documentos_habilitados'), false)
$$;
create function public.pi_es_lector_respaldo() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.pi_cuentas_respaldo where usuario_id = auth.uid())
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Validaciones (disparadores BEFORE): se aplican a TODA escritura, venga de la app, de una RPC o de SQL directo.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Sello común: versión, autor y fecha de la modificación.
create function public.pi_sellar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;   -- el historial solo registra cambios reales (pi_auditar)
    if to_jsonb(new) ? 'creado_por' then new.creado_por := old.creado_por; new.creado_en := old.creado_en; end if;
  else
    new.version := 1;
    if to_jsonb(new) ? 'creado_por' then new.creado_por := coalesce(auth.uid(), new.creado_por); new.creado_en := now(); end if;
  end if;
  new.actualizado_por := auth.uid(); new.actualizado_en := now();
  return new;
end $$;

create function public.pi_validar_cliente() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.rut := public.pi_rut_normalizado(new.rut);
  new.razon_social := btrim(new.razon_social);
  if tg_op = 'UPDATE' and new.creado_por is distinct from old.creado_por then raise exception 'PI_CLIENTE: el autor no se modifica' using errcode = '42501'; end if;
  return new;
end $$;

-- Estados del proyecto: transiciones permitidas y fechas reales.
create function public.pi_transicion_valida(desde text, hasta text, es_admin boolean) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select desde = hasta or (desde, hasta) in (
    ('propuesta','anulado'),
    ('por_iniciar','en_ejecucion'), ('por_iniciar','suspendido'), ('por_iniciar','anulado'),
    ('en_ejecucion','suspendido'), ('en_ejecucion','finalizado'), ('en_ejecucion','anulado'),
    ('suspendido','en_ejecucion'), ('suspendido','por_iniciar'), ('suspendido','anulado'),
    ('finalizado','en_ejecucion'))
  or (es_admin and (desde, hasta) in (('propuesta','por_iniciar'), ('finalizado','cerrado'), ('cerrado','finalizado'), ('anulado','propuesta')))
$$;

create function public.pi_validar_proyecto() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare adm boolean := public.pi_es_admin(); c record;
begin
  if not public.pi_existe_perfil(new.responsable_id) then raise exception 'PI_PROYECTO: el responsable principal debe ser un usuario de BFK' using errcode = '23503'; end if;
  if new.mandante_id is not null and not exists (select 1 from public.pi_clientes where id = new.mandante_id) then raise exception 'PI_PROYECTO: mandante inexistente' using errcode = '23503'; end if;
  select activo into c from public.pi_clientes where id = new.cliente_id;
  if tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id then
    if c is null or not c.activo then raise exception 'PI_PROYECTO: el cliente no existe o está inactivo' using errcode = '23503'; end if;
  end if;
  new.nombre := btrim(new.nombre);
  if new.fecha_inicio_real > public.pi_hoy() or new.fecha_termino_real > public.pi_hoy() then
    raise exception 'PI_FECHA: las fechas reales no pueden ser futuras' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then new.estado := 'propuesta'; new.autorizado_por := null; new.autorizado_en := null; end if;
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.codigo <> old.codigo or new.linea_negocio <> old.linea_negocio or new.centro_costo <> old.centro_costo
       or new.creado_por <> old.creado_por or new.creado_en <> old.creado_en then
      raise exception 'PI_PROYECTO: el código, la línea de negocio, el centro de costo y el autor no se modifican' using errcode = '42501'; end if;
    if not public.pi_transicion_valida(old.estado, new.estado, adm) then
      raise exception 'PI_ESTADO: no se puede pasar de % a %', old.estado, new.estado using errcode = '23514'; end if;
    if (new.autorizado_por is distinct from old.autorizado_por or new.autorizado_en is distinct from old.autorizado_en)
       and not (old.estado = 'propuesta' and new.estado = 'por_iniciar') then
      raise exception 'PI_PROYECTO: la autorización la registra el sistema al activar la propuesta' using errcode = '42501'; end if;
    if new.estado <> old.estado then
      if old.estado = 'propuesta' and new.estado = 'por_iniciar' then new.autorizado_por := auth.uid(); new.autorizado_en := now(); end if;
      if new.estado = 'en_ejecucion' then new.fecha_inicio_real := coalesce(new.fecha_inicio_real, public.pi_hoy()); end if;
      if new.estado = 'finalizado' then new.fecha_termino_real := coalesce(new.fecha_termino_real, public.pi_hoy()); end if;
      if old.estado = 'finalizado' and new.estado = 'en_ejecucion' then new.fecha_termino_real := null; end if;
      if new.estado not in ('anulado','suspendido') and new.motivo_estado is not distinct from old.motivo_estado then new.motivo_estado := null; end if;
    end if;
  end if;
  return new;
end $$;

-- El responsable principal queda siempre en el equipo como jefe.
create function public.pi_asegurar_responsable() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' or new.responsable_id is distinct from old.responsable_id then
    insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto, funcion, creado_por)
    values (new.id, new.responsable_id, 'jefe', 'Responsable principal', auth.uid())
    on conflict (proyecto_id, usuario_id) do update set rol_proyecto = 'jefe', activo = true;
  end if;
  return null;
end $$;

create function public.pi_validar_equipo() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare resp uuid;
begin
  select responsable_id into resp from public.pi_proyectos where id = new.proyecto_id;
  if not public.pi_existe_perfil(new.usuario_id) then raise exception 'PI_EQUIPO: el integrante debe ser un usuario de BFK' using errcode = '23503'; end if;
  if tg_op = 'UPDATE' then
    if new.proyecto_id <> old.proyecto_id or new.usuario_id <> old.usuario_id then raise exception 'PI_EQUIPO: no se cambia el proyecto ni la persona de un integrante' using errcode = '42501'; end if;
    if old.usuario_id = resp and (not new.activo or new.rol_proyecto <> 'jefe') then
      raise exception 'PI_EQUIPO: el responsable principal debe seguir como jefe activo (cambia primero el responsable del proyecto)' using errcode = '23514'; end if;
  end if;
  if new.ve_economia and (tg_op = 'INSERT' or not old.ve_economia)
     and not (public.pi_es_admin() or auth.uid() = resp) then
    raise exception 'PI_ECONOMIA: solo el administrador o el responsable principal autoriza ver los datos económicos' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' and old.ve_economia and not new.ve_economia and not (public.pi_es_admin() or auth.uid() = resp) then
    raise exception 'PI_ECONOMIA: solo el administrador o el responsable principal retira la autorización económica' using errcode = '42501'; end if;
  return new;
end $$;

-- Pertenencia al mismo proyecto y responsables integrantes (actividades, hitos, entregables, documentos).
create function public.pi_validar_contenido() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; p uuid; h date := public.pi_hoy(); j jsonb := to_jsonb(new);
begin
  if tg_op = 'UPDATE' and new.proyecto_id <> old.proyecto_id then raise exception 'PI: un registro no se mueve a otro proyecto' using errcode = '42501'; end if;
  if (j->>'responsable_id') is not null and not exists (select 1 from public.pi_equipo where proyecto_id = new.proyecto_id and usuario_id = (j->>'responsable_id')::uuid and activo) then
    raise exception 'PI: el responsable debe integrar el equipo activo del proyecto' using errcode = '23514'; end if;
  if tg_table_name = 'pi_actividades' then
    if new.fecha_inicio_real > h or new.fecha_fin_real > h then raise exception 'PI_FECHA: las fechas reales no pueden ser futuras' using errcode = '23514'; end if;
    if new.padre_id is not null then
      if not exists (select 1 from public.pi_actividades where id = new.padre_id and proyecto_id = new.proyecto_id) then raise exception 'PI_EDT: la actividad padre pertenece a otro proyecto' using errcode = '23514'; end if;
      n := 1; p := new.padre_id;
      while p is not null loop
        if p = new.id then raise exception 'PI_EDT: una actividad no puede depender de sí misma' using errcode = '23514'; end if;
        n := n + 1; if n > 3 then raise exception 'PI_EDT: máximo 3 niveles (actividad, subtarea y sub-subtarea)' using errcode = '23514'; end if;
        select padre_id into p from public.pi_actividades where id = p;
      end loop;
      if tg_op = 'UPDATE' and new.padre_id is distinct from old.padre_id and exists (
        with recursive d as (select id, 1 as nv from public.pi_actividades where padre_id = new.id union all select a.id, d.nv + 1 from public.pi_actividades a join d on a.padre_id = d.id)
        select 1 from d where d.nv + n > 3) then raise exception 'PI_EDT: máximo 3 niveles (actividad, subtarea y sub-subtarea)' using errcode = '23514'; end if;
    end if;
    -- Coherencia estado ↔ avance ↔ fechas reales.
    if new.estado = 'completada' then new.avance := 100; new.fecha_fin_real := coalesce(new.fecha_fin_real, h); new.fecha_inicio_real := coalesce(new.fecha_inicio_real, least(new.fecha_fin_real, h));
    elsif new.estado <> 'anulada' and new.avance = 100 then new.estado := 'completada'; new.fecha_fin_real := coalesce(new.fecha_fin_real, h); new.fecha_inicio_real := coalesce(new.fecha_inicio_real, least(new.fecha_fin_real, h));
    elsif new.estado = 'pendiente' and new.avance > 0 then new.estado := 'en_curso';
    end if;
    if new.estado = 'en_curso' then new.fecha_inicio_real := coalesce(new.fecha_inicio_real, h); end if;
    if new.estado in ('pendiente','en_curso','bloqueada') and tg_op = 'UPDATE' and old.estado = 'completada' then new.fecha_fin_real := null; end if;
  elsif tg_table_name = 'pi_hitos' then
    if new.actividad_id is not null and not exists (select 1 from public.pi_actividades where id = new.actividad_id and proyecto_id = new.proyecto_id) then
      raise exception 'PI: la actividad del hito pertenece a otro proyecto' using errcode = '23514'; end if;
    if new.fecha_real > h then raise exception 'PI_FECHA: la fecha real del hito no puede ser futura' using errcode = '23514'; end if;
    if new.estado <> 'anulado' then new.estado := case when new.fecha_real is not null then 'cumplido' else 'pendiente' end; end if;
  elsif tg_table_name = 'pi_entregables' then
    if new.hito_id is not null and not exists (select 1 from public.pi_hitos where id = new.hito_id and proyecto_id = new.proyecto_id) then
      raise exception 'PI: el hito del entregable pertenece a otro proyecto' using errcode = '23514'; end if;
    new.codigo := nullif(btrim(coalesce(new.codigo, '')), '');
    if new.fecha_entrega > h then raise exception 'PI_FECHA: la fecha de entrega no puede ser futura' using errcode = '23514'; end if;
    if new.estado in ('emitido','aprobado') then new.fecha_entrega := coalesce(new.fecha_entrega, h); end if;
  end if;
  return new;
end $$;

-- Documentos: el archivo debe existir en el depósito del MISMO proyecto; versiones encadenadas; los datos del archivo
-- no se modifican (solo título, categoría, entregable y anulación).
-- SECURITY INVOKER a propósito: la verificación del archivo en Storage se hace con los permisos del propio usuario.
create function public.pi_validar_documento() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $$
declare b record; v int;
begin
  if tg_op = 'INSERT' then
    if split_part(new.ruta, '/', 1) <> new.proyecto_id::text or new.ruta !~ '^[0-9a-f-]{36}/[^/]+$' or length(new.ruta) > 340 then
      raise exception 'PI_DOC: la ruta del archivo no corresponde al proyecto' using errcode = '42501'; end if;
    if to_regclass('storage.objects') is not null
       and not exists (select 1 from storage.objects where bucket_id = 'pi-documentos' and name = new.ruta) then
      raise exception 'PI_DOC: el archivo no está en el depósito privado (súbelo antes de registrarlo)' using errcode = '23503'; end if;
    new.estado := 'vigente'; new.motivo_anulacion := null; new.subido_por := auth.uid(); new.subido_en := now();
    if new.entregable_id is not null and not exists (select 1 from public.pi_entregables where id = new.entregable_id and proyecto_id = new.proyecto_id) then
      raise exception 'PI_DOC: el entregable pertenece a otro proyecto' using errcode = '23514'; end if;
    if new.documento_base_id is not null then
      select * into b from public.pi_documentos where id = new.documento_base_id for update;
      if b is null or b.proyecto_id <> new.proyecto_id then raise exception 'PI_DOC: el documento base pertenece a otro proyecto' using errcode = '23514'; end if;
      new.documento_base_id := coalesce(b.documento_base_id, b.id);
      perform 1 from public.pi_documentos where id = new.documento_base_id for update;   -- serializa versiones simultáneas
      select max(numero_version) + 1 into v from public.pi_documentos where id = new.documento_base_id or documento_base_id = new.documento_base_id;
      new.numero_version := v;
    else new.numero_version := 1; end if;
  else
    if new.proyecto_id <> old.proyecto_id or new.ruta <> old.ruta or new.sha256 <> old.sha256 or new.tamano <> old.tamano or new.nombre_archivo <> old.nombre_archivo
       or new.numero_version <> old.numero_version or new.documento_base_id is distinct from old.documento_base_id or new.subido_por <> old.subido_por or new.subido_en <> old.subido_en then
      raise exception 'PI_DOC: el archivo registrado no se modifica; sube una nueva versión' using errcode = '42501'; end if;
    if old.estado = 'anulado' and new.estado <> 'anulado' and not public.pi_es_admin() then raise exception 'PI_DOC: solo un administrador restaura un documento anulado' using errcode = '42501'; end if;
    if new.estado = 'reemplazado' and old.estado <> 'reemplazado' and pg_trigger_depth() < 2 then raise exception 'PI_DOC: el estado reemplazado lo asigna el sistema al subir una nueva versión' using errcode = '42501'; end if;
    if new.entregable_id is not null and not exists (select 1 from public.pi_entregables where id = new.entregable_id and proyecto_id = new.proyecto_id) then
      raise exception 'PI_DOC: el entregable pertenece a otro proyecto' using errcode = '23514'; end if;
  end if;
  return new;
end $$;

create function public.pi_reemplazar_versiones() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.documento_base_id is not null then
    update public.pi_documentos set estado = 'reemplazado'
    where (id = new.documento_base_id or documento_base_id = new.documento_base_id) and id <> new.id and estado = 'vigente';
  end if;
  return null;
end $$;

-- Datos económicos: el presupuesto inicial es la línea base; después de iniciado solo lo corrige un administrador.
create function public.pi_validar_economia() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare est text;
begin
  if tg_op = 'UPDATE' then
    if new.proyecto_id <> old.proyecto_id then raise exception 'PI: un registro no se mueve a otro proyecto' using errcode = '42501'; end if;
    select estado into est from public.pi_proyectos where id = new.proyecto_id;
    if (new.presupuesto_inicial is distinct from old.presupuesto_inicial or new.moneda <> old.moneda)
       and est not in ('propuesta','por_iniciar') and not public.pi_es_admin() then
      raise exception 'PI_PRESUPUESTO: el presupuesto inicial ya es línea base; solo un administrador puede corregirlo' using errcode = '42501'; end if;
  end if;
  return new;
end $$;

-- Habilitar o deshabilitar la carga de documentos (solo administrador; queda en el historial).
create function public.pi_configurar_documentos(p_habilitar boolean, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
begin
  if not public.pi_es_admin() then raise exception 'PI: solo un administrador habilita o deshabilita la carga de documentos' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'PI: indica el motivo' using errcode = '23514'; end if;
  update public.pi_configuracion set valor = to_jsonb(coalesce(p_habilitar, false)), motivo = btrim(p_motivo) where clave = 'documentos_habilitados';
  return jsonb_build_object('documentos_habilitados', public.pi_documentos_habilitados());
end $$;

-- Auditoría: una fila por cambio real, con los campos modificados (antes → después).
create function public.pi_auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; dif jsonb := '{}'::jsonb; k text; proy uuid; reg uuid;
  omitir text[] := array['version','actualizado_por','actualizado_en','rut_clave'];
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old) - omitir; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - omitir; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if n->k is distinct from o->k then dif := dif || jsonb_build_object(k, jsonb_build_object('antes', o->k, 'despues', n->k)); end if;
    end loop;
    if dif = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then dif := n; else dif := o; end if;
  reg := coalesce(n->>'id', o->>'id')::uuid;
  proy := case when tg_table_name = 'pi_proyectos' then reg when tg_table_name in ('pi_clientes','pi_configuracion') then null else coalesce(n->>'proyecto_id', o->>'proyecto_id')::uuid end;
  insert into public.pi_historial (proyecto_id, tabla, registro_id, accion, cambios, usuario_id, usuario_nombre)
  values (proy, tg_table_name, reg, case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'modificar' else 'eliminar' end, dif,
          auth.uid(), (select nombre from public.perfiles where id = auth.uid()));
  return null;
end $$;

create function public.pi_historial_inalterable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'PI_HISTORIAL: el historial no se modifica ni se elimina' using errcode = '42501'; end $$;

-- Una actividad, hito o entregable con dependencias no se elimina (se anula).
create function public.pi_validar_eliminacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_table_name = 'pi_actividades' and (exists (select 1 from public.pi_actividades where padre_id = old.id) or exists (select 1 from public.pi_hitos where actividad_id = old.id)) then
    raise exception 'PI: la actividad tiene subtareas o hitos asociados; anúlala en vez de eliminarla' using errcode = '23503'; end if;
  if tg_table_name = 'pi_hitos' and exists (select 1 from public.pi_entregables where hito_id = old.id) then
    raise exception 'PI: el hito tiene entregables asociados; anúlalo en vez de eliminarlo' using errcode = '23503'; end if;
  if tg_table_name = 'pi_entregables' and exists (select 1 from public.pi_documentos where entregable_id = old.id) then
    raise exception 'PI: el entregable tiene documentos asociados; anúlalo en vez de eliminarlo' using errcode = '23503'; end if;
  return old;
end $$;

create trigger pi_10_validar before insert or update on public.pi_clientes for each row execute function public.pi_validar_cliente();
create trigger pi_10_validar before insert or update on public.pi_proyectos for each row execute function public.pi_validar_proyecto();
create trigger pi_10_validar before insert or update on public.pi_equipo for each row execute function public.pi_validar_equipo();
create trigger pi_10_validar before insert or update on public.pi_actividades for each row execute function public.pi_validar_contenido();
create trigger pi_10_validar before insert or update on public.pi_hitos for each row execute function public.pi_validar_contenido();
create trigger pi_10_validar before insert or update on public.pi_entregables for each row execute function public.pi_validar_contenido();
create trigger pi_10_validar before insert or update on public.pi_documentos for each row execute function public.pi_validar_documento();
create trigger pi_10_validar before insert or update on public.pi_proyectos_economia for each row execute function public.pi_validar_economia();
create trigger pi_20_eliminar before delete on public.pi_actividades for each row execute function public.pi_validar_eliminacion();
create trigger pi_20_eliminar before delete on public.pi_hitos for each row execute function public.pi_validar_eliminacion();
create trigger pi_20_eliminar before delete on public.pi_entregables for each row execute function public.pi_validar_eliminacion();
do $$ declare t text; begin
  foreach t in array array['pi_clientes','pi_proyectos','pi_proyectos_economia','pi_equipo','pi_actividades','pi_hitos','pi_entregables','pi_documentos','pi_configuracion'] loop
    execute format('create trigger pi_90_sellar before insert or update on public.%I for each row execute function public.pi_sellar()', t);
    execute format('create trigger pi_99_auditar after insert or update or delete on public.%I for each row execute function public.pi_auditar()', t);
  end loop;
end $$;
-- pi_documentos usa subido_por/subido_en (no creado_por): pi_sellar solo ajusta versión y actualizado_*.
create trigger pi_50_responsable after insert or update of responsable_id on public.pi_proyectos for each row execute function public.pi_asegurar_responsable();
create trigger pi_50_versiones after insert on public.pi_documentos for each row execute function public.pi_reemplazar_versiones();
create trigger pi_10_inalterable before update or delete on public.pi_historial for each row execute function public.pi_historial_inalterable();
create trigger pi_10_inalterable_t before truncate on public.pi_historial for each statement execute function public.pi_historial_inalterable();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Funciones (RPC)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Crea un proyecto con código único. p: {cliente_id, mandante_id?, nombre, descripcion?, alcance_tecnico?, tipo,
-- especialidades?, ubicacion?, comuna?, region?, responsable_id, fecha_inicio_prevista?, fecha_termino_prevista?,
-- presupuesto_inicial?, moneda?, equipo?: [{usuario_id, rol_proyecto, funcion?}]}
create function public.pi_crear_proyecto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_cod text; m jsonb;
begin
  if not public.pi_es_usuario() then raise exception 'PI: usuario sin perfil BFK' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'PI: formato inválido' using errcode = '22023'; end if;
  if p ? 'equipo' and jsonb_typeof(p->'equipo') is distinct from 'array' then raise exception 'PI: equipo inválido' using errcode = '22023'; end if;
  if p ? 'especialidades' and jsonb_typeof(p->'especialidades') is distinct from 'array' then raise exception 'PI: especialidades inválidas (se espera una lista)' using errcode = '22023'; end if;
  if coalesce(nullif(p->>'presupuesto_inicial',''), '0')::numeric <> 0 and not public.pi_es_admin()
     and nullif(p->>'responsable_id','')::uuid is distinct from auth.uid() then
    raise exception 'PI_PRESUPUESTO: el presupuesto lo registra el responsable del proyecto o un administrador' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p->'equipo', '[]')) > 50 then raise exception 'PI: máximo 50 integrantes' using errcode = '22023'; end if;
  v_cod := public.pi_siguiente_codigo();
  insert into public.pi_proyectos (codigo, centro_costo, cliente_id, mandante_id, nombre, descripcion, alcance_tecnico, tipo, especialidades,
    ubicacion, comuna, region, responsable_id, fecha_inicio_prevista, fecha_termino_prevista, creado_por)
  values (v_cod, v_cod, nullif(p->>'cliente_id','')::uuid, nullif(p->>'mandante_id','')::uuid, p->>'nombre', nullif(btrim(p->>'descripcion'),''),
    nullif(btrim(p->>'alcance_tecnico'),''), p->>'tipo', coalesce(array(select distinct x from jsonb_array_elements_text(coalesce(p->'especialidades','[]')) x order by 1), '{}'),
    nullif(btrim(p->>'ubicacion'),''), nullif(btrim(p->>'comuna'),''), nullif(btrim(p->>'region'),''), nullif(p->>'responsable_id','')::uuid,
    nullif(p->>'fecha_inicio_prevista','')::date, nullif(p->>'fecha_termino_prevista','')::date, auth.uid())
  returning id into v_id;
  insert into public.pi_proyectos_economia (proyecto_id, presupuesto_inicial, moneda, creado_por)
  values (v_id, nullif(p->>'presupuesto_inicial','')::numeric, coalesce(nullif(p->>'moneda',''), 'CLP'), auth.uid());
  -- Quien crea el proyecto queda en el equipo (si no es el responsable, como editor), salvo que sea administrador.
  if not public.pi_es_admin() then
    insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto, funcion, creado_por)
    values (v_id, auth.uid(), 'editor', 'Creó el proyecto', auth.uid()) on conflict (proyecto_id, usuario_id) do nothing;
  end if;
  for m in select * from jsonb_array_elements(coalesce(p->'equipo', '[]')) loop
    insert into public.pi_equipo (proyecto_id, usuario_id, rol_proyecto, funcion, creado_por)
    values (v_id, (m->>'usuario_id')::uuid, coalesce(m->>'rol_proyecto','editor'), nullif(btrim(m->>'funcion'),''), auth.uid())
    on conflict (proyecto_id, usuario_id) do update set rol_proyecto = case when public.pi_equipo.rol_proyecto = 'jefe' then 'jefe' else excluded.rol_proyecto end,
      funcion = coalesce(excluded.funcion, public.pi_equipo.funcion), activo = true;
  end loop;
  return jsonb_build_object('id', v_id, 'codigo', v_cod, 'version', (select version from public.pi_proyectos where id = v_id));
end $$;

-- Cambio de estado con control de versión (si otra persona guardó antes: PI409).
create function public.pi_cambiar_estado(p_id uuid, p_estado text, p_motivo text default null, p_version integer default null) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare r public.pi_proyectos;
begin
  if not public.pi_es_jefe(p_id) and not (public.pi_es_admin()) then raise exception 'PI: solo el jefe del proyecto o un administrador cambia el estado' using errcode = '42501'; end if;
  select * into r from public.pi_proyectos where id = p_id for update;
  if r is null then raise exception 'PI: proyecto no encontrado' using errcode = 'P0002'; end if;
  if p_version is not null and r.version <> p_version then raise exception 'PI409: otra persona guardó cambios en este proyecto (versión %). Recarga antes de continuar.', r.version using errcode = '40001'; end if;
  update public.pi_proyectos set estado = p_estado, motivo_estado = case when p_estado in ('anulado','suspendido') then nullif(btrim(coalesce(p_motivo,'')),'') else null end
  where id = p_id returning * into r;
  return jsonb_build_object('estado', r.estado, 'version', r.version, 'fecha_inicio_real', r.fecha_inicio_real, 'fecha_termino_real', r.fecha_termino_real);
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Vistas de cálculo (ÚNICA fuente del avance y los atrasos; la interfaz solo los muestra).
-- security_invoker = true: cada usuario ve solo las filas que RLS le permite.
--   · Avance real: promedio ponderado (por peso) del avance de las actividades HOJA no anuladas.
--   · Avance planificado a hoy: por actividad hoja con fechas previstas, proporción lineal de días transcurridos.
--   · Actividad atrasada: fin previsto anterior a hoy y no completada ni anulada.
--   · Proyecto atrasado (activo: por iniciar, en ejecución o suspendido): término previsto vencido, inicio previsto
--     vencido sin iniciar, actividades atrasadas, hitos vencidos, entregables vencidos o avance real más de 10 puntos
--     bajo lo planificado.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create view public.pi_actividades_vista with (security_invoker = true) as
with recursive arbol as (
  select a.id, a.proyecto_id, a.padre_id, 1 as nivel, array[a.orden, 0] as ruta_orden, array[a.id] as camino
  from public.pi_actividades a where a.padre_id is null
  union all
  select a.id, a.proyecto_id, a.padre_id, arbol.nivel + 1, arbol.ruta_orden || array[a.orden, 0], arbol.camino || a.id
  from public.pi_actividades a join arbol on a.padre_id = arbol.id
),
hojas as (
  select a.* from public.pi_actividades a
  where a.estado <> 'anulada' and not exists (select 1 from public.pi_actividades h where h.padre_id = a.id and h.estado <> 'anulada')
),
plan as (
  select h.id, h.peso, h.avance,
    case when h.fecha_inicio_prevista is null or h.fecha_fin_prevista is null then null
         when public.pi_hoy() < h.fecha_inicio_prevista then 0
         when public.pi_hoy() >= h.fecha_fin_prevista then 100
         else round(100.0 * (public.pi_hoy() - h.fecha_inicio_prevista + 1) / (h.fecha_fin_prevista - h.fecha_inicio_prevista + 1), 2) end as plan
  from hojas h
),
agregado as (
  select ar.id,
    round(sum(pl.peso * pl.avance) / nullif(sum(pl.peso), 0), 2) as avance_calc,
    round(sum(pl.peso * pl.plan) filter (where pl.plan is not null) / nullif(sum(pl.peso) filter (where pl.plan is not null), 0), 2) as plan_calc,
    count(*) as n_hojas
  from arbol ar join arbol d on ar.id = any(d.camino) join plan pl on pl.id = d.id
  group by ar.id
)
select a.*, ar.nivel, ar.ruta_orden,
  exists (select 1 from public.pi_actividades h where h.padre_id = a.id and h.estado <> 'anulada') as tiene_subtareas,
  case when a.estado = 'anulada' then null else coalesce(ag.avance_calc, a.avance) end as avance_calculado,
  -- Estado mostrado: una actividad con subtareas toma el estado de su avance calculado (salvo bloqueada o anulada).
  case when a.estado in ('anulada','bloqueada') or ag.avance_calc is null
         or not exists (select 1 from public.pi_actividades h where h.padre_id = a.id and h.estado <> 'anulada') then a.estado
       when ag.avance_calc >= 100 then 'completada' when ag.avance_calc > 0 then 'en_curso' else 'pendiente' end as estado_calculado,
  ag.plan_calc as avance_planificado,
  (a.estado not in ('completada','anulada') and a.fecha_fin_prevista is not null and a.fecha_fin_prevista < public.pi_hoy()
    and coalesce(ag.avance_calc, a.avance) < 100) as atrasada,
  (a.estado not in ('completada','anulada') and a.fecha_fin_prevista is not null and a.fecha_fin_prevista between public.pi_hoy() and public.pi_hoy() + 7) as por_vencer
from public.pi_actividades a join arbol ar on ar.id = a.id left join agregado ag on ag.id = a.id;

create view public.pi_proyectos_resumen with (security_invoker = true) as
with hojas as (
  select a.proyecto_id, a.peso, a.avance, a.estado, a.fecha_inicio_prevista, a.fecha_fin_prevista,
    case when a.fecha_inicio_prevista is null or a.fecha_fin_prevista is null then null
         when public.pi_hoy() < a.fecha_inicio_prevista then 0
         when public.pi_hoy() >= a.fecha_fin_prevista then 100
         else round(100.0 * (public.pi_hoy() - a.fecha_inicio_prevista + 1) / (a.fecha_fin_prevista - a.fecha_inicio_prevista + 1), 2) end as plan
  from public.pi_actividades a
  where a.estado <> 'anulada' and not exists (select 1 from public.pi_actividades h where h.padre_id = a.id and h.estado <> 'anulada')
),
act as (
  select proyecto_id, count(*) as n_actividades,
    count(*) filter (where estado = 'completada') as n_actividades_completadas,
    count(*) filter (where estado not in ('completada') and fecha_fin_prevista < public.pi_hoy()) as n_actividades_atrasadas,
    round(sum(peso * avance) / nullif(sum(peso), 0), 2) as avance_real,
    round(sum(peso * plan) filter (where plan is not null) / nullif(sum(peso) filter (where plan is not null), 0), 2) as avance_planificado
  from hojas group by proyecto_id
),
hit as (
  select proyecto_id, count(*) filter (where estado <> 'anulado') as n_hitos,
    count(*) filter (where estado = 'pendiente' and fecha_prevista < public.pi_hoy()) as n_hitos_vencidos,
    min(fecha_prevista) filter (where estado = 'pendiente' and fecha_prevista >= public.pi_hoy()) as proximo_hito_fecha
  from public.pi_hitos group by proyecto_id
),
ent as (
  select proyecto_id, count(*) filter (where estado <> 'anulado') as n_entregables,
    count(*) filter (where estado in ('pendiente','en_elaboracion','en_revision','rechazado')) as n_entregables_pendientes,
    count(*) filter (where estado in ('pendiente','en_elaboracion','en_revision','rechazado') and fecha_comprometida < public.pi_hoy()) as n_entregables_vencidos
  from public.pi_entregables group by proyecto_id
),
doc as (select proyecto_id, count(*) filter (where estado = 'vigente') as n_documentos from public.pi_documentos group by proyecto_id),
eq as (select proyecto_id, count(*) filter (where activo) as n_equipo from public.pi_equipo group by proyecto_id)
select p.*,
  e.presupuesto_inicial, e.moneda, e.version as version_economia, public.pi_ve_economia(p.id) as ve_economia,
  c.razon_social as cliente_nombre, c.rut as cliente_rut, c.rubro as cliente_rubro, m.razon_social as mandante_nombre,
  (select nombre from public.perfiles where id = p.responsable_id) as responsable_nombre,
  coalesce(act.n_actividades, 0) as n_actividades, coalesce(act.n_actividades_completadas, 0) as n_actividades_completadas,
  coalesce(act.n_actividades_atrasadas, 0) as n_actividades_atrasadas,
  coalesce(act.avance_real, 0) as avance_real, act.avance_planificado,
  coalesce(hit.n_hitos, 0) as n_hitos, coalesce(hit.n_hitos_vencidos, 0) as n_hitos_vencidos, hit.proximo_hito_fecha,
  (select h.nombre from public.pi_hitos h where h.proyecto_id = p.id and h.estado = 'pendiente' and h.fecha_prevista = hit.proximo_hito_fecha order by h.nombre limit 1) as proximo_hito_nombre,
  coalesce(ent.n_entregables, 0) as n_entregables, coalesce(ent.n_entregables_pendientes, 0) as n_entregables_pendientes,
  coalesce(ent.n_entregables_vencidos, 0) as n_entregables_vencidos,
  coalesce(doc.n_documentos, 0) as n_documentos, coalesce(eq.n_equipo, 0) as n_equipo,
  case when p.fecha_termino_prevista is null then null else p.fecha_termino_prevista - public.pi_hoy() end as dias_restantes,
  (p.estado in ('por_iniciar','en_ejecucion','suspendido') and (
     (p.fecha_termino_prevista is not null and p.fecha_termino_prevista < public.pi_hoy())
     or (p.estado = 'por_iniciar' and p.fecha_inicio_prevista is not null and p.fecha_inicio_prevista < public.pi_hoy())
     or coalesce(act.n_actividades_atrasadas, 0) > 0 or coalesce(hit.n_hitos_vencidos, 0) > 0 or coalesce(ent.n_entregables_vencidos, 0) > 0
     or (act.avance_planificado is not null and act.avance_planificado - coalesce(act.avance_real, 0) > 10))) as atrasado,
  public.pi_rol_en(p.id) as mi_rol
from public.pi_proyectos p
left join public.pi_proyectos_economia e on e.proyecto_id = p.id   -- RLS: sin autorización, la fila no se ve (montos null)
join public.pi_clientes c on c.id = p.cliente_id
left join public.pi_clientes m on m.id = p.mandante_id
left join act on act.proyecto_id = p.id left join hit on hit.proyecto_id = p.id left join ent on ent.proyecto_id = p.id
left join doc on doc.proyecto_id = p.id left join eq on eq.proyecto_id = p.id;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RLS y permisos
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ declare t text; begin
  foreach t in array array['bfk_lineas_negocio','pi_correlativos','pi_clientes','pi_proyectos','pi_proyectos_economia','pi_equipo','pi_actividades','pi_hitos','pi_entregables','pi_documentos','pi_historial','pi_configuracion','pi_cuentas_respaldo'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['pi_proyectos_resumen','pi_actividades_vista'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
-- Las funciones SECURITY DEFINER del módulo corren como el dueño de las tablas (igual que en Cotizaciones):
-- el dueño no queda sujeto a RLS; los usuarios sí. El usuario de respaldo (pg_read_all_data + bypassrls) las lee.

grant select on public.bfk_lineas_negocio to authenticated;
create policy pi_leer on public.bfk_lineas_negocio for select to authenticated using (public.pi_es_usuario());

grant select, insert, update on public.pi_clientes to authenticated;
create policy pi_leer on public.pi_clientes for select to authenticated using (public.pi_es_usuario());
create policy pi_crear on public.pi_clientes for insert to authenticated with check (public.pi_es_usuario());
create policy pi_editar on public.pi_clientes for update to authenticated using (public.pi_es_admin() or creado_por = auth.uid()) with check (public.pi_es_usuario());

grant select, update on public.pi_proyectos to authenticated;           -- crear: solo con pi_crear_proyecto
create policy pi_leer on public.pi_proyectos for select to authenticated using (public.pi_puede_ver(id));
create policy pi_editar on public.pi_proyectos for update to authenticated
  using (public.pi_es_admin() or (public.pi_rol_en(id) = 'jefe' and estado not in ('cerrado','anulado'))) with check (public.pi_es_admin() or public.pi_rol_en(id) = 'jefe');

grant select, update on public.pi_proyectos_economia to authenticated;      -- se crea con el proyecto
create policy pi_leer on public.pi_proyectos_economia for select to authenticated using (public.pi_ve_economia(proyecto_id));
create policy pi_editar on public.pi_proyectos_economia for update to authenticated using (public.pi_edita_economia(proyecto_id)) with check (public.pi_edita_economia(proyecto_id));

grant select on public.pi_configuracion to authenticated;                   -- cambia solo con pi_configurar_documentos
create policy pi_leer on public.pi_configuracion for select to authenticated using (public.pi_es_usuario());
-- pi_cuentas_respaldo: sin acceso para usuarios.

grant select, insert, update on public.pi_equipo to authenticated;
create policy pi_leer on public.pi_equipo for select to authenticated using (public.pi_puede_ver(proyecto_id));
create policy pi_crear on public.pi_equipo for insert to authenticated with check (public.pi_es_jefe(proyecto_id));
create policy pi_editar on public.pi_equipo for update to authenticated using (public.pi_es_jefe(proyecto_id)) with check (public.pi_es_jefe(proyecto_id));

do $$ declare t text; begin
  foreach t in array array['pi_actividades','pi_hitos','pi_entregables'] loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy pi_leer on public.%I for select to authenticated using (public.pi_puede_ver(proyecto_id))', t);
    execute format('create policy pi_crear on public.%I for insert to authenticated with check (public.pi_puede_editar(proyecto_id))', t);
    execute format('create policy pi_editar on public.%I for update to authenticated using (public.pi_puede_editar(proyecto_id)) with check (public.pi_puede_editar(proyecto_id))', t);
    execute format('create policy pi_eliminar on public.%I for delete to authenticated using (public.pi_es_admin())', t);
  end loop;
end $$;

grant select, insert, update on public.pi_documentos to authenticated;
create policy pi_leer on public.pi_documentos for select to authenticated using (public.pi_puede_ver(proyecto_id));
create policy pi_crear on public.pi_documentos for insert to authenticated with check (public.pi_puede_editar(proyecto_id) and public.pi_documentos_habilitados());
create policy pi_editar on public.pi_documentos for update to authenticated using (public.pi_puede_editar(proyecto_id)) with check (public.pi_puede_editar(proyecto_id));

grant select on public.pi_historial to authenticated;
create policy pi_leer on public.pi_historial for select to authenticated
  using (public.pi_es_admin()
    or (proyecto_id is not null and public.pi_puede_ver(proyecto_id) and (tabla <> 'pi_proyectos_economia' or public.pi_ve_economia(proyecto_id)))
    or (proyecto_id is null and public.pi_es_usuario()));
-- pi_correlativos: sin acceso para usuarios (solo pi_siguiente_codigo).

-- Funciones: ninguna ejecutable por anónimos; solo las de consulta y las RPC para usuarios autenticados.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'pi\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    if f.proname in ('pi_crear_proyecto','pi_cambiar_estado','pi_configurar_documentos','pi_mi_rol','pi_es_admin','pi_es_usuario','pi_rol_en','pi_puede_ver','pi_puede_editar','pi_es_jefe',
                     'pi_ve_economia','pi_edita_economia','pi_documentos_habilitados','pi_es_lector_respaldo','pi_hoy','pi_existe_perfil','pi_uuid_seguro','pi_rut_normalizado') then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Depósito privado "pi-documentos" (Supabase Storage). Ruta: <proyecto_id>/<nombre único>.
-- Leer: quien puede ver el proyecto, y las cuentas de respaldo (solo lectura). Subir: quien puede editarlo y solo
-- si la carga de documentos está habilitada. Sin reemplazo ni eliminación de archivos por usuarios (no hay
-- políticas UPDATE/DELETE para este depósito). Las políticas nuevas son PERMISIVAS y están
-- limitadas a bucket_id = 'pi-documentos': no cambian el acceso a cz-productos, cz-eett ni a ningún otro depósito.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('storage.buckets') is null then raise notice 'PI|SIN_STORAGE|'; return; end if;
  if exists (select 1 from storage.buckets where id = 'pi-documentos' or name = 'pi-documentos') then
    raise exception 'PI: ya existe el depósito pi-documentos; no se aplicó nada'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'pi\_storage%') then
    raise exception 'PI: ya existe una política pi_storage_*; no se aplicó nada'; end if;
  insert into storage.buckets (id, name, public) values ('pi-documentos', 'pi-documentos', false);
  execute $p$create policy pi_storage_leer on storage.objects for select to authenticated
    using (bucket_id = 'pi-documentos' and public.pi_puede_ver(public.pi_uuid_seguro((storage.foldername(name))[1])))$p$;
  execute $p$create policy pi_storage_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'pi-documentos' and public.pi_documentos_habilitados() and public.pi_puede_editar(public.pi_uuid_seguro((storage.foldername(name))[1])))$p$;
  execute $p$create policy pi_storage_respaldo_leer on storage.objects for select to authenticated
    using (bucket_id = 'pi-documentos' and public.pi_es_lector_respaldo())$p$;
end $$;

-- Que PostgREST (API de Supabase) vea los objetos nuevos.
notify pgrst, 'reload schema';
commit;
