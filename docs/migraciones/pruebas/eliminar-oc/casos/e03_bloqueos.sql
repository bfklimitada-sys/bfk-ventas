\ir ../_ini.sql
create temp table r as select k, public.oc_eliminacion_revisar(oc, orig) j from (values
  ('sin_original','oe_B',null), ('sin_equivalente','oe_D','oe_A'), ('cartola','oe_E','oe_A'), ('repartido','oe_F',null), ('saldo','oe_H',null),
  ('comision','oe_J',null), ('correccion','oe_K',null), ('seguimiento','oe_L',null), ('cotizacion','oe_M',null), ('decision','oe_N',null), ('misma','oe_B','oe_B')) v(k, oc, orig);
select 'OE|e03_' || k || '_bloquea|' || ((j->>'eliminable')::boolean = false and exists (select 1 from jsonb_array_elements(j->'bloqueos') b where b->>'codigo' = c))::text
  from r join (values ('sin_original','financiera'), ('sin_equivalente','sin_equivalente'), ('cartola','cartola'), ('repartido','pago_repartido'), ('saldo','saldo_financiador'),
  ('comision','comision'), ('correccion','correccion'), ('seguimiento','seguimiento'), ('cotizacion','cotizacion'), ('decision','conciliacion'), ('misma','original')) e(k2, c) on e.k2 = r.k order by k;
select 'OE|e03_sin_equivalente_nombra_el_cobro_extra|' || exists (select 1 from r, jsonb_array_elements(j->'bloqueos') b where k='sin_equivalente' and b->>'texto' like '%02/05/2026 por $50.000%')::text;
-- La función de eliminar aplica los mismos bloqueos (no basta con la pantalla).
savepoint s; select public.oc_eliminar_definitivamente('oe_D','OE-1-AG26-D','Duplicada','oe_A'); \set m1 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_E','OE-1-AG26-E','Duplicada','oe_A'); \set m2 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_B','OE-1-AG26-B','Duplicada'); \set m3 :LAST_ERROR_MESSAGE
rollback to savepoint s; select public.oc_eliminar_definitivamente('oe_F','OE-6-AG26','Prueba'); \set m4 :LAST_ERROR_MESSAGE
rollback to savepoint s;
select 'OE|e03_eliminar_aplica_los_bloqueos|' || (:'m1' like '%no se puede eliminar%' and :'m2' like '%cartola%' and :'m3' like '%movimientos financieros%' and :'m4' like '%pago repartido%')::text;
reset role;
select 'OE|e03_nada_eliminado|' || ((select count(*) from public.ordenes_compra_v2 where id like 'oe\_%') = 13 and (select count(*) from public.oc_eliminaciones) = 0)::text;
rollback;
