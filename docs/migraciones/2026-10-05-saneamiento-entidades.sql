-- SANEAMIENTO DE entidades_catalogo (una transacción). NO ejecutado en producción.
-- Reglas (sin adivinar):
--  * Grupos con el mismo RUT normalizado: se consolidan SOLO si cada campo con valores realmente distintos
--    (tras ignorar mayúsculas, tildes, puntuación y espacios) queda resuelto por evidencia UNÁNIME de las OCs de ese RUT
--    (todas las OCs que traen ese dato usan el mismo valor). Si las OCs están divididas o no hay evidencia: REVISIÓN MANUAL
--    (el grupo no se toca).
--  * Registro canónico: el que tiene más campos con información; luego el que tiene creado_por; luego el más antiguo; luego id.
--    Se le combinan los campos útiles (nunca se reemplaza un dato por un vacío), se normaliza su RUT (76.123.456-0) y se
--    elimina el duplicado. No hay FK ni columnas que apunten al id de una entidad (verificado): nada que redirigir.
--  * RUT inválidos: 'Twst' (registro TEST sin referencias) se elimina; 61606800-6 se corrige a 61.606.800-8 solo porque
--    otra entidad y otra OC de la MISMA institución tienen ese RUT válido (fuente interna); se corrigen también la OC y el
--    contacto de cobranza que llevaban el RUT con dígito errado. 69001030-2 no tiene otra fuente: NO se toca.
--  * Todo RUT válido restante (fuera de grupos manuales) queda en formato 76.123.456-0 con K mayúscula.
--  * Un trigger normaliza el formato del RUT en cada INSERT/UPDATE futuro: UNIQUE(rut) pasa a impedir duplicados por formato.
--  * Toda fila tocada (entidades, OC, contacto) queda respaldada en public.entidades_saneamiento_respaldo (solo admin de BD).
-- Guardia: el contenido de entidades_catalogo debe ser EXACTAMENTE el diagnosticado; si cambió, aborta sin tocar nada.

do $$
declare
  c_hash_esperado constant text := '0b94e9c026f8bcb11496e4ce1e4e4ecb';
  v_hash text;
begin
  select md5(coalesce(string_agg(t::text,'|' order by id),'')) into v_hash from public.entidades_catalogo t;
  if v_hash is distinct from c_hash_esperado then
    raise exception 'SANEAMIENTO_ABORTADO: entidades_catalogo cambió desde el diagnóstico (hash %). Repetir el diagnóstico.', v_hash;
  end if;
  if to_regclass('public.entidades_saneamiento_respaldo') is not null then
    raise exception 'SANEAMIENTO_ABORTADO: ya existe public.entidades_saneamiento_respaldo (¿saneamiento ya aplicado?)';
  end if;
end $$;

lock table public.entidades_catalogo in share row exclusive mode;

create table public.entidades_saneamiento_respaldo (
  n bigserial primary key,
  tabla text not null,
  fila_id text not null,
  accion text not null,          -- original | eliminada | actualizada | manual | sin_cambio
  grupo text,
  detalle jsonb,
  fila_original jsonb,
  creado timestamptz not null default now()
);
alter table public.entidades_saneamiento_respaldo enable row level security;
revoke all on public.entidades_saneamiento_respaldo from public, anon, authenticated;
revoke all on sequence public.entidades_saneamiento_respaldo_n_seq from public, anon, authenticated;

create function pg_temp.nt(s text) returns text language sql immutable as $f$
  select btrim(regexp_replace(regexp_replace(lower(translate(coalesce(s,''), 'áéíóúüñÁÉÍÓÚÜÑàèìòùÀÈÌÒÙâêîôûÂÊÎÔÛ', 'aeiouunAEIOUUNaeiouAEIOUaeiouAEIOU')), '[.,;:''"´`()\-_/]', ' ', 'g'), '\s+', ' ', 'g'))
