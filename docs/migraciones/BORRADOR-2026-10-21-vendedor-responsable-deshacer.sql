-- REVERSIÓN de BORRADOR-2026-10-21-vendedor-responsable.sql. No toca cotizaciones, OC ni comisiones (los vendedores
-- ya asignados se conservan). Si la bitácora tiene datos, se detiene salvo: set bfk.vend_descartar = 'si'; (exportarla antes).
begin;
set local lock_timeout = '5s';
do $_$
begin
  if to_regclass('public.cotizacion_vendedor_historial') is not null and exists (select 1 from public.cotizacion_vendedor_historial)
     and coalesce(current_setting('bfk.vend_descartar', true), '') <> 'si' then
    raise exception 'REVERSION_DETENIDA: la bitácora de vendedores tiene datos; exportarla y confirmar con set bfk.vend_descartar = ''si''';
  end if;
end $_$;
drop trigger if exists cz_vendedor_responsable on public.cotizaciones;
drop function if exists public.cz_transferir_vendedor_a_oc(uuid);
drop function if exists public.cz_trg_vendedor_responsable();
drop function if exists public.cz_vendedor_catalogo(text, boolean);
drop table if exists public.cotizacion_vendedor_historial;
do $_$
begin
  if exists (select 1 from pg_trigger where tgname = 'cz_vendedor_responsable')
     or exists (select 1 from pg_proc where proname in ('cz_transferir_vendedor_a_oc', 'cz_trg_vendedor_responsable', 'cz_vendedor_catalogo'))
     or to_regclass('public.cotizacion_vendedor_historial') is not null then
    raise exception 'VERIFICACION: la reversión dejó objetos'; end if;
end $_$;
commit;
