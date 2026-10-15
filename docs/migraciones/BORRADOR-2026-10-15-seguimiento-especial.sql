-- ═══════════════════════════════════════════════════════════════
-- BORRADOR (pendiente de autorización) · 15/10/2026 · Seguimiento especial de OC
-- Agrega UNA tabla nueva: public.oc_seguimientos. No modifica ninguna tabla, función, política ni dato existente.
--
-- Por qué una tabla nueva: eventos_postventa no sirve (su costo_extra se descuenta de la utilidad, cambia
-- estado_postventa de la OC y no tiene prioridad, responsable ni fecha de revisión); oc_comentarios y
-- oc_responsables no tienen estado ni resolución. Reutilizar campos financieros u observaciones está prohibido.
-- Lo que SÍ se reutiliza: historial_cambios (avances y cada cambio de responsable, prioridad y estado, con autor
-- y fecha), el bloqueo de edición de OC de la aplicación y el criterio de permisos de las tablas hijas de la OC.
--
-- Reglas:
--  · sobrecosto_estimado es SOLO informativo: ninguna función financiera lo lee (no es compra, gasto, deuda ni utilidad).
--  · Leer, crear y actualizar: usuarios autenticados (igual que oc_comentarios / eventos_postventa).
--    Eliminar: solo administradores (igual que historial_cambios y ordenes_compra_v2).
--  · Un seguimiento RESUELTO queda congelado (historial): solo un administrador puede modificarlo.
--  · Resolver exige describir la solución; quién y cuándo lo resolvió se registran automáticamente.
--  · Autor y fecha de creación se fijan en la base (no los envía el navegador) y no se pueden cambiar.
-- ═══════════════════════════════════════════════════════════════
begin;

create table public.oc_seguimientos (
  id                   text primary key,
  oc_id                text not null references public.ordenes_compra_v2(id) on delete restrict,
  categoria            text not null check (categoria in ('postventa','sobrecosto','proveedor','producto','entrega','cliente','facturacion','otro')),
  descripcion          text not null check (length(btrim(descripcion)) > 0),
  prioridad            text not null default 'media' check (prioridad in ('baja','media','alta')),
  estado               text not null default 'pendiente' check (estado in ('pendiente','en_gestion','resuelto')),
  responsable_id       uuid references public.perfiles(id) on delete set null,
  responsable_nombre   text,
  fecha_revision       date,
  sobrecosto_estimado  numeric(14,0) check (sobrecosto_estimado is null or sobrecosto_estimado >= 0),
  solucion             text,
  resuelto_por         uuid,
  resuelto_por_nombre  text,
  resuelto_en          timestamptz,
  creado_por           uuid,
  creado_por_nombre    text,
  creado_en            timestamptz not null default now(),
  actualizado_por      uuid,
  actualizado_en       timestamptz,
  constraint oc_seguimientos_resuelto_con_solucion check (estado <> 'resuelto' or (length(btrim(coalesce(solucion,''))) > 0 and resuelto_en is not null))
);
create index oc_seguimientos_oc_idx on public.oc_seguimientos (oc_id);
create index oc_seguimientos_abiertos_idx on public.oc_seguimientos (oc_id) where estado <> 'resuelto';
comment on table public.oc_seguimientos is 'Seguimiento especial de OC (situaciones que requieren atención). sobrecosto_estimado es solo informativo: no es compra, gasto, deuda ni utilidad.';

create or replace function public.seg_es_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.perfiles p where p.id = auth.uid() and p.rol = 'admin')
$$;
revoke all on function public.seg_es_admin() from public;
grant execute on function public.seg_es_admin() to authenticated;

-- Metadatos fijados por la base: autor, fechas y resolución; protege lo creado y lo ya resuelto.
create or replace function public.seg_antes_guardar() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_nombre text;
begin
  if v_uid is null then raise exception 'Se requiere una sesión válida'; end if;
  select p.nombre into v_nombre from public.perfiles p where p.id = v_uid;
  if tg_op = 'INSERT' then
    new.creado_por := v_uid; new.creado_por_nombre := coalesce(v_nombre, ''); new.creado_en := now();
    new.actualizado_por := null; new.actualizado_en := null;
    if new.estado = 'resuelto' then raise exception 'Un seguimiento se crea abierto (Pendiente o En gestión)'; end if;
    new.solucion := null; new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
    return new;
  end if;
  -- UPDATE
  if new.id <> old.id or new.oc_id <> old.oc_id or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en or new.creado_por_nombre is distinct from old.creado_por_nombre then
    raise exception 'No se puede cambiar la OC, el autor ni la fecha de creación de un seguimiento';
  end if;
  if old.estado = 'resuelto' and not public.seg_es_admin() then
    raise exception 'Este seguimiento ya está resuelto: queda como historial (solo un administrador puede modificarlo)';
  end if;
  if new.estado = 'resuelto' and old.estado <> 'resuelto' then
    if length(btrim(coalesce(new.solucion, ''))) = 0 then raise exception 'Para resolver, describe brevemente la solución'; end if;
    new.resuelto_por := v_uid; new.resuelto_por_nombre := coalesce(v_nombre, ''); new.resuelto_en := now();
  elsif new.estado <> 'resuelto' then
    new.resuelto_por := null; new.resuelto_por_nombre := null; new.resuelto_en := null;
  else
    new.resuelto_por := old.resuelto_por; new.resuelto_por_nombre := old.resuelto_por_nombre; new.resuelto_en := old.resuelto_en;
  end if;
  new.actualizado_por := v_uid; new.actualizado_en := now();
  return new;
end $$;
create trigger seg_antes_guardar before insert or update on public.oc_seguimientos
  for each row execute function public.seg_antes_guardar();

alter table public.oc_seguimientos enable row level security;
create policy seg_leen on public.oc_seguimientos for select to authenticated using (auth.role() = 'authenticated');
create policy seg_crean on public.oc_seguimientos for insert to authenticated with check (auth.role() = 'authenticated');
create policy seg_editan on public.oc_seguimientos for update to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy seg_solo_admin_borra on public.oc_seguimientos for delete to authenticated using (public.seg_es_admin());
grant select, insert, update, delete on public.oc_seguimientos to authenticated;

commit;
