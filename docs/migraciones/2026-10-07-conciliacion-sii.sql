-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- Fase SII · Conciliación histórica con evidencia SII (lote 'sii-conciliacion-20261007').
-- Requiere 2026-10-07-modelo-tributario.sql. Una sola transacción, dueño de las tablas:
--   psql -v ON_ERROR_STOP=1 -1 -f 2026-10-07-conciliacion-sii.sql
--
-- Evidencia (entregada por el dueño, confirmada en XML SII con referencia 801 a la OC y en el RCV):
-- solo se corrige el FOLIO de la factura ya registrada en la OC, que tiene el mismo monto que el
-- documento SII. No cambia montos, fechas, OCs ni cobros; se marca el documento como verificado SII.
-- Cada fila se comprueba antes de tocarla (id, OC, folio actual, monto); si una no coincide exactamente,
-- se aborta todo. Además se registran los documentos SII que no existían como tales (NC), sin efecto en
-- montos salvo el que su código SII indique.
-- Garantías dentro de la transacción: ningún monto ni estado de OC cambia; ningún financiador cambia;
-- fin_verificar_consistencia() vacía; cada cambio queda en fin_correcciones_registro y en el historial.
-- Deshacer exacto: 2026-10-07-conciliacion-sii-deshacer.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'eventos_factura' and column_name = 'tipo_dte') then
    raise exception 'SII-CONC: el modelo tributario no está aplicado';
  end if;
  if exists (select 1 from public.fin_correcciones_registro r where r.lote = 'sii-conciliacion-20261007' and r.revertida_en is null) then
    raise exception 'SII-CONC: el lote ya fue aplicado';
  end if;
end $$;

-- ── 1. Folios a corregir (evidencia: XML SII referencia 801) ──────────────────────────────
create temp table _conc_folios (evento_id text, numero_oc text, folio_antes text, folio_sii text, monto numeric, rut_sii text, evidencia text, fecha_sii date) on commit drop;
insert into _conc_folios values
  ('evf_hist_0167',           '4454-401-AG25',   '24',  '34',  284734, null, 'XML SII factura 34: referencia 801 a OC 4454-401-AG25, total $284.734'),
  ('evf_hist_0108',           '1180830-57-AG25', '120', '96',  192399, null, 'XML SII factura 96: referencia 801 a OC 1180830-57-AG25, total $192.399'),
  ('evf_hist_0029',           '1063534-14-AG26', '198', '195', 330000, null, 'XML SII factura 195: referencia 801 a OC 1063534-14-AG26, total $330.000'),
  ('evf_hist_0024',           '2986-198-AG26',   '212', '199', 224900, null, 'XML SII factura 199: referencia 801 a OC 2986-198-AG26, total $224.900'),
  ('evf_1790276583947_3d119', '3880-458-AG26',   '330', '326', 91000,  null, 'XML SII factura 326: referencia 801 a OC 3880-458-AG26, total $91.000'),
  ('evf_1790999792153_tib0g', '1525570-40-AG26', '333', '334', 165201, null, 'XML SII factura 334: referencia 801 a OC 1525570-40-AG26, total $165.201');
-- Factura 203: el XML trae la referencia 801 a "47777-445-AG26" (un 7 de más); coinciden cliente, RUT, fecha y
-- total con la OC 4777-445-AG26 de BFK (confirmado por el dueño). El número de OC de BFK no se cambia.
insert into _conc_folios values
  ('evf_hist_0022', '4777-445-AG26', '206', '203', 247000, '69.200.800-6',
   'XML SII factura 203 (04/06/2026, I. Municipalidad de La Unión, RUT 69.200.800-6, $247.000): referencia 801 "47777-445-AG26" = OC 4777-445-AG26 (confirmado por el dueño)',
   '2026-06-04');

-- ── 2. Documentos SII nuevos (NC/ND) ───────────────────────────────────────────────────────
create temp table _conc_docs (id text, numero_oc text, tipo_dte smallint, folio text, fecha date, monto numeric,
  ref_tipo_dte smallint, ref_folio text, ref_codigo smallint, ref_motivo text, rut_receptor text, evidencia text) on commit drop;
insert into _conc_docs values
  ('evf_sii_nc44', '4777-445-AG26', 61, '44', '2026-08-05', 0, 33, '203', 2, 'Corrección giro de factura 203', '69.200.800-6',
   'RCV/XML SII: NC 44 del 05/08/2026, código de referencia 2 (corrige texto) sobre factura 203, $0 sin efecto monetario');

