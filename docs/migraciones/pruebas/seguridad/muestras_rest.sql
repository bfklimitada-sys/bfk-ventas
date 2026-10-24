-- Para la prueba REST: muestras por tabla de public (solo en la copia; nunca se imprimen, las usa rest.mjs en memoria).
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
begin;
\ir muestra.sql
select json_agg(json_build_object('t', split_part(tabla, '.', 2), 'pk', pk, 'fila', fila, 'nueva', nueva, 'total', total) order by tabla)
  from seg_probe.muestra where tabla like 'public.%';
rollback;
