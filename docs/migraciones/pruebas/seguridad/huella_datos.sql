-- Huella de TODOS los datos de public (cada tabla, todas sus filas) + la huella financiera histórica (FIN) de los ensayos
set client_min_messages = warning;
-- anteriores. Solo lectura. Uso: psql -At -f huella_datos.sql  → una línea «DATOS|<md5>|<n tablas>|<n filas>»
do $h$ begin
  drop table if exists pg_temp._hd; create temp table _hd (t text, n bigint, h text);
end $h$;
do $h$
declare r record; v_n bigint; v_h text;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
                and c.relname <> 'perfiles_autorizaciones'   -- tabla nueva de la corrección (vacía): no es un dato previo
              order by 1 loop
    execute format('select count(*), md5(coalesce(string_agg(x::text, E''\n'' order by x::text collate "C"), '''')) from public.%I x', r.relname) into v_n, v_h;
    insert into _hd values (r.relname, v_n, v_h);
  end loop;
end $h$;
select 'DATOS|' || md5(string_agg(t || ':' || h, ',' order by t)) || '|' || count(*) || ' tablas|' || sum(n) || ' filas' from _hd;
drop table _hd;
