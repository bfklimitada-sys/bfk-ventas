\i _ini.sql
\set PA '(select prueba.pid(''Proyecto A Planta Desaladora''))'
select prueba.como(:'ADM');
select prueba.pid('Proyecto A Planta Desaladora') as pa, prueba.pid('Proyecto B Celulosa Montaje') as pb \gset
-- Carga de documentos DESHABILITADA al instalar (hasta activar el respaldo de archivos): nadie sube ni registra.
select prueba.como(:'ING');
select 'PI|c08_documentos_deshabilitados_al_instalar|' || (prueba.falla(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pi-documentos', :'pa' || '/antes.pdf')) like '42501:%'
  and (select valor from public.pi_configuracion where clave = 'documentos_habilitados') = 'false'::jsonb);
select 'PI|c08_solo_admin_habilita_documentos|' || (prueba.falla($$select public.pi_configurar_documentos(true, 'intento de editor')$$) like '42501:%');
select prueba.como(:'ADM');
select 'PI|c08_admin_habilita_con_motivo|' || (prueba.falla($$select public.pi_configurar_documentos(true, '')$$) like '23514:%'
  and (public.pi_configurar_documentos(true, 'Respaldo de archivos verificado (prueba)'))->>'documentos_habilitados' = 'true');
-- Subida al depósito privado (lo que hace la API de Storage con el token del usuario).
select prueba.como(:'VIS');
select 'PI|c08_lector_no_sube_archivo|' || (prueba.falla(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pi-documentos', :'pa' || '/lector.pdf')) like '42501:%');
select prueba.como(:'ING');
insert into storage.objects (bucket_id, name, owner) values ('pi-documentos', :'pa' || '/arquitectura-v1.pdf', :'ING'), ('pi-documentos', :'pa' || '/arquitectura-v2.pdf', :'ING');
select prueba.como(:'NOR');
select 'PI|c08_ajeno_no_sube_a_carpeta_de_otro_proyecto|' || (prueba.falla(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pi-documentos', :'pa' || '/intruso.pdf')) like '42501:%');
select 'PI|c08_ruta_malformada_rechazada|' || (prueba.falla(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pi-documentos', 'sin-carpeta.pdf')) like '42501:%');
select 'PI|c08_ajeno_no_ve_archivos|' || ((select count(*) from storage.objects where bucket_id = 'pi-documentos') = 0);
select prueba.como(:'ING');
select 'PI|c08_registrar_sin_archivo_rechazado|' || (prueba.falla(format('insert into public.pi_documentos (proyecto_id, titulo, nombre_archivo, ruta, tamano, sha256) values (%L, %L, %L, %L, 10, %L)',
  :'pa', 'Fantasma', 'no.pdf', :'pa' || '/no-existe.pdf', repeat('a', 64))) like '23503:PI_DOC%');
select 'PI|c08_ruta_de_otro_proyecto_rechazada|' || (prueba.falla(format('insert into public.pi_documentos (proyecto_id, titulo, nombre_archivo, ruta, tamano, sha256) values (%L, %L, %L, %L, 10, %L)',
  :'pa', 'Cruzado', 'x.pdf', :'pb' || '/x.pdf', repeat('a', 64))) like '42501:PI_DOC%');
insert into public.pi_documentos (proyecto_id, entregable_id, titulo, categoria, nombre_archivo, ruta, tipo_mime, tamano, sha256)
values (:PA, (select id from public.pi_entregables where codigo = 'AD800-EI-001' and proyecto_id = :PA), 'Arquitectura de control', 'especificacion', 'arquitectura.pdf', :'pa' || '/arquitectura-v1.pdf', 'application/pdf', 2048, repeat('b', 64));
insert into public.pi_documentos (proyecto_id, titulo, categoria, nombre_archivo, ruta, tipo_mime, tamano, sha256, documento_base_id)
values (:PA, 'Arquitectura de control', 'especificacion', 'arquitectura.pdf', :'pa' || '/arquitectura-v2.pdf', 'application/pdf', 4096, repeat('c', 64),
  (select id from public.pi_documentos where ruta like '%arquitectura-v1.pdf'));
select 'PI|c08_nueva_version_numerada_y_anterior_reemplazada|' || ((select numero_version from public.pi_documentos where ruta like '%v2.pdf') = 2
  and (select estado from public.pi_documentos where ruta like '%v1.pdf') = 'reemplazado' and (select estado from public.pi_documentos where ruta like '%v2.pdf') = 'vigente');
select 'PI|c08_archivo_inmutable|' || (prueba.falla($$update public.pi_documentos set sha256 = repeat('d', 64) where ruta like '%v2.pdf'$$) like '42501:PI_DOC%');
select 'PI|c08_reemplazado_solo_por_sistema|' || (prueba.falla($$update public.pi_documentos set estado = 'reemplazado' where ruta like '%v2.pdf'$$) like '42501:PI_DOC%');
select 'PI|c08_anular_exige_motivo|' || (prueba.falla($$update public.pi_documentos set estado = 'anulado' where ruta like '%v2.pdf'$$) like '23514:%');
select 'PI|c08_tamano_maximo|' || (prueba.falla(format('insert into public.pi_documentos (proyecto_id, titulo, nombre_archivo, ruta, tamano, sha256) values (%L, %L, %L, %L, %s, %L)',
  :'pa', 'Enorme', 'big.zip', :'pa' || '/arquitectura-v1.pdf', 60000000, repeat('e', 64))) like '23514:%');
select 'PI|c08_resumen_cuenta_vigentes|' || ((select n_documentos from public.pi_proyectos_resumen where id = :PA) = 1);
select prueba.como(:'VIS');
select 'PI|c08_lector_ve_y_descarga|' || ((select count(*) from public.pi_documentos where proyecto_id = :PA) = 2 and (select count(*) from storage.objects where bucket_id = 'pi-documentos') = 2);
select 'PI|c08_lector_no_anula|' || (prueba.filas($$update public.pi_documentos set estado = 'anulado', motivo_anulacion = 'x'$$) = 0);
select prueba.como(:'NOR');
select 'PI|c08_ajeno_no_ve_documentos|' || ((select count(*) from public.pi_documentos) = 0);
-- Depósitos de Cotizaciones intactos: un usuario BFK sigue viendo su imagen; las políticas pi_ no la tocan.
select 'PI|c08_deposito_cotizaciones_intacto|' || ((select count(*) from storage.objects where bucket_id = 'cz-productos') = prueba.total_deposito('cz-productos') and prueba.total_deposito('cz-productos') > 0);
select prueba.como(:'ING');
select prueba.falla($$delete from storage.objects where bucket_id = 'pi-documentos'$$) as borrar \gset
select 'PI|c08_sin_reemplazo_ni_borrado_de_archivos|' || (:'borrar' <> 'SIN_ERROR'
  and prueba.filas($$update storage.objects set name = name || '.x' where bucket_id = 'pi-documentos'$$) = 0
  and (select count(*) from storage.objects where bucket_id = 'pi-documentos') = 2);
-- Cuenta de respaldo (sin perfil BFK): lee TODOS los archivos de pi-documentos y nada más.
select prueba.como(:'RESP');
select 'PI|c08_respaldo_lee_todos_los_archivos|' || ((select count(*) from storage.objects where bucket_id = 'pi-documentos') = 2);
select 'PI|c08_respaldo_no_ve_otros_depositos_ni_tablas|' || ((select count(*) from storage.objects where bucket_id <> 'pi-documentos') = 0
  and (select count(*) from public.pi_proyectos) = 0 and (select count(*) from public.pi_documentos) = 0 and (select count(*) from public.pi_proyectos_economia) = 0);
select 'PI|c08_respaldo_no_sube_ni_modifica|' || (prueba.falla(format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'pi-documentos', :'pa' || '/r.pdf')) like '42501:%'
  and prueba.filas($$update storage.objects set name = name || '.x' where bucket_id = 'pi-documentos'$$) = 0);
select 'PI|c08_usuario_no_se_inscribe_como_respaldo|' || (prueba.falla($$insert into public.pi_cuentas_respaldo (usuario_id, descripcion) values (auth.uid(), 'yo')$$) like '42501:%');
select prueba.como(:'ADM');
select 'PI|c08_deshabilitar_no_oculta_lo_existente|' || ((public.pi_configurar_documentos(false, 'Pausa (prueba)'))->>'documentos_habilitados' = 'false'
  and (select count(*) from public.pi_documentos where proyecto_id = :PA) = 2);
select (public.pi_configurar_documentos(true, 'Reanudar (prueba)'))->>'documentos_habilitados' as reanudar \gset
