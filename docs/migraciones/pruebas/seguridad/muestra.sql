-- Muestra de una fila real por tabla (leída como postgres) para intentar escribir con cada cuenta. Uso: \ir muestra.sql
create schema seg_probe;
grant usage on schema seg_probe to anon, authenticated;
-- Una fila real de cada tabla (leída como postgres) para intentar escribir con cada cuenta.
create table seg_probe.muestra (tabla text primary key, fila jsonb, pk text[], nueva jsonb, total bigint);
grant select on seg_probe.muestra to anon, authenticated;
do $m$
declare r record; v_pk text[]; v_fila jsonb; v_nueva jsonb; v_tot bigint; col record;
begin
  for r in select n.nspname || '.' || quote_ident(c.relname) t, c.oid, c.relkind from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where (n.nspname = 'public' and c.relkind in ('r', 'v', 'p')) or (n.nspname = 'storage' and c.relname in ('objects', 'buckets')) loop
    select array_agg(a.attname::text order by k.ord) into v_pk
      from pg_constraint co cross join lateral unnest(co.conkey) with ordinality k(att, ord) join pg_attribute a on a.attrelid = co.conrelid and a.attnum = k.att
     where co.conrelid = r.oid and co.contype = 'p';
    execute format('select count(*) from %s', r.t) into v_tot;
    execute format('select to_jsonb(x) from %s x limit 1', r.t) into v_fila;
    v_nueva := v_fila;
    if v_fila is not null and v_pk is not null then
      for col in select a.attname, format_type(a.atttypid, a.atttypmod) ty, a.attidentity, pg_get_expr(d.adbin, d.adrelid) def
                 from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                where a.attrelid = r.oid and a.attname = any(v_pk) loop
        if col.attidentity <> '' or col.def is not null then v_nueva := v_nueva - col.attname::text;
        elsif col.ty = 'uuid' then v_nueva := jsonb_set(v_nueva, array[col.attname::text], to_jsonb(gen_random_uuid()));
        elsif col.ty in ('text', 'character varying') then v_nueva := jsonb_set(v_nueva, array[col.attname::text], to_jsonb('segp_' || md5(random()::text)));
        elsif col.ty in ('integer', 'bigint', 'smallint', 'numeric') then v_nueva := jsonb_set(v_nueva, array[col.attname::text], to_jsonb(900000000 + (random() * 1000000)::int));
        end if;
      end loop;
    end if;
    -- Columnas generadas o identity (no se pueden insertar explícitamente)
    for col in select a.attname from pg_attribute a where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped and (a.attgenerated <> '' or a.attidentity = 'a') loop
      v_nueva := v_nueva - col.attname::text;
    end loop;
    if r.t = 'storage.objects' then
      v_nueva := jsonb_build_object('bucket_id', 'trib-respaldos', 'name', 'segp/prueba.pdf', 'owner', null);
    end if;
    insert into seg_probe.muestra values (r.t, v_fila, v_pk, v_nueva, v_tot);
  end loop;
end $m$;
