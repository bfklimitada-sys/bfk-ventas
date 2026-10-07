-- Deshace 2026-10-07-vendedores-historicos.sql: vuelve a dejar sin vendedor solo las OCs que completó y que
-- siguen con ese mismo vendedor (si alguien lo cambió después, se aborta todo).
do $$
declare r record; v_n int := 0;
begin
  for r in select * from public.fin_correcciones_registro where lote = 'vendedor-financiador-20261007' and revertida_en is null order by id desc loop
    if not exists (select 1 from public.ordenes_compra_v2 o where o.id = r.fila_id and o.vendedor_id = r.despues) then
      raise exception 'VEND-HIST-DESHACER: el vendedor de % cambió después; no se deshizo nada', r.fila_id;
    end if;
    update public.ordenes_compra_v2 set vendedor_id = null where id = r.fila_id;
    update public.fin_correcciones_registro set revertida_en = now() where id = r.id;
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
    select public.fin_nuevo_id('hc'), o.id, o.numero_oc, null, 'Migración vendedor/financiador', 'Vendedor completado: deshecho', 'vendedor_id', r.despues, 'Sin definir'
      from public.ordenes_compra_v2 o where o.id = r.fila_id;
    v_n := v_n + 1;
  end loop;
  raise notice 'VEND-HIST-DESHACER: OK (% revertidas)', v_n;
end $$;
