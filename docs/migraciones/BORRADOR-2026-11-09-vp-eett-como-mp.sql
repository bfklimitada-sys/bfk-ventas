-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VENTAS PRIVADAS — EETT con el mismo recorrido de Mercado Público (09/11/2026).
-- BORRADOR. NO APLICADO. Requiere autorización expresa para aplicarse en producción (con respaldo previo).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-09-vp-eett-como-mp.sql
-- Recuperación:                 BORRADOR-2026-11-09-vp-eett-como-mp-deshacer.sql
--
-- Qué cambia: SOLO una nueva versión de public.vp_emitir_eett (mismo nombre, argumentos, permisos y comportamiento), con dos
-- diferencias que se aplican únicamente al contenido nuevo (vp_eett.contenido->>'formato' = 'mp', el que genera la pestaña EETT
-- de la cotización desde el 09/11/2026):
--   · no exige «objeto del suministro» (la EETT de Mercado Público no lo tiene);
--   · exige el nombre de cada producto (regla de bloqueo de Mercado Público).
-- Todas las demás validaciones siguen iguales para ambos formatos: ítems de la revisión de la cotización con su numeración,
-- cantidad y unidad; sin costos, márgenes ni precios; características sin «No informado»; cumplimiento y normas con respaldo.
-- Para el contenido anterior (sin «formato») la función se comporta exactamente como hoy.
-- Qué NO cambia: tablas, columnas, filas, EETT emitidas o en borrador, ventas y sus vínculos (vp_ventas.eett_id),
-- vp_guardar_eett, vp_crear_venta_desde_cotizacion, permisos, historial, Mercado Público. No agrega sincronizaciones ni
-- consumo de IA; Inteligencia Comercial no se toca.
-- Antes de cambiar nada comprueba que vp_emitir_eett es exactamente la instalada el 07/11/2026 (huella del cuerpo); si no lo
-- es, se detiene sin cambios.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regclass('public.vp_eett') is null then raise exception 'VPET: Ventas privadas no está instalado; no se cambió nada'; end if;
  if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'vp_emitir_eett' and md5(p.prosrc) = 'c5710ab071ea0f70b4d75d655b723be4') then
    raise exception 'VPET: vp_emitir_eett no es la versión del 07/11/2026 (¿migración ya aplicada?); no se cambió nada'; end if;
end $$;

-- Emitir: valida y congela. Reemplaza la emisión anterior del mismo folio (que se conserva) y vincula la EETT a la venta
-- vigente que nació de esa misma revisión de la cotización.
create or replace function public.vp_emitir_eett(p_id uuid, p_version int) returns jsonb
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
  -- Formato «mp» (09/11/2026, mismo recorrido de Mercado Público): no se pide objeto del suministro. Formato anterior: sin cambios.
  if coalesce(e.contenido->>'formato', '') <> 'mp' and public.vp_txt(e.contenido->>'objeto') is null then raise exception 'VP_EETT: falta el objeto del suministro' using errcode = '23514'; end if;
  for it in select * from jsonb_array_elements(e.contenido->'items') loop
    select * into ci from public.vp_cotizacion_items where id = nullif(it->>'item_id', '')::uuid and revision_id = e.cotizacion_revision_id;
    if not found then raise exception 'VP_EETT: un ítem no pertenece a la revisión de la cotización' using errcode = '23503'; end if;
    -- Como en Mercado Público: sin el nombre exacto del producto no se genera la EETT.
    if coalesce(e.contenido->>'formato', '') = 'mp' and public.vp_txt(it->>'nombre') is null then
      raise exception 'VP_EETT: ítem %: falta el nombre exacto del producto', ci.orden using errcode = '23514'; end if;
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

-- Permisos: los mismos de antes (create or replace los conserva; se reafirman por claridad).
revoke all on function public.vp_emitir_eett(uuid, integer) from public, anon, authenticated;
grant execute on function public.vp_emitir_eett(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
commit;
