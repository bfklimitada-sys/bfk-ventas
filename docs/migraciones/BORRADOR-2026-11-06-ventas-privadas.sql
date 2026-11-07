-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Módulo VENTAS PRIVADAS + EETT de cotizaciones privadas (06/11/2026). NO APLICADO EN PRODUCCIÓN.
-- Requiere autorización expresa de Kevin. Ensayado solo en base desechable (docs/pruebas-ventas-privadas/).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-06-ventas-privadas.sql
-- Deshacer:                     BORRADOR-2026-11-06-ventas-privadas-deshacer.sql
--
-- QUÉ HACE: solo CREA objetos nuevos con prefijo vp_, un depósito privado «vp-documentos» y agrega la línea de negocio
-- 'VP' al catálogo bfk_lineas_negocio. NO modifica ninguna tabla, columna, fila, función, política ni disparador
-- existente: OCs de Mercado Público, eventos, cobros, gastos, comisiones, financiamiento/FIFO, IVA/F29, conciliación,
-- cotizaciones MP, contactos, perfiles y Proyectos Industriales quedan intactos.
--
-- REUTILIZA (solo lectura o inserción por funciones controladas, sin cambiar su estructura):
--   · pi_clientes ............ registro único de clientes (RUT único, razón social, giro, contacto, dirección, notas).
--                              Los datos propios de venta privada (persona/empresa, dirección de entrega, condiciones
--                              de pago) van en la tabla nueva vp_clientes_datos (1 a 1). Sus disparadores, auditoría y
--                              políticas existentes siguen aplicándose.
--   · pi_rut_normalizado() ... validación y formato del RUT (dígito verificador).
--   · productos_catalogo ..... biblioteca técnica compartida (nombre, marca, modelo, descripción). La información técnica
--                              ampliada para EETT va en la tabla nueva vp_productos_tecnicos (1 a 1).
--   · eventos_factura ........ solo lectura: un folio de factura ya usado en una OC de Mercado Público no se repite.
--   · gastos_indirectos ...... solo lectura: una compra ya registrada en Gastos se puede VINCULAR como costo real de una
--                              venta (sin duplicarla).
--
-- SEPARACIÓN DE CONCEPTOS (sin dobles conteos)
--   · Cotizado ≠ vendido: el monto de una cotización nunca se suma como ingreso; la venta es otro registro con su folio.
--   · OC del cliente (documento que el cliente emite a BFK) ≠ orden de venta interna (OV-AAAA-NNNN, registro de BFK).
--   · Cobrado = Σ pagos vigentes. Imputar un anticipo a una factura NO crea otro cobro (vp_pago_imputaciones).
--   · Facturas: registro de documentos emitidos en el SII; este módulo NO emite documentos tributarios.
--   · Costo estimado (de la cotización) ≠ costo real (compras registradas o gastos vinculados).
--
-- PERMISOS (en la base; la interfaz solo los refleja)
--   · Solo cuentas con perfil BFK leen o escriben. Anónimos: nada.
--   · Escrituras: solo por funciones vp_* (RPC). Las tablas no admiten INSERT/UPDATE/DELETE directo.
--   · Costos, márgenes, compras y sus documentos: solo el administrador y el responsable de la cotización/venta.
--   · Anular una venta: solo administrador. Anular pagos, facturas, entregas, OC, compras o documentos: administrador o
--     responsable. Configuración (datos de BFK, habilitar documentos): solo administrador.
--   · Toda creación, cambio de estado y anulación queda en vp_historial (usuario y fecha), inalterable.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $$ begin
  if to_regclass('public.perfiles') is null then raise exception 'VP: no existe public.perfiles; no se aplicó nada'; end if;
  if to_regclass('public.pi_clientes') is null or to_regprocedure('public.pi_rut_normalizado(text)') is null
     or to_regclass('public.bfk_lineas_negocio') is null then
    raise exception 'VP: requiere Proyectos Industriales instalado (pi_clientes, pi_rut_normalizado); no se aplicó nada'; end if;
  if to_regclass('public.productos_catalogo') is null then raise exception 'VP: requiere el módulo Cotizaciones (productos_catalogo); no se aplicó nada'; end if;
  if to_regclass('public.eventos_factura') is null or to_regclass('public.gastos_indirectos') is null then
    raise exception 'VP: faltan tablas de Mercado Público (eventos_factura, gastos_indirectos); no se aplicó nada'; end if;
  if exists (select 1 from pg_class where relnamespace = 'public'::regnamespace and relname like 'vp\_%')
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'vp\_%')
     or exists (select 1 from public.bfk_lineas_negocio where codigo = 'VP') then
    raise exception 'VP: el módulo (o un objeto vp_) ya existe; no se aplicó nada'; end if;
end $$;

insert into public.bfk_lineas_negocio (codigo, nombre, descripcion)
values ('VP', 'Ventas privadas', 'Ventas de productos y servicios fuera de Mercado Público (módulo vp_).');

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Sesión y permisos
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create function public.vp_hoy() returns date
language sql stable set search_path = public, pg_temp as $$ select (now() at time zone 'America/Santiago')::date $$;

create function public.vp_es_usuario() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.perfiles where id = auth.uid())
$$;
create function public.vp_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select rol = 'admin' from public.perfiles where id = auth.uid()), false)
$$;
create function public.vp_nombre(p uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$ select nombre from public.perfiles where id = p $$;

create function public.vp_exigir_usuario() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin if not public.vp_es_usuario() then raise exception 'VP_PERFIL: usuario sin perfil BFK' using errcode = '42501'; end if; end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Correlativos (folios únicos bajo concurrencia; si la transacción se revierte, el número también)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_correlativos (
  tipo text not null check (tipo in ('CP','OV','ET')),   -- CP cotización privada · OV orden de venta · ET especificaciones técnicas
  anio integer not null check (anio between 2000 and 2999),
  ultimo integer not null check (ultimo > 0),
  primary key (tipo, anio)
);
create function public.vp_siguiente_folio(p_tipo text) returns text
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare a int := extract(year from public.vp_hoy())::int; n int;
begin
  insert into public.vp_correlativos (tipo, anio, ultimo) values (p_tipo, a, 1)
  on conflict (tipo, anio) do update set ultimo = public.vp_correlativos.ultimo + 1
  returning ultimo into n;
  return p_tipo || '-' || a || '-' || lpad(n::text, 4, '0');
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Configuración: datos de BFK para los documentos y el interruptor de carga de archivos
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_configuracion (
  clave text primary key check (clave in ('empresa', 'documentos_habilitados')),
  valor jsonb not null,
  motivo text check (motivo is null or length(motivo) <= 500),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);
-- Datos de BFK tomados de fuentes ya existentes (no inventados): RUT de la app (api/oc.mjs, FichaOC), correo, teléfonos
-- y ciudad del pie de las EETT (lib/eettPdf.js), dirección y lema del formato de cotización de BFK
-- («Formato Cotización CORREO.xlsx», nov-2026) y razón social de la empresa. El giro tributario no está registrado en
-- ninguna fuente: queda vacío (no se imprime) hasta que un administrador lo complete.
insert into public.vp_configuracion (clave, valor, motivo) values
  ('empresa', jsonb_build_object(
     'razon_social', 'Ingeniería y Servicios BFK Limitada',
     'nombre_corto', 'BFK Ltda.',
     'rut', '77.322.317-3',
     'giro', null,
     'lema', 'Servicios Integrales, Compra y Venta e Ingeniería',
     'direccion', 'Villa Celulosa Pasaje 2 #733',
     'comuna', 'Laja',
     'correo', 'bfklimitada@gmail.com',
     'telefonos', '+56 9 5732 2538 / +56 9 9714 1822'),
   'Valores iniciales desde fuentes existentes de BFK (ver comentario de la migración)'),
  ('documentos_habilitados', 'false'::jsonb, 'Deshabilitado al instalar: habilitar cuando el respaldo diario incluya el depósito vp-documentos');

create function public.vp_documentos_habilitados() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor = 'true'::jsonb from public.vp_configuracion where clave = 'documentos_habilitados'), false)
$$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Clientes: datos propios de venta privada (el registro base es pi_clientes)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_clientes_datos (
  cliente_id uuid primary key references public.pi_clientes(id),
  tipo_persona text not null default 'empresa' check (tipo_persona in ('empresa','persona')),
  direccion_entrega text check (direccion_entrega is null or length(direccion_entrega) <= 300),
  comuna_entrega text check (comuna_entrega is null or length(comuna_entrega) <= 100),
  condiciones_pago text check (condiciones_pago is null or length(condiciones_pago) <= 500),
  plazo_pago_dias integer check (plazo_pago_dias is null or plazo_pago_dias between 0 and 365),
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Cotizaciones privadas (cabecera + revisiones + líneas + costos internos)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_cotizaciones (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique check (folio ~ '^CP-[0-9]{4}-[0-9]{4,}$'),
  linea_negocio text not null default 'VP' references public.bfk_lineas_negocio(codigo) check (linea_negocio = 'VP'),
  cliente_id uuid not null references public.pi_clientes(id),
  responsable_id uuid not null,
  origen_id uuid references public.vp_cotizaciones(id),       -- cotización duplicada desde
  revision_actual integer not null default 0 check (revision_actual >= 0),
  estado text not null default 'borrador' check (estado in ('borrador','enviada','aceptada','rechazada','vencida')),
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);
create index vp_cotizaciones_cliente on public.vp_cotizaciones (cliente_id);
create index vp_cotizaciones_estado on public.vp_cotizaciones (estado);

create table public.vp_cotizacion_revisiones (
  id uuid primary key default gen_random_uuid(),
  cotizacion_id uuid not null references public.vp_cotizaciones(id),
  numero integer not null check (numero >= 0),
  estado text not null default 'borrador' check (estado in ('borrador','enviada','aceptada','rechazada','vencida','reemplazada')),
  contacto_nombre text check (contacto_nombre is null or length(contacto_nombre) <= 150),
  contacto_correo text check (contacto_correo is null or contacto_correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  contacto_telefono text check (contacto_telefono is null or length(contacto_telefono) <= 40),
  fecha_emision date not null,
  vigencia_hasta date not null,
  plazo_entrega text check (plazo_entrega is null or length(plazo_entrega) <= 300),
  direccion_entrega text check (direccion_entrega is null or length(direccion_entrega) <= 300),
  condiciones_pago text check (condiciones_pago is null or length(condiciones_pago) <= 500),
  observaciones text check (observaciones is null or length(observaciones) <= 4000),
  condiciones_comerciales text check (condiciones_comerciales is null or length(condiciones_comerciales) <= 4000),
  afecta_iva boolean not null default true,
  tasa_iva numeric(6,4) not null default 0.19 check (tasa_iva >= 0 and tasa_iva < 1),
  -- Totales: los calcula la base (vp_recalcular_revision), en pesos enteros.
  bruto numeric(16,0) not null default 0, descuento numeric(16,0) not null default 0,
  neto numeric(16,0) not null default 0, iva numeric(16,0) not null default 0, total numeric(16,0) not null default 0,
  cliente jsonb,                    -- datos del cliente congelados al enviar
  documento jsonb,                  -- contenido del documento congelado al enviar (lo que recibió el cliente; sin costos)
  enviada_en date, envio_registrado_por uuid, envio_medio text, envio_destinatario text, envio_nota text,
  aceptada_en date, aceptacion_registrada_por uuid, aceptacion_referencia text, aceptacion_nota text,
  rechazada_en date, rechazo_motivo text,
  vencida_en date,
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  unique (cotizacion_id, numero),
  check (vigencia_hasta >= fecha_emision),
  check (total = neto + iva and neto = bruto - descuento),
  check (estado = 'borrador' or documento is not null),
  check (estado not in ('aceptada') or aceptada_en is not null),
  check (estado not in ('rechazada') or length(btrim(coalesce(rechazo_motivo, ''))) >= 3)
);

create table public.vp_cotizacion_items (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.vp_cotizacion_revisiones(id),
  orden integer not null check (orden > 0),
  tipo text not null default 'producto' check (tipo in ('producto','servicio')),
  producto_id uuid references public.productos_catalogo(id),
  codigo text check (codigo is null or length(codigo) <= 60),
  descripcion text not null check (length(btrim(descripcion)) between 1 and 2000),
  unidad text not null default 'UN' check (length(btrim(unidad)) between 1 and 20),
  cantidad numeric(14,3) not null check (cantidad > 0 and cantidad <= 1000000000),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0 and precio_unitario <= 100000000000),
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  bruto numeric(16,0) generated always as (round(cantidad * precio_unitario)) stored,
  subtotal_neto numeric(16,0) generated always as (round(cantidad * precio_unitario * (100 - descuento_pct) / 100)) stored,
  unique (revision_id, orden)
);
create index vp_cotizacion_items_rev on public.vp_cotizacion_items (revision_id);

create table public.vp_cotizacion_item_costos (
  item_id uuid primary key references public.vp_cotizacion_items(id) on delete cascade,
  costo_unitario numeric(14,2) not null check (costo_unitario >= 0 and costo_unitario <= 100000000000),
  nota text check (nota is null or length(nota) <= 500)
);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Órdenes de venta internas, OC del cliente, entregas, facturas, pagos y compras
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_ventas (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique check (folio ~ '^OV-[0-9]{4}-[0-9]{4,}$'),
  linea_negocio text not null default 'VP' references public.bfk_lineas_negocio(codigo) check (linea_negocio = 'VP'),
  origen text not null check (origen in ('cotizacion','directa')),
  cotizacion_id uuid references public.vp_cotizaciones(id),
  revision_id uuid references public.vp_cotizacion_revisiones(id),
  eett_id uuid,                                   -- EETT emitida vigente al convertir (FK agregada más abajo)
  cliente_id uuid not null references public.pi_clientes(id),
  cliente jsonb not null,                         -- datos del cliente congelados al crear la venta
  responsable_id uuid not null,
  fecha date not null,
  contacto_nombre text, contacto_correo text, contacto_telefono text,
  plazo_entrega text check (plazo_entrega is null or length(plazo_entrega) <= 300),
  fecha_entrega_comprometida date,
  direccion_entrega text check (direccion_entrega is null or length(direccion_entrega) <= 300),
  condiciones_pago text check (condiciones_pago is null or length(condiciones_pago) <= 500),
  plazo_pago_dias integer not null default 30 check (plazo_pago_dias between 0 and 365),
  observaciones text check (observaciones is null or length(observaciones) <= 4000),
  condiciones_comerciales text check (condiciones_comerciales is null or length(condiciones_comerciales) <= 4000),
  afecta_iva boolean not null default true,
  tasa_iva numeric(6,4) not null default 0.19 check (tasa_iva >= 0 and tasa_iva < 1),
  bruto numeric(16,0) not null default 0, descuento numeric(16,0) not null default 0,
  neto numeric(16,0) not null default 0, iva numeric(16,0) not null default 0, total numeric(16,0) not null default 0,
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  clave_idempotencia uuid not null unique,        -- un reintento con la misma clave devuelve la misma venta
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  check ((origen = 'cotizacion') = (cotizacion_id is not null and revision_id is not null)),
  check (total = neto + iva and neto = bruto - descuento),
  check (estado <> 'anulada' or (anulada_en is not null and length(btrim(coalesce(anulacion_motivo, ''))) >= 3))
);
-- Una sola venta vigente por cotización (doble clic, reintento o dos usuarios a la vez no crean duplicados).
create unique index vp_ventas_una_por_cotizacion on public.vp_ventas (cotizacion_id) where estado = 'vigente' and cotizacion_id is not null;
create index vp_ventas_cliente on public.vp_ventas (cliente_id);

create table public.vp_venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  orden integer not null check (orden > 0),
  item_cotizacion_id uuid references public.vp_cotizacion_items(id),
  tipo text not null default 'producto' check (tipo in ('producto','servicio')),
  producto_id uuid references public.productos_catalogo(id),
  codigo text, descripcion text not null check (length(btrim(descripcion)) between 1 and 2000),
  unidad text not null check (length(btrim(unidad)) between 1 and 20),
  cantidad numeric(14,3) not null check (cantidad > 0 and cantidad <= 1000000000),
  precio_unitario numeric(14,2) not null check (precio_unitario >= 0 and precio_unitario <= 100000000000),
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct >= 0 and descuento_pct <= 100),
  bruto numeric(16,0) generated always as (round(cantidad * precio_unitario)) stored,
  subtotal_neto numeric(16,0) generated always as (round(cantidad * precio_unitario * (100 - descuento_pct) / 100)) stored,
  unique (venta_id, orden)
);
create table public.vp_venta_item_costos (
  item_id uuid primary key references public.vp_venta_items(id),
  costo_unitario_estimado numeric(14,2) not null check (costo_unitario_estimado >= 0)
);