-- ── 3. Comprobaciones (exactas; cualquier diferencia aborta) ───────────────────────────────
do $$
declare r record; v_n int;
begin
  for r in select c.*, f.oc_id, f.numero_factura, f.monto as monto_bfk, f.fecha as fecha_bfk, o.numero_oc as oc_bfk, o.rut_cliente as rut_oc
             from _conc_folios c left join public.eventos_factura f on f.id = c.evento_id
             left join public.ordenes_compra_v2 o on o.id = f.oc_id loop
    if r.oc_id is null then raise exception 'SII-CONC: no existe el documento % (OC %)', r.evento_id, r.numero_oc; end if;
    if r.oc_bfk is distinct from r.numero_oc then raise exception 'SII-CONC: % está en la OC %, no en %', r.evento_id, r.oc_bfk, r.numero_oc; end if;
    if btrim(r.numero_factura) is distinct from r.folio_antes then raise exception 'SII-CONC: % tiene folio %, se esperaba %', r.evento_id, r.numero_factura, r.folio_antes; end if;
    if r.monto_bfk is distinct from r.monto then raise exception 'SII-CONC: % tiene monto %, el SII %', r.evento_id, r.monto_bfk, r.monto; end if;
    if r.fecha_sii is not null and r.fecha_bfk is distinct from r.fecha_sii then raise exception 'SII-CONC: % tiene fecha %, el SII %', r.evento_id, r.fecha_bfk, r.fecha_sii; end if;
    if r.rut_sii is not null and regexp_replace(upper(coalesce(r.rut_oc, '')), '[^0-9K]', '', 'g') <> regexp_replace(upper(r.rut_sii), '[^0-9K]', '', 'g') then
      raise exception 'SII-CONC: la OC % tiene RUT %, el SII %', r.numero_oc, r.rut_oc, r.rut_sii;
    end if;
    select count(*) into v_n from public.eventos_factura x
     where coalesce(x.tipo_dte, 33) in (33, 34) and btrim(x.numero_factura) = r.folio_sii and x.id <> r.evento_id;
    if v_n > 0 then raise exception 'SII-CONC: el folio % ya está usado por otra factura', r.folio_sii; end if;
    select count(*) into v_n from public.eventos_factura x
     where btrim(x.factura_anulada_numero) in (r.folio_antes, r.folio_sii) or btrim(x.ref_folio) in (r.folio_antes, r.folio_sii);
    if v_n > 0 then raise exception 'SII-CONC: el folio % o % es referenciado por otro documento', r.folio_antes, r.folio_sii; end if;
  end loop;
  for r in select d.*, o.id as oc_id from _conc_docs d left join public.ordenes_compra_v2 o on o.numero_oc = d.numero_oc loop
    if r.oc_id is null then raise exception 'SII-CONC: no existe la OC % del documento %', r.numero_oc, r.folio; end if;
    if exists (select 1 from public.eventos_factura x where x.tipo_dte = r.tipo_dte and btrim(x.numero_factura) = r.folio) then
      raise exception 'SII-CONC: el documento tipo % folio % ya existe', r.tipo_dte, r.folio;
    end if;
    if not exists (select 1 from public.eventos_factura x where x.oc_id = r.oc_id and coalesce(x.tipo_dte, 33) in (33, 34)
                     and (btrim(x.numero_factura) = r.ref_folio or btrim(x.numero_factura) = (select c.folio_antes from _conc_folios c where c.folio_sii = r.ref_folio))) then
      raise exception 'SII-CONC: el documento % referencia la factura %, que no está en la OC %', r.folio, r.ref_folio, r.numero_oc;
    end if;
  end loop;
end $$;

-- ── 4. Fotos (antes) ──────────────────────────────────────────────────────────────────────
create temp table _conc_calc_antes on commit drop as
  select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c;
create temp table _conc_oc_antes on commit drop as select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from public.ordenes_compra_v2 x;
create temp table _conc_fin_antes on commit drop as select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from public.financiadores x;
create temp table _conc_otros_antes on commit drop as
  select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) h from public.eventos_factura x
   where x.id not in (select evento_id from _conc_folios);

-- ── 5. Registro (antes / después) ─────────────────────────────────────────────────────────
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'sii-conciliacion-20261007', 'eventos_factura', f.id, v.campo, v.antes, v.despues, c.evidencia
  from _conc_folios c join public.eventos_factura f on f.id = c.evento_id
  cross join lateral (values
    ('numero_factura', f.numero_factura, c.folio_sii),
    ('origen', f.origen, 'sii_xml'),
    ('verificado_sii', f.verificado_sii::text, 'true'),
    ('evidencia_sii', f.evidencia_sii, c.evidencia),
    ('rut_receptor', f.rut_receptor, coalesce(c.rut_sii, f.rut_receptor))) v(campo, antes, despues)
 where v.antes is distinct from v.despues;
