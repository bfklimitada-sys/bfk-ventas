-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- BORRADOR — Inteligencia Comercial: interruptor central (06/11/2026). NO APLICADO.
-- Requiere autorización expresa de Kevin para ejecutarse en producción. NO es necesario para detener el consumo:
-- api/inteligencia.mjs trata la función ausente como DESACTIVADA. Esta migración solo agrega la forma de reactivar
-- (acción explícita de un administrador) y deja constancia de cada cambio.
-- Una sola transacción:  psql -v ON_ERROR_STOP=1 -1 -f BORRADOR-2026-11-06-ic-interruptor.sql
-- Deshacer:              BORRADOR-2026-11-06-ic-interruptor-deshacer.sql
--
-- Crea: ic_interruptor (una fila, habilitada = false), ic_interruptor_historial, ic_interruptor_estado(),
--       ic_cambiar_interruptor(boolean, text, text).
-- No modifica ninguna tabla, función ni dato existente (ic_resultados, ic_sincronizaciones, etc. quedan intactos).
-- La instalación deja el módulo DESACTIVADO aunque se ejecute varias veces: nunca lo habilita.
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.bfk_es_admin()') is null or to_regprocedure('public.bfk_es_usuario()') is null then
    raise exception 'ICI: faltan las funciones de seguridad BFK; no se aplicó nada'; end if;
  if to_regclass('public.ic_interruptor') is not null then
    raise exception 'ICI: el interruptor ya está instalado; no se aplicó nada'; end if;
end $pre$;

create table public.ic_interruptor (
  id boolean primary key default true check (id),                -- una sola fila
  habilitada boolean not null default false,
  cambiado_por uuid, cambiado_por_nombre text, cambiado_en timestamptz not null default now(), motivo text);
insert into public.ic_interruptor (id, habilitada, motivo) values (true, false, 'Instalación: desactivada por defecto (06/11/2026)');

create table public.ic_interruptor_historial (
  id bigint generated always as identity primary key, habilitada boolean not null,
  cambiado_por uuid, cambiado_por_nombre text, cambiado_en timestamptz not null default now(), motivo text);
insert into public.ic_interruptor_historial (habilitada, motivo) values (false, 'Instalación: desactivada por defecto (06/11/2026)');

alter table public.ic_interruptor enable row level security;
alter table public.ic_interruptor_historial enable row level security;
revoke all on public.ic_interruptor, public.ic_interruptor_historial from public, anon, authenticated;

-- Estado: solo { habilitada: true } habilita. Sin fila → false. Los datos de quién lo cambió solo para usuarios BFK.
create function public.ic_interruptor_estado() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('habilitada', coalesce((select i.habilitada from public.ic_interruptor i where i.id), false))
    || case when public.bfk_es_usuario() then coalesce((select jsonb_build_object('cambiado_en', i.cambiado_en, 'cambiado_por', i.cambiado_por_nombre, 'motivo', i.motivo)
         from public.ic_interruptor i where i.id), '{}'::jsonb) else '{}'::jsonb end
$$;

-- Cambio explícito: solo administradores. Para HABILITAR exige la frase exacta y un motivo.
create function public.ic_cambiar_interruptor(p_habilitar boolean, p_confirmacion text default '', p_motivo text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_nombre text; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.bfk_es_admin() then raise exception 'ICI403: solo un administrador de BFK puede cambiar el estado de Inteligencia Comercial' using errcode = '42501'; end if;
  if p_habilitar is null then raise exception 'ICI400: indique si se habilita o se desactiva' using errcode = '22023'; end if;
  if p_habilitar and coalesce(btrim(p_confirmacion), '') <> 'REACTIVAR INTELIGENCIA COMERCIAL' then
    raise exception 'ICI400: para reactivar escriba exactamente REACTIVAR INTELIGENCIA COMERCIAL' using errcode = '22023'; end if;
  if p_habilitar and v_motivo is null then raise exception 'ICI400: indique el motivo de la reactivación' using errcode = '22023'; end if;
  select p.nombre into v_nombre from public.perfiles p where p.id = auth.uid();
  insert into public.ic_interruptor (id, habilitada, cambiado_por, cambiado_por_nombre, cambiado_en, motivo)
    values (true, p_habilitar, auth.uid(), v_nombre, now(), v_motivo)
    on conflict (id) do update set habilitada = excluded.habilitada, cambiado_por = excluded.cambiado_por,
      cambiado_por_nombre = excluded.cambiado_por_nombre, cambiado_en = excluded.cambiado_en, motivo = excluded.motivo;
  insert into public.ic_interruptor_historial (habilitada, cambiado_por, cambiado_por_nombre, motivo) values (p_habilitar, auth.uid(), v_nombre, v_motivo);
  return public.ic_interruptor_estado();
end $$;

revoke all on function public.ic_interruptor_estado(), public.ic_cambiar_interruptor(boolean, text, text) from public;
grant execute on function public.ic_interruptor_estado() to anon, authenticated;
grant execute on function public.ic_cambiar_interruptor(boolean, text, text) to authenticated;