create table public.vp_documentos (
  id uuid primary key default gen_random_uuid(),
  ambito text not null check (ambito in ('venta','cotizacion','producto')),
  venta_id uuid references public.vp_ventas(id),
  cotizacion_id uuid references public.vp_cotizaciones(id),
  producto_id uuid references public.productos_catalogo(id),
  categoria text not null check (categoria in ('oc_cliente','factura','guia_despacho','comprobante_entrega','comprobante_pago','compra',
                                                'aceptacion','eett_anexo','ficha_tecnica','manual','foto','certificado','otro')),
  titulo text not null check (length(btrim(titulo)) between 2 and 200),
  nombre_archivo text not null check (length(nombre_archivo) between 1 and 200),
  ruta text not null unique check (ruta ~ '^(venta|cotizacion|producto)/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}-[^/]{1,200}$'),
  tipo_mime text check (tipo_mime is null or length(tipo_mime) <= 120),
  tamano bigint not null check (tamano > 0 and tamano <= 26214400),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  estado text not null default 'vigente' check (estado in ('vigente','anulado')),
  anulado_en timestamptz, anulado_por uuid, anulacion_motivo text,
  subido_por uuid not null default auth.uid(), subido_en timestamptz not null default now(),
  check ((ambito = 'venta') = (venta_id is not null) and (ambito = 'cotizacion') = (cotizacion_id is not null) and (ambito = 'producto') = (producto_id is not null)),
  check (split_part(ruta, '/', 1) = ambito and split_part(ruta, '/', 3) = categoria
         and split_part(ruta, '/', 2) = coalesce(venta_id, cotizacion_id, producto_id)::text)
);
create index vp_documentos_venta on public.vp_documentos (venta_id) where venta_id is not null;
create index vp_documentos_cot on public.vp_documentos (cotizacion_id) where cotizacion_id is not null;
create index vp_documentos_prod on public.vp_documentos (producto_id) where producto_id is not null;

create table public.vp_oc_cliente (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  cliente_id uuid not null references public.pi_clientes(id),
  numero text not null check (length(btrim(numero)) between 1 and 60),
  numero_clave text generated always as (upper(regexp_replace(numero, '\s', '', 'g'))) stored,
  fecha date not null,
  monto numeric(16,0) check (monto is null or monto >= 0),
  documento_id uuid references public.vp_documentos(id),
  observacion text check (observacion is null or length(observacion) <= 1000),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now()
);
create unique index vp_oc_cliente_unica on public.vp_oc_cliente (cliente_id, numero_clave) where estado = 'vigente';

create table public.vp_entregas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  numero integer not null check (numero > 0),
  tipo text not null check (tipo in ('despacho','servicio')),
  fecha date not null,
  guia_numero text check (guia_numero is null or length(guia_numero) <= 60),
  recibido_por text check (recibido_por is null or length(recibido_por) <= 150),
  observacion text check (observacion is null or length(observacion) <= 1000),
  documento_id uuid references public.vp_documentos(id),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  unique (venta_id, numero)
);
create table public.vp_entrega_items (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null references public.vp_entregas(id),
  venta_item_id uuid not null references public.vp_venta_items(id),
  cantidad numeric(14,3) not null check (cantidad > 0),
  unique (entrega_id, venta_item_id)
);

create table public.vp_facturas (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  tipo_documento text not null check (tipo_documento in ('factura_afecta','factura_exenta','boleta','otro')),
  numero text not null check (length(btrim(numero)) between 1 and 30),
  numero_clave text generated always as (upper(regexp_replace(numero, '\s', '', 'g'))) stored,
  fecha date not null,
  neto numeric(16,0) not null check (neto >= 0),
  iva numeric(16,0) not null check (iva >= 0),
  total numeric(16,0) not null check (total > 0),
  documento_id uuid references public.vp_documentos(id),
  observacion text check (observacion is null or length(observacion) <= 1000),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  check (total = neto + iva)
);
create unique index vp_facturas_folio_unico on public.vp_facturas (tipo_documento, numero_clave) where estado = 'vigente';

create table public.vp_pagos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  tipo text not null check (tipo in ('anticipo','abono')),
  fecha date not null,
  monto numeric(16,0) not null check (monto > 0),
  medio text not null check (medio in ('transferencia','deposito','efectivo','cheque','vale_vista','tarjeta','otro')),
  referencia text check (referencia is null or length(referencia) <= 120),
  documento_id uuid references public.vp_documentos(id),
  observacion text check (observacion is null or length(observacion) <= 1000),
  estado text not null default 'vigente' check (estado in ('vigente','anulado')),
  anulado_en timestamptz, anulado_por uuid, anulacion_motivo text,
  clave_idempotencia uuid not null unique,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now()
);
-- Aplicación de un pago (p. ej. un anticipo) a una factura: NO es otro cobro.
create table public.vp_pago_imputaciones (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references public.vp_pagos(id),
  factura_id uuid not null references public.vp_facturas(id),
  monto numeric(16,0) not null check (monto > 0),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now()
);
create unique index vp_imputacion_unica on public.vp_pago_imputaciones (pago_id, factura_id) where estado = 'vigente';

-- Costos reales: compras registradas aquí o gastos ya registrados en Gastos (vinculados, no copiados).
create table public.vp_compras (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.vp_ventas(id),
  venta_item_id uuid references public.vp_venta_items(id),
  origen text not null check (origen in ('registro','gasto_existente')),
  gasto_id text,                                  -- gastos_indirectos.id cuando origen = gasto_existente
  proveedor text check (proveedor is null or length(proveedor) <= 200),
  fecha date not null,
  documento_tipo text check (documento_tipo is null or documento_tipo in ('factura','boleta','guia','otro')),
  documento_numero text check (documento_numero is null or length(documento_numero) <= 40),
  neto numeric(16,0) not null check (neto >= 0),
  iva numeric(16,0) not null default 0 check (iva >= 0),
  total numeric(16,0) not null check (total >= 0),
  iva_recuperable boolean not null default true,
  descripcion text check (descripcion is null or length(descripcion) <= 1000),
  documento_id uuid references public.vp_documentos(id),
  estado text not null default 'vigente' check (estado in ('vigente','anulada')),
  anulada_en timestamptz, anulada_por uuid, anulacion_motivo text,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  check (total = neto + iva),
  check ((origen = 'gasto_existente') = (gasto_id is not null))
);
create unique index vp_compras_gasto_unico on public.vp_compras (gasto_id) where estado = 'vigente' and gasto_id is not null;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Información técnica de productos (extiende productos_catalogo) y EETT
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_productos_tecnicos (
  producto_id uuid primary key references public.productos_catalogo(id),
  codigo text check (codigo is null or length(codigo) <= 60),
  tipo_producto text not null default 'otro' check (tipo_producto in ('equipo','material','herramienta','repuesto','insumo','servicio','otro')),
  -- [{caracteristica, valor, unidad?, grupo?, origen:{tipo:'archivo'|'enlace'|'manual', documento_id?, pagina?, enlace?}}]
  caracteristicas jsonb not null default '[]'::jsonb check (jsonb_typeof(caracteristicas) = 'array'),
  condiciones_operacion text check (condiciones_operacion is null or length(condiciones_operacion) <= 4000),
  condiciones_instalacion text check (condiciones_instalacion is null or length(condiciones_instalacion) <= 4000),
  accesorios jsonb not null default '[]'::jsonb check (jsonb_typeof(accesorios) = 'array'),       -- [texto]
  exclusiones jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusiones) = 'array'),     -- [texto]
  garantia text check (garantia is null or length(garantia) <= 1000),
  normas jsonb not null default '[]'::jsonb check (jsonb_typeof(normas) = 'array'),               -- [{norma, respaldo_documento_id?, respaldo_pagina?, respaldo_texto?}]
  fuente_tipo text not null default 'manual' check (fuente_tipo in ('archivo','enlace','manual')),
  fuente_detalle text check (fuente_detalle is null or length(fuente_detalle) <= 500),
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now()
);

-- Propuestas de extracción desde una ficha técnica: quedan PENDIENTES hasta que una persona las revisa.
create table public.vp_extracciones (
  id uuid primary key default gen_random_uuid(),
  producto_id uuid not null references public.productos_catalogo(id),
  documento_id uuid not null references public.vp_documentos(id),
  metodo text not null check (metodo in ('texto_pdf','ocr','ia')),
  propuesta jsonb not null check (jsonb_typeof(propuesta) = 'array'),   -- [{caracteristica, valor, unidad?, pagina?, texto_origen?}]
  estado text not null default 'pendiente' check (estado in ('pendiente','revisada','descartada')),
  aceptadas integer, revisada_por uuid, revisada_en timestamptz,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now()
);

