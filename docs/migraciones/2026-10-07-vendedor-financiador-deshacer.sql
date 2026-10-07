-- Deshace 2026-10-07-vendedor-financiador.sql (solo estructura; no toca datos). Una transacción.
drop trigger if exists oc_proteger_vendedor on public.ordenes_compra_v2;
drop function if exists public.oc_trg_proteger_vendedor();
drop function if exists public.asignar_vendedor_oc(text, text);
drop function if exists public.asignar_financiador_oc(text, text);
drop function if exists public.fin_periodo_comision(text);
do $$ begin raise notice 'VEND-FIN-DESHACER: OK'; end $$;
