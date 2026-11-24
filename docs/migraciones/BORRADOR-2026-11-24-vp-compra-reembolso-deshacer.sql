-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- DESHACER: BORRADOR-2026-11-24-vp-compra-reembolso.sql
-- Quita las funciones, el disparador y las columnas nuevas. ATENCIÓN: si ya se usaron, se pierde la información de
-- reembolsos y de gastos anulados (los gastos anulados vuelven a contar como gastos normales). Por eso este script se
-- DETIENE si hay datos en esas columnas, salvo que se ejecute con  -v forzar=1  (después de respaldar).
-- ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════
\if :{?forzar}
\else
\set forzar 0
\endif
begin;
set local lock_timeout = '5s';
select set_config('vpre.forzar', :'forzar', true);
do $$ declare n_g int := 0; n_r int := 0; begin
  if to_regprocedure('public.vp_anular_compra(uuid,text,boolean,numeric)') is null then
    raise exception 'VPRE: la migración no está aplicada; no se cambió nada'; end if;
  select count(*) into n_g from public.gastos_indirectos where anulado_en is not null;
  select count(*) into n_r from public.vp_compras where reembolso_estado is not null;
  if (n_g > 0 or n_r > 0) and current_setting('vpre.forzar') <> '1' then
    raise exception 'VPRE: hay % gasto(s) anulado(s) y % reembolso(s) registrados; respalda y usa -v forzar=1', n_g, n_r; end if;
end $$;
drop trigger if exists vp_compras_gasto_no_anulado on public.vp_compras;
drop function if exists public.vp_gasto_no_anulado();
drop function if exists public.vp_deshacer_reembolso(uuid, text);
drop function if exists public.vp_registrar_reembolso(uuid, date, numeric, text);
drop function if exists public.vp_anular_compra(uuid, text, boolean, numeric);
drop function if exists public.vp_marca_cartola_usada(text, uuid);
drop index if exists public.vp_compras_reembolso;
drop index if exists public.vp_compras_reembolso_marca_unica;
alter table public.vp_compras drop constraint if exists vp_compras_reembolso_coherente,
  drop column if exists reembolso_estado, drop column if exists reembolso_monto, drop column if exists reembolso_fecha,
  drop column if exists reembolso_marca, drop column if exists reembolso_registrado_por, drop column if exists reembolso_registrado_en;
alter table public.gastos_indirectos drop constraint if exists gastos_anulacion_coherente,
  drop column if exists anulado_en, drop column if exists anulado_por, drop column if exists anulacion_motivo, drop column if exists anulacion_ref;
notify pgrst, 'reload schema';
commit;