$f$;
create function pg_temp.clave(r text) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(upper(coalesce(r,'')), '[^0-9K]', '', 'g'), '^0+(?=.)', '')
$f$;
create function pg_temp.dv(b text) returns text language sql immutable as $f$
  select case r when 11 then '0' when 10 then 'K' else r::text end
  from (select 11 - (sum(substr(reverse(b), i, 1)::int * (2 + (i-1) % 6)) % 11) r from generate_series(1, length(b)) i) x
$f$;
create function pg_temp.valido(r text) returns boolean language sql immutable as $f$
  select l ~ '^[0-9]{7,8}[0-9K]$' and left(l, -1)::bigint >= 1000000 and pg_temp.dv(left(l, -1)) = right(l, 1)
  from (select upper(regexp_replace(coalesce(r,''), '[\s.\-]', '', 'g')) l) x
$f$;
create function pg_temp.canon(r text) returns text language sql immutable as $f$
  select case when length(b) = 8 then substr(b,1,2)||'.'||substr(b,3,3)||'.'||substr(b,6,3) else substr(b,1,1)||'.'||substr(b,2,3)||'.'||substr(b,5,3) end || '-' || d
  from (select left(l, -1) b, right(l, 1) d from (select upper(regexp_replace(r, '[\s.\-]', '', 'g')) l) y) x
$f$;

-- 1. respaldo íntegro previo
insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, fila_original)
select 'entidades_catalogo', id, 'original', to_jsonb(t) from public.entidades_catalogo t;

-- 2. grupos duplicados
do $$
declare
  g record; r record; f text; campos text[] := array['nombre_entidad','comuna','contacto','correo'];
  v_can public.entidades_catalogo%rowtype; v_cands text[]; v_gan text; v_manual text; v_det jsonb;
  v_nuevo jsonb; v_val text; v_n_oc int; v_n_conval int; v_unicos text[]; v_ambos int;
  n_auto int := 0; n_manual int := 0; n_grupos int := 0;