insert into public.fin_correcciones_registro (lote, tabla, fila_id, campo, antes, despues, motivo)
select 'sii-conciliacion-20261007', 'eventos_factura', d.id, '*fila_nueva*', null, d.tipo_dte || ':' || d.folio, d.evidencia from _conc_docs d;

-- ── 6. Cambios (sin recálculo intermedio: los montos no cambian; se verifica en el paso 7) ──
select set_config('bfk.importacion', 'on', true);
update public.eventos_factura f
   set numero_factura = c.folio_sii, origen = 'sii_xml', verificado_sii = true, verificado_en = now(),
       evidencia_sii = c.evidencia, rut_receptor = coalesce(c.rut_sii, f.rut_receptor)
  from _conc_folios c where f.id = c.evento_id;
insert into public.eventos_factura (id, oc_id, fecha, numero_factura, monto, tipo_dte, ref_tipo_dte, ref_folio, ref_codigo, ref_motivo,
                                    rut_receptor, origen, verificado_sii, verificado_en, evidencia_sii, notas)
select d.id, o.id, d.fecha, d.folio, d.monto, d.tipo_dte, d.ref_tipo_dte, d.ref_folio, d.ref_codigo, d.ref_motivo,
       d.rut_receptor, 'sii_xml', true, now(), d.evidencia, null
  from _conc_docs d join public.ordenes_compra_v2 o on o.numero_oc = d.numero_oc;
select set_config('bfk.importacion', 'off', true);
-- Las OCs con documentos nuevos se recalculan con la regla (una NC código 2 no cambia nada; se verifica abajo).
select public.fin_recalcular(array(select distinct o.id from _conc_docs d join public.ordenes_compra_v2 o on o.numero_oc = d.numero_oc), '{}');

insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
select public.fin_nuevo_id('hc'), f.oc_id, c.numero_oc, null, 'Conciliación SII', 'Folio corregido según SII (XML ref. 801)', 'numero_factura',
       'N°' || c.folio_antes, 'N°' || c.folio_sii
  from _conc_folios c join public.eventos_factura f on f.id = c.evento_id;
insert into public.historial_cambios (id, oc_id, oc_numero, usuario_id, usuario_nombre, accion, campo, valor_anterior, valor_nuevo)
select public.fin_nuevo_id('hc'), o.id, d.numero_oc, null, 'Conciliación SII',
       case d.tipo_dte when 61 then 'NC registrada según SII' else 'Documento registrado según SII' end, 'documento_tributario', null,
       case d.tipo_dte when 61 then 'NC ' else 'Documento ' end || d.folio || ' → factura ' || d.ref_folio || ' · código ' || d.ref_codigo || ' · ' || coalesce(d.ref_motivo, '')
  from _conc_docs d join public.ordenes_compra_v2 o on o.numero_oc = d.numero_oc;

-- ── 7. Verificación ───────────────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  -- Ningún cálculo de OC cambia (folios y NC código 2 no tienen efecto monetario).
  select count(*) into v_n from (
    (select * from _conc_calc_antes except select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c)
    union all
    (select o.id, c.* from public.ordenes_compra_v2 o cross join lateral public.fin_calculo_oc(o.id, true) c except select * from _conc_calc_antes)) x;
  if v_n > 0 then raise exception 'SII-CONC: cambiaría el cálculo de % OCs. No se aplicó nada.', v_n; end if;
  if (select h from _conc_oc_antes) <> (select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.ordenes_compra_v2 x) then
    raise exception 'SII-CONC: cambió un valor guardado de una OC. No se aplicó nada.';
  end if;
  if (select h from _conc_fin_antes) <> (select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.financiadores x) then
    raise exception 'SII-CONC: cambió un financiador. No se aplicó nada.';
  end if;
  if (select h from _conc_otros_antes) <> (select md5(coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '')) from public.eventos_factura x
       where x.id not in (select evento_id from _conc_folios) and x.id not in (select id from _conc_docs)) then
    raise exception 'SII-CONC: cambió otro documento. No se aplicó nada.';
  end if;
  select count(*) into v_n from _conc_folios c join public.eventos_factura f on f.id = c.evento_id
   where f.numero_factura = c.folio_sii and f.verificado_sii and f.monto = c.monto;
  if v_n <> (select count(*) from _conc_folios) then raise exception 'SII-CONC: no quedaron todos los folios corregidos'; end if;
  if exists (select 1 from public.fin_verificar_consistencia()) then raise exception 'SII-CONC: consistencia no vacía'; end if;
  raise notice 'SII-CONC: % folios corregidos, % documentos SII registrados, sin cambios de montos',
    (select count(*) from _conc_folios), (select count(*) from _conc_docs);
end $$;
