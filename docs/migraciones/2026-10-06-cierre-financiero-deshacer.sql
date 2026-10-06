-- Deshace 2026-10-06-cierre-financiero.sql (lote 'cierre-financiero'):
-- reinserta el gasto tal cual estaba y quita los bloqueos agregados.
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-06-cierre-financiero-deshacer.sql
do $$ begin
  if not exists (select 1 from public.fin_correcciones_registro where lote = 'cierre-financiero' and revertida_en is null) then
    raise exception 'CIERRE-FIN-DESHACER: no hay cierre aplicado';
  end if;
end $$;
insert into public.gastos_indirectos
select (jsonb_populate_record(null::public.gastos_indirectos, r.antes::jsonb)).*
  from public.fin_correcciones_registro r where r.lote = 'cierre-financiero' and r.revertida_en is null and r.tabla = 'gastos_indirectos';
delete from public.fin_diferencias_historicas d using public.fin_correcciones_registro r
 where r.lote = 'cierre-financiero' and r.revertida_en is null and r.tabla = 'fin_diferencias_historicas' and d.id = r.fila_id::bigint;
update public.fin_correcciones_registro set revertida_en = now() where lote = 'cierre-financiero' and revertida_en is null;
do $$ begin
  if (select count(*) from public.fin_verificar_consistencia()) > 0 then raise exception 'CIERRE-FIN-DESHACER: inconsistencia'; end if;
end $$;
