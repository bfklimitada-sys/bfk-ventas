-- Deshacer BORRADOR-2026-11-11-vp-financiamiento-vendedor.sql — SIN PÉRDIDA DE DATOS.
-- Quita las funciones, disparadores de comportamiento y vistas nuevas: Ventas privadas vuelve a funcionar exactamente como en
-- 1d47499 (la interfaz anterior no usa nada de esto). Los DATOS se conservan:
--   · vp_fin_aportes / vp_fin_devoluciones: si tienen filas, quedan como están (solo lectura para administrador y responsable,
--     sin borrado ni modificación); si están vacías, se eliminan.
--   · vendedor_tipo / vendedor_id / vendedor_nombre de cotizaciones y ventas: si hay algún vendedor asignado, las columnas se
--     conservan (nulas en lo demás); si todas están vacías, se eliminan.
-- Volver a aplicar la migración después de este script reutiliza lo conservado (no duplica ni pierde nada).
-- Ejecutar en UNA transacción:  psql "$DB" -v ON_ERROR_STOP=1 -f BORRADOR-2026-11-11-vp-financiamiento-vendedor-deshacer.sql
begin;
set local lock_timeout = '5s';

do $$ begin
  if to_regprocedure('public.vp_fin_registrar_aportes(jsonb)') is null then raise exception 'VPFIN-DESHACER: la migración no está aplicada; no se cambió nada'; end if;
end $$;

drop trigger vp_20_vendedor on public.vp_cotizaciones;
drop trigger vp_20_vendedor on public.vp_ventas;
drop trigger vp_30_financiamiento on public.vp_compras;
drop view public.vp_fin_aportantes;
drop view public.vp_fin_resumen;
drop function public.vp_guardar_cotizacion_v2(jsonb);
drop function public.vp_crear_venta_directa_v2(jsonb);
drop function public.vp_asignar_vendedor(text, uuid, text, integer);
drop function public.vp_vendedor_igual(text, text, text);
drop function public.vp_marcar_vendedor(text);
drop function public.vp_quitar_marca_vendedor();
drop function public.vp_trg_vendedor();
drop function public.vp_registrar_compra_financiada(jsonb);
drop function public.vp_registrar_compra_manual_financiada(jsonb);
drop function public.vp_fin_registrar_aportes(jsonb);
drop function public.vp_fin_registrar_devolucion(jsonb);
drop function public.vp_fin_anular(text, uuid, text);
drop function public.vp_fin_aporte_interno(uuid, jsonb, text);
drop function public.vp_fin_bloquear_venta(uuid);
drop function public.vp_fin_trg_compra();
drop function public.vp_fin_validar(uuid);
drop function public.vp_fin_total_compras(uuid);
drop function public.vp_fin_pesos(numeric);

do $$ declare n int; t text; begin
  select (select count(*) from public.vp_fin_aportes) + (select count(*) from public.vp_fin_devoluciones) into n;
  if n = 0 then
    drop table public.vp_fin_devoluciones; drop table public.vp_fin_aportes;
    drop function public.vp_fin_proteger(); drop function public.vp_fin_auditar();
    raise notice 'VPFIN-DESHACER|financiamiento|sin datos: tablas eliminadas';
  else
    raise notice 'VPFIN-DESHACER|financiamiento|% registros CONSERVADOS (solo lectura)', n;
  end if;
  foreach t in array array['vp_cotizaciones','vp_ventas'] loop
    execute format('select count(*) from public.%I where vendedor_tipo is not null', t) into n;
    if n = 0 then
      execute format('alter table public.%I drop constraint %I', t, t || '_vendedor_chk');
      if t = 'vp_ventas' then drop index public.vp_ventas_vendedor; end if;
      execute format('alter table public.%I drop column vendedor_tipo, drop column vendedor_id, drop column vendedor_nombre', t);
      raise notice 'VPFIN-DESHACER|%|sin vendedores asignados: columnas eliminadas', t;
    else
      raise notice 'VPFIN-DESHACER|%|% vendedores asignados CONSERVADOS', t, n;
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
commit;