begin
  for g in select pg_temp.clave(rut) k, array_agg(id order by id) ids from public.entidades_catalogo group by 1 having count(*) > 1 order by 1 loop
    n_grupos := n_grupos + 1;
    select * into v_can from public.entidades_catalogo e where e.id = any (g.ids)
      order by (case when btrim(coalesce(nombre_entidad,''))<>'' then 1 else 0 end + case when btrim(coalesce(comuna,''))<>'' then 1 else 0 end
              + case when btrim(coalesce(contacto,''))<>'' then 1 else 0 end + case when btrim(coalesce(correo,''))<>'' then 1 else 0 end) desc,
               (creado_por is null), "creadoEn" asc nulls last, id limit 1;
    v_manual := null; v_det := '{}'::jsonb; v_nuevo := '{}'::jsonb;
    foreach f in array campos loop
      execute format('select coalesce(array_agg(distinct pg_temp.nt(%I)) filter (where btrim(coalesce(%I,''''))<>''''), ''{}'') from public.entidades_catalogo where id = any ($1)', f, f)
        into v_cands using g.ids;
      if cardinality(v_cands) <= 1 then
        -- sin conflicto: valor del canónico si lo tiene; si no, el primero no vacío del grupo
        execute format('select %I from public.entidades_catalogo where id = any ($1) and btrim(coalesce(%I,''''))<>'''' order by (id = $2) desc, id limit 1', f, f)
          into v_val using g.ids, v_can.id;
        v_nuevo := v_nuevo || jsonb_build_object(f, v_val);
        v_det := v_det || jsonb_build_object(f, case when cardinality(v_cands) = 0 then 'vacio' else 'sin_conflicto' end);
      else
        -- conflicto: evidencia de las OCs del mismo RUT normalizado
        with ocs as (
          select case when f = 'nombre_entidad' then array_remove(array[nullif(pg_temp.nt(o.cliente),''), nullif(pg_temp.nt(o.entidad),'')], null)
                      when f = 'comuna' then array_remove(array[nullif(pg_temp.nt(o.comuna),'')], null)
                      when f = 'contacto' then array_remove(array[nullif(pg_temp.nt(o.contacto),'')], null)
                      else array_remove(array[nullif(pg_temp.nt(o.correo_cliente),'')], null) end vals
          from public.ordenes_compra_v2 o where pg_temp.clave(o.rut_cliente) = g.k and coalesce(o.rut_cliente,'') <> ''),
        m as (select vals, array(select unnest(vals) intersect select unnest(v_cands)) hit from ocs where cardinality(vals) > 0)
        select count(*), count(*) filter (where cardinality(hit) > 0), count(*) filter (where cardinality(hit) > 1),
               coalesce(array_agg(distinct hit[1]) filter (where cardinality(hit) = 1), '{}')
          into v_n_oc, v_n_conval, v_ambos, v_unicos from m;
        if v_n_oc > 0 and v_n_conval = v_n_oc and v_ambos = 0 and cardinality(v_unicos) = 1 then
          v_gan := v_unicos[1];
          execute format('select %I from public.entidades_catalogo where id = any ($1) and pg_temp.nt(%I) = $3 order by (id = $2) desc, id limit 1', f, f)
            into v_val using g.ids, v_can.id, v_gan;
          v_nuevo := v_nuevo || jsonb_build_object(f, v_val);
          v_det := v_det || jsonb_build_object(f, format('conflicto_resuelto_por_%s_OCs_unanimes', v_n_oc));
        else
          v_manual := coalesce(v_manual || '; ', '') || format('%s: OCs=%s coinciden=%s ambos=%s valores_en_OCs=%s', f, v_n_oc, v_n_conval, v_ambos, cardinality(v_unicos));
          v_det := v_det || jsonb_build_object(f, 'conflicto_sin_evidencia_unanime');
        end if;
      end if;
    end loop;

    if v_manual is not null then
      n_manual := n_manual + 1;
      insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, grupo, detalle)
        select 'entidades_catalogo', unnest(g.ids), 'manual', g.k, v_det || jsonb_build_object('motivo', v_manual);
      continue;
    end if;
    n_auto := n_auto + 1;
    -- combinar: creado_por del canónico o, si falta, del otro registro
    insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, grupo, detalle, fila_original)
      select 'entidades_catalogo', e.id, 'eliminada', g.k, v_det || jsonb_build_object('fusionada_en', v_can.id), to_jsonb(e)
      from public.entidades_catalogo e where e.id = any (g.ids) and e.id <> v_can.id;
    delete from public.entidades_catalogo where id = any (g.ids) and id <> v_can.id;
    update public.entidades_catalogo set
      rut = case when pg_temp.valido(rut) then pg_temp.canon(rut) else rut end,
      nombre_entidad = coalesce(v_nuevo->>'nombre_entidad', nombre_entidad),
      comuna = coalesce(v_nuevo->>'comuna', comuna),
      contacto = coalesce(v_nuevo->>'contacto', contacto),
      correo = coalesce(v_nuevo->>'correo', correo),
      creado_por = coalesce(creado_por, (select (x.fila_original->>'creado_por')::uuid from public.entidades_saneamiento_respaldo x
                                          where x.accion = 'original' and x.fila_id = any (g.ids) and x.fila_original->>'creado_por' is not null order by x.fila_id limit 1))
    where id = v_can.id;
    insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, grupo, detalle)
      values ('entidades_catalogo', v_can.id, 'actualizada', g.k, v_det || jsonb_build_object('canonica', true));
  end loop;
  raise notice 'GRUPOS: total=% automaticos=% manuales=%', n_grupos, n_auto, n_manual;
  if n_grupos <> 51 or n_auto <> 39 or n_manual <> 12 then
    raise exception 'SANEAMIENTO_ABORTADO: resultado distinto del diagnosticado (grupos=%, auto=%, manual=%)', n_grupos, n_auto, n_manual;
  end if;
