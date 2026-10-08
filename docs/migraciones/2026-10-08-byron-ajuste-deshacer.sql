-- Deshace aplicar.sql (byron) desde fin_correcciones_registro (lote 'byron-ajuste-20261008'), en orden inverso.
-- Filas nuevas: se borran. Campos: vuelven al valor anterior solo si
-- siguen con el valor que dejó la corrección (si alguien los cambió después, se aborta todo).
do $$
declare r record; v_actual text; v_n int := 0;
begin
  for r in select * from public.fin_correcciones_registro where lote = 'byron-ajuste-20261008' and revertida_en is null order by id desc loop
    if r.campo = '*fila_nueva*' then
      execute format('delete from public.%I where id = %L', r.tabla, r.fila_id);
    elsif r.campo = '*fila*' then
      execute format('delete from public.%I where id = %L', r.tabla, r.fila_id);
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb)', r.tabla, r.tabla, r.antes);
    else
      execute format('select %I::text from public.%I where id = %L', r.campo, r.tabla, r.fila_id) into v_actual;
      if v_actual is distinct from r.despues then
        raise exception 'BYRON-DESHACER: %.% de % cambió después (hoy %, esperado %). No se deshizo nada.', r.tabla, r.campo, r.fila_id, v_actual, r.despues;
      end if;
      execute format('update public.%I set %I = %L where id = %L', r.tabla, r.campo, r.antes, r.fila_id);
    end if;
    update public.fin_correcciones_registro set revertida_en = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'BYRON-DESHACER: la base quedaría inconsistente'; end if;
  raise notice 'BYRON-DESHACER: OK (% cambios revertidos)', v_n;
end $$;
do $$ begin
  if (select string_agg(id || '=' || saldo_deuda, ' ' order by id) from public.financiadores)
     <> 'fin_byron=6016699 fin_cuenta_bfk=0 fin_francisco=0 fin_kevin=0 fin_matias=0' then
    raise exception 'BYRON-DESHACER: saldos tras deshacer distintos a los originales';
  end if;
end $$;
