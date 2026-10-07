-- Deshace 2026-10-07-conciliacion-banco.sql usando fin_correcciones_registro (lote 'conciliacion-banco-20261007'),
-- en orden inverso. Una sola transacción:  psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-conciliacion-banco-deshacer.sql
-- Cada campo vuelve a su valor anterior solo si hoy sigue con el valor que dejó la corrección; si alguien lo
-- cambió después, se aborta todo (no se pisa trabajo posterior). Filas quitadas: se reinsertan completas.
do $$
declare r record; v_actual text; v_n int := 0;
begin
  for r in select * from public.fin_correcciones_registro where lote = 'conciliacion-banco-20261007' and revertida_en is null order by id desc loop
    if r.campo = '*fila_nueva*' then
      execute format('delete from public.%I where id = %L', r.tabla, r.fila_id);
    elsif r.campo = '*fila*' then
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, %L::jsonb)', r.tabla, r.tabla, r.antes);
    else
      execute format('select %I::text from public.%I where id = %L', r.campo, r.tabla, r.fila_id) into v_actual;
      if v_actual is distinct from r.despues then
        raise exception 'CONC-BANCO-DESHACER: %.% de % cambió después de la corrección (hoy %, esperado %). No se deshizo nada.',
          r.tabla, r.campo, r.fila_id, v_actual, r.despues;
      end if;
      execute format('update public.%I set %I = %L where id = %L', r.tabla, r.campo, r.antes, r.fila_id);
    end if;
    update public.fin_correcciones_registro set revertida_en = now() where id = r.id;
    v_n := v_n + 1;
  end loop;
  if exists (select 1 from public.fin_verificar_consistencia()) then
    raise exception 'CONC-BANCO-DESHACER: la base quedaría inconsistente; no se deshizo nada';
  end if;
  raise notice 'CONC-BANCO-DESHACER: OK (% cambios revertidos)', v_n;
end $$;