end $$;

-- 3. RUT inválidos
do $$
declare v_inv public.entidades_catalogo%rowtype; v_ok public.entidades_catalogo%rowtype; n int;
begin
  -- 3a 'Twst' (TEST): sin OCs ni contactos con ese RUT
  select * into v_inv from public.entidades_catalogo where rut = 'Twst' and nombre_entidad = 'TEST';
  if found then
    if exists (select 1 from public.ordenes_compra_v2 where btrim(coalesce(rut_cliente,'')) ilike 'twst') or exists (select 1 from public.contactos_cobranza where btrim(coalesce(rut,'')) ilike 'twst') then
      raise exception 'SANEAMIENTO_ABORTADO: el registro TEST tiene referencias';
    end if;
    insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle, fila_original)
      values ('entidades_catalogo', v_inv.id, 'eliminada', '{"motivo":"registro de prueba TEST con RUT no válido y sin referencias"}', to_jsonb(v_inv));
    delete from public.entidades_catalogo where id = v_inv.id;
  else raise exception 'SANEAMIENTO_ABORTADO: no se encontró el registro TEST esperado'; end if;

  -- 3b 61606800-6 -> 61.606.800-8 (misma institución ya registrada con el RUT válido)
  select * into v_inv from public.entidades_catalogo where upper(regexp_replace(rut,'[\s.\-]','','g')) = '616068006';
  select * into v_ok  from public.entidades_catalogo where upper(regexp_replace(rut,'[\s.\-]','','g')) = '616068008';
  if v_inv.id is null or v_ok.id is null or pg_temp.nt(v_inv.nombre_entidad) <> pg_temp.nt(v_ok.nombre_entidad) then
    raise exception 'SANEAMIENTO_ABORTADO: 61606800 no coincide con lo diagnosticado';
  end if;
  insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle, fila_original)
    values ('entidades_catalogo', v_inv.id, 'eliminada', jsonb_build_object('motivo','RUT con dígito verificador errado; misma institución que '||v_ok.rut, 'fusionada_en', v_ok.id), to_jsonb(v_inv));
  update public.entidades_catalogo set
    comuna = case when btrim(coalesce(comuna,''))='' then coalesce(nullif(btrim(v_inv.comuna),''), comuna) else comuna end,
    contacto = case when btrim(coalesce(contacto,''))='' then coalesce(nullif(btrim(v_inv.contacto),''), contacto) else contacto end,
    correo = case when btrim(coalesce(correo,''))='' then coalesce(nullif(btrim(v_inv.correo),''), correo) else correo end
  where id = v_ok.id;
  delete from public.entidades_catalogo where id = v_inv.id;
  insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle, fila_original)
    select 'ordenes_compra_v2', id, 'actualizada', '{"campo":"rut_cliente","nuevo":"61.606.800-8"}', jsonb_build_object('rut_cliente', rut_cliente)
    from public.ordenes_compra_v2 where upper(regexp_replace(coalesce(rut_cliente,''),'[\s.\-]','','g')) = '616068006';
  get diagnostics n = row_count;
  update public.ordenes_compra_v2 set rut_cliente = '61.606.800-8' where upper(regexp_replace(coalesce(rut_cliente,''),'[\s.\-]','','g')) = '616068006';
  raise notice 'OCs corregidas 61606800-6: %', n;
  insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle, fila_original)
    select 'contactos_cobranza', id, 'actualizada', '{"campo":"rut","nuevo":"61.606.800-8"}', jsonb_build_object('rut', rut)
    from public.contactos_cobranza where upper(regexp_replace(coalesce(rut,''),'[\s.\-]','','g')) = '616068006';
  get diagnostics n = row_count;
  update public.contactos_cobranza set rut = '61.606.800-8' where upper(regexp_replace(coalesce(rut,''),'[\s.\-]','','g')) = '616068006';
  raise notice 'contactos_cobranza corregidos 61606800-6: %', n;

  -- 3c 69001030-2: sin fuente interna para determinar el dígito correcto => no se toca
  insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle)
    select 'entidades_catalogo', id, 'manual', '{"motivo":"RUT con dígito verificador inválido sin otra fuente interna; requiere verificación externa"}'
    from public.entidades_catalogo where not pg_temp.valido(rut);
