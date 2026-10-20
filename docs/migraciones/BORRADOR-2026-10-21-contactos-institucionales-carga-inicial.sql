-- =====================================================================================
-- CARGA INICIAL de contactos institucionales (BORRADOR, NO APLICADO). Requiere la migración instalada.
-- Escribe SOLO en las tablas nuevas contactos_institucionales*. No modifica OC, catálogo ni cobranza.
-- Idempotente: repetirla no crea duplicados (informa nuevos_en_esta_pasada = 0).
-- Orden: 1) OC de la más reciente a la más antigua (cada correo queda vinculado a su OC; cambios de correo de la misma
--        persona quedan PENDIENTES para revisión, nunca se reemplazan solos), 2) catálogo de entidades,
--        3) correos de reclamos de pago (vinculados a su OC) y contactos de cobranza (correo sin nombre de persona).
-- Origen: 'importado' (OC y catálogo) y 'cobranza'. Nada queda "confirmado manualmente".
-- =====================================================================================
begin;
set local lock_timeout = '5s';
create temp table _ci_res (fuente text, r jsonb) on commit drop;
create temp table _ci_n0 on commit drop as select count(*) n from public.contactos_institucionales;
select public.ci_contexto('carga_inicial', 'importado', null, null);

do $_$
declare o record; v_clave text;
begin
  for o in select id, rut_cliente, contacto, correo_cliente,
                  coalesce(fecha_hora_emision_mp, fecha_emision_mp::timestamptz, "creadoEn") as f
             from public.ordenes_compra_v2
            where btrim(coalesce(contacto,'')) <> '' or btrim(coalesce(correo_cliente,'')) <> ''
            order by 5 desc nulls last, id loop   -- la OC más reciente primero: su correo tiene prioridad
    v_clave := public.ci_rut_clave(o.rut_cliente);
    if v_clave is null then
      insert into _ci_res values ('oc', jsonb_build_object('accion', case when btrim(coalesce(o.rut_cliente,'')) = '' then 'sin_rut' else 'rut_invalido' end));
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtext('contactos_inst:' || v_clave));
    insert into _ci_res select 'oc', e from jsonb_array_elements(
      public.ci_conciliar_datos(v_clave, o.id, o.f, 'importado', null, o.contacto, null, o.correo_cliente)) e;
  end loop;

  for o in select rut, contacto, correo from public.entidades_catalogo
            where btrim(coalesce(contacto,'')) <> '' or btrim(coalesce(correo,'')) <> '' order by id loop
    v_clave := public.ci_rut_clave(o.rut);
    if v_clave is null then insert into _ci_res values ('catalogo', '{"accion":"rut_invalido"}'); continue; end if;
    insert into _ci_res select 'catalogo', e from jsonb_array_elements(
      public.ci_conciliar_datos(v_clave, null, null, 'importado', null, o.contacto, null, o.correo)) e;
  end loop;

  -- correos usados al reclamar pagos (oc_reclamos): quedan vinculados a SU OC, con origen cobranza (solo el destinatario: las copias suelen ser correos de BFK)
  for o in select r.oc_id, r.correo, r.fecha, oc.rut_cliente from public.oc_reclamos r
             join public.ordenes_compra_v2 oc on oc.id = r.oc_id
            where btrim(coalesce(r.correo,'')) <> '' order by r.fecha desc nulls last, r.id loop
    v_clave := public.ci_rut_clave(o.rut_cliente);
    if v_clave is null then insert into _ci_res values ('reclamo', '{"accion":"rut_invalido"}'); continue; end if;
    insert into _ci_res select 'reclamo', e from jsonb_array_elements(
      public.ci_conciliar_datos(v_clave, o.oc_id, o.fecha, 'cobranza', null, '', null, o.correo)) e;
  end loop;

  -- nombre_cliente en cobranza es el nombre de la institución, no de una persona: se carga solo el correo
  for o in select rut, correo from public.contactos_cobranza where btrim(coalesce(correo,'')) <> '' order by "creadoEn", id loop
    v_clave := public.ci_rut_clave(o.rut);
    if v_clave is null then insert into _ci_res values ('cobranza', '{"accion":"rut_invalido"}'); continue; end if;
    insert into _ci_res select 'cobranza', e from jsonb_array_elements(
      public.ci_conciliar_datos(v_clave, null, null, 'cobranza', null, '', null, o.correo)) e;
  end loop;
end $_$;

select 'CARGA|resultados|' || coalesce(string_agg(fuente || ':' || accion || '=' || n, ' ' order by fuente, accion), '')
  from (select fuente, r->>'accion' accion, count(*) n from _ci_res group by 1, 2) s;
select 'CARGA|contactos|' || count(*) || '|instituciones|' || count(distinct rut_clave) from public.contactos_institucionales;
select 'CARGA|por_estado|' || coalesce(string_agg(estado || '=' || n, ' ' order by estado), '')
  from (select estado, count(*) n from public.contactos_institucionales group by 1) s;
select 'CARGA|pendientes_por_motivo|' || coalesce(string_agg(motivo_pendiente || '=' || n, ' ' order by motivo_pendiente), '')
  from (select motivo_pendiente, count(*) n from public.contactos_institucionales where estado = 'pendiente' group by 1) s;
select 'CARGA|instituciones_con_pendientes|' || count(distinct rut_clave) from public.contactos_institucionales where estado = 'pendiente';
select 'CARGA|vinculos_oc|' || count(*) from public.contactos_institucionales_oc;
select 'CARGA|nuevos_en_esta_pasada|' || ((select count(*) from public.contactos_institucionales) - (select n from _ci_n0));
commit;
