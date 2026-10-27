\i _ini.sql
select prueba.como(:'JEF');
insert into public.pi_clientes (rut, razon_social, rubro) values ('76.086.428-5', 'Minera Prueba SpA', 'mineria');
select 'PI|c01_rut_normalizado|' || (select rut = '76.086.428-5' and rut_clave = '760864285' from public.pi_clientes where razon_social = 'Minera Prueba SpA');
select 'PI|c01_rut_invalido_rechazado|' || (prueba.falla($$insert into public.pi_clientes (rut, razon_social) values ('76.086.428-9', 'X Ltda')$$) like '22023:PI_RUT%');
select 'PI|c01_rut_duplicado_otro_formato_rechazado|' || (prueba.falla($$insert into public.pi_clientes (rut, razon_social) values ('760864285', 'Duplicada')$$) like '23505:%');
insert into public.pi_clientes (rut, razon_social, rubro) values ('96.505.760-9', 'Celulosa Prueba S.A.', 'celulosa');
insert into public.pi_clientes (razon_social, rubro) values ('Montajes Mandante Prueba', 'energia');
select 'PI|c01_correo_invalido_rechazado|' || (prueba.falla($$insert into public.pi_clientes (razon_social, contacto_correo) values ('Y Ltda', 'no-es-correo')$$) like '23514:%');
select prueba.como(:'ING');
select 'PI|c01_otro_usuario_no_edita_cliente_ajeno|' || (prueba.filas($$update public.pi_clientes set giro = 'x' where razon_social = 'Minera Prueba SpA'$$) = 0);
select 'PI|c01_usuario_lee_catalogo|' || ((select count(*) from public.pi_clientes) = 3);
select prueba.como(:'SINPERFIL');
select 'PI|c01_sin_perfil_no_lee|' || ((select count(*) from public.pi_clientes) = 0);
select 'PI|c01_sin_perfil_no_crea|' || (prueba.falla($$insert into public.pi_clientes (razon_social) values ('Intruso')$$) like '42501:%');
