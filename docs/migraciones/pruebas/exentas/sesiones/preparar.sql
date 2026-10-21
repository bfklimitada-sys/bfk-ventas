-- SOLO COPIA DESECHABLE: datos sintéticos confirmados (COMMIT) para que cada prueba corra en su propia conexión.
\set ON_ERROR_STOP on
begin;
select set_config('bfk.trib_rpc', '1', true);
insert into public.ordenes_compra_v2 (id, numero_oc, cliente, monto_total) values ('ocv2_g3_ex', '9971-1-G3ENS', 'ENSAYO EXENTA', 2704000), ('ocv2_g3_af', '9972-2-G3ENS', 'ENSAYO AFECTA', 1190000);
update public.ordenes_compra_v2 set tratamiento_iva = 'exenta_fora', fundamento_iva = 'Art. 101 Ley 18.948 (ENSAYO)', respaldo_iva = 'Oficio ficticio',
  tratamiento_aprobado_por = :'adm', tratamiento_aprobado_en = now(), clasificacion_id = '00000000-0000-4000-8000-0000000000a1' where id = 'ocv2_g3_ex';
insert into public.cotizaciones (id, nombre, estado, creado_por) values ('e3000000-0000-4000-8000-000000000001', 'ENSAYO cz exenta', 'borrador', :'adm'), ('e3000000-0000-4000-8000-000000000002', 'ENSAYO cz afecta', 'borrador', :'adm');
update public.cotizaciones set tratamiento_iva = 'exenta_fora', fundamento_iva = 'Art. 101 Ley 18.948 (ENSAYO)', respaldo_iva = 'Oficio ficticio', tratamiento_aprobado_por = :'adm',
  tratamiento_aprobado_en = now(), clasificacion_id = '00000000-0000-4000-8000-0000000000a2' where id = 'e3000000-0000-4000-8000-000000000001';
commit;
