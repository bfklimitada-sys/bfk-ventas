-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER 17/11/2026 · Centro de Acciones Pendientes (2026-11-17-centro-acciones.sql)
-- Conserva TODOS los datos: ninguna acción, comentario ni línea del historial se borra.
--   1. Siempre: retira las acciones automáticas (disparadores de postventa y entrega, función de entrega fallida), el
--      historial automático y vuelve a la función seg_antes_guardar del 15/10/2026 (lo resuelto: solo administradores).
--   2. Estructura: si NO hay datos que dependan de ella (acciones sin OC, con título, cliente u origen, o categorías nuevas
--      en uso), vuelve exactamente a la tabla del 15/10/2026 (oc_id obligatorio, categorías fijas) y elimina el catálogo.
--      Si hay datos, la estructura se conserva tal cual (columnas, catálogo e índices) y se informa: así no se pierde nada.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

drop trigger if exists acc_postventa on public.eventos_postventa;
drop trigger if exists acc_entrega on public.eventos_entrega;
drop trigger if exists acc_historial on public.oc_seguimientos;
drop function if exists public.acc_trg_postventa();
drop function if exists public.acc_trg_entrega();
drop function if exists public.acc_registrar_entrega_fallida(text, text, text);
drop function if exists public.acc_historial();

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
revoke all on function public.seg_antes_guardar() from public, anon, authenticated;

do $$
declare n_dep bigint;
begin
  select count(*) into n_dep from public.oc_seguimientos
   where oc_id is null or titulo is not null or cliente is not null or origen is not null
      or categoria not in ('postventa','sobrecosto','proveedor','producto','entrega','cliente','facturacion','otro');
  if n_dep > 0 then
    raise notice 'ACC-DESHACER|estructura_conservada|acciones_que_la_usan=%|(sin pérdida de datos; las automáticas quedan como registros normales)', n_dep;
    return;
  end if;
  drop index if exists public.oc_seguimientos_origen_postventa_uk;
  drop index if exists public.oc_seguimientos_fallida_abierta_uk;
  drop index if exists public.oc_seguimientos_bandeja_idx;
  alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_titulo_check;
  alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_cliente_check;
  alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_sin_oc_titulo;
  alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_origen_check;
  alter table public.oc_seguimientos drop column titulo, drop column cliente, drop column origen, drop column origen_id;
  alter table public.oc_seguimientos alter column oc_id set not null;
  alter table public.oc_seguimientos drop constraint if exists oc_seguimientos_categoria_fkey;
  alter table public.oc_seguimientos add constraint oc_seguimientos_categoria_check
    check (categoria in ('postventa','sobrecosto','proveedor','producto','entrega','cliente','facturacion','otro'));
  drop table public.acciones_categorias;
  drop function if exists public.acc_categoria_guardar();
  drop function if exists public.acc_txt_fecha(date);
  drop function if exists public.acc_txt_prioridad(text);
  drop function if exists public.acc_txt_estado(text);
  drop function if exists public.acc_txt_categoria(text);
  drop function if exists public.acc_txt_pesos(numeric);
  drop function if exists public.acc_txt_desc(text);
  drop function if exists public.acc_txt_tipo_pv(text);
  comment on table public.oc_seguimientos is 'Seguimiento especial de OC (situaciones que requieren atención). sobrecosto_estimado es solo informativo: no es compra, gasto, deuda ni utilidad.';
  comment on column public.oc_seguimientos.oc_id is null;
  comment on column public.oc_seguimientos.fecha_revision is null;
  raise notice 'ACC-DESHACER|estructura_restaurada_al_15_10_2026';
end $$;
commit;
