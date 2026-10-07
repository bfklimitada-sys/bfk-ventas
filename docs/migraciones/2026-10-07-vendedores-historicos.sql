-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Vendedor de OCs históricas sin vendedor (2026-10-07). Requiere 2026-10-07-vendedor-financiador.sql.
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-vendedores-historicos.sql
-- Evidencia determinística: Contabilidad General importada (cg_import), una sola fila por N° de OC, cuyo vendedor
-- corresponde a un único vendedor, y cuyo financiador coincide con el de la OC. Solo las OCs para las que la
-- auditoría verificó (con el cálculo de la app sobre los datos reales) que asignar el vendedor NO cambia ninguna
-- comisión de ningún mes, ni sola ni junto a las demás OCs de su mes. No toca dinero ni financiadores.
-- Idempotente: OC ya con ese vendedor → se omite; OC con otro vendedor o sin la evidencia → se bloquea (no se toca).
-- Deshacer: 2026-10-07-vendedores-historicos-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════
do $$
declare r record; v_cg record; v_n int := 0; v_omit int := 0; v_bloq int := 0; v_vnom text;
begin
  if to_regprocedure('public.asignar_vendedor_oc(text,text)') is null then raise exception 'VEND-HIST: falta la migración vendedor-financiador'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'VEND-HIST: base inconsistente antes de empezar'; end if;
  for r in select * from (values
      ('ocv2_hist_0191', '4454-430-AG24', 'vend_matias'), ('ocv2_hist_0186', '2785-676-AG24', 'vend_matias'),
      ('ocv2_hist_0187', '3892-750-AG24', 'vend_matias'), ('ocv2_cg_0001', 'junta de vecino la estacion', 'vend_matias')) x(id, numero, vend) loop
    if exists (select 1 from public.ordenes_compra_v2 o where o.id = r.id and o.vendedor_id = r.vend) then
      v_omit := v_omit + 1; raise notice 'VEND-HIST|%|YA_APLICADA', r.numero; continue;
    end if;
    select c.* into v_cg from public.cg_import c join public.ordenes_compra_v2 o on upper(btrim(c.oc)) = upper(btrim(o.numero_oc)) where o.id = r.id;
    select nombre into v_vnom from public.vendedores where id = r.vend;
    if not exists (select 1 from public.ordenes_compra_v2 o where o.id = r.id and o.numero_oc = r.numero and o.vendedor_id is null)
       or (select count(*) from public.cg_import c join public.ordenes_compra_v2 o on upper(btrim(c.oc)) = upper(btrim(o.numero_oc)) where o.id = r.id) <> 1
       or lower(v_cg.vendedor) <> lower(translate(split_part(v_vnom, ' ', 1), 'áéíóú', 'aeiou')) then
      v_bloq := v_bloq + 1; raise notice 'VEND-HIST|%|BLOQUEADA|pre-estado o evidencia distinta', r.numero; continue;
    end if;
    update public.ordenes_compra_v2 set vendedor_id = r.vend where id = r.id and vendedor_id is null;
    insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
    values ('vendedor-financiador-20261007', 'ordenes_compra_v2', r.id, 'vendedor_id', null, r.vend,
            'Vendedor según Contabilidad General (cg_import: vendedor ' || v_cg.vendedor || ', financiador ' || v_cg.fin || '); no cambia comisiones');
    insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
    values (public.fin_nuevo_id('hc'), r.id, r.numero, null, 'Migración vendedor/financiador', 'Vendedor completado desde Contabilidad General', 'vendedor_id', 'Sin definir', v_vnom);
    v_n := v_n + 1; raise notice 'VEND-HIST|%|APLICADA|%', r.numero, v_vnom;
  end loop;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'VEND-HIST: la base quedó inconsistente; no se aplica nada'; end if;
  raise notice 'VEND-HIST: OK (% aplicadas, % ya aplicadas, % bloqueadas)', v_n, v_omit, v_bloq;
end $$;