end $$;

-- 4. formato canónico para todo RUT válido que no pertenezca a un grupo manual
insert into public.entidades_saneamiento_respaldo (tabla, fila_id, accion, detalle)
select 'entidades_catalogo', id, 'actualizada', jsonb_build_object('campo','rut','nuevo',pg_temp.canon(rut))
from public.entidades_catalogo e
where pg_temp.valido(rut) and rut <> pg_temp.canon(rut)
  and id not in (select fila_id from public.entidades_saneamiento_respaldo where accion = 'manual');
update public.entidades_catalogo e set rut = pg_temp.canon(rut)
where pg_temp.valido(rut) and rut <> pg_temp.canon(rut)
  and id not in (select fila_id from public.entidades_saneamiento_respaldo where accion = 'manual');

-- 5. normalización permanente del formato (INSERT/UPDATE futuros)
create function public.normalizar_rut_entidad() returns trigger
language plpgsql security invoker set search_path = public, pg_temp as $f$
declare l text; b text; s int := 0; f int := 2; r int; d text; i int;
begin
  if new.rut is null then return new; end if;
  new.rut := btrim(new.rut);
  l := upper(regexp_replace(new.rut, '[\s.\-]', '', 'g'));
  if l !~ '^[0-9]{7,8}[0-9K]$' then return new; end if;
  b := left(l, -1);
  if b::bigint < 1000000 then return new; end if;
  for i in reverse length(b) .. 1 loop s := s + substr(b, i, 1)::int * f; f := case when f = 7 then 2 else f + 1 end; end loop;
  r := 11 - s % 11; d := case r when 11 then '0' when 10 then 'K' else r::text end;
  if d <> right(l, 1) then return new; end if;               -- RUT inválido: se deja tal cual (no se inventa)
  new.rut := case when length(b) = 8 then substr(b,1,2)||'.'||substr(b,3,3)||'.'||substr(b,6,3) else substr(b,1,1)||'.'||substr(b,2,3)||'.'||substr(b,5,3) end || '-' || d;
  return new;
end $f$;
revoke all on function public.normalizar_rut_entidad() from public, anon, authenticated;
create trigger normalizar_rut_entidad before insert or update of rut on public.entidades_catalogo
  for each row execute function public.normalizar_rut_entidad();

-- 6. verificación final (aborta todo si algo no cuadra)
do $$
declare n_total int; n_dup int; n_manual_keys int;
begin
  select count(*) into n_total from public.entidades_catalogo;
  select count(*) into n_dup from (select pg_temp.clave(rut) from public.entidades_catalogo group by 1 having count(*) > 1) x;
  select count(distinct grupo) into n_manual_keys from public.entidades_saneamiento_respaldo where accion = 'manual' and grupo is not null;
  raise notice 'RESULTADO: entidades=% grupos_duplicados_restantes=% (manuales=%)', n_total, n_dup, n_manual_keys;
  if n_total <> 211 or n_dup <> 12 or n_manual_keys <> 12 then
    raise exception 'SANEAMIENTO_ABORTADO: verificación final distinta de lo esperado';
  end if;
  if exists (select 1 from public.entidades_catalogo where pg_temp.valido(rut) and rut <> pg_temp.canon(rut)
             and pg_temp.clave(rut) not in (select grupo from public.entidades_saneamiento_respaldo where accion = 'manual' and grupo is not null)) then
    raise exception 'SANEAMIENTO_ABORTADO: quedan RUT válidos sin formato canónico';
  end if;
end $$;
