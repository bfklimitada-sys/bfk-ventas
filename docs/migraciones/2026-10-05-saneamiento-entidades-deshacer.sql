-- Deshace 2026-10-05-saneamiento-entidades.sql: retira el trigger y devuelve EXACTAMENTE los valores previos de las
-- 252 entidades, de la(s) OC(s) y contacto(s) de cobranza corregidos. Las entidades creadas DESPUÉS del saneamiento se conservan.
-- Si alguna entidad preexistente fue editada después del saneamiento, esa edición se pierde (vuelve al valor original).
begin;
do $$ begin
  if to_regclass('public.entidades_saneamiento_respaldo') is null then raise exception 'No hay respaldo de saneamiento: nada que deshacer'; end if;
end $$;
lock table public.entidades_catalogo in share row exclusive mode;
drop trigger if exists normalizar_rut_entidad on public.entidades_catalogo;
drop function if exists public.normalizar_rut_entidad();
-- entidades: actualizar las que existen y reinsertar las eliminadas, con sus valores originales completos
update public.entidades_catalogo e set
  rut = o.rut, nombre_entidad = o.nombre_entidad, comuna = o.comuna, contacto = o.contacto, correo = o.correo,
  "creadoEn" = o."creadoEn", creado_por = o.creado_por
from (select (jsonb_populate_record(null::public.entidades_catalogo, fila_original)).* from public.entidades_saneamiento_respaldo where accion = 'original') o
where e.id = o.id;
insert into public.entidades_catalogo
select (jsonb_populate_record(null::public.entidades_catalogo, fila_original)).* from public.entidades_saneamiento_respaldo r
where r.accion = 'original' and not exists (select 1 from public.entidades_catalogo e where e.id = r.fila_id);
update public.ordenes_compra_v2 o set rut_cliente = r.fila_original->>'rut_cliente'
from public.entidades_saneamiento_respaldo r where r.tabla = 'ordenes_compra_v2' and r.accion = 'actualizada' and o.id = r.fila_id;
update public.contactos_cobranza c set rut = r.fila_original->>'rut'
from public.entidades_saneamiento_respaldo r where r.tabla = 'contactos_cobranza' and r.accion = 'actualizada' and c.id = r.fila_id;
drop table public.entidades_saneamiento_respaldo;
commit;