create table public.vp_eett (
  id uuid primary key default gen_random_uuid(),
  folio text not null check (folio ~ '^ET-[0-9]{4}-[0-9]{4,}$'),
  revision integer not null default 0 check (revision >= 0),
  cotizacion_id uuid not null references public.vp_cotizaciones(id),
  cotizacion_revision_id uuid not null references public.vp_cotizacion_revisiones(id),
  estado text not null default 'borrador' check (estado in ('borrador','emitida','reemplazada')),
  contenido jsonb not null check (jsonb_typeof(contenido) = 'object'),
  hash text check (hash is null or hash ~ '^[0-9a-f]{64}$'),
  emitida_en timestamptz, emitida_por uuid,
  version integer not null default 1,
  creado_por uuid not null default auth.uid(), creado_en timestamptz not null default now(),
  actualizado_por uuid, actualizado_en timestamptz not null default now(),
  unique (folio, revision),
  check (estado = 'borrador' or (hash is not null and emitida_en is not null))
);
create unique index vp_eett_un_borrador on public.vp_eett (cotizacion_id) where estado = 'borrador';
alter table public.vp_ventas add constraint vp_ventas_eett_fk foreign key (eett_id) references public.vp_eett(id);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Historial inalterable
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create table public.vp_historial (
  id bigint generated always as identity primary key,
  tabla text not null, registro_id text not null,
  cotizacion_id uuid, venta_id uuid,
  accion text not null check (accion in ('crear','modificar','eliminar')),
  cambios jsonb not null,
  sensible boolean not null default false,         -- costos y compras: solo administrador y responsable
  usuario_id uuid, usuario_nombre text,
  fecha timestamptz not null default now()
);
create index vp_historial_cot on public.vp_historial (cotizacion_id, fecha desc);
create index vp_historial_venta on public.vp_historial (venta_id, fecha desc);

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Permisos sobre registros
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create function public.vp_es_responsable_cot(p_cot uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.vp_es_usuario() and (public.vp_es_admin()
    or exists (select 1 from public.vp_cotizaciones c where c.id = p_cot and (c.responsable_id = auth.uid() or c.creado_por = auth.uid())))
$$;
create function public.vp_es_responsable_venta(p_venta uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.vp_es_usuario() and (public.vp_es_admin()
    or exists (select 1 from public.vp_ventas v where v.id = p_venta and (v.responsable_id = auth.uid() or v.creado_por = auth.uid())))
$$;
-- Costos de una línea de cotización (por su revisión).
create function public.vp_ve_costos_item_cot(p_item uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.vp_es_responsable_cot((select r.cotizacion_id from public.vp_cotizacion_items i join public.vp_cotizacion_revisiones r on r.id = i.revision_id where i.id = p_item))
$$;
create function public.vp_ve_costos_item_venta(p_item uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.vp_es_responsable_venta((select venta_id from public.vp_venta_items where id = p_item))
$$;
-- Ruta de un archivo en el depósito: <ambito>/<id>/<categoria>/<uuid>-<nombre>.
create function public.vp_puede_leer_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare amb text := split_part(p_ruta, '/', 1); cat text := split_part(p_ruta, '/', 3); i uuid;
begin
  if not public.vp_es_usuario() then return false; end if;
  begin i := split_part(p_ruta, '/', 2)::uuid; exception when others then return false; end;
  if cat = 'compra' then return amb = 'venta' and public.vp_es_responsable_venta(i); end if;
  return amb in ('venta','cotizacion','producto');
end $$;
create function public.vp_puede_subir_ruta(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare amb text := split_part(p_ruta, '/', 1); cat text := split_part(p_ruta, '/', 3); i uuid;
begin
  if not public.vp_es_usuario() or not public.vp_documentos_habilitados() then return false; end if;
  if p_ruta !~ '^(venta|cotizacion|producto)/[0-9a-f-]{36}/[a-z_]+/[0-9a-f-]{36}-[^/]{1,200}$' then return false; end if;
  begin i := split_part(p_ruta, '/', 2)::uuid; exception when others then return false; end;
  if cat = 'compra' then return amb = 'venta' and public.vp_es_responsable_venta(i); end if;
  return case amb when 'venta' then exists (select 1 from public.vp_ventas where id = i)
                  when 'cotizacion' then exists (select 1 from public.vp_cotizaciones where id = i)
                  when 'producto' then exists (select 1 from public.productos_catalogo where id = i) else false end;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Disparadores: sello de versión, protección de revisiones enviadas, EETT emitidas e historial
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create function public.vp_sellar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.creado_por := old.creado_por; new.creado_en := old.creado_en;
  else
    new.version := 1; new.creado_por := coalesce(auth.uid(), new.creado_por); new.creado_en := now();
  end if;
  new.actualizado_por := auth.uid(); new.actualizado_en := now();
  return new;
end $$;

-- Una revisión enviada (o posterior) conserva su contenido comercial: los cambios van en una revisión nueva.
create function public.vp_proteger_revision() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare campos text[] := array['cotizacion_id','numero','contacto_nombre','contacto_correo','contacto_telefono','fecha_emision','vigencia_hasta',
  'plazo_entrega','direccion_entrega','condiciones_pago','observaciones','condiciones_comerciales','afecta_iva','tasa_iva','bruto','descuento','neto','iva','total','cliente','documento'];
  k text;
begin
  if old.estado <> 'borrador' then
    foreach k in array campos loop
      if to_jsonb(new)->k is distinct from to_jsonb(old)->k then
        raise exception 'VP_REVISION: la revisión R% ya fue enviada; su contenido no se modifica (crea una revisión nueva)', old.numero using errcode = '42501';
      end if;
    end loop;
  end if;
  return new;
end $$;
create function public.vp_proteger_lineas() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare rev uuid; est text;
begin
  if tg_table_name = 'vp_cotizacion_item_costos' then
    select i.revision_id into rev from public.vp_cotizacion_items i where i.id = coalesce(new.item_id, old.item_id);
  else rev := coalesce(new.revision_id, old.revision_id); end if;
  select estado into est from public.vp_cotizacion_revisiones where id = rev;
  if est is distinct from 'borrador' and est is not null then
    raise exception 'VP_REVISION: la revisión ya fue enviada; sus líneas y costos no se modifican' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create function public.vp_proteger_eett() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'VP_EETT: una EETT emitida no se elimina' using errcode = '42501'; end if;
    return old;
  end if;
  if old.estado <> 'borrador' and (new.contenido is distinct from old.contenido or new.hash is distinct from old.hash or new.folio <> old.folio
      or new.revision <> old.revision or new.cotizacion_revision_id <> old.cotizacion_revision_id or new.emitida_en is distinct from old.emitida_en
      or not (new.estado = old.estado or (old.estado = 'emitida' and new.estado = 'reemplazada'))) then
    raise exception 'VP_EETT: una EETT emitida no se modifica (genera una revisión nueva)' using errcode = '42501';
  end if;
  return new;
end $$;
-- Ventas, entregas, facturas, pagos, OC, compras e imputaciones no se eliminan: se anulan (con motivo).
create function public.vp_sin_borrado() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'VP: los registros de %s no se eliminan; se anulan con motivo', tg_table_name using errcode = '42501'; end $$;

create function public.vp_historial_inalterable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin raise exception 'VP_HISTORIAL: el historial no se modifica ni se elimina' using errcode = '42501'; end $$;

create function public.vp_auditar() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb; n jsonb; dif jsonb := '{}'::jsonb; k text; r jsonb; v_cot uuid; v_venta uuid; v_reg text;
  omitir text[] := array['version','actualizado_por','actualizado_en','numero_clave','bruto_generado'];
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old) - omitir; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - omitir; end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if n->k is distinct from o->k then dif := dif || jsonb_build_object(k, jsonb_build_object('antes', o->k, 'despues', n->k)); end if;
    end loop;
    if dif = '{}'::jsonb then return null; end if;
  elsif tg_op = 'INSERT' then dif := n; else dif := o; end if;
  r := coalesce(n, o);
  v_reg := coalesce(r->>'id', r->>'item_id', r->>'producto_id', r->>'cliente_id', r->>'clave');
  -- Contexto (cotización / venta) para filtrar el historial en cada ficha.
  case tg_table_name
    when 'vp_cotizaciones' then v_cot := (r->>'id')::uuid;
    when 'vp_cotizacion_revisiones' then v_cot := (r->>'cotizacion_id')::uuid;
    when 'vp_eett' then v_cot := (r->>'cotizacion_id')::uuid;
    when 'vp_cotizacion_items' then select cotizacion_id into v_cot from public.vp_cotizacion_revisiones where id = (r->>'revision_id')::uuid;
    when 'vp_cotizacion_item_costos' then select rv.cotizacion_id into v_cot from public.vp_cotizacion_items i join public.vp_cotizacion_revisiones rv on rv.id = i.revision_id where i.id = (r->>'item_id')::uuid;
    when 'vp_ventas' then v_venta := (r->>'id')::uuid; v_cot := (r->>'cotizacion_id')::uuid;
    when 'vp_venta_item_costos' then select venta_id into v_venta from public.vp_venta_items where id = (r->>'item_id')::uuid;
    when 'vp_entrega_items' then select venta_id into v_venta from public.vp_entregas where id = (r->>'entrega_id')::uuid;
    when 'vp_pago_imputaciones' then select venta_id into v_venta from public.vp_pagos where id = (r->>'pago_id')::uuid;
    when 'vp_documentos' then v_venta := (r->>'venta_id')::uuid; v_cot := (r->>'cotizacion_id')::uuid;
    else if r ? 'venta_id' then v_venta := (r->>'venta_id')::uuid; end if;
  end case;
  insert into public.vp_historial (tabla, registro_id, cotizacion_id, venta_id, accion, cambios, sensible, usuario_id, usuario_nombre)
  values (tg_table_name, coalesce(v_reg, '?'), v_cot, v_venta, case tg_op when 'INSERT' then 'crear' when 'UPDATE' then 'modificar' else 'eliminar' end,
          dif, tg_table_name in ('vp_cotizacion_item_costos','vp_venta_item_costos','vp_compras') or (tg_table_name = 'vp_documentos' and r->>'categoria' = 'compra'),
          auth.uid(), public.vp_nombre(auth.uid()));
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['vp_clientes_datos','vp_cotizaciones','vp_cotizacion_revisiones','vp_ventas','vp_productos_tecnicos','vp_eett'] loop
    execute format('create trigger vp_90_sellar before insert or update on public.%I for each row execute function public.vp_sellar()', t);
  end loop;
  foreach t in array array['vp_clientes_datos','vp_cotizaciones','vp_cotizacion_revisiones','vp_cotizacion_items','vp_cotizacion_item_costos','vp_ventas',
      'vp_venta_items','vp_venta_item_costos','vp_documentos','vp_oc_cliente','vp_entregas','vp_entrega_items','vp_facturas','vp_pagos','vp_pago_imputaciones',
      'vp_compras','vp_productos_tecnicos','vp_extracciones','vp_eett','vp_configuracion'] loop
    execute format('create trigger vp_99_auditar after insert or update or delete on public.%I for each row execute function public.vp_auditar()', t);
  end loop;
  foreach t in array array['vp_cotizaciones','vp_cotizacion_revisiones','vp_ventas','vp_venta_items','vp_venta_item_costos','vp_documentos','vp_oc_cliente',
      'vp_entregas','vp_entrega_items','vp_facturas','vp_pagos','vp_pago_imputaciones','vp_compras','vp_extracciones','vp_clientes_datos','vp_productos_tecnicos'] loop
    execute format('create trigger vp_05_sin_borrado before delete on public.%I for each row execute function public.vp_sin_borrado()', t);
  end loop;
end $$;
create trigger vp_10_proteger before update on public.vp_cotizacion_revisiones for each row execute function public.vp_proteger_revision();
create trigger vp_10_proteger before insert or update or delete on public.vp_cotizacion_items for each row execute function public.vp_proteger_lineas();
create trigger vp_10_proteger before insert or update or delete on public.vp_cotizacion_item_costos for each row execute function public.vp_proteger_lineas();
create trigger vp_10_proteger before update or delete on public.vp_eett for each row execute function public.vp_proteger_eett();
create trigger vp_10_inalterable before update or delete on public.vp_historial for each row execute function public.vp_historial_inalterable();
create trigger vp_10_inalterable_t before truncate on public.vp_historial for each statement execute function public.vp_historial_inalterable();

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Cálculos únicos (pesos enteros). La interfaz usa la misma fórmula (src/lib/ventasPrivadas.js) solo para mostrar.
--   línea:   bruto = round(cantidad × precio) · neto = round(cantidad × precio × (100 − descuento%) / 100)
--   total:   neto = Σ neto de líneas · IVA = round(neto × tasa) si es afecta (0 si exenta) · total = neto + IVA
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create function public.vp_recalcular_revision(p_rev uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b numeric; n numeric; r public.vp_cotizacion_revisiones%rowtype;
begin
  select * into r from public.vp_cotizacion_revisiones where id = p_rev;
  select coalesce(sum(bruto), 0), coalesce(sum(subtotal_neto), 0) into b, n from public.vp_cotizacion_items where revision_id = p_rev;
  update public.vp_cotizacion_revisiones set bruto = b, descuento = b - n, neto = n,
    iva = case when r.afecta_iva then round(n * r.tasa_iva) else 0 end,
    total = n + case when r.afecta_iva then round(n * r.tasa_iva) else 0 end
  where id = p_rev;
end $$;
create function public.vp_recalcular_venta(p_venta uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare b numeric; n numeric; v public.vp_ventas%rowtype;
begin
  select * into v from public.vp_ventas where id = p_venta;
  select coalesce(sum(bruto), 0), coalesce(sum(subtotal_neto), 0) into b, n from public.vp_venta_items where venta_id = p_venta;
  update public.vp_ventas set bruto = b, descuento = b - n, neto = n,
    iva = case when v.afecta_iva then round(n * v.tasa_iva) else 0 end,
    total = n + case when v.afecta_iva then round(n * v.tasa_iva) else 0 end
  where id = p_venta;
end $$;

-- Texto opcional: '' → null, recortado y con largo máximo.
create function public.vp_txt(p text, p_max int default 4000) returns text
language sql immutable set search_path = public, pg_temp as $$ select nullif(left(btrim(coalesce(p, '')), p_max), '') $$;
-- Número del JSON (vacío → null). Error claro si no es un número.
create function public.vp_num(p jsonb, k text) returns numeric
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := btrim(coalesce(p->>k, ''));
begin
  if t = '' then return null; end if;
  return t::numeric;
exception when others then raise exception 'VP_DATO: «%» no es un número válido', k using errcode = '22023';
end $$;
create function public.vp_fecha(p jsonb, k text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
declare t text := btrim(coalesce(p->>k, ''));
begin
  if t = '' then return null; end if;
  return t::date;
exception when others then raise exception 'VP_DATO: «%» no es una fecha válida', k using errcode = '22023';
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Funciones (RPC): toda escritura pasa por aquí
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

-- Configuración (solo administrador). empresa: objeto con los datos impresos en los documentos.
create function public.vp_configurar(p_clave text, p_valor jsonb, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare k text;
begin
  if not public.vp_es_admin() then raise exception 'VP_PERMISO: solo un administrador cambia la configuración' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'VP_DATO: indica el motivo del cambio' using errcode = '23514'; end if;
  if p_clave = 'documentos_habilitados' then
    if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'VP_DATO: se espera verdadero o falso' using errcode = '22023'; end if;
  elsif p_clave = 'empresa' then
    if jsonb_typeof(p_valor) <> 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
    for k in select jsonb_object_keys(p_valor) loop
      if k not in ('razon_social','nombre_corto','rut','giro','lema','direccion','comuna','correo','telefonos','sitio_web') then
        raise exception 'VP_DATO: campo de empresa no permitido: %', k using errcode = '22023'; end if;
      if jsonb_typeof(p_valor->k) not in ('string','null') or length(coalesce(p_valor->>k, '')) > 300 then
        raise exception 'VP_DATO: valor inválido en %', k using errcode = '22023'; end if;
    end loop;
    if length(btrim(coalesce(p_valor->>'razon_social', ''))) < 3 then raise exception 'VP_DATO: falta la razón social' using errcode = '23514'; end if;
    perform public.pi_rut_normalizado(p_valor->>'rut');
  else raise exception 'VP_DATO: clave de configuración desconocida' using errcode = '22023'; end if;
  update public.vp_configuracion set valor = p_valor, motivo = btrim(p_motivo), actualizado_por = auth.uid(), actualizado_en = now() where clave = p_clave;
  return (select jsonb_object_agg(clave, valor) from public.vp_configuracion);
end $$;

-- Cliente: crea o actualiza el registro base (pi_clientes) y sus datos de venta privada. Sin duplicados por RUT.
-- p: {id?, rut, razon_social, tipo_persona, giro?, contacto_nombre?, contacto_correo?, contacto_telefono?, direccion?, comuna?, region?,
--     direccion_entrega?, comuna_entrega?, condiciones_pago?, plazo_pago_dias?, notas?, version_datos?}
create function public.vp_guardar_cliente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_rut text; v_clave text; ex public.pi_clientes%rowtype; d public.vp_clientes_datos%rowtype;
  v_tipo text := coalesce(nullif(p->>'tipo_persona', ''), 'empresa');
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  v_rut := public.pi_rut_normalizado(p->>'rut');
  if v_rut is null then raise exception 'VP_CLIENTE: el RUT es obligatorio' using errcode = '23514'; end if;
  v_clave := regexp_replace(v_rut, '[^0-9K]', '', 'g');
  if length(btrim(coalesce(p->>'razon_social', ''))) < 2 then raise exception 'VP_CLIENTE: falta el nombre o razón social' using errcode = '23514'; end if;
  if v_tipo not in ('empresa','persona') then raise exception 'VP_DATO: tipo de cliente inválido' using errcode = '22023'; end if;
  if public.vp_txt(p->>'contacto_correo', 200) is not null and public.vp_txt(p->>'contacto_correo', 200) !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VP_DATO: el correo de contacto no es válido' using errcode = '23514'; end if;
  if public.vp_num(p, 'plazo_pago_dias') is not null and public.vp_num(p, 'plazo_pago_dias') not between 0 and 365 then
    raise exception 'VP_DATO: el plazo de pago debe estar entre 0 y 365 días' using errcode = '23514'; end if;   -- el giro es opcional («cuando corresponda»)
  select * into ex from public.pi_clientes where rut_clave = v_clave;
  if v_id is null then
    if found then
      raise exception 'VP_DUPLICADO: ya existe un cliente con el RUT % (%). Úsalo en vez de crear otro.', v_rut, ex.razon_social
        using errcode = '23505', detail = ex.id::text;
    end if;
    insert into public.pi_clientes (rut, razon_social, giro, direccion, comuna, region, contacto_nombre, contacto_correo, contacto_telefono, notas)
    values (v_rut, btrim(p->>'razon_social'), public.vp_txt(p->>'giro', 300), public.vp_txt(p->>'direccion', 300), public.vp_txt(p->>'comuna', 100),
            public.vp_txt(p->>'region', 100), public.vp_txt(p->>'contacto_nombre', 150), public.vp_txt(p->>'contacto_correo', 200),
            public.vp_txt(p->>'contacto_telefono', 40), public.vp_txt(p->>'notas', 2000))
    returning id into v_id;
  else
    select * into ex from public.pi_clientes where id = v_id for update;
    if not found then raise exception 'VP_CLIENTE: cliente no encontrado' using errcode = 'P0002'; end if;
    if not public.vp_es_admin() and ex.creado_por is distinct from auth.uid() then
      raise exception 'VP_PERMISO: solo quien registró el cliente o un administrador lo modifica' using errcode = '42501'; end if;
    if exists (select 1 from public.pi_clientes where rut_clave = v_clave and id <> v_id) then
      raise exception 'VP_DUPLICADO: el RUT % ya pertenece a otro cliente', v_rut using errcode = '23505'; end if;
    if p ? 'version' and ex.version <> (p->>'version')::int then
      raise exception 'VP409: otra persona modificó este cliente; recarga antes de guardar' using errcode = '40001'; end if;
    update public.pi_clientes set rut = v_rut, razon_social = btrim(p->>'razon_social'), giro = public.vp_txt(p->>'giro', 300),
      direccion = public.vp_txt(p->>'direccion', 300), comuna = public.vp_txt(p->>'comuna', 100), region = public.vp_txt(p->>'region', 100),
      contacto_nombre = public.vp_txt(p->>'contacto_nombre', 150), contacto_correo = public.vp_txt(p->>'contacto_correo', 200),
      contacto_telefono = public.vp_txt(p->>'contacto_telefono', 40), notas = public.vp_txt(p->>'notas', 2000), activo = true
    where id = v_id;
  end if;
  select * into d from public.vp_clientes_datos where cliente_id = v_id for update;
  if not found then
    insert into public.vp_clientes_datos (cliente_id, tipo_persona, direccion_entrega, comuna_entrega, condiciones_pago, plazo_pago_dias)
    values (v_id, v_tipo, public.vp_txt(p->>'direccion_entrega', 300), public.vp_txt(p->>'comuna_entrega', 100),
            public.vp_txt(p->>'condiciones_pago', 500), public.vp_num(p, 'plazo_pago_dias')::int);
  else
    update public.vp_clientes_datos set tipo_persona = v_tipo, direccion_entrega = public.vp_txt(p->>'direccion_entrega', 300),
      comuna_entrega = public.vp_txt(p->>'comuna_entrega', 100), condiciones_pago = public.vp_txt(p->>'condiciones_pago', 500),
      plazo_pago_dias = public.vp_num(p, 'plazo_pago_dias')::int
    where cliente_id = v_id;
  end if;
  return jsonb_build_object('id', v_id, 'rut', v_rut);
end $$;

-- Datos del cliente congelados en documentos (cotización enviada, venta).
create function public.vp_foto_cliente(p_cliente uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', c.id, 'razon_social', c.razon_social, 'rut', c.rut, 'giro', c.giro, 'direccion', c.direccion, 'comuna', c.comuna,
    'region', c.region, 'tipo_persona', coalesce(d.tipo_persona, 'empresa'))
  from public.pi_clientes c left join public.vp_clientes_datos d on d.cliente_id = c.id where c.id = p_cliente
$$;

-- Líneas de la revisión borrador (reemplazo completo). items: [{tipo, producto_id?, codigo?, descripcion, unidad, cantidad, precio_unitario,
-- descuento_pct?, costo_unitario?, costo_nota?}]. Los costos solo se guardan si quien guarda puede verlos.
create function public.vp_reemplazar_lineas(p_rev uuid, p_items jsonb, p_con_costos boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare it jsonb; n int := 0; v_item uuid; costos_previos jsonb;
begin
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'VP_DATO: las líneas deben ser una lista' using errcode = '22023'; end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'VP_DATO: máximo 200 líneas por cotización' using errcode = '22023'; end if;
  -- Si quien guarda no ve costos, se conservan los costos existentes por posición (no se borran ni se exponen).
  select coalesce(jsonb_object_agg(i.orden::text, jsonb_build_object('c', k.costo_unitario, 'n', k.nota)), '{}'::jsonb) into costos_previos
  from public.vp_cotizacion_items i join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = p_rev;
  delete from public.vp_cotizacion_item_costos where item_id in (select id from public.vp_cotizacion_items where revision_id = p_rev);
  delete from public.vp_cotizacion_items where revision_id = p_rev;
  for it in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if public.vp_num(it, 'cantidad') is null or public.vp_num(it, 'cantidad') <= 0 then raise exception 'VP_DATO: línea %: la cantidad debe ser mayor que cero', n using errcode = '23514'; end if;
    if public.vp_num(it, 'precio_unitario') is null or public.vp_num(it, 'precio_unitario') < 0 then raise exception 'VP_DATO: línea %: precio unitario inválido', n using errcode = '23514'; end if;
    if coalesce(public.vp_num(it, 'descuento_pct'), 0) not between 0 and 100 then raise exception 'VP_DATO: línea %: el descuento debe estar entre 0 y 100%%', n using errcode = '23514'; end if;
    if public.vp_txt(it->>'descripcion') is null then raise exception 'VP_DATO: línea %: falta la descripción', n using errcode = '23514'; end if;
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (p_rev, n, coalesce(nullif(it->>'tipo', ''), 'producto'), nullif(it->>'producto_id', '')::uuid, public.vp_txt(it->>'codigo', 60),
            public.vp_txt(it->>'descripcion', 2000), coalesce(public.vp_txt(it->>'unidad', 20), 'UN'), public.vp_num(it, 'cantidad'),
            public.vp_num(it, 'precio_unitario'), coalesce(public.vp_num(it, 'descuento_pct'), 0))
    returning id into v_item;
    if p_con_costos then
      if public.vp_num(it, 'costo_unitario') is not null then
        if public.vp_num(it, 'costo_unitario') < 0 then raise exception 'VP_DATO: línea %: costo inválido', n using errcode = '23514'; end if;
        insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, public.vp_num(it, 'costo_unitario'), public.vp_txt(it->>'costo_nota', 500));
      end if;
    elsif costos_previos ? n::text then
      insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, (costos_previos->n::text->>'c')::numeric, costos_previos->n::text->>'n');
    end if;
  end loop;
  perform public.vp_recalcular_revision(p_rev);
end $$;

-- Cotización: crea (folio + revisión R0 borrador) o guarda la revisión borrador actual. Control de edición simultánea por versión.
-- p: {id?, version?, cliente_id, contacto_*, fecha_emision?, vigencia_hasta | vigencia_dias, plazo_entrega, direccion_entrega, condiciones_pago,
--     observaciones, condiciones_comerciales, afecta_iva, items:[…]}
create function public.vp_guardar_cotizacion(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype;
  v_folio text; v_emision date; v_vig date; v_cli uuid := nullif(p->>'cliente_id', '')::uuid;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  if v_cli is null or not exists (select 1 from public.pi_clientes where id = v_cli and activo) then
    raise exception 'VP_COTIZACION: selecciona un cliente registrado y activo' using errcode = '23503'; end if;
  v_emision := coalesce(public.vp_fecha(p, 'fecha_emision'), public.vp_hoy());
  v_vig := coalesce(public.vp_fecha(p, 'vigencia_hasta'), v_emision + coalesce(public.vp_num(p, 'vigencia_dias'), 15)::int);
  if v_vig < v_emision then raise exception 'VP_COTIZACION: la vigencia no puede ser anterior a la emisión' using errcode = '23514'; end if;
  if v_id is null then
    v_folio := public.vp_siguiente_folio('CP');
    insert into public.vp_cotizaciones (folio, cliente_id, responsable_id) values (v_folio, v_cli, auth.uid()) returning * into c;
    insert into public.vp_cotizacion_revisiones (cotizacion_id, numero, fecha_emision, vigencia_hasta) values (c.id, 0, v_emision, v_vig) returning * into r;
  else
    select * into c from public.vp_cotizaciones where id = v_id for update;
    if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
    if not public.vp_es_responsable_cot(v_id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador la modifica' using errcode = '42501'; end if;
    if c.version <> coalesce(public.vp_num(p, 'version')::int, -1) then
      raise exception 'VP409: otra persona guardó cambios en esta cotización; recarga antes de guardar' using errcode = '40001'; end if;
    select * into r from public.vp_cotizacion_revisiones where cotizacion_id = v_id and numero = c.revision_actual for update;
    if r.estado <> 'borrador' then
      raise exception 'VP_REVISION: la revisión R% ya fue enviada; para modificarla crea una revisión nueva', r.numero using errcode = '42501'; end if;
    update public.vp_cotizaciones set cliente_id = v_cli where id = v_id returning * into c;   -- sube la versión (vp_sellar)
  end if;
  update public.vp_cotizacion_revisiones set
    contacto_nombre = public.vp_txt(p->>'contacto_nombre', 150), contacto_correo = public.vp_txt(p->>'contacto_correo', 200),
    contacto_telefono = public.vp_txt(p->>'contacto_telefono', 40), fecha_emision = v_emision, vigencia_hasta = v_vig,
    plazo_entrega = public.vp_txt(p->>'plazo_entrega', 300), direccion_entrega = public.vp_txt(p->>'direccion_entrega', 300),
    condiciones_pago = public.vp_txt(p->>'condiciones_pago', 500), observaciones = public.vp_txt(p->>'observaciones', 4000),
    condiciones_comerciales = public.vp_txt(p->>'condiciones_comerciales', 4000),
    afecta_iva = coalesce((p->>'afecta_iva')::boolean, true)
  where id = r.id;
  perform public.vp_reemplazar_lineas(r.id, coalesce(p->'items', '[]'::jsonb), public.vp_es_responsable_cot(c.id));
  return jsonb_build_object('id', c.id, 'folio', c.folio, 'revision_id', r.id, 'revision', r.numero, 'version', c.version);
end $$;

-- Contenido público de una revisión (lo que ve el cliente). Nunca incluye costos, márgenes ni datos internos.
create function public.vp_documento_publico(p_rev uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'folio', c.folio, 'revision', r.numero, 'fecha_emision', r.fecha_emision, 'vigencia_hasta', r.vigencia_hasta,
    'cliente', public.vp_foto_cliente(c.cliente_id),
    'contacto', jsonb_build_object('nombre', r.contacto_nombre, 'correo', r.contacto_correo, 'telefono', r.contacto_telefono),
    'plazo_entrega', r.plazo_entrega, 'direccion_entrega', r.direccion_entrega, 'condiciones_pago', r.condiciones_pago,
    'observaciones', r.observaciones, 'condiciones_comerciales', r.condiciones_comerciales,
    'afecta_iva', r.afecta_iva, 'tasa_iva', r.tasa_iva, 'bruto', r.bruto, 'descuento', r.descuento, 'neto', r.neto, 'iva', r.iva, 'total', r.total,
    'items', coalesce((select jsonb_agg(jsonb_build_object('orden', i.orden, 'tipo', i.tipo, 'codigo', i.codigo, 'descripcion', i.descripcion, 'unidad', i.unidad,
        'cantidad', i.cantidad, 'precio_unitario', i.precio_unitario, 'descuento_pct', i.descuento_pct, 'subtotal_neto', i.subtotal_neto) order by i.orden)
      from public.vp_cotizacion_items i where i.revision_id = r.id), '[]'::jsonb),
    'empresa', (select valor from public.vp_configuracion where clave = 'empresa'),
    'responsable', public.vp_nombre(c.responsable_id))
  from public.vp_cotizacion_revisiones r join public.vp_cotizaciones c on c.id = r.cotizacion_id where r.id = p_rev
$$;

-- Cambio de estado de la revisión actual (registro MANUAL de envío, aceptación, rechazo o vencimiento).
-- p_datos: enviada {fecha, medio, destinatario, nota} · aceptada {fecha, referencia, nota} · rechazada {fecha, motivo} · vencida {fecha}
--          borrador (solo administrador, para devolver una revisión enviada por error, si no tiene venta) {motivo}
create function public.vp_cotizacion_estado(p_cotizacion uuid, p_estado text, p_datos jsonb, p_version int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; f date := coalesce(public.vp_fecha(p_datos, 'fecha'), public.vp_hoy());
begin
  perform public.vp_exigir_usuario();
  select * into c from public.vp_cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable o un administrador cambia el estado' using errcode = '42501'; end if;
  if c.version <> coalesce(p_version, -1) then raise exception 'VP409: la cotización cambió; recarga antes de continuar' using errcode = '40001'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual for update;
  if f > public.vp_hoy() then raise exception 'VP_FECHA: la fecha no puede ser futura' using errcode = '23514'; end if;
  if p_estado = 'enviada' then
    if r.estado <> 'borrador' then raise exception 'VP_ESTADO: solo una revisión en borrador se registra como enviada' using errcode = '23514'; end if;
    if not exists (select 1 from public.vp_cotizacion_items where revision_id = r.id) then raise exception 'VP_COTIZACION: agrega al menos una línea antes de enviar' using errcode = '23514'; end if;
    if f < r.fecha_emision then raise exception 'VP_FECHA: el envío no puede ser anterior a la emisión' using errcode = '23514'; end if;
    update public.vp_cotizacion_revisiones set estado = 'enviada', enviada_en = f, envio_registrado_por = auth.uid(),
      envio_medio = public.vp_txt(p_datos->>'medio', 60), envio_destinatario = public.vp_txt(p_datos->>'destinatario', 200),
      envio_nota = public.vp_txt(p_datos->>'nota', 1000), cliente = public.vp_foto_cliente(c.cliente_id), documento = public.vp_documento_publico(r.id)
    where id = r.id;
  elsif p_estado = 'aceptada' then
    if r.estado not in ('enviada','vencida') then raise exception 'VP_ESTADO: solo una cotización enviada (o vencida) se registra como aceptada' using errcode = '23514'; end if;
    if f < r.enviada_en then raise exception 'VP_FECHA: la aceptación no puede ser anterior al envío' using errcode = '23514'; end if;
    update public.vp_cotizacion_revisiones set estado = 'aceptada', aceptada_en = f, aceptacion_registrada_por = auth.uid(),
      aceptacion_referencia = public.vp_txt(p_datos->>'referencia', 200), aceptacion_nota = public.vp_txt(p_datos->>'nota', 1000) where id = r.id;
  elsif p_estado = 'rechazada' then
    if r.estado not in ('enviada','vencida') then raise exception 'VP_ESTADO: solo una cotización enviada (o vencida) se registra como rechazada' using errcode = '23514'; end if;
    if length(btrim(coalesce(p_datos->>'motivo', ''))) < 3 then raise exception 'VP_DATO: indica el motivo del rechazo' using errcode = '23514'; end if;
    update public.vp_cotizacion_revisiones set estado = 'rechazada', rechazada_en = f, rechazo_motivo = public.vp_txt(p_datos->>'motivo', 1000) where id = r.id;
  elsif p_estado = 'vencida' then
    if r.estado <> 'enviada' then raise exception 'VP_ESTADO: solo una cotización enviada se marca como vencida' using errcode = '23514'; end if;
    update public.vp_cotizacion_revisiones set estado = 'vencida', vencida_en = f where id = r.id;
  elsif p_estado = 'borrador' then
    -- Corrección administrativa: una revisión registrada como enviada por error vuelve a borrador (queda en el historial).
    if not public.vp_es_admin() then raise exception 'VP_PERMISO: solo un administrador devuelve una revisión a borrador' using errcode = '42501'; end if;
    if r.estado <> 'enviada' then raise exception 'VP_ESTADO: solo una revisión enviada (sin aceptar) vuelve a borrador' using errcode = '23514'; end if;
    if length(btrim(coalesce(p_datos->>'motivo', ''))) < 3 then raise exception 'VP_DATO: indica el motivo' using errcode = '23514'; end if;
    -- La protección de contenido aplica a revisiones no borrador: se libera en dos pasos controlados por esta función.
    update public.vp_cotizacion_revisiones set estado = 'borrador' where id = r.id;
    update public.vp_cotizacion_revisiones set documento = null, cliente = null, enviada_en = null, envio_registrado_por = null, envio_medio = null,
      envio_destinatario = null, envio_nota = 'Devuelta a borrador: ' || btrim(p_datos->>'motivo') where id = r.id;
  else raise exception 'VP_ESTADO: estado desconocido' using errcode = '22023'; end if;
  update public.vp_cotizaciones set estado = p_estado where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'estado', c.estado, 'version', c.version);
end $$;

-- Nueva revisión: copia la revisión actual (líneas y costos) en un borrador R(n+1). La revisión anterior se conserva intacta
-- (si estaba aceptada sigue aceptada y es la que respalda la venta; si no, queda «reemplazada»).
create function public.vp_cotizacion_nueva_revision(p_cotizacion uuid, p_version int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; nr public.vp_cotizacion_revisiones%rowtype; it record; v_item uuid;
begin
  perform public.vp_exigir_usuario();
  select * into c from public.vp_cotizaciones where id = p_cotizacion for update;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable o un administrador crea revisiones' using errcode = '42501'; end if;
  if c.version <> coalesce(p_version, -1) then raise exception 'VP409: la cotización cambió; recarga antes de continuar' using errcode = '40001'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual for update;
  if r.estado = 'borrador' then raise exception 'VP_REVISION: la revisión actual aún es borrador; edítala directamente' using errcode = '23514'; end if;
  insert into public.vp_cotizacion_revisiones (cotizacion_id, numero, contacto_nombre, contacto_correo, contacto_telefono, fecha_emision, vigencia_hasta,
    plazo_entrega, direccion_entrega, condiciones_pago, observaciones, condiciones_comerciales, afecta_iva, tasa_iva)
  values (c.id, r.numero + 1, r.contacto_nombre, r.contacto_correo, r.contacto_telefono, public.vp_hoy(),
    public.vp_hoy() + greatest(r.vigencia_hasta - r.fecha_emision, 0), r.plazo_entrega, r.direccion_entrega, r.condiciones_pago, r.observaciones,
    r.condiciones_comerciales, r.afecta_iva, r.tasa_iva)
  returning * into nr;
  for it in select i.*, k.costo_unitario, k.nota from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if it.costo_unitario is not null then insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, it.costo_unitario, it.nota); end if;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  if r.estado <> 'aceptada' then update public.vp_cotizacion_revisiones set estado = 'reemplazada' where id = r.id; end if;
  update public.vp_cotizaciones set revision_actual = nr.numero, estado = 'borrador' where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'revision', nr.numero, 'revision_id', nr.id, 'version', c.version);
end $$;

-- Duplicar: cotización NUEVA (folio nuevo, R0 borrador) con las líneas de la revisión actual. Los costos se copian solo si
-- quien duplica puede verlos.
create function public.vp_duplicar_cotizacion(p_cotizacion uuid) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; nc public.vp_cotizaciones%rowtype; nr public.vp_cotizacion_revisiones%rowtype;
  it record; v_item uuid; ve boolean;
begin
  perform public.vp_exigir_usuario();
  select * into c from public.vp_cotizaciones where id = p_cotizacion;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  ve := public.vp_es_responsable_cot(c.id);
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual;
  insert into public.vp_cotizaciones (folio, cliente_id, responsable_id, origen_id) values (public.vp_siguiente_folio('CP'), c.cliente_id, auth.uid(), c.id) returning * into nc;
  insert into public.vp_cotizacion_revisiones (cotizacion_id, numero, contacto_nombre, contacto_correo, contacto_telefono, fecha_emision, vigencia_hasta,
    plazo_entrega, direccion_entrega, condiciones_pago, observaciones, condiciones_comerciales, afecta_iva, tasa_iva)
  values (nc.id, 0, r.contacto_nombre, r.contacto_correo, r.contacto_telefono, public.vp_hoy(), public.vp_hoy() + greatest(r.vigencia_hasta - r.fecha_emision, 0),
    r.plazo_entrega, r.direccion_entrega, r.condiciones_pago, r.observaciones, r.condiciones_comerciales, r.afecta_iva, r.tasa_iva) returning * into nr;
  for it in select i.*, k.costo_unitario, k.nota from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_cotizacion_items (revision_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (nr.id, it.orden, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if ve and it.costo_unitario is not null then insert into public.vp_cotizacion_item_costos (item_id, costo_unitario, nota) values (v_item, it.costo_unitario, it.nota); end if;
  end loop;
  perform public.vp_recalcular_revision(nr.id);
  return jsonb_build_object('id', nc.id, 'folio', nc.folio, 'revision_id', nr.id);
end $$;

-- Venta desde cotización aceptada: transfiere cliente, líneas, cantidades, precios, condiciones y costos estimados.
-- Idempotente: si la cotización ya tiene una venta vigente (doble clic, reintento u otro usuario), devuelve ESA venta.
-- p_datos: {fecha?, fecha_entrega_comprometida?, plazo_pago_dias?, observaciones?}
create function public.vp_crear_venta_desde_cotizacion(p_cotizacion uuid, p_clave uuid, p_datos jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; v public.vp_ventas%rowtype; it record; v_item uuid;
  cd public.vp_clientes_datos%rowtype; v_eett uuid;
begin
  perform public.vp_exigir_usuario();
  if p_clave is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  select * into v from public.vp_ventas where clave_idempotencia = p_clave;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  select * into c from public.vp_cotizaciones where id = p_cotizacion for update;   -- serializa conversiones de la misma cotización
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  select * into v from public.vp_ventas where cotizacion_id = c.id and estado = 'vigente';
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador crea la venta' using errcode = '42501'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and estado = 'aceptada' order by numero desc limit 1;
  if not found then raise exception 'VP_ESTADO: la cotización no tiene una revisión aceptada' using errcode = '23514'; end if;
  select * into cd from public.vp_clientes_datos where cliente_id = c.cliente_id;
  select id into v_eett from public.vp_eett where cotizacion_revision_id = r.id and estado = 'emitida' order by revision desc limit 1;
  insert into public.vp_ventas (folio, origen, cotizacion_id, revision_id, eett_id, cliente_id, cliente, responsable_id, fecha, contacto_nombre, contacto_correo,
    contacto_telefono, plazo_entrega, fecha_entrega_comprometida, direccion_entrega, condiciones_pago, plazo_pago_dias, observaciones, condiciones_comerciales,
    afecta_iva, tasa_iva, clave_idempotencia)
  values (public.vp_siguiente_folio('OV'), 'cotizacion', c.id, r.id, v_eett, c.cliente_id, coalesce(r.cliente, public.vp_foto_cliente(c.cliente_id)), c.responsable_id,
    coalesce(public.vp_fecha(p_datos, 'fecha'), public.vp_hoy()), r.contacto_nombre, r.contacto_correo, r.contacto_telefono, r.plazo_entrega,
    public.vp_fecha(p_datos, 'fecha_entrega_comprometida'), r.direccion_entrega, r.condiciones_pago,
    coalesce(public.vp_num(p_datos, 'plazo_pago_dias')::int, cd.plazo_pago_dias, 30), coalesce(public.vp_txt(p_datos->>'observaciones', 4000), r.observaciones),
    r.condiciones_comerciales, r.afecta_iva, r.tasa_iva, p_clave)
  returning * into v;
  for it in select i.*, k.costo_unitario from public.vp_cotizacion_items i left join public.vp_cotizacion_item_costos k on k.item_id = i.id
            where i.revision_id = r.id order by i.orden loop
    insert into public.vp_venta_items (venta_id, orden, item_cotizacion_id, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (v.id, it.orden, it.id, it.tipo, it.producto_id, it.codigo, it.descripcion, it.unidad, it.cantidad, it.precio_unitario, it.descuento_pct) returning id into v_item;
    if it.costo_unitario is not null then insert into public.vp_venta_item_costos (item_id, costo_unitario_estimado) values (v_item, it.costo_unitario); end if;
  end loop;
  perform public.vp_recalcular_venta(v.id);
  select * into v from public.vp_ventas where id = v.id;
  if v.total <> r.total then raise exception 'VP_TOTAL: el total de la venta (%) no coincide con la cotización aceptada (%)', v.total, r.total using errcode = '23514'; end if;
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', false);
exception when unique_violation then
  -- Carrera entre dos sesiones: la otra ganó; se devuelve su venta (sin duplicar).
  select * into v from public.vp_ventas where (cotizacion_id = p_cotizacion and estado = 'vigente') or clave_idempotencia = p_clave limit 1;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  raise;
end $$;

-- Venta directa (sin cotización previa). p: {clave, cliente_id, fecha?, contacto_*, plazo_entrega, fecha_entrega_comprometida, direccion_entrega,
-- condiciones_pago, plazo_pago_dias, observaciones, condiciones_comerciales, afecta_iva, items:[{…, costo_unitario?}]}
create function public.vp_crear_venta_directa(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; it jsonb; n int := 0; v_item uuid; v_cli uuid := nullif(p->>'cliente_id', '')::uuid; v_clave uuid := nullif(p->>'clave', '')::uuid;
  cd public.vp_clientes_datos%rowtype;
begin
  perform public.vp_exigir_usuario();
  if v_clave is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  select * into v from public.vp_ventas where clave_idempotencia = v_clave;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  if v_cli is null or not exists (select 1 from public.pi_clientes where id = v_cli and activo) then
    raise exception 'VP_VENTA: selecciona un cliente registrado y activo' using errcode = '23503'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'VP_VENTA: agrega al menos una línea' using errcode = '23514'; end if;
  if jsonb_array_length(p->'items') > 200 then raise exception 'VP_DATO: máximo 200 líneas' using errcode = '22023'; end if;
  if coalesce(public.vp_fecha(p, 'fecha'), public.vp_hoy()) > public.vp_hoy() then raise exception 'VP_FECHA: la fecha de la venta no puede ser futura' using errcode = '23514'; end if;
  select * into cd from public.vp_clientes_datos where cliente_id = v_cli;
  insert into public.vp_ventas (folio, origen, cliente_id, cliente, responsable_id, fecha, contacto_nombre, contacto_correo, contacto_telefono, plazo_entrega,
    fecha_entrega_comprometida, direccion_entrega, condiciones_pago, plazo_pago_dias, observaciones, condiciones_comerciales, afecta_iva, clave_idempotencia)
  values (public.vp_siguiente_folio('OV'), 'directa', v_cli, public.vp_foto_cliente(v_cli), auth.uid(), coalesce(public.vp_fecha(p, 'fecha'), public.vp_hoy()),
    public.vp_txt(p->>'contacto_nombre', 150), public.vp_txt(p->>'contacto_correo', 200), public.vp_txt(p->>'contacto_telefono', 40),
    public.vp_txt(p->>'plazo_entrega', 300), public.vp_fecha(p, 'fecha_entrega_comprometida'), coalesce(public.vp_txt(p->>'direccion_entrega', 300), cd.direccion_entrega),
    coalesce(public.vp_txt(p->>'condiciones_pago', 500), cd.condiciones_pago), coalesce(public.vp_num(p, 'plazo_pago_dias')::int, cd.plazo_pago_dias, 30),
    public.vp_txt(p->>'observaciones', 4000), public.vp_txt(p->>'condiciones_comerciales', 4000), coalesce((p->>'afecta_iva')::boolean, true), v_clave)
  returning * into v;
  for it in select * from jsonb_array_elements(p->'items') loop
    n := n + 1;
    if public.vp_num(it, 'cantidad') is null or public.vp_num(it, 'cantidad') <= 0 then raise exception 'VP_DATO: línea %: la cantidad debe ser mayor que cero', n using errcode = '23514'; end if;
    if public.vp_num(it, 'precio_unitario') is null or public.vp_num(it, 'precio_unitario') < 0 then raise exception 'VP_DATO: línea %: precio unitario inválido', n using errcode = '23514'; end if;
    if coalesce(public.vp_num(it, 'descuento_pct'), 0) not between 0 and 100 then raise exception 'VP_DATO: línea %: el descuento debe estar entre 0 y 100%%', n using errcode = '23514'; end if;
    if public.vp_txt(it->>'descripcion') is null then raise exception 'VP_DATO: línea %: falta la descripción', n using errcode = '23514'; end if;
    insert into public.vp_venta_items (venta_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario, descuento_pct)
    values (v.id, n, coalesce(nullif(it->>'tipo', ''), 'producto'), nullif(it->>'producto_id', '')::uuid, public.vp_txt(it->>'codigo', 60), public.vp_txt(it->>'descripcion', 2000),
      coalesce(public.vp_txt(it->>'unidad', 20), 'UN'), public.vp_num(it, 'cantidad'), public.vp_num(it, 'precio_unitario'), coalesce(public.vp_num(it, 'descuento_pct'), 0))
    returning id into v_item;
    if public.vp_num(it, 'costo_unitario') is not null then
      if public.vp_num(it, 'costo_unitario') < 0 then raise exception 'VP_DATO: línea %: costo inválido', n using errcode = '23514'; end if;
      insert into public.vp_venta_item_costos (item_id, costo_unitario_estimado) values (v_item, public.vp_num(it, 'costo_unitario'));
    end if;
  end loop;
  perform public.vp_recalcular_venta(v.id);
  return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', false);
exception when unique_violation then
  select * into v from public.vp_ventas where clave_idempotencia = v_clave;
  if found then return jsonb_build_object('id', v.id, 'folio', v.folio, 'ya_existia', true); end if;
  raise;
end $$;

-- Datos operativos de la venta (no cambia líneas, precios ni totales).
create function public.vp_actualizar_venta(p_id uuid, p_version int, p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype;
begin
  perform public.vp_exigir_usuario();
  select * into v from public.vp_ventas where id = p_id for update;
  if not found then raise exception 'VP_VENTA: venta no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_venta(p_id) then raise exception 'VP_PERMISO: solo el responsable o un administrador modifica la venta' using errcode = '42501'; end if;
  if v.estado <> 'vigente' then raise exception 'VP_ESTADO: la venta está anulada' using errcode = '23514'; end if;
  if v.version <> coalesce(p_version, -1) then raise exception 'VP409: otra persona modificó esta venta; recarga antes de guardar' using errcode = '40001'; end if;
  update public.vp_ventas set
    fecha_entrega_comprometida = case when p ? 'fecha_entrega_comprometida' then public.vp_fecha(p, 'fecha_entrega_comprometida') else fecha_entrega_comprometida end,
    plazo_entrega = case when p ? 'plazo_entrega' then public.vp_txt(p->>'plazo_entrega', 300) else plazo_entrega end,
    direccion_entrega = case when p ? 'direccion_entrega' then public.vp_txt(p->>'direccion_entrega', 300) else direccion_entrega end,
    plazo_pago_dias = case when p ? 'plazo_pago_dias' then coalesce(public.vp_num(p, 'plazo_pago_dias')::int, 30) else plazo_pago_dias end,
    observaciones = case when p ? 'observaciones' then public.vp_txt(p->>'observaciones', 4000) else observaciones end,
    contacto_nombre = case when p ? 'contacto_nombre' then public.vp_txt(p->>'contacto_nombre', 150) else contacto_nombre end,
    contacto_correo = case when p ? 'contacto_correo' then public.vp_txt(p->>'contacto_correo', 200) else contacto_correo end,
    contacto_telefono = case when p ? 'contacto_telefono' then public.vp_txt(p->>'contacto_telefono', 40) else contacto_telefono end
  where id = p_id returning * into v;
  return jsonb_build_object('id', v.id, 'version', v.version);
end $$;

-- Venta vigente, bloqueada para registrar movimientos.
create function public.vp_venta_vigente(p_id uuid) returns public.vp_ventas
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype;
begin
  select * into v from public.vp_ventas where id = p_id for update;
  if not found then raise exception 'VP_VENTA: venta no encontrada' using errcode = 'P0002'; end if;
  if v.estado <> 'vigente' then raise exception 'VP_ESTADO: la venta % está anulada; no admite movimientos', v.folio using errcode = '23514'; end if;
  return v;
end $$;

create function public.vp_validar_documento(p_doc uuid, p_venta uuid, p_categorias text[]) returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_doc is null then return null; end if;
  if not exists (select 1 from public.vp_documentos where id = p_doc and venta_id = p_venta and estado = 'vigente' and categoria = any (p_categorias)) then
    raise exception 'VP_DOCUMENTO: el archivo adjunto no corresponde a esta venta' using errcode = '23503'; end if;
  return p_doc;
end $$;

-- OC emitida por el cliente a BFK. p: {venta_id, numero, fecha, monto?, documento_id?, observacion?}
create function public.vp_registrar_oc_cliente(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; o public.vp_oc_cliente%rowtype;
begin
  perform public.vp_exigir_usuario();
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  if public.vp_txt(p->>'numero', 60) is null then raise exception 'VP_DATO: falta el número de la OC del cliente' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') is null then raise exception 'VP_DATO: falta la fecha de la OC del cliente' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: la fecha de la OC no puede ser futura' using errcode = '23514'; end if;
  if public.vp_num(p, 'monto') is not null and public.vp_num(p, 'monto') < 0 then raise exception 'VP_DATO: monto inválido' using errcode = '23514'; end if;
  begin
    insert into public.vp_oc_cliente (venta_id, cliente_id, numero, fecha, monto, documento_id, observacion)
    values (v.id, v.cliente_id, public.vp_txt(p->>'numero', 60), public.vp_fecha(p, 'fecha'), round(public.vp_num(p, 'monto')),
      public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, v.id, array['oc_cliente']), public.vp_txt(p->>'observacion', 1000))
    returning * into o;
  exception when unique_violation then
    raise exception 'VP_DUPLICADO: la OC % de este cliente ya está registrada', p->>'numero' using errcode = '23505';
  end;
  return jsonb_build_object('id', o.id);
end $$;

-- Entrega (parcial o final). p: {venta_id, tipo, fecha, guia_numero?, recibido_por?, observacion?, documento_id?, items:[{venta_item_id, cantidad}]}
create function public.vp_registrar_entrega(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; e public.vp_entregas%rowtype; it jsonb; vi public.vp_venta_items%rowtype; ya numeric; q numeric; n int := 0;
begin
  perform public.vp_exigir_usuario();
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  if coalesce(p->>'tipo', '') not in ('despacho','servicio') then raise exception 'VP_DATO: tipo de entrega inválido' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') is null or public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha de la entrega (no futura)' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') < v.fecha then raise exception 'VP_FECHA: la entrega no puede ser anterior a la venta' using errcode = '23514'; end if;
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'VP_DATO: indica qué se entrega' using errcode = '23514'; end if;
  insert into public.vp_entregas (venta_id, numero, tipo, fecha, guia_numero, recibido_por, observacion, documento_id)
  values (v.id, coalesce((select max(numero) from public.vp_entregas where venta_id = v.id), 0) + 1, p->>'tipo', public.vp_fecha(p, 'fecha'),
    public.vp_txt(p->>'guia_numero', 60), public.vp_txt(p->>'recibido_por', 150), public.vp_txt(p->>'observacion', 1000),
    public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, v.id, array['guia_despacho','comprobante_entrega','otro']))
  returning * into e;
  for it in select * from jsonb_array_elements(p->'items') loop
    q := public.vp_num(it, 'cantidad');
    if q is null or q = 0 then continue; end if;
    if q < 0 then raise exception 'VP_DATO: cantidad entregada inválida' using errcode = '23514'; end if;
    select * into vi from public.vp_venta_items where id = nullif(it->>'venta_item_id', '')::uuid and venta_id = v.id;
    if not found then raise exception 'VP_DATO: la línea no pertenece a esta venta' using errcode = '23503'; end if;
    select coalesce(sum(ei.cantidad), 0) into ya from public.vp_entrega_items ei join public.vp_entregas en on en.id = ei.entrega_id
      where ei.venta_item_id = vi.id and en.estado = 'vigente';
    if ya + q > vi.cantidad then
      raise exception 'VP_ENTREGA: línea %: se entregaría % de % (ya entregado %)', vi.orden, ya + q, vi.cantidad, ya using errcode = '23514'; end if;
    insert into public.vp_entrega_items (entrega_id, venta_item_id, cantidad) values (e.id, vi.id, q);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'VP_DATO: indica al menos una cantidad entregada' using errcode = '23514'; end if;
  return jsonb_build_object('id', e.id, 'numero', e.numero);
end $$;

-- Registro de una factura YA EMITIDA en el SII (este módulo no emite documentos tributarios).
-- p: {venta_id, tipo_documento, numero, fecha, neto, iva, documento_id?, observacion?}
create function public.vp_registrar_factura(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; f public.vp_facturas%rowtype; ya numeric; n numeric := round(public.vp_num(p, 'neto')); i numeric := round(coalesce(public.vp_num(p, 'iva'), 0));
  t text := coalesce(p->>'tipo_documento', ''); num text := public.vp_txt(p->>'numero', 30);
begin
  perform public.vp_exigir_usuario();
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  if not public.vp_es_responsable_venta(v.id) then raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra facturas' using errcode = '42501'; end if;
  if t not in ('factura_afecta','factura_exenta','boleta','otro') then raise exception 'VP_DATO: tipo de documento inválido' using errcode = '23514'; end if;
  if num is null then raise exception 'VP_DATO: falta el número (folio) del documento' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') is null or public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha de emisión (no futura)' using errcode = '23514'; end if;
  if n is null or n < 0 or i < 0 or n + i <= 0 then raise exception 'VP_DATO: montos de la factura inválidos' using errcode = '23514'; end if;
  if t = 'factura_exenta' and i <> 0 then raise exception 'VP_FACTURA: una factura exenta no lleva IVA' using errcode = '23514'; end if;
  if t = 'factura_afecta' and abs(i - round(n * v.tasa_iva)) > 1 then
    raise exception 'VP_FACTURA: el IVA (%) no corresponde al %%% del neto (%)', i, round(v.tasa_iva * 100), round(n * v.tasa_iva) using errcode = '23514'; end if;
  if t in ('factura_afecta','factura_exenta') and exists (select 1 from public.eventos_factura ef where upper(regexp_replace(coalesce(ef.numero_factura, ''), '\s', '', 'g')) = upper(regexp_replace(num, '\s', '', 'g'))) then
    raise exception 'VP_DUPLICADO: el folio % ya está registrado en una OC de Mercado Público', num using errcode = '23505'; end if;
  select coalesce(sum(total), 0) into ya from public.vp_facturas where venta_id = v.id and estado = 'vigente';
  if ya + n + i > v.total then
    raise exception 'VP_FACTURA: lo facturado (%) superaría el total de la venta (%)', ya + n + i, v.total using errcode = '23514'; end if;
  begin
    insert into public.vp_facturas (venta_id, tipo_documento, numero, fecha, neto, iva, total, documento_id, observacion)
    values (v.id, t, num, public.vp_fecha(p, 'fecha'), n, i, n + i,
      public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, v.id, array['factura']), public.vp_txt(p->>'observacion', 1000))
    returning * into f;
  exception when unique_violation then raise exception 'VP_DUPLICADO: el documento % ya está registrado', num using errcode = '23505';
  end;
  return jsonb_build_object('id', f.id);
end $$;

-- Pago del cliente (anticipo o abono). Opcionalmente se aplica a una factura (imputación, no otro cobro).
-- p: {clave, venta_id, tipo, fecha, monto, medio, referencia?, documento_id?, observacion?, factura_id?}
create function public.vp_registrar_pago(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; pg public.vp_pagos%rowtype; ya numeric; m numeric := round(public.vp_num(p, 'monto')); v_clave uuid := nullif(p->>'clave', '')::uuid;
begin
  perform public.vp_exigir_usuario();
  if v_clave is null then raise exception 'VP_DATO: falta la clave de la operación' using errcode = '22023'; end if;
  select * into pg from public.vp_pagos where clave_idempotencia = v_clave;
  if found then return jsonb_build_object('id', pg.id, 'ya_existia', true); end if;
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  if not public.vp_es_responsable_venta(v.id) then raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra pagos' using errcode = '42501'; end if;
  if coalesce(p->>'tipo', '') not in ('anticipo','abono') then raise exception 'VP_DATO: tipo de pago inválido' using errcode = '23514'; end if;
  if m is null or m <= 0 then raise exception 'VP_DATO: el monto debe ser mayor que cero' using errcode = '23514'; end if;
  if public.vp_fecha(p, 'fecha') is null or public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha del pago (no futura)' using errcode = '23514'; end if;
  select coalesce(sum(monto), 0) into ya from public.vp_pagos where venta_id = v.id and estado = 'vigente';
  if ya + m > v.total then raise exception 'VP_PAGO: lo cobrado (%) superaría el total de la venta (%); saldo pendiente %', ya + m, v.total, v.total - ya using errcode = '23514'; end if;
  insert into public.vp_pagos (venta_id, tipo, fecha, monto, medio, referencia, documento_id, observacion, clave_idempotencia)
  values (v.id, p->>'tipo', public.vp_fecha(p, 'fecha'), m, coalesce(nullif(p->>'medio', ''), 'transferencia'), public.vp_txt(p->>'referencia', 120),
    public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, v.id, array['comprobante_pago']), public.vp_txt(p->>'observacion', 1000), v_clave)
  returning * into pg;
  if nullif(p->>'factura_id', '') is not null then perform public.vp_imputar_pago(pg.id, (p->>'factura_id')::uuid, m); end if;
  return jsonb_build_object('id', pg.id, 'ya_existia', false);
exception when unique_violation then
  select * into pg from public.vp_pagos where clave_idempotencia = v_clave;
  if found then return jsonb_build_object('id', pg.id, 'ya_existia', true); end if;
  raise;
end $$;

-- Aplica (parte de) un pago a una factura de la misma venta. No cambia lo cobrado.
create function public.vp_imputar_pago(p_pago uuid, p_factura uuid, p_monto numeric) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare pg public.vp_pagos%rowtype; f public.vp_facturas%rowtype; usado numeric; imputado numeric; m numeric := round(p_monto); v_id uuid;
begin
  perform public.vp_exigir_usuario();
  select * into pg from public.vp_pagos where id = p_pago for update;
  if not found or pg.estado <> 'vigente' then raise exception 'VP_PAGO: pago no encontrado o anulado' using errcode = 'P0002'; end if;
  perform public.vp_venta_vigente(pg.venta_id);
  if not public.vp_es_responsable_venta(pg.venta_id) then raise exception 'VP_PERMISO: solo el responsable o un administrador aplica pagos' using errcode = '42501'; end if;
  select * into f from public.vp_facturas where id = p_factura for update;
  if not found or f.estado <> 'vigente' or f.venta_id <> pg.venta_id then raise exception 'VP_FACTURA: la factura no es vigente o es de otra venta' using errcode = '23503'; end if;
  if m is null or m <= 0 then raise exception 'VP_DATO: monto a aplicar inválido' using errcode = '23514'; end if;
  select coalesce(sum(monto), 0) into usado from public.vp_pago_imputaciones where pago_id = pg.id and estado = 'vigente';
  select coalesce(sum(monto), 0) into imputado from public.vp_pago_imputaciones where factura_id = f.id and estado = 'vigente';
  if usado + m > pg.monto then raise exception 'VP_PAGO: el pago tiene % disponible para aplicar', pg.monto - usado using errcode = '23514'; end if;
  if imputado + m > f.total then raise exception 'VP_FACTURA: la factura tiene % pendiente de aplicar', f.total - imputado using errcode = '23514'; end if;
  begin
    insert into public.vp_pago_imputaciones (pago_id, factura_id, monto) values (pg.id, f.id, m) returning id into v_id;
  exception when unique_violation then
    update public.vp_pago_imputaciones set monto = monto + m where pago_id = pg.id and factura_id = f.id and estado = 'vigente' returning id into v_id;
  end;
  return jsonb_build_object('id', v_id);
end $$;

-- Costo real: compra registrada aquí o gasto ya existente vinculado (sin copiarlo).
-- p: {venta_id, origen, gasto_id?, venta_item_id?, proveedor, fecha, documento_tipo, documento_numero, neto, iva, iva_recuperable, descripcion, documento_id?}
create function public.vp_registrar_compra(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype; k public.vp_compras%rowtype; g record; n numeric; i numeric; o text := coalesce(p->>'origen', 'registro');
begin
  perform public.vp_exigir_usuario();
  v := public.vp_venta_vigente(nullif(p->>'venta_id', '')::uuid);
  if not public.vp_es_responsable_venta(v.id) then raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador registra costos' using errcode = '42501'; end if;
  if nullif(p->>'venta_item_id', '') is not null and not exists (select 1 from public.vp_venta_items where id = (p->>'venta_item_id')::uuid and venta_id = v.id) then
    raise exception 'VP_DATO: la línea no pertenece a esta venta' using errcode = '23503'; end if;
  if o = 'gasto_existente' then
    select id, monto, fecha, descripcion into g from public.gastos_indirectos where id = p->>'gasto_id';
    if not found then raise exception 'VP_COMPRA: el gasto indicado no existe en Gastos' using errcode = '23503'; end if;
    if exists (select 1 from public.vp_compras where gasto_id = g.id and estado = 'vigente') then
      raise exception 'VP_DUPLICADO: ese gasto ya está vinculado a una venta' using errcode = '23505'; end if;
    n := round(coalesce(g.monto, 0)); i := 0;
    insert into public.vp_compras (venta_id, venta_item_id, origen, gasto_id, proveedor, fecha, neto, iva, total, iva_recuperable, descripcion)
    values (v.id, nullif(p->>'venta_item_id', '')::uuid, o, g.id, public.vp_txt(p->>'proveedor', 200), coalesce(g.fecha, public.vp_hoy()), n, 0, n, true,
      coalesce(public.vp_txt(p->>'descripcion', 1000), public.vp_txt(g.descripcion, 1000)))
    returning * into k;
  elsif o = 'registro' then
    n := round(public.vp_num(p, 'neto')); i := round(coalesce(public.vp_num(p, 'iva'), 0));
    if n is null or n < 0 or i < 0 then raise exception 'VP_DATO: montos de la compra inválidos' using errcode = '23514'; end if;
    if public.vp_fecha(p, 'fecha') is null or public.vp_fecha(p, 'fecha') > public.vp_hoy() then raise exception 'VP_FECHA: indica la fecha de la compra (no futura)' using errcode = '23514'; end if;
    insert into public.vp_compras (venta_id, venta_item_id, origen, proveedor, fecha, documento_tipo, documento_numero, neto, iva, total, iva_recuperable, descripcion, documento_id)
    values (v.id, nullif(p->>'venta_item_id', '')::uuid, o, public.vp_txt(p->>'proveedor', 200), public.vp_fecha(p, 'fecha'), nullif(p->>'documento_tipo', ''),
      public.vp_txt(p->>'documento_numero', 40), n, i, n + i, coalesce((p->>'iva_recuperable')::boolean, true), public.vp_txt(p->>'descripcion', 1000),
      public.vp_validar_documento(nullif(p->>'documento_id', '')::uuid, v.id, array['compra']))
    returning * into k;
  else raise exception 'VP_DATO: origen de compra inválido' using errcode = '22023'; end if;
  return jsonb_build_object('id', k.id);
end $$;

-- Anulación con motivo (conserva el registro; deja de contar en indicadores).
-- p_tabla: oc_cliente | entrega | factura | pago | imputacion | compra | documento
create function public.vp_anular(p_tabla text, p_id uuid, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_venta uuid; est text; t text; col_est text := 'anulada'; extra text := '';
begin
  perform public.vp_exigir_usuario();
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'VP_DATO: indica el motivo de la anulación' using errcode = '23514'; end if;
  t := case p_tabla when 'oc_cliente' then 'vp_oc_cliente' when 'entrega' then 'vp_entregas' when 'factura' then 'vp_facturas' when 'pago' then 'vp_pagos'
                    when 'imputacion' then 'vp_pago_imputaciones' when 'compra' then 'vp_compras' when 'documento' then 'vp_documentos' end;
  if t is null then raise exception 'VP_DATO: tipo de registro desconocido' using errcode = '22023'; end if;
  if t in ('vp_pagos','vp_documentos') then col_est := 'anulado'; end if;
  if t = 'vp_pago_imputaciones' then
    select pg.venta_id, im.estado into v_venta, est from public.vp_pago_imputaciones im join public.vp_pagos pg on pg.id = im.pago_id where im.id = p_id;
  elsif t = 'vp_documentos' then
    select venta_id, estado into v_venta, est from public.vp_documentos where id = p_id;
  else
    execute format('select venta_id, estado from public.%I where id = $1', t) into v_venta, est using p_id;
  end if;
  if est is null then raise exception 'VP: registro no encontrado' using errcode = 'P0002'; end if;
  if est <> 'vigente' then raise exception 'VP_ESTADO: el registro ya está anulado' using errcode = '23514'; end if;
  if t = 'vp_documentos' then
    if not (public.vp_es_admin() or exists (select 1 from public.vp_documentos d where d.id = p_id and (d.subido_por = auth.uid()
        or (d.venta_id is not null and public.vp_es_responsable_venta(d.venta_id)) or (d.cotizacion_id is not null and public.vp_es_responsable_cot(d.cotizacion_id))))) then
      raise exception 'VP_PERMISO: solo quien subió el archivo, el responsable o un administrador lo anula' using errcode = '42501'; end if;
    if exists (select 1 from public.vp_oc_cliente where documento_id = p_id and estado = 'vigente') or exists (select 1 from public.vp_facturas where documento_id = p_id and estado = 'vigente')
       or exists (select 1 from public.vp_pagos where documento_id = p_id and estado = 'vigente') or exists (select 1 from public.vp_entregas where documento_id = p_id and estado = 'vigente')
       or exists (select 1 from public.vp_compras where documento_id = p_id and estado = 'vigente') then
      raise exception 'VP_DOCUMENTO: el archivo respalda un registro vigente; anula primero ese registro' using errcode = '23514'; end if;
  elsif not public.vp_es_responsable_venta(v_venta) then
    raise exception 'VP_PERMISO: solo el responsable de la venta o un administrador anula registros' using errcode = '42501';
  end if;
  if t = 'vp_facturas' and exists (select 1 from public.vp_pago_imputaciones where factura_id = p_id and estado = 'vigente') then
    raise exception 'VP_FACTURA: la factura tiene pagos aplicados; anula primero esas aplicaciones' using errcode = '23514'; end if;
  if t = 'vp_pagos' and exists (select 1 from public.vp_pago_imputaciones where pago_id = p_id and estado = 'vigente') then
    -- Anular el pago anula también sus aplicaciones (el cobro deja de existir).
    update public.vp_pago_imputaciones set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), anulacion_motivo = 'Pago anulado: ' || btrim(p_motivo)
    where pago_id = p_id and estado = 'vigente';
  end if;
  execute format('update public.%I set estado = $1, %I = now(), %I = $2, anulacion_motivo = $3 where id = $4', t,
                 col_est || '_en', col_est || '_por') using col_est, auth.uid(), btrim(p_motivo), p_id;
  return jsonb_build_object('id', p_id, 'estado', col_est);
end $$;

-- Anular una venta (solo administrador). Exige anular antes sus facturas y pagos vigentes, para que los indicadores
-- de facturación y cobro queden cuadrados. La cotización puede volver a convertirse.
create function public.vp_anular_venta(p_id uuid, p_motivo text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v public.vp_ventas%rowtype;
begin
  if not public.vp_es_admin() then raise exception 'VP_PERMISO: solo un administrador anula ventas' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'VP_DATO: indica el motivo de la anulación' using errcode = '23514'; end if;
  v := public.vp_venta_vigente(p_id);
  if exists (select 1 from public.vp_facturas where venta_id = p_id and estado = 'vigente') or exists (select 1 from public.vp_pagos where venta_id = p_id and estado = 'vigente') then
    raise exception 'VP_VENTA: la venta tiene facturas o pagos vigentes; anúlalos primero (o registra la nota de crédito y la devolución)' using errcode = '23514'; end if;
  update public.vp_ventas set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), anulacion_motivo = btrim(p_motivo) where id = p_id;
  update public.vp_compras set estado = 'anulada', anulada_en = now(), anulada_por = auth.uid(), anulacion_motivo = 'Venta anulada: ' || btrim(p_motivo)
  where venta_id = p_id and estado = 'vigente' and origen = 'gasto_existente';   -- libera el vínculo con Gastos (el gasto sigue en Gastos)
  return jsonb_build_object('id', p_id, 'estado', 'anulada');
end $$;

-- Registra un archivo YA subido al depósito vp-documentos. p: {ambito, id, categoria, titulo, nombre_archivo, ruta, tipo_mime, tamano, sha256}
create function public.vp_registrar_documento(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare d public.vp_documentos%rowtype; amb text := p->>'ambito'; i uuid := nullif(p->>'id', '')::uuid; ex boolean;
begin
  perform public.vp_exigir_usuario();
  if not public.vp_documentos_habilitados() then raise exception 'VP_DOCUMENTO: la carga de archivos está deshabilitada (falta activar su respaldo)' using errcode = '42501'; end if;
  if not public.vp_puede_subir_ruta(p->>'ruta') then raise exception 'VP_PERMISO: no puedes adjuntar archivos en esta ubicación' using errcode = '42501'; end if;
  if split_part(p->>'ruta', '/', 1) <> amb or split_part(p->>'ruta', '/', 2) <> i::text or split_part(p->>'ruta', '/', 3) <> p->>'categoria' then
    raise exception 'VP_DOCUMENTO: la ruta del archivo no coincide con su registro' using errcode = '22023'; end if;
  if to_regclass('storage.objects') is not null then
    begin
      execute 'select exists (select 1 from storage.objects where bucket_id = ''vp-documentos'' and name = $1)' into ex using p->>'ruta';
    exception when insufficient_privilege then ex := null;   -- sin acceso de lectura al esquema storage: se omite la comprobación
    end;
    if ex is false then raise exception 'VP_DOCUMENTO: el archivo no está en el depósito' using errcode = 'P0002'; end if;
  end if;
  insert into public.vp_documentos (ambito, venta_id, cotizacion_id, producto_id, categoria, titulo, nombre_archivo, ruta, tipo_mime, tamano, sha256)
  values (amb, case when amb = 'venta' then i end, case when amb = 'cotizacion' then i end, case when amb = 'producto' then i end, p->>'categoria',
    btrim(coalesce(p->>'titulo', '')), left(coalesce(p->>'nombre_archivo', ''), 200), p->>'ruta', left(nullif(p->>'tipo_mime', ''), 120),
    public.vp_num(p, 'tamano')::bigint, lower(p->>'sha256'))
  returning * into d;
  return jsonb_build_object('id', d.id);
end $$;

-- Producto con información técnica (crea el registro en la biblioteca compartida si no existe).
-- p: {producto_id?, nombre, marca?, modelo?, descripcion_tecnica?, codigo?, tipo_producto?, caracteristicas:[{caracteristica, valor, unidad?, grupo?, origen?}],
--     condiciones_operacion?, condiciones_instalacion?, accesorios:[], exclusiones:[], garantia?, normas:[{norma, respaldo_documento_id?, respaldo_pagina?, respaldo_texto?}],
--     fuente_tipo, fuente_detalle?, version?}
create function public.vp_guardar_producto(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'producto_id', '')::uuid; t public.vp_productos_tecnicos%rowtype; x jsonb; car jsonb := '[]'::jsonb; nor jsonb := '[]'::jsonb;
begin
  perform public.vp_exigir_usuario();
  if public.vp_txt(p->>'nombre', 300) is null then raise exception 'VP_PRODUCTO: falta el nombre del producto' using errcode = '23514'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'caracteristicas', '[]')) loop
    if public.vp_txt(x->>'caracteristica', 120) is null then continue; end if;
    -- Solo características con valor real: «No informado» o vacío no se guardan en la biblioteca (se completan después).
    if public.vp_txt(x->>'valor', 500) is null or lower(btrim(x->>'valor')) in ('no informado','n/a','s/i','-') then continue; end if;
    car := car || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('caracteristica', public.vp_txt(x->>'caracteristica', 120), 'valor', public.vp_txt(x->>'valor', 500),
      'unidad', public.vp_txt(x->>'unidad', 30), 'grupo', public.vp_txt(x->>'grupo', 60),
      'origen', case when jsonb_typeof(x->'origen') = 'object' then x->'origen' end)));
  end loop;
  if jsonb_array_length(car) > 200 then raise exception 'VP_PRODUCTO: máximo 200 características' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'normas', '[]')) loop
    if public.vp_txt(x->>'norma', 200) is null then continue; end if;
    if nullif(x->>'respaldo_documento_id', '') is null and public.vp_txt(x->>'respaldo_texto', 500) is null then
      raise exception 'VP_PRODUCTO: la norma «%» necesita respaldo (archivo o referencia verificable)', x->>'norma' using errcode = '23514'; end if;
    if nullif(x->>'respaldo_documento_id', '') is not null and not exists (select 1 from public.vp_documentos where id = (x->>'respaldo_documento_id')::uuid and estado = 'vigente') then
      raise exception 'VP_PRODUCTO: el respaldo de la norma «%» no es un archivo vigente', x->>'norma' using errcode = '23503'; end if;
    nor := nor || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('norma', public.vp_txt(x->>'norma', 200), 'respaldo_documento_id', nullif(x->>'respaldo_documento_id', ''),
      'respaldo_pagina', public.vp_txt(x->>'respaldo_pagina', 20), 'respaldo_texto', public.vp_txt(x->>'respaldo_texto', 500))));
  end loop;
  if v_id is null then
    insert into public.productos_catalogo (nombre, marca, modelo, descripcion_tecnica, especificaciones, fuente, revisado_por)
    values (public.vp_txt(p->>'nombre', 300), public.vp_txt(p->>'marca', 120), public.vp_txt(p->>'modelo', 120), public.vp_txt(p->>'descripcion_tecnica', 8000),
      coalesce((select jsonb_agg(jsonb_build_object('etiqueta', e->>'caracteristica', 'valor', btrim((e->>'valor') || ' ' || coalesce(e->>'unidad', ''))))
                from jsonb_array_elements(car) e), '[]'::jsonb),
      public.vp_txt(p->>'fuente_detalle', 300), auth.uid())
    returning id into v_id;
  else
    if not exists (select 1 from public.productos_catalogo where id = v_id and estado = 'aprobado') then
      raise exception 'VP_PRODUCTO: producto no encontrado o archivado' using errcode = 'P0002'; end if;
    -- Solo los datos de identificación (la ficha propia de Mercado Público y sus fichas congeladas no se tocan).
    update public.productos_catalogo set nombre = public.vp_txt(p->>'nombre', 300), marca = public.vp_txt(p->>'marca', 120), modelo = public.vp_txt(p->>'modelo', 120),
      descripcion_tecnica = coalesce(public.vp_txt(p->>'descripcion_tecnica', 8000), descripcion_tecnica), revisado_por = auth.uid(), ultima_revision = now()
    where id = v_id;
  end if;
  select * into t from public.vp_productos_tecnicos where producto_id = v_id for update;
  if found and p ? 'version' and t.version <> (p->>'version')::int then
    raise exception 'VP409: otra persona modificó la información técnica de este producto; recarga antes de guardar' using errcode = '40001'; end if;
  if not found then
    insert into public.vp_productos_tecnicos (producto_id) values (v_id);
  end if;
  update public.vp_productos_tecnicos set codigo = public.vp_txt(p->>'codigo', 60), tipo_producto = coalesce(nullif(p->>'tipo_producto', ''), t.tipo_producto, 'otro'),
    caracteristicas = car, condiciones_operacion = public.vp_txt(p->>'condiciones_operacion', 4000), condiciones_instalacion = public.vp_txt(p->>'condiciones_instalacion', 4000),
    accesorios = coalesce((select jsonb_agg(public.vp_txt(a, 300)) from jsonb_array_elements_text(coalesce(p->'accesorios', '[]')) a where public.vp_txt(a, 300) is not null), '[]'::jsonb),
    exclusiones = coalesce((select jsonb_agg(public.vp_txt(a, 300)) from jsonb_array_elements_text(coalesce(p->'exclusiones', '[]')) a where public.vp_txt(a, 300) is not null), '[]'::jsonb),
    garantia = public.vp_txt(p->>'garantia', 1000), normas = nor, fuente_tipo = coalesce(nullif(p->>'fuente_tipo', ''), 'manual'),
    fuente_detalle = coalesce(public.vp_txt(p->>'fuente_detalle', 500), case when p ? 'fuente_detalle' then null else t.fuente_detalle end)
  where producto_id = v_id returning * into t;
  return jsonb_build_object('producto_id', v_id, 'version', t.version);
end $$;

-- Propuesta de extracción desde una ficha técnica adjunta (queda pendiente de revisión).
create function public.vp_registrar_extraccion(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare e public.vp_extracciones%rowtype; prod uuid := nullif(p->>'producto_id', '')::uuid; doc uuid := nullif(p->>'documento_id', '')::uuid;
begin
  perform public.vp_exigir_usuario();
  if not exists (select 1 from public.vp_documentos where id = doc and producto_id = prod and estado = 'vigente') then
    raise exception 'VP_EXTRACCION: el archivo no es una ficha vigente de este producto' using errcode = '23503'; end if;
  if jsonb_typeof(p->'propuesta') is distinct from 'array' or jsonb_array_length(p->'propuesta') > 300 then raise exception 'VP_DATO: propuesta inválida' using errcode = '22023'; end if;
  insert into public.vp_extracciones (producto_id, documento_id, metodo, propuesta) values (prod, doc, coalesce(nullif(p->>'metodo', ''), 'texto_pdf'), p->'propuesta') returning * into e;
  return jsonb_build_object('id', e.id);
end $$;
-- Revisión de la propuesta: las filas aceptadas (ya corregidas por la persona) se agregan a la ficha del producto con
-- la referencia al archivo y página de origen. p_aceptadas: [{caracteristica, valor, unidad?, pagina?}]
create function public.vp_resolver_extraccion(p_id uuid, p_aceptadas jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare e public.vp_extracciones%rowtype; x jsonb; car jsonb; n int := 0;
begin
  perform public.vp_exigir_usuario();
  select * into e from public.vp_extracciones where id = p_id for update;
  if not found then raise exception 'VP_EXTRACCION: no encontrada' using errcode = 'P0002'; end if;
  if e.estado <> 'pendiente' then raise exception 'VP_EXTRACCION: ya fue revisada' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(p_aceptadas, '[]')) <> 'array' then raise exception 'VP_DATO: formato inválido' using errcode = '22023'; end if;
  insert into public.vp_productos_tecnicos (producto_id, fuente_tipo, fuente_detalle) values (e.producto_id, 'archivo', (select nombre_archivo from public.vp_documentos where id = e.documento_id))
  on conflict (producto_id) do nothing;
  select caracteristicas into car from public.vp_productos_tecnicos where producto_id = e.producto_id for update;
  for x in select * from jsonb_array_elements(coalesce(p_aceptadas, '[]')) loop
    if public.vp_txt(x->>'caracteristica', 120) is null or public.vp_txt(x->>'valor', 500) is null or lower(btrim(x->>'valor')) = 'no informado' then continue; end if;
    car := car || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('caracteristica', public.vp_txt(x->>'caracteristica', 120), 'valor', public.vp_txt(x->>'valor', 500),
      'unidad', public.vp_txt(x->>'unidad', 30), 'origen', jsonb_strip_nulls(jsonb_build_object('tipo', 'archivo', 'documento_id', e.documento_id, 'pagina', nullif(x->>'pagina', ''))))));
    n := n + 1;
  end loop;
  update public.vp_productos_tecnicos set caracteristicas = car where producto_id = e.producto_id;
  update public.vp_extracciones set estado = case when n > 0 then 'revisada' else 'descartada' end, aceptadas = n, revisada_por = auth.uid(), revisada_en = now() where id = p_id;
  return jsonb_build_object('id', p_id, 'aceptadas', n);
end $$;

-- EETT: guardar borrador. p: {id?, version?, cotizacion_id, contenido:{objeto, alcance, items:[{item_id, orden, cantidad, unidad, nombre, marca, modelo,
-- codigo, descripcion, caracteristicas:[{caracteristica, valor, unidad, excluir?}], condiciones_operacion, condiciones_instalacion, accesorios:[], exclusiones:[],
-- garantia, normas:[], requisitos:[{requisito, ofrecido, cumplimiento, respaldo}], anexos:[documento_id]}], anexos:[…], observaciones}}
create function public.vp_guardar_eett(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare e public.vp_eett%rowtype; c public.vp_cotizaciones%rowtype; r public.vp_cotizacion_revisiones%rowtype; v_id uuid := nullif(p->>'id', '')::uuid; ult public.vp_eett%rowtype;
begin
  perform public.vp_exigir_usuario();
  if jsonb_typeof(p->'contenido') is distinct from 'object' then raise exception 'VP_DATO: contenido inválido' using errcode = '22023'; end if;
  if pg_column_size(p->'contenido') > 2000000 then raise exception 'VP_DATO: el contenido es demasiado grande' using errcode = '22023'; end if;
  select * into c from public.vp_cotizaciones where id = nullif(p->>'cotizacion_id', '')::uuid;
  if not found then raise exception 'VP_COTIZACION: cotización no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_cot(c.id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador prepara EETT' using errcode = '42501'; end if;
  select * into r from public.vp_cotizacion_revisiones where cotizacion_id = c.id and numero = c.revision_actual;
  if v_id is null then
    if exists (select 1 from public.vp_eett where cotizacion_id = c.id and estado = 'borrador') then
      raise exception 'VP_EETT: ya hay un borrador de EETT para esta cotización; ábrelo para continuar' using errcode = '23505'; end if;
    select * into ult from public.vp_eett where cotizacion_id = c.id order by revision desc limit 1;
    insert into public.vp_eett (folio, revision, cotizacion_id, cotizacion_revision_id, contenido)
    values (coalesce(ult.folio, public.vp_siguiente_folio('ET')), coalesce(ult.revision + 1, 0), c.id, r.id, p->'contenido')
    returning * into e;
  else
    select * into e from public.vp_eett where id = v_id and cotizacion_id = c.id for update;
    if not found then raise exception 'VP_EETT: borrador no encontrado' using errcode = 'P0002'; end if;
    if e.estado <> 'borrador' then raise exception 'VP_EETT: una EETT emitida no se modifica (genera una revisión nueva)' using errcode = '42501'; end if;
    if e.version <> coalesce(public.vp_num(p, 'version')::int, -1) then raise exception 'VP409: otra persona guardó este borrador; recarga' using errcode = '40001'; end if;
    update public.vp_eett set contenido = p->'contenido', cotizacion_revision_id = r.id where id = e.id returning * into e;
  end if;
  return jsonb_build_object('id', e.id, 'folio', e.folio, 'revision', e.revision, 'version', e.version);
end $$;

-- Claves prohibidas en una EETT (costos, márgenes y precios comerciales quedan en la cotización).
create function public.vp_tiene_datos_comerciales(j jsonb) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  with recursive t(v) as (select j union all
    select x.value from t, lateral (select value from jsonb_each(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end)
                                    union all select value from jsonb_array_elements(case when jsonb_typeof(t.v) = 'array' then t.v else '[]'::jsonb end)) x)
  select exists (select 1 from t, jsonb_object_keys(case when jsonb_typeof(t.v) = 'object' then t.v else '{}'::jsonb end) k
                 where k ~* '(costo|margen|utilidad|precio|descuento|subtotal|neto|iva|total|recargo)')
$$;

-- Emitir: valida y congela. Reemplaza la emisión anterior del mismo folio (que se conserva) y vincula la EETT a la venta
-- vigente que nació de esa misma revisión de la cotización.
create function public.vp_emitir_eett(p_id uuid, p_version int) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare e public.vp_eett%rowtype; it jsonb; ci public.vp_cotizacion_items%rowtype; x jsonb; n int := 0; v_hash text;
begin
  perform public.vp_exigir_usuario();
  select * into e from public.vp_eett where id = p_id for update;
  if not found then raise exception 'VP_EETT: no encontrada' using errcode = 'P0002'; end if;
  if not public.vp_es_responsable_cot(e.cotizacion_id) then raise exception 'VP_PERMISO: solo el responsable de la cotización o un administrador emite EETT' using errcode = '42501'; end if;
  if e.estado <> 'borrador' then raise exception 'VP_EETT: ya fue emitida' using errcode = '23514'; end if;
  if e.version <> coalesce(p_version, -1) then raise exception 'VP409: el borrador cambió; recarga antes de emitir' using errcode = '40001'; end if;
  if public.vp_tiene_datos_comerciales(e.contenido) then raise exception 'VP_EETT: el contenido incluye costos, márgenes o precios; las EETT no los muestran' using errcode = '23514'; end if;
  if jsonb_typeof(e.contenido->'items') is distinct from 'array' or jsonb_array_length(e.contenido->'items') = 0 then raise exception 'VP_EETT: selecciona al menos un ítem' using errcode = '23514'; end if;
  if public.vp_txt(e.contenido->>'objeto') is null then raise exception 'VP_EETT: falta el objeto del suministro' using errcode = '23514'; end if;
  for it in select * from jsonb_array_elements(e.contenido->'items') loop
    select * into ci from public.vp_cotizacion_items where id = nullif(it->>'item_id', '')::uuid and revision_id = e.cotizacion_revision_id;
    if not found then raise exception 'VP_EETT: un ítem no pertenece a la revisión de la cotización' using errcode = '23503'; end if;
    if (it->>'orden')::int is distinct from ci.orden or (it->>'cantidad')::numeric is distinct from ci.cantidad or it->>'unidad' is distinct from ci.unidad then
      raise exception 'VP_EETT: el ítem % no coincide con la cotización (numeración, cantidad o unidad)', ci.orden using errcode = '23514'; end if;
    for x in select * from jsonb_array_elements(coalesce(it->'caracteristicas', '[]')) loop
      if coalesce((x->>'excluir')::boolean, false) then continue; end if;
      if public.vp_txt(x->>'valor') is null or lower(btrim(x->>'valor')) = 'no informado' then
        raise exception 'VP_EETT: ítem %: «%» está «No informado»; complétalo o exclúyelo antes de emitir', ci.orden, x->>'caracteristica' using errcode = '23514'; end if;
      if coalesce((x->>'pendiente_revision')::boolean, false) then
        raise exception 'VP_EETT: ítem %: «%» viene de una extracción sin revisar', ci.orden, x->>'caracteristica' using errcode = '23514'; end if;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(it->'requisitos', '[]')) loop
      if coalesce(x->>'cumplimiento', 'sin_declarar') not in ('sin_declarar','cumple','no_cumple','equivalente') then
        raise exception 'VP_EETT: cumplimiento inválido en el ítem %', ci.orden using errcode = '22023'; end if;
      if x->>'cumplimiento' in ('cumple','equivalente') and public.vp_txt(x->>'respaldo') is null then
        raise exception 'VP_EETT: ítem %: no se declara cumplimiento ni equivalencia de «%» sin respaldo', ci.orden, x->>'requisito' using errcode = '23514'; end if;
    end loop;
    for x in select * from jsonb_array_elements(coalesce(it->'normas', '[]')) loop
      if public.vp_txt(x->>'respaldo_texto') is null and nullif(x->>'respaldo_documento_id', '') is null then
        raise exception 'VP_EETT: ítem %: la norma «%» no tiene respaldo', ci.orden, x->>'norma' using errcode = '23514'; end if;
    end loop;
    n := n + 1;
  end loop;
  v_hash := encode(sha256(convert_to(e.contenido::text, 'UTF8')), 'hex');
  update public.vp_eett set estado = 'reemplazada' where folio = e.folio and estado = 'emitida';
  update public.vp_eett set estado = 'emitida', hash = v_hash, emitida_en = now(), emitida_por = auth.uid() where id = e.id returning * into e;
  update public.vp_ventas set eett_id = e.id where revision_id = e.cotizacion_revision_id and estado = 'vigente';
  return jsonb_build_object('id', e.id, 'folio', e.folio, 'revision', e.revision, 'hash', v_hash, 'items', n);
end $$;
create function public.vp_descartar_eett(p_id uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare e public.vp_eett%rowtype;
begin
  perform public.vp_exigir_usuario();
  select * into e from public.vp_eett where id = p_id for update;
  if not found or e.estado <> 'borrador' then raise exception 'VP_EETT: solo se descarta un borrador' using errcode = '23514'; end if;
  if not public.vp_es_responsable_cot(e.cotizacion_id) then raise exception 'VP_PERMISO: sin permiso' using errcode = '42501'; end if;
  delete from public.vp_eett where id = p_id;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Vistas (security_invoker: cada usuario ve solo lo que RLS le permite)
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
create view public.vp_clientes_vista with (security_invoker = true) as
select c.id, c.rut, c.rut_clave, c.razon_social, c.giro, c.direccion, c.comuna, c.region, c.contacto_nombre, c.contacto_correo, c.contacto_telefono,
  c.notas, c.activo, c.version, c.creado_por, c.creado_en, (d.cliente_id is not null) as es_venta_privada,
  coalesce(d.tipo_persona, 'empresa') as tipo_persona, d.direccion_entrega, d.comuna_entrega, d.condiciones_pago, d.plazo_pago_dias, d.version as version_datos
from public.pi_clientes c left join public.vp_clientes_datos d on d.cliente_id = c.id;

create view public.vp_cotizaciones_vista with (security_invoker = true) as
select c.id, c.folio, c.cliente_id, cl.razon_social as cliente_nombre, cl.rut as cliente_rut, c.responsable_id, public.vp_nombre(c.responsable_id) as responsable_nombre,
  c.origen_id, c.revision_actual, c.estado, c.version, c.creado_por, c.creado_en, c.actualizado_en,
  r.id as revision_id, r.estado as revision_estado, r.fecha_emision, r.vigencia_hasta, r.neto, r.iva, r.total, r.afecta_iva,
  r.contacto_nombre, r.enviada_en, r.aceptada_en,
  case when c.estado = 'enviada' and r.vigencia_hasta < public.vp_hoy() then 'vencida' else c.estado end as estado_efectivo,
  (r.vigencia_hasta - public.vp_hoy()) as dias_para_vencer,
  ra.id as revision_aceptada_id, ra.numero as revision_aceptada, ra.total as total_aceptado,
  v.id as venta_id, v.folio as venta_folio,
  (select count(*) from public.vp_cotizacion_items i where i.revision_id = r.id) as n_items
from public.vp_cotizaciones c
join public.pi_clientes cl on cl.id = c.cliente_id
join public.vp_cotizacion_revisiones r on r.cotizacion_id = c.id and r.numero = c.revision_actual
left join lateral (select x.id, x.numero, x.total from public.vp_cotizacion_revisiones x where x.cotizacion_id = c.id and x.estado = 'aceptada' order by x.numero desc limit 1) ra on true
left join public.vp_ventas v on v.cotizacion_id = c.id and v.estado = 'vigente';

create view public.vp_ventas_vista with (security_invoker = true) as
with fac as (select venta_id, sum(total) as facturado, sum(neto) as facturado_neto, min(fecha) as primera_factura from public.vp_facturas where estado = 'vigente' group by venta_id),
     pag as (select venta_id, sum(monto) as cobrado, sum(monto) filter (where tipo = 'anticipo') as anticipos, max(fecha) as ultimo_pago from public.vp_pagos where estado = 'vigente' group by venta_id),
     ent as (select vi.venta_id, sum(vi.cantidad) as cant_total,
               sum(least(vi.cantidad, coalesce((select sum(ei.cantidad) from public.vp_entrega_items ei join public.vp_entregas e on e.id = ei.entrega_id
                                                 where ei.venta_item_id = vi.id and e.estado = 'vigente'), 0))) as cant_entregada,
               max((select max(e.fecha) from public.vp_entrega_items ei join public.vp_entregas e on e.id = ei.entrega_id where ei.venta_item_id = vi.id and e.estado = 'vigente')) as ultima_entrega
             from public.vp_venta_items vi group by vi.venta_id),
     venc as (select f.venta_id, sum(f.total) as facturas_vencidas_total, min(f.fecha + v.plazo_pago_dias) as primer_vencimiento
              from public.vp_facturas f join public.vp_ventas v on v.id = f.venta_id
              where f.estado = 'vigente' and f.fecha + v.plazo_pago_dias < public.vp_hoy() group by f.venta_id),
     pvenc as (select f.venta_id, min(f.fecha + v.plazo_pago_dias) as proximo_vencimiento
              from public.vp_facturas f join public.vp_ventas v on v.id = f.venta_id
              where f.estado = 'vigente' group by f.venta_id)
select v.id, v.folio, v.origen, v.cotizacion_id, c.folio as cotizacion_folio, r.numero as cotizacion_revision, v.revision_id, v.eett_id,
  v.cliente_id, cl.razon_social as cliente_nombre, cl.rut as cliente_rut, v.responsable_id, public.vp_nombre(v.responsable_id) as responsable_nombre,
  v.fecha, v.fecha_entrega_comprometida, v.plazo_entrega, v.direccion_entrega, v.condiciones_pago, v.plazo_pago_dias, v.afecta_iva, v.tasa_iva,
  v.bruto, v.descuento, v.neto, v.iva, v.total, v.estado, v.anulada_en, v.anulacion_motivo, v.version, v.creado_en,
  coalesce(fac.facturado, 0) as facturado, coalesce(pag.cobrado, 0) as cobrado, coalesce(pag.anticipos, 0) as anticipos,
  v.total - coalesce(pag.cobrado, 0) as saldo, v.total - coalesce(fac.facturado, 0) as por_facturar,
  coalesce(ent.cant_total, 0) as cant_total, coalesce(ent.cant_entregada, 0) as cant_entregada, ent.ultima_entrega, pag.ultimo_pago,
  case when coalesce(ent.cant_entregada, 0) = 0 then 'pendiente' when ent.cant_entregada < ent.cant_total then 'parcial' else 'entregada' end as estado_entrega,
  case when coalesce(fac.facturado, 0) = 0 then 'sin_facturar' when fac.facturado < v.total then 'parcial' else 'facturada' end as estado_facturacion,
  case when coalesce(pag.cobrado, 0) = 0 then 'pendiente' when pag.cobrado < v.total then 'parcial' else 'pagada' end as estado_pago,
  greatest(coalesce(venc.facturas_vencidas_total, 0) - coalesce(pag.cobrado, 0), 0) as monto_vencido, venc.primer_vencimiento, pvenc.proximo_vencimiento,
  (select string_agg(o.numero, ', ' order by o.fecha) from public.vp_oc_cliente o where o.venta_id = v.id and o.estado = 'vigente') as oc_cliente_numeros
from public.vp_ventas v
join public.pi_clientes cl on cl.id = v.cliente_id
left join public.vp_cotizaciones c on c.id = v.cotizacion_id
left join public.vp_cotizacion_revisiones r on r.id = v.revision_id
left join fac on fac.venta_id = v.id left join pag on pag.venta_id = v.id left join ent on ent.venta_id = v.id
left join venc on venc.venta_id = v.id left join pvenc on pvenc.venta_id = v.id;

-- Márgenes (solo para quien puede ver costos; para los demás todos los valores son nulos, nunca cero).
create view public.vp_margen_revisiones with (security_invoker = true) as
select r.id as revision_id, r.cotizacion_id, r.neto,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario)), 0) from public.vp_cotizacion_items i
       join public.vp_cotizacion_item_costos k on k.item_id = i.id where i.revision_id = r.id) end as costo,
  case when public.vp_es_responsable_cot(r.cotizacion_id) then (select count(*) from public.vp_cotizacion_items i
       where i.revision_id = r.id and not exists (select 1 from public.vp_cotizacion_item_costos k where k.item_id = i.id)) end as lineas_sin_costo
from public.vp_cotizacion_revisiones r;

create view public.vp_margen_ventas with (security_invoker = true) as
select v.id as venta_id, v.neto, v.estado, v.fecha,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(round(i.cantidad * k.costo_unitario_estimado)), 0) from public.vp_venta_items i
       join public.vp_venta_item_costos k on k.item_id = i.id where i.venta_id = v.id) end as costo_estimado,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_venta_items i
       where i.venta_id = v.id and not exists (select 1 from public.vp_venta_item_costos k where k.item_id = i.id)) end as lineas_sin_costo,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(case when k.iva_recuperable then k.neto else k.total end), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente') end as costo_real,
  case when public.vp_es_responsable_venta(v.id) then (select coalesce(sum(k.total), 0) from public.vp_compras k
       where k.venta_id = v.id and k.estado = 'vigente' and k.origen = 'gasto_existente') end as costo_real_desde_gastos,
  case when public.vp_es_responsable_venta(v.id) then (select count(*) from public.vp_compras k where k.venta_id = v.id and k.estado = 'vigente') end as n_compras
from public.vp_ventas v;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- RLS y privilegios
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ declare t text; begin
  foreach t in array array['vp_correlativos','vp_configuracion','vp_clientes_datos','vp_cotizaciones','vp_cotizacion_revisiones','vp_cotizacion_items',
      'vp_cotizacion_item_costos','vp_ventas','vp_venta_items','vp_venta_item_costos','vp_documentos','vp_oc_cliente','vp_entregas','vp_entrega_items',
      'vp_facturas','vp_pagos','vp_pago_imputaciones','vp_compras','vp_productos_tecnicos','vp_extracciones','vp_eett','vp_historial'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
  foreach t in array array['vp_configuracion','vp_clientes_datos','vp_cotizaciones','vp_cotizacion_revisiones','vp_cotizacion_items','vp_ventas','vp_venta_items',
      'vp_oc_cliente','vp_entregas','vp_entrega_items','vp_facturas','vp_pagos','vp_pago_imputaciones','vp_productos_tecnicos','vp_extracciones','vp_eett'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy vp_leer on public.%I for select to authenticated using (public.vp_es_usuario())', t);
  end loop;
end $$;
grant select on public.vp_cotizacion_item_costos, public.vp_venta_item_costos, public.vp_compras, public.vp_documentos, public.vp_historial to authenticated;
create policy vp_leer on public.vp_cotizacion_item_costos for select to authenticated using (public.vp_ve_costos_item_cot(item_id));
create policy vp_leer on public.vp_venta_item_costos for select to authenticated using (public.vp_ve_costos_item_venta(item_id));
create policy vp_leer on public.vp_compras for select to authenticated using (public.vp_es_responsable_venta(venta_id));
create policy vp_leer on public.vp_documentos for select to authenticated
  using (public.vp_es_usuario() and (categoria <> 'compra' or public.vp_es_responsable_venta(venta_id)));
create policy vp_leer on public.vp_historial for select to authenticated
  using (public.vp_es_usuario() and (not sensible or public.vp_es_admin()
         or (venta_id is not null and public.vp_es_responsable_venta(venta_id)) or (venta_id is null and cotizacion_id is not null and public.vp_es_responsable_cot(cotizacion_id))));
-- vp_correlativos: sin acceso para usuarios (solo vp_siguiente_folio).

do $$ declare t text; begin
  foreach t in array array['vp_clientes_vista','vp_cotizaciones_vista','vp_ventas_vista','vp_margen_revisiones','vp_margen_ventas'] loop
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
revoke all on sequence public.vp_historial_id_seq from public, anon, authenticated;

-- Funciones: ninguna ejecutable por anónimos; las RPC y las de consulta usadas por vistas/políticas, para autenticados.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'vp\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.firma);
    if f.proname in ('vp_hoy','vp_es_usuario','vp_es_admin','vp_nombre','vp_documentos_habilitados','vp_es_responsable_cot','vp_es_responsable_venta',
        'vp_ve_costos_item_cot','vp_ve_costos_item_venta','vp_puede_leer_ruta','vp_puede_subir_ruta',
        'vp_configurar','vp_guardar_cliente','vp_guardar_cotizacion','vp_cotizacion_estado','vp_cotizacion_nueva_revision','vp_duplicar_cotizacion',
        'vp_crear_venta_desde_cotizacion','vp_crear_venta_directa','vp_actualizar_venta','vp_registrar_oc_cliente','vp_registrar_entrega','vp_registrar_factura',
        'vp_registrar_pago','vp_imputar_pago','vp_registrar_compra','vp_anular','vp_anular_venta','vp_registrar_documento','vp_guardar_producto',
        'vp_registrar_extraccion','vp_resolver_extraccion','vp_guardar_eett','vp_emitir_eett','vp_descartar_eett','vp_documento_publico') then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
  end loop;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Depósito privado "vp-documentos" (Supabase Storage). Ruta: <ambito>/<id>/<categoria>/<uuid>-<nombre>.
-- Leer: usuarios BFK (los respaldos de compras, solo administrador y responsable) y la cuenta aislada del respaldo
-- diario (solo lectura). Subir: usuarios BFK, solo si la carga
-- está habilitada y la ubicación existe. Sin reemplazo ni eliminación por usuarios (no hay políticas UPDATE/DELETE).
-- Las políticas son PERMISIVAS y limitadas a bucket_id = 'vp-documentos': no cambian el acceso a ningún otro depósito.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
do $$ begin
  if to_regclass('storage.buckets') is null then raise notice 'VP|SIN_STORAGE|'; return; end if;
  if exists (select 1 from storage.buckets where id = 'vp-documentos' or name = 'vp-documentos') then
    raise exception 'VP: ya existe el depósito vp-documentos; no se aplicó nada'; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname like 'vp\_storage%') then
    raise exception 'VP: ya existe una política vp_storage_*; no se aplicó nada'; end if;
  insert into storage.buckets (id, name, public, file_size_limit) values ('vp-documentos', 'vp-documentos', false, 26214400);
  execute $p$create policy vp_storage_leer on storage.objects for select to authenticated
    using (bucket_id = 'vp-documentos' and public.vp_puede_leer_ruta(name))$p$;
  execute $p$create policy vp_storage_subir on storage.objects for insert to authenticated
    with check (bucket_id = 'vp-documentos' and public.vp_puede_subir_ruta(name))$p$;
  -- Respaldo diario de archivos (bfk-respaldos, MODULO=vp): la MISMA cuenta aislada de solo lectura que respalda
  -- pi-documentos (registrada en pi_cuentas_respaldo, sin perfil BFK) puede leer este depósito. No puede subir.
  if to_regprocedure('public.pi_es_lector_respaldo()') is not null then
    execute $p$create policy vp_storage_respaldo_leer on storage.objects for select to authenticated
      using (bucket_id = 'vp-documentos' and public.pi_es_lector_respaldo())$p$;
  else raise notice 'VP|SIN_CUENTA_RESPALDO|la política de lectura para el respaldo se crea cuando exista pi_es_lector_respaldo()';
  end if;
end $$;

notify pgrst, 'reload schema';
commit;
